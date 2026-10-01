import assert from "node:assert/strict";
import test from "node:test";
import { addDays, filterCases, isMultiset, money, summarizeChannel } from "../../src/features/financial/sales-reconciliation/review-view";
import type { SuggestedSalesReconciliationCase } from "../../src/features/financial/sales-reconciliation/types";

const make = (key: string, overrides: Partial<SuggestedSalesReconciliationCase>): SuggestedSalesReconciliationCase => ({
  deterministicKey: key, workspaceId: "w", kioskId: "k", kioskIds: ["k"], period: "2026-09", businessDate: "2026-09-29",
  channel: "debit_card", pdvFactIds: [], stoneSaleIds: [], pdvGrossAmountCents: 1000, stoneGrossAmountCents: 1000,
  differenceAmountCents: 0, kind: "matched", matchBasis: "provider_transaction_id", confidence: "high", reviewStatus: "auto_checked",
  ...overrides,
});

const cases = [
  make("a", {}),
  make("b", { channel: "pix", kind: "pdv_only", reviewStatus: "attention_required", stoneGrossAmountCents: 0, differenceAmountCents: -1000 }),
  make("c", { kind: "amount_mismatch", reviewStatus: "attention_required", stoneGrossAmountCents: 960, differenceAmountCents: -40 }),
  make("d", { kind: "matched", matchBasis: "daily_amount_multiset" }),
];

test("summarizeChannel soma por meio e separa divergências", () => {
  const all = summarizeChannel(cases, "all");
  assert.deepEqual([all.attention, all.auto, all.difference], [2, 2, -1040]);
  const pix = summarizeChannel(cases, "pix");
  assert.deepEqual([pix.list.length, pix.pdv, pix.stone], [1, 1000, 0]);
});

test("filterCases aplica situação, meio e tipo; tipo inexistente volta para todos", () => {
  assert.deepEqual(filterCases(cases, { channel: "all", caseFilter: "attention", kind: "all" }).rows.map(r => r.deterministicKey), ["b", "c"]);
  assert.deepEqual(filterCases(cases, { channel: "all", caseFilter: "attention", kind: "amount_mismatch" }).rows.map(r => r.deterministicKey), ["c"]);
  assert.equal(filterCases(cases, { channel: "pix", caseFilter: "attention", kind: "amount_mismatch" }).kind, "all");
  assert.equal(filterCases(cases, { channel: "all", caseFilter: "auto", kind: "amount_mismatch" }).rows.length, 2);
  assert.equal(filterCases(cases, { channel: "all", caseFilter: "all", kind: "all" }).rows.length, 4);
});

test("conjunto diário é identificado e valores usam centavos exatos", () => {
  assert.equal(isMultiset(cases[3]), true);
  assert.equal(isMultiset(cases[0]), false);
  assert.equal(money(-40), "-R$ 0,40");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});
