import "server-only";

import type { CashClosureDepositPolicy } from "./types";
import { cashDepositPeriodPolicyDocumentId } from "./deposit-policy-command";

export const CASH_DEPOSIT_PERIOD_POLICIES = "cashDepositPeriodPolicies";

export const cashDepositPeriodPolicyId = cashDepositPeriodPolicyDocumentId;

export function cashDepositPolicyFromDocument(
  data: FirebaseFirestore.DocumentData | undefined,
  fallback: CashClosureDepositPolicy = "standard",
): CashClosureDepositPolicy {
  return data?.policy === "dre_only" ? "dre_only" : fallback;
}
