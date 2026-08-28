import "server-only";

import type { ServerUserContext } from "@/lib/auth-server";
import { canAccessUnit } from "@/lib/unit-access";
import type { CashClosureLine } from "./types";

export type CashClosurePermission = "view" | "edit" | "reopen" | "resync";

export function canUseCashClosure(
  context: ServerUserContext,
  permission: CashClosurePermission,
  kioskId?: string | null,
) {
  if (context.isDefaultAdmin) return true;
  if (!context.permissions.financial?.view || !context.permissions.financial.cashClosures?.[permission]) return false;
  if (!kioskId) return true;
  return canAccessUnit(context.userDoc, kioskId, { isDefaultAdmin: context.isDefaultAdmin });
}

export function assertCashClosureAccess(
  context: ServerUserContext,
  permission: CashClosurePermission,
  kioskId?: string | null,
) {
  if (!canUseCashClosure(context, permission, kioskId)) {
    throw new Error("Sem permissão para esta ação de fechamento de caixa.");
  }
}

export function cashClosureSeniorDivergenceCents() {
  const raw = Number(process.env.CASH_CLOSURE_SENIOR_DIVERGENCE_CENTS ?? 1_000);
  return Number.isSafeInteger(raw) && raw >= 0 ? raw : 1_000;
}

export function assertCashClosureDivergenceApproval(
  context: ServerUserContext,
  kioskId: string,
  lines: CashClosureLine[],
) {
  const thresholdCents = cashClosureSeniorDivergenceCents();
  const maximumDifferenceCents = lines.reduce(
    (maximum, line) => Math.max(
      maximum,
      Math.abs(line.differenceCents ?? 0),
      Math.abs(line.reportedDifferenceCents ?? 0),
    ),
    0,
  );
  if (
    maximumDifferenceCents > thresholdCents &&
    !canUseCashClosure(context, "reopen", kioskId)
  ) {
    throw new Error(
      `Divergência acima de ${thresholdCents} centavos exige perfil sênior com permissão de reabertura.`,
    );
  }
}

export function cashClosureActor(context: ServerUserContext) {
  return {
    userId: context.decoded.uid,
    userName:
      (typeof context.userDoc.username === "string" && context.userDoc.username.trim()) ||
      context.decoded.email ||
      "Usuário",
  };
}

export type CashDepositPermission = "view" | "issue" | "cancel" | "adjust";

export function assertCashDepositAccess(
  context: ServerUserContext,
  permission: CashDepositPermission,
  kioskId?: string | null,
) {
  const allowed = context.isDefaultAdmin || (
    context.permissions.financial?.view &&
    context.permissions.financial.cashDeposits?.[permission] &&
    (!kioskId || canAccessUnit(context.userDoc, kioskId, { isDefaultAdmin: context.isDefaultAdmin }))
  );
  if (!allowed) throw new Error("Sem permissão para esta ação de depósito em dinheiro.");
}
