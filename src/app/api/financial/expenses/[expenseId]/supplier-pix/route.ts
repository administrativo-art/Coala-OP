import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prepareExpenseSupplierPix } from "@/features/financial/payment-requests/expense-supplier-pix.server";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { AppError } from "@/lib/observability";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";
import { financialCompetenceMonthSchema } from "@/features/financial/lib/expense-accounting-contract";
import { WORKSPACE_ID } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ expenseId: string }> };
const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,150}$/);
const inputSchema = z.object({
  supplierEntityId: idSchema,
  amountCents: z.number().int().positive().max(100_000_000),
  confirmation: z.object({
    beneficiaryDocument: z.string().regex(/^\d{14}$/),
    competenceMonth: financialCompetenceMonthSchema,
    previousPaidRequestId: idSchema,
    allowExistingBoleto: z.boolean(),
  }).strict().optional(),
}).strict();
type Input = z.infer<typeof inputSchema>;
type Resource = { expenseId: string };

const contract = defineSecurityContract({
  schemaVersion: 1, id: "financial.expense-supplier-pix.prepare", version: 1,
  surface: { method: "POST", path: "/api/financial/expenses/[expenseId]/supplier-pix" },
  exposure: "authenticated", identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "expense-supplier-pix-create" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "expense-supplier-pix-json", unknownFields: "reject" },
  effects: { mode: "write", audit: "server-authoritative" }, errorExposure: "sanitized",
});
const enforcer = defineSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, Input, Resource>({
  id: "expense-supplier-pix-create-v1",
  guarantees: ["authenticated-user", "active-user", "authorization:expense-supplier-pix-create", "workspace-scoped", "input-validated", "fields-allowlisted", "server-authoritative-audit"],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: "EXPENSE_SUPPLIER_PIX_AUTH_REQUIRED", kind: "AUTHENTICATION", cause });
    });
    const permission = actor.permissions.financial;
    if (!actor.isDefaultAdmin && (!permission?.view || !permission.expenses?.view || !permission.expenses?.edit
      || !permission.paymentRequests?.view || !permission.paymentRequests?.create)) {
      throw new AppError({ code: "EXPENSE_SUPPLIER_PIX_FORBIDDEN", kind: "AUTHORIZATION" });
    }
    const expenseId = idSchema.safeParse((await routeContext.params).expenseId);
    const input = inputSchema.safeParse(await request.json().catch(() => null));
    if (!expenseId.success || !input.success) {
      throw new AppError({ code: "EXPENSE_SUPPLIER_PIX_INVALID", kind: "VALIDATION", safeMessage: "Despesa, fornecedor ou valor inválido." });
    }
    if (input.data.confirmation && !actor.isDefaultAdmin
      && (actor.permissions.registration?.entities?.edit !== true || permission?.expenses?.create !== true)) {
      throw new AppError({ code: "EXPENSE_SUPPLIER_PIX_CONFIRMATION_FORBIDDEN", kind: "AUTHORIZATION" });
    }
    const expense = await financialDbAdmin.collection("expenses").doc(expenseId.data).get();
    if (!expense.exists) throw new AppError({ code: "EXPENSE_SUPPLIER_PIX_NOT_FOUND", kind: "NOT_FOUND" });
    const legacyForecast = input.data.confirmation && !expense.get("workspaceId")
      && expense.get("provisionType") === "forecast" && expense.get("sourceType") === "recurring_expense_forecast"
      && Boolean(expense.get("unitId"));
    if (actor.workspace_id !== WORKSPACE_ID || (expense.get("workspaceId") !== actor.workspace_id && !legacyForecast)) {
      throw new AppError({ code: "EXPENSE_SUPPLIER_PIX_SCOPE", kind: "AUTHORIZATION" });
    }
    return { actor, input: input.data, resource: { expenseId: expenseId.data } };
  },
});

export const POST = secureRoute({ contract, enforcer }, async ({ security }) => {
  const { actor, input, resource } = security;
  const result = await prepareExpenseSupplierPix(resource.expenseId, input.supplierEntityId, input.amountCents, WORKSPACE_ID,
    { uid: actor.decoded.uid, email: actor.decoded.email, name: actor.userDoc.username }, input.confirmation);
  return NextResponse.json({ request: result }, { headers: { "Cache-Control": "private, no-store" } });
});
