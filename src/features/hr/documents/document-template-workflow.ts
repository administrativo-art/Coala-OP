export const DOCUMENT_TEMPLATE_WORKFLOW_STATUSES = [
  "technical_validation",
  "legal_review",
  "rh_approval",
  "published",
  "superseded",
  "archived",
] as const;

export type DocumentTemplateWorkflowStatus = typeof DOCUMENT_TEMPLATE_WORKFLOW_STATUSES[number];

export const DOCUMENT_TEMPLATE_WORKFLOW_LABELS: Record<DocumentTemplateWorkflowStatus, string> = {
  technical_validation: "Em validação técnica",
  legal_review: "Em revisão jurídica",
  rh_approval: "Em homologação pelo RH",
  published: "Publicado",
  superseded: "Substituído",
  archived: "Arquivado",
};

export const DOCUMENT_TEMPLATE_WORKFLOW_ACTIONS: Partial<Record<DocumentTemplateWorkflowStatus, {
  next: DocumentTemplateWorkflowStatus;
  label: string;
}>> = {
  technical_validation: { next: "legal_review", label: "Concluir validação técnica" },
  legal_review: { next: "rh_approval", label: "Registrar revisão jurídica" },
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
  if (template.id.startsWith("system-admission-")) return "legal_review";
  return "technical_validation";
}

export function canAdvanceDocumentTemplateWorkflow(
  current: DocumentTemplateWorkflowStatus,
  next: DocumentTemplateWorkflowStatus,
) {
  return DOCUMENT_TEMPLATE_WORKFLOW_ACTIONS[current]?.next === next;
}
