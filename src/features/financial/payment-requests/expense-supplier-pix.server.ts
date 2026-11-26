import { createHash, randomUUID } from "node:crypto";
import { authAdmin, dbAdmin } from "@/lib/firebase-admin";
import { canAccessUnit } from "@/lib/unit-access";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { getInterPixStatus, mapInterPixStatus } from "@/lib/integrations/inter/pix-payments.server";
import { findInterBarcodePaymentsByCode } from "@/lib/integrations/inter/barcode-payments.server";
import { paymentBarcodeHash } from "../inbox/document-identity";
import { financialExpenseCompetenceMonth } from "../lib/expense-accounting-contract";
import { confirmSupplierPixSource, supplierPixConflict as conflict, type SupplierPixConfirmation } from "./supplier-pix-confirmation.server";
import type { BeneficiarySnapshot, ResolvedPaymentBeneficiary } from "../beneficiaries/types";
import { normalizeBrazilianDocument, normalizeValidatedPixKey, validBrazilianTaxId } from "../beneficiaries/normalization";
import { createBeneficiarySnapshot, resolveValidatedEntityPixBeneficiary } from "../beneficiaries/resolver.server";
import { assertExpenseAllowsNewPayment } from "../lib/source-settlement";
import { paymentRequestRef } from "./repository.server";
import type { PaymentActor, PixBankPaymentRequest } from "./types";
import { loadPurchasePixSource, assertPurchasePixIndication, assertPurchasePixSource, purchasePixSourceSnapshot, type PurchasePixIndicationInput, type PurchasePixIndication } from "./purchase-supplier-pix.server";

function attachedBoletoCode(data: FirebaseFirestore.DocumentData) {
  const installments = Array.isArray(data.installments) ? data.installments : [];
  const candidates = [
    data.boletoAttachment?.barcode, data.documentIdentity?.barcode, installments[0]?.boletoAttachment?.barcode,
    installments[0]?.documentIdentity?.barcode,
  ].filter(Boolean).map((value) => String(value).replace(/[^0-9]/g, ""));
  const distinct = [...new Set(candidates)];
  if (!distinct.length && !data.boletoAttachment && !installments[0]?.boletoAttachment) return null;
  if (distinct.length !== 1 || !/^\d{47}$/.test(distinct[0])) conflict("A linha digitável do boleto arquivado é inconclusiva.");
  return distinct[0];
}

export async function assertArchivedBoletoUnused(data: FirebaseFirestore.DocumentData | undefined, expectedHash?: string) {
  if (!data || !expectedHash) return;
  const code = attachedBoletoCode(data);
  if (!code || paymentBarcodeHash(code) !== expectedHash) conflict("O boleto da despesa mudou após a confirmação.");
  const matches = await findInterBarcodePaymentsByCode(code, true);
  if (matches.some((order) => !["CANCELADO", "REJEITADO", "RECUSADO"].includes(String(order.statusPagamento ?? "").trim().toUpperCase()))) {
    conflict("O boleto preservado possui pagamento ou ordem no Inter. Confira antes de enviar Pix.");
  }
}

export function assertSupplierPixBeneficiary(beneficiary: ResolvedPaymentBeneficiary) {
  const document = normalizeBrazilianDocument(beneficiary.document);
  if (!beneficiary.validated || beneficiary.paymentMethod !== "pix_key" || !beneficiary.pixKeyType
    || !beneficiary.pixKey || !validBrazilianTaxId(document)
    || !normalizeValidatedPixKey(beneficiary.pixKey, beneficiary.pixKeyType, document)) {
    conflict("O fornecedor precisa ter CPF/CNPJ e chave Pix válida vinculados ao cadastro.");
  }
  return document;
}

export function supplierPixDestinationUnchanged(snapshot: BeneficiarySnapshot, beneficiary: ResolvedPaymentBeneficiary) {
  const current = createBeneficiarySnapshot(beneficiary);
  if (snapshot.documentHash !== current.documentHash || snapshot.sourceUpdatedAt !== current.sourceUpdatedAt) return false;
  if (snapshot.destinationHash) return snapshot.destinationHash === current.destinationHash;
  // Solicitações criadas antes do hash só podiam usar a chave CNPJ idêntica ao documento.
  return snapshot.pixKeyType === "cnpj" && beneficiary.pixKeyType === "cnpj"
    && snapshot.maskedPaymentDestination === current.maskedPaymentDestination
    && normalizeBrazilianDocument(beneficiary.pixKey) === normalizeBrazilianDocument(beneficiary.document);
}

