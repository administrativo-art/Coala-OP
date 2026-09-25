import assert from "node:assert/strict";
import test from "node:test";
import { estimateInputPurchase } from "../../src/features/financial/lib/budget-input-estimate";

test("estima estoque de abertura, pedidos confirmados e compra adicional sem descontar duas vezes", () => {
  const result = estimateInputPurchase({
    baseProductId: "leite", name: "Leite", unit: "L",
    monthlyConsumption: 300, stockNow: 100, inboundBeforeMonth: 50, inboundDuringMonth: 60,
    daysUntilMonth: 5, targetMonthDays: 30, closingStockDays: 7, pricePerUnit: 4,
  });
  assert.equal(result.openingStockQuantity, 100);
  assert.equal(result.closingStockQuantity, 70);
  assert.equal(result.additionalPurchaseQuantity, 210);
  assert.equal(result.additionalPurchaseAmountCents, 84000);
});

test("não sugere compra negativa quando estoque e pedidos já cobrem a necessidade", () => {
  const result = estimateInputPurchase({
    baseProductId: "casquinha", name: "Casquinha", unit: "un",
    monthlyConsumption: 100, stockNow: 300, inboundBeforeMonth: 0, inboundDuringMonth: 50,
    daysUntilMonth: 0, targetMonthDays: 31, closingStockDays: 0, pricePerUnit: 1,
  });
  assert.equal(result.additionalPurchaseQuantity, 0);
  assert.equal(result.additionalPurchaseAmountCents, 0);
});
