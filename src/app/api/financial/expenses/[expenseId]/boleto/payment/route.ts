import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { expenseBoletoPaymentSchema } from "@/features/financial/payment-requests/expense-boleto";
import { prepareExpenseBoleto } from "@/features/financial/payment-requests/expense-boleto.server";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { AppError } from "@/lib/observability";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ expenseId: string }> };
type Input = z.infer<typeof expenseBoletoPaymentSchema>;
type Resource = { expenseId: string };
const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,150}$/);

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "financial.expense-boleto.prepare",
  version: 1,
  surface: { method: "POST", path: "/api/financial/expenses/[expenseId]/boleto/payment" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "expense-boleto-payment-create" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "expense-boleto-payment-json", unknownFields: "reject" },
  effects: { mode: "write", audit: "server-authoritative" },
  errorExposure: "sanitized",
});
const enforcer = defineSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, Input, Resource>({
  id: "expense-boleto-payment-create-v1",
  guarantees: ["authenticated-user", "active-user", "authorization:expense-boleto-payment-create", "workspace-scoped", "input-validated", "fields-allowlisted", "server-authoritative-audit"],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: "BOLETO_AUTH_REQUIRED", kind: "AUTHENTICATION", cause });
    });
    const permission = actor.permissions.financial;
    if (!actor.isDefaultAdmin && (
      !permission?.view || !permission.expenses?.view || !permission.expenses?.edit
      || !permission.paymentRequests?.view || !permission.paymentRequests?.create
    )) throw new AppError({ code: "BOLETO_PAYMENT_FORBIDDEN", kind: "AUTHORIZATION" });
    const expenseId = idSchema.safeParse((await routeContext.params).expenseId);
    if (!expenseId.success) throw new AppError({ code: "BOLETO_EXPENSE_INVALID", kind: "VALIDATION", safeMessage: "Despesa inválida." });
    const input = expenseBoletoPaymentSchema.safeParse(await request.json());
    if (!input.success) throw new AppError({ code: "BOLETO_PAYMENT_INVALID", kind: "VALIDATION", safeMessage: "Confirme a data e a parcela solicitadas para pagamento." });
    const expense = await financialDbAdmin.collection("expenses").doc(expenseId.data).get();
    if (!expense.exists) throw new AppError({ code: "BOLETO_EXPENSE_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Despesa não encontrada." });
    if (expense.get("workspaceId") !== actor.workspace_id) throw new AppError({ code: "BOLETO_EXPENSE_FORBIDDEN", kind: "AUTHORIZATION" });
    return { actor, input: input.data, resource: { expenseId: expenseId.data } };
  },
});

export const POST = secureRoute({ contract, enforcer }, async ({ security }) => {
  const { actor, input, resource } = security;
  const result = await prepareExpenseBoleto(
    resource.expenseId,
    actor.workspace_id,
    input.scheduledFor,
    { uid: actor.decoded.uid, email: actor.decoded.email },
    input.installmentNumber,
  );
  return NextResponse.json({ request: result }, { headers: { "Cache-Control": "private, no-store" } });
});