export function assertExpenseSupplierPixTarget(
  data: FirebaseFirestore.DocumentData | undefined,
  workspaceId: string,
  supplierEntityId: string,
  document: string,
  amountCents: number,
  confirmation?: PixBankPaymentRequest["supplierPixConfirmation"],
  indication?: PurchasePixIndication,
) {
  if (!data || data.workspaceId !== workspaceId) conflict("Despesa indisponível no ambiente financeiro.");
  assertExpenseAllowsNewPayment(data);
  if (document.length === 11 && (data.provisionType === "forecast" || !data.supplierId
    || !data.unitId || !data.dueDate || !financialExpenseCompetenceMonth(data)
    || !(data.accountPlan || data.accountId)
    || !(data.referenceResultCenterId || data.resultCenterId))) {
    conflict("A despesa da pessoa física precisa ser efetiva, vinculada e ter vencimento e classificação contábil.");
  }
  const installments = data.installments ?? [];
  const boletoCode = attachedBoletoCode(data);
  const boletoHash = boletoCode ? paymentBarcodeHash(boletoCode) : undefined;
  if (boletoHash !== confirmation?.replacedBoletoHash
    || (confirmation && financialExpenseCompetenceMonth(data) !== confirmation.competenceMonth)) {
    conflict("O boleto ou a competência da despesa diverge da confirmação do Pix.");
  }
  if (boletoHash) {
    const installment = Array.isArray(installments) ? installments[0] : undefined;
    const attachment = data.boletoAttachment ?? installment?.boletoAttachment;
    if (!attachment?.storagePath || normalizeBrazilianDocument(attachment.beneficiaryDocument) !== document
      || attachment.amountCents !== amountCents || attachment.competenceMonth !== confirmation?.competenceMonth) {
      conflict("O arquivo do boleto preservado diverge do CPF/CNPJ, valor ou competência do Pix.");
    }
  }
  const purchaseSingle = data.originModule === "purchasing" && data.purchaseOrderId
    && ["goods", "combined"].includes(data.purchaseExpenseRole);
  if (data.provisionType === "forecast" || data.status !== "pending" || data.paymentMethod !== "single"
    || data.paidAt || data.paymentState === "paid" || data.linkedBankTransactionId
    || data.financialInboxMessageId
    || (!Array.isArray(installments) && !purchaseSingle) || (Array.isArray(installments) && installments.length > 1)
    || installments.some((item: FirebaseFirestore.DocumentData) => !item ||
      item.paidAt || item.status !== "pending" || item.linkedBankTransactionId
      || item.financialInboxMessageId || item.paymentRequestId
      || Math.round(Number(item.value) * 100) !== amountCents)) {
    conflict("A despesa precisa estar em aberto e ter pagamento único disponível.");
  }
  const description = String(data.description ?? "").trim().slice(0, 140);
  if (data.netPayableValue !== undefined && data.netPayableValue !== null
    && (!Number.isFinite(Number(data.netPayableValue))
      || Math.round(Number(data.netPayableValue) * 100) !== amountCents)) {
    conflict("O valor líquido da despesa diverge do Pix. Confira descontos antes de preparar ou enviar.");
  }
  if (!description || Math.round(Number(data.totalValue) * 100) !== amountCents
    || normalizeBrazilianDocument(data.billingIdentity?.supplierTaxId) !== (indication?.supplierTaxId ?? document)
    || (indication
      ? data.supplierId !== indication.supplierEntityId || indication.beneficiaryEntityId !== supplierEntityId
      : document.length === 11 ? data.supplierId !== supplierEntityId : Boolean(data.supplierId && data.supplierId !== supplierEntityId))) {
    conflict("O valor ou a identidade do fornecedor diverge da despesa.");
  }
  return description;
}

