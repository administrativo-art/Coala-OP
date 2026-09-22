import assert from "node:assert/strict";
import test from "node:test";
import { reviewDailySales } from "../../src/features/financial/sales-reconciliation/daily-review";
import { suggestSalesReconciliationCases as match } from "../../src/features/financial/sales-reconciliation/matching";
import { exactSalesCents, MAX_SALE_CENTS } from "../../src/features/financial/sales-reconciliation/validation";
import type { SalesMatchFact } from "../../src/features/financial/sales-reconciliation/types";

const scope = { workspaceId: "coala", kioskId: "unit-a", stoneCode: "123", referenceDate: "2026-09-20" };
const events = `<Events><Captures>1</Captures><Payments>0</Payments><Cancellations>0</Cancellations><CancellationCharges>0</CancellationCharges><Chargebacks>0</Chargebacks><ChargebackRefunds>0</ChargebackRefunds></Events>`;
const sale = (id = "000123", amount = "6.000000", type = "1") => `<Transaction>${events}<AcquirerTransactionKey>${id}</AcquirerTransactionKey><CaptureLocalDateTime>20260920102235</CaptureLocalDateTime><AccountType>${type}</AccountType><CapturedAmount>${amount}</CapturedAmount><AuthorizationCurrencyCode>986</AuthorizationCurrencyCode><CardNumber>private-card</CardNumber></Transaction>`;
const file = (sales = sale(), accounts = "") => `<Conciliation><Header><StoneCode>123</StoneCode><ReferenceDate>20260920</ReferenceDate><LayoutVersion>2.2</LayoutVersion><FileId>file-1</FileId><GenerationDateTime>20260921050001</GenerationDateTime></Header><FinancialTransactions>${sales}</FinancialTransactions><FinancialTransactionsAccounts>${accounts}</FinancialTransactionsAccounts></Conciliation>`;
const coupon = (overrides: Record<string, unknown> = {}) => ({ codcupom: "0001", dtrecebimento: "2026-09-20 10:22:35", valortotal: "6.00", formaPgtos: [{ nome: "CARTAO DEBITO STONE", valortotal: "6.00" }], ...overrides });
const review = (pdvCoupons: unknown = [coupon()], stoneXml = file()) => reviewDailySales({ scope, pdvCoupons, stoneXml });
const fact = (source: "pdv" | "stone", overrides: Partial<SalesMatchFact> = {}): SalesMatchFact => ({
  id: source, source, workspaceId: scope.workspaceId, kioskId: scope.kioskId,
  businessDate: scope.referenceDate, soldAt: "2026-09-20T10:22:35-03:00", channel: "debit_card",
  grossAmountCents: 600, status: "approved", identifiers: {}, ...overrides,
});
const pair = (p: Partial<SalesMatchFact> = {}, s: Partial<SalesMatchFact> = {}) => match({ pdvFacts: [fact("pdv", p)], stoneSales: [fact("stone", s)] });

test("adapts real XML and PDV envelopes without writes, bank confirmation or auto approval", () => {
  const result = review();
  assert.equal(result.stoneSales[0].grossAmountCents, 600);
  assert.equal(result.stoneSales[0].id, "000123");
  assert.equal(result.pdvFacts[0].couponId, "0001");
  assert.equal(result.pdvFacts[0].status, "pending");
  assert.equal(result.cases[0].matchBasis, "unique_amount_time");
  assert.equal(result.cases[0].confidence, "medium");
  assert.equal(result.cases[0].reviewStatus, "pending_review");
  assert.equal(result.coverage, "partial");
  assert.equal(result.bankReceiptConfirmed, false);
  assert.doesNotMatch(JSON.stringify(result), /private-card|CardNumber|matched_auto/);
});

test("exact cents accepts trailing zeros and refuses rounding, locale ambiguity and unsafe integers", () => {
  for (const input of ["6", "6.0", "6.000000000000", 6]) assert.equal(exactSalesCents(input), 600);
  assert.equal(exactSalesCents("0.29"), 29);
  for (const input of ["6.001", "1,20", "1e3", -1, Infinity, NaN, {}, null, "9007199254740991", "0.30000000000000004"]) assert.equal(exactSalesCents(input), null);
});

test("XML source scope, malformed file and missing payload fail closed", () => {
  for (const xml of ["", "<invalid>", file().replace("<StoneCode>123", "<StoneCode>999"), file().replace("<ReferenceDate>20260920", "<ReferenceDate>20260919")]) assert.throws(() => review([], xml));
  assert.throws(() => review(null));
  const empty = review([], file(""));
  assert.deepEqual(empty.cases, []);
  assert.equal(empty.coverage, "partial");
});

test("Pix remains uncompared instead of a false missing-Stone sale", () => {
  const result = review([coupon({ formaPgtos: [{ nome: "PIX STONE", valortotal: "6.00" }] })], file(""));
  assert.equal(result.uncomparedPdvFacts.length, 1);
  assert.deepEqual(result.cases, []);
  assert.match(result.limitations.join(" "), /Pix não foi comparado/);
});

