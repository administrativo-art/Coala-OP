import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prepareConsultancyProvisionPix } from "@/features/financial/payment-requests/consultancy-provision.server";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { AppError } from "@/lib/observability";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ expenseId: string }> };
const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,150}$/);
const inputSchema = z.object({ beneficiaryEmployeeId: idSchema, scheduledFor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict();
type Input = z.infer<typeof inputSchema>;
type Resource = { expenseId: string };

const contract = defineSecurityContract({
  schemaVersion: 1, id: "financial.consultancy-provision-pix.prepare", version: 1,
  surface: { method: "POST", path: "/api/financial/expenses/[expenseId]/consultancy-pix" },
  exposure: "authenticated", identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "consultancy-provision-pix-create" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "consultancy-provision-pix-json", unknownFields: "reject" },
  effects: { mode: "write", audit: "server-authoritative" }, errorExposure: "sanitized",
});
const enforcer = defineSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, Input, Resource>({
  id: "consultancy-provision-pix-create-v1",
  guarantees: ["authenticated-user", "active-user", "authorization:consultancy-provision-pix-create", "workspace-scoped", "input-validated", "fields-allowlisted", "server-authoritative-audit"],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: "CONSULTANCY_PIX_AUTH_REQUIRED", kind: "AUTHENTICATION", cause });
    });
    const permission = actor.permissions.financial;
    if (!actor.isDefaultAdmin && (!permission?.view || !permission.expenses?.view || !permission.expenses?.edit
      || !permission.paymentRequests?.view || !permission.paymentRequests?.create)) {
      throw new AppError({ code: "CONSULTANCY_PIX_FORBIDDEN", kind: "AUTHORIZATION" });
    }
    const expenseId = idSchema.safeParse((await routeContext.params).expenseId);
    const input = inputSchema.safeParse(await request.json().catch(() => null));
    if (!expenseId.success || !input.success) {
      throw new AppError({ code: "CONSULTANCY_PIX_INVALID", kind: "VALIDATION", safeMessage: "Provisão, favorecido ou data inválidos." });
    }
    const expense = await financialDbAdmin.collection("expenses").doc(expenseId.data).get();
    if (!expense.exists) throw new AppError({ code: "CONSULTANCY_PIX_NOT_FOUND", kind: "NOT_FOUND" });
    if (expense.get("workspaceId") !== actor.workspace_id) throw new AppError({ code: "CONSULTANCY_PIX_SCOPE", kind: "AUTHORIZATION" });
    return { actor, input: input.data, resource: { expenseId: expenseId.data } };
  },
});

export const POST = secureRoute({ contract, enforcer }, async ({ security }) => {
  const { actor, input, resource } = security;
  const result = await prepareConsultancyProvisionPix(resource.expenseId, input.beneficiaryEmployeeId, input.scheduledFor,
    { uid: actor.decoded.uid, email: actor.decoded.email, name: actor.userDoc.username });
  return NextResponse.json({ request: result }, { headers: { "Cache-Control": "private, no-store" } });
});
