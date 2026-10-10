import { NextRequest, NextResponse } from "next/server";

import { assertCanPerformMobileCount, loadMobileCountContext } from "@/features/stock-count/mobile-count.server";
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
  id: "stock.mobile-count.context",
  version: 1,
  surface: { method: "GET", path: "/api/stock/mobile-count" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "app.stockCount.perform" },
  resourceScope: { kind: "workspace" },
  input: { kind: "none" },
  effects: { mode: "read", audit: "none" },
  errorExposure: "sanitized",
});

const enforcer = defineSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext, null, { workspaceId: string }>({
  id: "stock-mobile-count-context-v1",
  guarantees: ["authenticated-user", "active-user", "permission-checked", "workspace-scoped"],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: "MOBILE_COUNT_AUTH_REQUIRED", kind: "AUTHENTICATION", cause });
    });
    assertMobileAppAttested(request, actor.decoded.uid);
    // Permission from the app list; the unit of the session is checked where the document is read.
    assertCanPerformMobileCount(actor);
    return { actor, input: null, resource: { workspaceId: actor.workspace_id } };
  },
});

export const GET = secureRoute({ contract, enforcer }, async ({ security }) =>
  NextResponse.json(await loadMobileCountContext(security.actor), { headers: { "Cache-Control": "private, no-store" } }));
