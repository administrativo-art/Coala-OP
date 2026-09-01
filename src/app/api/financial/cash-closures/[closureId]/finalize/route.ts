import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import {
  assertCashClosureAccess,
  assertCashClosureDivergenceApproval,
  cashClosureActor,
} from "@/features/financial/cash-closures/access.server";
import { finalizeCashClosureOperator, getCashClosure } from "@/features/financial/cash-closures/repository.server";
import { finalizeCashClosureOperatorSchema } from "@/features/financial/cash-closures/schemas";
import { AppError, withApiErrorHandling } from "@/lib/observability";

type RouteContext = { params: Promise<{ closureId: string }> };
const ROUTE = "/api/financial/cash-closures/[closureId]/finalize";

function throwFinalizationError(cause: unknown): never {
  const message = cause instanceof Error ? cause.message : "";
  if (message.includes("em uso por")) {
    throw new AppError({
      code: "CASH_COUNTING_SESSION_FORBIDDEN",
      kind: "AUTHORIZATION",
      safeMessage: "Esta sessão está sob responsabilidade de outra pessoa.",
      cause,
    });
  }
  if (message.includes("não encontrado")) {
    throw new AppError({ code: "CASH_CLOSURE_NOT_FOUND", kind: "NOT_FOUND", cause });
  }
  if (message.includes("já foi finalizada")) {
    throw new AppError({
      code: "CASH_CLOSURE_OPERATOR_ALREADY_FINALIZED",
      kind: "CONFLICT",
      safeMessage: "A contagem deste operador já foi finalizada.",
      cause,
    });
  }
  if (message.includes("sessão") || message.includes("Sessão")) {
    throw new AppError({
      code: "CASH_COUNTING_SESSION_CONFLICT",
      kind: "CONFLICT",
      safeMessage: "A sessão de contagem não permite finalizar este operador agora.",
      cause,
    });
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
}, async (request: NextRequest, routeContext) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "CASH_CLOSURE_AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  const { closureId } = await routeContext.params;
  const parsed = finalizeCashClosureOperatorSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    throw new AppError({
      code: "CASH_CLOSURE_OPERATOR_INVALID",
      kind: "VALIDATION",
      safeMessage: "Selecione um operador válido para finalizar.",
      cause: parsed.error,
    });
  }
  const current = await getCashClosure(closureId);
  if (!current) throw new AppError({ code: "CASH_CLOSURE_NOT_FOUND", kind: "NOT_FOUND" });
  try {
    assertCashClosureAccess(context, "approve", current.closure.kioskId);
  } catch (cause) {
    throw new AppError({ code: "CASH_CLOSURE_FINALIZE_FORBIDDEN", kind: "AUTHORIZATION", cause });
  }
  try {
    assertCashClosureDivergenceApproval(
      context,
      current.closure.kioskId,
      current.lines.filter((line) => line.operatorId === parsed.data.operatorId),
    );
  } catch (cause) {
    throw new AppError({
      code: "CASH_CLOSURE_SENIOR_FINALIZATION_REQUIRED",
      kind: "AUTHORIZATION",
      safeMessage: "Esta divergência exige um perfil sênior para finalizar a contagem.",
      cause,
    });
  }
  const actor = cashClosureActor(context);
  const finalized = await finalizeCashClosureOperator(
    closureId,
    parsed.data.operatorId,
    actor,
    {
      countingSessionId: parsed.data.countingSessionId,
      canManageSessionOfOthers: context.isDefaultAdmin || context.permissions.financial?.cashClosures?.reopen === true,
    },
  ).catch(throwFinalizationError);
  const closure = finalized.closure;
  return NextResponse.json({ closure, countingSessionId: parsed.data.countingSessionId });
});
