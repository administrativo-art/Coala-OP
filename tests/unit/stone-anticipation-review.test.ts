import assert from "node:assert/strict";
import test from "node:test";
import { compareStonePayments, queryStoneAnticipationReview } from "../../src/lib/integrations/stone/anticipation-review";
import { parseStoneAgendaXml } from "../../src/lib/integrations/stone/agenda-parser";

const merchant = "123";
function xml(date: string, paid = false, options: { mdr?: boolean; gross?: string; cancel?: boolean; due?: string; id?: string } = {}) {
  const events = `<Events><Captures>${paid ? 0 : 1}</Captures><Payments>${paid ? 1 : 0}</Payments><Cancellations>${options.cancel ? 1 : 0}</Cancellations><CancellationCharges>0</CancellationCharges><Chargebacks>0</Chargebacks><ChargebackRefunds>0</ChargebackRefunds></Events>`;
  const row = `<Transaction>${events}<AcquirerTransactionKey>${options.id ?? "001"}</AcquirerTransactionKey><CaptureLocalDateTime>20260824120000</CaptureLocalDateTime><Installments><Installment><InstallmentNumber>1</InstallmentNumber><GrossAmount>${options.gross ?? "10.000000"}</GrossAmount><NetAmount>${paid ? "9.756000" : "9.778000"}</NetAmount>${paid ? `<PaymentDate>${date.replaceAll("-", "")}</PaymentDate><PaymentId>pay1</PaymentId>${options.mdr === false ? "" : "<MdrAmount>0.222000</MdrAmount>"}` : `<PrevisionPaymentDate>${options.due ?? "20260923"}</PrevisionPaymentDate>`}</Installment></Installments></Transaction>`;
  return `<Conciliation><Header><StoneCode>${merchant}</StoneCode><ReferenceDate>${date.replaceAll("-", "")}</ReferenceDate><LayoutVersion>2.2</LayoutVersion><FileId>${date}</FileId><GenerationDateTime>20260922000000</GenerationDateTime></Header><FinancialTransactions>${paid ? "" : row}</FinancialTransactions><FinancialTransactionsAccounts>${paid ? row : ""}</FinancialTransactionsAccounts></Conciliation>`;
}
const parse = (date: string, paid = false, options = {}) => parseStoneAgendaXml(xml(date, paid, options), { stoneCode: merchant, referenceDate: date });
test("official XML fields preserve anticipation cost and original due date, independently of residual", () => {
  const raw = xml("2026-09-21", true).replace("</Installment>",
    "<AdvanceRateAmount>0.022000</AdvanceRateAmount><AdvancedReceivableOriginalPaymentDate>20260923</AdvancedReceivableOriginalPaymentDate></Installment>");
  const paid = parseStoneAgendaXml(raw, { stoneCode: merchant, referenceDate: "2026-09-21" });
  const result = compareStonePayments(paid, [parse("2026-08-24")]);
  assert.equal(result.rows[0].anticipationFee, "0.022000");
  assert.equal(result.rows[0].providerOriginalDueDate, "2026-09-23");
  assert.equal(result.rows[0].providerAnticipationConfirmed, true);
  assert.equal(result.summary.unexplainedDifference, "0.000000000000");
  assert.equal(result.summary.providerConfirmedCount, 1);
  paid.transactions[0].installments[0].advanceRateAmount = "0.010000";
  assert.equal(compareStonePayments(paid, [parse("2026-08-24")]).summary.unexplainedDifference, "0.012000000000");
  paid.transactions[0].installments[0].advancedReceivableOriginalPaymentDate = "2026-09-24";
  const conflicting = compareStonePayments(paid, [parse("2026-08-24")]);
  assert.equal(conflicting.rows[0].status, "needs_review");
  assert.equal(conflicting.rows[0].providerAnticipationConfirmed, false);
});
test("compares transaction AND installment and preserves exact decimals without classifying RAV fee", () => {
  const result = compareStonePayments(parse("2026-09-21", true), [parse("2026-08-24")]);
  assert.equal(result.rows[0].status, "paid_early");
  assert.equal(result.summary.additionalDiscount, "0.022000000000");
  assert.equal(result.summary.mdr, "0.222000000000");
  assert.equal(result.summary.paidNet, "9.756000000000");
  assert.equal(result.rows[0].originalDueDate, "2026-09-23");
  assert.equal(result.rows[0].providerAnticipationConfirmed, false);
  assert.equal(result.summary.anticipationFee, null);
});
test("missing MDR remains unknown, not zero", () => {
  assert.equal(compareStonePayments(parse("2026-09-21", true, { mdr: false }), [parse("2026-08-24")]).summary.mdr, null);
});
test("missing original, partial payments, reversals and conflicting origins stay pending", () => {
  const original = parse("2026-08-24");
  for (const result of [compareStonePayments(parse("2026-09-21", true), []),
    compareStonePayments(parse("2026-09-21", true, { gross: "5" }), [original]),
    compareStonePayments(parse("2026-09-21", true, { cancel: true }), [original]),
    compareStonePayments(parse("2026-09-21", true), [original, original])]) {
    assert.equal(result.summary.earlyCount, 0);
    assert.equal(result.summary.pendingCount, 1);
    assert.equal(result.rows[0].additionalDiscount, null);
  }
});
test("same day and later payments are not anticipations; merchant mismatch is rejected", () => {
  assert.equal(compareStonePayments(parse("2026-09-21", true), [parse("2026-08-24", false, { due: "20260921" })]).rows[0].status, "regular_payment");
  assert.throws(() => compareStonePayments(parse("2026-09-21", true), [{ ...parse("2026-08-24"), stoneCode: "999" }]), { code: "STONE_REVIEW_SCOPE_MISMATCH" });
});
test("no real credentials: admin and input validated before provider reads", async () => {
  const never = async () => { assert.fail("must not call provider"); };
  await assert.rejects(queryStoneAnticipationReview({}, { isDefaultAdmin: false }, never), { code: "STONE_REVIEW_FORBIDDEN" });
  await assert.rejects(queryStoneAnticipationReview({ stoneCode: merchant, referenceDate: "2026-02-30" }, { isDefaultAdmin: true }, never), { code: "STONE_REVIEW_INVALID_QUERY" });
});
test("queries exact original date and keeps bank and RAV unconfirmed; unavailable file is not absence", async () => {
  const scope = { stoneCode: merchant, referenceDate: "2026-09-21" };
  const calls: string[] = [];
  const result = await queryStoneAnticipationReview(scope, { isDefaultAdmin: true }, async q => {
    calls.push(q.referenceDate); return xml(q.referenceDate, q.referenceDate === scope.referenceDate);
  });
  assert.deepEqual(calls, ["2026-09-21", "2026-08-24"]);
  assert.equal(result.summary.earlyCount, 1);
  assert.equal(result.ravConfirmed, false);
  assert.equal(result.bankReceiptConfirmed, false);
  assert.equal(result.writesPerformed, false);
  const partial = await queryStoneAnticipationReview(scope, { isDefaultAdmin: true }, async q => {
    if (q.referenceDate !== scope.referenceDate) throw new Error("secret provider error");
    return xml(q.referenceDate, true);
  });
  assert.deepEqual(partial.unavailableDates, ["2026-08-24"]);
  assert.equal(partial.summary.pendingCount, 1);
  assert.doesNotMatch(JSON.stringify(partial), /secret provider error/);
});

