import type { DocumentTemplateWorkflowStatus } from "@/features/hr/documents/document-template-workflow";

export type DocumentTemplateGovernanceState = {
  officialCandidate?: boolean;
  status?: string | null;
  workflowStatus?: DocumentTemplateWorkflowStatus | string | null;
};

const LOCKED_OFFICIAL_WORKFLOW_STATUSES = new Set<string>([
  "legal_review",
  "rh_approval",
  "published",
  "superseded",
  "archived",
]);

/**
 * Conteúdo e mapeamento só podem mudar durante a preparação técnica. Uma versão
 * enviada para homologação é uma evidência imutável; qualquer ajuste nasce em
 * uma nova versão ou retorna formalmente para a etapa técnica.
 */
export function isDocumentTemplateContentEditable(
  template: DocumentTemplateGovernanceState,
) {
  if (template.status === "published") return false;
  if (!template.officialCandidate) return true;
  return !LOCKED_OFFICIAL_WORKFLOW_STATUSES.has(String(template.workflowStatus ?? ""));
}

export function documentTemplateEditBlockMessage(
  template: DocumentTemplateGovernanceState,
) {
  if (template.status === "published" || template.workflowStatus === "published") {
    return "Crie uma nova versão para alterar este modelo oficial publicado.";
  }
  if (template.workflowStatus === "rh_approval" || template.workflowStatus === "legal_review") {
    return "Esta versão está em homologação do RH e não pode ser alterada. Devolva para ajustes ou crie uma nova versão.";
  }
  if (template.workflowStatus === "superseded" || template.workflowStatus === "archived") {
    return "Esta versão não está mais em preparação. Crie uma nova versão para editar.";
  }
  return "Esta versão está protegida e não pode ser alterada.";
}
