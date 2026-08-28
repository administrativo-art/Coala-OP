import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import {
  assertCashClosureAccess,
  canUseCashClosure,
  cashClosureActor,
  cashClosureSeniorDivergenceCents,
} from "@/features/financial/cash-closures/access.server";
import { resolveOperatorAvatarUrls } from "@/features/financial/cash-closures/operator-avatars";
import {
  getCashClosure,
  saveCashClosureDraft,
} from "@/features/financial/cash-closures/repository.server";
import { saveCashClosureDraftSchema } from "@/features/financial/cash-closures/schemas";
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
    const usersSnapshot = await dbAdmin.collection("users")
      .select("username", "avatarUrl", "pdvOperatorIds", "registrationIdPdv")
      .get();
    const operatorAvatars = resolveOperatorAvatarUrls({
      kioskId: result.closure.kioskId,
      operators: Array.from(new Map(
        result.lines.map((line) => [line.operatorId, { id: line.operatorId, name: line.operatorName }]),
      ).values()),
      users: usersSnapshot.docs.map((document) => document.data()),
    });
    return NextResponse.json({
      ...result,
      operatorAvatars,
      settings: { seniorDivergenceCents: cashClosureSeniorDivergenceCents() },
    }, { headers: { "Cache-Control": "private, no-store" } });
});

function mapDraftError(cause: unknown): never {
  const message = cause instanceof Error ? cause.message : "";
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
      { editReported, editCounted },
    ).catch(mapDraftError));
});
