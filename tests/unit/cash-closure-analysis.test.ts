import assert from "node:assert/strict";
import { test } from "node:test";

import {
  activeSessionScopeKeys,
  aggregateMonthlySummaries,
  closureDayStatus,
  elapsedDays,
  monthDayStatuses,
  sessionKioskCards,
  trailingMonths,
  unitMonthStats,
  waitingUnits,
} from "../../src/features/financial/cash-closures/analysis";
import type { CashClosure, CashClosureMonthlySummary } from "../../src/features/financial/cash-closures/types";

const closure = (date: string, status: CashClosure["status"], differenceTotalCents = 0) => {
  const [year, month] = date.split("-").map(Number);
  return { date, year, month, status, differenceTotalCents } as CashClosure;
};
const summary = (year: number, month: number, approvedCount: number, extra: Partial<CashClosureMonthlySummary> = {}) =>
  ({ year, month, approvedCount, expectedTotalCents: 1000, countedTotalCents: 900, differenceTotalCents: -10, countedCashCents: 500, allocatedCashCents: 400, issuedCashCents: 300, paidCashCents: 200, ...extra }) as CashClosureMonthlySummary;

test("situação do dia segue a regra do calendário e não trata hoje ou futuro como pendência", () => {
  const today = "2026-11-16";
  assert.equal(closureDayStatus(undefined, "2026-11-17", today), "future");
  assert.equal(closureDayStatus(undefined, today, today), "today");
  assert.equal(closureDayStatus(undefined, "2026-11-10", today), "missing");
  assert.equal(closureDayStatus(closure("2026-11-10", "sync_error"), "2026-11-10", today), "error");
  assert.equal(closureDayStatus(closure("2026-11-10", "reopened"), "2026-11-10", today), "draft");
  assert.equal(closureDayStatus(closure("2026-11-10", "pending_review"), "2026-11-10", today), "pending");
  assert.equal(closureDayStatus(closure("2026-11-10", "approved", -500), "2026-11-10", today), "difference");
  assert.equal(closureDayStatus(closure("2026-11-10", "approved"), "2026-11-10", today), "ok");
});

test("dias decorridos e estatística do mês contam só os dias já passados", () => {
  const today = "2026-11-16";
  assert.equal(elapsedDays(2026, 11, today), 15);
  assert.equal(elapsedDays(2026, 10, today), 31);
  assert.equal(elapsedDays(2026, 12, today), 0);
  const days = monthDayStatuses(2026, 11, [closure("2026-11-01", "approved"), closure("2026-11-02", "approved", 100), closure("2026-11-03", "pending_review")], today);
  assert.equal(days.length, 30);
  const stats = unitMonthStats(days);
  assert.deepEqual(stats, { elapsed: 15, closed: 2, pending: 13, future: 15, differenceDays: 1 });
});

test("agregação mensal soma unidades e conta pendências como dias passados não aprovados", () => {
  const today = "2026-11-16";
  const [october, november] = aggregateMonthlySummaries(
    [
      { kioskId: "a", summaries: [summary(2026, 10, 31), summary(2026, 11, 13)] },
      { kioskId: "b", summaries: [summary(2026, 10, 28)] },
    ],
    [{ year: 2026, month: 10 }, { year: 2026, month: 11 }],
    today,
  );
  assert.equal(october.elapsedDays, 62);
  assert.equal(october.approvedDays, 59);
  assert.equal(october.pendingDays, 3);
  assert.equal(october.expectedCents, 2000);
  assert.equal(november.elapsedDays, 30);
  assert.equal(november.approvedDays, 13);
  assert.equal(november.pendingDays, 17);
  assert.equal(november.paidCashCents, 200);
});

test("meses finais em ordem crescente atravessam o ano", () => {
  assert.deepEqual(trailingMonths(2026, 2, 3), [{ year: 2025, month: 12 }, { year: 2026, month: 1 }, { year: 2026, month: 2 }]);
});

test("sessão ativa vira um cartão por quiosque com os operadores daquele quiosque", () => {
  const cards = sessionKioskCards({
    id: "s1",
    scopes: [
      { key: "k1_2026_10", kioskId: "k1", kioskName: "Tirirical", year: 2026, month: 10 },
      { key: "k2_2026_11", kioskId: "k2", kioskName: "João Paulo", year: 2026, month: 11 },
      { key: "k1_2026_11", kioskId: "k1", kioskName: "Tirirical", year: 2026, month: 11 },
    ],
    finalizedOperatorCountsByScope: { k1_2026_10: 2, k1_2026_11: 1, k2_2026_11: 3 },
  });
  assert.equal(cards.length, 2);
  assert.deepEqual(cards[0].periods, [{ year: 2026, month: 10 }, { year: 2026, month: 11 }]);
  assert.equal(cards[0].finalizedOperators, 3);
  assert.equal(cards[1].finalizedOperators, 3);
});

test("dias aguardando contagem excluem meses já cobertos por sessão ativa", () => {
  const today = "2026-11-16";
  const scopeKeys = activeSessionScopeKeys([{ scopes: [{ key: "x", kioskId: "a", kioskName: "A", year: 2026, month: 11 }] }]);
  const waiting = waitingUnits(
    [
      { kioskId: "a", summaries: [summary(2026, 10, 28), summary(2026, 11, 9)] },
      { kioskId: "b", summaries: [summary(2026, 11, 15)] },
    ],
    [{ year: 2026, month: 10 }, { year: 2026, month: 11 }],
    today,
    scopeKeys,
  );
  assert.deepEqual(waiting, [{ kioskId: "a", months: [{ year: 2026, month: 10, pendingDays: 3 }], pendingDays: 3 }]);
});