const terminalPixStates = ["rejected", "approval_expired"];
export const SUPPLIER_PIX_HISTORY_LIMIT = 21;

export function hasConflictingSupplierPixHistory(
  rows: FirebaseFirestore.QueryDocumentSnapshot[],
  headId: string,
  previousId?: string,
) {
  if (rows.length >= SUPPLIER_PIX_HISTORY_LIMIT) return true;
  const linked = new Map(rows.map(row => [row.id, row]));
  let replacementId = headId;
  let priorId = previousId;
  const seen = new Set<string>([headId]);
  while (priorId) {
    const prior = linked.get(priorId);
    if (!prior || seen.has(priorId) || prior.get("sourceType") !== "expense_supplier_pix"
      || !terminalPixStates.includes(prior.get("status")) || !prior.get("interRequestId")
      || prior.get("paidAt") || prior.get("endToEndId")
      || (prior.get("supersededByPaymentRequestId") !== replacementId
        && !(replacementId === headId && !linked.has(headId) && !prior.get("supersededByPaymentRequestId")))) return true;
    seen.add(priorId);
    replacementId = priorId;
    priorId = prior.get("supersedesPaymentRequestId") ?? undefined;
  }
  return rows.some(row => !seen.has(row.id));
}

export async function assertSupplierPixBankClosed(
  previous: PixBankPaymentRequest,
  readBank = getInterPixStatus,
) {
  if (previous.sourceType !== "expense_supplier_pix" || !previous.interRequestId
    || !terminalPixStates.includes(previous.status) || previous.paidAt || previous.endToEndId) {
    conflict("A ordem anterior precisa estar recusada ou expirada, sem liquidação.");
  }
  const transaction = (await readBank(previous.interRequestId)).transacaoPix;
  if (!transaction || (transaction.codigoSolicitacao && transaction.codigoSolicitacao !== previous.interRequestId)
    || transaction.endToEnd || Math.round(Number(transaction.valor) * 100) !== Math.round(previous.amount * 100)
    || !terminalPixStates.includes(mapInterPixStatus(transaction.status))) {
    conflict("O Inter não confirmou o encerramento da ordem anterior sem pagamento.");
  }
}

