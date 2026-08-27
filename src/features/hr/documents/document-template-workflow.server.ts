import "server-only";

import type { SystemDocumentTemplate } from "@/features/hr/documents/system-template-catalog";
import {
  defaultSystemTemplateWorkflowStatus,
  isDocumentTemplateWorkflowStatus,
  type DocumentTemplateWorkflowStatus,
} from "@/features/hr/documents/document-template-workflow";
import { dbAdmin } from "@/lib/firebase-admin";

export const SYSTEM_TEMPLATE_WORKFLOW_COLLECTION = "systemDocumentTemplateStates";

function isoDate(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }
  return null;
}

export async function systemTemplateWorkflowStatus(
  template: SystemDocumentTemplate,
): Promise<DocumentTemplateWorkflowStatus> {
  const state = await dbAdmin.collection(SYSTEM_TEMPLATE_WORKFLOW_COLLECTION).doc(template.id).get();
  const status = state.get("status");
  return isDocumentTemplateWorkflowStatus(status)
    ? status
    : defaultSystemTemplateWorkflowStatus(template);
}

export async function effectiveSystemDocumentTemplates(
  templates: readonly SystemDocumentTemplate[],
) {
  const snapshot = await dbAdmin.collection(SYSTEM_TEMPLATE_WORKFLOW_COLLECTION).get();
  const states = new Map(snapshot.docs.map((document) => [document.id, document.data()]));
  return templates.map((template) => {
    const state = states.get(template.id);
    const workflowStatus = isDocumentTemplateWorkflowStatus(state?.status)
      ? state.status
      : defaultSystemTemplateWorkflowStatus(template);
    return {
      ...template,
      status: workflowStatus === "published" ? "published" as const : "draft" as const,
      workflowStatus,
      workflowUpdatedAt: isoDate(state?.updatedAt),
      workflowUpdatedByName: state?.updatedByName ?? null,
      workflowNote: state?.note ?? null,
      workflowHistory: Array.isArray(state?.history)
        ? state.history.map((event) => ({
            ...event,
            at: isoDate(event?.at),
          }))
        : [],
    };
  });
}
