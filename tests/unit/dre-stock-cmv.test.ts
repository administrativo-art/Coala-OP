import assert from "node:assert/strict";
import test from "node:test";

import {
  isDreStockOutflowMovement,
  summarizeDreStockMovements,
} from "../../src/features/financial/dre/stock-cmv";
import type { BaseProduct, EffectiveCostEntry, MovementRecord, Product } from "../../src/types";

function movement(
  id: string,
  type: MovementRecord["type"],
  quantityChange: number,
  timestamp: string,
  overrides: Partial<MovementRecord> = {},
): MovementRecord {
  return {
    id,
    lotId: `lot-${id}`,
    productId: "product-a",
    productName: "Produto A",
    lotNumber: "L1",
    type,
    quantityChange,
    fromKioskId: "kiosk-1",
    userId: "user-1",
    username: "Operador",
    timestamp,
    ...overrides,
  };
}

const product: Product = {
  id: "product-a",
  baseName: "Produto A",
  category: "Massa",
  packageSize: 1_000,
  unit: "g",
  baseProductId: "base-a",
};

const baseProduct: BaseProduct = {
  id: "base-a",
  name: "Produto A",
  category: "Massa",
  unit: "g",
  initialCostPerUnit: 0.008,
  stockLevels: {},
};

function cost(id: string, occurredAt: string, unitCost: number): EffectiveCostEntry {
  return {
    id,
    workspaceId: "workspace-1",
    baseItemId: "base-a",
    supplierId: "supplier-1",
    unitCost,
    quantity: 1,
    purchaseReceiptId: "receipt-1",
    purchaseReceiptLotId: "lot-1",
    purchaseOrderId: "order-1",
    occurredAt,
  };
}

test("classifica somente saídas operacionais válidas para o CMV por estoque", () => {
  assert.equal(isDreStockOutflowMovement(movement("1", "SAIDA_CONSUMO", 1, "2026-08-10T12:00:00Z")), true);
  assert.equal(isDreStockOutflowMovement(movement("2", "SAIDA_DESCARTE_PERDA", 1, "2026-08-10T12:00:00Z")), true);
  assert.equal(isDreStockOutflowMovement(movement("3", "SAIDA_CORRECAO", 1, "2026-08-10T12:00:00Z")), true);
  assert.equal(isDreStockOutflowMovement(movement("4", "TRANSFERENCIA_SAIDA", 1, "2026-08-10T12:00:00Z")), false);
  assert.equal(isDreStockOutflowMovement(movement("5", "SAIDA_CONSUMO", 1, "2026-08-10T12:00:00Z", { reverted: true })), false);
  assert.equal(isDreStockOutflowMovement(movement("6", "SAIDA_ENTREGA_UNIFORME", 1, "2026-08-10T12:00:00Z")), false);
});

test("valoriza cada saída pelo último custo efetivo disponível e separa perdas e ajustes", () => {
  const result = summarizeDreStockMovements([
    movement("1", "SAIDA_CONSUMO", 2, "2026-08-10T12:00:00Z"),
    movement("2", "SAIDA_CONSUMO", 1, "2026-08-20T12:00:00Z"),
    movement("3", "SAIDA_DESCARTE_AVARIA", 0.5, "2026-08-20T12:00:00Z"),
    movement("4", "SAIDA_CORRECAO", 0.25, "2026-08-20T12:00:00Z"),
    movement("5", "TRANSFERENCIA_SAIDA", 100, "2026-08-20T12:00:00Z"),
  ], {
    productsById: new Map([[product.id, product]]),
    baseProductsById: new Map([[baseProduct.id, baseProduct]]),
    effectiveCostsByBaseProductId: new Map([[
      baseProduct.id,
      [
        cost("cost-1", "2026-08-01T12:00:00Z", 0.01),
        cost("cost-2", "2026-08-15T12:00:00Z", 0.012),
      ],
    ]]),
  });

  assert.deepEqual(result.stockSummaries, [{
    kioskId: "kiosk-1",
    year: 2026,
    month: 8,
    consumptionCmv: 32,
    lossesCmv: 6,
    adjustmentsCmv: 3,
    totalCmv: 41,
    movementCount: 4,
    unpricedMovementCount: 0,
    movementDays: 2,
    firstMovementAt: "2026-08-10T12:00:00Z",
    lastMovementAt: "2026-08-20T12:00:00Z",
  }]);
});

test("usa o custo inicial como fallback e sinaliza movimentos sem cadastro ou custo", () => {
  const noCostBase = { ...baseProduct, id: "base-no-cost", initialCostPerUnit: undefined };
  const noCostProduct = { ...product, id: "product-no-cost", baseProductId: noCostBase.id };
  const result = summarizeDreStockMovements([
    movement("1", "SAIDA_CONSUMO", 1, "2026-09-01T02:30:00Z"),
    movement("2", "SAIDA_CONSUMO", 1, "2026-08-20T12:00:00Z", { productId: noCostProduct.id }),
    movement("3", "SAIDA_CONSUMO", 1, "2026-08-20T12:00:00Z", { productId: "missing-product" }),
  ], {
    productsById: new Map([[product.id, product], [noCostProduct.id, noCostProduct]]),
    baseProductsById: new Map([[baseProduct.id, baseProduct], [noCostBase.id, noCostBase]]),
    effectiveCostsByBaseProductId: new Map(),
  });

  assert.equal(result.stockSummaries.length, 1);
  assert.equal(result.stockSummaries[0].year, 2026);
  assert.equal(result.stockSummaries[0].month, 8);
  assert.equal(result.stockSummaries[0].consumptionCmv, 8);
  assert.equal(result.stockSummaries[0].movementCount, 3);
  assert.equal(result.stockSummaries[0].unpricedMovementCount, 2);
  assert.deepEqual(result.missingProductIds, ["missing-product"]);
  assert.deepEqual(result.unpricedBaseProductIds, ["base-no-cost"]);
});
