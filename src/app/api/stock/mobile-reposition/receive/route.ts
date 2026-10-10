import { NextRequest, NextResponse } from "next/server";

import { assertCanReceiveMobileReposition, receiveMobileReposition } from "@/features/reposition/mobile-receipt.server";
import { receiveMobileRepositionSchema, type MobileReceiptRow } from "@/features/reposition/mobile-receipt";
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
  id: "stock.mobile-reposition.receive",
  version: 1,
  surface: { method: "POST", path: "/api/stock/mobile-reposition/receive" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "app.reposition.receive" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "stock.mobile-reposition.receive", unknownFields: "reject" },
  effects: { mode: "write", audit: "server-authoritative" },
  errorExposure: "sanitized",
  additionalGuarantees: ["replay-protected"],
});

const enforcer = defineSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext, { activityId: string; rows: MobileReceiptRow[] }, { workspaceId: string }>({
  id: "stock-mobile-reposition-receive-v1",
  guarantees: ["authenticated-user", "active-user", "permission-checked", "workspace-scoped", "input-validated", "fields-allowlisted", "replay-protected"],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: "MOBILE_REPOSITION_AUTH_REQUIRED", kind: "AUTHENTICATION", cause });
    });
    assertMobileAppAttested(request, actor.decoded.uid);
    // The destination unit of each reposition is checked against the actor where the document is read.
    assertCanReceiveMobileReposition(actor);
    const parsed = receiveMobileRepositionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError({ code: "MOBILE_REPOSITION_INPUT_INVALID", kind: "VALIDATION", safeMessage: parsed.error.issues[0]?.message ?? "Dados inválidos." });
    }
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id } };
  },
});

// Replay-safe: the status is checked in the same transaction, and a retry by the same person changes nothing.
export const POST = secureRoute({ contract, enforcer }, async ({ security }) =>
  NextResponse.json(await receiveMobileReposition(security.input, security.actor), { headers: { "Cache-Control": "private, no-store" } }));
