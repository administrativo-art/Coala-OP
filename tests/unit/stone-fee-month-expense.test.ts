import assert from "node:assert/strict";
import test from "node:test";

import { feeExpenseActionSchema, planFeeMonthExpense } from "../../src/features/financial/receipts-reconciliation/fee-month-expense";
import { rateDiffersFromUsual } from "../../src/features/financial/receipts-reconciliation/stone-account-format";
import { pixFeeForRate, resolveCardFee, summarizeReceiptGroups, truncatedNominalRate, type ReceiptParcel } from "../../src/features/financial/receipts-reconciliation/stone-account";

const pix = (id: string, grossCents: number, feeCents: number, date = "2026-10-05"): ReceiptParcel => ({
  id: `pix:${id}`, saleId: id, source: "pix", installment: 1, installmentCount: 1, brandCode: null, brand: null, modality: "pix",
  saleDate: date, saleTime: "10:00:00", grossCents, feeCents, feeSource: "stone", feeRate: null, anticipationCents: null,
  expectedNetCents: grossCents - feeCents, expectedDate: date, paidDate: date, paidNetCents: grossCents - feeCents, status: "paid",
});
const card = (id: string, modality: ReceiptParcel["modality"], gross: string, net: string, date = "2026-10-05"): ReceiptParcel => {
  const grossCents = Math.round(Number(gross) * 100);
  return { id: `${id}:1`, saleId: id, source: "card", installment: 1, installmentCount: 1, brandCode: "1", brand: "Visa", modality,
    saleDate: date, saleTime: "10:00:00", grossCents, ...resolveCardFee({ gross, net }), anticipationCents: null,
    expectedNetCents: grossCents, expectedDate: date, paidDate: date, paidNetCents: grossCents, status: "paid" };
};

// Valores reais de nov/2026: a Stone cobra 0,75% no Pix e corta os centavos para baixo.
test("Pix: taxa nominal pela regra de corte dos centavos", () => {
  const sales = [pix("a", 500, 3), pix("b", 700, 5), pix("c", 1000, 7), pix("d", 1600, 12), pix("e", 3400, 25)];
  assert.deepEqual(sales.map(sale => pixFeeForRate(sale.grossCents, 0.0075)), [3, 5, 7, 12, 25]);
  assert.equal(truncatedNominalRate(sales), 0.0075);
  const group = summarizeReceiptGroups(sales, "2026-10-01", "2026-10-31", "2026-10-31").find(item => item.modality === "pix")!;
  assert.equal(group.usualRate, 0.0075);
  for (const sale of sales) assert.equal(rateDiffersFromUsual(sale, 0.0075), false);
  assert.equal(rateDiffersFromUsual(pix("x", 1000, 9), 0.0075), true);
});

const base = {
  month: "2026-10",
  result: { latestPublished: "2026-10-31", parcels: [pix("p1", 1000, 7), pix("p2", 500, 3),
    card("d1", "debit", "20.000000", "19.708000"), card("c1", "credit", "50.000000", "48.890000"), card("c2", "installment", "30.000000", "29.334000")] },
  pendingCount: 0, unconfirmedGroups: [],
};

test("plano do mês: uma despesa por tipo com as taxas das vendas do mês", () => {
  const plan = planFeeMonthExpense(base);
  assert.deepEqual(plan.blockers, []);
  assert.deepEqual(plan.items.map(item => [item.kind, item.amountCents, item.saleCount]), [["pix", 10, 2], ["debit", 29, 1], ["credit", 178, 2]]);
  assert.equal(plan.totalCents, 217);
  assert.equal(plan.fingerprint, "2026-10|pix:10|debit:29|credit:178");
  assert.equal(feeExpenseActionSchema.safeParse({ action: "launch", kioskId: "k", stoneCode: "1", month: "2026-10", fingerprint: plan.fingerprint, resultCenterId: "c" }).success, true);
});

test("plano do mês: vendas de outro mês não entram", () => {
  const plan = planFeeMonthExpense({ ...base, result: { ...base.result, parcels: [...base.result.parcels, pix("old", 2000, 15, "2026-09-30")] } });
  assert.equal(plan.items[0].amountCents, 10);
});

test("plano do mês: bloqueia mês aberto, pendências, grupos sem taxa confirmada e taxa não exata", () => {
  assert.match(planFeeMonthExpense({ ...base, result: null }).blockers[0], /não foi conferido/);
  assert.match(planFeeMonthExpense({ ...base, result: { ...base.result, latestPublished: "2026-10-30" } }).blockers[0], /não fechou.*31\/10/);
  assert.match(planFeeMonthExpense({ ...base, pendingCount: 2 }).blockers[0], /2 pendência/);
  assert.match(planFeeMonthExpense({ ...base, unconfirmedGroups: ["Pix"] }).blockers[0], /Confirme a taxa atual de: Pix/);
  const derived = card("dv", "debit", "20.00", "19.71");
  assert.match(planFeeMonthExpense({ ...base, result: { ...base.result, parcels: [...base.result.parcels, derived] } }).blockers[0], /sem taxa exata/);
  const review = { ...pix("r", 1000, 7), status: "review" as const };
  assert.match(planFeeMonthExpense({ ...base, result: { ...base.result, parcels: [...base.result.parcels, review] } }).blockers[0], /Conferir/);
  const other = card("o", "other", "20.000000", "19.708000");
  assert.match(planFeeMonthExpense({ ...base, result: { ...base.result, parcels: [...base.result.parcels, other] } }).blockers[0], /tipo de cartão não informado/);
});

test("ação de lançar recusa campos extras e impressão digital fora do formato", () => {
  assert.equal(feeExpenseActionSchema.safeParse({ action: "launch", kioskId: "k", stoneCode: "1", month: "2026-10", fingerprint: "x", resultCenterId: "c" }).success, false);
  assert.equal(feeExpenseActionSchema.safeParse({ action: "cancel", kioskId: "k", stoneCode: "1", month: "2026-10", reason: "ok" }).success, false);
  assert.equal(feeExpenseActionSchema.safeParse({ action: "cancel", kioskId: "k", stoneCode: "1", month: "2026-10", reason: "valor errado", amount: 1 }).success, false);
});

test("coluna Taxa do Pix: taxa atual e valor cobrado quando segue a regra de corte", async () => {
  const { parcelRateText } = await import("../../src/features/financial/receipts-reconciliation/stone-account-format");
  const small = parcelRateText(pix("s", 200, 1), 0.0075);
  assert.match(small.text, /^0,75% · R\$\s0,01$/);
  assert.match(small.title ?? "", /efetiva 0,50%/);
  assert.equal(parcelRateText(pix("x", 1000, 9), 0.0075).text, "0,90%");
  assert.equal(parcelRateText(pix("n", 1000, 7), null).text, "0,70%");
});
