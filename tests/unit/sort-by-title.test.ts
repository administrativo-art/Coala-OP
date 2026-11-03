import assert from "node:assert/strict";
import test from "node:test";
import { sortByTitle } from "../../src/lib/sort-by-title";

test("título começa crescente, respeita português e números e não altera a lista original", () => {
  const items = ["Relatório 10", "Banana", "Água", "Relatório 2"];
  assert.deepEqual(sortByTitle(items, (value) => value), ["Água", "Banana", "Relatório 2", "Relatório 10"]);
  assert.deepEqual(items, ["Relatório 10", "Banana", "Água", "Relatório 2"]);
  assert.deepEqual(sortByTitle(items, (value) => value, "desc"), ["Relatório 10", "Relatório 2", "Banana", "Água"]);
});
test("títulos equivalentes mantêm a ordem dos registros", () => {
  const items = [{ id: 2, title: "Ana" }, { id: 1, title: "ana" }];
  assert.deepEqual(sortByTitle(items, (item) => item.title).map((item) => item.id), [2, 1]);
});
