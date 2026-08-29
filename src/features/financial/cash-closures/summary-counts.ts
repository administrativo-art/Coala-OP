import type { CashClosureStatus } from "./types";

type CashClosureSummaryCountSource = {
  status: CashClosureStatus;
  finalizedOperatorCount: number;
  approvedWithDivergence: boolean;
  syncError: string | null;
};

export function cashClosureSummaryCounts(closures: CashClosureSummaryCountSource[]) {
  return {
    closureCount: closures.length,
    pendingCount: closures.filter((closure) => ["draft", "reopened"].includes(closure.status)).length,
    partialCount: closures.filter((closure) => closure.status === "pending_review").length,
    divergentCount: closures.filter((closure) => closure.finalizedOperatorCount > 0 && closure.approvedWithDivergence).length,
    approvedCount: closures.filter((closure) => closure.status === "approved").length,
    syncErrorCount: closures.filter((closure) => closure.status === "sync_error" || !!closure.syncError).length,
  };
}

export function cashClosureDreRevenueCents(closures: Array<{
  expectedTotalCents: number;
  finalizedDifferenceTotalCents: number;
}>) {
  return closures.reduce(
    (total, closure) => total + closure.expectedTotalCents + closure.finalizedDifferenceTotalCents,
    0,
  );
}
