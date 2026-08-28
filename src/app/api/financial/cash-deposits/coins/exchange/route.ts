import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import {
  assertCashDepositAccess,
  cashClosureActor,
} from "@/features/financial/cash-closures/access.server";
import { registerCashCoinExchange } from "@/features/financial/cash-deposits/repository.server";
import { registerCashCoinExchangeSchema } from "@/features/financial/cash-deposits/schemas";
import { AppError, withApiErrorHandling } from "@/lib/observability";

function mapCoinExchangeError(cause: unknown): never {
  const message = cause instanceof Error ? cause.message : "";
  if (message.includes("não encontrado")) {
    throw new AppError({ code: "CASH_COIN_BALANCE_NOT_FOUND", kind: "NOT_FOUND", cause });
  }
  if (message.includes("ultrapassa") || message.includes("chave idempotente")) {
    throw new AppError({
      code: "CASH_COIN_EXCHANGE_BALANCE_CONFLICT",
      kind: "CONFLICT",
      safeMessage: message,
      cause,
    });
  }
  if (message.includes("inválido")) {
    throw new AppError({
      code: "CASH_COIN_EXCHANGE_VALUE_INVALID",
      kind: "VALIDATION",
      safeMessage: message,
      cause,
    });
  }
  throw cause;
}

export const POST = withApiErrorHandling({
  source: "api-financial",
  operation: "register-cash-coin-exchange",
  routeOrJob: "/api/financial/cash-deposits/coins/exchange",
}, async (request: NextRequest) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  const parsed = registerCashCoinExchangeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    throw new AppError({
      code: "CASH_COIN_EXCHANGE_VALUE_INVALID",
      kind: "VALIDATION",
      safeMessage: "Informe um quiosque e um valor de troca válidos.",
      cause: parsed.error,
    });
  }
  try {
    assertCashDepositAccess(context, "adjust", parsed.data.kioskId);
  } catch (cause) {
    throw new AppError({ code: "CASH_COIN_EXCHANGE_FORBIDDEN", kind: "AUTHORIZATION", cause });
  }
  const result = await registerCashCoinExchange({
    workspaceId: context.workspace_id,
    kioskId: parsed.data.kioskId,
    amountCents: parsed.data.amountCents,
    operationId: parsed.data.operationId,
    actor: cashClosureActor(context),
  }).catch(mapCoinExchangeError);
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
