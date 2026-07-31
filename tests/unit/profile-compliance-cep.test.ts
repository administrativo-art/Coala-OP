import assert from "node:assert/strict";
import test from "node:test";

import {
  cepDigits,
  formatBrazilianCep,
  lookupProfileAddressByCep,
} from "../../src/features/hr/profile-compliance-cep";

test("formata CEP brasileiro e limita a oito números", () => {
  assert.equal(cepDigits("65075-44099"), "65075440");
  assert.equal(formatBrazilianCep("65075440"), "65075-440");
  assert.equal(formatBrazilianCep("6507"), "6507");
});

test("normaliza o endereço retornado pelo ViaCEP", async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    cep: "65075-440",
    logradouro: "  Avenida dos Holandeses ",
    bairro: "Calhau",
    localidade: "São Luís",
    uf: "ma",
  }), { status: 200 }));

  const result = await lookupProfileAddressByCep("65075-440");
  assert.deepEqual(result, {
    zipcode: "65075-440",
    street: "Avenida dos Holandeses",
    neighborhood: "Calhau",
    city: "São Luís",
    state: "MA",
  });
});

test("rejeita CEP inexistente sem impedir o preenchimento manual na interface", async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ erro: true }), { status: 200 }));
  await assert.rejects(() => lookupProfileAddressByCep("00000-000"), /CEP não encontrado/u);
});

test("rejeita consulta com CEP incompleto antes de chamar o serviço", async (context) => {
  const fetchMock = context.mock.method(globalThis, "fetch", async () => new Response("{}", { status: 200 }));
  await assert.rejects(() => lookupProfileAddressByCep("65075"), /8 números/u);
  assert.equal(fetchMock.mock.callCount(), 0);
});
