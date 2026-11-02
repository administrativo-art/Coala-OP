import { test } from "node:test";
import assert from "node:assert/strict";
import { companyIntakeName, companyIntakeSchema } from "../../src/lib/documents/company-document-intake";

test("nome usa ID estável e referência normalizada sem data do upload", () => {
  assert.equal(companyIntakeName({ documentType: "ALVARA", unitId: "id-estavel", reference: "Venc 2027-02-01", version: 2, extension: "pdf" }), "ALVARA__UNIDADE-id-estavel__VENC-2027-02-01__v02.pdf");
  assert.equal(companyIntakeName({ documentType: "CARTAO-CNPJ", version: 1, extension: "pdf" }), "CARTAO-CNPJ__GERAL__v01.pdf");
});
test("tipo sem referência obrigatória ou ID inválido exige correção; desconhecido pode aguardar classificação", () => {
  const base = { title: "Documento", category: "Fiscal e contábil" };
  assert.equal(companyIntakeSchema.safeParse({ ...base, documentType: "ALVARA", reference: "???" }).success, false);
  assert.equal(companyIntakeSchema.safeParse({ ...base, unitId: "outra/pasta" }).success, false);
  assert.equal(companyIntakeSchema.safeParse({ ...base, documentType: "TIPO-INVENTADO" }).success, false);
  assert.equal(companyIntakeSchema.safeParse(base).success, true);
});
