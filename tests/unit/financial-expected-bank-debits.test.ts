import assert from "node:assert/strict";
import test from "node:test";

import { findExpectedBankDebitMatch, type ExpectedBankDebitCandidate } from "../../src/features/financial/payment-requests/expected-bank-debits";

const candidate = (id: string, overrides: Partial<ExpectedBankDebitCandidate> = {}): ExpectedBankDebitCandidate => ({
  id,
  paymentRequestId: `request-${id}`,
  financialInboxMessageId: `inbox-${id}`,
  expenseId: `expense-${id}`,
  amount: 1200,
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
