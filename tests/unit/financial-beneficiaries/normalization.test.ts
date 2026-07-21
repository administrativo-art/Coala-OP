import assert from "node:assert/strict";
import test from "node:test";
import {
  inferPixKeyType,
  maskBrazilianDocument,
  maskPaymentDestination,
  normalizeBrazilianDocument,
} from "../../../src/features/financial/beneficiaries/normalization";

test("normaliza e mascara CPF/CNPJ sem revelar o documento", () => {
  assert.equal(normalizeBrazilianDocument("14.276.603/0001-25"), "14276603000125");
  assert.equal(maskBrazilianDocument("14.276.603/0001-25"), "**.***.***/****-25");
  assert.equal(maskBrazilianDocument("123.456.789-01"), "***.***.***-01");
});
test("classifica os formatos usuais de chave Pix", () => {
  assert.equal(inferPixKeyType("123.456.789-01"), "cpf");
  assert.equal(inferPixKeyType("14.276.603/0001-25"), "cnpj");
  assert.equal(inferPixKeyType("financeiro@example.com"), "email");
  assert.equal(inferPixKeyType("+5598999999999"), "phone");
  assert.equal(inferPixKeyType("5b32dd72-3ce0-4d2d-a0e2-faf440c081e2"), "random");
});

test("mascara destino sem devolver o valor integral", () => {
  const email = "financeiro@example.com";
  const masked = maskPaymentDestination(email);
  assert.equal(masked, "fi***@example.com");
  assert.equal(masked.includes(email), false);
  assert.equal(maskPaymentDestination("12345678901"), "*******8901");
});
