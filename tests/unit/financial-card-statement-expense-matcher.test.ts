import assert from "node:assert/strict";
import test from "node:test";

import { matchCardStatementExpenses } from "../../src/features/financial/lib/card-statement-expense-matcher";
import type { CardStatementImportLine } from "../../src/features/financial/lib/card-statement-import";

function importedLine(overrides: Partial<CardStatementImportLine> = {}): CardStatementImportLine {
  return {
    id: "line-1",
    sourceReference: "row-1",
    date: "2026-08-10",
    description: "Amazon Brasil",
    supplier: "Amazon",
    amount: 140.23,
    installmentNumber: null,
    installmentTotal: null,
    confidence: "high",
    reviewNotes: [],
    fingerprint: "card-test",
    ...overrides,
  };
}

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    lineId: "expense-1",
    expenseId: "expense-1",
    description: "Compra Amazon",
    supplier: "Amazon",
    amount: 140.23,
    chargeDate: new Date("2026-08-10T12:00:00-03:00"),
    isForecast: false,
    ...overrides,
  };
}

test("sugere vínculo forte quando valor, data e estabelecimento correspondem", () => {
  const [match] = matchCardStatementExpenses([importedLine()], [candidate()]);
  assert.equal(match.confidence, "high");
  assert.equal(match.recommendedCandidateId, "expense-1");
  assert.equal(match.ambiguous, false);
});

test("não recomenda automaticamente quando duas despesas são equivalentes", () => {
  const [match] = matchCardStatementExpenses(
    [importedLine()],
    [candidate(), candidate({ lineId: "expense-2", expenseId: "expense-2" })],
  );
  assert.equal(match.ambiguous, true);
  assert.equal(match.recommendedCandidateId, null);
  assert.equal(match.candidates.length, 2);
});

test("identifica previsão como candidata para substituição", () => {
  const [match] = matchCardStatementExpenses([importedLine()], [candidate({ isForecast: true })]);
  assert.equal(match.confidence, "high");
  assert.equal(match.candidates[0]?.isForecast, true);
});

test("não sugere despesa com diferença de valor superior a cinco por cento", () => {
  const [match] = matchCardStatementExpenses([importedLine({ amount: 200 })], [candidate()]);
  assert.equal(match.confidence, null);
  assert.equal(match.candidates.length, 0);
});
