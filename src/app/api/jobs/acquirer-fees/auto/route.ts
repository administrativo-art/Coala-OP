import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { runAutoRecognition } from "@/features/financial/acquirer-fees/auto-recognition.server";
import { AppError } from "@/lib/observability";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";
import { WORKSPACE_ID } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type StaticRouteContext = { params: Promise<Record<string, never>> };

// Reconhecimento diário das taxas de venda conciliada. O modo de cada unidade decide o efeito:
// desligada não é tocada e simulação nunca grava despesa. Mesmo segredo das demais rotinas financeiras.
const contract = defineSecurityContract({
  schemaVersion: 1, id: "financial.acquirer-fees.auto-recognition", version: 1,
  surface: { method: "POST", path: "/api/jobs/acquirer-fees/auto" },
  exposure: "internal-service", identity: { kind: "service-job", service: "firebase-scheduler" },
  authorization: { kind: "none" }, resourceScope: { kind: "workspace" }, input: { kind: "none" },
  effects: { mode: "write", audit: "server-authoritative" }, errorExposure: "sanitized",
});

function authorized(actual: string, expected: string) {
  const left = Buffer.from(actual); const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

const enforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, { service: string }, undefined, { workspaceId: string }>(contract, {
  authenticate({ request }) {
    const secret = process.env.INTER_RECONCILIATION_SECRET?.trim();
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!secret || !authorized(token, secret)) {
      throw new AppError({ code: "FEE_AUTO_UNAUTHORIZED", kind: "AUTHENTICATION", safeMessage: "Não autorizado.", reportable: false });
    }
    return { service: "firebase-scheduler" };
  },
  loadResource: () => ({ workspaceId: WORKSPACE_ID }),
  assertScope: ({ resource }) => {
    if (resource.workspaceId !== WORKSPACE_ID) throw new AppError({ code: "FEE_AUTO_WORKSPACE_FORBIDDEN", kind: "AUTHORIZATION" });
  },
});

export const POST = secureRoute({ contract, enforcer, observability: { source: "job-api", operation: "auto-recognize-acquirer-fees" } },
  async ({ request }) => {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(280000)]);
    const result = await runAutoRecognition({ signal });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  });
