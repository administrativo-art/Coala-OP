import assert from "node:assert/strict";
import test from "node:test";

import { buildPurchaseExpenseComponents } from "../../src/lib/purchase-financial-expenses";

const base = {
  totalValue: 7_600,
  deliveryFee: 800,
  goodsSupplier: "E LOBATO",
  freightSupplier: "Kajiya",
  goodsAccountPlanId: "goods",
  goodsAccountPlanName: "Insumos composição",
  freightAccountPlanId: "freight",
  freightAccountPlanName: "Frete | Compras gerais",
};

test("cria duas despesas quando o frete é pago separadamente", () => {
  assert.deepEqual(buildPurchaseExpenseComponents({
    ...base,
    freightPaymentMode: "separate",
  }), [
    {
      role: "goods",
      description: "Compra E LOBATO",
      supplier: "E LOBATO",
      totalValue: 6_800,
      accountPlanId: "goods",
      accountPlanName: "Insumos composição",
      hasAccountAllocations: false,
      accountAllocations: null,
    },
    {
      role: "freight",
      description: "Frete sobre compra | Kajiya",
      supplier: "Kajiya",
      totalValue: 800,
      accountPlanId: "freight",
      accountPlanName: "Frete | Compras gerais",
      hasAccountAllocations: false,
      accountAllocations: null,
    },
  ]);
});

test("mantém um pagamento e desmembra os planos quando o frete é pago junto", () => {
  assert.deepEqual(buildPurchaseExpenseComponents({
    ...base,
    freightPaymentMode: "included_with_goods",
  }), [{
    role: "combined",
    description: "Compra E LOBATO",
    supplier: "E LOBATO",
    totalValue: 7_600,
    accountPlanId: "goods",
    accountPlanName: "Insumos composição",
    hasAccountAllocations: true,
    accountAllocations: [
      { accountPlanId: "goods", accountPlanName: "Insumos composição", amount: 6_800 },
      { accountPlanId: "freight", accountPlanName: "Frete | Compras gerais", amount: 800 },
    ],
  }]);
});

test("não cria despesa de frete quando o pedido não tem frete", () => {
  const [expense] = buildPurchaseExpenseComponents({ ...base, deliveryFee: 0, freightPaymentMode: "separate" });
  assert.equal(expense.role, "goods");
  assert.equal(expense.totalValue, 7_600);
});

test("não permite frete separado sem favorecido", () => {
  assert.throws(
    () => buildPurchaseExpenseComponents({ ...base, freightPaymentMode: "separate", freightSupplier: "" }),
    /Informe o favorecido do frete pago separadamente/,
  );
});
