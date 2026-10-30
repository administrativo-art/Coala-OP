import "server-only";

import type { ServerUserContext } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { AppError } from "@/lib/observability/app-error";
import { WORKSPACE_ID } from "@/lib/workspace";

type RegisteredPerson = { type: "user" | "employee"; id?: string; nameSnapshot: string };
type Assignee = { type: "user" | "unit" | "third_party"; id?: string; nameSnapshot: string };

const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
export function workspaceIdentifiers(data: { workspaceId?: unknown; workspace_id?: unknown }) {
  const camel = text(data.workspaceId);
  const snake = text(data.workspace_id);
  return { camel, snake, conflict: Boolean(camel && snake && camel !== snake), effective: camel ?? snake ?? WORKSPACE_ID };
}

const workspaceOf = (value: FirebaseFirestore.DocumentSnapshot) => workspaceIdentifiers({ workspaceId: value.get("workspaceId"), workspace_id: value.get("workspace_id") });

function assertWorkspace(snapshot: FirebaseFirestore.DocumentSnapshot, workspaceId: string, code: string) {
  const identifiers = workspaceOf(snapshot);
  if (identifiers.conflict || identifiers.effective !== workspaceId) throw new AppError({ code, kind: "AUTHORIZATION" });
}

function activeUser(snapshot: FirebaseFirestore.DocumentSnapshot) {
  return snapshot.get("isActive") !== false
    && !["inactive", "terminated", "disabled"].includes(String(snapshot.get("status") ?? "").toLowerCase())
    && String(snapshot.get("employmentStatus") ?? "").toLowerCase() !== "terminated";
}

export async function resolveActiveEmployee(workspaceId: string, employeeId: string) {
  const snapshot = await dbAdmin.collection("users").doc(employeeId).get();
  if (!snapshot.exists || !activeUser(snapshot)) throw new AppError({ code: "ASSET_EMPLOYEE_INVALID", kind: "VALIDATION", safeMessage: "O colaborador não existe ou não está ativo." });
  assertWorkspace(snapshot, workspaceId, "ASSET_EMPLOYEE_SCOPE");
  return { id: snapshot.id, nameSnapshot: text(snapshot.get("username")) ?? text(snapshot.get("name")) ?? "Colaborador" };
}

export async function resolveRegisteredPerformer(workspaceId: string, input: RegisteredPerson | { type: "third_party"; id?: string; nameSnapshot: string }) {
  if (input.type === "third_party") return { type: "third_party" as const, nameSnapshot: input.nameSnapshot.trim() };
  if (!input.id) throw new AppError({ code: "ASSET_PERFORMER_INVALID", kind: "VALIDATION" });
  const person = await resolveActiveEmployee(workspaceId, input.id);
  return { type: input.type, id: person.id, nameSnapshot: person.nameSnapshot };
}

export async function resolveAssetLocation(workspaceId: string, input: { type: string; refId?: string; nameSnapshot: string; details?: string }) {
  if (input.type !== "unit") return input;
  if (!input.refId) throw new AppError({ code: "ASSET_UNIT_INVALID", kind: "VALIDATION" });
  const unit = await dbAdmin.collection("kiosks").doc(input.refId).get();
  if (!unit.exists || unit.get("status") === "inactive") throw new AppError({ code: "ASSET_UNIT_INVALID", kind: "VALIDATION", safeMessage: "A unidade de destino não existe ou está inativa." });
  assertWorkspace(unit, workspaceId, "ASSET_UNIT_SCOPE");
  return { ...input, refId: unit.id, nameSnapshot: text(unit.get("name")) ?? text(unit.get("kioskName")) ?? unit.id };
}

export async function resolveMaintenanceAssignee(context: ServerUserContext, input: Assignee) {
  if (input.type === "third_party") return { type: "third_party" as const, nameSnapshot: input.nameSnapshot.trim() };
  if (!input.id) throw new AppError({ code: "ASSET_ASSIGNEE_INVALID", kind: "VALIDATION" });
  if (input.type === "unit") {
    const location = await resolveAssetLocation(context.workspace_id, { type: "unit", refId: input.id, nameSnapshot: input.nameSnapshot });
    return { type: "unit" as const, id: location.refId, nameSnapshot: location.nameSnapshot };
  }
  const person = await resolveActiveEmployee(context.workspace_id, input.id);
  return { type: "user" as const, id: person.id, nameSnapshot: person.nameSnapshot };
}
