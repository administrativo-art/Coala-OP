import assert from "node:assert/strict";
import test from "node:test";

import type { CardStatementImportLine, CardStatementPreviousImportLine } from "../../src/features/financial/lib/card-statement-import";
import { diffCardStatementRevision } from "../../src/features/financial/lib/card-statement-revisions";

function current(overrides: Partial<CardStatementImportLine> = {}): CardStatementImportLine {
  return {
    id: "line-1",
    sourceReference: "csv-line-8",
    date: "2026-08-20",
    description: "POSTO AVENIDA",
    supplier: "Posto Avenida",
    amount: 150,
    installmentNumber: null,
    installmentTotal: null,
    confidence: "high",
    reviewNotes: [],
    fingerprint: "card-current",
    ...overrides,
  };
}

function previous(overrides: Partial<CardStatementPreviousImportLine> = {}): CardStatementPreviousImportLine {
  return {
    fingerprint: "card-previous",
    sourceReference: "csv-line-8",
    date: "2026-08-20",
    description: "POSTO AVENIDA",
    supplier: "Posto Avenida",
    amount: 150,
    installmentNumber: null,
    installmentTotal: null,
    expenseId: "expense-1",
    lineId: "expense-1",
    ...overrides,
  };
}

test("reimportação idêntica preserva a linha e o vínculo anterior", () => {
  const line = current({ fingerprint: "same" });
  const diff = diffCardStatementRevision([line], [previous({ fingerprint: "same" })]);

  assert.deepEqual(diff.summary, { unchanged: 1, changed: 0, added: 0, removed: 0 });
  assert.equal(diff.hasChanges, false);
  assert.equal(diff.lines[0]?.previousExpenseId, "expense-1");
});

test("valor retificado mantém a identidade e aponta reaproveitamento do tratamento", () => {
  const diff = diffCardStatementRevision([current({ amount: 165 })], [previous()]);

  assert.deepEqual(diff.summary, { unchanged: 0, changed: 1, added: 0, removed: 0 });
  assert.equal(diff.lines[0]?.previousExpenseId, "expense-1");
  assert.deepEqual(diff.lines[0]?.changes, ["amount"]);
});

test("distingue lançamentos novos e removidos sem apagar o histórico", () => {
  const diff = diffCardStatementRevision([
    current({ sourceReference: "csv-line-9", description: "FORNECEDOR NOVO", supplier: "Fornecedor Novo", amount: 80 }),
  ], [previous()]);

  assert.deepEqual(diff.summary, { unchanged: 0, changed: 0, added: 1, removed: 1 });
  assert.equal(diff.removed[0]?.expenseId, "expense-1");
});

test("não correlaciona automaticamente revisões ambíguas", () => {
  const diff = diffCardStatementRevision([
    current({ sourceReference: "pdf-item", description: "SERVICO", supplier: "Servico", amount: 100 }),
  ], [
    previous({ fingerprint: "old-1", sourceReference: "old-a", description: "SERVICO", supplier: "Servico", amount: 100, expenseId: "a", lineId: "a" }),
    previous({ fingerprint: "old-2", sourceReference: "old-b", description: "SERVICO", supplier: "Servico", amount: 100, expenseId: "b", lineId: "b" }),
  ]);

  assert.equal(diff.lines[0]?.status, "new");
  assert.equal(diff.summary.removed, 2);
});

test("preserva dois tratamentos quando a nova fatura repete duas cobranças idênticas", () => {
  const diff = diffCardStatementRevision([
    current({ fingerprint: "new-1", sourceReference: "pdf-item" }),
    current({ fingerprint: "new-2", sourceReference: "pdf-item · ocorrência 2" }),
  ], [
    previous({ fingerprint: "old-1", sourceReference: "old-a", expenseId: "tirirical", lineId: "tirirical" }),
    previous({ fingerprint: "old-2", sourceReference: "old-b", expenseId: "joao-paulo", lineId: "joao-paulo" }),
  ]);

  assert.deepEqual(diff.summary, { unchanged: 0, changed: 2, added: 0, removed: 0 });
  assert.deepEqual(diff.lines.map((line) => line.previousExpenseId), ["tirirical", "joao-paulo"]);
});
