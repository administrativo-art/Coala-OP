import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { cashClosureActor } from "@/features/financial/cash-closures/access.server";
import {
  assertCashCountingSessionDepositAccess,
  canManageCashCountingSessionsOfOthers,
} from "@/features/financial/cash-counting-sessions/access.server";
import {
  exchangeCashCountingSessionCoins,
  getCashCountingSession,
} from "@/features/financial/cash-counting-sessions/repository.server";
import { confirmCashCountingDenominationsSchema } from "@/features/financial/cash-counting-sessions/schemas";
import { AppError, withApiErrorHandling } from "@/lib/observability";

type RouteContext = { params: Promise<{ sessionId: string }> };

export const POST = withApiErrorHandling<RouteContext>({
  source: "api-financial",
  operation: "exchange-cash-counting-session-coins",
  routeOrJob: "/api/financial/cash-counting-sessions/[sessionId]/coins/exchange",
}, async (request: NextRequest, routeContext) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  const parsed = confirmCashCountingDenominationsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw new AppError({ code: "CASH_COIN_EXCHANGE_INVALID", kind: "VALIDATION", cause: parsed.error });
  const { sessionId } = await routeContext.params;
  const current = await getCashCountingSession(sessionId);
  if (!current || current.session.workspaceId !== context.workspace_id) {
    throw new AppError({ code: "CASH_COUNTING_SESSION_NOT_FOUND", kind: "NOT_FOUND" });
  }
  try {
    assertCashCountingSessionDepositAccess(context, current.session);
  } catch (cause) {
    throw new AppError({ code: "CASH_COIN_EXCHANGE_FORBIDDEN", kind: "AUTHORIZATION", cause });
  }
  const result = await exchangeCashCountingSessionCoins({
    workspaceId: context.workspace_id,
    sessionId,
    entries: parsed.data.denominations,
    actor: cashClosureActor(context),
    canManageOthers: canManageCashCountingSessionsOfOthers(context),
  }).catch((cause) => {
    throw new AppError({
      code: "CASH_COIN_EXCHANGE_CONFLICT",
      kind: "CONFLICT",
      safeMessage: "A troca deve conter somente cédulas e não pode ultrapassar o saldo de moedas da sessão.",
      cause,
    });
  });
  return NextResponse.json(result);
});
