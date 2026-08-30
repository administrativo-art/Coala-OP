import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { assertCashDepositAccess, cashClosureActor } from "@/features/financial/cash-closures/access.server";
import { getCashClosure } from "@/features/financial/cash-closures/repository.server";
import { manualCashDepositSplitSchema } from "@/features/financial/cash-closures/schemas";
import { splitOversizedCashClosure } from "@/features/financial/cash-deposits/repository.server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

type RouteContext = { params: Promise<{ closureId: string }> };

export const POST = withApiErrorHandling<RouteContext>({
  source: "api-financial",
  operation: "split-cash-closure-operator-deposit",
  routeOrJob: "/api/financial/cash-closures/[closureId]/split-deposit",
}, async (request: NextRequest, routeContext) => {
    const context = await requireUser(request).catch((cause) => {
      throw new AppError({ code: "CASH_DEPOSIT_AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
    });
    const { closureId } = await routeContext.params;
    const current = await getCashClosure(closureId);
    if (!current) throw new AppError({ code: "CASH_CLOSURE_NOT_FOUND", kind: "NOT_FOUND" });
    try {
      assertCashDepositAccess(context, "adjust", current.closure.kioskId);
    } catch (cause) {
      throw new AppError({ code: "CASH_DEPOSIT_SPLIT_FORBIDDEN", kind: "AUTHORIZATION", cause });
    }
    const parsed = manualCashDepositSplitSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError({
        code: "CASH_DEPOSIT_SPLIT_INVALID",
        kind: "VALIDATION",
        safeMessage: "Informe uma divisão válida para o depósito do operador.",
        cause: parsed.error,
      });
    }
    const { operatorId, partsCents } = parsed.data;
    const result = await splitOversizedCashClosure({
      workspaceId: context.workspace_id,
      closureId,
      operatorId,
      partsCents,
      actor: cashClosureActor(context),
    }).catch((cause) => {
      const message = cause instanceof Error ? cause.message : "";
      if (message.includes("não encontrado")) {
        throw new AppError({ code: "CASH_DEPOSIT_SPLIT_NOT_FOUND", kind: "NOT_FOUND", cause });
      }
      if (message.includes("aguardando divisão")) {
        throw new AppError({ code: "CASH_DEPOSIT_SPLIT_STATE_CONFLICT", kind: "CONFLICT", cause });
      }
      if (message.includes("Divisão manual") || message.includes("soma das partes")) {
        throw new AppError({
          code: "CASH_DEPOSIT_SPLIT_INVALID",
          kind: "VALIDATION",
          safeMessage: "A divisão deve corresponder ao dinheiro elegível do operador, em partes de até R$ 5.000,00.",
          cause,
        });
      }
      throw cause;
    });
    return NextResponse.json(result);
});
