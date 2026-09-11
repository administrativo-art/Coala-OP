import assert from "node:assert/strict";
import test from "node:test";

import { shouldAutomaticallyIdentifyInboxCharge } from "../../src/features/financial/inbox/automation-policy";
import type { FinancialInboxExpenseSuggestion } from "../../src/features/financial/inbox/types";

const suggestion = {
  status: "suggested",
  expenseId: "expense-1",
  automaticLinkEligible: true,
  automaticLinkPolicyVersion: 1,
} as FinancialInboxExpenseSuggestion;

test("automação é opt-in e exige a política documental vigente", () => {
  assert.equal(shouldAutomaticallyIdentifyInboxCharge({
    settings: { mode: "manual", policyVersion: 1, updatedAt: null, updatedBy: null },
    suggestion,
  }), false);
  assert.equal(shouldAutomaticallyIdentifyInboxCharge({
    settings: { mode: "document_identity", policyVersion: 1, updatedAt: null, updatedBy: null },
    suggestion,
  }), true);
  assert.equal(shouldAutomaticallyIdentifyInboxCharge({
    settings: { mode: "document_identity", policyVersion: 1, updatedAt: null, updatedBy: null },
    suggestion: { ...suggestion, automaticLinkEligible: false },
  }), false);
});
