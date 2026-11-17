import type { CashCountingSession } from "@/features/financial/cash-counting-sessions/types";
import { CASH_CLOSURE_DRE_VERSION } from "../../../../functions/src/cash-closure-dre";
import type { CashClosure, CashClosureMonthlySummary } from "./types";

/** Situação de um dia de fechamento na análise (somente leitura). */
export type ClosureDayStatus = "ok" | "difference" | "pending" | "draft" | "error" | "missing" | "today" | "future";

export const CLOSED_DAY_STATUSES: ReadonlySet<ClosureDayStatus> = new Set(["ok", "difference"]);

type DayStatusSource = Pick<CashClosure, "status" | "differenceTotalCents">;

export function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function monthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function dateKey(year: number, month: number, day: number) {
  return `${monthKey(year, month)}-${String(day).padStart(2, "0")}`;
}

/** Mesma regra do calendário: aprovado com diferença ≠ bateu; o dia de hoje e os futuros não são pendência. */
export function closureDayStatus(closure: DayStatusSource | undefined, date: string, today: string): ClosureDayStatus {
  if (date > today) return "future";
  if (!closure) return date === today ? "today" : "missing";
  if (closure.status === "sync_error") return "error";
  if (closure.status === "draft" || closure.status === "reopened") return "draft";
  if (closure.status === "pending_review") return "pending";
  if (closure.status === "approved") return closure.differenceTotalCents !== 0 ? "difference" : "ok";
  if (closure.status === "not_synced") return date === today ? "today" : "missing";
  return "pending";
}

export type MonthDayStatus = { day: number; date: string; status: ClosureDayStatus; closure?: CashClosure };

export function monthDayStatuses(year: number, month: number, closures: CashClosure[], today: string): MonthDayStatus[] {
  const byDate = new Map(closures.filter((closure) => closure.year === year && closure.month === month).map((closure) => [closure.date, closure]));
  return Array.from({ length: daysInMonth(year, month) }, (_, index) => {
    const day = index + 1;
    const date = dateKey(year, month, day);
    const closure = byDate.get(date);
    return { day, date, status: closureDayStatus(closure, date, today), closure };
  });
}

/** Dias já passados (antes de hoje) do mês. Hoje ainda está acontecendo e não conta. */
export function elapsedDays(year: number, month: number, today: string) {
  const first = dateKey(year, month, 1);
  if (first > today) return 0;
  const total = daysInMonth(year, month);
  const [todayYear, todayMonth, todayDay] = today.split("-").map(Number);
  if (todayYear === year && todayMonth === month) return Math.max(todayDay - 1, 0);
  return total;
}

export type UnitMonthStats = {
  elapsed: number;
  closed: number;
  pending: number;
  future: number;
  differenceDays: number;
};

export function unitMonthStats(days: MonthDayStatus[]): UnitMonthStats {
  let closed = 0, pending = 0, future = 0, differenceDays = 0;
  for (const day of days) {
    if (day.status === "future" || day.status === "today") { future++; continue; }
    if (CLOSED_DAY_STATUSES.has(day.status)) {
      closed++;
      if (day.status === "difference") differenceDays++;
    } else pending++;
  }
  return { elapsed: closed + pending, closed, pending, future, differenceDays };
}

export type MonthAggregate = {
  key: string;
  year: number;
  month: number;
  unitCount: number;
  elapsedDays: number;
  approvedDays: number;
  pendingDays: number;
  /** Esperado para conferência: vendas + suprimentos − sangrias (inclui o fundo de caixa de cada dia). */
  expectedCents: number;
  /** Vendas dos cupons do PDV, sem suprimentos nem sangrias; soma só as unidades com venda apurada. */
  salesCents: number;
  /** Unidades com fechamentos no mês, mas sem venda apurada no resumo (então `salesCents` é parcial). */
  salesMissingUnits: number;
  countedCents: number;
  differenceCents: number;
  countedCashCents: number;
  allocatedCashCents: number;
  issuedCashCents: number;
  paidCashCents: number;
};

/**
 * Vendas do PDV de um resumo mensal (cupons, sem suprimentos e sangrias). É o mesmo total que a DRE e as metas usam.
 * `null` quando o resumo não tem a venda de todos os dias (sincronização com erro ou resumo antigo).
 */
export function monthlySummarySalesCents(summary: Pick<CashClosureMonthlySummary, "closureCount" | "dreVersion" | "dreRevenueTotalCents">): number | null {
  if (summary.closureCount === 0) return 0;
  const value = summary.dreRevenueTotalCents;
  return summary.dreVersion === CASH_CLOSURE_DRE_VERSION && Number.isSafeInteger(value) && value! >= 0 ? value! : null;
}

/**
 * Soma os resumos mensais das unidades do recorte, mês a mês.
 * Pendências contam os dias já passados que ainda não foram aprovados, inclusive dias sem fechamento sincronizado.
 */
