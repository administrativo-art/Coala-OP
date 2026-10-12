import { NextRequest, NextResponse } from "next/server";

import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { assertCashDepositAccess } from "@/features/financial/cash-closures/access.server";
import { retrieveConfiguredCobrancaWebhook } from "@/lib/integrations/inter/cobrancas";
import { getInterCobrancaEnvironment } from "@/lib/integrations/inter/config.server";
import { ensureCleanInterCobrancaWebhook, publicWebhookUrl } from "@/lib/integrations/inter/webhook.server";
import { AppError } from "@/lib/observability";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract, type RouteSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StaticRouteContext = { params: Promise<Record<string, never>> };
type WorkspaceResource = { workspaceId: string };

function contract(method: "GET" | "POST", id: string, mode: "read" | "external") {
  return defineSecurityContract({
    schemaVersion: 1,
    id,
    version: 1,
    surface: { method, path: "/api/financial/cash-deposits/inter/webhook" },
    exposure: "authenticated",
    identity: { kind: "active-user" },
    authorization: { kind: "permission", action: method === "GET" ? "cash-deposit.view" : "cash-deposit.issue" },
    resourceScope: { kind: "workspace" },
    input: { kind: "none" },
    effects: { mode, audit: "none" },
    errorExposure: "sanitized",
  } satisfies RouteSecurityContract);
}

function enforcer(routeContract: ReturnType<typeof contract>, action: "view" | "issue") {
  return createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext, undefined, WorkspaceResource>(routeContract, {
    authenticate: ({ request }) => requireUser(request).catch((cause) => {
      throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
    }),
    loadResource: ({ actor }) => ({ workspaceId: actor.workspace_id }),
    authorize: ({ actor }) => {
      try {
        assertCashDepositAccess(actor, action);
      } catch (cause) {
        throw new AppError({ code: action === "view" ? "INTER_WEBHOOK_VIEW_FORBIDDEN" : "INTER_WEBHOOK_CONFIGURE_FORBIDDEN", kind: "AUTHORIZATION", cause });
      }
    },
    assertScope: ({ actor, resource }) => {
      if (!resource.workspaceId || resource.workspaceId !== actor.workspace_id) {
        throw new AppError({ code: "INTER_WEBHOOK_WORKSPACE_FORBIDDEN", kind: "AUTHORIZATION" });
      }
    },
  });
}

const getContract = contract("GET", "inter.cobranca.webhook-config.read", "read");
const postContract = contract("POST", "inter.cobranca.webhook-config.update", "external");

export const GET = secureRoute({ contract: getContract, enforcer: enforcer(getContract, "view") }, async () => {
  const configured = await retrieveConfiguredCobrancaWebhook();
  return NextResponse.json({
    environment: getInterCobrancaEnvironment(),
    webhookUrl: configured ? publicWebhookUrl(configured.webhookUrl) : null,
  }, { headers: { "Cache-Control": "private, no-store" } });
});

export const POST = secureRoute({ contract: postContract, enforcer: enforcer(postContract, "issue") }, async () => {
  const result = await ensureCleanInterCobrancaWebhook();
  return NextResponse.json({
    ok: true,
    updated: result.updated,
    environment: getInterCobrancaEnvironment(),
    webhookUrl: result.webhookUrl,
  }, { headers: { "Cache-Control": "private, no-store" } });
});
