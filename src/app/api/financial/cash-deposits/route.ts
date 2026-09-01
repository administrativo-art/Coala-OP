import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth-server";
import { canAccessUnit } from "@/lib/unit-access";
import { assertCashDepositAccess } from "@/features/financial/cash-closures/access.server";
import {
  listCashCoinBalances,
  listCashDepositBatches,
  listPendingCashDepositAdjustments,
} from "@/features/financial/cash-deposits/repository.server";
import { listInterCobrancas } from "@/features/financial/cash-deposits/inter-service.server";
import { configuredInterCobrancaReadiness } from "@/features/financial/cash-deposits/payer.server";
import {
  getCashCountingSessionSummary,
  listCashCountingSessionsAwaitingPhysicalComposition,
} from "@/features/financial/cash-counting-sessions/repository.server";
import { canManageCashCountingSessionsOfOthers } from "@/features/financial/cash-counting-sessions/access.server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const focusSessionIdSchema = z.string().trim().min(1).max(160).regex(/^[^/]+$/);

export const GET = withApiErrorHandling({
  source: "api-financial",
  operation: "list-cash-deposits",
  routeOrJob: "/api/financial/cash-deposits",
}, async (request: NextRequest) => {
    const context = await requireUser(request).catch((cause) => {
      throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
    });
    const kioskId = request.nextUrl.searchParams.get("kioskId")?.trim() || undefined;
    const rawFocusSessionId = request.nextUrl.searchParams.get("sessionId")?.trim() || undefined;
    const parsedFocusSessionId = rawFocusSessionId
      ? focusSessionIdSchema.safeParse(rawFocusSessionId)
      : null;
    if (parsedFocusSessionId && !parsedFocusSessionId.success) {
      throw new AppError({
        code: "CASH_COUNTING_SESSION_FOCUS_INVALID",
        kind: "VALIDATION",
        safeMessage: "A sessão de contagem informada é inválida.",
        cause: parsedFocusSessionId.error,
      });
    }
    const focusSessionId = parsedFocusSessionId?.success ? parsedFocusSessionId.data : undefined;
    try {
      assertCashDepositAccess(context, "view", kioskId);
    } catch (cause) {
      throw new AppError({ code: "CASH_DEPOSIT_VIEW_FORBIDDEN", kind: "AUTHORIZATION", cause });
    }
    const canComposePhysical = context.isDefaultAdmin || (
      context.permissions.financial.view
      && context.permissions.financial.cashDeposits.view
      && context.permissions.financial.cashDeposits.issue
    );
    const canManageOthers = canManageCashCountingSessionsOfOthers(context);
    const [batches, adjustments, cobrancas, inter, coinBalances, countingSessionPage, focusSession] = await Promise.all([
      listCashDepositBatches({ workspaceId: context.workspace_id, kioskId }),
      listPendingCashDepositAdjustments(context.workspace_id),
      listInterCobrancas(context.workspace_id),
      configuredInterCobrancaReadiness(),
      listCashCoinBalances(context.workspace_id),
      canComposePhysical
        ? listCashCountingSessionsAwaitingPhysicalComposition(context.workspace_id, {
          ...(canManageOthers ? {} : { openedBy: context.decoded.uid }),
        })
        : Promise.resolve({ sessions: [], hasMore: false }),
      canComposePhysical && focusSessionId
        ? getCashCountingSessionSummary(focusSessionId)
        : Promise.resolve(null),
    ]);
    const visibleBatches = batches.filter((batch) => (batch.kioskIds?.length ? batch.kioskIds : [batch.kioskId])
      .every((unitId) => canAccessUnit(context.userDoc, unitId, { isDefaultAdmin: context.isDefaultAdmin })));
    const visibleBatchIds = new Set(visibleBatches.map((batch) => batch.id));
    const canSeeCountingSession = (session: NonNullable<typeof focusSession>) => (
      session.workspaceId === context.workspace_id
      && session.status === "counted"
      && (canManageOthers || session.openedBy === context.decoded.uid)
      && session.kioskIds.every((unitId) => canAccessUnit(
        context.userDoc,
        unitId,
        { isDefaultAdmin: context.isDefaultAdmin },
      ))
    );
    const visibleCountingSessions = countingSessionPage.sessions.filter(canSeeCountingSession);
    if (focusSession && canSeeCountingSession(focusSession) && !visibleCountingSessions.some((session) => session.id === focusSession.id)) {
      visibleCountingSessions.unshift(focusSession);
    }
    return NextResponse.json({
      batches: visibleBatches,
      adjustments: adjustments.filter((adjustment) =>
        (!kioskId || adjustment.kioskId === kioskId) &&
        canAccessUnit(context.userDoc, adjustment.kioskId, { isDefaultAdmin: context.isDefaultAdmin }),
      ),
      cobrancas: cobrancas.filter((cobranca) => visibleBatchIds.has(cobranca.batchId)),
      coinBalances: coinBalances.filter((balance) =>
        (!kioskId || balance.kioskId === kioskId) &&
        canAccessUnit(context.userDoc, balance.kioskId, { isDefaultAdmin: context.isDefaultAdmin }),
      ),
      countingSessions: visibleCountingSessions,
      countingSessionsHasMore: countingSessionPage.hasMore,
      inter,
    }, { headers: { "Cache-Control": "private, no-store" } });
});
