export function canRemoveEmployeeArchiveDocument(input: {
  source?: "generated" | "onboarding" | "autentique_signature";
  status?: string;
  canManageEmployeeDocuments: boolean;
  canReviewGenerated: boolean;
}) {
  if (input.source === "onboarding") return false;
  if (input.source === "generated") {
    return input.canReviewGenerated && ["draft", "review_pending"].includes(input.status ?? "");
  }
  return input.canManageEmployeeDocuments;
}

export function canArchiveTemplateVersion(workflowStatus: string | undefined, canManage: boolean) {
  return canManage && workflowStatus === "superseded";
}

export function canArchiveFinancialMessage(scope: string, canDiscard: boolean) {
  return canDiscard && scope === "identified";
}
