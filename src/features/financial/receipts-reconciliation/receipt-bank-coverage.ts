export type BankStatementCoverage = {
  status: "complete" | "partial" | "unknown";
  requiredThrough: string;
  syncedThrough: string | null;
  syncedAt: string | null;
};

type StatementSyncState = {
  accountId?: unknown;
  lastRangeEnd?: unknown;
  lastSuccessfulSyncAt?: unknown;
};

function civilDate(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function timestampIso(value: unknown) {
  if (value && typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function") {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  return null;
}

/**
 * The Inter sync state is global to the account. It is a coverage marker, not
 * evidence of an individual credit: only imported transaction records can
 * prove that a Stone settlement reached the bank.
 */
export function resolveBankStatementCoverage(input: {
  accountId: string;
  requiredThrough: string;
  state: StatementSyncState | null;
}): BankStatementCoverage {
  const state = input.state;
  const syncedThrough = civilDate(state?.lastRangeEnd);
  const syncedAt = timestampIso(state?.lastSuccessfulSyncAt);
  if (!state || state.accountId !== input.accountId || !syncedThrough) {
    return { status: "unknown", requiredThrough: input.requiredThrough, syncedThrough: null, syncedAt: null };
  }
  return {
    status: syncedThrough >= input.requiredThrough ? "complete" : "partial",
    requiredThrough: input.requiredThrough,
    syncedThrough,
    syncedAt,
  };
}
