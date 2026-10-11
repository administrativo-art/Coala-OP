import { NextRequest, NextResponse } from "next/server";

import { assertCanPerformMobileCount, cancelMobileCount } from "@/features/stock-count/mobile-count.server";
import { cancelMobileCountSchema } from "@/features/stock-count/mobile-count";
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
  id: "stock.mobile-count.cancel",
  version: 1,
  surface: { method: "POST", path: "/api/stock/mobile-count/cancel" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "app.stock-count.perform" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "stock.mobile-count.cancel", unknownFields: "reject" },
  effects: { mode: "write", audit: "server-authoritative" },
  errorExposure: "sanitized",
  additionalGuarantees: ["replay-protected"],
});

const enforcer = defineSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext, { sessionId: string }, { workspaceId: string }>({
  id: "stock-mobile-count-cancel-v1",
  guarantees: ["authenticated-user", "active-user", "permission-checked", "workspace-scoped", "input-validated", "fields-allowlisted", "replay-protected"],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: "MOBILE_COUNT_AUTH_REQUIRED", kind: "AUTHENTICATION", cause });
    });
    assertMobileAppAttested(request, actor.decoded.uid);
    // Permission from the app list; owner, unit and status of the session are checked where the document is read.
    assertCanPerformMobileCount(actor);
    const parsed = cancelMobileCountSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError({ code: "MOBILE_COUNT_INPUT_INVALID", kind: "VALIDATION", safeMessage: "Contagem inválida." });
    }
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id } };
  },
});

// Replay-safe: cancelling a count that no longer exists changes nothing and says so.
export const POST = secureRoute({ contract, enforcer }, async ({ security }) =>
  NextResponse.json(await cancelMobileCount(security.input, security.actor), { headers: { "Cache-Control": "private, no-store" } }));
