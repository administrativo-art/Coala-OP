import assert from "node:assert/strict";
import test from "node:test";

import { canCommitFinancialInboxAnalysis } from "../../src/features/financial/inbox/analysis-commit-policy";
import type { FinancialInboxMessage } from "../../src/features/financial/inbox/types";

const source = {
  workspaceId: "workspace-1", status: "pending_review", updatedAt: "2026-10-21T12:00:00.000Z",
  linkedExpenseId: null, paymentRequestId: null,
} as FinancialInboxMessage;

test("resultado de análise antiga não sobrescreve descarte, vínculo ou pedido concorrente", () => {
  assert.equal(canCommitFinancialInboxAnalysis(source, source), true);
  assert.equal(canCommitFinancialInboxAnalysis(source, { ...source, status: "ignored" }), false);
  assert.equal(canCommitFinancialInboxAnalysis(source, { ...source, linkedExpenseId: "expense-1" }), false);
  assert.equal(canCommitFinancialInboxAnalysis(source, { ...source, paymentRequestId: "request-1" }), false);
  assert.equal(canCommitFinancialInboxAnalysis(source, { ...source, updatedAt: "2026-10-21T12:01:00.000Z" }), false);
  assert.equal(canCommitFinancialInboxAnalysis(source, { ...source, workspaceId: "other" }), false);
});
