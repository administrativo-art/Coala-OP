/**
 * Recorte do estudo por período: agrupamento (dia, semana, mês), saldo corrente, etapas do dinheiro já vendido
 * e pendências. Puro, compartilhado entre as abas da Visão do caixa. O saldo é sempre calculado desde hoje;
 * o período só escolhe o que aparece.
 */
import { addDays, addMonths, daysBetween, monthEnd, STUCK_AFTER_DAYS, weekStart, type EntryStage, type StudyEntry, type StudyResult } from "./model";

export type Granularity = "day" | "week" | "month";
export type StudyRange = { from: string; to: string };
export type FuturePreset = "this_month" | "next_month" | "three_months" | "custom";

export const isProjection = (entry: StudyEntry) => entry.certainty === "projected" || entry.certainty === "recurring";
export const visibleEntries = (entries: StudyEntry[], projection: boolean) => (projection ? entries : entries.filter(entry => !isProjection(entry)));
const signed = (entry: StudyEntry) => (entry.direction === "in" ? entry.amountCents : -entry.amountCents);

export function futurePresetRange(preset: Exclude<FuturePreset, "custom">, today: string): StudyRange {
  const month = today.slice(0, 7);
  if (preset === "this_month") return { from: today, to: monthEnd(month) };
  if (preset === "next_month") return { from: today, to: monthEnd(addMonths(month, 1)) };
  return { from: today, to: monthEnd(addMonths(month, 2)) };
}

/** Até 35 dias: dia. Até dois meses: semana. Acima disso: mês. */
export function autoGranularity(range: StudyRange): Granularity {
  if (daysBetween(range.from, range.to) + 1 <= 35) return "day";
  const months = (Number(range.to.slice(0, 4)) * 12 + Number(range.to.slice(5, 7))) - (Number(range.from.slice(0, 4)) * 12 + Number(range.from.slice(5, 7))) + 1;
  return months <= 2 ? "week" : "month";
}

export const startingBalance = (result: Pick<StudyResult, "startBalanceCents" | "reserveCents">, includeReserve: boolean) =>
  (result.startBalanceCents ?? 0) + (includeReserve ? result.reserveCents : 0);

export type PeriodStatus = "comfortable" | "normal" | "below_minimum" | "negative";
export type PeriodRow = {
  key: string; start: string; end: string; weekStart: string | null; month: string | null;
  entries: StudyEntry[];
  openingCents: number; closingCents: number;
  inCents: number; inSoldCents: number; inProjectedCents: number;
  outCents: number; outLaunchedCents: number; outRecurringCents: number;
  status: PeriodStatus;
};
export type PeriodOptions = { range: StudyRange; granularity: Granularity; projection: boolean; includeReserve: boolean };

export function periodBounds(range: StudyRange, granularity: Granularity) {
  const bounds: Array<{ start: string; end: string; weekStart: string | null; month: string | null }> = [];
  if (granularity === "day") {
    for (let day = range.from; day <= range.to; day = addDays(day, 1)) bounds.push({ start: day, end: day, weekStart: null, month: null });
  } else if (granularity === "week") {
    for (let start = weekStart(range.from); start <= range.to; start = addDays(start, 7)) {
      const end = addDays(start, 6);
      bounds.push({ start: start < range.from ? range.from : start, end: end > range.to ? range.to : end, weekStart: start, month: null });
    }
  } else {
    for (let month = range.from.slice(0, 7); `${month}-01` <= range.to; month = addMonths(month, 1)) {
      const first = `${month}-01`, last = monthEnd(month);
      bounds.push({ start: first < range.from ? range.from : first, end: last > range.to ? range.to : last, weekStart: null, month });
    }
  }
  return bounds;
}

function statusFor(balance: number, minimum: number | null): PeriodStatus {
  if (balance < 0) return "negative";
  if (minimum !== null && balance < minimum) return "below_minimum";
  if (minimum !== null && balance >= minimum * 2) return "comfortable";
  return "normal";
}

