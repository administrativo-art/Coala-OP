import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildCashClosureFromPdv } from "../../src/features/financial/cash-closures/build-cash-closure";
import { buildCashClosureOperators, withCashClosureOperatorAggregate } from "../../src/features/financial/cash-closures/operators";
import { mergeBuiltClosureForPersistence, normalizeCashClosureWithLines, recalculateCountedLine,
  recalculateExpectedLine, recomputeCashClosureFromLines } from "../../src/features/financial/cash-closures/persistence";
import { summarizeCashClosureDre } from "../../src/features/financial/cash-closures/dre-contract";
import { summarizeCashClosureDre as functionsProjection } from "../../functions/src/cash-closure-dre";
import type { CashClosure, CashClosureCashMovement, CashClosureLine } from "../../src/features/financial/cash-closures/types";

const date = "2026-09-30";
const now = "2026-10-03T12:00:00.000Z";
const context = { workspaceId: "ws", kioskId: "unit", kioskName: "Unit", pdvFilialId: "1", date };

test("origem legada com alerta de integridade não é recuperada silenciosamente", () => {
  const stored = mergeBuiltClosureForPersistence({ built: build(), now });
  delete stored.closure.pdvSales;
  stored.closure.source.integrityWarnings = ["Pagamentos não conferem com cupom"];
  assert.equal(normalizeCashClosureWithLines(stored.closure, stored.lines).closure.pdvSales?.amountCents, null);
});
function coupon(operator = "a", amount = 100, channel = "DINHEIRO") {
  return { codcupom: operator, usuariorecebimento_id: operator, dtrecebimento: `${date} 12:00:00`,
    valortotal: amount, itens: [], formaPgtos: [{ nome: channel, valortotal: amount }] };
}
function movement(kind: "withdrawal" | "supply", amountCents: number): CashClosureCashMovement {
  return { id: kind, kind, amountCents, date, occurredAt: `${date}T12:00:00-03:00`,
    operatorId: "a", terminalId: null, paymentMethodId: null, paymentMethodName: "DINHEIRO", isCash: true, cancelled: false };
}
function build(coupons = [coupon()], cashMovements: CashClosureCashMovement[] = []) {
  return buildCashClosureFromPdv(coupons, { ...context, cashMovements });
}
function aggregate(closure: CashClosure, lines: CashClosureLine[], approved: string[] = ["a"]) {
  const operators = buildCashClosureOperators({ closure, lines, now }).operators
    .map(operator => ({ ...operator, status: approved.includes(operator.operatorId) ? "approved" as const : "draft" as const }));
  return { operators, closure: withCashClosureOperatorAggregate(recomputeCashClosureFromLines(closure, lines, now), operators, now) };
}

test("sale10000 withdrawal1000 expected9000 counted8000 => revenue10000 shortage1000 at closure date", () => {
  const built = build([coupon()], [movement("withdrawal", 1_000)]);
  assert.equal(built.pdvSales?.amountCents, 10_000);
  assert.equal(built.expectedTotalCents, 9_000);
  const stored = mergeBuiltClosureForPersistence({ built, now });
  const lines = [recalculateCountedLine(stored.lines[0], 8_000, "Falta", "finance", now)];
  const result = aggregate(stored.closure, lines);
  assert.equal(result.operators[0].pdvSales?.amountCents, 10_000);
  assert.deepEqual(result.closure.finalizedCashDifferences, { version: 1, shortageCents: 1_000, surplusCents: 0 });
  assert.equal(result.closure.cashDeposit.eligibleCents, 0); // This pure aggregation does not allocate deposits.
  const summary = summarizeCashClosureDre([result.closure]);
  assert.equal(summary.dreRevenueTotalCents, 10_000);
  assert.equal(summary.dreCashShortageTotalCents, 1_000);
  assert.deepEqual(summary.dreCoverage.dates, [date]);
});

test("supply, change, manual expected and surplus never alter integral PDV", () => {
  const sale = coupon();
  sale.formaPgtos = [{ nome: "DINHEIRO", valortotal: 120 }, { nome: "TROCO", valortotal: 20 }];
  const built = build([sale], [movement("supply", 2_000)]);
  assert.equal(built.expectedTotalCents, 12_000);
  const stored = mergeBuiltClosureForPersistence({ built, now });
  const adjusted = recalculateExpectedLine(stored.lines[0], 11_000, "Base física", "finance", now);
  const counted = recalculateCountedLine(adjusted, 11_500, null, "finance", now);
  const result = aggregate(stored.closure, [counted]);
  assert.equal(result.closure.pdvSales?.amountCents, 10_000);
  assert.deepEqual(result.closure.finalizedCashDifferences, { version: 1, shortageCents: 0, surplusCents: 500 });
});

test("partial operators, reopen and noncash differences: never net shortages against surpluses", () => {
  const stored = mergeBuiltClosureForPersistence({ built: build([coupon("a"), coupon("b"), coupon("c", 50, "CONTA ASSINADA")]), now });
  const lines = stored.lines.map(line => recalculateCountedLine(line,
    line.operatorId === "a" ? 9_000 : line.operatorId === "b" ? 11_000 : 3_000, "Conferência", "finance", now));
  const partial = aggregate(stored.closure, lines, ["a", "c"]);
  assert.equal(partial.closure.status, "pending_review");
  assert.deepEqual(partial.closure.finalizedCashDifferences, { version: 1, shortageCents: 1_000, surplusCents: 0 });
  const all = aggregate(stored.closure, lines, ["a", "b", "c"]);
  assert.equal(all.closure.finalizedDifferenceTotalCents, -2_000);
  assert.deepEqual(all.closure.finalizedCashDifferences, { version: 1, shortageCents: 1_000, surplusCents: 1_000 });
  const reopened = withCashClosureOperatorAggregate(all.closure,
    all.operators.map(operator => operator.operatorId === "a" ? { ...operator, status: "reopened" } : operator), now);
  assert.deepEqual(reopened.finalizedCashDifferences, { version: 1, shortageCents: 0, surplusCents: 1_000 });
  assert.equal(reopened.pdvSales?.amountCents, 25_000);
});

