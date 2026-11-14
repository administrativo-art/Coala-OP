import assert from "node:assert/strict";
import test from "node:test";
import { receivableItems, receivableMonths, receivableTotals, receivableWeeks, rightsByNature } from "../../src/features/financial/receivables/receivable-view";
import type { StonePortfolioRow } from "../../src/features/financial/receivables/portfolio-projection";

const row = (overrides: Partial<StonePortfolioRow>): StonePortfolioRow => ({
  transactionId: "t1", installment: 1, saleDate: "2026-11-10", dueDate: "2026-11-16", gross: "100.00", net: "97.11",
  status: "open", reason: null, paymentDate: null, sourceFileIds: ["f"],
  brandCode: "1", accountTypeCode: "2", installmentCount: 1, mdr: "2.89", ...overrides,
});

test("parcelas abertas: bandeira e modalidade pela tabela Stone; paga não entra", () => {
  const items = receivableItems([row({}), row({ transactionId: "t2", status: "paid" }), row({ transactionId: "t3", brandCode: "171", accountTypeCode: "2", installmentCount: 3, installment: 2, dueDate: "2026-12-10" })]);
  assert.equal(items.length, 2);
  assert.equal(items[0].brand, "Visa");
  assert.equal(items[0].modality, "credit");
  assert.equal(items[0].feeCents, 289);
  assert.equal(items[0].feeSource, "stone");
  assert.equal(items[1].modality, "installment");
  assert.deepEqual(receivableMonths(items), ["2026-11", "2026-12"]);
});

test("sem MDR a taxa é proposta (bruto − líquido); carteira antiga fica sem cartão e sem taxa", () => {
  const [noMdr] = receivableItems([row({ mdr: null })]);
  assert.equal(noMdr.feeCents, 289);
  assert.equal(noMdr.feeSource, "derived");
  const legacy = row({});
  delete legacy.brandCode; delete legacy.accountTypeCode; delete legacy.installmentCount; delete legacy.mdr;
  const [old] = receivableItems([legacy]);
  assert.equal(old.brand, null);
  assert.equal(old.feeCents, null);
  assert.equal(receivableTotals([old]).feeUnknown, 1);
});

test("semanas de segunda a domingo com bruto, taxa e líquido", () => {
  const items = receivableItems([row({ dueDate: "2026-11-16" }), row({ transactionId: "t2", dueDate: "2026-11-22" }), row({ transactionId: "t3", dueDate: "2026-11-23" })]);
  const weeks = receivableWeeks(items);
  assert.deepEqual(weeks.map(week => [week.from, week.first, week.last, week.totals.count]), [["2026-11-16", "2026-11-16", "2026-11-22", 2], ["2026-11-23", "2026-11-23", "2026-11-23", 1]]);
  assert.equal(weeks[0].totals.grossCents, 20000);
  assert.equal(weeks[0].totals.netCents, 19422);
});

test("posição por natureza: total e detalhe por arranjo; natureza desconhecida só aparece se existir", () => {
  const natures = rightsByNature([
    { walletTypeId: "3", walletNatureId: "1", nature: "regular", category: "Liquidação", amount: "100.50" },
    { walletTypeId: "6", walletNatureId: "1", nature: "regular", category: "Liquidação", amount: "50.00" },
    { walletTypeId: "6", walletNatureId: "2", nature: "warranty", category: "Garantia", amount: "20.00" },
  ]);
  assert.deepEqual(natures.map(item => [item.key, item.cents]), [["regular", 15050], ["stone_anticipation", 0], ["warranty", 2000], ["ownership_assignment", 0]]);
  assert.equal(natures[0].rows[0].label, "Visa crédito");
});
