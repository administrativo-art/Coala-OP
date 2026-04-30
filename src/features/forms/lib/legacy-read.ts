import type {
  FormExecution,
  FormExecutionItem,
  FormProject,
  FormTemplate,
} from "@/types/forms";
import { checklistDbAdmin } from "@/lib/firebase-checklist-admin";

type JsonRecord = Record<string, unknown>;

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function timestampToIso(value: unknown) {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof (value as { toDate?: () => Date }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return undefined;
}

function createSlug(input: string, fallback: string) {
  const normalized = input
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || fallback;
}

function mapLegacyTemplate(docId: string, data: JsonRecord): FormTemplate {
  const categorySlug = createSlug(asString(data.category, "geral"), "geral");
  const typeSlug = createSlug(asString(data.templateType, "manual"), "manual");
  const sections = Array.isArray(data.sections)
    ? data.sections.map((section, sectionIndex) => {
        const sectionData = section as JsonRecord;
        return {
          id: asString(sectionData.id, `section-${sectionIndex + 1}`),
          title: asString(sectionData.title, `Seção ${sectionIndex + 1}`),
          order:
            typeof sectionData.order === "number" ? sectionData.order : sectionIndex,
          items: Array.isArray(sectionData.items)
            ? sectionData.items.map((item, itemIndex) => {
                const itemData = item as JsonRecord;
                return {
                  id: asString(itemData.id, `item-${itemIndex + 1}`),
                  order:
                    typeof itemData.order === "number" ? itemData.order : itemIndex,
                  title: asString(itemData.title, `Item ${itemIndex + 1}`),
                  description: asString(itemData.description) || undefined,
                  type: asString(itemData.type, "text") as FormTemplate["sections"][number]["items"][number]["type"],
                  required: itemData.required === true,
                  weight: typeof itemData.weight === "number" ? itemData.weight : 1,
                  block_next:
                    itemData.blockNext === true || itemData.block_next === true,
                  criticality: asString(itemData.criticality, "medium") as FormTemplate["sections"][number]["items"][number]["criticality"],
                };
              })
            : [],
        };
      })
    : [];

  return {
    id: `legacy-template-${docId}`,
    workspace_id: "coala",
    form_project_id: `legacy-${categorySlug}`,
    form_type_id: `legacy-type-${typeSlug}`,
    form_subtype_id: `legacy-subtype-${categorySlug}`,
    context: "operational",
    name: asString(data.name, docId),
    description: asString(data.description) || undefined,
    occurrence_type: "manual",
    is_active: data.isActive !== false && data.is_active !== false,
    version: typeof data.version === "number" ? data.version : 1,
    sections,
    created_at: timestampToIso(data.createdAt ?? data.created_at) ?? new Date().toISOString(),
    updated_at: timestampToIso(data.updatedAt ?? data.updated_at) ?? new Date().toISOString(),
    created_by: { user_id: "legacy", username: "legacy" },
  };
}

function buildSectionsSummary(items: Array<Record<string, unknown>>) {
  const summary: Record<string, { total_items: number; completed_items: number; score?: number }> = {};
  items.forEach((item) => {
    const key = asString(item.section_id, "unknown");
    summary[key] ??= { total_items: 0, completed_items: 0, score: 0 };
    summary[key].total_items += 1;
    if (item.completed_at || item.checked === true || typeof item.text_value === "string") {
      summary[key].completed_items += 1;
    }
  });
  return summary;
}

function mapLegacyExecution(docId: string, data: JsonRecord): FormExecution {
  const categorySlug = createSlug(asString(data.category, "geral"), "geral");
  const typeSlug = createSlug(asString(data.templateType, "manual"), "manual");
  const items = Array.isArray(data.items)
    ? data.items.map((item, index) => {
        const itemData = item as JsonRecord;
        const sectionId = asString(itemData.sectionId ?? itemData.section_id, "section");
        const sectionTitle = asString(itemData.sectionTitle ?? itemData.section_title, "Seção");
        return {
          id: `${sectionId}-${asString(itemData.id, `item-${index + 1}`)}`,
          template_item_id: asString(itemData.templateItemId ?? itemData.template_item_id ?? itemData.id, `item-${index + 1}`),
          template_section_id: sectionId,
          section_id: sectionId,
          section_title: sectionTitle,
          order: typeof itemData.order === "number" ? itemData.order : index,
          title: asString(itemData.title, `Item ${index + 1}`),
          description: asString(itemData.description) || undefined,
          type: asString(itemData.type, "text") as FormExecutionItem["type"],
          required: itemData.required === true,
          weight: typeof itemData.weight === "number" ? itemData.weight : 1,
          block_next:
            itemData.blockNext === true || itemData.block_next === true,
          criticality: asString(itemData.criticality, "medium") as FormExecutionItem["criticality"],
          checked:
            typeof itemData.checked === "boolean" || itemData.checked === null
              ? itemData.checked
              : undefined,
          text_value: asString(itemData.textValue ?? itemData.text_value) || undefined,
          number_value:
            typeof itemData.numberValue === "number"
              ? itemData.numberValue
              : typeof itemData.number_value === "number"
                ? itemData.number_value
                : undefined,
          photo_urls: asStringArray(itemData.photoUrls ?? itemData.photo_urls),
          signature_url:
            asString(itemData.signatureUrl ?? itemData.signature_url) || undefined,
          completed_at: timestampToIso(itemData.completedAt ?? itemData.completed_at),
          linked_project_task_id:
            asString(itemData.linkedTaskId ?? itemData.linked_project_task_id) ||
            undefined,
          linked_project_task_status:
            asString(itemData.linkedTaskStatus ?? itemData.linked_project_task_status) ||
            undefined,
        };
      })
    : [];

  return {
    id: `legacy-execution-${docId}`,
    workspace_id: "coala",
    form_project_id: `legacy-${categorySlug}`,
    form_type_id: `legacy-type-${typeSlug}`,
    form_subtype_id: `legacy-subtype-${categorySlug}`,
    context: "operational",
    template_id: `legacy-template-${asString(data.templateId, "unknown-template")}`,
    template_name: asString(data.templateName, "Template legado"),
    template_version: typeof data.templateVersion === "number" ? data.templateVersion : 1,
    occurrence_type: "manual",
    unit_id: asString(data.unitId, "legacy-unit"),
    unit_name: asString(data.unitName) || undefined,
    assigned_user_id: asString(data.assignedUserId, "legacy-user"),
    assigned_username: asString(data.assignedUsername, "legacy"),
    collaborator_user_ids: asStringArray(data.collaboratorUserIds),
    collaborator_usernames: asStringArray(data.collaboratorUsernames),
    scheduled_for: asString(data.checklistDate) || undefined,
    sections: Array.isArray(data.sections)
      ? data.sections.map((section, sectionIndex) => {
          const sectionData = section as JsonRecord;
          return {
            id: asString(sectionData.id, `section-${sectionIndex + 1}`),
            template_section_id: asString(sectionData.id, `section-${sectionIndex + 1}`),
            title: asString(sectionData.title, `Seção ${sectionIndex + 1}`),
            order:
              typeof sectionData.order === "number" ? sectionData.order : sectionIndex,
          };
        })
      : [],
    items,
    sections_summary: buildSectionsSummary(items),
    status:
      data.status === "claimed"
        ? "in_progress"
        : data.status === "completed"
          ? "completed"
          : data.status === "overdue"
            ? "overdue"
            : "pending",
    score: typeof data.score === "number" ? data.score : undefined,
    claimed_by_user_id: asString(data.claimedByUserId) || undefined,
    claimed_by_username: asString(data.claimedByUsername) || undefined,
    claimed_at: timestampToIso(data.claimedAt),
    completed_by_user_id: asString(data.completedByUserId) || undefined,
    completed_by_username: asString(data.completedByUsername) || undefined,
    completed_at: timestampToIso(data.completedAt),
    created_at: timestampToIso(data.createdAt) ?? new Date().toISOString(),
    updated_at: timestampToIso(data.updatedAt) ?? new Date().toISOString(),
  };
}

export async function listLegacyFormTemplates(limit = 200) {
  const snap = await checklistDbAdmin.collection("checklistTemplates").limit(limit).get();
  return snap.docs.map((doc) => mapLegacyTemplate(doc.id, (doc.data() ?? {}) as JsonRecord));
}

export async function listLegacyFormExecutions(limit = 200) {
  const snap = await checklistDbAdmin.collection("checklistExecutions").limit(limit).get();
  return snap.docs.map((doc) => mapLegacyExecution(doc.id, (doc.data() ?? {}) as JsonRecord));
}

export async function listLegacyFormProjects(limit = 200) {
  const templates = await listLegacyFormTemplates(limit);
  const projects = new Map<string, FormProject>();
  templates.forEach((template) => {
    if (projects.has(template.form_project_id)) return;
    projects.set(template.form_project_id, {
      id: template.form_project_id,
      workspace_id: template.workspace_id,
      name: template.form_project_id.replace(/^legacy-/, "").replace(/-/g, " "),
      description: "Projeto legado derivado do checklist histórico.",
      is_active: true,
      members: [],
      created_at: template.created_at,
      updated_at: template.updated_at ?? template.created_at,
      created_by: template.created_by ?? { user_id: "legacy", username: "legacy" },
    });
  });
  return Array.from(projects.values());
}

export async function getLegacyFormTemplateBySyntheticId(templateId: string) {
  if (!templateId.startsWith("legacy-template-")) return null;
  const legacyId = templateId.replace(/^legacy-template-/, "");
  const snap = await checklistDbAdmin.collection("checklistTemplates").doc(legacyId).get();
  if (!snap.exists) return null;
  return mapLegacyTemplate(snap.id, (snap.data() ?? {}) as JsonRecord);
}

export async function getLegacyFormExecutionBySyntheticId(executionId: string) {
  if (!executionId.startsWith("legacy-execution-")) return null;
  const legacyId = executionId.replace(/^legacy-execution-/, "");
  const snap = await checklistDbAdmin.collection("checklistExecutions").doc(legacyId).get();
  if (!snap.exists) return null;
  return {
    execution: mapLegacyExecution(snap.id, (snap.data() ?? {}) as JsonRecord),
    events: [],
  };
}
