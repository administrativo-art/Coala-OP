import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { resolvePdvFilialId } from "@/lib/kiosk-identifiers";
import { todayInClosureTimezone } from "@/features/financial/cash-closures/date";
import { listCashClosureKioskDocuments } from "@/features/financial/cash-closures/kiosks.server";
import { syncCashClosure } from "@/features/financial/cash-closures/service.server";
import { AppError, reportSystemError, withApiErrorHandling } from "@/lib/observability";
import { WORKSPACE_ID } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const ROUTE = "/api/jobs/cash-closures/daily-sync";

function authorized(actual: string, expected: string) {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function yesterdayInBelem() {
  const instant = new Date(Date.now() - 86_400_000);
  return todayInClosureTimezone(instant);
}

export const POST = withApiErrorHandling({
  source: "job-api",
  operation: "sync-daily-cash-closures",
  routeOrJob: ROUTE,
}, async (request: NextRequest, _context, observation) => {
  const secret = process.env.CASH_CLOSURE_JOB_SECRET?.trim();
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !authorized(provided, secret)) {
    throw new AppError({
      code: "JOB_AUTHENTICATION_REQUIRED",
      kind: "AUTHENTICATION",
      safeMessage: "Não autorizado.",
    });
  }

  const startedAt = new Date().toISOString();
  const body = await request.json().catch(() => ({}));
  const date = typeof body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
    ? body.date
    : yesterdayInBelem();
  const kioskDocuments = await listCashClosureKioskDocuments();
  const units = kioskDocuments.flatMap((document) => {
    const data = document.data();
    const pdvFilialId = resolvePdvFilialId({
      id: document.id,
      pdvFilialId: typeof data.pdvFilialId === "string" ? data.pdvFilialId : null,
    });
    return pdvFilialId ? [{ id: document.id, name: data.name ?? document.id }] : [];
  });
  const results: Array<{
    kioskId: string;
    status: "success" | "failed";
    error?: string;
    eventId?: string;
  }> = [];
  const actor = { userId: "system:cash-closure-daily-sync", userName: "Job diário de fechamento" };

  for (const unit of units) {
    try {
      await syncCashClosure({ workspaceId: WORKSPACE_ID, kioskId: unit.id, date, actor });
      results.push({ kioskId: unit.id, status: "success" });
    } catch (error) {
      const reference = reportSystemError({
        error,
        source: "job",
        operation: "sync-daily-cash-closure-unit",
        routeOrJob: ROUTE,
        requestId: observation.requestId,
        correlationId: observation.correlationId,
        code: "CASH_CLOSURE_UNIT_SYNC_FAILED",
        kind: "TRANSIENT_EXTERNAL",
        metadata: { kioskId: unit.id, date },
      });
      results.push({
        kioskId: unit.id,
        status: "failed",
        error: "Falha ao sincronizar esta unidade.",
        eventId: reference.eventId,
      });
    }
  }

  const completedAt = new Date().toISOString();
  const failed = results.filter((result) => result.status === "failed").length;
  const runRef = financialDbAdmin.collection("cashClosureJobRuns").doc();
  await runRef.set({
    id: runRef.id,
    type: "daily_sync",
    workspaceId: WORKSPACE_ID,
    date,
    status: failed === 0 ? "success" : failed === results.length ? "failed" : "partial",
    unitCount: units.length,
    successCount: results.length - failed,
    failureCount: failed,
    results,
    startedAt,
    completedAt,
  });
  return NextResponse.json({ runId: runRef.id, date, results, failed });
});
