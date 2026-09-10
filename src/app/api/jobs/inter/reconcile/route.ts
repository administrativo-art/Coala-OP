import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import {
  deferBankStatusRefreshAfterFailure,
  markStalePaymentSubmissionForReview,
  refreshPaymentRequest,
} from "@/features/financial/payment-requests/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PAYMENTS_PER_RUN = 10;
const MAX_POST_PAYMENT_PER_RUN = 5;
const MAX_STALE_SUBMISSIONS_PER_RUN = 5;
const STALE_SUBMISSION_MS = 10 * 60_000;

function authorized(actual: string, expected: string) {
  const left = Buffer.from(actual); const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: NextRequest) {
  const secret = process.env.INTER_RECONCILIATION_SECRET?.trim();
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !authorized(token, secret)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const now = new Date();
  const nowIso = now.toISOString();
  const staleSubmissionBefore = new Date(now.getTime() - STALE_SUBMISSION_MS);
  // As consultas iniciais retornam no máximo 20 documentos por execução. Cada
  // item processado exige leituras adicionais da solicitação e, na conclusão,
  // da origem. Agendamentos futuros ficam fora da consulta até a data devida.
  const [statusSnapshot, postPaymentSnapshot, staleSubmissionSnapshot] = await Promise.all([
    financialDbAdmin.collection("bankPaymentRequests")
      .where("status", "in", ["awaiting_bank_approval", "scheduled", "processing"])
      .where("nextBankStatusCheckAt", "<=", nowIso)
      .orderBy("nextBankStatusCheckAt", "asc")
      .limit(MAX_PAYMENTS_PER_RUN).get(),
    financialDbAdmin.collection("bankPaymentRequests")
      .where("postPaymentProcessingStatus", "==", "pending")
      .where("nextPostPaymentAttemptAt", "<=", nowIso)
      .orderBy("nextPostPaymentAttemptAt", "asc")
      .limit(MAX_POST_PAYMENT_PER_RUN).get(),
    financialDbAdmin.collection("bankPaymentRequests")
      .where("status", "==", "submitting")
      .where("submissionStartedAt", "<=", staleSubmissionBefore.toISOString())
      .orderBy("submissionStartedAt", "asc")
      .limit(MAX_STALE_SUBMISSIONS_PER_RUN).get(),
  ]);
  const ids = new Set(statusSnapshot.docs.map((document) => document.id));
  const pending = [
    ...statusSnapshot.docs,
    ...postPaymentSnapshot.docs.filter((document) => !ids.has(document.id)),
  ];
  const results: Array<{ id: string; status?: string; error?: string }> = [];
  for (const document of staleSubmissionSnapshot.docs) {
    try {
      const recovered = await markStalePaymentSubmissionForReview(document.id, staleSubmissionBefore);
      results.push({ id: document.id, status: recovered?.status ?? String(document.get("status") || "submitting") });
    } catch {
      results.push({ id: document.id, error: "Falha ao encaminhar envio interrompido para revisão." });
    }
  }
  for (const document of pending) {
    try { const payment = await refreshPaymentRequest(document.id, "system"); results.push({ id: document.id, status: payment.status }); }
    catch {
      if (ids.has(document.id)) {
        await deferBankStatusRefreshAfterFailure(document.id, now).catch(() => undefined);
      }
      results.push({ id: document.id, error: "Falha na reconciliação; a próxima execução tentará novamente." });
    }
  }
  return NextResponse.json({
    processed: results.length,
    results,
  });
}
