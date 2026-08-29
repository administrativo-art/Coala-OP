import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import {
  assertCashDepositBatchAccess,
  cashClosureActor,
} from "@/features/financial/cash-closures/access.server";
import { getCashDepositBatch } from "@/features/financial/cash-deposits/repository.server";
import { issueInterCobrancaForBatch } from "@/features/financial/cash-deposits/inter-service.server";
import { issueCashDepositSchema } from "@/features/financial/cash-deposits/schemas";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ batchId: string }> };

function mapIssueError(cause: unknown): never {
  const message = cause instanceof Error ? cause.message : "";
  if (message.includes("não encontrado")) {
    throw new AppError({ code: "CASH_DEPOSIT_NOT_FOUND", kind: "NOT_FOUND", cause });
  }
  if (message.includes("não está disponível") || message.includes("já foi liquidado") || message.includes("limite de reemissões")) {
    throw new AppError({
      code: "CASH_DEPOSIT_ISSUE_STATE_CONFLICT",
      kind: "CONFLICT",
      safeMessage: "Este depósito não está disponível para emissão ou atingiu o limite de reemissões.",
      cause,
    });
  }
  if (message.includes("moedas") || message.includes("mínimo") || message.includes("vencimento")) {
    throw new AppError({
      code: "CASH_DEPOSIT_ISSUE_INVALID",
      kind: "VALIDATION",
      safeMessage: "Confira o valor mínimo, o saldo de moedas e o vencimento antes de emitir.",
      cause,
    });
  }
  throw cause;
}

export const POST = withApiErrorHandling<RouteContext>({
  source: "api-financial",
  operation: "issue-cash-deposit",
  routeOrJob: "/api/financial/cash-deposits/[batchId]/issue",
}, async (request: NextRequest, routeContext) => {
    const context = await requireUser(request).catch((cause) => {
      throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
    });
    const { batchId } = await routeContext.params;
    const parsed = issueCashDepositSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      throw new AppError({
        code: "CASH_DEPOSIT_ISSUE_INVALID",
        kind: "VALIDATION",
        safeMessage: "Informe um vencimento válido para o boleto.",
        cause: parsed.error,
      });
    }
    const current = await getCashDepositBatch(batchId);
    if (!current || current.batch.workspaceId !== context.workspace_id) {
      throw new AppError({ code: "CASH_DEPOSIT_NOT_FOUND", kind: "NOT_FOUND" });
    }
    try {
      assertCashDepositBatchAccess(context, "issue", current.batch);
    } catch (cause) {
      throw new AppError({ code: "CASH_DEPOSIT_ISSUE_FORBIDDEN", kind: "AUTHORIZATION", cause });
    }
    const result = await issueInterCobrancaForBatch({
      workspaceId: context.workspace_id,
      batchId,
      actor: cashClosureActor(context),
      dueBusinessDays: parsed.data.dueBusinessDays,
      dueDate: parsed.data.dueDate,
    }).catch(mapIssueError);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
