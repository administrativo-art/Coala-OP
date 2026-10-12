import { NextRequest, NextResponse } from "next/server";

import { WORKSPACE_ID } from "@/lib/workspace";
import { reconcileInterCobrancas, verifyInterWebhookSecret } from "@/features/financial/cash-deposits/inter-service.server";
import {
  AppError,
  runObservedJob,
  writeStructuredJobObservation,
} from "@/lib/observability";
import { ensureCleanInterCobrancaWebhook } from "@/lib/integrations/inter/webhook.server";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StaticRouteContext = { params: Promise<Record<string, never>> };

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "inter.cobranca.reconciliation.run",
  version: 1,
  surface: { method: "POST", path: "/api/jobs/inter/cobrancas/reconcile" },
  exposure: "internal-service",
  identity: { kind: "service-job", service: "firebase-scheduler" },
  authorization: { kind: "none" },
  resourceScope: { kind: "workspace" },
  input: { kind: "none" },
  effects: { mode: "external", audit: "none" },
  errorExposure: "sanitized",
});

const enforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, { service: string }, undefined, { workspaceId: string }>(contract, {
  authenticate({ request }) {
    const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
    if (!verifyInterWebhookSecret(provided, process.env.INTER_RECONCILIATION_SECRET?.trim())) {
      throw new AppError({ code: "JOB_AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", safeMessage: "Não autorizado.", reportable: false });
    }
    return { service: "firebase-scheduler" };
  },
  loadResource: () => ({ workspaceId: WORKSPACE_ID }),
  assertScope: ({ resource }) => {
    if (resource.workspaceId !== WORKSPACE_ID) throw new AppError({ code: "JOB_WORKSPACE_FORBIDDEN", kind: "AUTHORIZATION" });
  },
});

export const POST = secureRoute({ contract, enforcer, observability: { source: "job-api", operation: "reconcile-inter-cobrancas" } }, async ({ observation }) => {
  const webhook = await ensureCleanInterCobrancaWebhook();
  const results = await runObservedJob({
    source: "job",
    operation: "reconcile-inter-cobrancas",
    routeOrJob: "jobs/inter/cobrancas/reconcile",
    requestId: observation.requestId,
    correlationId: observation.correlationId,
    errorCode: "INTER_RECONCILIATION_FAILED",
    errorKind: "PERMANENT_EXTERNAL",
    severity: "high",
    isTerminal: true,
    metadata: { provider: "Banco Inter", batchSize: 200 },
    onObservation: writeStructuredJobObservation,
  }, () => reconcileInterCobrancas({ workspaceId: WORKSPACE_ID, limit: 200 }));
  return NextResponse.json({ ok: true, webhookUpdated: webhook.updated, checked: results.length, results });
});
