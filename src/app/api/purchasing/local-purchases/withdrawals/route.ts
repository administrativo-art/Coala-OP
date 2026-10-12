import { NextRequest, NextResponse } from "next/server";

import { listOpenLocalPurchaseWithdrawals } from "@/features/purchasing/local-purchase-withdrawals.server";
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
  id: "purchasing.local-purchase.withdrawals",
  version: 1,
  surface: { method: "GET", path: "/api/purchasing/local-purchases/withdrawals" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "app.local-purchase.register" },
  resourceScope: { kind: "workspace" },
  input: { kind: "none" },
  effects: { mode: "read", audit: "none" },
  errorExposure: "sanitized",
});

const enforcer = defineSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext, null, { workspaceId: string }>({
  id: "purchasing-local-purchase-withdrawals-v1",
  guarantees: ["authenticated-user", "active-user", "permission-checked", "workspace-scoped"],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: "LOCAL_PURCHASE_AUTH_REQUIRED", kind: "AUTHENTICATION", cause });
    });
    assertMobileAppAttested(request, actor.decoded.uid);
    if (!actor.isDefaultAdmin && actor.permissions.app?.localPurchase?.register !== true) {
      throw new AppError({ code: "LOCAL_PURCHASE_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para registrar compras locais." });
    }
    return { actor, input: null, resource: { workspaceId: actor.workspace_id } };
  },
});

// Units are narrowed to the actor's scope inside the listing; the PDV is read live, with a short server cache.
export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
  const listing = await listOpenLocalPurchaseWithdrawals(security.actor).catch((cause) => {
    if (cause instanceof AppError) throw cause;
    throw new AppError({ code: "LOCAL_PURCHASE_WITHDRAWALS_UNAVAILABLE", kind: "TRANSIENT_EXTERNAL", safeMessage: "Não foi possível consultar as sangrias no PDV agora.", cause });
  });
  return NextResponse.json(listing, { headers: { "Cache-Control": "private, no-store" } });
});
