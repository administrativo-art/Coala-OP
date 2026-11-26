import assert from "node:assert/strict";
import test from "node:test";
import Papa from "papaparse";
import { parseStonePixCsv } from "../../src/lib/integrations/stone/pix-conciliation";
import {
  evaluatePixRefundCheck, pixRefundDates, pixRefundMonthId, projectPixRefundDay, updatePixRefundMonth,
  type PixRefundMonth,
} from "../../src/lib/integrations/stone/pix-refunds";
import { checkSalesPixRefunds } from "../../src/features/financial/sales-reconciliation/pix-refund-review";
import { suggestSalesReconciliationCases } from "../../src/features/financial/sales-reconciliation/matching";
import type { SalesMatchFact } from "../../src/features/financial/sales-reconciliation/types";

const soldOn = "2026-09-30";
const later = "2026-10-01";
const hash = "a".repeat(64);
const e2eId = "ExactPixId-1";
const otherId = "ExactPixId-10";
const row = {
  id: "event-1", amount: "600", status: "paid", payment_method: "pix",
  created_at: "2026-09-30T13:22:35Z", pix_transaction__e2e_id: e2eId,
  pix_transaction__paid_amount: "600", pix_transaction__canceled_amount: "0", pix_transaction__fee_amount: "3",
  pix_transaction__additional_data: "[{name=Cliente, value=123}, {name=Terminal, value=TERM-1}]",
  pix_transaction__detail__operation: "pay", pix_transaction__detail__operation_amount: "600",
  pix_transaction__detail__provider_datetime: "2026-09-30T13:22:35Z",
  pix_transaction__detail__refund_id: "",
};
const refund = (overrides: Partial<typeof row> = {}) => ({
  ...row, id: "refund-event-1", status: "canceled", pix_transaction__canceled_amount: "100",
  pix_transaction__detail__operation: "cancel", pix_transaction__detail__operation_amount: "100",
  pix_transaction__detail__refund_id: "refund-1", pix_transaction__detail__provider_datetime: "2026-10-01T13:22:35Z",
  ...overrides,
});
const project = (date: string, rows: typeof row[], sourceHash = hash) =>
  projectPixRefundDay(date, sourceHash, rows.length ? parseStonePixCsv(Papa.unparse(rows)).transactions : []);
function evaluate(months: Map<string, PixRefundMonth>, through = later, saleSourceHash = hash) {
  return evaluatePixRefundCheck({ dates: pixRefundDates(soldOn, through), months, through,
    e2eId, stoneCode: "123", saleSourceHash });
}

test("empty CSV covers refunds only with the provider's refund columns", () => {
  assert.equal(parseStonePixCsv("id,unknown").refundCoverageSupported, false);
  assert.equal(parseStonePixCsv(Object.keys(row).join(",")).refundCoverageSupported, true);
});

test("exact E2E, complete empty file, cross-month cutoff, isolation and sale source generation", () => {
  assert.notEqual(pixRefundMonthId("one", "merchant", "2026-09"), pixRefundMonthId("two", "merchant", "2026-09"));
  assert.notEqual(pixRefundMonthId("one", "merchant", "2026-09"), pixRefundMonthId("one", "other", "2026-09"));
  const september = updatePixRefundMonth(undefined, soldOn, project(soldOn, [row]));
  const months = new Map([["2026-09", september]]);
  assert.equal(evaluate(months).state, "incomplete");
  months.set("2026-10", updatePixRefundMonth(undefined, later, project(later, [])));
  assert.equal(evaluate(months).state, "clear");
  assert.equal(evaluate(months, later, "b".repeat(64)).state, "incomplete");
  assert.equal(evaluate(months, "2027-10-01").state, "incomplete");
  months.set("2026-10", updatePixRefundMonth(undefined, later, project(later, [
    refund({ id: "other-payment", pix_transaction__e2e_id: otherId }),
    refund({ id: "other-code", pix_transaction__additional_data: "[{name=Cliente, value=999}, {name=Terminal, value=TERM-1}]" }),
  ])));
  assert.equal(evaluate(months).state, "clear");
  months.set("2026-10", updatePixRefundMonth(undefined, later, project(later, [
    refund({ pix_transaction__additional_data: "[]" }),
  ])));
  assert.equal(evaluate(months).events[0]?.state, "unverified");
});

