import assert from "node:assert/strict";
import test from "node:test";

import {
  baseProductDeactivateBlock,
  baseProductDeleteBlock,
  buildChips,
  bulkDeleteBlockedNames,
  countByKey,
  derivedItemDeleteBlock,
  formatCost,
  initialsOf,
  parseStoredView,
  selectionSummary,
  toggleAllInSet,
  toggleInSet,
  unitSignature,
} from "../../src/components/cadastros/cadastros-utils";

test("formatCost limita as casas decimais sem arredondar demais", () => {
  assert.equal(formatCost(0.0171333333), "R$ 0,0171");
  assert.equal(formatCost(0.89), "R$ 0,890");
  assert.equal(formatCost(79.9), "R$ 79,900");
  assert.equal(formatCost(1234.5678), "R$ 1.234,568");
  assert.equal(formatCost(0), "R$ 0,000");
  assert.equal(formatCost(undefined), "R$ 0,000");
  assert.equal(formatCost(Number.NaN), "R$ 0,000");
});

test("unitSignature e initialsOf", () => {
  assert.equal(unitSignature("Pacote"), "pct");
  assert.equal(unitSignature("peça"), "pç");
  assert.equal(unitSignature("kg"), "kg");
  assert.equal(unitSignature(""), "—");
  assert.equal(initialsOf("Coala Sorvetes Ltda"), "CS");
  assert.equal(initialsOf("  "), "?");
});

test("parseStoredView aceita só grid, o resto é lista", () => {
  assert.equal(parseStoredView("grid"), "grid");
  assert.equal(parseStoredView("list"), "list");
  assert.equal(parseStoredView(null), "list");
  assert.equal(parseStoredView("outra"), "list");
});

test("seleção: alterna um id e marca/desmarca os visíveis sem perder os de fora", () => {
  const base = new Set(["a", "z"]);
  assert.deepEqual([...toggleInSet(base, "b")].sort(), ["a", "b", "z"]);
  assert.deepEqual([...toggleInSet(base, "a")], ["z"]);
  assert.deepEqual([...toggleAllInSet(base, ["a", "b"], true)].sort(), ["a", "b", "z"]);
  assert.deepEqual([...toggleAllInSet(base, ["a", "b"], false)], ["z"]);
  assert.equal(base.size, 2, "não muta o conjunto original");
  assert.equal(selectionSummary(1), "1 selecionado");
  assert.equal(selectionSummary(3), "3 selecionados");
});

test("buildChips esconde filtros vazios, mas mantém o selecionado", () => {
  const entries = [
    { id: "x", label: "X", count: 2 },
    { id: "y", label: "Y", count: 0 },
    { id: "z", label: "Z", count: 0 },
  ];
  assert.deepEqual(buildChips(5, entries, "all").map((chip) => chip.id), ["all", "x"]);
  assert.deepEqual(buildChips(5, entries, "z").map((chip) => chip.id), ["all", "x", "z"]);
  assert.equal(buildChips(5, [], "all", "Todos")[0].label, "Todos");
});

test("countByKey conta por chave", () => {
  const counts = countByKey(["a", "b", "a"], (value) => value);
  assert.equal(counts.get("a"), 2);
  assert.equal(counts.get("b"), 1);
});

test("mensagens de bloqueio", () => {
  assert.equal(baseProductDeactivateBlock("LEITE", false), null);
  assert.match(baseProductDeactivateBlock("LEITE", true) ?? "", /lotes com estoque/);
  assert.equal(baseProductDeleteBlock("LEITE", 0), null);
  assert.match(baseProductDeleteBlock("LEITE", 3) ?? "", /3 insumo\(s\) derivado\(s\)/);
  assert.equal(derivedItemDeleteBlock(0, []), null);
  assert.match(derivedItemDeleteBlock(2, ["Lista A"]) ?? "", /2 lote\(s\) e está nas listas predefinidas: “Lista A”/);
  assert.match(derivedItemDeleteBlock(0, ["A", "B"]) ?? "", /“A”, “B”/);
  assert.equal(bulkDeleteBlockedNames([]), null);
  assert.match(bulkDeleteBlockedNames(["A", "B"]) ?? "", /A, B/);
});
