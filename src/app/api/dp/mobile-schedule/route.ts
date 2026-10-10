import { NextRequest, NextResponse } from "next/server";

import { todayInClosureTimezone } from "@/features/financial/cash-closures/date";
import { parseSchedulePeriod } from "@/features/collaborator-schedule/mobile-schedule";
import { assertCanViewMobileSchedule, loadMobileSchedule } from "@/features/collaborator-schedule/mobile-schedule.server";
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
  id: "dp.mobile-schedule.view",
  version: 1,
  surface: { method: "GET", path: "/api/dp/mobile-schedule" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "app.schedule.view" },
  resourceScope: { kind: "owner" },
  input: { kind: "none" },
  effects: { mode: "read", audit: "none" },
  errorExposure: "sanitized",
});

const enforcer = defineSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext, null, { ownerId: string }>({
  id: "dp-mobile-schedule-view-v1",
  guarantees: ["authenticated-user", "active-user", "permission-checked", "owner-checked"],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: "MOBILE_SCHEDULE_AUTH_REQUIRED", kind: "AUTHENTICATION", cause });
    });
    assertMobileAppAttested(request, actor.decoded.uid);
    assertCanViewMobileSchedule(actor);
    // The schedule returned is always derived from the caller: their units and their own shifts.
    return { actor, input: null, resource: { ownerId: actor.decoded.uid } };
  },
});

export const GET = secureRoute({ contract, enforcer }, async ({ request, security }) => {
  const period = parseSchedulePeriod(request.nextUrl.searchParams.get("year"), request.nextUrl.searchParams.get("month"), todayInClosureTimezone());
  if (!period) throw new AppError({ code: "MOBILE_SCHEDULE_PERIOD_INVALID", kind: "VALIDATION", safeMessage: "Período de escala inválido." });
  return NextResponse.json({ today: todayInClosureTimezone(), ...(await loadMobileSchedule(security.actor, period.year, period.month)) }, { headers: { "Cache-Control": "private, no-store" } });
});
