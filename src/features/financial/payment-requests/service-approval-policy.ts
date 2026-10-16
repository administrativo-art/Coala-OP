import type { BankPaymentRequest } from "./types";

export const FINANCIAL_SERVICE_APPROVAL_MAX_AMOUNT_CENTS = 500_000;
export const FINANCIAL_SERVICE_APPROVAL_BENEFICIARY_DOCUMENT = "02558157000405";
export const FINANCIAL_SERVICE_APPROVAL_POLICY = "vivo-financial-inbox-up-to-5000-v1";
export const FINANCIAL_SERVICE_APPROVER_ID = "system:financial-payment-approver";

function digits(value: unknown) {
  return typeof value === "string" ? value.replace(/\D/g, "") : "";
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function financialServiceApprovalRejection(input: {
  request: BankPaymentRequest;
  inboxMessageId: string;
  inboxMessage: Record<string, unknown> | null;
  allowedSourceIds: ReadonlySet<string>;
  workspaceId: string;
  today: string;
  serviceActorId?: string;
}) {
  const { request, inboxMessage: message } = input;
  const serviceActorId = input.serviceActorId ?? FINANCIAL_SERVICE_APPROVER_ID;
  if (request.sourceType !== "financial_inbox" || request.paymentRail !== "barcode") return "origem não autorizada";
  if (!input.allowedSourceIds.has(request.sourceId)) return "cobrança fora da autorização explícita";
  if (!message || input.inboxMessageId !== request.sourceId || message.workspaceId !== input.workspaceId) return "cobrança não encontrada no workspace";
  if (!request.expenseId || message.linkedExpenseId !== request.expenseId) return "despesa vinculada divergente";
  if (message.paymentRequestId !== request.id) return "solicitação não vinculada à cobrança";
  if (message.existingBankPayment || message.existingSettlement) return "pagamento bancário ou liquidação já encontrado";
  if (request.interRequestId || request.submissionStartedAt) return "envio bancário anterior encontrado";
  if (!request.idempotencyKey) return "chave de idempotência ausente";
  if (!["awaiting_financial_authorization", "ready_to_submit"].includes(request.status)) return "estado não autorizável";
  if (request.status === "ready_to_submit" && request.authorizedBy !== serviceActorId) return "autorização anterior não pertence ao executor financeiro";
  if (request.status === "awaiting_financial_authorization" && request.authorizedBy) return "autorização parcial divergente";

  const amountCents = Math.round(request.amount * 100);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > FINANCIAL_SERVICE_APPROVAL_MAX_AMOUNT_CENTS) return "valor fora do limite de R$ 5.000";
  if (digits(request.barcodeSnapshot.beneficiaryDocument) !== FINANCIAL_SERVICE_APPROVAL_BENEFICIARY_DOCUMENT) return "beneficiário não autorizado";
  const barcode = digits(request.barcodeSnapshot.code);
  if (![44, 46, 47, 48].includes(barcode.length)) return "linha digitável inválida";
  if (request.barcodeSnapshot.scheduledFor < input.today || request.barcodeSnapshot.scheduledFor > request.barcodeSnapshot.dueDate) return "data programada fora do período seguro";

  const classification = record(message.classification);
  if (!classification || Number(classification.amountCents) !== amountCents) return "valor da cobrança divergente";
  if (digits(classification.barcode) !== barcode) return "linha digitável da cobrança divergente";
  if (classification.dueDate !== request.barcodeSnapshot.dueDate) return "vencimento da cobrança divergente";
  const supplierTaxId = digits(classification.supplierTaxId);
  if (supplierTaxId && supplierTaxId !== FINANCIAL_SERVICE_APPROVAL_BENEFICIARY_DOCUMENT) return "CNPJ extraído da cobrança divergente";
  return null;
}

