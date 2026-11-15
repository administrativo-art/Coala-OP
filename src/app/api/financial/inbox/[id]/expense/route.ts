import { NextRequest, NextResponse } from "next/server";

import { createInboxDareExpense } from "@/features/financial/inbox/create-dare-expense.server";
import { inboxDareExpenseSchema } from "@/features/financial/inbox/expense-create-contract";
import { getFinancialInboxMessage } from "@/features/financial/inbox/repository.server";
import { requireUser } from "@/lib/auth-server";
import { AppError } from "@/lib/observability";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };
type Actor = Awaited<ReturnType<typeof requireUser>>;
type Input = ReturnType<typeof inboxDareExpenseSchema.parse>;

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "financial.inbox.dare-expense-create",
  version: 1,
  surface: { method: "POST", path: "/api/financial/inbox/[id]/expense" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "financial-inbox-dare-expense-create" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "financial.inbox.dare-expense-create", unknownFields: "reject" },
  effects: { mode: "write", audit: "server-authoritative" },
  errorExposure: "sanitized",
});

const enforcer = defineSecurityEnforcer<NextRequest, Context, unknown, Actor, Input, { id: string }>({
  id: "financial-inbox-dare-expense-create-v1",
  guarantees: ["authenticated-user", "active-user", "authorization:financial-inbox-dare-expense-create", "workspace-scoped", "input-validated", "fields-allowlisted", "server-authoritative-audit"],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: "FINANCIAL_INBOX_AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
    });
    if (!actor.isDefaultAdmin && (!actor.permissions.financial?.view
      || !actor.permissions.financial?.inbox?.view || !actor.permissions.financial?.inbox?.link
      || !actor.permissions.financial?.expenses?.create || !actor.permissions.financial?.expenses?.edit)) {
      throw new AppError({ code: "FINANCIAL_INBOX_DARE_EXPENSE_FORBIDDEN", kind: "AUTHORIZATION",
        safeMessage: "Sem permissão para criar e vincular a despesa da cobrança." });
    }
    const { id } = await routeContext.params;
    if (!/^[a-zA-Z0-9_-]{8,170}$/.test(id)) {
      throw new AppError({ code: "FINANCIAL_INBOX_DARE_EXPENSE_INVALID_ID", kind: "VALIDATION" });
    }
    const body = await request.json().catch(() => null);
    const parsed = inboxDareExpenseSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError({ code: "FINANCIAL_INBOX_DARE_EXPENSE_INVALID", kind: "VALIDATION",
        safeMessage: "Revise documento, conta, centro e rateio da guia.", cause: parsed.error });
    }
    const message = await getFinancialInboxMessage(id);
    if (message.workspaceId !== actor.workspace_id) {
      throw new AppError({ code: "FINANCIAL_INBOX_DARE_EXPENSE_NOT_FOUND", kind: "NOT_FOUND" });
    }
    return { actor, input: parsed.data, resource: { id } };
  },
});

export const POST = secureRoute({ contract, enforcer,
  observability: { source: "api-financial", operation: "create-inbox-dare-expense" },
}, async ({ security }) => {
  try {
    const result = await createInboxDareExpense({
      inboxId: security.resource.id,
      workspaceId: security.actor.workspace_id,
      actor: { uid: security.actor.decoded.uid, email: security.actor.decoded.email },
      input: security.input,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (cause) {
    throw new AppError({ code: "FINANCIAL_INBOX_DARE_EXPENSE_CONFLICT", kind: "CONFLICT",
      safeMessage: "A guia, a classificação ou a despesa mudou. Confira antes de repetir.", cause });
  }
});
