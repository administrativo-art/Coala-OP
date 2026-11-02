import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";

import { claimRun, loadReportInput, minWeekCoverage, recipients, resendApiKey, sender } from "./weekly-revenue-goals-email.js";
import { localDate } from "./weekly-revenue-goals-report.js";
import {
  buildClosingReport, closingCoverage, closingSubject, closingWindow, renderClosingHtml, renderClosingText,
} from "./monthly-revenue-closing-report.js";

const TIME_ZONE = "America/Belem";
/** O Gmail corta mensagens com mais de ~102 KB de HTML. */
const MAX_HTML_BYTES = 95_000;

/**
 * Fechamento mensal: todo dia 1º às 09:00 (Belém), relatando o mês civil anterior completo.
 * A execução é idempotente por mês relatado, então um reenvio manual no mesmo mês não duplica o e-mail.
 */
export const monthlyRevenueClosingEmail = onSchedule({
  schedule: "0 9 1 * *", timeZone: TIME_ZONE, retryCount: 2,
  timeoutSeconds: 300, memory: "512MiB", maxInstances: 1, secrets: [resendApiKey],
}, async () => {
  const db = getFirestore("coala");
  const now = new Date();
  const window = closingWindow(now);
  const runId = `monthly-revenue-closing-${window.monthStart.slice(0, 7)}`;
  if (!(await claimRun(db, runId, "monthly-revenue-closing"))) {
    logger.info("Fechamento mensal de faturamento e metas já processado", { runId });
    return;
  }
  const runRef = db.collection("scheduledEmailRuns").doc(runId);
  try {
    const report = buildClosingReport(await loadReportInput(db, now, window));
    const coverage = closingCoverage(report);
    const minimum = Number(minWeekCoverage.value());
    if (coverage < minimum) {
      await runRef.set({ status: "blocked", reason: "month_coverage_below_minimum", coverage, minimum, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      logger.error("Fechamento mensal bloqueado por cobertura insuficiente", { runId, coverage, minimum, missingDays: report.missingDays.slice(0, 20) });
      return;
    }
    const html = renderClosingHtml(report);
    const htmlBytes = Buffer.byteLength(html);
    if (htmlBytes > MAX_HTML_BYTES) logger.warn("HTML do fechamento mensal acima do limite de corte do Gmail", { runId, htmlBytes });
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendApiKey.value()}`, "Content-Type": "application/json", "User-Agent": "Coala-One/1.0" },
      body: JSON.stringify({
        from: sender.value(), to: recipients(), subject: closingSubject(report), html, text: renderClosingText(report),
        tags: [{ name: "source", value: "monthly-revenue-closing" }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await response.json().catch(() => ({})) as { id?: string; message?: string };
    if (!response.ok || !payload.id) throw new Error(`Resend respondeu HTTP ${response.status}${payload.message ? `: ${payload.message}` : ""}`);
    await runRef.set({ status: "sent", sentAt: FieldValue.serverTimestamp(), providerId: payload.id, recipients: recipients(), coverage, htmlBytes, month: window.monthStart.slice(0, 7), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    logger.info("Fechamento mensal de faturamento e metas enviado", { runId, providerId: payload.id, htmlBytes, sentOn: localDate(now) });
  } catch (error) {
    await runRef.set({ status: "failed", failedAt: Timestamp.now(), error: error instanceof Error ? error.message.slice(0, 500) : "Falha desconhecida", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    throw error;
  }
});
