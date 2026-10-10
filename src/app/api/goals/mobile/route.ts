import { NextRequest, NextResponse } from "next/server";

import { assertCanViewMobileGoals, listMobileGoalUnits, loadMobileUnitGoals } from "@/features/goals/mobile-goals.server";
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
  id: "goals.mobile.view",
  version: 1,
  surface: { method: "GET", path: "/api/goals/mobile" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "app.goals.view" },
  resourceScope: { kind: "workspace" },
  input: { kind: "none" },
  effects: { mode: "read", audit: "none" },
  errorExposure: "sanitized",
});

const enforcer = defineSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext, null, { workspaceId: string }>({
  id: "goals-mobile-view-v1",
  guarantees: ["authenticated-user", "active-user", "permission-checked", "workspace-scoped"],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: "MOBILE_GOALS_AUTH_REQUIRED", kind: "AUTHENTICATION", cause });
    });
    assertMobileAppAttested(request, actor.decoded.uid);
    assertCanViewMobileGoals(actor);
    return { actor, input: null, resource: { workspaceId: actor.workspace_id } };
  },
});

// Without `kioskId` it lists the user's units; with it, the goals of that unit after the unit scope is checked.
export const GET = secureRoute({ contract, enforcer }, async ({ request, security }) => {
  const kioskId = request.nextUrl.searchParams.get("kioskId");
  if (kioskId !== null && !/^[^/]{1,200}$/.test(kioskId)) {
    throw new AppError({ code: "MOBILE_GOALS_INPUT_INVALID", kind: "VALIDATION", safeMessage: "Unidade inválida." });
  }
  const body = kioskId ? await loadMobileUnitGoals(security.actor, kioskId) : { units: await listMobileGoalUnits(security.actor) };
  return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });
});
