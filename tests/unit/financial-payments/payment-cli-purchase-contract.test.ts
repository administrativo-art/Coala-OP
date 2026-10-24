import assert from "node:assert/strict";
import test from "node:test";

import {
  assertPurchaseSnapshot,
  purchaseCreatePayload,
  purchaseFiscalPatch,
  purchaseFiscalSchema,
  purchaseRegistrationSchema,
  supplierEntitySchema,
} from "../../../scripts/financial/payment-cli-purchase-contract";

const registration = {
  supplierId: "supplier_1",
  supplierName: "Fornecedor Teste",
  destinationKioskId: "kiosk_1",
  receiptMode: "future_delivery",
  paymentMethod: "boleto",
  paymentCondition: "installments",
  paymentDueDate: "2026-11-20",
  installmentsCount: 3,
  installmentDueDates: ["2026-11-20", "2026-11-27", "2026-12-04"],
  estimatedReceiptDate: "2026-10-23",
  accountPlanId: "account_1",
  accountPlanName: "Insumos",
  resultCenterId: "center_1",
  resultCenterName: "Administrativo",
  deliveryFee: 0,
  notes: "NF 22930",
  expectedTotalCents: 334356,
  items: [
    { baseItemId: "base_1", productId: "product_1", itemName: "Item 1", operationalCategoryId: "category_1", unit: "UN", quantityOrdered: 3000, unitPriceOrdered: 0.49044, itemTreatment: "stock" },
    { baseItemId: "base_2", productId: "product_2", itemName: "Item 2", operationalCategoryId: "category_1", unit: "UN", quantityOrdered: 2000, unitPriceOrdered: 0.53329, itemTreatment: "stock" },
    { baseItemId: "base_3", productId: "product_3", itemName: "Item 3", operationalCategoryId: "category_1", unit: "UN", quantityOrdered: 2000, unitPriceOrdered: 0.40283, itemTreatment: "stock" },
  ],
} as const;

test("manifesto de compra fixa total, boleto, parcelas e recebimento futuro", () => {
  const parsed = purchaseRegistrationSchema.parse(registration);
  assert.equal(purchaseCreatePayload(parsed).origin, "direct");
  assert.doesNotThrow(() => assertPurchaseSnapshot({
    supplierId: parsed.supplierId,
    paymentMethod: "boleto",
    paymentCondition: "installments",
    installmentsCount: 3,
    installmentDueDates: parsed.installmentDueDates,
    totalEstimated: 3343.56,
  }, parsed));
  assert.equal(purchaseRegistrationSchema.safeParse({ ...registration, expectedTotalCents: 334355 }).success, false);
  assert.equal(purchaseRegistrationSchema.safeParse({ ...registration, installmentDueDates: registration.installmentDueDates.slice(0, 2) }).success, false);
  assert.equal(purchaseRegistrationSchema.safeParse({ ...registration, paymentMethod: "pix" }).success, false);
});

test("manifesto fiscal normaliza e limita a chave da NF-e", () => {
  const fiscal = purchaseFiscalSchema.parse({
    invoiceNumber: "22930",
    invoiceSeries: "1",
    invoiceAccessKey: "52 2610 02911413000153 55 001 000022930 1 00020290 3",
    issuedAt: "2026-10-23",
    authorizationProtocol: "152261061441737",
    supplierDocument: "02.911.413/0001-53",
    recipientDocument: "14.276.603/0003-97",
    totalCents: 334356,
  });
  assert.equal(fiscal.invoiceAccessKey, "52261002911413000153550010000229301000202903");
  assert.equal(purchaseFiscalPatch(fiscal).fiscal.totalCents, 334356);
  assert.equal(purchaseFiscalSchema.safeParse({ ...fiscal, invoiceAccessKey: "1".repeat(43) }).success, false);
});

test("manifesto do fornecedor normaliza CNPJ e CEP sem aceitar campos extras", () => {
  const supplier = supplierEntitySchema.parse({
    type: "pessoa_juridica",
    name: "GRÁFICA DA FAMÍLIA LTDA",
    fantasyName: "NATUCOPOS",
    document: "02.911.413/0001-53",
    address: {
      street: "Rua Aleixo Inocente Teles",
      number: "00",
      complement: "Q25 L06",
      neighborhood: "Botafogo I",
      city: "Nerópolis",
      state: "GO",
      zipCode: "75465-086",
    },
    notes: "NF-e 22930",
  });
  assert.equal(supplier.document, "02911413000153");
  assert.equal(supplier.address.zipCode, "75465086");
  assert.equal(supplierEntitySchema.safeParse({ ...supplier, token: "segredo" }).success, false);
});
