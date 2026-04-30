import { checklistDbAdmin } from "@/lib/firebase-checklist-admin";
import { getFeatureFlags } from "@/lib/feature-flags";
import { type FormExecution, type FormTemplate, type FormTemplateItem } from "@/types/forms";

function mapTemplateItem(item: FormTemplateItem): Record<string, unknown> {
  return {
    id: item.id,
    order: item.order,
    title: item.title,
    description: item.description ?? null,
    type: item.type,
    required: item.required,
    weight: item.weight,
    blockNext: item.block_next,
    criticality: item.criticality,
    referenceValue: item.reference_value ?? null,
    tolerancePercent: item.tolerance_percent ?? null,
    actionRequired: item.action_required ?? false,
    showIf: item.show_if ?? null,
    conditionalBranches: (item.conditional_branches ?? []).map((branch) => ({
      value: branch.value ?? null,
      label: branch.label,
      items: branch.items.map(mapTemplateItem),
    })),
    taskTriggers: item.task_triggers ?? [],
    config: item.config ?? null,
  };
}

function mapTemplateToLegacy(templateId: string, template: FormTemplate) {
  return {
    workspace_id: template.workspace_id,
    migratedFromForms: true,
    formTemplateId: templateId,
    name: template.name,
    description: template.description ?? null,
    category: template.form_subtype_id ?? template.form_type_id,
    templateType: template.occurrence_type ?? "manual",
    isActive: template.is_active,
    version: template.version,
    versionHistory: template.version_history ?? [],
    sections: template.sections.map((section) => ({
      id: section.id,
      title: section.title,
      order: section.order,
      showIf: section.show_if ?? null,
      requirePhoto: section.require_photo ?? false,
      requireSignature: section.require_signature ?? false,
      items: section.items.map(mapTemplateItem),
    })),
    createdAt: template.created_at,
    updatedAt: template.updated_at ?? template.created_at,
    createdBy: template.created_by ?? null,
    updatedBy: template.updated_by ?? null,
  };
}

function mapExecutionToLegacy(executionId: string, execution: FormExecution) {
  return {
    workspace_id: execution.workspace_id,
    migratedFromForms: true,
    formExecutionId: executionId,
    templateId: execution.template_id,
    templateVersion: execution.template_version,
    templateName: execution.template_name,
    unitId: execution.unit_id ?? null,
    unitName: execution.unit_name ?? null,
    status: execution.status,
    score: execution.score ?? 0,
    sectionsSummary: execution.sections_summary ?? {},
    templateSnapshot: execution.template_snapshot ?? null,
    sections: execution.sections ?? [],
    items: execution.items ?? [],
    claimedByUserId: execution.claimed_by_user_id ?? null,
    claimedByUsername: execution.claimed_by_username ?? null,
    claimedAt: execution.claimed_at ?? null,
    completedAt: execution.completed_at ?? null,
    canceledAt: execution.canceled_at ?? null,
    createdAt: execution.created_at,
    updatedAt: execution.updated_at ?? execution.created_at,
  };
}

async function shouldDualWrite(workspaceId: string) {
  const flags = await getFeatureFlags(workspaceId);
  return flags.forms_legacy_dual_write_enabled === true;
}

export async function mirrorTemplateToLegacy(params: {
  templateId: string;
  template: FormTemplate;
}) {
  if (!(await shouldDualWrite(params.template.workspace_id))) {
    return;
  }

  await checklistDbAdmin
    .collection("checklistTemplates")
    .doc(params.templateId)
    .set(mapTemplateToLegacy(params.templateId, params.template), { merge: true });
}

export async function mirrorExecutionToLegacy(params: {
  executionId: string;
  execution: FormExecution;
}) {
  if (!(await shouldDualWrite(params.execution.workspace_id))) {
    return;
  }

  await checklistDbAdmin
    .collection("checklistExecutions")
    .doc(params.executionId)
    .set(mapExecutionToLegacy(params.executionId, params.execution), { merge: true });
}
