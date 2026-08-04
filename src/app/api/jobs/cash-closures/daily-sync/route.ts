import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { dbAdmin } from "@/lib/firebase-admin";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { resolvePdvFilialId } from "@/lib/kiosk-identifiers";
import { todayInClosureTimezone } from "@/features/financial/cash-closures/date";
import { syncCashClosure } from "@/features/financial/cash-closures/service.server";
import { WORKSPACE_ID } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(actual: string, expected: string) {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function yesterdayInBelem() {
  const instant = new Date(Date.now() - 86_400_000);
  return todayInClosureTimezone(instant);
}

export async function POST(request: NextRequest) {
  const secret = process.env.CASH_CLOSURE_JOB_SECRET?.trim();
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !authorized(provided, secret)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const startedAt = new Date().toISOString();
  const body = await request.json().catch(() => ({}));
  const date = typeof body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
    ? body.date
    : yesterdayInBelem();
  const snapshot = await dbAdmin.collection("kiosks").get();
  const units = snapshot.docs.flatMap((document) => {
    const data = document.data();
    const pdvFilialId = resolvePdvFilialId({
      id: document.id,
      pdvFilialId: typeof data.pdvFilialId === "string" ? data.pdvFilialId : null,
    });
    return pdvFilialId ? [{ id: document.id, name: data.name ?? document.id }] : [];
  });
  const results: Array<{ kioskId: string; status: "success" | "failed"; error?: string }> = [];
  const actor = { userId: "system:cash-closure-daily-sync", userName: "Job diário de fechamento" };

  for (const unit of units) {
    try {
      await syncCashClosure({ workspaceId: WORKSPACE_ID, kioskId: unit.id, date, actor });
      results.push({ kioskId: unit.id, status: "success" });
    } catch (error) {
      results.push({
        kioskId: unit.id,
        status: "failed",
        error: error instanceof Error ? error.message : "Falha desconhecida.",
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
}
