import type { BankPaymentRequest, BankPaymentRequestStatus } from "./types";
import { financialDaysUntil, formatFinancialDate } from "./timeline";

export type StageGroup = "you" | "risk" | "bank" | "done";
export type PaymentRequestFilter = "unpaid" | "all" | StageGroup;
export const DEFAULT_PAYMENT_REQUEST_FILTER: PaymentRequestFilter = "unpaid";

const STATUS_GROUP: Record<BankPaymentRequestStatus, StageGroup> = {
  draft: "you",
  awaiting_financial_authorization: "you",
  ready_to_submit: "you",
  submitting: "bank",
  awaiting_bank_approval: "bank",
  scheduled: "bank",
  processing: "bank",
  awaiting_statement: "bank",
  paid: "done",
  rejected: "risk",
  approval_expired: "risk",
  failed: "risk",
  cancelled: "risk",
};

export function requiresBeneficiaryReview(item: BankPaymentRequest) {
  return item.status === "paid" && item.beneficiaryVerificationStatus === "divergent";
}

export function stageGroup(item: BankPaymentRequest): StageGroup {
  return requiresBeneficiaryReview(item) ? "risk" : STATUS_GROUP[item.status];
}

export function matchesPaymentRequestFilter(item: BankPaymentRequest, filter: PaymentRequestFilter) {
  if (filter === "all") return true;
  if (filter === "unpaid") return item.status !== "paid";
  return stageGroup(item) === filter;
}

/** Requested payment date; bank confirmation remains a separate status. */
export function paymentSchedulePresentation(item: BankPaymentRequest, now = new Date()) {
  // Match the submission source for each rail; a boleto's due date is not its payment date.
  const requestedDate = item.paymentRail === "barcode"
    ? item.barcodeSnapshot?.scheduledFor
    : item.scheduledFor;
  const scheduledFor = item.status === "scheduled" && formatFinancialDate(item.bankScheduledFor)
    ? item.bankScheduledFor
    : requestedDate;
  const date = formatFinancialDate(scheduledFor);
  const days = financialDaysUntil(scheduledFor, now);
  const timing = date && days !== null
    ? days === 0 ? "Hoje" : days > 0 ? "Data futura" : "Data passada"
    : !scheduledFor && item.paymentRail !== "barcode" ? "Imediato no envio" : "Data não informada";

  return {
    label: item.status === "scheduled" ? "Agendado para" : "Pagamento previsto",
    date,
    timing,
    dueDate: item.paymentRail === "barcode" ? formatFinancialDate(item.barcodeSnapshot?.dueDate) : null,
  };
}
