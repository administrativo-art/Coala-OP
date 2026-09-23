import assert from "node:assert/strict";
import test from "node:test";
import Papa from "papaparse";
import { parseStonePixCsv } from "../../src/lib/integrations/stone/pix-conciliation";
import { reviewPixSnapshot } from "../../src/features/financial/sales-reconciliation/pix-source";
import { queryDailySales } from "../../src/features/financial/sales-reconciliation/query";
import { salesBinding, salesRequest, reviewXml } from "../fixtures/pdv-stone-review";
const scope = { workspaceId: "coala", kioskId: "review-unit", stoneCode: "123", referenceDate: "2026-09-20" };
const hash = "a".repeat(64); const document = "12345678000199";
const payment = { id: "event-1", amount: "600", status: "paid", payment_method: "pix",
  created_at: "2026-09-20T13:22:35.000000Z", pix_transaction__e2e_id: "e2e-1",
  pix_transaction__paid_amount: "600", pix_transaction__canceled_amount: "0", pix_transaction__fee_amount: "3",
  pix_transaction__additional_data: "[{name=Cliente, value=123}, {name=Terminal, value=TERM-1}]",
  pix_transaction__detail__operation: "pay", pix_transaction__detail__operation_amount: "600",
  pix_transaction__detail__provider_datetime: "2026-09-20T13:22:36.000" };
function snapshot() {
  return { scope, document, fileId: "pix-file", head: { workspaceId: "coala", document,
    referenceDate: scope.referenceDate, status: "processed", sourceHash: hash, summary: { transactionCount: 1 } },
    rows: parseStonePixCsv(Papa.unparse([payment])).transactions.map(row => ({ ...row, sourceHash: hash })) };
}
test("Pix source requires a complete matching generation and isolates StoneCode", () => {
  const result = reviewPixSnapshot(snapshot());
  assert.equal(result.status, "available"); assert.equal(result.facts.length, 1);
  assert.equal(result.facts[0].grossAmountCents, 600);
  assert.equal(reviewPixSnapshot({ ...snapshot(), scope: { ...scope, stoneCode: "999" } }).facts.length, 0);
  for (const change of [{ workspaceId: "foreign" }, { document: "99999999999" },
    { status: "processing" }, { sourceHash: "b".repeat(64) }, { summary: { transactionCount: 2 } }]) {
    const input = snapshot(); Object.assign(input.head, change);
    assert.equal(reviewPixSnapshot(input).status, "pending");
  }
});
test("legacy Pix without evidence, oversized file and mixed hashes remain pending", () => {
  const input = snapshot();
  assert.equal(reviewPixSnapshot({ ...input, rows: [{ rowId: input.rows[0].rowId }] }).status, "pending");
  assert.equal(reviewPixSnapshot({ ...input, rows: Array(501).fill(input.rows[0]) }).status, "pending");
  input.rows[0].sourceHash = "c".repeat(64);
  assert.equal(reviewPixSnapshot(input).status, "pending");
});
test("stored candidate flag cannot override amounts, identity, duplicates or local business date", () => {
  const input = snapshot(); input.rows[0].reviewEvidence.amounts.gross = 601;
  assert.equal(reviewPixSnapshot(input).facts.length, 0);
  const early = snapshot(); early.rows[0].reviewEvidence.createdAtUtc = "2026-09-20T02:00:00Z";
  assert.equal(reviewPixSnapshot(early).facts.length, 0);
  const duplicate = snapshot(); duplicate.head.summary.transactionCount = 2;
  duplicate.rows.push({ ...duplicate.rows[0], rowId: "b".repeat(64) });
  assert.equal(reviewPixSnapshot(duplicate).facts.length, 0);
});
test("daily query compares Pix only when source is available and never approves suggestions", async () => {
  const dependencies = { resolveBinding: async () => salesBinding,
    readPdv: async () => [{ codcupom: "pix-coupon", dtrecebimento: "2026-09-20 10:22:35", valortotal: "6.00", formaPgtos: [{ nome: "PIX", valortotal: "6.00" }] }],
    readStone: async () => reviewXml, now: () => new Date("2026-09-22T12:00:00Z") };
  const result = await queryDailySales(salesRequest, { isDefaultAdmin: true, workspace_id: "coala" }, {
    ...dependencies, readPix: async () => reviewPixSnapshot(snapshot()),
  });
  assert.equal(result.pix.status, "available"); assert.equal(result.uncomparedPdvFacts.length, 0);
  assert.ok(result.cases.some(row => row.channel === "pix" && row.pdvFactIds.length && row.stoneSaleIds.length));
  assert.ok(result.cases.every(row => row.reviewStatus === "pending_review"));
  const missing = await queryDailySales(salesRequest, { isDefaultAdmin: true, workspace_id: "coala" }, dependencies);
  assert.equal(missing.uncomparedPdvFacts.length, 1); assert.ok(missing.cases.every(row => row.channel !== "pix"));
});
