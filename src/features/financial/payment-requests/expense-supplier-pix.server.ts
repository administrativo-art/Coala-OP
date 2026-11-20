import { randomUUID } from "node:crypto";
import { CnpjValidator } from "@/lib/company/cnpj-validator";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { AppError } from "@/lib/observability";
import type { ResolvedPaymentBeneficiary } from "../beneficiaries/types";
import { normalizeBrazilianDocument } from "../beneficiaries/normalization";
import { createBeneficiarySnapshot, resolveValidatedEntityPixBeneficiary } from "../beneficiaries/resolver.server";
import { assertExpenseAllowsNewPayment } from "../lib/source-settlement";
import { paymentRequestRef } from "./repository.server";
import type { PaymentActor, PixBankPaymentRequest } from "./types";

function conflict(safeMessage: string): never {
  throw new AppError({ code: "EXPENSE_SUPPLIER_PIX_CONFLICT", kind: "CONFLICT", safeMessage });
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
) {
  if (!data || data.workspaceId !== workspaceId) conflict("Despesa indisponível no ambiente financeiro.");
  assertExpenseAllowsNewPayment(data);
  const installments = data.installments ?? [];
  if (data.provisionType === "forecast" || data.status !== "pending" || data.paymentMethod !== "single"
    || data.paidAt || data.paymentState === "paid" || data.linkedBankTransactionId
    || data.financialInboxMessageId || data.boletoAttachment || data.documentIdentity?.barcode
    || !Array.isArray(installments) || installments.length > 1
    || installments.some((item) => !item ||
      item.paidAt || item.status !== "pending" || item.linkedBankTransactionId
      || item.financialInboxMessageId || item.boletoAttachment || item.paymentRequestId
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
) {
  const beneficiaryReference = { sourceType: "entity", sourceId: supplierEntityId } as const;
  const beneficiary = await resolveValidatedEntityPixBeneficiary(supplierEntityId);
  const document = assertSupplierPixBeneficiary(beneficiary);

  const expenseRef = financialDbAdmin.collection("expenses").doc(expenseId);
  const requestRef = paymentRequestRef(`expense_supplier_pix_${expenseId}`);
  const now = new Date().toISOString();
  const idempotencyKey = randomUUID();
  return financialDbAdmin.runTransaction(async (transaction) => {
    const [expense, existing] = await Promise.all([transaction.get(expenseRef), transaction.get(requestRef)]);
    const data = expense.data();
    const description = assertExpenseSupplierPixTarget(data, workspaceId, supplierEntityId, document, amountCents);
    if (existing.exists) {
      const prior = { ...existing.data(), id: existing.id } as PixBankPaymentRequest;
      if (data?.paymentRequestId !== prior.id || prior.workspaceId !== workspaceId
        || prior.sourceType !== "expense_supplier_pix" || prior.expenseId !== expenseId
        || prior.beneficiaryReference.sourceId !== supplierEntityId
        || prior.beneficiarySnapshot.sourceUpdatedAt !== beneficiary.sourceUpdatedAt
        || Math.round(prior.amount * 100) !== amountCents || prior.description !== description) {
        conflict("Já existe uma solicitação com dados diferentes para esta despesa.");
      }
      return { id: prior.id, status: prior.status };
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
    };
    transaction.create(requestRef, request);
    transaction.update(expenseRef, { paymentRequestId: requestRef.id, updatedAt: now, updatedBy: actor.uid });
    transaction.create(requestRef.collection("events").doc(), {
      type: "PAYMENT_REQUEST_CREATED", at: now, actorId: actor.uid,
      status: request.status, sourceType: request.sourceType, sourceId: expenseId, amount: request.amount,
    });
    return { id: requestRef.id, status: request.status };
  });
}