test("later refund, identical republication, changed proof and authority of a valid replacement", () => {
  const next = "2026-10-02";
  const months = new Map([["2026-09", updatePixRefundMonth(undefined, soldOn, project(soldOn, [row]))]]);
  let october = updatePixRefundMonth(undefined, later, project(later, [refund()]));
  october = updatePixRefundMonth(october, next, project(next, [refund()]));
  months.set("2026-10", october);
  assert.equal(evaluate(months, soldOn).state, "clear");
  const confirmed = evaluate(months, next);
  assert.equal(confirmed.state, "events_found");
  assert.equal(confirmed.events.length, 1);
  assert.equal(confirmed.events[0].amountCents, 100);
  assert.equal(confirmed.events[0].state, "confirmed");

  october = updatePixRefundMonth(october, next, project(next, [refund({ pix_transaction__detail__operation_amount: "200" })]));
  months.set("2026-10", october);
  assert.equal(evaluate(months, next).events[0].state, "unverified");
  assert.equal(evaluate(months, next).events[0].amountCents, null);

  october = updatePixRefundMonth(october, later);
  months.set("2026-10", updatePixRefundMonth(october, next));
  assert.equal(evaluate(months, next).complete, false);
  assert.equal(evaluate(months, next).state, "events_found");
  october = updatePixRefundMonth(october, later, project(later, [], "b".repeat(64)));
  months.set("2026-10", updatePixRefundMonth(october, next, project(next, [], "c".repeat(64))));
  assert.equal(evaluate(months, next).state, "clear");
});

test("payment with refund ID, invalid amount or time is never clear, unidentified cancellation blocks coverage", () => {
  const september = updatePixRefundMonth(undefined, soldOn, project(soldOn, [row]));
  const months = new Map([["2026-09", september]]);
  for (const malformed of [
    { ...row, pix_transaction__detail__refund_id: "unexpected-refund" },
    { ...row, pix_transaction__paid_amount: "unknown" },
    { ...row, pix_transaction__detail__provider_datetime: "unknown" },
  ]) {
    months.set("2026-10", updatePixRefundMonth(undefined, later, project(later, [malformed])));
    assert.equal(evaluate(months).state, "events_found");
    assert.equal(evaluate(months).events[0].state, "unverified");
  }
  months.set("2026-10", updatePixRefundMonth(undefined, later, project(later, [refund({ pix_transaction__e2e_id: "" })])));
  assert.equal(evaluate(months).state, "incomplete");
});

test("only ID-matched PDV Pix cancellation receives relaxation; new evidence cancels that relaxation", async () => {
  const scope = { workspaceId: "coala", kioskId: "unit", referenceDate: soldOn, stoneCode: "123" };
  const pair = (pdvStatus: SalesMatchFact["status"], channel: SalesMatchFact["channel"] = "pix", nsu = "event-1") => {
    const common = { workspaceId: scope.workspaceId, kioskId: scope.kioskId, businessDate: soldOn, soldAt: soldOn + "T13:22:35Z", grossAmountCents: 600, channel };
    const pdvFacts: SalesMatchFact[] = [{ ...common, id: "p", source: "pdv", status: pdvStatus, identifiers: nsu ? { nsu } : {} }];
    const stoneSales: SalesMatchFact[] = [{ ...common, id: "s", source: "stone", status: "approved",
      identifiers: { providerEventId: "event-1", providerTransactionId: e2eId } }];
    return { scope, pdvFacts, stoneSales, cases: suggestSalesReconciliationCases({ pdvFacts, stoneSales }) };
  };
  const options = { through: later, saleSourceHash: hash };
  const clear = await checkSalesPixRefunds(pair("partial_cancellation"), async input => {
    assert.deepEqual(input.e2eIds, [e2eId]);
    return new Map([[e2eId, { state: "clear", checkedThrough: later, complete: true, events: [] }]]);
  }, options);
  assert.equal(clear[0].reviewStatus, "auto_checked");
  const reopened = await checkSalesPixRefunds({ ...pair("partial_cancellation"), cases: clear }, async () => new Map(), options);
  assert.equal(reopened[0].kind, "status_mismatch");
  assert.equal(reopened[0].reviewStatus, "attention_required");
  for (const result of [pair("refunded"), pair("cancelled", "credit_card"), pair("cancelled", "pix", "")]) {
    const untouched = await checkSalesPixRefunds(result, async () => assert.fail("unsupported case was checked"), options);
    assert.deepEqual(untouched, result.cases);
  }
});
