import type {
  DPChecklistExecution,
  DPChecklistTemplate,
  DPChecklistType,
  JobFunction,
  JobRole,
  OperationalTask,
} from "@/types";
import { dbAdmin } from "@/lib/firebase-admin";
import { checklistDbAdmin } from "@/lib/firebase-checklist-admin";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { serializeChecklistValue } from "@/features/dp-checklists/lib/server-access";

export type ChecklistActor = {
  userId: string;
  username: string;
  email: string | null;
};

export async function loadChecklistActor(userId: string): Promise<ChecklistActor> {
  const userSnap = await dbAdmin.collection("users").doc(userId).get();
  const userData = userSnap.data() ?? {};

  return {
    userId,
    username:
      typeof userData.username === "string" && userData.username.trim()
        ? userData.username
        : userId,
    email: typeof userData.email === "string" ? userData.email : null,
  };
}

export async function loadChecklistReferenceData() {
  const [unitsSnap, shiftDefsSnap, rolesSnap, functionsSnap] = await Promise.all([
    dbAdmin.collection("dp_units").orderBy("name").get(),
    dbAdmin.collection("dp_shiftDefinitions").orderBy("name").get(),
    hrDbAdmin.collection("jobRoles").orderBy("name").get(),
    hrDbAdmin.collection("jobFunctions").orderBy("name").get(),
  ]);

  const unitNameById = new Map<string, string>();
  unitsSnap.docs.forEach((doc) => {
    const data = doc.data() ?? {};
    unitNameById.set(
      doc.id,
      typeof data.name === "string" && data.name.trim() ? data.name : doc.id
    );
  });

  const shiftDefinitionNameById = new Map<string, string>();
  shiftDefsSnap.docs.forEach((doc) => {
    const data = doc.data() ?? {};
    shiftDefinitionNameById.set(
      doc.id,
      typeof data.name === "string" && data.name.trim() ? data.name : doc.id
    );
  });

  const roleNameById = new Map<string, string>();
  rolesSnap.docs.forEach((doc) => {
    const data = doc.data() ?? {};
    roleNameById.set(
      doc.id,
      typeof data.name === "string" && data.name.trim() ? data.name : doc.id
    );
  });

  const functionNameById = new Map<string, string>();
  functionsSnap.docs.forEach((doc) => {
    const data = doc.data() ?? {};
    functionNameById.set(
      doc.id,
      typeof data.name === "string" && data.name.trim() ? data.name : doc.id
    );
  });

  return {
    unitNameById,
    shiftDefinitionNameById,
    roleNameById,
    functionNameById,
    units: unitsSnap.docs.map((doc) => ({
      id: doc.id,
      ...((serializeChecklistValue(doc.data()) as Record<string, unknown>) ?? {}),
    })),
    shiftDefinitions: shiftDefsSnap.docs.map((doc) => ({
      id: doc.id,
      ...((serializeChecklistValue(doc.data()) as Record<string, unknown>) ?? {}),
    })),
    roles: rolesSnap.docs.map((doc) => ({
      id: doc.id,
      ...((serializeChecklistValue(doc.data()) as Record<string, unknown>) ?? {}),
    })) as JobRole[],
    functions: functionsSnap.docs.map((doc) => ({
      id: doc.id,
      ...((serializeChecklistValue(doc.data()) as Record<string, unknown>) ?? {}),
    })) as JobFunction[],
  };
}

export function normalizeChecklistTemplateForApi(
  id: string,
  data: Record<string, unknown>
) {
  return {
    id,
    ...((serializeChecklistValue(data) as Record<string, unknown>) ?? {}),
  } as DPChecklistTemplate;
}

export function normalizeChecklistExecutionForApi(
  id: string,
  data: Record<string, unknown>
) {
  return {
    id,
    ...((serializeChecklistValue(data) as Record<string, unknown>) ?? {}),
  } as DPChecklistExecution;
}

export function normalizeOperationalTaskForApi(
  id: string,
  data: Record<string, unknown>
) {
  return {
    id,
    ...((serializeChecklistValue(data) as Record<string, unknown>) ?? {}),
  } as OperationalTask;
}

export function normalizeChecklistTypeForApi(
  id: string,
  data: Record<string, unknown>
) {
  return {
    id,
    ...((serializeChecklistValue(data) as Record<string, unknown>) ?? {}),
  } as DPChecklistType;
}

export async function appendChecklistAudit(
  event: string,
  payload: Record<string, unknown>
) {
  await dbAdmin.collection("actionLogs").add({
    module: "checklists",
    event,
    createdAt: new Date().toISOString(),
    ...payload,
  });
}

export { checklistDbAdmin };
