import { NextRequest, NextResponse } from "next/server";

import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import {
  assertCashDepositBatchAccess,
  cashClosureActor,
} from "@/features/financial/cash-closures/access.server";
import { getCashDepositBatch } from "@/features/financial/cash-deposits/repository.server";
import { issueInterCobrancaForBatch } from "@/features/financial/cash-deposits/inter-service.server";
import { issueCashDepositSchema } from "@/features/financial/cash-deposits/schemas";
import { AppError } from "@/lib/observability";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ batchId: string }> };
type IssueInput = { dueDate?: string };
type IssueResource = NonNullable<Awaited<ReturnType<typeof getCashDepositBatch>>>;

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "financial.cash-deposit.issue",
  version: 1,
  surface: { method: "POST", path: "/api/financial/cash-deposits/[batchId]/issue" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "financial.cash-deposit.issue" },
  resourceScope: { kind: "unit" },
  input: { kind: "schema", schema: "financial.cash-deposit.issue", unknownFields: "reject" },
  effects: { mode: "external", audit: "server-authoritative" },
  errorExposure: "sanitized",
});

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

const enforcer = createStandardSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, IssueInput, IssueResource>(contract, {
  authenticate: ({ request }) => requireUser(request).catch((cause) => {
      throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  }),
  parseInput: async ({ request }) => {
    const parsed = issueCashDepositSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      throw new AppError({
        code: "CASH_DEPOSIT_ISSUE_INVALID",
        kind: "VALIDATION",
        safeMessage: "Informe uma data de vencimento válida.",
        cause: parsed.error,
      });
    }
    return parsed.data;
  },
  loadResource: async ({ actor, routeContext }) => {
    const { batchId } = await routeContext.params;
    const current = await getCashDepositBatch(batchId);
    if (!current || current.batch.workspaceId !== actor.workspace_id) {
      throw new AppError({ code: "CASH_DEPOSIT_NOT_FOUND", kind: "NOT_FOUND" });
    }
    return current;
  },
  authorize: ({ actor, resource }) => {
    try {
      assertCashDepositBatchAccess(actor, "issue", resource.batch);
    } catch (cause) {
      throw new AppError({ code: "CASH_DEPOSIT_ISSUE_FORBIDDEN", kind: "AUTHORIZATION", cause });
    }
  },
  assertScope: ({ actor, resource }) => {
    if (resource.batch.workspaceId !== actor.workspace_id) {
      throw new AppError({ code: "CASH_DEPOSIT_NOT_FOUND", kind: "NOT_FOUND" });
    }
  },
});

export const POST = secureRoute({
  contract,
  enforcer,
  observability: { source: "api-financial", operation: "issue-cash-deposit" },
}, async ({ security }) => {
  const result = await issueInterCobrancaForBatch({
    workspaceId: security.actor.workspace_id,
    batchId: security.resource.batch.id,
    actor: cashClosureActor(security.actor),
    dueDate: security.input.dueDate,
  }).catch(mapIssueError);
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
