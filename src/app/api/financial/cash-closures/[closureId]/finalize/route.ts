import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import {
  assertCashClosureAccess,
  assertCashClosureDivergenceApproval,
  cashClosureActor,
} from "@/features/financial/cash-closures/access.server";
import { finalizeCashClosure, getCashClosure } from "@/features/financial/cash-closures/repository.server";
import {
  finalizeCashDepositAdjustmentForClosure,
  processCashDepositQueue,
} from "@/features/financial/cash-deposits/repository.server";
import { AppError, reportSystemError, withApiErrorHandling } from "@/lib/observability";

type RouteContext = { params: Promise<{ closureId: string }> };
const ROUTE = "/api/financial/cash-closures/[closureId]/finalize";

function throwFinalizationError(cause: unknown): never {
  const message = cause instanceof Error ? cause.message : "";
  if (message.includes("não encontrado")) {
    throw new AppError({ code: "CASH_CLOSURE_NOT_FOUND", kind: "NOT_FOUND", cause });
  }
  if (message.includes("Preencha as contagens")) {
    throw new AppError({
      code: "CASH_CLOSURE_COUNT_INCOMPLETE",
      kind: "VALIDATION",
      safeMessage: "Preencha as contagens do Caixa e do Financeiro antes de finalizar.",
      cause,
    });
  }
  if (message.includes("Toda falta")) {
    throw new AppError({
      code: "CASH_CLOSURE_DIVERGENCE_NOTE_REQUIRED",
      kind: "VALIDATION",
      safeMessage: "Informe as justificativas das faltas do Caixa e do Financeiro antes de finalizar.",
      cause,
    });
  }
  if (message.includes("não pode avançar")) {
    throw new AppError({ code: "CASH_CLOSURE_STATE_CONFLICT", kind: "CONFLICT", cause });
  }
  throw cause;
}

export const POST = withApiErrorHandling<RouteContext>({
  source: "api",
  operation: "finalize-cash-closure-count",
  routeOrJob: ROUTE,
}, async (request: NextRequest, routeContext, observation) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "CASH_CLOSURE_AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  const { closureId } = await routeContext.params;
  const current = await getCashClosure(closureId);
  if (!current) throw new AppError({ code: "CASH_CLOSURE_NOT_FOUND", kind: "NOT_FOUND" });
  try {
    assertCashClosureAccess(context, "approve", current.closure.kioskId);
  } catch (cause) {
    throw new AppError({ code: "CASH_CLOSURE_FINALIZE_FORBIDDEN", kind: "AUTHORIZATION", cause });
  }
  try {
    assertCashClosureDivergenceApproval(context, current.closure.kioskId, current.lines);
  } catch (cause) {
    throw new AppError({
      code: "CASH_CLOSURE_SENIOR_FINALIZATION_REQUIRED",
      kind: "AUTHORIZATION",
      safeMessage: "Esta divergência exige um perfil sênior para finalizar a contagem.",
      cause,
    });
  }
  const actor = cashClosureActor(context);
  const closure = await finalizeCashClosure(closureId, actor).catch(throwFinalizationError);
  let allocationError: string | null = null;
  try {
    await finalizeCashDepositAdjustmentForClosure(closureId);
    await processCashDepositQueue(context.workspace_id, closure.kioskId, actor);
  } catch (error) {
    reportSystemError({
      error,
      source: "api",
      operation: "allocate-finalized-cash-closure",
      routeOrJob: ROUTE,
      requestId: observation.requestId,
      correlationId: observation.correlationId,
      metadata: { closureId, kioskId: closure.kioskId },
    });
    allocationError = "A alocação não foi concluída. O fechamento permanece finalizado para nova tentativa.";
  }
  return NextResponse.json({ closure, allocationError });
});
