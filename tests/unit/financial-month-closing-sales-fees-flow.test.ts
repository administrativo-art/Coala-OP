import assert from "node:assert/strict";
import test from "node:test";

import { evaluateFeesFlow, type FeesUnitInput } from "../../src/features/financial/month-closing/fees-flow";
import { dependsOnYou } from "../../src/features/financial/month-closing/presentation";
import { evaluateSalesFlow, type SalesUnitInput } from "../../src/features/financial/month-closing/sales-flow";
import { buildSalesReviewMonth, type DailySalesCalendarRecord } from "../../src/features/financial/sales-reconciliation/review-calendar";

const record = (referenceDate: string, status: DailySalesCalendarRecord["status"], reopenedAt: string | null = null): DailySalesCalendarRecord => ({
  id: referenceDate, referenceDate, status, revision: 1,
  summary: { pdvAmountCents: 0, stoneAmountCents: 0, autoCheckedCount: 0, attentionCount: 0, sourceIssueCount: 0, uncomparedPdvCount: 0 },
  reviewedAt: `${referenceDate}T12:00:00.000Z`, closedAt: status === "closed" ? `${referenceDate}T12:00:00.000Z` : null,
  reopenedAt, reopenedReason: reopenedAt ? "source_changed" : null, snapshotAvailable: true,
});

const allDays = (status: DailySalesCalendarRecord["status"], skip: string[] = []) =>
  Array.from({ length: 31 }, (_, index) => `2026-10-${String(index + 1).padStart(2, "0")}`).filter((date) => !skip.includes(date)).map((date) => record(date, status));

function unit(key: string, records: DailySalesCalendarRecord[], publishedThrough = "2026-11-20", validFrom = "2026-01-01"): SalesUnitInput {
  return { key, label: key, href: `/origem/${key}`, month: buildSalesReviewMonth({ year: 2026, month: 10, records, publishedThrough, validFrom }) };
}
const sales = (units: SalesUnitInput[], canViewItems = true) => evaluateSalesFlow({ units, canViewItems, originHref: "/vendas?month=2026-10" });

test("Vendas fica conferido sozinho quando todos os dias de todos os vínculos estão fechados", () => {
  const flow = sales([unit("A", allDays("closed")), unit("B", allDays("closed"))]);
  assert.equal(flow.state, "ok");
  assert.deepEqual([flow.checks[0].done, flow.checks[0].total], [62, 62]);
  assert.equal(flow.items.length, 0);
});

test("dia sem revisão, com atenção ou reaberto deixa o fluxo pendente e aponta os dias", () => {
  const records = [
    ...allDays("closed", ["2026-10-05", "2026-10-12", "2026-10-20", "2026-10-21"]),
    record("2026-10-12", "attention_required"),
    record("2026-10-20", "attention_required", "2026-11-02T10:00:00.000Z"),
    record("2026-10-21", "awaiting_source"),
  ];
  const flow = sales([unit("Tirirical", records)]);
  assert.equal(flow.state, "pending");
  assert.deepEqual([flow.checks[0].done, flow.checks[0].total], [27, 31]);
  const kinds = flow.items.map((item) => item.kind).sort();
  assert.deepEqual(kinds, ["sales_attention", "sales_awaiting_source", "sales_not_reviewed", "sales_reopened"]);
  assert.match(flow.items.find((item) => item.kind === "sales_not_reviewed")!.detail, /Dia 05/);
  assert.equal(flow.items[0].href, "/origem/Tirirical");
});

test("dias que a Stone ainda não publicou contam no total e impedem o fechamento", () => {
  const flow = sales([unit("A", allDays("closed", ["2026-10-30", "2026-10-31"]), "2026-10-29")]);
  assert.equal(flow.state, "pending");
  assert.deepEqual([flow.checks[0].done, flow.checks[0].total], [29, 31]);
  const waiting = flow.items.find((item) => item.kind === "sales_not_published")!;
  assert.equal(dependsOnYou(waiting), false);
});

test("sem vínculo vigente na competência a fonte não existe: nunca conferido", () => {
  const outside = unit("A", [], "2026-11-20", "2026-12-01");
  assert.equal(sales([outside]).state, "unavailable");
  assert.equal(sales([]).state, "unavailable");
  assert.equal(sales([]).checks[0].done, null);
});

test("quem não vê os itens recebe só as contagens", () => {
  const flow = sales([unit("A", allDays("closed", ["2026-10-05"]))], false);
  assert.equal(flow.items.length, 0);
  assert.equal(flow.itemsHidden, true);
  assert.equal(flow.checks[0].state, "pending");
});

const feeUnit = (key: string, overrides: Partial<FeesUnitInput> = {}): FeesUnitInput => ({
  key, label: key, href: `/taxas/${key}`, ready: true, complete: true, exceptionCount: 0, changeCount: 0, chargeCount: 0, ...overrides,
});
const fees = (units: FeesUnitInput[], canViewItems = true) => evaluateFeesFlow({ units, canViewItems, originHref: "/taxas?month=2026-10" });

test("Taxas fica conferido sozinho quando a aba Taxas está sem pendência em todos os vínculos", () => {
  const flow = fees([feeUnit("A"), feeUnit("B")]);
  assert.equal(flow.state, "ok");
  assert.deepEqual(flow.checks.map((entry) => entry.state), ["ok", "ok", "ok", "ok"]);
  assert.equal(flow.items.length, 0);
});

test("venda a corrigir, mudança de taxa e outra cobrança pendem em checks separados", () => {
  const flow = fees([feeUnit("A", { exceptionCount: 2, changeCount: 1 }), feeUnit("B", { chargeCount: 3 })]);
  assert.equal(flow.state, "pending");
  const byId = Object.fromEntries(flow.checks.map((entry) => [entry.id, entry]));
  assert.deepEqual([byId["fees.exceptions"].done, byId["fees.exceptions"].total], [1, 2]);
  assert.equal(byId["fees.changes"].state, "pending");
  assert.equal(byId["fees.charges"].state, "pending");
  assert.deepEqual(flow.items.map((item) => item.kind).sort(), ["fees_charge", "fees_exception", "fees_rate_change"]);
});

test("conferência Stone não salva ou salva antes de o mês fechar nunca vira zero pendências", () => {
  const notSaved = fees([feeUnit("A", { ready: false, complete: false })]);
  assert.equal(notSaved.state, "pending");
  assert.equal(notSaved.checks.find((entry) => entry.id === "fees.exceptions")!.state, "pending");
  assert.equal(notSaved.items[0].kind, "fees_not_ready");
  const early = fees([feeUnit("A", { complete: false })]);
  assert.equal(early.state, "pending");
  assert.match(early.items[0].detail, /antes de o mês fechar/);
});

test("sem vínculo vigente Taxas fica indisponível", () => {
  assert.equal(fees([]).state, "unavailable");
});
