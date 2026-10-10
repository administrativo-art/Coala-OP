import { NextRequest, NextResponse } from "next/server";

import { assertCanPerformMobileCount, saveMobileCount } from "@/features/stock-count/mobile-count.server";
import { saveMobileCountSchema, type MobileCountEntry } from "@/features/stock-count/mobile-count";
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
  id: "stock.mobile-count.save",
  version: 1,
  surface: { method: "POST", path: "/api/stock/mobile-count/save" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "app.stock-count.perform" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "stock.mobile-count.save", unknownFields: "reject" },
  effects: { mode: "write", audit: "server-authoritative" },
  errorExposure: "sanitized",
  additionalGuarantees: ["replay-protected"],
});

const enforcer = defineSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext, { sessionId: string; entries: MobileCountEntry[]; complete: boolean }, { workspaceId: string }>({
  id: "stock-mobile-count-save-v1",
  guarantees: ["authenticated-user", "active-user", "permission-checked", "workspace-scoped", "input-validated", "fields-allowlisted", "replay-protected"],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: "MOBILE_COUNT_AUTH_REQUIRED", kind: "AUTHENTICATION", cause });
    });
    assertMobileAppAttested(request, actor.decoded.uid);
    // Permission from the app list; the unit of the session is checked where the document is read.
    assertCanPerformMobileCount(actor);
    const parsed = saveMobileCountSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError({ code: "MOBILE_COUNT_INPUT_INVALID", kind: "VALIDATION", safeMessage: parsed.error.issues[0]?.message ?? "Dados inválidos." });
    }
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id } };
  },
});

// Replay-safe: completing a count that is already completed changes nothing and says so.
export const POST = secureRoute({ contract, enforcer }, async ({ security }) =>
  NextResponse.json(await saveMobileCount(security.input, security.actor), { headers: { "Cache-Control": "private, no-store" } }));
