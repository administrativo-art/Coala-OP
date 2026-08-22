import type {
  FinancialObligationCalculationInput,
  FinancialObligationSummary,
  ObligationPaymentAllocation,
  ObligationPaymentAdjustment,
} from "./types";

function integerCents(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed));
}

export function moneyToCents(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100);
}

export function centsToMoney(value: unknown) {
  return integerCents(value) / 100;
}

function appliesToSettlement(allocation: ObligationPaymentAllocation) {
  return allocation.status === "REPORTED" || allocation.status === "MATCHED";
}

function activeAdjustment(adjustment: ObligationPaymentAdjustment) {
  return adjustment.status !== "VOIDED";
}

function sum<T>(items: T[], amount: (item: T) => number) {
  return items.reduce((total, item) => total + integerCents(amount(item)), 0);
}

export function calculateFinancialObligationSummary(
  input: FinancialObligationCalculationInput,
): FinancialObligationSummary {
  const forecastAmountCents = input.forecastAmountCents == null
    ? null
    : integerCents(input.forecastAmountCents);
  const actualAmountCents = input.actualAmountCents == null
    ? null
    : integerCents(input.actualAmountCents);
  const settlementAmountCents = input.settlementAmountCents == null
    ? actualAmountCents
    : integerCents(input.settlementAmountCents);
  const allocations = (input.paymentAllocations || []).filter(appliesToSettlement);
  const adjustments = (input.adjustments || []).filter(activeAdjustment);
  const matchedAllocations = allocations.filter((allocation) => allocation.status === "MATCHED");
  const reportedAllocations = allocations.filter((allocation) => allocation.status === "REPORTED");

  const principalSettledAmountCents = sum(allocations, (allocation) => allocation.principalAmountCents);
  const confirmedPrincipalAmountCents = sum(matchedAllocations, (allocation) => allocation.principalAmountCents);
  const reportedCashAmountCents = sum(reportedAllocations, (allocation) => allocation.cashAmountCents);
  const confirmedCashAmountCents = sum(matchedAllocations, (allocation) => allocation.cashAmountCents);
  const cashPaidAmountCents = reportedCashAmountCents + confirmedCashAmountCents;
  const settlementCreditsAmountCents = sum(
    adjustments.filter((adjustment) => adjustment.effect === "SETTLEMENT_CREDIT"),
    (adjustment) => adjustment.amountCents,
  );
  const cashChargesAmountCents = sum(
    adjustments.filter((adjustment) => adjustment.effect === "CASH_CHARGE"),
    (adjustment) => adjustment.amountCents,
  );
  const cashReductionsAmountCents = sum(
    adjustments.filter((adjustment) => adjustment.effect === "CASH_REDUCTION"),
    (adjustment) => adjustment.amountCents,
  );
  const expectedCashAmountCents = Math.max(
    0,
    principalSettledAmountCents + cashChargesAmountCents - cashReductionsAmountCents,
  );
  const unclassifiedDifferenceAmountCents = cashPaidAmountCents - expectedCashAmountCents;
  const balanceAmountCents = settlementAmountCents == null
    ? null
    : Math.max(
        0,
        settlementAmountCents - principalSettledAmountCents - settlementCreditsAmountCents,
      );

  const obligationStatus = input.cancelled
    ? "CANCELLED" as const
    : actualAmountCents == null
      ? "OPEN" as const
    : balanceAmountCents === 0 && actualAmountCents != null
      ? "PAID" as const
      : principalSettledAmountCents + settlementCreditsAmountCents > 0
        ? "PARTIALLY_PAID" as const
        : "OPEN" as const;

  const reconciliationStatus = confirmedCashAmountCents === 0
    ? "NOT_FOUND" as const
    : actualAmountCents == null
      ? "PENDING_DOCUMENT" as const
      : Math.abs(unclassifiedDifferenceAmountCents) <= 1
        ? "MATCHED" as const
        : "DIVERGENT" as const;

  const paymentEvidenceStatus = confirmedCashAmountCents > 0 && reportedCashAmountCents > 0
    ? "MIXED" as const
    : confirmedCashAmountCents > 0
      ? "CONFIRMED" as const
      : reportedCashAmountCents > 0
        ? "REPORTED" as const
        : "NONE" as const;

  return {
    forecastAmountCents,
    actualAmountCents,
    settlementAmountCents,
    reportedCashAmountCents,
    confirmedCashAmountCents,
    cashPaidAmountCents,
    principalSettledAmountCents,
    confirmedPrincipalAmountCents,
    settlementCreditsAmountCents,
    cashChargesAmountCents,
    cashReductionsAmountCents,
    unclassifiedDifferenceAmountCents,
    balanceAmountCents,
    obligationStatus,
    reconciliationStatus,
    paymentEvidenceStatus,
  };
}

export function obligationVarianceAmountCents(summary: FinancialObligationSummary) {
  if (summary.forecastAmountCents == null || summary.actualAmountCents == null) return null;
  return summary.actualAmountCents - summary.forecastAmountCents;
}
