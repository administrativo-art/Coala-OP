import { randomUUID } from "node:crypto";
import { CnpjValidator } from "@/lib/company/cnpj-validator";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { findInterBarcodePaymentsByCode } from "@/lib/integrations/inter/barcode-payments.server";
import { paymentBarcodeHash } from "../inbox/document-identity";
import { financialExpenseCompetenceMonth } from "../lib/expense-accounting-contract";
import { confirmSupplierPixSource, supplierPixConflict as conflict, type SupplierPixConfirmation } from "./supplier-pix-confirmation.server";
import type { ResolvedPaymentBeneficiary } from "../beneficiaries/types";
import { normalizeBrazilianDocument } from "../beneficiaries/normalization";
import { createBeneficiarySnapshot, resolveValidatedEntityPixBeneficiary } from "../beneficiaries/resolver.server";
import { assertExpenseAllowsNewPayment } from "../lib/source-settlement";
import { paymentRequestRef } from "./repository.server";
import type { PaymentActor, PixBankPaymentRequest } from "./types";

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
  if (!beneficiary.validated || beneficiary.paymentMethod !== "pix_key" || beneficiary.pixKeyType !== "cnpj"
    || !CnpjValidator.validate(document).valid || normalizeBrazilianDocument(beneficiary.pixKey) !== document) {
    conflict("O fornecedor precisa ter uma chave Pix CNPJ validada e igual ao documento do favorecido.");
  }
  return document;
}

export function assertExpenseSupplierPixTarget(
  data: FirebaseFirestore.DocumentData | undefined,
  workspaceId: string,
  supplierEntityId: string,
  document: string,
  amountCents: number,
  confirmation?: PixBankPaymentRequest["supplierPixConfirmation"],
) {
  if (!data || data.workspaceId !== workspaceId) conflict("Despesa indisponível no ambiente financeiro.");
  assertExpenseAllowsNewPayment(data);
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
      conflict("O arquivo do boleto preservado diverge do CNPJ, valor ou competência do Pix.");
    }
  }
  if (data.provisionType === "forecast" || data.status !== "pending" || data.paymentMethod !== "single"
    || data.paidAt || data.paymentState === "paid" || data.linkedBankTransactionId
    || data.financialInboxMessageId
    || !Array.isArray(installments) || installments.length > 1
    || installments.some((item) => !item ||
      item.paidAt || item.status !== "pending" || item.linkedBankTransactionId
      || item.financialInboxMessageId || item.paymentRequestId
      || Math.round(Number(item.value) * 100) !== amountCents)) {
    conflict("A despesa precisa estar em aberto e ter pagamento único disponível.");
  }
  const description = String(data.description ?? "").trim().slice(0, 140);
  if (!description || Math.round(Number(data.totalValue) * 100) !== amountCents
    || normalizeBrazilianDocument(data.billingIdentity?.supplierTaxId) !== document
    || (data.supplierId && data.supplierId !== supplierEntityId)) {
    conflict("O valor ou a identidade do fornecedor diverge da despesa.");
  }
  return description;
}

