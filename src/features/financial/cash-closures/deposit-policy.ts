import "server-only";

import type { CashClosureDepositPolicy } from "./types";

export const CASH_DEPOSIT_PERIOD_POLICIES = "cashDepositPeriodPolicies";

export function cashDepositPeriodPolicyId(workspaceId: string, year: number, month: number) {
  return `${workspaceId}_${year}_${String(month).padStart(2, "0")}`;
}

export function cashDepositPolicyFromDocument(
  data: FirebaseFirestore.DocumentData | undefined,
  fallback: CashClosureDepositPolicy = "standard",
): CashClosureDepositPolicy {
  return data?.policy === "dre_only" ? "dre_only" : fallback;
}
