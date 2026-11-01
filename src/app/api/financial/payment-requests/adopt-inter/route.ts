import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { adoptInterBarcodePayment } from "@/features/financial/payment-requests/adopt-inter-payment.server";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { AppError } from "@/lib/observability";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<Record<string, never>> };
const schema = z.strictObject({
  interRequestId: z.string().uuid(),
  targetExpenseId: z.string().regex(/^[a-zA-Z0-9_-]{1,150}$/),
  barcode: z.string().regex(/^\d{44}(?:\d{3})?$/),
  amountCents: z.number().int().positive().max(100_000_000),
  scheduledFor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  beneficiaryDocument: z.string().regex(/^(?:\d{11}|\d{14})$/),
});
type Input = z.infer<typeof schema>;

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "financial.payment-request.adopt-inter",
  version: 1,
  surface: { method: "POST", path: "/api/financial/payment-requests/adopt-inter" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "adopt-existing-inter-payment" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "adopt-inter-payment-json", unknownFields: "reject" },
  effects: { mode: "write", audit: "server-authoritative" },
  errorExposure: "sanitized",
});

const enforcer = defineSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, Input, { workspaceId: string }>({
  id: "adopt-inter-payment-v1",
  guarantees: ["authenticated-user", "active-user", "authorization:adopt-existing-inter-payment", "workspace-scoped", "input-validated", "fields-allowlisted", "server-authoritative-audit"],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: "INTER_ADOPTION_AUTH_REQUIRED", kind: "AUTHENTICATION", cause });
    });
    const permission = actor.permissions.financial;
    if (!actor.isDefaultAdmin && (!permission?.view || !permission.expenses?.edit
      || !permission.paymentRequests?.view || !permission.paymentRequests?.create
      || !permission.paymentRequests?.refresh)) {
      throw new AppError({ code: "INTER_ADOPTION_FORBIDDEN", kind: "AUTHORIZATION" });
    }
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) throw new AppError({ code: "INTER_ADOPTION_INVALID", kind: "VALIDATION", safeMessage: "Confirme a transação, boleto, valor, data e despesa." });
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id } };
  },
});

export const POST = secureRoute({ contract, enforcer }, async ({ security }) => {
  const { actor, input, resource } = security;
  const result = await adoptInterBarcodePayment(input, {
    uid: actor.decoded.uid, email: actor.decoded.email, name: actor.userDoc.username,
  }, resource.workspaceId);
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
