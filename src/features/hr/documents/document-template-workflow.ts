export const DOCUMENT_TEMPLATE_WORKFLOW_STATUSES = [
  "technical_validation",
  "legal_review",
  "rh_approval",
  "published",
  "superseded",
  "archived",
] as const;

export type DocumentTemplateWorkflowStatus = typeof DOCUMENT_TEMPLATE_WORKFLOW_STATUSES[number];

export type DocumentTemplateWorkflowDecision = "advance" | "return";

export const DOCUMENT_TEMPLATE_WORKFLOW_LABELS: Record<DocumentTemplateWorkflowStatus, string> = {
  technical_validation: "Em validação técnica",
  // Compatibilidade com registros antigos: a etapa jurídica foi removida do fluxo visível.
  legal_review: "Em homologação pelo RH",
  rh_approval: "Em homologação pelo RH",
  published: "Publicado",
  superseded: "Substituído",
  archived: "Arquivado",
};

export const DOCUMENT_TEMPLATE_WORKFLOW_ACTIONS: Partial<Record<DocumentTemplateWorkflowStatus, {
  next: DocumentTemplateWorkflowStatus;
  label: string;
}>> = {
  technical_validation: { next: "rh_approval", label: "Enviar para homologação do RH" },
  legal_review: { next: "published", label: "Homologar e publicar" },
  rh_approval: { next: "published", label: "Homologar e publicar" },
  published: { next: "superseded", label: "Marcar como substituído" },
  superseded: { next: "archived", label: "Arquivar modelo" },
};

export function isDocumentTemplateWorkflowStatus(value: unknown): value is DocumentTemplateWorkflowStatus {
  return DOCUMENT_TEMPLATE_WORKFLOW_STATUSES.includes(value as DocumentTemplateWorkflowStatus);
}

export function defaultSystemTemplateWorkflowStatus(template: {
  id: string;
  status: "published" | "draft";
}): DocumentTemplateWorkflowStatus {
  if (template.status === "published") return "published";
  if (template.id.startsWith("system-admission-")) return "rh_approval";
  return "technical_validation";
}

export function canAdvanceDocumentTemplateWorkflow(
  current: DocumentTemplateWorkflowStatus,
  next: DocumentTemplateWorkflowStatus,
) {
  return DOCUMENT_TEMPLATE_WORKFLOW_ACTIONS[current]?.next === next;
}

export function canReturnDocumentTemplateForAdjustments(
  current: DocumentTemplateWorkflowStatus,
  next: DocumentTemplateWorkflowStatus,
) {
  return (
    (current === "rh_approval" || current === "legal_review")
    && next === "technical_validation"
  );
}

export function canTransitionDocumentTemplateWorkflow(params: {
  current: DocumentTemplateWorkflowStatus;
  next: DocumentTemplateWorkflowStatus;
  decision?: DocumentTemplateWorkflowDecision;
}) {
  return params.decision === "return"
    ? canReturnDocumentTemplateForAdjustments(params.current, params.next)
    : canAdvanceDocumentTemplateWorkflow(params.current, params.next);
}
