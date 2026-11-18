import assert from "node:assert/strict";
import test from "node:test";

import type { StudyEntry } from "../../src/features/financial/cash-flow-study/model";
import {
  autoGranularity, buildPeriodRows, futurePresetRange, incomingItems, isStuck, lowestBalance, periodBounds, stuckDays, summarizeStages, visibleEntries,
} from "../../src/features/financial/cash-flow-study/periods";

const TODAY = "2026-11-17"; // terça
const entry = (id: string, date: string, direction: "in" | "out", amountCents: number, partial: Partial<StudyEntry> = {}): StudyEntry => ({
  id, date, direction, source: direction === "in" ? "deposit_boleto" : "expense", certainty: direction === "in" ? "guaranteed" : "payable",
  label: id, detail: "", amountCents, ...partial,
});
const sample = (): StudyEntry[] => [
  entry("sold", "2026-11-20", "in", 100_000, { stage: "boleto" }),
  entry("future", "2026-11-20", "in", 30_000, { certainty: "projected", source: "sales_projected", stage: "projected" }),
  entry("rent", "2026-11-25", "out", 60_000),
  entry("avg", "2026-11-25", "out", 20_000, { certainty: "recurring", source: "expense_recurring" }),
  entry("pay", "2026-12-04", "out", 150_000),
];
const result = (entries = sample()) => ({ entries, startBalanceCents: 50_000, reserveCents: 200_000, minimumCents: 40_000, asOf: TODAY });

test("granularidade automática: até 35 dias por dia, até 2 meses por semana, o resto por mês", () => {
  assert.equal(autoGranularity({ from: TODAY, to: "2026-11-30" }), "day");
  assert.equal(autoGranularity({ from: TODAY, to: "2026-12-21" }), "day", "35 dias");
  assert.equal(autoGranularity({ from: TODAY, to: "2026-12-31" }), "week");
  assert.equal(autoGranularity({ from: TODAY, to: "2027-01-31" }), "month");
  assert.deepEqual(futurePresetRange("next_month", TODAY), { from: TODAY, to: "2026-12-31" });
  assert.deepEqual(futurePresetRange("this_month", TODAY), { from: TODAY, to: "2026-11-30" });
  assert.deepEqual(futurePresetRange("three_months", TODAY), { from: TODAY, to: "2027-01-31" });
});

test("recortes: dia, semana de segunda a domingo (cortada no período) e mês", () => {
  const week = periodBounds({ from: "2026-11-17", to: "2026-12-06" }, "week");
  assert.deepEqual(week.map(item => [item.start, item.end]), [["2026-11-17", "2026-11-22"], ["2026-11-23", "2026-11-29"], ["2026-11-30", "2026-12-06"]]);
  assert.equal(week[0].weekStart, "2026-11-16");
  const month = periodBounds({ from: "2026-11-17", to: "2027-01-10" }, "month");
  assert.deepEqual(month.map(item => [item.month, item.start, item.end]), [["2026-11", "2026-11-17", "2026-11-30"], ["2026-12", "2026-12-01", "2026-12-31"], ["2027-01", "2027-01-01", "2027-01-10"]]);
  assert.equal(periodBounds({ from: "2026-11-17", to: "2026-11-19" }, "day").length, 3);
});

test("sem projeção só entra o que já existe; com projeção somam vendas futuras e saídas recorrentes", () => {
  assert.deepEqual(visibleEntries(sample(), false).map(item => item.id), ["sold", "rent", "pay"]);
  const range = { from: TODAY, to: "2026-12-31" };
  const without = buildPeriodRows(result(), { range, granularity: "week", projection: false, includeReserve: false });
  const withProjection = buildPeriodRows(result(), { range, granularity: "week", projection: true, includeReserve: false });
  assert.equal(without.at(-1)!.closingCents, 50_000 + 100_000 - 60_000 - 150_000);
  assert.equal(withProjection.at(-1)!.closingCents, 50_000 + 100_000 + 30_000 - 60_000 - 20_000 - 150_000);
  const first = withProjection[0];
  assert.equal(first.inSoldCents, 100_000);
  assert.equal(first.inProjectedCents, 30_000);
  assert.equal(first.openingCents, 50_000);
  assert.equal(withProjection[1].openingCents, first.closingCents);
});

test("o saldo é sempre calculado desde hoje, mesmo quando o período começa depois", () => {
  const rows = buildPeriodRows(result(), { range: { from: "2026-12-01", to: "2026-12-31" }, granularity: "month", projection: false, includeReserve: false });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].openingCents, 50_000 + 100_000 - 60_000, "tudo que acontece antes de 01/12 já está no saldo de abertura");
  assert.equal(rows[0].closingCents, rows[0].openingCents - 150_000);
});

test("reserva só entra no saldo quando marcada", () => {
  const range = { from: TODAY, to: "2026-11-30" };
  const without = buildPeriodRows(result(), { range, granularity: "day", projection: false, includeReserve: false });
  const withReserve = buildPeriodRows(result(), { range, granularity: "day", projection: false, includeReserve: true });
  assert.equal(withReserve[0].openingCents - without[0].openingCents, 200_000);
});

