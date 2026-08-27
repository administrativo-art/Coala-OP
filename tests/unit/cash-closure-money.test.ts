import assert from "node:assert/strict";
import test from "node:test";

import { centsToReais, formatBRL, sumCents, toCents } from "../../src/features/financial/cash-closures/money";

test("toCents converte reais para centavos inteiros sem drift", () => {
  assert.equal(toCents(368), 36800);
  assert.equal(toCents(3.1), 310);
  assert.equal(toCents(0.1 + 0.2), 30);
});

test("sumCents soma centavos inteiros com segurança", () => {
  assert.equal(sumCents(40000, -3300), 36700);
  assert.equal(sumCents(), 0);
});

test("centsToReais e formatBRL fazem o caminho inverso", () => {
  assert.equal(centsToReais(36800), 368);
  assert.equal(formatBRL(36800), "R$ 368,00");
});