export async function prepareExpenseSupplierPix(
  expenseId: string,
  supplierEntityId: string,
  amountCents: number,
  workspaceId: string,
  actor: PaymentActor,
  confirmation?: SupplierPixConfirmation,
) {
  const sourceExpenseId = expenseId;
  if (confirmation) {
    expenseId = await confirmSupplierPixSource(expenseId, supplierEntityId, amountCents, workspaceId, actor, confirmation);
  }
  const beneficiaryReference = { sourceType: "entity", sourceId: supplierEntityId } as const;
  const beneficiary = await resolveValidatedEntityPixBeneficiary(supplierEntityId);
  const document = assertSupplierPixBeneficiary(beneficiary);

  const expenseRef = financialDbAdmin.collection("expenses").doc(expenseId);
  const requestRef = paymentRequestRef(`expense_supplier_pix_${expenseId}`);
  const before = confirmation ? (await expenseRef.get()).data() : undefined;
  const code = before ? attachedBoletoCode(before) : null;
  if (confirmation && Boolean(code) !== confirmation.allowExistingBoleto) {
    conflict("A confirmação para preservar o boleto diverge dos anexos atuais.");
  }
  const supplierPixConfirmation = confirmation ? {
    competenceMonth: confirmation.competenceMonth,
    previousPaidRequestId: confirmation.previousPaidRequestId,
    ...(code ? { replacedBoletoHash: paymentBarcodeHash(code) } : {}),
  } : undefined;
  await assertArchivedBoletoUnused(before, supplierPixConfirmation?.replacedBoletoHash);
  const now = new Date().toISOString();
  const idempotencyKey = randomUUID();
  return financialDbAdmin.runTransaction(async (transaction) => {
    const [expense, existing] = await Promise.all([transaction.get(expenseRef), transaction.get(requestRef)]);
    const data = expense.data();
    const expenseDocument = normalizeBrazilianDocument(data?.billingIdentity?.supplierTaxId);
    if (confirmation && (document !== confirmation.beneficiaryDocument || (expenseDocument && expenseDocument !== document))) {
      conflict("O CNPJ fiscal da despesa mudou durante a confirmação.");
    }
    const billingPatch = confirmation && !expenseDocument && data
      ? { billingIdentity: { ...data.billingIdentity, supplierTaxId: document }, supplierId: supplierEntityId }
      : {};
    const target = data ? { ...data, ...billingPatch } : undefined;
    const description = assertExpenseSupplierPixTarget(target, workspaceId, supplierEntityId, document, amountCents, supplierPixConfirmation);
    if (existing.exists) {
      const prior = { ...existing.data(), id: existing.id } as PixBankPaymentRequest;
      if (data?.paymentRequestId !== prior.id || prior.workspaceId !== workspaceId
        || prior.sourceType !== "expense_supplier_pix" || prior.expenseId !== expenseId
        || prior.beneficiaryReference.sourceId !== supplierEntityId
        || prior.beneficiarySnapshot.sourceUpdatedAt !== beneficiary.sourceUpdatedAt
        || Math.round(prior.amount * 100) !== amountCents || prior.description !== description
        || prior.supplierPixConfirmation?.competenceMonth !== supplierPixConfirmation?.competenceMonth
        || prior.supplierPixConfirmation?.previousPaidRequestId !== supplierPixConfirmation?.previousPaidRequestId
        || prior.supplierPixConfirmation?.replacedBoletoHash !== supplierPixConfirmation?.replacedBoletoHash) {
        conflict("Já existe uma solicitação com dados diferentes para esta despesa.");
      }
      return { id: prior.id, status: prior.status, ...(confirmation ? { expenseId } : {}) };
    }

    const [payments, requests] = await Promise.all([
      transaction.get(financialDbAdmin.collection("payments").where("expenseId", "==", expenseId).limit(1)),
      transaction.get(financialDbAdmin.collection("bankPaymentRequests").where("expenseId", "==", expenseId).limit(1)),
    ]);
    if (data?.paymentRequestId || !payments.empty || !requests.empty) conflict("A despesa já possui pagamento ou solicitação bancária.");

    const request: Omit<PixBankPaymentRequest, "id"> = {
      workspaceId, sourceType: "expense_supplier_pix", sourceId: expenseId, expenseId,
      beneficiaryReference, beneficiarySnapshot: createBeneficiarySnapshot(beneficiary, now),
      amount: amountCents / 100, description, status: "awaiting_financial_authorization",
      idempotencyKey, createdAt: now, updatedAt: now, createdBy: actor.uid,
      ...(supplierPixConfirmation ? { supplierPixConfirmation } : {}),
    };
    transaction.create(requestRef, request);
    transaction.update(expenseRef, { ...billingPatch, paymentRequestId: requestRef.id, updatedAt: now, updatedBy: actor.uid });
    transaction.create(requestRef.collection("events").doc(), {
      type: "PAYMENT_REQUEST_CREATED", at: now, actorId: actor.uid,
      status: request.status, sourceType: request.sourceType, sourceId: expenseId, amount: request.amount,
      ...(supplierPixConfirmation ? { supplierPixConfirmation, sourceExpenseId } : {}),
    });
    return { id: requestRef.id, status: request.status, ...(confirmation ? { expenseId } : {}) };
  });
}
