import { NextRequest, NextResponse } from "next/server";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { AppError } from "@/lib/observability/app-error";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";
import { rethrowServerAuthenticationFailure } from "@/lib/server-authentication-failure";
import { authorizeCashFlowStudyActor } from "@/features/financial/cash-flow-study/access";
import { loadCashFlowStudy } from "@/features/financial/cash-flow-study/cash-flow-study.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<Record<string, never>> };
type Input = Record<string, never>;

const contract = defineSecurityContract({ schemaVersion: 1, id: "financial.cash-flow-study.view", version: 1,
  surface: { method: "GET", path: "/api/financial/cash-flow-study" }, exposure: "authenticated", identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "financial-default-admin" }, resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "financial.cash-flow-study.view", unknownFields: "reject" }, effects: { mode: "read", audit: "none" }, errorExposure: "sanitized" });

const enforcer = createStandardSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, Input, { workspaceId: string }>(contract, {
  authenticate: async ({ request }) => requireUser(request).catch(rethrowServerAuthenticationFailure),
  parseInput: ({ request }) => {
    if ([...request.nextUrl.searchParams.keys()].length) throw new AppError({ code: "CASH_FLOW_STUDY_INPUT", kind: "VALIDATION", safeMessage: "Esta consulta não recebe parâmetros." });
    return {};
  },
  // O estudo é do workspace da sessão; o cliente não escolhe escopo.
  loadResource: async ({ actor }) => ({ workspaceId: actor.workspace_id }),
  authorize: ({ actor }) => authorizeCashFlowStudyActor(actor),
  assertScope: () => undefined,
});

export const GET = secureRoute({ contract, enforcer }, async () => {
  const study = await loadCashFlowStudy();
  return NextResponse.json(study, { headers: { "Cache-Control": "private, no-store" } });
});
