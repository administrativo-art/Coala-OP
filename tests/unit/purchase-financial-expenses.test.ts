import assert from "node:assert/strict";
import test from "node:test";

import {
  assertPurchaseExpenseCanSync,
  buildPurchaseExpenseComponents,
  buildPurchaseExpensePaymentPlan,
  purchaseExpenseHasLockedCardStatementEvidence,
  type PurchasePaymentInstrument,
} from "../../src/lib/purchase-financial-expenses";

const creditCard: PurchasePaymentInstrument = {
  accountId: "inter",
  accountName: "Banco Inter",
  methodId: "card-1127",
  methodLabel: "Cartão Crédito Inter - 1127",
  type: "credit_card",
  closingDay: 5,
  dueDay: 12,
};

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

test("coloca a compra no crédito dentro da fatura posterior ao fechamento", () => {
  const plan = buildPurchaseExpensePaymentPlan({
    paymentMethod: "card_credit",
    purchaseDate: "2026-09-08",
    paymentDueDate: "2026-09-08",
    paymentCondition: "cash",
  }, creditCard);

  assert.equal(plan.plannedPaymentMethodType, "credit_card");
  assert.equal(plan.cardStatementKey, "inter:card-1127:2026-10");
  assert.equal(plan.cardStatementMonthKey, "2026-10");
  assert.equal(plan.cardStatementId, "inter__card-1127__2026-10");
  assert.equal(plan.cardChargeDate?.toISOString(), "2026-09-08T15:00:00.000Z");
  assert.equal(plan.dueDate.toISOString(), "2026-10-12T15:00:00.000Z");
  assert.equal(plan.cardReconciliationStatus, "pending");
  assert.equal(plan.installmentAssignments.length, 1);
});

test("distribui parcelas do cartão em faturas mensais sem duplicar o valor integral", () => {
  const plan = buildPurchaseExpensePaymentPlan({
    paymentMethod: "card_credit",
    purchaseDate: "2026-09-15",
    paymentDueDate: "2026-10-12",
    paymentCondition: "installments",
    installmentsCount: 2,
  }, creditCard);

  assert.deepEqual(plan.installmentAssignments.map((assignment) => ({
    number: assignment.number,
    month: assignment.cardStatementMonthKey,
    dueDate: assignment.dueDate.toISOString(),
  })), [
    { number: 1, month: "2026-10", dueDate: "2026-10-12T15:00:00.000Z" },
    { number: 2, month: "2026-11", dueDate: "2026-11-12T15:00:00.000Z" },
  ]);
  assert.equal(plan.firstInstallmentDueDate?.toISOString(), "2026-10-12T15:00:00.000Z");
});

test("não atribui ao cartão um frete declarado como pagamento separado", () => {
  const plan = buildPurchaseExpensePaymentPlan({
    paymentMethod: "card_credit",
    purchaseDate: "2026-09-15",
    paymentDueDate: "2026-10-12",
  }, null, { separateFromOrderPayment: true });

  assert.equal(plan.plannedPaymentMethodType, null);
  assert.equal(plan.cardStatementKey, null);
  assert.equal(plan.dueDate.toISOString(), "2026-10-12T15:00:00.000Z");
});

test("mantém débito na data da compra e bloqueia cartão ausente", () => {
  const debit = buildPurchaseExpensePaymentPlan({
    paymentMethod: "card_debit",
    purchaseDate: "2026-09-15",
    paymentDueDate: "2026-10-12",
    paymentCondition: "cash",
  }, { ...creditCard, type: "debit_card", methodId: "debit-card" });
  assert.equal(debit.plannedPaymentMethodType, "debit_card");
  assert.equal(debit.dueDate.toISOString(), "2026-09-15T15:00:00.000Z");
  assert.equal(debit.cardStatementKey, null);

  assert.throws(() => buildPurchaseExpensePaymentPlan({
    paymentMethod: "card_credit",
    purchaseDate: "2026-09-15",
    paymentDueDate: "2026-10-12",
  }, null), /não foi encontrado/);

  assert.throws(() => buildPurchaseExpensePaymentPlan({
    paymentMethod: "card_credit",
    paymentDueDate: "2026-10-12",
  }, creditCard), /Data financeira inválida/);
});

test("bloqueia a ressíncronia de uma compra que já recebeu evidência oficial da fatura", () => {
  assert.equal(purchaseExpenseHasLockedCardStatementEvidence({
    cardStatementImportFingerprint: "import-line-1",
  }), true);
  assert.equal(purchaseExpenseHasLockedCardStatementEvidence({
    installments: [
      { number: 1, cardStatementRevisionStatus: "active" },
      { number: 2, cardStatementRevisionStatus: "removed" },
    ],
  }), true);
  assert.equal(purchaseExpenseHasLockedCardStatementEvidence({
    cardReconciliationStatus: "pending",
    installments: [{ number: 1, cardReconciliationStatus: "pending" }],
  }), false);
  assert.throws(() => assertPurchaseExpenseCanSync({
    installments: [{ number: 1, cardStatementImportFingerprint: "official-line" }],
  }), /não pode ser ressíncronizada/);
  assert.doesNotThrow(() => assertPurchaseExpenseCanSync({
    cardReconciliationStatus: "pending",
  }));
});

test("bloqueia a ressíncronia de compra no débito ou frete que já foi liquidado", () => {
  assert.throws(() => assertPurchaseExpenseCanSync({
    plannedPaymentMethodType: "debit_card",
    status: "paid",
    paidAt: "2026-09-15T12:00:00.000Z",
  }), /já possui liquidação/);
  assert.throws(() => assertPurchaseExpenseCanSync({
    purchaseExpenseRole: "freight",
    installments: [{ number: 1, status: "partially_paid" }],
  }), /já possui liquidação/);
});
