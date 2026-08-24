import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { refreshPaymentRequest } from "@/features/financial/payment-requests/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PAYMENTS_PER_RUN = 10;
const CANDIDATE_LIMIT = 25;

function authorized(actual: string, expected: string) {
  const left = Buffer.from(actual); const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: NextRequest) {
  const secret = process.env.INTER_RECONCILIATION_SECRET?.trim();
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !authorized(token, secret)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const snapshot = await financialDbAdmin.collection("bankPaymentRequests")
    .where("status", "in", ["awaiting_bank_approval", "scheduled", "processing"])
    .limit(CANDIDATE_LIMIT).get();
  const pending = snapshot.docs
    .sort((left, right) => String(left.get("updatedAt") ?? "").localeCompare(String(right.get("updatedAt") ?? "")))
    .slice(0, MAX_PAYMENTS_PER_RUN);
  const results: Array<{ id: string; status?: string; error?: string }> = [];
  for (const document of pending) {
    try { const payment = await refreshPaymentRequest(document.id, "system"); results.push({ id: document.id, status: payment.status }); }
    catch (error) { results.push({ id: document.id, error: error instanceof Error ? error.message : "Falha na reconciliação." }); }
  }
  return NextResponse.json({ processed: results.length, results });
}
