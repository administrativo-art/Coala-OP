import { createHash } from "node:crypto";

import type {
  FormExecution,
  FormAssignment,
  FormModel,
  FormProjectMember,
  FormProject,
  FormSubtype,
  FormTemplate,
  FormType,
} from "@/types/forms";
import { checklistDbAdmin } from "@/lib/firebase-checklist-admin";
import { dbAdmin } from "@/lib/firebase-admin";

export function serializeFormValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(serializeFormValue);
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { toDate?: () => Date }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        serializeFormValue(entry),
      ])
    );
  }
  return value;
}

function collectionWithWorkspace(collectionName: string, workspaceId: string) {
  return checklistDbAdmin
    .collection(collectionName)
    .where("workspace_id", "==", workspaceId);
}

type UnitProjectSeed = {
  id: string;
  name: string;
  groupId?: string;
  is_active?: boolean;
  isArchived?: boolean;
};

const UNIT_PROJECT_COLORS = [
  "#6366f1",
  "#10b981",
  "#f59e0b",
  "#0ea5e9",
  "#8b5cf6",
  "#14b8a6",
];

function unitProjectDocId(unitId: string) {
  const hash = createHash("sha1").update(unitId).digest("hex").slice(0, 16);
  return `unit_auto_${hash}`;
}

function unitProjectName(unit: UnitProjectSeed, groupName?: string) {
  const unitName = String(unit.name ?? "").trim();
  const baseName = unitName.toLowerCase().startsWith("unidade ")
    ? unitName
    : `Unidade ${unitName}`;
  return groupName ? `${baseName} | ${groupName}` : baseName;
}

function colorForUnit(unitId: string) {
  const hash = createHash("sha1").update(unitId).digest("hex");
  const index = Number.parseInt(hash.slice(0, 2), 16) % UNIT_PROJECT_COLORS.length;
  return UNIT_PROJECT_COLORS[index];
}

export async function ensureUnitFormProjects(workspaceId: string) {
  const [unitsSnap, groupsSnap, projectsSnap] = await Promise.all([
    dbAdmin.collection("dp_units").orderBy("name").get(),
    dbAdmin.collection("dp_unitGroups").get(),
    collectionWithWorkspace("form_projects", workspaceId).get(),
  ]);

  const groupNameById = new Map(
    groupsSnap.docs.map((doc) => [doc.id, String(doc.get("name") ?? "").trim()])
  );
  const projects = projectsSnap.docs.map((doc) => ({
    ref: doc.ref,
    id: doc.id,
    data: doc.data(),
  }));
  const projectByUnitId = new Map<string, (typeof projects)[number]>();
  const projectByName = new Map<string, (typeof projects)[number]>();

  projects.forEach((project) => {
    const unitId = project.data.unit_id;
    if (typeof unitId === "string" && unitId) {
      projectByUnitId.set(unitId, project);
    }
    const name = String(project.data.name ?? "").trim().toLowerCase();
    if (name) {
      projectByName.set(name, project);
    }
  });

  const writes: Array<{
    ref: FirebaseFirestore.DocumentReference;
    data: Record<string, unknown>;
  }> = [];
  const currentUnitIds = new Set(unitsSnap.docs.map((doc) => doc.id));

  unitsSnap.docs.forEach((doc) => {
    const data = doc.data() as Partial<UnitProjectSeed>;
    const name = typeof data.name === "string" ? data.name.trim() : "";
    if (!name) return;

    const unit: UnitProjectSeed = {
      id: doc.id,
      name,
      groupId: typeof data.groupId === "string" ? data.groupId : undefined,
      is_active: data.isArchived === true ? false : data.is_active,
    };
    const groupName = unit.groupId ? groupNameById.get(unit.groupId) : undefined;
    const projectName = unitProjectName(unit, groupName);
    const existing =
      projectByUnitId.get(unit.id) ??
      projectByName.get(projectName.toLowerCase());
    const now = new Date();

    if (existing) {
      writes.push({
        ref: existing.ref,
        data: {
          name: projectName,
          source: "unit_auto",
          unit_id: unit.id,
          unit_name_snapshot: name,
          is_active: unit.is_active === false ? false : true,
          updated_at: now,
        },
      });
      return;
    }

    writes.push({
      ref: checklistDbAdmin.collection("form_projects").doc(unitProjectDocId(unit.id)),
      data: {
        workspace_id: workspaceId,
        name: projectName,
        description: "Projeto operacional da unidade.",
        color: colorForUnit(unit.id),
        icon: "building",
        source: "unit_auto",
        unit_id: unit.id,
        unit_name_snapshot: name,
        is_active: unit.is_active === false ? false : true,
        members: [],
        created_at: now,
        updated_at: now,
        created_by: {
          user_id: "system",
          username: "Sistema",
        },
      },
    });
  });

  projects.forEach((project) => {
    const unitId = typeof project.data.unit_id === "string" ? project.data.unit_id : "";
    if (project.data.source !== "unit_auto" || !unitId || currentUnitIds.has(unitId)) return;
    writes.push({
      ref: project.ref,
      data: {
        is_active: false,
        archived_at: new Date(),
        updated_at: new Date(),
      },
    });
  });

  for (let index = 0; index < writes.length; index += 400) {
    const batch = checklistDbAdmin.batch();
    writes.slice(index, index + 400).forEach((write) => {
      batch.set(write.ref, write.data, { merge: true });
    });
    await batch.commit();
  }

  return { ensured: writes.length };
}

