import { NextRequest, NextResponse } from "next/server";

import { WORKSPACE_ID } from "@/lib/workspace";
import { reconcileInterCobrancas, verifyInterWebhookSecret } from "@/features/financial/cash-deposits/inter-service.server";
import {
  AppError,
  runObservedJob,
  withApiErrorHandling,
  writeStructuredJobObservation,
} from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withApiErrorHandling({
  source: "job-api",
  operation: "reconcile-inter-cobrancas",
  routeOrJob: "jobs/inter/cobrancas/reconcile",
}, async (request: NextRequest, _context, observation) => {
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!verifyInterWebhookSecret(provided, process.env.INTER_RECONCILIATION_SECRET?.trim())) {
    throw new AppError({
      code: "JOB_AUTHENTICATION_REQUIRED",
      kind: "AUTHENTICATION",
      safeMessage: "Não autorizado.",
    });
  }
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
  return NextResponse.json({ ok: true, checked: results.length, results });
});
