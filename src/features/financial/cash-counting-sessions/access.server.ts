import "server-only";

import type { ServerUserContext } from "@/lib/auth-server";
import {
  assertCashClosureAccess,
  assertCashDepositAccess,
  canUseCashClosure,
} from "@/features/financial/cash-closures/access.server";
import type { CashCountingSession } from "./types";

export function canViewCashCountingSession(context: ServerUserContext, session: CashCountingSession) {
  return session.kioskIds.every((kioskId) => canUseCashClosure(context, "view", kioskId));
}

export function assertCashCountingSessionClosureAccess(
  context: ServerUserContext,
  permission: "view" | "approve",
  session: Pick<CashCountingSession, "kioskIds">,
) {
  for (const kioskId of session.kioskIds) assertCashClosureAccess(context, permission, kioskId);
}

export function assertCashCountingSessionDepositAccess(
  context: ServerUserContext,
  session: Pick<CashCountingSession, "kioskIds">,
) {
  for (const kioskId of session.kioskIds) assertCashDepositAccess(context, "issue", kioskId);
}

export function canManageCashCountingSessionsOfOthers(context: ServerUserContext) {
  return context.isDefaultAdmin || context.permissions.financial?.cashClosures?.reopen === true;
}