export async function listFormAssignments(params: {
  workspaceId: string;
  formProjectId?: string | null;
  formTemplateId?: string | null;
  status?: string | null;
}) {
  let query = collectionWithWorkspace("form_assignments", params.workspaceId);
  if (params.formProjectId) {
    query = query.where("form_project_id", "==", params.formProjectId);
  }
  if (params.formTemplateId) {
    query = query.where("form_template_id", "==", params.formTemplateId);
  }
  if (params.status) {
    query = query.where("status", "==", params.status);
  }

  const snap = await query.get();
  return snap.docs.map((doc) => ({
    id: doc.id,
    ...((serializeFormValue(doc.data()) as Record<string, unknown>) ?? {}),
  })) as FormAssignment[];
}

export async function getFormProjectById(projectId: string, workspaceId?: string) {
  const snap = await checklistDbAdmin.collection("form_projects").doc(projectId).get();
  if (!snap.exists) return null;

  const project = {
    id: snap.id,
    ...((serializeFormValue(snap.data()) as Record<string, unknown>) ?? {}),
  } as FormProject;

  if (workspaceId && project.workspace_id !== workspaceId) return null;
  return project;
}

export async function getActiveFormAssignment(params: {
  workspaceId: string;
  formTemplateId: string;
}) {
  const assignments = await listFormAssignments({
    workspaceId: params.workspaceId,
    formTemplateId: params.formTemplateId,
    status: "active",
  });

  return assignments.sort((left, right) =>
    String(right.updated_at ?? right.created_at ?? "").localeCompare(
      String(left.updated_at ?? left.created_at ?? "")
    )
  )[0] ?? null;
}

export async function listFormModels(params: {
  workspaceId: string;
  isActive?: boolean;
}) {
  let query = collectionWithWorkspace("form_models", params.workspaceId);
  if (typeof params.isActive === "boolean") {
    query = query.where("is_active", "==", params.isActive);
  }

  const snap = await query.get();
  return snap.docs.map((doc) => ({
    id: doc.id,
    ...((serializeFormValue(doc.data()) as Record<string, unknown>) ?? {}),
  })) as FormModel[];
}

export async function listFormProjects(workspaceId: string) {
  const snap = await collectionWithWorkspace("form_projects", workspaceId)
    .where("is_active", "==", true)
    .get();

  return snap.docs.map((doc) => ({
    id: doc.id,
    ...((serializeFormValue(doc.data()) as Record<string, unknown>) ?? {}),
  })) as FormProject[];
}

export async function listFormTypes(params: {
  workspaceId: string;
  formProjectId?: string | null;
  isActive?: boolean;
}) {
  let query = collectionWithWorkspace("form_types", params.workspaceId);
  if (params.formProjectId) {
    query = query.where("form_project_id", "==", params.formProjectId);
  }
  if (typeof params.isActive === "boolean") {
    query = query.where("is_active", "==", params.isActive);
  }

  const snap = await query.get();
  return snap.docs.map((doc) => ({
    id: doc.id,
    ...((serializeFormValue(doc.data()) as Record<string, unknown>) ?? {}),
  })) as FormType[];
}

export async function listFormSubtypes(params: {
  workspaceId: string;
  formProjectId?: string | null;
  formTypeId?: string | null;
  isActive?: boolean;
}) {
  let query = collectionWithWorkspace("form_subtypes", params.workspaceId);
  if (params.formProjectId) {
    query = query.where("form_project_id", "==", params.formProjectId);
  }
  if (params.formTypeId) {
    query = query.where("form_type_id", "==", params.formTypeId);
  }
  if (typeof params.isActive === "boolean") {
    query = query.where("is_active", "==", params.isActive);
  }

  const snap = await query.get();
  return snap.docs.map((doc) => ({
    id: doc.id,
    ...((serializeFormValue(doc.data()) as Record<string, unknown>) ?? {}),
  })) as FormSubtype[];
}

export async function listFormTemplates(params: {
  workspaceId: string;
  formProjectId?: string | null;
  isActive?: boolean;
}) {
  let query = collectionWithWorkspace("form_templates", params.workspaceId);
  if (params.formProjectId) {
    query = query.where("form_project_id", "==", params.formProjectId);
  }
  if (typeof params.isActive === "boolean") {
    query = query.where("is_active", "==", params.isActive);
  }

  const snap = await query.get();
  return snap.docs.map((doc) => ({
    id: doc.id,
    ...((serializeFormValue(doc.data()) as Record<string, unknown>) ?? {}),
  })) as FormTemplate[];
}

