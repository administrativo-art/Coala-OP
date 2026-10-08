import { NextRequest, NextResponse } from "next/server";

import { canViewAiCosts } from "@/features/ai-management/access-policy";
import { loadOpenAiBillingOverview } from "@/features/ai-management/openai-billing.server";
import { loadGoogleCloudCostOverview } from "@/features/ai-management/google-cloud-billing.server";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { AppError } from "@/lib/observability/app-error";
import { rethrowServerAuthenticationFailure } from "@/lib/server-authentication-failure";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StaticRouteContext = { params: Promise<Record<string, never>> };

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "settings.ai-management.view-costs",
  version: 1,
  surface: { method: "GET", path: "/api/settings/ai-management" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "settings.ai-management.view-costs" },
  resourceScope: { kind: "none" },
  input: { kind: "none" },
  effects: { mode: "read", audit: "none" },
  errorExposure: "sanitized",
});

const enforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext>(contract, {
  authenticate: ({ request }) => requireUser(request).catch((error) => rethrowServerAuthenticationFailure(error)),
  authorize: ({ actor }) => {
    if (!canViewAiCosts(actor)) {
      throw new AppError({
        code: "AI_COSTS_FORBIDDEN",
        kind: "AUTHORIZATION",
        safeMessage: "Sem permissão para consultar custos de IA.",
      });
    }
  },
});

export const GET = secureRoute({ contract, enforcer }, async ({ request }) => {
  const view = request.nextUrl.searchParams.get("view");
  const overview = view === "costs"
    ? await loadGoogleCloudCostOverview()
    : await loadOpenAiBillingOverview();
  return NextResponse.json(overview, { headers: { "Cache-Control": "private, no-store" } });
});