test("missing IDs, missing amounts and duplicate coupons cannot silently become zero or overwritten", () => {
  const result = review([coupon(), coupon(), coupon({ codcupom: undefined }), coupon({ codcupom: "2", formaPgtos: [{ nome: "CARTAO DEBITO" }] })]);
  assert.equal(result.pdvFacts.length, 0);
  assert.deepEqual(result.issues.map(i => i.reason), ["duplicate_coupon", "duplicate_coupon", "invalid_coupon", "invalid_payments"]);
});

test("PDV aliases, cash change and divided payments retain payment-level evidence", () => {
  const raw = { CodCupom: "upper", DtRecebimento: "2026-09-20T13:22:35Z", ValorTotal: "6.00",
    FormaPgtos: [{ Nome: "CARTAO DEBITO", ValorTotal: "3.00" }, { Nome: "CARTAO DEBITO", ValorTotal: "1.00" },
      { Nome: "DINHEIRO", ValorTotal: "5.00" }, { Nome: "TROCO", ValorTotal: "3.00" }] };
  const result = review([raw]);
  assert.deepEqual(result.pdvFacts.map(f => f.grossAmountCents), [300, 100]);
  assert.equal(result.issues.length, 0);
  assert.equal(new Set(result.pdvFacts.map(f => f.id)).size, 2);
  assert.equal(result.cases[0].reviewStatus, "pending_review");
});

test("conflicting aliases and payment totals are explicit issues", () => {
  for (const row of [coupon({ ValorTotal: "7.00" }), coupon({ valortotal: "7.00" }), coupon({ formaPgtos: [null] }), coupon({ formaPgtos: [] })]) {
    const result = review([row]);
    assert.equal(result.pdvFacts.length, 0);
    assert.equal(result.issues[0].reason, "invalid_payments");
  }
});

test("unknown channels, invalid dates and out-of-day rows remain visible issues", () => {
  const result = review([coupon({ codcupom: "a", dtrecebimento: "2026-02-30T10:22:35" }),
    coupon({ codcupom: "b", dtrecebimento: "2026-09-21T10:22:35" }),
    coupon({ codcupom: "c", formaPgtos: [{ nome: "NOVO MEIO", valortotal: "6.00" }] })]);
  assert.deepEqual(result.issues.map(i => i.reason), ["invalid_date", "outside_day", "unsupported_channel"]);
});

test("cancellation, refund and item cancellation are not all collapsed into approved or fully cancelled", () => {
  for (const [extra, status] of [[{ IsCancelado: true }, "cancelled"], [{ IsEstornado: 1 }, "refunded"],
    [{ IsCancelado: true, Itens: [{ IsCancelado: true }] }, "pending"]] as const) {
    const result = review([coupon(extra)]);
    assert.equal(result.pdvFacts[0].status, status);
    assert.equal(result.cases[0].reviewStatus, "pending_review");
  }
});

test("Stone payment events do not duplicate captured revenue", () => {
  const payment = sale().replace("<Captures>1</Captures><Payments>0", "<Captures>0</Captures><Payments>1");
  const result = review([coupon()], file(sale(), payment));
  assert.equal(result.stoneSales.length, 1);
  assert.equal(result.issues[0].reason, "non_capture_event");
});

test("Stone cancellation in either section blocks the original capture and preserves an issue", () => {
  for (const event of ["Cancellations", "CancellationCharges", "Chargebacks", "ChargebackRefunds"]) {
    const cancelled = sale().replace("<Captures>1", "<Captures>0").replace(`<${event}>0`, `<${event}>1`);
    const result = review([coupon()], file(sale(), cancelled));
    assert.equal(result.stoneSales.length, 0);
    assert.equal(result.issues.length, 2);
    assert.ok(result.issues.every(i => i.reason === "cancellation_event"));
    assert.equal(result.stoneEvents[1].events[event], 1);
  }
});

test("unsupported captures and fractional cents are not silently rounded or guessed", () => {
  const result = review([], file(sale("a", "6.001") + sale("b", "6", "10") + sale("c").replace("<AuthorizationCurrencyCode>986</AuthorizationCurrencyCode>", "")));
  assert.equal(result.stoneSales.length, 0);
  assert.deepEqual(result.issues.map(i => i.reason), ["invalid_amount", "unsupported_capture", "unsupported_capture"]);
  for (const [code, channel] of [["1", "debit_card"], ["2", "credit_card"], ["3", "debit_card"], ["4", "credit_card"]]) {
    assert.equal(review([], file(sale("a", "6", code))).stoneSales[0].channel, channel);
  }
});

