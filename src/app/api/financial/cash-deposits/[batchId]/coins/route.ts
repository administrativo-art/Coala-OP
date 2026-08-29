import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import {
  assertCashDepositBatchAccess,
  cashClosureActor,
} from "@/features/financial/cash-closures/access.server";
import {
  getCashDepositBatch,
  prepareCashDepositCoinHold,
} from "@/features/financial/cash-deposits/repository.server";
import { prepareCashDepositCoinsSchema } from "@/features/financial/cash-deposits/schemas";
import { AppError, withApiErrorHandling } from "@/lib/observability";

type RouteContext = { params: Promise<{ batchId: string }> };

function mapCoinPreparationError(cause: unknown): never {
  const message = cause instanceof Error ? cause.message : "";
  if (message.includes("não encontrado")) {
    throw new AppError({ code: "CASH_DEPOSIT_NOT_FOUND", kind: "NOT_FOUND", cause });
  }
  if (message.includes("antes da emissão") || message.includes("já foi trocada")) {
    throw new AppError({
      code: "CASH_DEPOSIT_COIN_STATE_CONFLICT",
      kind: "CONFLICT",
      safeMessage: message,
      cause,
    });
  }
  if (message.includes("moedas") || message.includes("total físico")) {
    throw new AppError({
      code: "CASH_DEPOSIT_COIN_VALUE_INVALID",
      kind: "VALIDATION",
      safeMessage: message,
      cause,
    });
  }
  throw cause;
}

export const POST = withApiErrorHandling<RouteContext>({
  source: "api-financial",
  operation: "prepare-cash-deposit-coins",
  routeOrJob: "/api/financial/cash-deposits/[batchId]/coins",
}, async (request: NextRequest, routeContext) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  const { batchId } = await routeContext.params;
  const current = await getCashDepositBatch(batchId);
  if (!current || current.batch.workspaceId !== context.workspace_id) {
    throw new AppError({ code: "CASH_DEPOSIT_NOT_FOUND", kind: "NOT_FOUND" });
  }
  try {
    assertCashDepositBatchAccess(context, "issue", current.batch);
  } catch (cause) {
    throw new AppError({ code: "CASH_DEPOSIT_COIN_PREPARE_FORBIDDEN", kind: "AUTHORIZATION", cause });
  }
  const parsed = prepareCashDepositCoinsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    throw new AppError({
      code: "CASH_DEPOSIT_COIN_VALUE_INVALID",
      kind: "VALIDATION",
      safeMessage: "Informe um valor válido para as moedas separadas.",
      cause: parsed.error,
    });
  }
  const result = await prepareCashDepositCoinHold({
    workspaceId: context.workspace_id,
    batchId,
    coinCents: parsed.data.coinCents,
    actor: cashClosureActor(context),
  }).catch(mapCoinPreparationError);
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
