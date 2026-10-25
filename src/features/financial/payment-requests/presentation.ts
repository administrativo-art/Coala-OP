import type { BankPaymentRequest, BankPaymentRequestStatus } from "./types";
import { financialDaysUntil, formatFinancialDate, formatFinancialDateTime } from "./timeline";

export type StageGroup = "you" | "risk" | "bank" | "done";
export type PaymentRequestFilter = "unpaid" | "all" | StageGroup;
export const DEFAULT_PAYMENT_REQUEST_FILTER: PaymentRequestFilter = "unpaid";

const SETTLED_BANK_STATUSES = new Set([
  "PAGO", "EFETIVADO", "PROCESSADO", "CONCLUIDO", "LIQUIDADO", "REALIZADO",
]);

function normalizedBankStatus(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]/gi, "")
    .toUpperCase();
}

export function bankReportsPaymentSettled(item: BankPaymentRequest) {
  return SETTLED_BANK_STATUSES.has(normalizedBankStatus(item.bankStatus));
}

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
  const paidOrSettledAtBank = item.status === "paid" || bankReportsPaymentSettled(item);
  const explicitReview = ["divergent", "unavailable"].includes(item.beneficiaryVerificationStatus ?? "");
  const legacyReceiverDivergence = item.lastError?.code === "BANK_RECONCILIATION_DIVERGENCE"
    && item.bankReconciliationDivergenceField === "receiver";
  return paidOrSettledAtBank && (explicitReview || legacyReceiverDivergence);
}

export function stageGroup(item: BankPaymentRequest): StageGroup {
  return requiresBeneficiaryReview(item) ? "risk" : STATUS_GROUP[item.status];
}

export function matchesPaymentRequestFilter(item: BankPaymentRequest, filter: PaymentRequestFilter) {
  if (filter === "all") return true;
  if (filter === "unpaid") return item.status !== "paid" || requiresBeneficiaryReview(item);
  return stageGroup(item) === filter;
}

export function paymentRequestDisplayStatus(item: BankPaymentRequest) {
  if (requiresBeneficiaryReview(item)) {
    return item.beneficiaryVerificationStatus === "unavailable"
      ? "Pago · validação pendente"
      : "Pago · revisar favorecido";
  }
  if (item.status !== "paid" && bankReportsPaymentSettled(item)) {
    return "Pago no banco · aguardando extrato";
  }
  return null;
}

/** Actual payment date for settled requests, otherwise the requested/confirmed schedule. */
export function paymentSchedulePresentation(item: BankPaymentRequest, now = new Date()) {
  if (item.status === "paid") {
    const paidDateTime = formatFinancialDateTime(item.paidAt);
    const date = formatFinancialDate(item.paidAt)
      ?? (paidDateTime === "—" ? null : paidDateTime.split(" ")[0]);
    return {
      label: "Pago em",
      date,
      timing: date ? null : "Data não informada",
      dueDate: null,
    };
  }
  if (bankReportsPaymentSettled(item)) {
    const paidDateTime = formatFinancialDateTime(item.bankLiquidationObservedAt);
    const date = formatFinancialDate(item.bankLiquidationObservedAt)
      ?? (paidDateTime === "—" ? null : paidDateTime.split(" ")[0]);
    return {
      label: "Pago no banco",
      date,
      timing: "Aguardando conciliação no extrato",
      dueDate: null,
    };
  }
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