test("situação do período: negativo, abaixo do mínimo, normal, folga", () => {
  const rows = buildPeriodRows(result(), { range: { from: TODAY, to: "2026-12-31" }, granularity: "week", projection: false, includeReserve: false });
  assert.equal(rows.at(-1)!.status, "negative");
  const ok = buildPeriodRows({ ...result([]), startBalanceCents: 90_000 }, { range: { from: TODAY, to: TODAY }, granularity: "day", projection: false, includeReserve: false });
  assert.equal(ok[0].status, "comfortable", "dobro do mínimo ou mais");
  const normal = buildPeriodRows({ ...result([]), startBalanceCents: 50_000 }, { range: { from: TODAY, to: TODAY }, granularity: "day", projection: false, includeReserve: false });
  assert.equal(normal[0].status, "normal");
  const below = buildPeriodRows({ ...result([]), startBalanceCents: 10_000 }, { range: { from: TODAY, to: TODAY }, granularity: "day", projection: false, includeReserve: false });
  assert.equal(below[0].status, "below_minimum");
});

test("menor saldo do período e dias abaixo do mínimo", () => {
  const range = { from: TODAY, to: "2026-12-31" };
  const low = lowestBalance(result(), { range, projection: false, includeReserve: false });
  assert.deepEqual(low.lowest, { date: "2026-12-04", cents: -60_000 });
  assert.equal(low.firstBelow, "2026-12-04", "em 25/11 o saldo ainda está acima do mínimo");
  assert.ok(low.daysBelowMinimum > 0);
  const narrow = lowestBalance(result(), { range: { from: TODAY, to: "2026-11-24" }, projection: false, includeReserve: false });
  assert.equal(narrow.lowest!.date, TODAY);
});

test("pendência: boleto vencido conta os dias de atraso; contagem e depósito só depois do prazo", () => {
  const late = entry("late", TODAY, "in", 380_000, { stage: "boleto", lateFrom: "2026-11-13" });
  assert.equal(stuckDays(late, TODAY), 4);
  const waiting = entry("open", "2026-12-01", "in", 238_000, { stage: "cash_open", sinceDate: "2026-11-14" });
  assert.equal(stuckDays(waiting, TODAY), 3);
  const fresh = entry("fresh", "2026-12-01", "in", 115_000, { stage: "cash_open", sinceDate: "2026-11-16" });
  assert.equal(isStuck(fresh, TODAY), false, "1 dia ainda é normal");
  const counted = entry("counted", "2026-11-27", "in", 410_000, { stage: "counted", sinceDate: "2026-11-15" });
  assert.equal(stuckDays(counted, TODAY), null, "2 dias: dentro do prazo do depósito");
  assert.equal(stuckDays({ ...counted, sinceDate: "2026-11-14" }, TODAY), 3);
  assert.equal(isStuck(entry("stone", TODAY, "in", 1, { stage: "stone" }), TODAY), false);
  assert.equal(isStuck(entry("pay", TODAY, "out", 1), TODAY), false, "saída nunca é pendência");
  assert.equal(isStuck(entry("proj", TODAY, "in", 1, { certainty: "projected", stage: "projected" }), TODAY), false);
});

test("etapas: totais por etapa, pendências e o mais antigo", () => {
  const items = [
    entry("late", TODAY, "in", 380_000, { stage: "boleto", lateFrom: "2026-11-13" }),
    entry("ok", "2026-11-24", "in", 690_000, { stage: "boleto" }),
    entry("open", "2026-12-01", "in", 238_000, { stage: "cash_open", sinceDate: "2026-11-14" }),
    entry("stone", "2026-11-18", "in", 29_000, { stage: "stone" }),
    entry("future", "2026-11-19", "in", 10_000, { certainty: "projected", stage: "projected" }),
  ];
  const summary = summarizeStages(items, TODAY);
  assert.equal(summary.total.cents, 380_000 + 690_000 + 238_000 + 29_000 + 10_000);
  assert.equal(summary.byStage.boleto.cents, 1_070_000);
  assert.equal(summary.byStage.boleto.stuckCount, 1);
  assert.equal(summary.byStage.boleto.oldestDays, 4);
  assert.equal(summary.byStage.cash_open.oldestDays, 3);
  assert.equal(summary.stuck.count, 2);
  assert.equal(summary.stuck.cents, 618_000);
  assert.equal(summary.stuck.oldestDays, 4);
  assert.equal(summary.byStage.stone.stuckCount, 0);
});

test("itens de entrada: do período mais as pendências, que aparecem sempre", () => {
  const entries = [
    entry("late", TODAY, "in", 380_000, { stage: "boleto", lateFrom: "2026-11-13" }),
    entry("in-range", "2026-12-10", "in", 10_000, { stage: "boleto" }),
    entry("later", "2027-02-01", "in", 10_000, { stage: "boleto" }),
    entry("pay", "2026-12-10", "out", 10_000),
  ];
  const ids = (range: { from: string; to: string }, projection = false) => incomingItems({ entries, asOf: TODAY }, range, projection).map(item => item.id);
  assert.deepEqual(ids({ from: "2026-12-01", to: "2026-12-31" }), ["late", "in-range"]);
  assert.deepEqual(ids({ from: "2026-12-01", to: "2026-12-31" }, true), ["late", "in-range"]);
});
