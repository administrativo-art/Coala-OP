import assert from "node:assert/strict";
import test from "node:test";

import { optionalIdList, optionalStockRole } from "../../src/app/api/dp/_unit-structure";

test("função no estoque: comercial é o padrão e não é gravada", () => {
  assert.equal(optionalStockRole(undefined), undefined);
  assert.equal(optionalStockRole(null), undefined);
  assert.equal(optionalStockRole(""), undefined);
  assert.equal(optionalStockRole("commercial"), undefined);
});

test("função no estoque: aceita mista e abastecimento", () => {
  assert.equal(optionalStockRole("mixed"), "mixed");
  assert.equal(optionalStockRole("supply"), "supply");
});

test("função no estoque: rejeita valor desconhecido", () => {
  assert.throws(() => optionalStockRole("abastece"), /Função da unidade no estoque inválida/);
});

test("grupos atendidos: remove duplicados e vazios; lista vazia vira ausente", () => {
  assert.deepEqual(optionalIdList(["a", " b ", "a", ""], "Grupos atendidos"), ["a", "b"]);
  assert.equal(optionalIdList([], "Grupos atendidos"), undefined);
  assert.equal(optionalIdList(undefined, "Grupos atendidos"), undefined);
});

test("grupos atendidos: rejeita itens que não são texto", () => {
  assert.throws(() => optionalIdList(["a", 3], "Grupos atendidos"), /inválido/);
  assert.throws(() => optionalIdList("a", "Grupos atendidos"), /inválido/);
});
