import { FieldPath } from "firebase-admin/firestore";
import { dbAdmin } from "@/lib/firebase-admin";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import type { ServerUserContext } from "@/lib/auth-server";
import { assertEmployeeUnitAccess } from "@/features/hr/lib/employee-document-access-server";
import { serializeHrValue } from "@/features/hr/lib/server-access";
import { emptyDimensions, type CentralHistoryEntry, type CentralWorkItem } from "./types";

export type DocumentProcessSource = "vacation" | "termination";
export function canViewDocumentProcess(actor: ServerUserContext, source: DocumentProcessSource) {
  if (actor.isDefaultAdmin) return true;
  if (actor.permissions.dp?.collaborators?.ownProfileOnly) return false;
  return source === "vacation" ? actor.permissions.dp?.vacation?.viewAll === true
    : Boolean(actor.permissions.settings?.manageUsers || actor.permissions.dp?.collaborators?.edit || actor.permissions.dp?.collaborators?.terminate || actor.permissions.dp?.view || actor.permissions.dp?.collaborators?.view);
}
export async function documentProcessPage(actor: ServerUserContext, source: DocumentProcessSource, limit: number, cursor?: string) {
  if (!canViewDocumentProcess(actor, source)) return null;
  const collection = source === "vacation" ? dbAdmin.collection("dp_vacations") : hrDbAdmin.collection("terminationProcesses");
  let query = collection.orderBy(FieldPath.documentId());
  if (cursor) query = query.startAfter(cursor);
  const snapshot = await query.limit(limit + 1).get();
  const records: Array<Record<string, unknown> & { id: string }> = snapshot.docs.slice(0, limit).map((doc) => ({ ...serializeHrValue(doc.data()) as Record<string, unknown>, id: doc.id }));
  const permitted = new Map<string, Promise<boolean>>();
  const allowed = await Promise.all(records.map(async (record) => {
    if (record.workspaceId && record.workspaceId !== actor.workspace_id) return false;
    const person = source === "vacation" ? record.userId : record.employeeId;
    if (typeof person !== "string" || !person) return false;
    if (!permitted.has(person)) permitted.set(person, assertEmployeeUnitAccess(actor, person).then(() => true, () => false));
    return permitted.get(person);
  }));
  return { records: records.filter((_, index) => allowed[index]), nextCursor: snapshot.size > limit ? snapshot.docs[limit - 1].id : undefined };
}
function text(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function obj(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function processValues(record: Record<string, unknown> & { id: string }, source: DocumentProcessSource) {
  const workflow = source === "vacation" ? obj(record.workflow) : record;
  const status = text(workflow.status) ?? text(record.status) ?? "unknown";
  const steps = Array.isArray(workflow.steps) ? workflow.steps.map(obj) : [];
  const terminal = ["completed", "cancelled", "closed", "REJECTED", "CANCELLED"].includes(status);
  const pending = steps.filter((step) => !["completed", "skipped", "waived", "not_applicable", "cancelled"].includes(String(step.status))).map((step) => text(step.label) ?? text(step.id) ?? "Etapa pendente");
  return { status, terminal, pending, title: source === "vacation" ? "Processo de férias" : "Processo de desligamento", subject: text(record.employeeName) ?? text(record.userName),
    href: source === "vacation" ? `/dashboard/dp/ferias/${encodeURIComponent(String(record.userId))}?vacation=${encodeURIComponent(record.id)}` : `/dashboard/dp/terminations/${encodeURIComponent(record.id)}`,
    updatedAt: text(record.updatedAt) ?? text(record.createdAt), stage: text(workflow.currentStage) };
}
export function documentProcessWorkItem(record: Record<string, unknown> & { id: string }, source: DocumentProcessSource): CentralWorkItem | null {
  const value = processValues(record, source);
  if (value.terminal) return null;
  return { id: `${source}:flow:${record.id}`, source, tab: "flows", documentRef: null, processRef: { source, processId: record.id, stage: value.stage }, title: value.title, subject: value.subject,
    status: value.status, statusLabel: "Processo em andamento", detail: value.pending.length ? "Confira os requisitos e documentos na origem." : "A origem mantém o controle das etapas deste processo.",
    updatedAt: value.updatedAt, href: value.href, actionLabel: "Abrir processo", missingFields: value.pending,
    dimensions: { ...emptyDimensions(), preparation: "pending", archiving: "pending" }, metadata: {} };
}
export function documentProcessHistory(record: Record<string, unknown> & { id: string }, source: DocumentProcessSource): CentralHistoryEntry | null {
  const value = processValues(record, source);
  if (!value.terminal) return null;
  return { id: `${source}:${record.id}`, source, recordKind: "current_snapshot", occurredAt: value.updatedAt, eventLabel: value.status === "REJECTED" ? "Processo recusado" : value.status.toLowerCase() === "cancelled" ? "Processo cancelado" : "Processo concluído", title: value.title, subject: value.subject,
    originalName: null, appliedName: null, destination: null, statusLabel: value.status, actorName: null, analysisMethod: null, href: value.href, detail: "Estado atual do processo; consulte os documentos e eventos na origem." };
}
