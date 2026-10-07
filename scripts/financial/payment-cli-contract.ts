import { PaymentCliError } from "./payment-cli-transport";
import { CnpjValidator } from "../../src/lib/company/cnpj-validator";
import { canRetryDefinitivelyRejectedPayment, paymentSubmissionAttemptCount } from "../../src/features/financial/payment-requests/submission-retry";
import { overdueBarcodeSettlementRevisionSchema } from "../../src/features/financial/payment-requests/overdue-settlement";

export type PaymentCliAction = "authorize" | "send" | "retry-send" | "send-adjusted";

function validIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function validatePaymentCliPreparation(input: {
  message: Record<string, unknown>;
  inboxMessageId: string;
  amountCents: number;
  scheduledFor: string;
  beneficiaryDocument: string;
  expenseId: string;
  barcode: string;
}) {
  const classification = record(input.message.classification);
  const storedBarcode = String(classification?.barcode ?? "").replace(/[.\s-]/g, "");
  const existingBankPayment = record(input.message.existingBankPayment);
  const existingSettlement = record(input.message.existingSettlement);
  if (input.message.id !== input.inboxMessageId
    || input.message.status !== "linked"
    || input.message.linkedExpenseId !== input.expenseId
    || !input.expenseId
    || input.message.paymentRequestId
    || existingBankPayment?.transactionId
    || existingSettlement?.transactionId
    || !Number.isSafeInteger(input.amountCents) || input.amountCents <= 0
    || Number(classification?.amountCents) !== input.amountCents
    || !validIsoDate(input.scheduledFor)
    || !validIsoDate(String(classification?.dueDate ?? ""))
    || !CnpjValidator.validate(input.beneficiaryDocument).valid
    || !/^(\d{44}|\d{46}|\d{47}|\d{48})$/.test(input.barcode)
    || (storedBarcode && storedBarcode !== input.barcode)) {
    throw new PaymentCliError("Os dados da cobrança divergem da preparação específica. Nenhuma ação foi feita.");
  }
}

export function validatePaymentCliAction(input: {
  request: Record<string, unknown>;
  action: PaymentCliAction;
  amountCents: number;
  scheduledFor: string;
  beneficiaryDocument: string;
  expenseId: string;
  barcode: string;
  settlementAmountCents?: number;
  lateChargeAmountCents?: number;
  sourceAttachmentId?: string;
  sourceAttachmentSha256?: string;
}) {
  const { request } = input;
  const barcode = request.barcodeSnapshot as Record<string, unknown> | undefined;
  const expectedStatus = input.action === "authorize"
    ? "awaiting_financial_authorization"
    : input.action === "retry-send" ? "failed" : "ready_to_submit";
  const storedAmount = Number(request.amount);
  if (!["authorize", "send", "retry-send", "send-adjusted"].includes(input.action)
    || !Number.isSafeInteger(input.amountCents) || input.amountCents <= 0
    || !Number.isFinite(storedAmount) || Math.round(storedAmount * 100) !== input.amountCents
    || !validIsoDate(input.scheduledFor)
    || !/^\d{11}(\d{3})?$/.test(input.beneficiaryDocument)
    || !/^(\d{44}|\d{46}|\d{47}|\d{48})$/.test(input.barcode)
    || !["financial_inbox", "expense_boleto"].includes(String(request.sourceType)) || request.paymentRail !== "barcode"
    || (request.sourceType === "expense_boleto" && request.sourceId !== input.expenseId)
    || typeof request.sourceId !== "string" || !request.sourceId
    || request.expenseId !== input.expenseId || !input.expenseId
    || typeof barcode?.code !== "string" || barcode.code !== input.barcode
    || barcode.scheduledFor !== input.scheduledFor
    || barcode.beneficiaryDocument !== input.beneficiaryDocument) {
    throw new PaymentCliError("Os dados da solicitação divergem da ordem específica. Nenhuma ação foi feita.");
  }
  const validRetry = input.action === "retry-send" && canRetryDefinitivelyRejectedPayment(request);
  const revision = record(request.settlementRevision);
  const validAdjustedSend = input.action === "send-adjusted"
    && request.status === "ready_to_submit"
    && !request.interRequestId
    && Boolean(request.submissionStartedAt)
    && paymentSubmissionAttemptCount(request) === 2
    && Math.round(Number(request.requestedSettlementAmount) * 100) === input.settlementAmountCents
    && Math.round(Number(request.requestedLateChargeAmount) * 100) === input.lateChargeAmountCents
    && revision?.source === "confirmed_document"
    && revision.evidenceSource === "manual_document_review"
    && revision.sourceAttachmentId === input.sourceAttachmentId
    && revision.sourceAttachmentSha256 === input.sourceAttachmentSha256
    && revision.barcode === input.barcode
    && revision.beneficiaryDocument === input.beneficiaryDocument;
  const validFirstAction = input.action !== "retry-send"
    && input.action !== "send-adjusted"
    && !request.interRequestId && !request.submissionStartedAt && request.status === expectedStatus;
  if (!validRetry && !validAdjustedSend && !validFirstAction) {
    throw new PaymentCliError("A solicitação não está em estado de primeira autorização ou primeiro envio. Nenhuma ação foi feita.");
  }
}

export function validateOverdueSettlementCliRevision(input: {
  request: Record<string, unknown>;
  principalAmountCents: number;
  settlementAmountCents: number;
  lateChargeAmountCents: number;
  scheduledFor: string;
  beneficiaryDocument: string;
  expenseId: string;
  barcode: string;
  sourceAttachmentId: string;
  sourceAttachmentSha256: string;
}) {
  const parsed = overdueBarcodeSettlementRevisionSchema.safeParse({
    principalAmountCents: input.principalAmountCents,
    settlementAmountCents: input.settlementAmountCents,
    lateChargeAmountCents: input.lateChargeAmountCents,
    scheduledFor: input.scheduledFor,
    beneficiaryDocument: input.beneficiaryDocument,
    expenseId: input.expenseId,
    barcode: input.barcode,
    sourceAttachmentId: input.sourceAttachmentId,
    sourceAttachmentSha256: input.sourceAttachmentSha256,
    evidenceSource: "manual_document_review",
    confirmed: true,
  });
  const request = input.request;
  const barcode = record(request.barcodeSnapshot);
  if (!parsed.success
    || request.sourceType !== "financial_inbox"
    || request.paymentRail !== "barcode"
    || request.status !== "failed"
    || request.interRequestId
    || request.lastError == null
    || record(request.lastError)?.code !== "INTER_HTTP_400"
    || paymentSubmissionAttemptCount(request) !== 2
    || Math.round(Number(request.amount) * 100) !== input.principalAmountCents
    || request.expenseId !== input.expenseId
    || barcode?.code !== input.barcode
    || typeof barcode.scheduledFor !== "string"
    || !validIsoDate(barcode.scheduledFor)
    || barcode.scheduledFor > input.scheduledFor
    || barcode.beneficiaryDocument !== input.beneficiaryDocument
    || String(barcode.dueDate ?? "") >= input.scheduledFor) {
    throw new PaymentCliError("A solicitação não aceita revisão documental do valor vencido. Nenhuma ação foi feita.");
  }
  return parsed.data;
}
