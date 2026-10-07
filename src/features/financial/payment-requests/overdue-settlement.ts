import { z } from "zod";

import { CnpjValidator } from "@/lib/company/cnpj-validator";
import type { BankPaymentRequest } from "./types";
import { paymentSubmissionAttemptCount } from "./submission-retry";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}, "Data inválida.");

export const overdueBarcodeSettlementRevisionSchema = z.object({
  principalAmountCents: z.number().int().positive().max(100_000_000),
  settlementAmountCents: z.number().int().positive().max(100_000_000),
  lateChargeAmountCents: z.number().int().positive().max(100_000_000),
  scheduledFor: isoDate,
  beneficiaryDocument: z.string()
    .transform((value) => CnpjValidator.clean(value))
    .refine((value) => CnpjValidator.validate(value).valid, "CNPJ do favorecido inválido."),
  expenseId: z.string().trim().min(1).max(200),
  barcode: z.string().transform((value) => value.replace(/[.\s-]/g, ""))
    .pipe(z.string().regex(/^(\d{44}|\d{46}|\d{47}|\d{48})$/)),
  sourceAttachmentId: z.string().trim().min(1).max(200),
  sourceAttachmentSha256: z.string().regex(/^[a-f0-9]{64}$/i).transform((value) => value.toLowerCase()),
  evidenceSource: z.literal("manual_document_review"),
  confirmed: z.literal(true),
}).strict().superRefine((value, context) => {
  if (value.settlementAmountCents !== value.principalAmountCents + value.lateChargeAmountCents) {
    context.addIssue({ code: "custom", path: ["settlementAmountCents"], message: "O valor a pagar deve ser a soma do principal e dos encargos." });
  }
});

export type OverdueBarcodeSettlementRevisionInput = z.infer<typeof overdueBarcodeSettlementRevisionSchema>;

type FinancialInboxMessageSnapshot = {
  id?: unknown;
  workspaceId?: unknown;
  status?: unknown;
  bankState?: unknown;
  linkedExpenseId?: unknown;
  paymentRequestId?: unknown;
  existingBankPayment?: { transactionId?: unknown } | null;
  existingSettlement?: { transactionId?: unknown } | null;
  classification?: {
    amountCents?: unknown;
    dueDate?: unknown;
    barcode?: unknown;
    billingIdentity?: { supplierTaxId?: unknown } | null;
  } | null;
  attachments?: Array<{ id?: unknown; archiveStatus?: unknown; storagePath?: unknown; sha256?: unknown }> | null;
};

type FinancialInboxExpenseSnapshot = Record<string, unknown> & { id?: unknown };

function installmentRecords(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    : [];
}

export function assertFinancialInboxPaymentTarget(params: {
  request: BankPaymentRequest;
  message: FinancialInboxMessageSnapshot;
  expense: FinancialInboxExpenseSnapshot;
  today: string;
}) {
  const { request, message, expense } = params;
  if (request.sourceType !== "financial_inbox" || request.paymentRail !== "barcode") return;
  const principalAmountCents = Math.round(request.amount * 100);
  const installments = installmentRecords(expense.installments);
  const installment = request.installmentNumber == null
    ? null
    : installments.find((item, index) => Number(item.number ?? index + 1) === request.installmentNumber);
  const linkedToMessage = expense.financialInboxMessageId === request.sourceId
    || installment?.financialInboxMessageId === request.sourceId;
  const payableAmountCents = installment
    ? Math.round(Number(installment.value) * 100)
    : Math.round(Number(expense.totalValue) * 100);
  if (message.id !== request.sourceId
    || message.linkedExpenseId !== request.expenseId
    || message.paymentRequestId !== request.id
    || message.status !== "awaiting_authorization"
    || message.bankState !== "awaiting_authorization"
    || message.existingBankPayment?.transactionId
    || message.existingSettlement?.transactionId
    || expense.id !== request.expenseId
    || (message.workspaceId && expense.workspaceId !== message.workspaceId)
    || !linkedToMessage
    || (expense.paymentRequestId && expense.paymentRequestId !== request.id)
    || !["pending", "provisioned"].includes(String(expense.status ?? ""))
    || expense.paymentState === "paid"
    || expense.paidAt
    || expense.linkedBankTransactionId
    || expense.sourceSettlement
    || !Number.isSafeInteger(payableAmountCents)
    || payableAmountCents !== principalAmountCents
    || (request.installmentNumber != null && !installment)
    || (installment && (!["pending", "provisioned"].includes(String(installment.status ?? ""))
      || installment.paidAt || installment.linkedBankTransactionId
      || (installment.paymentRequestId && installment.paymentRequestId !== request.id)))) {
    throw new Error("A despesa vinculada mudou ou não está disponível para pagamento.");
  }
  if (request.requestedSettlementAmount == null) return;
  const revision = request.settlementRevision;
  const attachment = message.attachments?.find((item) => item.id === revision?.sourceAttachmentId);
  if (!revision
    || revision.evidenceSource !== "manual_document_review"
    || revision.documentedFor !== params.today
    || revision.documentedFor !== request.barcodeSnapshot.scheduledFor
    || revision.documentedFor <= request.barcodeSnapshot.dueDate
    || revision.barcode !== request.barcodeSnapshot.code
    || revision.beneficiaryDocument !== request.barcodeSnapshot.beneficiaryDocument
    || revision.principalAmountCents !== principalAmountCents
    || revision.settlementAmountCents !== Math.round(request.requestedSettlementAmount * 100)
    || revision.lateChargeAmountCents !== Math.round(Number(request.requestedLateChargeAmount) * 100)
    || revision.settlementAmountCents !== revision.principalAmountCents + revision.lateChargeAmountCents
    || !attachment
    || attachment.archiveStatus !== "stored"
    || typeof attachment.storagePath !== "string"
    || !attachment.storagePath
    || attachment.sha256 !== revision.sourceAttachmentSha256) {
    throw new Error("A confirmação documental do valor atualizado mudou ou não está disponível.");
  }
}

