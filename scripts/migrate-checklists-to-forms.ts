import { applicationDefault, cert, getApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { existsSync, readFileSync } from "fs";

type JsonRecord = Record<string, unknown>;

type CliOptions = {
  dryRun: boolean;
  apply: boolean;
  limit: number | null;
  serviceAccountPath: string | null;
};

function parseArgs(argv: string[]): CliOptions {
  const dryRun = argv.includes("--dry-run");
  const apply = argv.includes("--apply");
  const limitArg = argv.find((arg) => arg.startsWith("--limit="));
  const saArg = argv.find((arg) => arg.startsWith("--service-account="));

  if (!dryRun && !apply) {
    throw new Error("Informe `--dry-run` para ensaio ou `--apply` para gravar.");
  }

  if (dryRun && apply) {
    throw new Error("Use apenas um modo por execução: `--dry-run` ou `--apply`.");
  }

  return {
    dryRun,
    apply,
    limit: limitArg ? Number(limitArg.split("=")[1]) : null,
    serviceAccountPath: saArg ? saArg.split("=")[1] : null,
  };
}

function initAdmin(serviceAccountPath: string | null) {
  const existing = getApps().find((app) => app.name === "forms-migration");
  if (existing) return existing;

  if (serviceAccountPath) {
    if (!existsSync(serviceAccountPath)) {
      throw new Error(`Service account não encontrada: ${serviceAccountPath}`);
    }

    const raw = JSON.parse(readFileSync(serviceAccountPath, "utf8"));
    return initializeApp({ credential: cert(raw) }, "forms-migration");
  }

  return initializeApp(
    {
      credential: applicationDefault(),
      projectId: "smart-converter-752gf",
    },
    "forms-migration"
  );
}

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

function toTimestamp(value: unknown) {
  if (value instanceof Timestamp) return value;
  const iso = timestampToIso(value);
  return iso ? Timestamp.fromDate(new Date(iso)) : Timestamp.now();
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

function mapTemplateTypeToFormType(templateType: string) {
  return templateType || "manual";
}

function mapChecklistItem(item: JsonRecord) {
  return {
    id: asString(item.id),
    order: typeof item.order === "number" ? item.order : 0,
    title: asString(item.title),
    description: asString(item.description) || undefined,
    type: asString(item.type) as
      | "checkbox"
      | "text"
      | "number"
      | "temperature"
      | "select"
      | "photo"
      | "signature"
      | "yes_no"
      | "multi_select"
      | "date",
    required: item.required === true,
    weight: typeof item.weight === "number" ? item.weight : 1,
    block_next: item.blockNext === true || item.block_next === true,
    criticality:
      asString(item.criticality, "medium") as "low" | "medium" | "high" | "critical",
    reference_value:
      typeof item.referenceValue === "number"
        ? item.referenceValue
        : typeof item.reference_value === "number"
          ? item.reference_value
          : undefined,
    tolerance_percent:
      typeof item.tolerancePercent === "number"
        ? item.tolerancePercent
        : typeof item.tolerance_percent === "number"
          ? item.tolerance_percent
          : undefined,
    action_required:
      item.actionRequired === true || item.action_required === true || undefined,
    notify_role_ids: asStringArray(item.notifyRoleIds ?? item.notify_role_ids),
    escalation_minutes:
      typeof item.escalationMinutes === "number"
        ? item.escalationMinutes
        : typeof item.escalation_minutes === "number"
          ? item.escalation_minutes
          : undefined,
    show_if: (item.showIf ?? item.show_if ?? null) as JsonRecord | null,
    conditional_branches: Array.isArray(item.conditionalBranches)
      ? item.conditionalBranches
      : Array.isArray(item.conditional_branches)
        ? item.conditional_branches
        : [],
    config: (item.config ?? null) as JsonRecord | null,
  };
}

function mapChecklistTemplateToFormTemplate(templateId: string, data: JsonRecord) {
  const formProjectId = `legacy-${createSlug(asString(data.category, "geral"), "geral")}`;
  const formTypeId = `legacy-type-${createSlug(mapChecklistTypeToFormType(asString(data.templateType)), "manual")}`;
  const formSubtypeId = `legacy-subtype-${createSlug(asString(data.category, "geral"), "geral")}`;
  const sections = Array.isArray(data.sections)
    ? data.sections.map((section, sectionIndex) => {
        const sectionData = section as JsonRecord;
        return {
          id: asString(sectionData.id, `section-${sectionIndex + 1}`),
          title: asString(sectionData.title, `Seção ${sectionIndex + 1}`),
          order:
            typeof sectionData.order === "number" ? sectionData.order : sectionIndex,
          show_if: (sectionData.showIf ?? sectionData.show_if ?? undefined) as
            | JsonRecord
            | undefined,
          require_photo:
            sectionData.requirePhoto === true || sectionData.require_photo === true,
          require_signature:
            sectionData.requireSignature === true ||
            sectionData.require_signature === true,
          items: Array.isArray(sectionData.items)
            ? sectionData.items.map((item) => mapChecklistItem(item as JsonRecord))
            : [],
        };
      })
    : [];

  return {
    id: `legacy-template-${templateId}`,
    workspace_id: "coala",
    form_project_id: formProjectId,
    form_type_id: formTypeId,
    form_subtype_id: formSubtypeId,
    context: "operational" as const,
    name: asString(data.name, templateId),
    description: asString(data.description) || undefined,
    occurrence_type: asString(data.occurrenceType || data.occurrence_type, "manual"),
    annual_schedule: (data.annualSchedule ?? data.annual_schedule ?? undefined) as
      | { month: number; day: number }
      | undefined,
    custom_schedule: (data.customSchedule ?? data.custom_schedule ?? undefined) as
      | JsonRecord
      | undefined,
    unit_ids: asStringArray(data.unitIds ?? data.unit_ids),
    unit_names: asStringArray(data.unitNames ?? data.unit_names),
    job_role_ids: asStringArray(data.jobRoleIds ?? data.job_role_ids),
    job_role_names: asStringArray(data.jobRoleNames ?? data.job_role_names),
    job_function_ids: asStringArray(data.jobFunctionIds ?? data.job_function_ids),
    job_function_names: asStringArray(data.jobFunctionNames ?? data.job_function_names),
    shift_definition_ids: asStringArray(
      data.shiftDefinitionIds ?? data.shift_definition_ids
    ),
    shift_definition_names: asStringArray(
      data.shiftDefinitionNames ?? data.shift_definition_names
    ),
    is_active: data.isActive !== false && data.is_active !== false,
    version: typeof data.version === "number" ? data.version : 1,
    version_history: Array.isArray(data.versionHistory)
      ? data.versionHistory
      : Array.isArray(data.version_history)
        ? data.version_history
        : [],
    last_execution_at: timestampToIso(data.lastExecutionAt ?? data.last_execution_at),
    sections,
    created_at: toTimestamp(data.createdAt ?? data.created_at),
    updated_at: toTimestamp(data.updatedAt ?? data.updated_at),
    created_by: {
      user_id: asString((data.createdBy as JsonRecord | undefined)?.userId, "migration"),
      username: asString(
        (data.createdBy as JsonRecord | undefined)?.username,
        "migration"
      ),
    },
    updated_by: {
      user_id: asString((data.updatedBy as JsonRecord | undefined)?.userId, "migration"),
      username: asString(
        (data.updatedBy as JsonRecord | undefined)?.username,
        "migration"
      ),
    },
  };
}

function mapChecklistTypeToFormType(type: string) {
  return type || "manual";
}

function buildSectionsSummary(items: JsonRecord[]) {
  const summary: Record<string, { total_items: number; completed_items: number; score?: number }> = {};

  for (const item of items) {
    const key = asString(item.section_id || item.sectionId, "unknown");
    summary[key] ??= { total_items: 0, completed_items: 0, score: 0 };
    summary[key].total_items += 1;

    const completed =
      item.completedAt ||
      item.completed_at ||
      item.checked === true ||
      typeof item.textValue === "string" ||
      typeof item.text_value === "string";

    if (completed) {
      summary[key].completed_items += 1;
    }
  }

  return summary;
}

function mapExecutionItems(items: JsonRecord[]) {
  return items.map((item, index) => ({
    id: `${asString(item.sectionId || item.section_id, "section")}-${asString(item.templateItemId || item.template_item_id, `item-${index + 1}`)}`,
    template_item_id: asString(item.templateItemId || item.template_item_id, `item-${index + 1}`),
    template_section_id: asString(item.sectionId || item.section_id, "section"),
    section_id: asString(item.sectionId || item.section_id, "section"),
    section_title: asString(item.sectionTitle || item.section_title, "Seção"),
    order: typeof item.order === "number" ? item.order : index,
    title: asString(item.title),
    description: asString(item.description) || undefined,
    type: asString(item.type) as string,
    required: item.required === true,
    weight: typeof item.weight === "number" ? item.weight : 1,
    block_next: item.blockNext === true || item.block_next === true,
    criticality:
      asString(item.criticality, "medium") as "low" | "medium" | "high" | "critical",
    reference_value:
      typeof item.referenceValue === "number"
        ? item.referenceValue
        : typeof item.reference_value === "number"
          ? item.reference_value
          : undefined,
    tolerance_percent:
      typeof item.tolerancePercent === "number"
        ? item.tolerancePercent
        : typeof item.tolerance_percent === "number"
          ? item.tolerance_percent
          : undefined,
    action_required:
      item.actionRequired === true || item.action_required === true || undefined,
    notify_role_ids: asStringArray(item.notifyRoleIds ?? item.notify_role_ids),
    escalation_minutes:
      typeof item.escalationMinutes === "number"
        ? item.escalationMinutes
        : typeof item.escalation_minutes === "number"
          ? item.escalation_minutes
          : undefined,
    show_if: (item.showIf ?? item.show_if ?? undefined) as JsonRecord | undefined,
    section_show_if:
      (item.sectionShowIf ?? item.section_show_if ?? undefined) as JsonRecord | undefined,
    config: (item.config ?? undefined) as JsonRecord | undefined,
    checked:
      typeof item.checked === "boolean" || item.checked === null ? item.checked : undefined,
    yes_no_value:
      typeof item.yesNoValue === "boolean"
        ? item.yesNoValue
        : typeof item.yes_no_value === "boolean"
          ? item.yes_no_value
          : undefined,
    text_value: asString(item.textValue ?? item.text_value) || undefined,
    number_value:
      typeof item.numberValue === "number"
        ? item.numberValue
        : typeof item.number_value === "number"
          ? item.number_value
          : undefined,
    multi_values: asStringArray(item.multiValues ?? item.multi_values),
    date_value: asString(item.dateValue ?? item.date_value) || undefined,
    photo_urls: asStringArray(item.photoUrls ?? item.photo_urls),
    signature_url: asString(item.signatureUrl ?? item.signature_url) || undefined,
    is_out_of_range:
      item.isOutOfRange === true || item.is_out_of_range === true || undefined,
    completed_at: timestampToIso(item.completedAt ?? item.completed_at),
    completed_by_user_id: asString(item.completedByUserId ?? item.completed_by_user_id) || undefined,
    linked_project_task_id: asString(item.linkedTaskId ?? item.linked_project_task_id) || undefined,
    linked_project_task_status:
      asString(item.linkedTaskStatus ?? item.linked_project_task_status) || undefined,
  }));
}

function mapChecklistExecutionToFormExecution(executionId: string, data: JsonRecord) {
  const templateId = asString(data.templateId, "unknown-template");
  const templateName = asString(data.templateName, templateId);
  const templateType = mapChecklistTypeToFormType(asString(data.templateType, "manual"));
  const category = createSlug(asString(data.category, "geral"), "geral");
  const items = mapExecutionItems(
    Array.isArray(data.items) ? (data.items as JsonRecord[]) : []
  );

  return {
    id: `legacy-execution-${executionId}`,
    workspace_id: "coala",
    form_project_id: `legacy-${category}`,
    form_type_id: `legacy-type-${createSlug(templateType, "manual")}`,
    form_subtype_id: `legacy-subtype-${category}`,
    context: "operational" as const,
    template_id: `legacy-template-${templateId}`,
    template_name: templateName,
    template_version: typeof data.templateVersion === "number" ? data.templateVersion : 1,
    occurrence_type: asString(data.occurrenceType || data.occurrence_type, "manual"),
    unit_id: asString(data.unitId, "unknown-unit"),
    unit_name: asString(data.unitName) || undefined,
    schedule_id: asString(data.scheduleId) || undefined,
    shift_id: asString(data.shiftId) || undefined,
    shift_definition_id: asString(data.shiftDefinitionId) || undefined,
    shift_definition_name: asString(data.shiftDefinitionName) || undefined,
    shift_start_time: asString(data.shiftStartTime) || undefined,
    shift_end_time: asString(data.shiftEndTime) || undefined,
    shift_end_date: asString(data.shiftEndDate) || undefined,
    assigned_user_id: asString(data.assignedUserId, "unknown-user"),
    assigned_username: asString(data.assignedUsername, "unknown"),
    collaborator_user_ids: asStringArray(data.collaboratorUserIds),
    collaborator_usernames: asStringArray(data.collaboratorUsernames),
    created_by_user_id: asString(data.createdByUserId) || undefined,
    created_by_username: asString(data.createdByUsername) || undefined,
    scheduled_for: asString(data.checklistDate) || undefined,
    sections: Array.isArray(data.sections)
      ? (data.sections as JsonRecord[]).map((section, index) => ({
          id: asString(section.id, `section-${index + 1}`),
          template_section_id: asString(section.id, `section-${index + 1}`),
          title: asString(section.title, `Seção ${index + 1}`),
          order: typeof section.order === "number" ? section.order : index,
          show_if: (section.showIf ?? undefined) as JsonRecord | undefined,
          require_photo: section.requirePhoto === true,
          require_signature: section.requireSignature === true,
          photo_url: asString(section.photoUrl) || undefined,
          signature_url: asString(section.signatureUrl) || undefined,
        }))
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
    created_at: toTimestamp(data.createdAt),
    updated_at: toTimestamp(data.updatedAt),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const app = initAdmin(options.serviceAccountPath);
  const checklistDb = getFirestore(app, "coala-checklist");
  const coalaDb = getFirestore(app, "coala");

  const templateQuery = checklistDb.collection("checklistTemplates");
  const executionQuery = checklistDb.collection("checklistExecutions");

  const [templateSnap, executionSnap] = await Promise.all([
    options.limit ? templateQuery.limit(options.limit).get() : templateQuery.get(),
    options.limit ? executionQuery.limit(options.limit).get() : executionQuery.get(),
  ]);

  const formTemplates = templateSnap.docs.map((doc) =>
    mapChecklistTemplateToFormTemplate(doc.id, (doc.data() ?? {}) as JsonRecord)
  );
  const formExecutions = executionSnap.docs.map((doc) =>
    mapChecklistExecutionToFormExecution(doc.id, (doc.data() ?? {}) as JsonRecord)
  );

  const uniqueProjects = new Map<string, JsonRecord>();
  const uniqueTypes = new Map<string, JsonRecord>();
  const uniqueSubtypes = new Map<string, JsonRecord>();

  for (const template of formTemplates) {
    uniqueProjects.set(template.form_project_id, {
      id: template.form_project_id,
      workspace_id: "coala",
      name: template.form_project_id.replace(/^legacy-/, "").replace(/-/g, " "),
      description: "Projeto migrado do checklist legado.",
      is_active: true,
      members: [],
      created_at: template.created_at,
      updated_at: template.updated_at,
      created_by: template.created_by,
    });

    uniqueTypes.set(template.form_type_id, {
      id: template.form_type_id,
      form_project_id: template.form_project_id,
      workspace_id: "coala",
      name: template.form_type_id.replace(/^legacy-type-/, "").replace(/-/g, " "),
      requires_subtype: true,
      context: "operational",
      order: 0,
      is_active: true,
      created_at: template.created_at,
      updated_at: template.updated_at,
    });

    uniqueSubtypes.set(template.form_subtype_id ?? `${template.form_type_id}-default`, {
      id: template.form_subtype_id ?? `${template.form_type_id}-default`,
      form_type_id: template.form_type_id,
      form_project_id: template.form_project_id,
      workspace_id: "coala",
      name:
        (template.form_subtype_id ?? `${template.form_type_id}-default`)
          .replace(/^legacy-subtype-/, "")
          .replace(/-/g, " "),
      order: 0,
      is_active: true,
      created_at: template.created_at,
      updated_at: template.updated_at,
    });
  }

  const summary = {
    mode: options.dryRun ? "dry-run" : "apply",
    templates_source: templateSnap.size,
    executions_source: executionSnap.size,
    form_projects_target: uniqueProjects.size,
    form_types_target: uniqueTypes.size,
    form_subtypes_target: uniqueSubtypes.size,
    form_templates_target: formTemplates.length,
    form_executions_target: formExecutions.length,
  };

  console.log("\n=== Checklist -> Forms Migration ===");
  console.table(summary);

  if (options.dryRun) {
    console.log("\nDry-run concluído. Nenhuma escrita foi realizada.");
    console.log("Exemplo de template migrado:", formTemplates[0]?.id ?? "nenhum");
    console.log("Exemplo de execução migrada:", formExecutions[0]?.id ?? "nenhuma");
    return;
  }

  const migrationRef = coalaDb.collection("migration_logs").doc();
  const batch = checklistDb.batch();

  for (const project of uniqueProjects.values()) {
    const { id, ...data } = project;
    batch.set(checklistDb.collection("form_projects").doc(String(id)), data, {
      merge: true,
    });
  }

  for (const typeDoc of uniqueTypes.values()) {
    const { id, ...data } = typeDoc;
    batch.set(checklistDb.collection("form_types").doc(String(id)), data, {
      merge: true,
    });
  }

  for (const subtype of uniqueSubtypes.values()) {
    const { id, ...data } = subtype;
    batch.set(checklistDb.collection("form_subtypes").doc(String(id)), data, {
      merge: true,
    });
  }

  for (const template of formTemplates) {
    const { id, ...data } = template;
    batch.set(checklistDb.collection("form_templates").doc(id), data, {
      merge: true,
    });
  }

  for (const execution of formExecutions) {
    const { id, ...data } = execution;
    batch.set(checklistDb.collection("form_executions").doc(id), data, {
      merge: true,
    });
  }

  batch.set(migrationRef, {
    kind: "checklists_to_forms",
    mode: "apply",
    summary,
    created_at: Timestamp.now(),
  });

  await batch.commit();

  console.log("\nMigração aplicada com sucesso.");
  console.log(`Log gravado em coala.migration_logs/${migrationRef.id}`);
}

main().catch((error) => {
  console.error("\nFalha na migração:", error);
  process.exit(1);
});
