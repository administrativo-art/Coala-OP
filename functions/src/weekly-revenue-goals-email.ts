import { getFirestore, FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import { defineSecret, defineString } from "firebase-functions/params";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import { readOfficialScheduleShifts } from "./official-schedule.js";

import {
  buildReport,
  localDate,
  reportWindow,
  dateRange,
  renderHtml,
  renderSubject,
  renderText,
  weekCoverage,
  type GoalMonth,
  type SalesDay,
  type Unit,
} from "./weekly-revenue-goals-report.js";

const TIME_ZONE = "America/Belem";
const MAX_SHIFTS_PER_SCHEDULE = 3000;
const MAX_EMPLOYEE_GOALS = 300;
/** O Gmail corta mensagens com mais de ~102 KB de HTML; acima disso a qualidade dos dados some do e-mail. */
const MAX_HTML_BYTES = 95_000;

const resendApiKey = defineSecret("RESEND_API_KEY");
const sender = defineString("REVENUE_GOALS_EMAIL_FROM", { default: "Margaret Hamilton · Coala One <relatorios@coalashakes.com>" });
/** Lista separada por vírgula. */
const recipient = defineString("REVENUE_GOALS_EMAIL_TO", { default: "administrativo@coalashakes.com,cesar@cesarthimotheo.com" });
const recipients = () => recipient.value().split(",").map(address => address.trim()).filter(Boolean);
const appUrl = defineString("REVENUE_GOALS_APP_URL", { default: "https://op.coalashakes.com" });
const minWeekCoverage = defineString("REVENUE_GOALS_MIN_WEEK_COVERAGE", { default: "0.8" });
const onTrackPercent = defineString("REVENUE_GOALS_ON_TRACK_PERCENT", { default: "100" });
const attentionPercent = defineString("REVENUE_GOALS_ATTENTION_PERCENT", { default: "95" });

function localDateOf(value: unknown) {
  const date = value instanceof Timestamp ? value.toDate() : value instanceof Date ? value : null;
  return date ? localDate(date) : null;
}

function monthsBack(month: string, count: number) {
  const [year, value] = month.split("-").map(Number);
  return Array.from({ length: count + 1 }, (_, index) => {
    const date = new Date(Date.UTC(year, value - 1 - index, 1));
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
  });
}

function toSalesDay(data: Record<string, unknown>): SalesDay | null {
  if (!data.day || !data.kioskId) return null;
  const date = `${data.year}-${String(data.month).padStart(2, "0")}-${String(data.day).padStart(2, "0")}`;
  const items = Array.isArray(data.items) ? data.items as Array<Record<string, unknown>> : [];
  const products: SalesDay["products"] = {};
  let legacyCents = 0, legacyItems = 0;
  for (const item of items) {
    const qty = Number(item.quantity ?? 0), cents = Math.round(qty * Number(item.unitPrice ?? 0) * 100);
    const key = String(item.simulationId || item.productName || "sem-identificacao");
    const product = products[key] ??= { name: String(item.productName ?? key), qty: 0, cents: 0 };
    product.qty += qty;
    product.cents += cents;
    legacyCents += cents;
    legacyItems += qty;
  }
  const reconciled = Number.isFinite(data.sourceCouponRevenueCents);
  return {
    kioskId: String(data.kioskId), date,
    revenueCents: reconciled ? Number(data.sourceCouponRevenueCents) : legacyCents, reconciled,
    coupons: Number.isFinite(data.sourceCouponCount) ? Number(data.sourceCouponCount) : null,
    items: Number.isFinite(data.sourceItemQuantity) ? Number(data.sourceItemQuantity) : legacyItems,
    products,
  };
}

async function resolveDpUnitId(db: Firestore, kioskId: string, kioskName: string) {
  const byExternal = await db.collection("dp_units").where("externalId", "==", kioskId).limit(2).get();
  if (byExternal.size === 1) return byExternal.docs[0].id;
  if (byExternal.size > 1) return null;
  const byName = await db.collection("dp_units").where("name", "==", kioskName).limit(2).get();
  return byName.size === 1 ? byName.docs[0].id : null;
}

/** Mesma regra do encerramento da meta: dias com turno de trabalho que conta para meta, de quem tem meta individual no período. */
async function scheduledDates(db: Firestore, periodId: string, dpUnitId: string, start: string, end: string) {
  const [year, month] = start.split("-").map(Number);
  const [employeeGoals, schedules] = await Promise.all([
    db.collection("employeeGoals").where("periodId", "==", periodId).limit(MAX_EMPLOYEE_GOALS + 1).get(),
    db.collection("dp_schedules").where("unitId", "==", dpUnitId).where("year", "==", year).where("month", "==", month).limit(2).get(),
  ]);
  if (employeeGoals.size > MAX_EMPLOYEE_GOALS || schedules.size !== 1) return [];
  const shifts = await readOfficialScheduleShifts(db, schedules.docs[0]);
  if (shifts.length > MAX_SHIFTS_PER_SCHEDULE) return [];
  const employees = new Set(employeeGoals.docs.map(document => String(document.get("employeeId") ?? "")));
  const inPeriod = shifts.filter(shift => shift.type === "work" && employees.has(String(shift.userId ?? "")) && shift.date >= start && shift.date <= end);
  const external = new Set(inPeriod.filter(shift => shift.countsTowardGoals === false).map(shift => String(shift.userId)));
  return [...new Set(inPeriod.filter(shift => shift.countsTowardGoals !== false && !external.has(String(shift.userId))).map(shift => String(shift.date)))].sort();
}

export async function loadReportInput(db: Firestore, now: Date) {
  const window = reportWindow(now);
  const currentMonth = window.monthEnd.slice(0, 7);
  const kioskSnapshot = await db.collection("kiosks").limit(50).get();
  const units: Unit[] = kioskSnapshot.docs
    .filter(document => document.id !== "matriz")
    .map(document => ({ id: document.id, name: String(document.get("name") ?? document.id).replace(/^Quiosque\s+/i, "") }));
  const unitIds = new Set(units.map(unit => unit.id));

  // Oito competências cobrem as 26 semanas de histórico e os 6 meses da tendência.
  const months = monthsBack(currentMonth, 7);
  const reportSnapshots = await Promise.all(months.map(({ year, month }) =>
    db.collection("salesReports").where("year", "==", year).where("month", "==", month).limit(unitIds.size * 31 + 50).get()));
  const seen = new Set<string>();
  const days: SalesDay[] = [];
  for (const snapshot of reportSnapshots) for (const document of snapshot.docs) {
    const day = toSalesDay(document.data());
    if (!day || !unitIds.has(day.kioskId) || day.date > window.monthEnd) continue;
    const key = `${day.kioskId}|${day.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    days.push(day);
  }

  const oldest = months[months.length - 1];
  const goalSnapshot = await db.collection("goalPeriods")
    .where("startDate", ">=", Timestamp.fromDate(new Date(Date.UTC(oldest.year, oldest.month - 1, 1))))
    .limit(unitIds.size * 12 + 20).get();
  const goals: GoalMonth[] = [];
  for (const document of goalSnapshot.docs) {
    const data = document.data();
    const start = localDateOf(data.startDate), end = localDateOf(data.endDate);
    const type = data.templateType ?? "revenue";
    if (!start || !end || type !== "revenue" || !unitIds.has(data.kioskId) || data.status === "cancelled") continue;
    let distributionDates = dateRange(start, end);
    let distributionSource: GoalMonth["distributionSource"] = "calendar";
    if (start.slice(0, 7) === currentMonth && data.distributionMode === "scheduled_days") {
      const unit = units.find(entry => entry.id === data.kioskId)!;
      const dpUnitId = await resolveDpUnitId(db, unit.id, String(kioskSnapshot.docs.find(entry => entry.id === unit.id)?.get("name") ?? ""));
      const scheduled = dpUnitId ? await scheduledDates(db, document.id, dpUnitId, start, end) : [];
      if (scheduled.length) { distributionDates = scheduled; distributionSource = "schedule"; }
    }
    goals.push({
      kioskId: data.kioskId, month: start.slice(0, 7), status: String(data.status ?? ""),
      target: Number(data.targetValue ?? 0), up: data.upValue ?? null, top: data.topValue ?? null,
      current: Number(data.currentValue ?? 0), dailyProgress: data.dailyProgress ?? {}, distributionDates, distributionSource,
    });
  }

  const base = appUrl.value().replace(/\/$/, "");
  return {
    now, ...window, units, days, goals,
    links: { goals: `${base}/dashboard/goals/tracking`, analysis: `${base}/dashboard/goals/analysis` },
    thresholds: { onTrack: Number(onTrackPercent.value()), attention: Number(attentionPercent.value()) },
  };
}

async function claimRun(db: Firestore, runId: string) {
  const reference = db.collection("scheduledEmailRuns").doc(runId);
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    if (["sent", "blocked"].includes(snapshot.data()?.status)) return false;
    transaction.set(reference, { kind: "weekly-revenue-goals", status: "sending", startedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return true;
  });
}

export const weeklyRevenueGoalsEmail = onSchedule({
  schedule: "0 8 * * 1", timeZone: TIME_ZONE, retryCount: 2,
  timeoutSeconds: 300, memory: "512MiB", maxInstances: 1, secrets: [resendApiKey],
}, async () => {
  const db = getFirestore("coala");
  const now = new Date();
  const runId = `weekly-revenue-goals-${localDate(now)}`;
  if (!(await claimRun(db, runId))) {
    logger.info("Relatório semanal de faturamento e metas já processado", { runId });
    return;
  }
  const runRef = db.collection("scheduledEmailRuns").doc(runId);
  try {
    const report = buildReport(await loadReportInput(db, now));
    const coverage = weekCoverage(report);
    const minimum = Number(minWeekCoverage.value());
    if (coverage < minimum) {
      // Falha operacional registrada: não enviar números de uma semana sem dados suficientes.
      await runRef.set({ status: "blocked", reason: "week_coverage_below_minimum", coverage, minimum, quality: report.quality, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      logger.error("Relatório semanal bloqueado por cobertura insuficiente", { runId, coverage, minimum, quality: report.quality });
      return;
    }
    const html = renderHtml(report);
    const htmlBytes = Buffer.byteLength(html);
    if (htmlBytes > MAX_HTML_BYTES) logger.warn("HTML do relatório semanal acima do limite de corte do Gmail", { runId, htmlBytes });
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendApiKey.value()}`, "Content-Type": "application/json", "User-Agent": "Coala-One/1.0" },
      body: JSON.stringify({
        from: sender.value(), to: recipients(), subject: renderSubject(report), html, text: renderText(report),
        tags: [{ name: "source", value: "weekly-revenue-goals" }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await response.json().catch(() => ({})) as { id?: string; message?: string };
    if (!response.ok || !payload.id) throw new Error(`Resend respondeu HTTP ${response.status}${payload.message ? `: ${payload.message}` : ""}`);
    await runRef.set({ status: "sent", sentAt: FieldValue.serverTimestamp(), providerId: payload.id, recipients: recipients(), coverage, htmlBytes, quality: report.quality, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    logger.info("Relatório semanal de faturamento e metas enviado", { runId, providerId: payload.id, htmlBytes });
  } catch (error) {
    await runRef.set({ status: "failed", failedAt: Timestamp.now(), error: error instanceof Error ? error.message.slice(0, 500) : "Falha desconhecida", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    throw error;
  }
});
