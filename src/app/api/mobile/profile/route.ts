import { NextRequest, NextResponse } from "next/server";

import { mobileProfile } from "@/features/collaborator-schedule/mobile-schedule.server";
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
  id: "mobile.profile.view",
  version: 1,
  surface: { method: "GET", path: "/api/mobile/profile" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "owner" },
  resourceScope: { kind: "owner" },
  input: { kind: "none" },
  effects: { mode: "read", audit: "none" },
  errorExposure: "sanitized",
});

const enforcer = defineSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext, null, { ownerId: string }>({
  id: "mobile-profile-view-v1",
  guarantees: ["authenticated-user", "active-user", "owner-checked"],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: "MOBILE_PROFILE_AUTH_REQUIRED", kind: "AUTHENTICATION", cause });
    });
    assertMobileAppAttested(request, actor.decoded.uid);
    // Only the caller's own card is ever returned; the app permissions tell the home screen which modules to offer.
    return { actor, input: null, resource: { ownerId: actor.decoded.uid } };
  },
});

export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
  const app = security.actor.permissions.app;
  const admin = security.actor.isDefaultAdmin;
  return NextResponse.json({
    profile: mobileProfile(security.actor),
    modules: {
      localPurchase: admin || app?.localPurchase?.register === true,
      stockCount: admin || app?.stockCount?.perform === true,
      repositionReceipt: admin || app?.reposition?.receive === true,
      goals: admin || app?.goals?.view === true,
      schedule: admin || app?.schedule?.view === true,
      signage: admin || app?.signage?.manage === true,
    },
  }, { headers: { "Cache-Control": "private, no-store" } });
});