export async function listFormExecutions(params: {
  workspaceId: string;
  formProjectId?: string | null;
  status?: string | null;
  assignedUserId?: string | null;
  limit?: number;
}) {
  let query = collectionWithWorkspace("form_executions", params.workspaceId);
  if (params.formProjectId) {
    query = query.where("form_project_id", "==", params.formProjectId);
  }
  if (params.status) {
    query = query.where("status", "==", params.status);
  }
  if (params.assignedUserId) {
    query = query.where("assigned_user_id", "==", params.assignedUserId);
  }

  const snap = await query.limit(params.limit ?? 50).get();
  const executions = snap.docs.map((doc) => ({
    id: doc.id,
    ...((serializeFormValue(doc.data()) as Record<string, unknown>) ?? {}),
  })) as FormExecution[];

  return executions.sort((left, right) =>
    String(right.updated_at ?? right.created_at ?? "").localeCompare(
      String(left.updated_at ?? left.created_at ?? "")
    )
  );
}

export async function listFormExecutionsForAssignee(params: {
  workspaceId: string;
  userId: string;
  unitIds: string[];
  statuses?: string[];
  limit?: number;
}) {
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 300);
  const snap = await collectionWithWorkspace("form_executions", params.workspaceId)
    .limit(limit)
    .get();

  const allowedUnitIds = new Set(params.unitIds.filter(Boolean));
  const allowedStatuses = new Set(params.statuses ?? ["pending", "in_progress", "overdue"]);

  const executions = snap.docs.map((doc) => ({
    id: doc.id,
    ...((serializeFormValue(doc.data()) as Record<string, unknown>) ?? {}),
  })) as FormExecution[];

  return executions
    .filter((execution) => {
      if (allowedStatuses.size > 0 && !allowedStatuses.has(execution.status)) return false;
      if (execution.assigned_user_id === params.userId) return true;
      if (execution.collaborator_user_ids?.includes(params.userId)) return true;
      const assignedToUnitPool =
        execution.assigned_user_id === "__unit_pool__" ||
        execution.assigned_user_id === "unit_pool" ||
        execution.assigned_user_id === "";
      return assignedToUnitPool && allowedUnitIds.has(execution.unit_id);
    })
    .sort((left, right) =>
      String(left.due_at ?? left.scheduled_for ?? left.created_at ?? "").localeCompare(
        String(right.due_at ?? right.scheduled_for ?? right.created_at ?? "")
      )
    )
    .slice(0, limit);
}

export async function getFormTemplateById(templateId: string, workspaceId?: string) {
  const snap = await checklistDbAdmin.collection("form_templates").doc(templateId).get();
  if (!snap.exists) return null;

  const template = {
    id: snap.id,
    ...((serializeFormValue(snap.data()) as Record<string, unknown>) ?? {}),
  } as FormTemplate;

  if (workspaceId && template.workspace_id !== workspaceId) return null;
  return template;
}

export async function getFormTypeById(typeId: string, workspaceId?: string) {
  const snap = await checklistDbAdmin.collection("form_types").doc(typeId).get();
  if (!snap.exists) return null;

  const type = {
    id: snap.id,
    ...((serializeFormValue(snap.data()) as Record<string, unknown>) ?? {}),
  } as FormType;

  if (workspaceId && type.workspace_id !== workspaceId) return null;
  return type;
}

export async function getFormSubtypeById(subtypeId: string, workspaceId?: string) {
  const snap = await checklistDbAdmin.collection("form_subtypes").doc(subtypeId).get();
  if (!snap.exists) return null;

  const subtype = {
    id: snap.id,
    ...((serializeFormValue(snap.data()) as Record<string, unknown>) ?? {}),
  } as FormSubtype;

  if (workspaceId && subtype.workspace_id !== workspaceId) return null;
  return subtype;
}

export async function getFormExecutionById(executionId: string, workspaceId?: string) {
  const snap = await checklistDbAdmin.collection("form_executions").doc(executionId).get();
  if (!snap.exists) return null;

  const execution = {
    id: snap.id,
    ...((serializeFormValue(snap.data()) as Record<string, unknown>) ?? {}),
  } as FormExecution;

  if (workspaceId && execution.workspace_id !== workspaceId) return null;

  const eventsSnap = await snap.ref.collection("events").orderBy("timestamp", "desc").limit(20).get();

  return {
    execution,
    events: eventsSnap.docs.map((doc) => ({
      id: doc.id,
      ...((serializeFormValue(doc.data()) as Record<string, unknown>) ?? {}),
    })),
  };
}

export function projectMemberPermission(member?: FormProjectMember | null) {
  const role = member?.role;
  const custom = member?.custom_permissions ?? {};
  return {
    view: custom.view ?? (role === "viewer" || role === "operator" || role === "manager"),
    operate: custom.operate ?? (role === "operator" || role === "manager"),
    manage: custom.manage ?? role === "manager",
  };
}
