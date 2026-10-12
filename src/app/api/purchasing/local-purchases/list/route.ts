import { NextRequest, NextResponse } from "next/server";

import { getLocalPurchase, listLocalPurchases } from "@/features/purchasing/local-purchase-admin.server";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { AppError } from "@/lib/observability/app-error";
import { canViewPurchasing } from "@/lib/purchasing-permissions";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StaticRouteContext = { params: Promise<Record<string, never>> };

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "purchasing.local-purchase.list",
  version: 1,
  surface: { method: "GET", path: "/api/purchasing/local-purchases/list" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "purchasing.view" },
  resourceScope: { kind: "workspace" },
  input: { kind: "none" },
  effects: { mode: "read", audit: "none" },
  errorExposure: "sanitized",
});

const enforcer = defineSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext, null, { workspaceId: string }>({
  id: "purchasing-local-purchase-list-v1",
  guarantees: ["authenticated-user", "active-user", "permission-checked", "workspace-scoped"],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: "LOCAL_PURCHASE_AUTH_REQUIRED", kind: "AUTHENTICATION", cause });
    });
    if (!actor.isDefaultAdmin && !canViewPurchasing(actor.permissions)) {
      throw new AppError({ code: "LOCAL_PURCHASE_VIEW_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para ver compras." });
    }
    return { actor, input: null, resource: { workspaceId: actor.workspace_id } };
  },
});

// Units are narrowed to the actor's scope inside the listing; `?id=` returns one purchase under the same rules.
export const GET = secureRoute({ contract, enforcer }, async ({ request, security }) => {
  const id = request.nextUrl.searchParams.get("id");
  const body = id && /^[^/]{1,200}$/.test(id)
    ? { purchase: await getLocalPurchase(id, security.actor) }
    : { purchases: await listLocalPurchases(security.actor) };
  return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });
});
