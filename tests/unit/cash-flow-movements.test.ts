import assert from "node:assert/strict";
import test from "node:test";

import {
  autoPastGranularity, groupMovements, isUnlinkedOutflow, matchesMovementFilter, movementDay, movementsInRange, pastPresetRange, summarizeMovements,
  type CashMovement,
} from "../../src/features/financial/components/cash-flow/movements-model";

const at = (day: string, hour = 12) => new Date(`${day}T${String(hour).padStart(2, "0")}:00:00`);
const movement = (id: string, day: string, direction: "in" | "out", amount: number, partial: Partial<CashMovement> = {}): CashMovement => ({
  id, date: at(day), description: id, direction, status: "realized", amount, accountId: "inter", expenseId: direction === "out" ? "e1" : undefined, ...partial,
});

const list = [
  movement("venda", "2026-11-03", "in", 1_000),
  movement("aluguel", "2026-11-05", "out", 400),
  movement("pix", "2026-11-12", "out", 84, { expenseId: undefined }),
  movement("boleto", "2026-11-14", "out", 236, { expenseId: undefined }),
  movement("outra-conta", "2026-11-14", "in", 50, { accountId: "cdb" }),
  movement("antigo", "2026-10-28", "in", 700),
  movement("previsto", "2026-11-20", "out", 999, { status: "forecast" }),
];
const range = { from: "2026-11-01", to: "2026-11-17" };

test("o recorte usa a data local, só movimentos realizados e a conta escolhida", () => {
  assert.equal(movementDay({ date: at("2026-11-17", 23) }), "2026-11-17");
  assert.deepEqual(movementsInRange(list, range).map(item => item.id), ["venda", "aluguel", "pix", "boleto", "outra-conta"]);
  assert.deepEqual(movementsInRange(list, range, "inter").map(item => item.id), ["venda", "aluguel", "pix", "boleto"]);
  assert.deepEqual(movementsInRange(list, { from: "2026-11-14", to: "2026-11-14" }).map(item => item.id), ["boleto", "outra-conta"], "o dia inteiro conta");
});

test("saída sem despesa vinculada é pendência; entrada nunca", () => {
  assert.equal(isUnlinkedOutflow(movement("a", "2026-11-12", "out", 1, { expenseId: undefined })), true);
  assert.equal(isUnlinkedOutflow(movement("b", "2026-11-12", "out", 1)), false);
  assert.equal(isUnlinkedOutflow(movement("c", "2026-11-12", "in", 1, { expenseId: undefined })), false);
  assert.equal(matchesMovementFilter(list[2], "unlinked"), true);
  assert.equal(matchesMovementFilter(list[1], "unlinked"), false);
  assert.equal(matchesMovementFilter(list[0], "in"), true);
  assert.equal(matchesMovementFilter(list[0], "out"), false);
});

test("resumo: entrou, saiu, resultado e pendências", () => {
  const summary = summarizeMovements(movementsInRange(list, range));
  assert.equal(summary.inAmount, 1_050);
  assert.equal(summary.outAmount, 720);
  assert.equal(summary.resultAmount, 330);
  assert.equal(summary.count, 5);
  assert.equal(summary.unlinkedCount, 2);
  assert.equal(summary.unlinkedAmount, 320);
});

test("grupos do mais recente para o mais antigo, com totais por grupo", () => {
  const days = groupMovements(movementsInRange(list, range), range, "day");
  assert.equal(days[0].start, "2026-11-17");
  assert.equal(days.length, 17);
  const withMovements = days.filter(group => group.movements.length).map(group => group.start);
  assert.deepEqual(withMovements, ["2026-11-14", "2026-11-12", "2026-11-05", "2026-11-03"]);
  const weeks = groupMovements(movementsInRange(list, range), range, "week");
  assert.equal(weeks[0].weekStart, "2026-11-16");
  const week = weeks.find(group => group.weekStart === "2026-11-09")!;
  assert.equal(week.inAmount, 50);
  assert.equal(week.outAmount, 320);
  const months = groupMovements(movementsInRange(list, { from: "2026-10-01", to: "2026-11-17" }), { from: "2026-10-01", to: "2026-11-17" }, "month");
  assert.deepEqual(months.map(group => group.month), ["2026-11", "2026-10"]);
  assert.equal(months[1].inAmount, 700);
});

test("atalhos do passado terminam hoje ou no fim do mês passado; agrupamento automático", () => {
  const today = "2026-11-17";
  assert.deepEqual(pastPresetRange("current_month", today), { from: "2026-11-01", to: today });
  assert.deepEqual(pastPresetRange("last_month", today), { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(pastPresetRange("last_3_months", today), { from: "2026-09-01", to: today });
  assert.deepEqual(pastPresetRange("last_6_months", today), { from: "2026-06-01", to: today });
  assert.equal(autoPastGranularity(pastPresetRange("current_month", today)), "day");
  assert.equal(autoPastGranularity(pastPresetRange("last_3_months", today)), "week");
  assert.equal(autoPastGranularity(pastPresetRange("last_6_months", today)), "month");
});
