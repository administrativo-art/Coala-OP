import assert from "node:assert/strict";
import test from "node:test";

import {
  getPurchaseOrderConfirmationIssues,
  purchaseOrderDisplayCode,
} from "../../src/lib/purchasing-order-readiness";
import type { PurchaseOrder, PurchaseOrderItem } from "../../src/types";

function readyOrder(
  overrides: Partial<PurchaseOrder> = {},
): PurchaseOrder {
  return {
    id: "amazon_702_2009843_2901867_20261009",
    workspaceId: "coala",
    origin: "direct",
    externalOrderNumber: "702-2009843-2901867",
    supplierId: "supplier",
    receiptMode: "future_delivery",
    status: "created",
    estimatedReceiptDate: "2026-10-22",
    paymentDueDate: "2026-10-09",
    paymentMethod: "card_credit",
    paymentAccountId: "account",
    paymentMethodId: "method",
    paymentCondition: "cash",
    accountPlanId: "account-plan",
    resultCenterId: "result-center",
    totalEstimated: 114.67,
    createdAt: "2026-10-12T12:59:36.271Z",
    createdBy: "test",
    ...overrides,
  };
}

function readyItem(
  overrides: Partial<PurchaseOrderItem> = {},
): PurchaseOrderItem {
  return {
    id: "item-1",
    purchaseOrderId: "order-1",
    baseItemId: "base-1",
    productId: "product-1",
    unit: "un",
    quantityOrdered: 1,
    unitPriceOrdered: 10,
    totalOrdered: 10,
    itemTreatment: "stock",
    ...overrides,
  };
}

test("gera código estável pelo número externo e distingue ids com a mesma data", () => {
  assert.equal(
    purchaseOrderDisplayCode(readyOrder()),
    "CMP-32901867",
  );
  assert.equal(
    purchaseOrderDisplayCode({
      ...readyOrder(),
      id: "mercadolivre_2000018887790516_20261009",
      externalOrderNumber: "2000018887790516",
    }),
    "CMP-87790516",
  );
});

test("explica todos os dados ausentes de um pedido legado sem quebrar a tela", () => {
  const order = readyOrder({
    paymentDueDate: null as unknown as string,
    paymentAccountId: null,
    paymentMethodId: null,
    accountPlanId: undefined,
    resultCenterId: undefined,
    estimatedReceiptDate: null as unknown as string,
  });

  assert.deepEqual(
    getPurchaseOrderConfirmationIssues(order, []).map((issue) => issue.code),
    [
      "items",
      "payment_due_date",
      "payment_card",
      "account_plan",
      "result_center",
      "estimated_receipt_date",
    ],
  );
});

test("não exige produto para consumo direto, mas mantém estoque sem vínculo pendente", () => {
  const expenseItem = readyItem({
    baseItemId: "",
    productId: undefined,
    itemTreatment: "expense",
  });
  assert.deepEqual(getPurchaseOrderConfirmationIssues(readyOrder(), [expenseItem]), []);

  const stockItem = readyItem({ baseItemId: "", productId: undefined });
  assert.deepEqual(
    getPurchaseOrderConfirmationIssues(readyOrder(), [stockItem]).map(
      (issue) => issue.code,
    ),
    ["stock_item_registration"],
  );

  const legacyAsset = readyItem({
    baseItemId: "",
    productId: undefined,
    itemTreatment: undefined,
    entryType: "asset",
  });
  assert.deepEqual(getPurchaseOrderConfirmationIssues(readyOrder(), [legacyAsset]), []);
});
