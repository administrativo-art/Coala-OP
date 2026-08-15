import assert from "node:assert/strict";
import test from "node:test";

import { findUniqueExactExpenseMatch } from "../../src/features/financial/lib/inter-statement-reconciliation";
import {
  interStatementSessionDocumentId,
  interStatementTransactionDocumentId,
  normalizeInterStatementEntries,
} from "../../src/lib/integrations/inter/statements.server";

test("normaliza débitos e créditos do extrato do Inter", () => {
  const [debit, credit] = normalizeInterStatementEntries([
    {
      idTransacao: "tx-debit",
      dataEntrada: "2026-08-15",
      tipoOperacao: "D",
      valor: "1.200,00",
      titulo: "Pix enviado",
      descricao: "Fornecedor Exemplo",
    },
    {
      idTransacao: "tx-credit",
      dataEntrada: "2026-08-15",
      tipoOperacao: "C",
      valor: "250.50",
      descricao: "Pix recebido",
    },
  ]);

  assert.equal(debit.amount, -1200);
  assert.equal(debit.description, "Pix enviado — Fornecedor Exemplo");
  assert.equal(credit.amount, 250.5);
});

test("gera chaves idempotentes e distingue ocorrências bancárias idênticas sem identificador", () => {
  const raw = {
    dataEntrada: "2026-08-15",
    tipoOperacao: "D",
    valor: "54.55",
    descricao: "Tarifa",
  };
  const firstRun = normalizeInterStatementEntries([raw, raw]);
  const secondRun = normalizeInterStatementEntries([raw, raw]);

  assert.notEqual(firstRun[0].externalId, firstRun[1].externalId);
  assert.deepEqual(firstRun.map((entry) => entry.externalId), secondRun.map((entry) => entry.externalId));
  assert.equal(
    interStatementTransactionDocumentId("conta-inter", firstRun[0].externalId),
    interStatementTransactionDocumentId("conta-inter", secondRun[0].externalId)
  );
  assert.equal(
    interStatementSessionDocumentId("conta-inter", "2026-08"),
    interStatementSessionDocumentId("conta-inter", "2026-08")
  );
});

test("baixa automaticamente apenas quando existe um único candidato exato", () => {
  const candidate = {
    expenseId: "expense-1",
    expenseDescription: "Aluguel",
    dueDate: new Date("2026-08-15T12:00:00-03:00"),
    value: 1200,
  };

  assert.equal(
    findUniqueExactExpenseMatch({ date: "2026-08-15", amount: -1200 }, [candidate])?.expenseId,
    "expense-1"
  );
  assert.equal(findUniqueExactExpenseMatch({ date: "2026-08-15", amount: 1200 }, [candidate]), null);
  assert.equal(
    findUniqueExactExpenseMatch(
      { date: "2026-08-15", amount: -1200 },
      [candidate, { ...candidate, expenseId: "expense-2" }]
    ),
    null
  );
  assert.equal(
    findUniqueExactExpenseMatch(
      { date: "2026-08-15", amount: -1200 },
      [candidate],
      new Set(["expense-1:0"])
    ),
    null
  );
});
