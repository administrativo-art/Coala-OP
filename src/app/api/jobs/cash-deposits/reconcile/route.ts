import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { WORKSPACE_ID } from "@/lib/workspace";
import { buildCashDepositReport } from "@/features/financial/cash-deposits/reports.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(actual: string, expected: string) {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: NextRequest) {
  const secret = process.env.CASH_DEPOSIT_RECONCILIATION_SECRET?.trim();
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !authorized(provided, secret)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  const startedAt = new Date().toISOString();
  const report = await buildCashDepositReport(WORKSPACE_ID);
  const completedAt = new Date().toISOString();
  const runRef = financialDbAdmin.collection("cashDepositReconciliationRuns").doc();
  await runRef.set({
    id: runRef.id,
    workspaceId: WORKSPACE_ID,
    status: report.reconciliationIssues.length === 0 ? "success" : "attention_required",
    issueCount: report.reconciliationIssues.length,
    issues: report.reconciliationIssues.slice(0, 500),
    truncated: report.reconciliationIssues.length > 500,
    indicators: report.indicators,
    startedAt,
    completedAt,
  });
  return NextResponse.json({
    runId: runRef.id,
    issueCount: report.reconciliationIssues.length,
    status: report.reconciliationIssues.length === 0 ? "success" : "attention_required",
  });
}
