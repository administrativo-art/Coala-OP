import type {
  FormExecution,
  FormProject,
  FormSubtype,
  FormTemplate,
  FormType,
} from "@/types/forms";
import { checklistDbAdmin } from "@/lib/firebase-checklist-admin";
import { serializeChecklistValue } from "@/features/dp-checklists/lib/server-access";

export function serializeFormValue(value: unknown): unknown {
  return serializeChecklistValue(value);
}

function collectionWithWorkspace(collectionName: string, workspaceId: string) {
  return checklistDbAdmin
    .collection(collectionName)
    .where("workspace_id", "==", workspaceId);
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
  limit?: number;
}) {
  let query = collectionWithWorkspace("form_executions", params.workspaceId);
  if (params.formProjectId) {
    query = query.where("form_project_id", "==", params.formProjectId);
  }
  if (params.status) {
    query = query.where("status", "==", params.status);
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

export async function getFormTemplateById(templateId: string) {
  const snap = await checklistDbAdmin.collection("form_templates").doc(templateId).get();
  if (!snap.exists) return null;

  return {
    id: snap.id,
    ...((serializeFormValue(snap.data()) as Record<string, unknown>) ?? {}),
  } as FormTemplate;
}

export async function getFormTypeById(typeId: string) {
  const snap = await checklistDbAdmin.collection("form_types").doc(typeId).get();
  if (!snap.exists) return null;

  return {
    id: snap.id,
    ...((serializeFormValue(snap.data()) as Record<string, unknown>) ?? {}),
  } as FormType;
}

export async function getFormSubtypeById(subtypeId: string) {
  const snap = await checklistDbAdmin.collection("form_subtypes").doc(subtypeId).get();
  if (!snap.exists) return null;

  return {
    id: snap.id,
    ...((serializeFormValue(snap.data()) as Record<string, unknown>) ?? {}),
  } as FormSubtype;
}

export async function getFormExecutionById(executionId: string) {
  const snap = await checklistDbAdmin.collection("form_executions").doc(executionId).get();
  if (!snap.exists) return null;

  const eventsSnap = await snap.ref.collection("events").orderBy("timestamp", "desc").limit(20).get();

  return {
    execution: {
      id: snap.id,
      ...((serializeFormValue(snap.data()) as Record<string, unknown>) ?? {}),
    } as FormExecution,
    events: eventsSnap.docs.map((doc) => ({
      id: doc.id,
      ...((serializeFormValue(doc.data()) as Record<string, unknown>) ?? {}),
    })),
  };
}