export function aggregateMonthlySummaries(
  summariesByUnit: Array<{ kioskId: string; summaries: CashClosureMonthlySummary[] }>,
  months: Array<{ year: number; month: number }>,
  today: string,
): MonthAggregate[] {
  return months.map(({ year, month }) => {
    const elapsed = elapsedDays(year, month, today);
    const aggregate: MonthAggregate = {
      key: monthKey(year, month), year, month, unitCount: summariesByUnit.length, elapsedDays: elapsed * summariesByUnit.length,
      approvedDays: 0, pendingDays: 0, expectedCents: 0, salesCents: 0, salesMissingUnits: 0, countedCents: 0, differenceCents: 0,
      countedCashCents: 0, allocatedCashCents: 0, issuedCashCents: 0, paidCashCents: 0,
    };
    for (const unit of summariesByUnit) {
      const summary = unit.summaries.find((item) => item.year === year && item.month === month);
      const approved = Math.min(summary?.approvedCount ?? 0, elapsed);
      aggregate.approvedDays += approved;
      aggregate.pendingDays += Math.max(elapsed - approved, 0);
      if (!summary) continue;
      aggregate.expectedCents += summary.expectedTotalCents ?? 0;
      const sales = monthlySummarySalesCents(summary);
      if (sales === null) aggregate.salesMissingUnits++;
      else aggregate.salesCents += sales;
      aggregate.countedCents += summary.countedTotalCents ?? 0;
      aggregate.differenceCents += summary.differenceTotalCents ?? 0;
      aggregate.countedCashCents += summary.countedCashCents ?? 0;
      aggregate.allocatedCashCents += summary.allocatedCashCents ?? 0;
      aggregate.issuedCashCents += summary.issuedCashCents ?? 0;
      aggregate.paidCashCents += summary.paidCashCents ?? 0;
    }
    return aggregate;
  });
}

/** Últimos `count` meses terminando em `year/month`, do mais antigo ao mais recente. */
export function trailingMonths(year: number, month: number, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const offset = count - 1 - index;
    const date = new Date(Date.UTC(year, month - 1 - offset, 1));
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
  });
}

export type SessionKioskCard = {
  sessionId: string;
  kioskId: string;
  kioskName: string;
  periods: Array<{ year: number; month: number }>;
  finalizedOperators: number;
};

/** Um cartão por quiosque de cada sessão ativa, com os meses dela e os operadores já finalizados naquele quiosque. */
export function sessionKioskCards(session: Pick<CashCountingSession, "id" | "scopes" | "finalizedOperatorCountsByScope">): SessionKioskCard[] {
  const byKiosk = new Map<string, SessionKioskCard>();
  for (const scope of session.scopes ?? []) {
    const card = byKiosk.get(scope.kioskId) ?? { sessionId: session.id, kioskId: scope.kioskId, kioskName: scope.kioskName, periods: [], finalizedOperators: 0 };
    card.periods.push({ year: scope.year, month: scope.month });
    card.finalizedOperators += session.finalizedOperatorCountsByScope?.[scope.key] ?? 0;
    byKiosk.set(scope.kioskId, card);
  }
  return [...byKiosk.values()].map((card) => ({ ...card, periods: card.periods.sort((a, b) => a.year - b.year || a.month - b.month) }));
}

/** Quiosque+mês já cobertos por alguma sessão ativa (para marcar "Na sessão" na análise). */
export function activeSessionScopeKeys(sessions: Array<Pick<CashCountingSession, "scopes">>) {
  return new Set(sessions.flatMap((session) => (session.scopes ?? []).map((scope) => `${scope.kioskId}:${monthKey(scope.year, scope.month)}`)));
}

export type WaitingUnit = { kioskId: string; months: Array<{ year: number; month: number; pendingDays: number }>; pendingDays: number };

/**
 * Dias aguardando contagem por quiosque, a partir dos resumos mensais: dias já passados ainda não aprovados.
 * Meses cobertos por uma sessão ativa ficam de fora (já estão sendo contados).
 */
export function waitingUnits(
  summariesByUnit: Array<{ kioskId: string; summaries: CashClosureMonthlySummary[] }>,
  months: Array<{ year: number; month: number }>,
  today: string,
  sessionScopeKeys: Set<string>,
): WaitingUnit[] {
  return summariesByUnit
    .map(({ kioskId, summaries }) => {
      const pending = months
        .filter(({ year, month }) => !sessionScopeKeys.has(`${kioskId}:${monthKey(year, month)}`))
        .map(({ year, month }) => {
          const elapsed = elapsedDays(year, month, today);
          const summary = summaries.find((item) => item.year === year && item.month === month);
          if (!summary && elapsed === 0) return { year, month, pendingDays: 0 };
          return { year, month, pendingDays: Math.max(elapsed - Math.min(summary?.approvedCount ?? 0, elapsed), 0) };
        })
        .filter((item) => item.pendingDays > 0 && summaries.some((summary) => summary.year === item.year && summary.month === item.month));
      return { kioskId, months: pending, pendingDays: pending.reduce((total, item) => total + item.pendingDays, 0) };
    })
    .filter((unit) => unit.pendingDays > 0)
    .sort((a, b) => b.pendingDays - a.pendingDays);
}
