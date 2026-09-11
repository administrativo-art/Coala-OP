import type {
  FinancialInboxAutomationSettings,
  FinancialInboxExpenseSuggestion,
} from "./types";

export function shouldAutomaticallyIdentifyInboxCharge(params: {
  settings: FinancialInboxAutomationSettings;
  suggestion: FinancialInboxExpenseSuggestion | null | undefined;
}) {
  return params.settings.mode === "document_identity"
    && params.settings.policyVersion === 1
    && params.suggestion?.automaticLinkEligible === true
    && params.suggestion.automaticLinkPolicyVersion === 1;
}