test("all bounds reject the whole input, never truncate to a misleading partial match", () => {
  assert.throws(() => review(Array.from({ length: 501 }, (_, i) => coupon({ codcupom: String(i) }))));
  assert.throws(() => review([], file(Array.from({ length: 501 }, (_, i) => sale(String(i))).join(""))));
  assert.throws(() => match({ pdvFacts: [fact("pdv"), fact("pdv")], stoneSales: [] }), { code: "SALES_REVIEW_INVALID_SOURCE" });
  for (const change of [{ grossAmountCents: MAX_SALE_CENTS + 1 }, { grossAmountCents: 0.5 }, { soldAt: "wrong" },
    { soldAt: "2026-02-30T10:00:00" }, { source: "stone" as const }, { businessDate: "2026-09-21" }]) {
    assert.throws(() => match({ pdvFacts: [fact("pdv", change)], stoneSales: [] }), { code: "SALES_REVIEW_INVALID_SOURCE" });
  }
  assert.throws(() => match({ pdvFacts: [], stoneSales: [], timeWindowMs: 999999 }));
});

test("exact provider ID explains amount/status/unit discrepancies but does not auto-approve", () => {
  const identifiers = { providerTransactionId: "000123" };
  assert.equal(pair({ identifiers }, { identifiers, grossAmountCents: 500 })[0].kind, "amount_mismatch");
  assert.equal(pair({ identifiers }, { identifiers, status: "refunded" })[0].kind, "status_mismatch");
  assert.equal(pair({ identifiers }, { identifiers, kioskId: "other" })[0].kind, "unit_mismatch");
  assert.equal(pair({ identifiers, kioskId: null }, { identifiers })[0].kind, "unit_unmapped");
  const exact = pair({ identifiers }, { identifiers })[0];
  assert.equal(exact.confidence, "high");
  assert.equal(exact.kind, "matched");
  assert.equal(exact.reviewStatus, "pending_review");
});

test("punctuation, case and leading zeros in provider IDs are never erased", () => {
  for (const [a, b] of [["tx-1", "tx1"], ["abc", "ABC"], ["00123", "123"]]) {
    const result = pair({ identifiers: { providerTransactionId: a } }, { identifiers: { providerTransactionId: b } });
    assert.equal(result.length, 2);
    assert.ok(result.every(c => c.matchBasis === "unmatched"));
  }
});

test("conflicting strong identifiers and duplicate strong keys remain ambiguous", () => {
  const result = pair({ identifiers: { providerTransactionId: "same", terminalId: "A" } }, { identifiers: { providerTransactionId: "same", terminalId: "B" } });
  assert.equal(result[0].kind, "ambiguous");
  const p = fact("pdv", { identifiers: { providerTransactionId: "same" } });
  const s = fact("stone", { identifiers: { providerTransactionId: "same" }, grossAmountCents: 300 });
  assert.equal(match({ pdvFacts: [p], stoneSales: [s, { ...s, id: "s2" }] })[0].kind, "ambiguous");
});

test("coupon number is not assumed to be a Stone merchant order", () => {
  const result = pair({ couponId: "order" }, { identifiers: { merchantOrderId: "order" }, soldAt: "2026-09-20T12:00:00-03:00" });
  assert.equal(result.length, 2);
  assert.ok(result.every(c => c.matchBasis === "unmatched"));
});

test("heuristics stay pending and ambiguous same-value sales are not chosen arbitrarily", () => {
  assert.equal(pair()[0].confidence, "medium");
  assert.equal(pair()[0].reviewStatus, "pending_review");
  const result = match({ pdvFacts: [fact("pdv")], stoneSales: [fact("stone"), fact("stone", { id: "s2" })] });
  assert.equal(result[0].kind, "ambiguous");
  assert.deepEqual(result[0].stoneSaleIds, ["s2", "stone"]);
});

test("workspace, date, channel and unit boundaries prevent heuristic cross-matching", () => {
  for (const override of [{ workspaceId: "other" }, { kioskId: "other" }, { channel: "credit_card" as const },
    { businessDate: "2026-09-21", soldAt: "2026-09-21T10:22:35-03:00" }]) assert.equal(pair({}, override).length, 2);
});

test("case identities are collision-safe and result order does not depend on input order", () => {
  const p = [fact("pdv", { id: "a,b", soldAt: "2026-09-20T08:00:00-03:00" }), fact("pdv", { id: "c" })];
  const s = [fact("stone")];
  const snapshot = JSON.stringify({ p, s });
  assert.deepEqual(match({ pdvFacts: p, stoneSales: s }), match({ pdvFacts: [...p].reverse(), stoneSales: s }));
  assert.equal(JSON.stringify({ p, s }), snapshot);
});

test("a dense maximum-sized day stays a single ambiguous group without dropping facts", () => {
  const pdvFacts = Array.from({ length: 500 }, (_, i) => fact("pdv", { id: `p${i}` }));
  const stoneSales = Array.from({ length: 500 }, (_, i) => fact("stone", { id: `s${i}` }));
  const result = match({ pdvFacts, stoneSales });
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "ambiguous");
  assert.equal(result[0].pdvFactIds.length, 500);
  assert.equal(result[0].stoneSaleIds.length, 500);
});
