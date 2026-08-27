import assert from "node:assert/strict";
import test from "node:test";
import {
  entityPixProfileInputSchema,
  paymentBeneficiaryReferenceSchema,
  supplierPaymentProfileInputSchema,
} from "../../../src/features/financial/beneficiaries/schemas";

test("referência de favorecido exige origem explícita", () => {
  assert.deepEqual(
    paymentBeneficiaryReferenceSchema.parse({ sourceType: "employee", sourceId: "employee-1" }),
    { sourceType: "employee", sourceId: "employee-1" },
  );
  assert.equal(paymentBeneficiaryReferenceSchema.safeParse({ sourceId: "employee-1" }).success, false);
});
test("perfil Pix exige destino ou preservação explícita do destino existente", () => {
  const base = {
    active: true,
    paymentMethod: "pix_key" as const,
    pixKeyType: "cnpj" as const,
    holderName: "CT Sorvetes LTDA",
    holderDocument: "14.276.603/0001-25",
    validated: true,
  };
  assert.equal(supplierPaymentProfileInputSchema.safeParse(base).success, false);
  assert.equal(supplierPaymentProfileInputSchema.safeParse({ ...base, keepExistingDestination: true }).success, true);
  assert.equal(supplierPaymentProfileInputSchema.safeParse({ ...base, pixKey: "14.276.603/0001-25" }).success, true);
});

test("cadastro de pessoa ou empresa exige somente a chave Pix", () => {
  assert.equal(entityPixProfileInputSchema.safeParse({ pixKey: "financeiro@empresa.com" }).success, true);
  assert.equal(entityPixProfileInputSchema.safeParse({ pixKey: "" }).success, true);
  assert.equal(entityPixProfileInputSchema.safeParse({ pixKey: "x".repeat(181) }).success, false);
});