test("unfinalized or missing cash count is not a shortage or silently known finalized zero", () => {
  const stored = mergeBuiltClosureForPersistence({ built: build(), now });
  assert.deepEqual(aggregate(stored.closure, stored.lines, []).closure.finalizedCashDifferences,
    { version: 1, shortageCents: 0, surplusCents: 0 });
  const invalidApproved = aggregate(stored.closure, stored.lines);
  assert.deepEqual(invalidApproved.closure.finalizedCashDifferences,
    { version: 1, shortageCents: null, surplusCents: null });
  assert.equal(summarizeCashClosureDre([invalidApproved.closure]).dreCashShortageTotalCents, null);
});

test("resync replaces only source sales, preserves manual expected and counts; vanished lines do not retain revenue", () => {
  const first = mergeBuiltClosureForPersistence({ built: build(), now });
  const line = recalculateCountedLine(recalculateExpectedLine(first.lines[0], 9_000, "Base", "finance", now), 8_000, "Falta", "finance", now);
  const finalized = aggregate(first.closure, [line]);
  const second = mergeBuiltClosureForPersistence({ built: build([coupon("a", 110)]), existingClosure: finalized.closure, existingLines: [line], now });
  assert.equal(second.lines[0].expectedCents, 9_000);
  assert.equal(second.lines[0].countedCents, 8_000);
  assert.equal(second.lines[0].pdvSales?.amountCents, 11_000);
  assert.equal(second.closure.pdvChangedAfterApproval, true);
  assert.equal(aggregate(second.closure, second.lines).closure.finalizedCashDifferences?.shortageCents, 1_000);
  const staleSummary = summarizeCashClosureDre([aggregate(second.closure, second.lines).closure]);
  assert.equal(staleSummary.dreRevenueTotalCents, 11_000);
  assert.equal(staleSummary.dreCashShortageTotalCents, null);
  assert.equal(staleSummary.dreCoverage.staleCashDifferenceClosureCount, 1);
  const removed = mergeBuiltClosureForPersistence({ built: build([]), existingClosure: second.closure, existingLines: second.lines, now });
  assert.equal(removed.lines[0].pdvSales?.amountCents, 0);
  assert.equal(aggregate(removed.closure, removed.lines).closure.pdvSales?.amountCents, 0);
});

test("legacy only recovers explicit metadata/calculated sources, never adjusted expected or a net difference", () => {
  const stored = mergeBuiltClosureForPersistence({ built: build([coupon(), coupon("b", 50, "PIX")], [movement("withdrawal", 1_000)]), now });
  delete stored.closure.pdvSales;
  stored.lines.forEach(line => { delete line.pdvSales; });
  const valid = normalizeCashClosureWithLines(stored.closure, stored.lines);
  assert.equal(valid.closure.pdvSales?.amountCents, 15_000);
  const cash = stored.lines.find(line => line.channel === "cash")!;
  cash.metadata = {};
  const missing = normalizeCashClosureWithLines(stored.closure, stored.lines);
  assert.equal(missing.closure.pdvSales?.amountCents, null);
  assert.equal(summarizeCashClosureDre([stored.closure]).dreRevenueTotalCents, null);
  assert.deepEqual(withCashClosureOperatorAggregate(stored.closure, []).finalizedCashDifferences,
    { version: 1, shortageCents: null, surplusCents: null });
});

test("incomplete or malformed coupons cannot turn missing source into zero revenue", () => {
  const missingPayment = coupon(); missingPayment.formaPgtos = [];
  const built = build([missingPayment]);
  assert.equal(built.pdvSales?.amountCents, null);
  const stored = mergeBuiltClosureForPersistence({ built, now });
  assert.equal(normalizeCashClosureWithLines(stored.closure, stored.lines).closure.pdvSales?.amountCents, null);
  const invalid = { ...coupon(), valortotal: 0, formaPgtos: [{ nome: "DINHEIRO" }] };
  assert.equal(buildCashClosureFromPdv([invalid], context).pdvSales?.amountCents, null);
  assert.equal(build([]).pdvSales?.amountCents, 0); // Explicit empty import is a known zero.
});

test("both summary producers import the exact same pure projection; mixed legacy coverage returns null", async () => {
  assert.equal(functionsProjection, summarizeCashClosureDre);
  const stored = mergeBuiltClosureForPersistence({ built: build(), now });
  const valid = aggregate(stored.closure, [recalculateCountedLine(stored.lines[0], 10_000, null, "finance", now)]).closure;
  const mixed = summarizeCashClosureDre([valid, { date: "2026-09-29" }]);
  assert.equal(mixed.dreRevenueTotalCents, null);
  assert.equal(mixed.dreCashShortageTotalCents, null);
  assert.equal(mixed.dreCoverage.revenueClosureCount, 1);
  assert.equal(mixed.dreCoverage.closureCount, 2);
  assert.equal(summarizeCashClosureDre([{ ...valid, syncError: "error" }]).dreRevenueTotalCents, null);
  assert.equal(summarizeCashClosureDre([valid, valid]).dreRevenueTotalCents, null);
  for (const path of ["../../src/features/financial/cash-closures/summaries.server.ts", "../../functions/src/cash-closure-summaries.ts"]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(source, /\.\.\.summarizeCashClosureDre\(closures/);
    assert.doesNotMatch(source, /dreRevenueTotalCents:\s*closures\.reduce/);
  }
});