export function buildPeriodRows(result: Pick<StudyResult, "entries" | "startBalanceCents" | "reserveCents" | "minimumCents">, options: PeriodOptions): PeriodRow[] {
  const entries = visibleEntries(result.entries, options.projection);
  let balance = startingBalance(result, options.includeReserve) + entries.filter(entry => entry.date < options.range.from).reduce((sum, entry) => sum + signed(entry), 0);
  return periodBounds(options.range, options.granularity).map(bound => {
    const inPeriod = entries.filter(entry => entry.date >= bound.start && entry.date <= bound.end)
      .sort((a, b) => a.date.localeCompare(b.date) || a.direction.localeCompare(b.direction) || b.amountCents - a.amountCents);
    const incoming = inPeriod.filter(entry => entry.direction === "in");
    const outgoing = inPeriod.filter(entry => entry.direction === "out");
    const sum = (list: StudyEntry[]) => list.reduce((total, entry) => total + entry.amountCents, 0);
    const openingCents = balance;
    balance += sum(incoming) - sum(outgoing);
    return {
      key: bound.start, ...bound, entries: inPeriod, openingCents, closingCents: balance,
      inCents: sum(incoming), inSoldCents: sum(incoming.filter(entry => !isProjection(entry))), inProjectedCents: sum(incoming.filter(isProjection)),
      outCents: sum(outgoing), outLaunchedCents: sum(outgoing.filter(entry => !isProjection(entry))), outRecurringCents: sum(outgoing.filter(isProjection)),
      status: statusFor(balance, result.minimumCents),
    };
  });
}

/** Menor saldo de fim de dia dentro do período. */
export function lowestBalance(result: Pick<StudyResult, "entries" | "startBalanceCents" | "reserveCents" | "minimumCents">, options: Omit<PeriodOptions, "granularity">) {
  const days = buildPeriodRows(result, { ...options, granularity: "day" });
  const below = days.filter(day => result.minimumCents !== null && day.closingCents < result.minimumCents);
  const lowest = days.reduce<PeriodRow | null>((best, day) => (!best || day.closingCents < best.closingCents ? day : best), null);
  return { lowest: lowest ? { date: lowest.start, cents: lowest.closingCents } : null, daysBelowMinimum: below.length, firstBelow: below[0]?.start ?? null, lastBelow: below.at(-1)?.start ?? null };
}

// ---------- etapas do dinheiro já vendido ----------
export const STAGE_ORDER: EntryStage[] = ["cash_open", "counted", "boleto", "stone"];
export const STAGE_LABEL: Record<EntryStage, string> = {
  cash_open: "Aguardando contagem", counted: "Contado, sem boleto", boleto: "Boleto emitido", stone: "Stone a receber", projected: "Vendas futuras",
};

export const isIncomingSold = (entry: StudyEntry) => entry.direction === "in" && !isProjection(entry);

/** Dias que o valor espera a próxima etapa; boleto vencido conta os dias de atraso. */
export function stuckDays(entry: StudyEntry, today: string): number | null {
  if (!isIncomingSold(entry)) return null;
  if (entry.lateFrom) return Math.max(daysBetween(entry.lateFrom, today), 1);
  if (entry.stage === "cash_open" || entry.stage === "counted") {
    const waiting = entry.sinceDate ? daysBetween(entry.sinceDate, today) : 0;
    return waiting >= STUCK_AFTER_DAYS[entry.stage] ? waiting : null;
  }
  return null;
}
export const isStuck = (entry: StudyEntry, today: string) => stuckDays(entry, today) !== null;

export type StageSummary = { cents: number; count: number; stuckCount: number; stuckCents: number; oldestDays: number | null };
const emptySummary = (): StageSummary => ({ cents: 0, count: 0, stuckCount: 0, stuckCents: 0, oldestDays: null });

/** Entradas a mostrar: as do período mais as pendências, que aparecem sempre. */
export function incomingItems(result: Pick<StudyResult, "entries" | "asOf">, range: StudyRange, projection: boolean) {
  return visibleEntries(result.entries, projection).filter(entry => entry.direction === "in" && ((entry.date >= range.from && entry.date <= range.to) || isStuck(entry, result.asOf)));
}

export function summarizeStages(items: StudyEntry[], today: string) {
  const byStage = Object.fromEntries((["cash_open", "counted", "boleto", "stone", "projected"] as EntryStage[]).map(stage => [stage, emptySummary()])) as Record<EntryStage, StageSummary>;
  const total = emptySummary();
  const stuck = emptySummary();
  for (const entry of items) {
    const stage = entry.stage ?? "projected";
    const days = stuckDays(entry, today);
    for (const target of [byStage[stage], total]) { target.cents += entry.amountCents; target.count += 1; }
    if (days !== null) {
      for (const target of [byStage[stage], stuck]) {
        target.stuckCount += 1; target.stuckCents += entry.amountCents;
        target.oldestDays = Math.max(target.oldestDays ?? 0, days);
      }
    }
  }
  stuck.cents = stuck.stuckCents; stuck.count = stuck.stuckCount;
  return { total, stuck, byStage };
}
