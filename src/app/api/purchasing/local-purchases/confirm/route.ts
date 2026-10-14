import { NextRequest, NextResponse } from "next/server";

import { confirmLocalPurchase } from "@/features/purchasing/local-purchase.server";
import { confirmLocalPurchaseSchema, type ConfirmLocalPurchaseInput } from "@/features/purchasing/local-purchase";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { AppError } from "@/lib/observability/app-error";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { assertMobileAppAttested } from "@/lib/security/mobile-app-attestation.server";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StaticRouteContext = { params: Promise<Record<string, never>> };

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "purchasing.local-purchase.confirm",
  version: 1,
  surface: { method: "POST", path: "/api/purchasing/local-purchases/confirm" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "app.local-purchase.register" },
  resourceScope: { kind: "unit" },
  input: { kind: "schema", schema: "purchasing.local-purchase.confirm", unknownFields: "reject" },
  effects: { mode: "write", audit: "server-authoritative" },
  errorExposure: "sanitized",
  additionalGuarantees: ["replay-protected"],
});

const enforcer = defineSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext, ConfirmLocalPurchaseInput, { workspaceId: string; unitId: string }>({
  id: "purchasing-local-purchase-confirm-v1",
  guarantees: [
    "authenticated-user",
    "active-user",
    "permission-checked",
    "workspace-scoped",
    "unit-scoped",
    "input-validated",
    "fields-allowlisted",
    "replay-protected",
  ],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: "LOCAL_PURCHASE_AUTH_REQUIRED", kind: "AUTHENTICATION", cause });
    });
    assertMobileAppAttested(request, actor.decoded.uid);
    if (!actor.isDefaultAdmin && actor.permissions.app?.localPurchase?.register !== true) {
      throw new AppError({ code: "LOCAL_PURCHASE_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para registrar compras locais." });
    }
    const body = await request.json().catch(() => null);
    const parsed = confirmLocalPurchaseSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError({ code: "LOCAL_PURCHASE_INPUT_INVALID", kind: "VALIDATION", safeMessage: parsed.error.issues[0]?.message ?? "Dados inválidos." });
    }
    return {
      actor,
      input: parsed.data,
      resource: { workspaceId: actor.workspace_id, unitId: parsed.data.unitId },
    };
  },
});

export const POST = secureRoute({ contract, enforcer }, async ({ security }) => {
  const purchase = await confirmLocalPurchase(security.input, security.actor);
  return NextResponse.json({ purchase }, { status: purchase.duplicate ? 200 : 201 });
});
