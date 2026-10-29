import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReviewRows, filterReviewRows, nextReviewSort, sortReviewRows, type ReviewRow,
} from "../../src/features/dp/time-adjustments/review-list";
import type { AdjustmentView, MarkingClassificationRequestView } from "../../src/features/dp/time-adjustments/types";

const adjustment = (id: string, name: string | null, workDate: string, kind: AdjustmentView["kind"] = "correct", scope?: "pilot") =>
  ({ id, employeeUid: `uid-${id}`, employeeName: name, workDate, kind, scope } as AdjustmentView);
const classification = (id: string, name: string, workDate: string) =>
  ({ id, employeeId: `emp-${id}`, employeeName: name, workDate } as MarkingClassificationRequestView);

const rows = () => buildReviewRows(
  [adjustment("a1", "Luis Abelardo", "2026-10-26", "correct", "pilot"), adjustment("a2", "Édna Maria", "2026-10-25", "include")],
  [classification("c1", "Samila", "2026-10-24")],
);

test("monta as linhas com o texto do pedido e a simulação sinalizada", () => {
  const built = rows();
  assert.deepEqual(built.map((row) => row.requestLabel), ["O horário está errado", "Esqueci de bater", "Classificação da batida"]);
  assert.deepEqual(built.map((row) => row.pilot), [true, false, false]);
  assert.equal(built[2].personId, "emp-c1");
  assert.equal(buildReviewRows([adjustment("x", null, "2026-10-26")], [])[0].employeeName, "Titular");
});

test("a busca ignora acento e caixa e procura no nome e no pedido", () => {
  assert.deepEqual(filterReviewRows(rows(), { search: "edna", kind: "all" }).map((row) => row.employeeName), ["Édna Maria"]);
  assert.deepEqual(filterReviewRows(rows(), { search: "SIMULAÇÃO", kind: "all" }).map((row) => row.employeeName), ["Luis Abelardo"]);
  assert.equal(filterReviewRows(rows(), { search: "zzz", kind: "all" }).length, 0);
});

test("o filtro de tipo separa ajustes de classificações", () => {
  assert.equal(filterReviewRows(rows(), { search: "", kind: "adjustment" }).length, 2);
  assert.deepEqual(filterReviewRows(rows(), { search: "", kind: "classification" }).map((row) => row.employeeName), ["Samila"]);
});

test("ordena por colaborador, pedido e dia nos dois sentidos sem alterar a entrada", () => {
  const input: ReviewRow[] = rows();
  const names = (sort: Parameters<typeof sortReviewRows>[1]) => sortReviewRows(input, sort).map((row) => row.employeeName);
  assert.deepEqual(names({ key: "employee", direction: "asc" }), ["Édna Maria", "Luis Abelardo", "Samila"]);
  assert.deepEqual(names({ key: "employee", direction: "desc" }), ["Samila", "Luis Abelardo", "Édna Maria"]);
  assert.deepEqual(names({ key: "day", direction: "desc" }), ["Luis Abelardo", "Édna Maria", "Samila"]);
  assert.deepEqual(names({ key: "day", direction: "asc" }), ["Samila", "Édna Maria", "Luis Abelardo"]);
  assert.deepEqual(names({ key: "request", direction: "asc" }), ["Samila", "Édna Maria", "Luis Abelardo"]);
  assert.deepEqual(input.map((row) => row.employeeName), ["Luis Abelardo", "Édna Maria", "Samila"]);
});

test("empate no critério mantém a ordem estável pelo nome", () => {
  const tied = buildReviewRows([adjustment("b", "Zeca", "2026-10-26"), adjustment("a", "Ana", "2026-10-26")], []);
  assert.deepEqual(sortReviewRows(tied, { key: "day", direction: "desc" }).map((row) => row.employeeName), ["Ana", "Zeca"]);
});

test("clicar no título ordena e clicar de novo inverte", () => {
  const start = { key: "day", direction: "desc" } as const;
  assert.deepEqual(nextReviewSort(start, "day"), { key: "day", direction: "asc" });
  assert.deepEqual(nextReviewSort(start, "employee"), { key: "employee", direction: "asc" });
  assert.deepEqual(nextReviewSort({ key: "employee", direction: "asc" }, "employee"), { key: "employee", direction: "desc" });
  assert.deepEqual(nextReviewSort({ key: "employee", direction: "desc" }, "day"), { key: "day", direction: "desc" });
});
