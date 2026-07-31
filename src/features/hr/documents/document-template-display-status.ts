import {
  DOCUMENT_TEMPLATE_WORKFLOW_LABELS,
  type DocumentTemplateWorkflowStatus,
} from "@/features/hr/documents/document-template-workflow";

type DisplayStatusTemplate = {
  status?: string;
  isSystem?: boolean;
  officialCandidate?: boolean;
  workflowStatus?: DocumentTemplateWorkflowStatus;
  aiMappingPlan?: { reviewed?: boolean } | null;
  fieldPreparationTestedAt?: unknown;
  preparationStatus?: DocumentTemplatePreparationStatus;
};

export const DOCUMENT_TEMPLATE_PREPARATION_STATUSES = [
  "ai_mapping",
  "validation_editing",
  "visual_test",
  "ready_for_rh_approval",
  // Valor legado mantido apenas para leitura de modelos preparados anteriormente.
  "ready_for_legal_review",
  "available",
] as const;

export type DocumentTemplatePreparationStatus =
  typeof DOCUMENT_TEMPLATE_PREPARATION_STATUSES[number];

export const DOCUMENT_TEMPLATE_PREPARATION_LABELS: Record<DocumentTemplatePreparationStatus, string> = {
  ai_mapping: "Em mapeamento pela IA",
  validation_editing: "Em edição manual",
  visual_test: "Em teste visual",
  ready_for_rh_approval: "Pronto para homologação do RH",
  ready_for_legal_review: "Pronto para homologação do RH",
  available: "Disponível",
};

export function documentTemplateDisplayStatus(template: DisplayStatusTemplate) {
  if (template.workflowStatus === "published" || template.status === "published") return "Publicado";
  if (template.workflowStatus === "superseded") return "Substituído";
  if (template.workflowStatus === "archived") return "Arquivado";

  if (
    template.workflowStatus
    && template.workflowStatus !== "technical_validation"
  ) {
    return DOCUMENT_TEMPLATE_WORKFLOW_LABELS[template.workflowStatus];
  }

  if (template.preparationStatus) {
    return DOCUMENT_TEMPLATE_PREPARATION_LABELS[template.preparationStatus];
  }
  if (!template.aiMappingPlan) return "Em mapeamento pela IA";
  if (!template.aiMappingPlan.reviewed) return "Em edição manual";
  if (!template.fieldPreparationTestedAt) return "Em teste visual";
  return template.officialCandidate || template.isSystem
    ? "Pronto para homologação do RH"
    : "Disponível";
}
