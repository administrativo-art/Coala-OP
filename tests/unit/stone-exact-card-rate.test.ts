import assert from "node:assert/strict";
import test from "node:test";

import { feeGroups, feeSales, saleRate } from "../../src/features/financial/receipts-reconciliation/fee-review";
import { parcelProblems, rateDiffersFromUsual } from "../../src/features/financial/receipts-reconciliation/stone-account-format";
import {
  parcelFeeRate,
  resolveCardFee,
  summarizeReceiptGroups,
  type ReceiptParcel,
} from "../../src/features/financial/receipts-reconciliation/stone-account";

// Valores reais do layout 2.2 (12/11/2026): débito R$ 17,00, líquido com 6 casas.
test("líquido com 6 casas dá a taxa exata, sem arredondar a centavos", () => {
  const fee = resolveCardFee({ gross: "17.000000", net: "16.751800" });
  assert.equal(fee.feeSource, "exact");
  assert.equal(fee.feeCents, 25);
  assert.equal(fee.feeRate, 0.0146);
});

test("MDR informado continua prevalecendo; só centavos vira taxa proposta sem taxa exata", () => {
  assert.deepEqual(resolveCardFee({ mdr: "0.248200", gross: "17.000000", net: "16.751800" }), { feeCents: 25, feeSource: "stone", feeRate: 0.0146 });
  assert.deepEqual(resolveCardFee({ gross: "17.00", net: "16.75" }), { feeCents: 25, feeSource: "derived", feeRate: null });
  assert.deepEqual(resolveCardFee({ gross: "17.000000", net: "17.500000" }), { feeCents: null, feeSource: null, feeRate: null });
  assert.equal(resolveCardFee({ gross: "17.000000", net: "16.000000", anticipation: "0.500000" }).feeRate, 0.02941176);
});

const card = (id: string, grossCents: number, gross: string, net: string, date = "2026-11-05"): ReceiptParcel => ({
  id: `${id}:1`, saleId: id, source: "card", installment: 1, installmentCount: 1, brandCode: "2", brand: "Mastercard",
  modality: "debit", saleDate: date, saleTime: "10:00:00", grossCents, ...resolveCardFee({ gross, net }),
  anticipationCents: null, expectedNetCents: grossCents, expectedDate: date, paidDate: date, paidNetCents: grossCents, status: "paid",
});

// Vendas pequenas a 1,46%: em centavos a taxa "pula" entre 1,43% e 1,50%; a exata é sempre 1,46%.
const smallSales = [
  card("a", 700, "7.000000", "6.897800"),
  card("b", 600, "6.000000", "5.912400"),
  card("c", 3600, "36.000000", "35.474400"),
  card("d", 6000, "60.000000", "59.124000"),
  card("e", 1100, "11.000000", "10.839400"),
];

test("vendas pequenas não viram 'Taxa fora da atual' por arredondamento", () => {
  assert.deepEqual(smallSales.map(parcel => Math.round(parcelFeeRate(parcel)! * 10_000) / 10_000), [0.0146, 0.0146, 0.0146, 0.0146, 0.0146]);
  const group = summarizeReceiptGroups(smallSales, "2026-11-01", "2026-11-30", "2026-11-30").find(item => item.modality === "debit")!;
  assert.equal(group.usualRate, 0.0146);
  assert.equal(group.feeToVerifyCount, 0);
  for (const parcel of smallSales) assert.deepEqual(parcelProblems(parcel, 0.0146), []);
});

test("taxa exata diferente da atual continua apontada", () => {
  const other = card("x", 6000, "60.000000", "59.100000");
  assert.equal(rateDiffersFromUsual(other, 0.0146), true);
  assert.deepEqual(parcelProblems(other, 0.0146).map(item => item.label), ["Taxa fora da atual"]);
});

test("aba Taxas sugere a taxa exata e não trata as vendas como 'sem MDR'", () => {
  const sales = feeSales(smallSales);
  assert.deepEqual(sales.map(sale => sale.derived), [false, false, false, false, false]);
  assert.equal(Math.round(saleRate(sales[0]) * 10_000) / 10_000, 0.0146);
  const [group] = feeGroups(sales, new Map(), "2026-11-30");
  assert.equal(group.suggestedRate, 0.0146);
});

test("conferência salva antes da mudança (sem feeRate) mantém a regra de 1 centavo", () => {
  const legacy: ReceiptParcel = { ...card("old", 700, "7.000000", "6.897800"), feeRate: undefined, feeCents: 10, feeSource: "derived" };
  assert.equal(parcelFeeRate(legacy), 10 / 700);
  assert.equal(rateDiffersFromUsual({ ...legacy, feeSource: "exact" }, 0.0146), false);
});
