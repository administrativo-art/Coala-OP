import assert from "node:assert/strict";
import { test } from "node:test";
import { expenseBillingIdentity, expenseHasProtectedSupplierSource, expenseSupplierFields, expenseSupplierIdentity } from "../../src/features/financial/lib/expense-supplier-identity";
import { purchasePixNeedsSync, supplierPixPrepareInput } from "../../src/features/financial/lib/expense-supplier-pix-ui";

const entities = [
  { id: "entity-one", name: "Pessoa Exemplo", type: "pessoa_fisica" as const, document: "529.982.247-25" },
  { id: "entity-two", name: "Pessoa Exemplo", type: "pessoa_fisica" as const, document: "111.111.111-11" },
];

test("supplier identity uses explicit ID even after a name changes; clearing selection drops identity", () => {
  assert.deepEqual(expenseSupplierIdentity(entities, "entity-one"), { supplierId: "entity-one", supplierTaxId: "52998224725" });
  const renamed = entities.map((entity) => ({ ...entity, name: "Nome atualizado" }));
  assert.deepEqual(expenseSupplierIdentity(renamed, "entity-one"), { supplierId: "entity-one", supplierTaxId: "52998224725" });
  assert.deepEqual(expenseSupplierIdentity(entities, null), { supplierId: null, supplierTaxId: null });
  assert.deepEqual(expenseSupplierIdentity(entities, "entity-two"), { supplierId: null, supplierTaxId: null });
});

test("protected billing keeps canonical tax ID; free text on manual expense clears it", () => {
  const original = { supplierTaxId: "52998224725", customerAccount: "synthetic-account" };
  assert.deepEqual(expenseBillingIdentity(original, null, null, true), original);
  assert.deepEqual(expenseBillingIdentity(original, null, null, false), { supplierTaxId: null, customerAccount: "synthetic-account" });
  assert.deepEqual(expenseBillingIdentity(null, original, null, true), original);
});

test("protected sources preserve their original ID and absent or divergent tax document", () => {
  const selected = expenseSupplierIdentity(entities, "entity-one");
  assert.deepEqual(expenseSupplierFields(selected, "original-id", { supplierTaxId: "11144477735" }, null, true), {
    supplierId: "original-id", billingIdentity: { supplierTaxId: "11144477735" },
  });
  assert.deepEqual(expenseSupplierFields(selected, null, null, null, true), {
    supplierId: null, billingIdentity: { supplierTaxId: null },
  });
  assert.deepEqual(expenseSupplierFields(selected, null, null, { customerAccount: "demo" }, true), {
    supplierId: null, billingIdentity: { customerAccount: "demo", supplierTaxId: null },
  });
  assert.deepEqual(expenseSupplierFields({ supplierId: null, supplierTaxId: null }, "old-id",
    { supplierTaxId: "52998224725" }, null, false), {
    supplierId: null, billingIdentity: { supplierTaxId: null },
  });
  assert.equal(expenseHasProtectedSupplierSource({ originModule: "financial_inbox" }), true);
  assert.equal(expenseHasProtectedSupplierSource({ generatedReceiptId: "receipt" }), true);
  assert.equal(expenseHasProtectedSupplierSource({ originModule: "manual" }), false);
});

test("Pix preparation uses saved entity and cents, and rejects drafts, partial/manual or unclassified expenses", () => {
  const expense = {
    id: "expense-one", status: "pending", paymentMethod: "single", supplierId: "entity-one", unitId: "kiosk-one",
    billingIdentity: { supplierTaxId: "52998224725" }, accountPlan: "account-one", referenceResultCenterId: "center-one",
    competenceDate: "2026-11-01", dueDate: "2026-11-24", totalValue: 500,
    installments: [{ status: "pending", value: 500 }],
  };
  assert.deepEqual(supplierPixPrepareInput(expense), { supplierEntityId: "entity-one", amountCents: 50000 });
  assert.deepEqual(supplierPixPrepareInput({ ...expense, netPayableValue: 500 }), { supplierEntityId: "entity-one", amountCents: 50000 });
  assert.deepEqual(supplierPixPrepareInput({ ...expense, netPayableValue: null }), { supplierEntityId: "entity-one", amountCents: 50000 });
  assert.equal(supplierPixPrepareInput({ ...expense, netPayableValue: 450 }), null);
  assert.equal(supplierPixPrepareInput({ ...expense, paymentRequestId: "active-request" }), null);
  assert.equal(supplierPixPrepareInput({ ...expense, paymentRequestId: "" }), null);
  assert.equal(supplierPixPrepareInput({ ...expense, status: "draft" }), null);
  assert.equal(supplierPixPrepareInput({ ...expense, supplierId: null }), null);
  assert.equal(supplierPixPrepareInput({ ...expense, unitId: null }), null);
  assert.equal(supplierPixPrepareInput({ ...expense, financialInboxMessageId: "inbox-one" }), null);
  assert.equal(supplierPixPrepareInput({ ...expense, generatedReceiptId: "receipt-one" }), null);
  assert.equal(supplierPixPrepareInput({ ...expense, installments: [{ status: "pending", value: 400 }] }), null);
});

test("purchase goods permit a single payment without installments and guide canonical sync", () => {
  const purchase = {
    id: "purchase-goods", originModule: "purchasing", purchaseOrderId: "order-one", purchaseExpenseRole: "goods",
    status: "pending", paymentMethod: "single", supplierId: "supplier-one", unitId: "unit-one",
    billingIdentity: { supplierTaxId: "52998224725" }, accountPlan: "account-one", resultCenterId: "center-one",
    competenceDate: "2026-11-01", dueDate: "2026-11-24", totalValue: 59.5,
  };
  assert.deepEqual(supplierPixPrepareInput(purchase), { supplierEntityId: "supplier-one", amountCents: 5950 });
  assert.equal(purchasePixNeedsSync(purchase), false);
  assert.equal(purchasePixNeedsSync({ ...purchase, billingIdentity: {} }), true);
  assert.equal(purchasePixNeedsSync({ ...purchase, netPayableValue: 50 }), false);
  assert.equal(supplierPixPrepareInput({ ...purchase, purchaseExpenseRole: "freight" }), null);
});