export function planOverdueBarcodeSettlementRevision(params: {
  request: BankPaymentRequest;
  message: FinancialInboxMessageSnapshot;
  expense: FinancialInboxExpenseSnapshot;
  input: OverdueBarcodeSettlementRevisionInput;
  actor: { uid: string; email?: string | null };
  now: string;
  today: string;
}) {
  const { request, message, input } = params;
  assertFinancialInboxPaymentTarget({ request, message, expense: params.expense, today: params.today });
  const barcode = request.paymentRail === "barcode" ? request.barcodeSnapshot : null;
  const classification = message.classification;
  const storedBarcode = String(classification?.barcode ?? "").replace(/[.\s-]/g, "");
  const storedDocument = String(classification?.billingIdentity?.supplierTaxId ?? "").replace(/\D/g, "");
  const attachment = message.attachments?.find((item) => item.id === input.sourceAttachmentId);
  if (request.sourceType !== "financial_inbox"
    || request.paymentRail !== "barcode"
    || request.status !== "failed"
    || request.interRequestId
    || request.lastError?.code !== "INTER_HTTP_400"
    || paymentSubmissionAttemptCount(request) !== 2
    || Math.round(request.amount * 100) !== input.principalAmountCents
    || request.expenseId !== input.expenseId
    || message.linkedExpenseId !== input.expenseId
    || Number(classification?.amountCents) !== input.principalAmountCents
    || !barcode
    || barcode.code !== input.barcode
    || storedBarcode !== input.barcode
    || barcode.scheduledFor !== input.scheduledFor
    || barcode.beneficiaryDocument !== input.beneficiaryDocument
    || (storedDocument && storedDocument !== input.beneficiaryDocument)
    || input.scheduledFor !== params.today
    || input.scheduledFor <= barcode.dueDate
    || input.settlementAmountCents <= input.principalAmountCents
    || input.settlementAmountCents !== input.principalAmountCents + input.lateChargeAmountCents
    || !attachment
    || attachment.archiveStatus !== "stored"
    || typeof attachment.storagePath !== "string"
    || !attachment.storagePath
    || typeof attachment.sha256 !== "string"
    || !/^[a-f0-9]{64}$/i.test(attachment.sha256)
    || attachment.sha256.toLowerCase() !== input.sourceAttachmentSha256) {
    throw new Error("A revisão do boleto vencido diverge da solicitação, do documento ou do histórico bancário.");
  }
  return {
    status: "ready_to_submit" as const,
    requestedSettlementAmount: input.settlementAmountCents / 100,
    requestedLateChargeAmount: input.lateChargeAmountCents / 100,
    settlementRevision: {
      source: "confirmed_document" as const,
      evidenceSource: input.evidenceSource,
      sourceAttachmentId: input.sourceAttachmentId,
      sourceAttachmentSha256: attachment.sha256.toLowerCase(),
      barcode: input.barcode,
      beneficiaryDocument: input.beneficiaryDocument,
      principalAmountCents: input.principalAmountCents,
      settlementAmountCents: input.settlementAmountCents,
      lateChargeAmountCents: input.lateChargeAmountCents,
      documentedFor: input.scheduledFor,
      authorizedAt: params.now,
      authorizedBy: params.actor.uid,
      authorizedByEmail: params.actor.email ?? null,
    },
    authorizedAt: params.now,
    authorizedBy: params.actor.uid,
    lastError: null,
    updatedAt: params.now,
  };
}