test("different installment cannot match; repeated payment fails rather than double counting", () => {
  const original = parse("2026-08-24");
  original.transactions[0].installments[0].number = 2;
  assert.equal(compareStonePayments(parse("2026-09-21", true), [original]).summary.pendingCount, 1);
  const payment = parse("2026-09-21", true);
  payment.transactions.push(payment.transactions[0]);
  assert.throws(() => compareStonePayments(payment, []), { code: "STONE_REVIEW_DUPLICATE_PAYMENT" });
});

test("sum uses twelve decimal places and preserves negative differences as adjustments", () => {
  const original = parse("2026-08-24");
  const payment = parse("2026-09-21", true);
  original.transactions[0].installments[0].netAmount = "9.000000000001";
  payment.transactions[0].installments[0].netAmount = "9.000000000002";
  assert.equal(compareStonePayments(payment, [original]).summary.additionalDiscount, "-0.000000000001");
});

test("at most 31 distinct original files are read and skipped dates remain pending", async () => {
  const scope = { stoneCode: merchant, referenceDate: "2026-09-21" };
  const dates = Array.from({ length: 33 }, (_, i) => new Date(Date.UTC(2026, 6, i + 1)).toISOString().slice(0, 10));
  const transactions = dates.map((d, i) => xml(scope.referenceDate, true, { id: String(i) })
    .match(/<Transaction>.*<\/Transaction>/)![0].replace("20260824120000", `${d.replaceAll("-", "")}120000`)).join("");
  const paymentXml = xml(scope.referenceDate, true).replace(/<Transaction>.*<\/Transaction>/, transactions);
  let calls = 0;
  const result = await queryStoneAnticipationReview(scope, { isDefaultAdmin: true }, async q => {
    calls++;
    if (q.referenceDate === scope.referenceDate) return paymentXml;
    throw new Error("unavailable");
  });
  assert.equal(calls, 32);
  assert.equal(result.unavailableDates.length, 31);
  assert.equal(result.skippedDates.length, 2);
  assert.equal(result.summary.pendingCount, 33);
});