export async function prepareExpenseSupplierPix(
  expenseId: string,
  supplierEntityId: string,
  amountCents: number,
  workspaceId: string,
  actor: PaymentActor,
  confirmation?: SupplierPixConfirmation,
  replacementOf?: string,
  readBank = getInterPixStatus,
  onBeforeTransaction?: () => Promise<void>,
  indicationInput?: PurchasePixIndicationInput,
) {
  const sourceExpenseId = expenseId;
  const user = await dbAdmin.collection("users").doc(actor.uid).get();
  if (!user.exists || user.get("isActive") === false) conflict("Operador do Pix indisponível.");
  const profileId = String(user.get("profileId") ?? "").trim();
  const profile = profileId ? await dbAdmin.collection("profiles").doc(profileId).get() : null;
  const claims = profileId ? null : (await authAdmin.getUser(actor.uid)).customClaims;
  const isDefaultAdmin = profileId ? profile?.get("isDefaultAdmin") === true
    : claims?.profileId ? false : claims?.isDefaultAdmin === true;
  const assertUnitAccess = (data: FirebaseFirestore.DocumentData | undefined) => {
    if (!data || !canAccessUnit(user.data()!, String(data.unitId ?? ""), { isDefaultAdmin })) {
      conflict("Operador sem acesso à unidade da despesa Pix.");
    }
  };
  if (confirmation) {
    expenseId = await confirmSupplierPixSource(expenseId, supplierEntityId, amountCents, workspaceId, actor, confirmation, assertUnitAccess);
  }
  const beneficiaryReference = { sourceType: "entity", sourceId: supplierEntityId } as const;
  const beneficiary = await resolveValidatedEntityPixBeneficiary(supplierEntityId);
  const document = assertSupplierPixBeneficiary(beneficiary);

  const expenseRef = financialDbAdmin.collection("expenses").doc(expenseId);
  const initialExpense = await expenseRef.get();
  const previousRef = replacementOf ? paymentRequestRef(replacementOf) : null;
  const previousSnapshot = previousRef ? await previousRef.get() : null;
  const previous = previousSnapshot?.exists
    ? { ...previousSnapshot.data(), id: previousSnapshot.id } as PixBankPaymentRequest
    : null;
  const orderId = String(initialExpense.get("purchaseOrderId") ?? "");
  const purchaseSource = orderId && initialExpense.get("purchaseExpenseRole") !== "freight"
    ? await loadPurchasePixSource(orderId) : null;
  const purchasePixSource = purchaseSource ? purchasePixSourceSnapshot(orderId, purchaseSource, amountCents) : undefined;
  if (indicationInput && (!purchaseSource || confirmation || replacementOf || !validBrazilianTaxId(document)
    || !/^\d{44}$/.test(indicationInput.invoiceAccessKey)
    || purchaseSource.order.invoiceAccessKey !== indicationInput.invoiceAccessKey
    || !String(purchaseSource.order.fiscal?.issuerCnpj ?? purchaseSource.order.fiscal?.supplierDocument ?? "").trim()
    || purchaseSource.supplierTaxId.length !== 14)) {
    conflict("A indicação exige compra confirmada com NF e recebedor Pix validado.");
  }
  if (purchaseSource && purchaseSource.supplierTaxId === document && indicationInput) {
    conflict("A indicação excepcional só se aplica quando fornecedor fiscal e favorecido são distintos.");
  }
  if (purchaseSource && purchaseSource.supplierTaxId !== document && !indicationInput && !previous?.purchasePixIndication) {
    conflict("O favorecido difere do fornecedor da nota; confirme expressamente a indicação.");
  }
  const purchasePixIndication: PurchasePixIndication | undefined = indicationInput && purchaseSource ? {
    purchaseOrderId: orderId, supplierEntityId: purchaseSource.order.supplierId,
    supplierTaxId: purchaseSource.supplierTaxId, beneficiaryEntityId: supplierEntityId,
    unitId: purchaseSource.order.destinationKioskId,
    amountCents, invoiceAccessKey: indicationInput.invoiceAccessKey,
    orderFingerprint: purchaseSource.fingerprint,
    reason: indicationInput.reason.trim(), evidence: indicationInput.evidence.trim(),
    confirmedBy: actor.uid, confirmedAt: new Date().toISOString(),
  } : previous?.purchasePixIndication;
  if (purchasePixIndication && (purchasePixIndication.reason.length < 10 || purchasePixIndication.evidence.length < 10)) {
    conflict("Informe motivo e evidência fiscal da indicação do favorecido.");
  }
  const requestRef = paymentRequestRef(replacementOf
    ? `supplier_pix_retry_${createHash("sha256").update(replacementOf).digest("hex")}`
    : `expense_supplier_pix_${expenseId}`);
  if (replacementOf && (!previous || previous.workspaceId !== workspaceId || previous.expenseId !== expenseId
    || previous.sourceId !== expenseId || previous.beneficiaryReference?.sourceType !== "entity"
    || previous.beneficiaryReference.sourceId !== supplierEntityId
    || !previous.beneficiarySnapshot
    || previous.beneficiarySnapshot.documentHash !== createBeneficiarySnapshot(beneficiary).documentHash
    || Math.round(previous.amount * 100) !== amountCents
    || (previous.supersededByPaymentRequestId && previous.supersededByPaymentRequestId !== requestRef.id))) {
    conflict("A solicitação anterior diverge da despesa ou do favorecido.");
  }
  if (previous && !previous.supersededByPaymentRequestId) await assertSupplierPixBankClosed(previous, readBank);
  const before = confirmation || previous ? initialExpense.data() : undefined;
  const code = before ? attachedBoletoCode(before) : null;
  if (confirmation && Boolean(code) !== confirmation.allowExistingBoleto) {
    conflict("A confirmação para preservar o boleto diverge dos anexos atuais.");
  }
  const replacedBoletoHash = code ? paymentBarcodeHash(code) : null;
  if (code && !replacedBoletoHash) conflict("Não foi possível identificar o boleto preservado.");
  const supplierPixConfirmation: PixBankPaymentRequest["supplierPixConfirmation"] = confirmation ? {
    competenceMonth: confirmation.competenceMonth,
    previousPaidRequestId: confirmation.previousPaidRequestId,
    ...(replacedBoletoHash ? { replacedBoletoHash } : {}),
  } : previous?.supplierPixConfirmation;
  await assertArchivedBoletoUnused(before, supplierPixConfirmation?.replacedBoletoHash);
  const now = new Date().toISOString();
  const idempotencyKey = randomUUID();
  await onBeforeTransaction?.();
  return financialDbAdmin.runTransaction(async (transaction) => {
    const [expense, existing] = await Promise.all([transaction.get(expenseRef), transaction.get(requestRef)]);
    const data = expense.data();
    assertUnitAccess(data && purchaseSource && !data.unitId
      ? { ...data, unitId: purchaseSource.order.destinationKioskId } : data);
    const expenseDocument = normalizeBrazilianDocument(data?.billingIdentity?.supplierTaxId);
    if (confirmation && (document !== confirmation.beneficiaryDocument || (expenseDocument && expenseDocument !== document))) {
      conflict("O CPF/CNPJ fiscal da despesa mudou durante a confirmação.");
    }
    if (purchaseSource && (!data || data.purchaseOrderId !== orderId || data.originModule !== "purchasing"
      || !["goods", "combined"].includes(data.purchaseExpenseRole)
      || (data.supplierId && data.supplierId !== purchaseSource.order.supplierId)
      || (data.unitId && data.unitId !== purchaseSource.order.destinationKioskId)
      || (expenseDocument && expenseDocument !== purchaseSource.supplierTaxId)
      || purchaseSource.order.linkedExpenseId !== expenseId)) {
      conflict("A despesa da compra diverge do pedido ou do fornecedor fiscal.");
    }
    const canonicalDocument = purchaseSource?.supplierTaxId ?? document;
    const billingPatch = data ? {
      ...(!expenseDocument && (confirmation || purchaseSource)
        ? { billingIdentity: { ...data.billingIdentity, supplierTaxId: canonicalDocument } } : {}),
      ...(!data.supplierId && (confirmation || purchaseSource)
        ? { supplierId: purchaseSource?.order.supplierId ?? supplierEntityId } : {}),
      ...(!data.unitId && purchaseSource ? { unitId: purchaseSource.order.destinationKioskId } : {}),
      ...(purchaseSource ? {
        purchaseInvoiceAccessKey: purchaseSource.order.invoiceAccessKey ?? null,
        purchaseInvoiceNumber: purchaseSource.order.invoiceNumber ?? purchaseSource.order.fiscal?.number ?? null,
      } : {}),
    } : {};
    const target = data ? { ...data, ...billingPatch,
      ...(purchasePixIndication ? { purchasePixIndication } : {}) } : undefined;
    if (purchasePixSource && purchaseSource) assertPurchasePixSource(expenseId, target, purchasePixSource, purchaseSource);
    if (purchasePixIndication && purchaseSource) {
      if (data?.purchasePixIndication && data.purchasePixIndication.orderFingerprint !== purchasePixIndication.orderFingerprint) {
        conflict("A indicação do favorecido da despesa mudou.");
      }
      assertPurchasePixIndication(expenseId, target, purchasePixIndication, purchaseSource);
    }
    const description = assertExpenseSupplierPixTarget(target, workspaceId, supplierEntityId, document, amountCents, supplierPixConfirmation, purchasePixIndication);
    if (existing.exists) {
      const prior = { ...existing.data(), id: existing.id } as PixBankPaymentRequest;
      if (data?.paymentRequestId !== prior.id || prior.workspaceId !== workspaceId
        || prior.sourceType !== "expense_supplier_pix" || prior.expenseId !== expenseId
        || (prior.supersedesPaymentRequestId ?? undefined) !== replacementOf
        || prior.beneficiaryReference.sourceId !== supplierEntityId
        || !supplierPixDestinationUnchanged(prior.beneficiarySnapshot, beneficiary)
        || Math.round(prior.amount * 100) !== amountCents || prior.description !== description
        || prior.supplierPixConfirmation?.competenceMonth !== supplierPixConfirmation?.competenceMonth
        || prior.supplierPixConfirmation?.previousPaidRequestId !== supplierPixConfirmation?.previousPaidRequestId
        || prior.supplierPixConfirmation?.replacedBoletoHash !== supplierPixConfirmation?.replacedBoletoHash
        || prior.purchasePixIndication?.orderFingerprint !== purchasePixIndication?.orderFingerprint
        || prior.purchasePixIndication?.beneficiaryEntityId !== purchasePixIndication?.beneficiaryEntityId
        || prior.purchasePixIndication?.reason !== purchasePixIndication?.reason
        || prior.purchasePixIndication?.evidence !== purchasePixIndication?.evidence
        || prior.purchasePixSource?.orderFingerprint !== purchasePixSource?.orderFingerprint
        || (prior.purchasePixIndication && data?.purchasePixIndication?.confirmedAt !== prior.purchasePixIndication.confirmedAt)) {
        conflict("Já existe uma solicitação com dados diferentes para esta despesa.");
      }
      return { id: prior.id, status: prior.status, ...(confirmation ? { expenseId } : {}) };
    }

    const [payments, requests] = await Promise.all([
      transaction.get(financialDbAdmin.collection("payments").where("expenseId", "==", expenseId).limit(1)),
      transaction.get(financialDbAdmin.collection("bankPaymentRequests").where("expenseId", "==", expenseId).limit(SUPPLIER_PIX_HISTORY_LIMIT)),
    ]);
    const prior = previous && requests.docs.find(row => row.id === previous.id);
    if ((previous && data?.paymentRequestId !== previous.id)
      || (!previous && data?.paymentRequestId) || !payments.empty
      || hasConflictingSupplierPixHistory(requests.docs, requestRef.id, previous?.id)
      || (previous && (!prior || prior.get("interRequestId") !== previous.interRequestId
        || prior.get("status") !== previous.status || prior.get("supersededByPaymentRequestId")
        || prior.get("description") !== description))) {
      conflict("A despesa já possui pagamento, outra solicitação bancária ou histórico divergente.");
    }

    const request: Omit<PixBankPaymentRequest, "id"> = {
      workspaceId, sourceType: "expense_supplier_pix", sourceId: expenseId, expenseId,
      beneficiaryReference, beneficiarySnapshot: createBeneficiarySnapshot(beneficiary, now),
      amount: amountCents / 100, description, status: "awaiting_financial_authorization",
      idempotencyKey, createdAt: now, updatedAt: now, createdBy: actor.uid,
      ...(supplierPixConfirmation ? { supplierPixConfirmation } : {}),
      ...(purchasePixIndication ? { purchasePixIndication } : {}),
      ...(purchasePixSource ? { purchasePixSource } : {}),
      ...(previous ? { supersedesPaymentRequestId: previous.id } : {}),
    };
    transaction.create(requestRef, request);
    if (previousRef) {
      transaction.update(previousRef, { supersededByPaymentRequestId: requestRef.id, updatedAt: now });
      transaction.create(previousRef.collection("events").doc(), {
        type: "SUPPLIER_PIX_REPLACED", at: now, actorId: actor.uid, replacementId: requestRef.id,
      });
    }
    transaction.update(expenseRef, { ...billingPatch,
      ...(purchasePixIndication ? { purchasePixIndication } : {}),
      paymentRequestId: requestRef.id, updatedAt: now, updatedBy: actor.uid });
    transaction.create(requestRef.collection("events").doc(), {
      type: "PAYMENT_REQUEST_CREATED", at: now, actorId: actor.uid,
      status: request.status, sourceType: request.sourceType, sourceId: expenseId, amount: request.amount,
      ...(supplierPixConfirmation ? { supplierPixConfirmation, sourceExpenseId } : {}),
      ...(purchasePixIndication ? { purchasePixIndication: {
        confirmedBy: purchasePixIndication.confirmedBy,
        confirmedAt: purchasePixIndication.confirmedAt,
        orderFingerprint: purchasePixIndication.orderFingerprint,
      } } : {}),
    });
    return { id: requestRef.id, status: request.status, ...(confirmation ? { expenseId } : {}) };
  });
}
