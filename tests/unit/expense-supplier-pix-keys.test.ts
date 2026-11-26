import assert from "node:assert/strict";
import test from "node:test";
import { inferPixKeyType, normalizeValidatedPixKey, validBrazilianTaxId } from "../../src/features/financial/beneficiaries/normalization";
import { entityPixProfileInputSchema } from "../../src/features/financial/beneficiaries/schemas";

const cpf = "52998224725";
const cnpj = "11222333000181";

test("documento fiscal e cinco tipos de chave Pix", () => {
  assert.equal(validBrazilianTaxId(cpf), true);
  assert.equal(validBrazilianTaxId(cnpj), true);
  assert.equal(validBrazilianTaxId("11111111111"), false);
  assert.equal(normalizeValidatedPixKey("529.982.247-25", "cpf", cpf), cpf);
  assert.equal(normalizeValidatedPixKey("11.222.333/0001-81", "cnpj", cnpj), cnpj);
  assert.equal(normalizeValidatedPixKey("Pessoa@Exemplo.com", "email", cpf), "pessoa@exemplo.com");
  assert.equal(normalizeValidatedPixKey("(11) 99999-8888", "phone", cpf), "+5511999998888");
  assert.equal(normalizeValidatedPixKey("123E4567-E89B-12D3-A456-426614174000", "random", cpf), "123e4567-e89b-12d3-a456-426614174000");
});

test("documento divergente, formato inválido e telefone não se confundem com CPF", () => {
  assert.equal(normalizeValidatedPixKey(cnpj, "cnpj", cpf), null);
  assert.equal(normalizeValidatedPixKey(cpf, "cpf", cnpj), null);
  assert.equal(normalizeValidatedPixKey("11111111111", "cpf", cpf), null);
  assert.equal(normalizeValidatedPixKey("abc@", "email", cpf), null);
  assert.equal(inferPixKeyType(cpf), "cpf");
  assert.equal(normalizeValidatedPixKey(cpf, "phone", cpf), `+55${cpf}`);
  assert.equal(normalizeValidatedPixKey("+5511999998888", "phone", cpf), "+5511999998888");
  assert.equal(normalizeValidatedPixKey("not-a-uuid", "random", cpf), null);
});

test("gravação de chave exige tipo explícito e remoção vazia permanece válida", () => {
  assert.equal(entityPixProfileInputSchema.safeParse({ pixKey: "(11) 99999-8888" }).success, false);
  assert.equal(entityPixProfileInputSchema.safeParse({ pixKey: "(11) 99999-8888", pixKeyType: "phone" }).success, true);
  assert.equal(entityPixProfileInputSchema.safeParse({ pixKey: "" }).success, true);
});
