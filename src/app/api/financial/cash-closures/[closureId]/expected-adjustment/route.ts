import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import {
  assertCashClosureAccess,
  cashClosureActor,
} from "@/features/financial/cash-closures/access.server";
import {
  adjustCashClosureExpected,
  getCashClosure,
  restoreCashClosureExpected,
} from "@/features/financial/cash-closures/repository.server";
import {
  cashClosureExpectedAdjustmentSchema,
  restoreCashClosureExpectedSchema,
} from "@/features/financial/cash-closures/schemas";
import { AppError, withApiErrorHandling } from "@/lib/observability";

type RouteContext = { params: Promise<{ closureId: string }> };
const ROUTE = "/api/financial/cash-closures/[closureId]/expected-adjustment";

function mapExpectedAdjustmentError(cause: unknown): never {
  const message = cause instanceof Error ? cause.message : "";
  if (message.includes("não encontrado")) {
    throw new AppError({ code: "CASH_CLOSURE_EXPECTED_LINE_NOT_FOUND", kind: "NOT_FOUND", cause });
  }
  if (message.includes("ainda não finalizado")) {
    throw new AppError({ code: "CASH_CLOSURE_EXPECTED_ADJUSTMENT_STATE_CONFLICT", kind: "CONFLICT", cause });
  }
  if (
    message.includes("inválido") ||
    message.includes("motivo") ||
    message.includes("diferente") ||
    message.includes("não possui ajuste")
  ) {
    throw new AppError({
      code: "CASH_CLOSURE_EXPECTED_ADJUSTMENT_INVALID",
      kind: "VALIDATION",
      safeMessage: "O ajuste informado não é válido para esta linha.",
      cause,
    });
  }
  throw cause;
}

async function authorizedContext(request: NextRequest, routeContext: RouteContext) {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "CASH_CLOSURE_AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  const { closureId } = await routeContext.params;
  const current = await getCashClosure(closureId);
  if (!current) throw new AppError({ code: "CASH_CLOSURE_NOT_FOUND", kind: "NOT_FOUND" });
  try {
    assertCashClosureAccess(context, "adjustExpected", current.closure.kioskId);
  } catch (cause) {
    throw new AppError({ code: "CASH_CLOSURE_EXPECTED_ADJUSTMENT_FORBIDDEN", kind: "AUTHORIZATION", cause });
  }
  return { context, closureId };
}

export const POST = withApiErrorHandling<RouteContext>({
  source: "api",
  operation: "adjust-cash-closure-expected",
  routeOrJob: ROUTE,
}, async (request: NextRequest, routeContext) => {
  const { context, closureId } = await authorizedContext(request, routeContext);
  const parsed = cashClosureExpectedAdjustmentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    throw new AppError({
      code: "CASH_CLOSURE_EXPECTED_ADJUSTMENT_INVALID",
      kind: "VALIDATION",
      safeMessage: "Informe um valor esperado e uma justificativa válidos.",
      cause: parsed.error,
    });
  }
  const result = await adjustCashClosureExpected(
    closureId,
    parsed.data,
    cashClosureActor(context),
  ).catch(mapExpectedAdjustmentError);
  return NextResponse.json(result);
});

export const DELETE = withApiErrorHandling<RouteContext>({
  source: "api",
  operation: "restore-cash-closure-expected",
  routeOrJob: ROUTE,
}, async (request: NextRequest, routeContext) => {
  const { context, closureId } = await authorizedContext(request, routeContext);
  const parsed = restoreCashClosureExpectedSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    throw new AppError({
      code: "CASH_CLOSURE_EXPECTED_RESTORE_INVALID",
      kind: "VALIDATION",
      safeMessage: "Informe uma justificativa válida para restaurar o cálculo.",
      cause: parsed.error,
    });
  }
  const result = await restoreCashClosureExpected(
    closureId,
    parsed.data,
    cashClosureActor(context),
  ).catch(mapExpectedAdjustmentError);
  return NextResponse.json(result);
});
