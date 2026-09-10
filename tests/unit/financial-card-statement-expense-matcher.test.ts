import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCardStatementExpenseCandidates,
  matchCardStatementExpenses,
} from "../../src/features/financial/lib/card-statement-expense-matcher";
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

test("inclui despesa originada em Compras mesmo quando ainda não pertence à fatura", () => {
  const candidates = buildCardStatementExpenseCandidates([{
    id: "purchase-expense",
    description: "Compra Amazon",
    supplier: "Amazon",
    totalValue: 522.8,
    status: "pending",
    competenceDate: { toDate: () => new Date("2026-08-06T12:00:00-03:00") },
    purchaseOrderId: "purchase-order",
  }]);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.expenseId, "purchase-expense");
  assert.equal(candidates[0]?.amount, 522.8);
});

test("oferece somente parcelas ainda não vinculadas a uma fatura", () => {
  const candidates = buildCardStatementExpenseCandidates([{
    id: "installment-expense",
    description: "Frigobar",
    supplier: "Amazon",
    totalValue: 280.46,
    status: "pending",
    originalCardChargeDate: "2026-05-18",
    installments: [
      { number: 1, value: 140.23, status: "pending", cardStatementImportFingerprint: "card-linked" },
      { number: 2, value: 140.23, status: "pending" },
    ],
  }]);

  assert.deepEqual(candidates.map((entry) => entry.lineId), ["installment-expense:installment:2"]);
  assert.equal(candidates[0]?.installmentNumber, 2);
  assert.equal(candidates[0]?.installmentTotal, 2);
});
