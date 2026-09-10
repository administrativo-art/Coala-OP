import type { BankPaymentRequestStatus } from "./types";

type CurrentBankObservation = {
  status: BankPaymentRequestStatus;
  bankStatus?: string | null;
  bankApprovalObservedAt?: string | null;
  bankSchedulingObservedAt?: string | null;
  bankLiquidationObservedAt?: string | null;
  nextBankStatusCheckAt?: string | null;
};

type BankObservationInput = {
  current: CurrentBankObservation;
  nextStatus: BankPaymentRequestStatus;
  rawBankStatus?: string | null;
  observedAt: string;
  scheduledFor?: string | null;
};

const APPROVED_STATUSES = new Set<BankPaymentRequestStatus>([
  "scheduled",
  "awaiting_statement",
  "paid",
]);

const PERIODICALLY_POLLED_STATUSES = new Set<BankPaymentRequestStatus>([
  "awaiting_bank_approval",
  "scheduled",
  "processing",
]);

const BANK_POLL_INTERVAL_MS = 5 * 60_000;

const LIQUIDATED_STATUSES = new Set<BankPaymentRequestStatus>([
  "awaiting_statement",
  "paid",
]);

function futureScheduledCheck(scheduledFor: string | null | undefined, observedAt: string) {
  if (!scheduledFor || !/^\d{4}-\d{2}-\d{2}$/.test(scheduledFor)) return null;
  const todayInBelem = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Belem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(observedAt));
  if (scheduledFor <= todayInBelem) return null;
  return new Date(`${scheduledFor}T06:00:00-03:00`).toISOString();
}

function nextStatusCheckAt(input: BankObservationInput) {
  if (!PERIODICALLY_POLLED_STATUSES.has(input.nextStatus)) return null;
  if (input.nextStatus === "scheduled") {
    const scheduledCheck = futureScheduledCheck(input.scheduledFor, input.observedAt);
    if (scheduledCheck) return scheduledCheck;
  }
  const observed = new Date(input.observedAt);
  return Number.isNaN(observed.getTime())
    ? null
    : new Date(observed.getTime() + BANK_POLL_INTERVAL_MS).toISOString();
}

function changedValue(
  patch: Record<string, string | null>,
  field: string,
  current: string | null | undefined,
  desired: string | null,
) {
  if ((current ?? null) !== desired) patch[field] = desired;
}

/**
 * Deriva somente os metadados que realmente mudaram numa consulta ao banco.
 * Isso impede que o job periódico grave um evento idêntico a cada cinco minutos.
 */
export function planBankStatusObservation(input: BankObservationInput) {
  const patch: Record<string, string | null> = {};
  const rawBankStatus = input.rawBankStatus?.trim() || null;
  changedValue(patch, "bankStatus", input.current.bankStatus, rawBankStatus);

  const approvalObserved = APPROVED_STATUSES.has(input.nextStatus)
    && !input.current.bankApprovalObservedAt;
  const schedulingObserved = input.nextStatus === "scheduled"
    && !input.current.bankSchedulingObservedAt;
  const liquidationObserved = LIQUIDATED_STATUSES.has(input.nextStatus)
    && !input.current.bankLiquidationObservedAt;

  if (approvalObserved) patch.bankApprovalObservedAt = input.observedAt;
  if (schedulingObserved) patch.bankSchedulingObservedAt = input.observedAt;
  if (liquidationObserved) patch.bankLiquidationObservedAt = input.observedAt;

  const nextCheckAt = nextStatusCheckAt(input);
  changedValue(
    patch,
    "nextBankStatusCheckAt",
    input.current.nextBankStatusCheckAt,
    nextCheckAt,
  );

  const statusChanged = input.current.status !== input.nextStatus;
  const bankStatusChanged = Object.hasOwn(patch, "bankStatus");
  const observationChanged = approvalObserved || schedulingObserved || liquidationObserved;

  return {
    patch,
    changed: statusChanged || Object.keys(patch).length > 0,
    statusChanged,
    bankStatusChanged,
    approvalObserved,
    schedulingObserved,
    liquidationObserved,
    shouldWriteAuditEvent: statusChanged || bankStatusChanged || observationChanged,
  };
}

export function bankStatusRefreshIsDue(
  nextBankStatusCheckAt: unknown,
  now = new Date(),
) {
  if (typeof nextBankStatusCheckAt !== "string" || !nextBankStatusCheckAt.trim()) return true;
  const next = new Date(nextBankStatusCheckAt);
  return Number.isNaN(next.getTime()) || next.getTime() <= now.getTime();
}

export function paymentSubmissionRequiresManualReconciliation(input: {
  statementReconciliationStatus?: string | null;
  lastError?: { code?: string | null } | null;
}) {
  return input.statementReconciliationStatus === "divergent"
    || input.lastError?.code === "BANK_RECONCILIATION_DIVERGENCE";
}
