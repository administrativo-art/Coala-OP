import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import {
  assertCashClosureAccess,
  canUseCashClosure,
  cashClosureActor,
  cashClosureSeniorDivergenceCents,
} from "@/features/financial/cash-closures/access.server";
import { loadCashClosureOperatorAvatarUrls } from "@/features/financial/cash-closures/operator-avatars.server";
import {
  getCashClosure,
  saveCashClosureDraft,
} from "@/features/financial/cash-closures/repository.server";
import { saveCashClosureDraftSchema } from "@/features/financial/cash-closures/schemas";
import { getOpenCashCountingSessionForScope } from "@/features/financial/cash-counting-sessions/repository.server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ closureId: string }> };

async function loadAuthorized(request: NextRequest, routeContext: RouteContext, permission: "view" | "edit") {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "CASH_CLOSURE_AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  const { closureId } = await routeContext.params;
  const result = await getCashClosure(closureId);
  if (!result) throw new AppError({ code: "CASH_CLOSURE_NOT_FOUND", kind: "NOT_FOUND" });
  try {
    assertCashClosureAccess(context, permission, result.closure.kioskId);
  } catch (cause) {
    throw new AppError({ code: "CASH_CLOSURE_VIEW_FORBIDDEN", kind: "AUTHORIZATION", cause });
  }
  return { context, closureId, result };
}

export const GET = withApiErrorHandling<RouteContext>({
  source: "api-financial",
  operation: "get-cash-closure",
  routeOrJob: "/api/financial/cash-closures/[closureId]",
}, async (request: NextRequest, routeContext) => {
    const { result } = await loadAuthorized(request, routeContext, "view");
    const [operatorAvatars, activeCountingSession] = await Promise.all([
      loadCashClosureOperatorAvatarUrls({
        kioskId: result.closure.kioskId,
        operators: Array.from(new Map(
          result.lines.map((line) => [line.operatorId, { id: line.operatorId, name: line.operatorName }]),
        ).values()),
      }),
      getOpenCashCountingSessionForScope({
        workspaceId: result.closure.workspaceId,
        kioskId: result.closure.kioskId,
        year: result.closure.year,
        month: result.closure.month,
      }),
    ]);
    return NextResponse.json({
      ...result,
      operatorAvatars,
      activeCountingSessionId: activeCountingSession?.id ?? null,
      settings: { seniorDivergenceCents: cashClosureSeniorDivergenceCents() },
    }, { headers: { "Cache-Control": "private, no-store" } });
});

function mapDraftError(cause: unknown): never {
  const message = cause instanceof Error ? cause.message : "";
  if (message.includes("sessão") || message.includes("Sessão")) {
    throw new AppError({
      code: "CASH_CLOSURE_COUNTING_SESSION_REQUIRED",
      kind: "CONFLICT",
      safeMessage: "Abra esta unidade e competência por uma sessão de contagem para fazer a conferência do Financeiro.",
      cause,
    });
  }
  if (message.includes("não encontrado") || message.includes("não pertencem")) {
    throw new AppError({ code: "CASH_CLOSURE_LINE_NOT_FOUND", kind: "NOT_FOUND", cause });
  }
  if (message.includes("não finalizados")) {
    throw new AppError({ code: "CASH_CLOSURE_DRAFT_STATE_CONFLICT", kind: "CONFLICT", cause });
  }
  if (message.includes("sem autorização")) {
    throw new AppError({ code: "CASH_CLOSURE_DRAFT_FORBIDDEN", kind: "AUTHORIZATION", cause });
  }
  throw cause;
}

export const PATCH = withApiErrorHandling<RouteContext>({
  source: "api-financial",
  operation: "save-cash-closure-draft",
  routeOrJob: "/api/financial/cash-closures/[closureId]",
}, async (request: NextRequest, routeContext) => {
    const { context, closureId, result } = await loadAuthorized(request, routeContext, "view");
    const parsed = saveCashClosureDraftSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError({
        code: "CASH_CLOSURE_DRAFT_INVALID",
        kind: "VALIDATION",
        safeMessage: "Os valores informados para o fechamento são inválidos.",
        cause: parsed.error,
      });
    }
    const editReported = canUseCashClosure(context, "edit", result.closure.kioskId);
    const editCounted = canUseCashClosure(context, "approve", result.closure.kioskId);
    if (!editReported && !editCounted) {
      throw new AppError({ code: "CASH_CLOSURE_DRAFT_FORBIDDEN", kind: "AUTHORIZATION" });
    }
    return NextResponse.json(await saveCashClosureDraft(
      closureId,
      parsed.data.lines,
      cashClosureActor(context),
      {
        editReported,
        editCounted,
        requireCountingSessionForCountedChanges: true,
        countingSessionId: parsed.data.countingSessionId,
        canManageCountingSessionOfOthers:
          context.isDefaultAdmin || context.permissions.financial?.cashClosures?.reopen === true,
      },
    ).catch(mapDraftError));
});
