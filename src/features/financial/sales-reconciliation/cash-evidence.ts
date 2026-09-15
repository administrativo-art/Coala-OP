export type CashClosureEvidenceSource = {
  closureCount?: number;
  pendingCount?: number;
  partialCount?: number;
  divergentCount?: number;
  approvedCount?: number;
  syncErrorCount?: number;
  expectedCashCents?: number;
  countedCashCents?: number;
  differenceTotalCents?: number;
  supplyTotalCents?: number;
  withdrawalTotalCents?: number;
  allocatedCashCents?: number;
  issuedCashCents?: number;
  paidCashCents?: number;
  closureIds?: string[];
  depositBatchIds?: string[];
  lastSyncedAt?: string | null;
};

export type SalesReconciliationCashEvidence = {
  status: "missing" | "incomplete" | "ready";
  expectedDayCount: number;
  closureCount: number;
  approvedCount: number;
  pendingCount: number;
  partialCount: number;
  divergentCount: number;
  syncErrorCount: number;
  coveragePercent: number;
  expectedCashCents: number;
  countedCashCents: number;
  differenceTotalCents: number;
  supplyTotalCents: number;
  withdrawalTotalCents: number;
  allocatedCashCents: number;
  issuedCashCents: number;
  paidCashCents: number;
  closureIds: string[];
  depositBatchIds: string[];
  lastSyncedAt: string | null;
};

function integer(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : 0;
}

export function buildSalesReconciliationCashEvidence(input: {
  year: number;
  month: number;
  summary?: CashClosureEvidenceSource | null;
}): SalesReconciliationCashEvidence {
  const expectedDayCount = new Date(Date.UTC(input.year, input.month, 0)).getUTCDate();
  const summary = input.summary;
  const closureCount = integer(summary?.closureCount);
  const approvedCount = integer(summary?.approvedCount);
  const pendingCount = integer(summary?.pendingCount);
  const partialCount = integer(summary?.partialCount);
  const syncErrorCount = integer(summary?.syncErrorCount);
  const ready = Boolean(summary)
    && closureCount === expectedDayCount
    && approvedCount === expectedDayCount
    && pendingCount === 0
    && partialCount === 0
    && syncErrorCount === 0;
  return {
    status: !summary ? "missing" : ready ? "ready" : "incomplete",
    expectedDayCount,
    closureCount,
    approvedCount,
    pendingCount,
    partialCount,
    divergentCount: integer(summary?.divergentCount),
    syncErrorCount,
    coveragePercent: Math.round((Math.min(closureCount, expectedDayCount) / expectedDayCount) * 10_000) / 100,
    expectedCashCents: integer(summary?.expectedCashCents),
    countedCashCents: integer(summary?.countedCashCents),
    differenceTotalCents: integer(summary?.differenceTotalCents),
    supplyTotalCents: integer(summary?.supplyTotalCents),
    withdrawalTotalCents: integer(summary?.withdrawalTotalCents),
    allocatedCashCents: integer(summary?.allocatedCashCents),
    issuedCashCents: integer(summary?.issuedCashCents),
    paidCashCents: integer(summary?.paidCashCents),
    closureIds: [...new Set(summary?.closureIds ?? [])].sort(),
    depositBatchIds: [...new Set(summary?.depositBatchIds ?? [])].sort(),
    lastSyncedAt: summary?.lastSyncedAt ?? null,
  };
}
