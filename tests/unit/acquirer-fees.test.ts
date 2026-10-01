import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { collectFeeEvidence, feeTotalCents } from "../../src/features/financial/acquirer-fees/evidence";
import { feeActionSchema, type FeeRequest } from "../../src/features/financial/acquirer-fees/contracts";
import { reviewPixSnapshot } from "../../src/features/financial/sales-reconciliation/pix-source";
import { parseStoneAgendaXml } from "../../src/lib/integrations/stone/agenda-parser";
import { cardXml } from "../helpers/acquirer-fee-fixtures";
const request: FeeRequest = { kioskId: "unit", mappingId: "mapping", stoneCode: "123", referenceDate: "2026-10-01", source: "cards" };
const parse = (date: string, paid: boolean, extras = "", fees?: string[]) => parseStoneAgendaXml(cardXml(date, paid, fees, extras), { stoneCode: "123", referenceDate: date });
const noPix = { status: "not_configured" as const, coverage: null, facts: [], excludedCount: 0, fileId: null };

test("XML soma frações antes de centavos; MDR da venda e antecipação do evento não mudam de competência", () => {
  assert.equal(feeTotalCents(["0.004", "0.004"]), 1);
  const paid = parse("2026-10-01", true, "<AdvanceRateAmount>0.1</AdvanceRateAmount><AdvancedReceivableOriginalPaymentDate>20261010</AdvancedReceivableOriginalPaymentDate>");
  const result = collectFeeEvidence(request, "coala", paid, [parse("2026-09-01", false)], noPix);
  assert.equal(result.batches.find(row => row.kind === "mdr")?.amountCents, 1);
  assert.equal(result.batches.find(row => row.kind === "mdr")?.competenceDate, "2026-09-01");
  assert.equal(result.batches.find(row => row.kind === "anticipation")?.competenceDate, "2026-10-01");
  assert.equal(result.batches.find(row => row.kind === "anticipation")?.amountCents, 20);
  assert.ok(result.pending.some(text => text.includes("residual")));
});
test("SaleFee, moeda ausente, estorno, pagamento parcial e MDR ausente não geram taxa presumida", () => {
  const original = parse("2026-09-01", false);
  for (const mutate of [
    (file: ReturnType<typeof parse>) => { file.transactions[0].installments[0].saleFee = "1"; },
    (file: ReturnType<typeof parse>) => { file.transactions[0].events.Chargebacks = 1; },
    (file: ReturnType<typeof parse>) => { file.transactions[0].installments[0].grossAmount = "5"; },
    (file: ReturnType<typeof parse>) => { file.transactions[0].installments[0].mdrAmount = null; },
  ]) {
    const paid = parse("2026-10-01", true, "", ["0.1"]); mutate(paid);
    const result = collectFeeEvidence(request, "coala", paid, [original], noPix);
    assert.equal(result.batches.length, 0); assert.ok(result.pending.length);
  }
  const paid = parse("2026-10-01", true);
  for (const txn of original.transactions) txn.currencyCode = null;
  assert.equal(collectFeeEvidence(request, "coala", paid, [original], noPix).batches.length, 0);
});
test("identidade independe de FileId/revisão/ordem; mudança de valor altera fingerprint, não claim", () => {
  const original = parse("2026-09-01", false), paid = parse("2026-10-01", true);
  const first = collectFeeEvidence(request, "coala", paid, [original], noPix).batches[0];
  paid.fileId = "reprocessed"; paid.transactions.reverse();
  assert.deepEqual(collectFeeEvidence(request, "coala", paid, [original], noPix).batches[0], first);
  paid.transactions[0].installments[0].mdrAmount = "0.1";
  const changed = collectFeeEvidence(request, "coala", paid, [original], noPix).batches[0];
  assert.equal(changed.id, first.id); assert.notEqual(changed.fingerprint, first.fingerprint);
});
test("mais de100 componentes no grupo não é fracionado/arredondado em silêncio", () => {
  const fees = Array(101).fill("0.004");
  const result = collectFeeEvidence(request, "coala", parse("2026-10-01", true, "", fees), [parse("2026-09-01", false, "", fees)], noPix);
  assert.equal(result.batches.length, 0); assert.ok(result.pending.some(text => text.includes("100")));
});
test("evidência Pix vem só das linhas validadas e usa e2e, não posição do arquivo", () => {
  const scope = { workspaceId: "coala", kioskId: "unit", stoneCode: "123", referenceDate: "2026-09-01" };
  const hash = "a".repeat(64), fileId = "file";
  const row = { rowId: "b".repeat(64), sourceHash: hash, status: "paid", paymentMethod: "pix",
    merchantIdentity: { version: 1, status: "identified", stoneCode: "123", terminalSerialNumber: "terminal" },
    reviewEvidence: { version: 1, eventId: "event", e2eId: "e2e", refundId: null, createdAtUtc: "2026-09-01T12:00:00Z", providerDateTimeUtc: "2026-09-01T12:00:01Z", eventKind: "payment",
      amounts: { gross: 1000, paid: 1000, canceled: 0, fee: 5, operation: 1000 }, issues: [], candidateForReview: true } };
  const head = { ...scope, document: "12345678901", status: "processed", schemaVersion: 1,
    sourceHash: hash, summary: { transactionCount: 1 } };
  const pix = reviewPixSnapshot({ head, rows: [row], document: head.document, fileId, scope });
  assert.equal(pix.feeEvidence?.[0].feeCents, 5);
  const first = collectFeeEvidence({ ...request, ...scope, source: "pix" }, "coala", null, [], pix).batches[0];
  row.rowId = "c".repeat(64);
  const reordered = reviewPixSnapshot({ head, rows: [row], document: head.document, fileId, scope });
  assert.equal(collectFeeEvidence({ ...request, ...scope, source: "pix" }, "coala", null, [], reordered).batches[0].id, first.id);
  const duplicate = reviewPixSnapshot({ head: { ...head, summary: { transactionCount: 2 } }, rows: [row, { ...row, rowId: "d".repeat(64) }], document: head.document, fileId, scope });
  assert.equal(duplicate.feeEvidence?.length, 0);
});
test("SaleFee na origem também impede apropriar MDR separadamente", () => {
  const original = parse("2026-09-01", false);
  original.transactions[0].installments.forEach(item => { item.saleFee = "0.1"; });
  assert.equal(collectFeeEvidence(request, "coala", parse("2026-10-01", true), [original], noPix).batches.length, 0);
});

test("fronteira estrita e UI separam preview, comparar vendas e confirmação", () => {
  assert.equal(feeActionSchema.safeParse({ action: "preview", request, amountCents: 99 }).success, false);
  const ui = readFileSync(new URL("../../src/features/financial/acquirer-fees/fees-panel.tsx", import.meta.url), "utf8");
  assert.match(ui, /Consultar prévia — sem gravar/); assert.match(ui, /confirmedNoManualExpense/);
  assert.match(ui, /Consultar registros anteriores/); assert.match(ui, /action: "cancel"/);
  assert.doesNotMatch(ui, /setInterval|onSnapshot/);
});
