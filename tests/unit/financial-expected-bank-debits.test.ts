import assert from "node:assert/strict";
import test from "node:test";

import {
  findExpectedBankDebitGroupMatches,
  findExpectedBankDebitMatch,
  type ExpectedBankDebitCandidate,
} from "../../src/features/financial/payment-requests/expected-bank-debits";

const candidate = (id: string, overrides: Partial<ExpectedBankDebitCandidate> = {}): ExpectedBankDebitCandidate => ({
  id,
  paymentRequestId: `request-${id}`,
  financialInboxMessageId: `inbox-${id}`,
  expenseId: `expense-${id}`,
  amount: 1200,
  principalAmount: 1200,
  expectedDate: new Date("2026-08-25T12:00:00-03:00"),
  references: [`bank-${id}`],
  ...overrides,
});

test("prioriza a referência bancária do débito esperado", () => {
  const match = findExpectedBankDebitMatch({
    amount: -1200,
    date: "2026-08-25",
    references: ["bank-a"],
  }, [candidate("a"), candidate("b")], new Set());
  assert.equal(match?.id, "a");
});

test("aceita valor e janela de cinco dias somente quando o candidato é único", () => {
  const entry = { amount: -1200, date: "2026-08-27", references: [] };
  assert.equal(findExpectedBankDebitMatch(entry, [candidate("a")], new Set())?.id, "a");
  assert.equal(findExpectedBankDebitMatch(entry, [candidate("a"), candidate("b")], new Set()), null);
});

test("não reutiliza um débito já reivindicado nem associa créditos", () => {
  assert.equal(findExpectedBankDebitMatch({ amount: -1200, date: "2026-08-25", references: ["bank-a"] }, [candidate("a")], new Set(["a"])), null);
  assert.equal(findExpectedBankDebitMatch({ amount: 1200, date: "2026-08-25", references: ["bank-a"] }, [candidate("a")], new Set()), null);
});

test("concilia como conjunto débitos indistinguíveis do mesmo favorecido", () => {
  const candidates = [candidate("tirirical", { amount: 548.27, counterpartyName: "Maximus Contabilidade Ltda" }),
    candidate("matriz", { amount: 548.27, counterpartyName: "Maximus Contabilidade Ltda" })];
  const entries = [
    { externalId: "inter-b", amount: -548.27, date: "2026-08-25", description: "Pagamento de Título — MAXIMUS CONTABILIDADE LTDA", references: [] },
    { externalId: "inter-a", amount: -548.27, date: "2026-08-25", description: "Pagamento de Título — MAXIMUS CONTABILIDADE LTDA", references: [] },
  ];
  const matches = findExpectedBankDebitGroupMatches(entries, candidates, new Set());
  assert.equal(matches.size, 2);
  assert.deepEqual([...matches.keys()].sort(), ["inter-a", "inter-b"]);
  assert.deepEqual([...matches.values()].map((match) => match.id).sort(), ["matriz", "tirirical"]);
});

test("não concilia conjunto com quantidade, favorecido ou candidato concorrente divergente", () => {
  const maximus = [candidate("a", { amount: 548.27, counterpartyName: "Maximus Contabilidade Ltda" }),
    candidate("b", { amount: 548.27, counterpartyName: "Maximus Contabilidade Ltda" })];
  const oneEntry = [{ externalId: "inter-a", amount: -548.27, date: "2026-08-25", description: "MAXIMUS CONTABILIDADE", references: [] }];
  assert.equal(findExpectedBankDebitGroupMatches(oneEntry, maximus, new Set()).size, 0);
  assert.equal(findExpectedBankDebitGroupMatches([
    ...oneEntry,
    { ...oneEntry[0], externalId: "inter-b", description: "OUTRO FORNECEDOR" },
  ], maximus, new Set()).size, 0);
  assert.equal(findExpectedBankDebitGroupMatches([
    ...oneEntry,
    { ...oneEntry[0], externalId: "inter-b" },
  ], [...maximus, candidate("c", { amount: 548.27, counterpartyName: "Outro Fornecedor" })], new Set()).size, 0);
});
