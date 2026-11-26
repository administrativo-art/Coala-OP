import "server-only";
import { createHash } from "node:crypto";
import { confirmedOnboardingPublicPrefix } from "@/lib/hr/onboarding-upload-scope.server";
import { admissionArchiveReady } from "@/lib/hr/admission-archive-lifecycle.server";
import { FieldPath, type Query } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { adminApp } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import type { ServerUserContext } from "@/lib/auth-server";
import { serializeHrValue, type HrAccess } from "@/features/hr/lib/server-access";
import { canAccessUnit } from "@/lib/unit-access";
import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";
import { onboardingDocumentTypeCode } from "@/lib/hr/onboarding-document-classification";
import { getDocumentTypeConfig } from "@/lib/hr/employee-document-catalog";
import { canAccessDocument } from "@/lib/hr/employee-document-access";
import { loadEmployeeDocumentAccessSettings, buildEmployeeDocumentAccessSubject } from "@/features/hr/lib/employee-document-access-server";
import { contextWorkspaceAllowed } from "./context-archive-access";
import { AppError } from "@/lib/observability/app-error";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const safeId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256 && !/[/\\\u0000]/.test(value) && ![".", ".."].includes(value);
const validHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
const unavailable = () => new AppError({ code: "ADMISSION_ARCHIVE_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Documento indisponível para seu acesso." });
const invalidPage = () => new AppError({ code: "ADMISSION_ARCHIVE_CURSOR_INVALID", kind: "VALIDATION", safeMessage: "Página de anexos inválida." });
type Family = "parents" | "slots" | "aso" | "registry";
type Position = { family: Family; id: string };
function decode(cursor: string | undefined, parent: string | undefined): Position | null {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString());
    if (value.v !== 1 || value.parent !== (parent ?? "") || !["parents", "slots", "aso", "registry"].includes(value.family) || typeof value.id !== "string" || value.id.length > 1100 || /[\\\u0000]/.test(value.id) || ["parents", "slots"].includes(value.family) && value.id && !safeId(value.id)) throw invalidPage();
    if (!parent && value.family !== "parents" || parent && value.family === "parents") throw invalidPage();
    return value;
  } catch { throw invalidPage(); }
}
const encode = (position: Position, parent: string | undefined) => Buffer.from(JSON.stringify({ v: 1, parent: parent ?? "", ...position })).toString("base64url");
function allowedProcess(actor: ServerUserContext, process: Record<string, unknown>) {
  return contextWorkspaceAllowed(process, actor.workspace_id, actor.isDefaultAdmin) && canAccessUnit(actor.userDoc, text(process.unitId), { isDefaultAdmin: actor.isDefaultAdmin });
}
const slotsOf = (process: Record<string, unknown>) => Array.isArray(process.documents) ? process.documents.map(object).filter((slot) => safeId(slot.id)) : [];
function accessContext(actor: ServerUserContext) {
  const access: HrAccess = { ...actor, workspaceId: actor.workspace_id, actorName: "", canView: true, canManageCatalog: false, lookupError: null };
  return loadEmployeeDocumentAccessSettings(access).then((settings) => ({
    settings, subject: buildEmployeeDocumentAccessSubject(access, settings, ""), // A candidate slot is never inferred to be the internal actor.
  }));
}
function permitted(actor: ServerUserContext, family: Family, slot: Record<string, unknown> | null, process: Record<string, unknown>, context: Awaited<ReturnType<typeof accessContext>>) {
  const action = family === "aso" ? "aso.view" : family === "registry" ? "accountant.view" : "view";
  if (!hasFormalizationPermission(actor.permissions, action, actor.isDefaultAdmin)) return false;
  const code = family === "aso" ? process.asoExamType === "dismissal" ? "ASO_DISMISSAL" : "ASO_ADMISSION" : family === "registry" ? "EMPLOYEE_REGISTRATION" : onboardingDocumentTypeCode({ id: String(slot?.id ?? ""), label: String(slot?.label ?? ""), documentTypeCode: text(slot?.documentTypeCode) ?? undefined });
  const config = getDocumentTypeConfig(code);
  return canAccessDocument({ documentTypeCode: config.code, category: config.category, accessLevel: config.defaultAccessLevel }, context.subject, context.settings.visibilityConfig).allowed;
}
const url = (source: string, parent: string, id: string) => `/api/documents/archive/sources/${source}/file?${new URLSearchParams({ parent, id })}`;
function prefix(process: Record<string, unknown>, parent: string, family: Family) {
  if (family === "aso") return `hr/onboarding/${parent}/aso/returned/`;
  if (family === "registry") return `hr/onboarding/${parent}/accountant/registry/`;
  const token = text(process.publicToken);
  return token && /^[A-Za-z0-9_-]+$/.test(token) ? `hr/onboarding/${token}/` : null;
}
const bucket = () => getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
type Reference = { path: string; hash: string; name: string; mime: string; generation?: string; metadataSlot?: string };
async function slotReference(actor: ServerUserContext, parent: string, process: Record<string, unknown>, slot: Record<string, unknown>): Promise<Reference | null> {
  if (!validHash(slot.fileHashSha256)) return null;
  const path = text(slot.filePath);
  const base = path ? await confirmedOnboardingPublicPrefix(parent, process, path) : null;
  if (!base || !path?.startsWith(base) || !safeId(path.slice(base.length))) return null;
  const [metadata] = await bucket().file(path).getMetadata().catch(() => [null]);
  if (!metadata || metadata.metadata?.onboardingDocumentId !== slot.id && !(actor.isDefaultAdmin && !metadata.metadata?.onboardingDocumentId)) return null;
  return { path, hash: String(slot.fileHashSha256).toLowerCase(), name: String(metadata.metadata?.originalName ?? slot.label ?? "Documento"), mime: String(metadata.contentType ?? "application/octet-stream"), generation: String(metadata.generation), metadataSlot: String(slot.id) };
}

/** Parent folders are paginated; object inventories are read only after opening an authorized process. */
export async function admissionArchivePage(actor: ServerUserContext, limit: number, cursor?: string, parent?: string) {
  const position = decode(cursor, parent);
  const source = "admissionUploads";
  if (!parent) {
    let query: Query = hrDbAdmin.collection("onboardingProcesses");
    if (!actor.isDefaultAdmin) query = query.where("workspaceId", "==", actor.workspace_id);
    query = query.orderBy(FieldPath.documentId());
    if (position?.id) query = query.startAfter(position.id);
    const page = await query.select("workspaceId", "unitId", "candidateName", "createdAt", "status", "currentStage", "completedAt", "employmentRelationshipType", "pjWorkflow.contract", "pjWorkflow.steps.provider_activation").limit(limit + 1).get();
    const eligible = [];
    for (const doc of page.docs.slice(0, limit)) if (allowedProcess(actor, doc.data()) && await admissionArchiveReady(doc.id, doc.data())) eligible.push(doc);
    return { items: eligible.map((doc) => ({ id: doc.id, title: text(doc.get("candidateName")) ?? "Processo de admissão", folder: true, href: `/dashboard/documents/archive?${new URLSearchParams({ source, parent: doc.id })}`, description: "Pasta do processo de admissão" })), nextCursor: page.size > limit ? encode({ family: "parents", id: page.docs[limit - 1].id }, undefined) : null };
  }
  const snapshot = await hrDbAdmin.collection("onboardingProcesses").doc(parent).get();
  const process = snapshot.data() ?? {};
  if (!snapshot.exists || !allowedProcess(actor, process) || !await admissionArchiveReady(parent, process)) throw unavailable();
  const context = await accessContext(actor);
  const family: Family = position?.family ?? "slots";
  const folderLabel = text(process.candidateName) ?? "Processo de admissão";
  if (family === "slots") {
    const slots = slotsOf(process).filter((slot) => text(slot.filePath)).sort((a, b) => String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
    const page = slots.filter((slot) => !position?.id || String(slot.id) > position.id).slice(0, limit + 1);
    const items = [];
    for (const slot of page.slice(0, limit)) {
      if (!permitted(actor, family, slot, process, context)) continue;
      const reference = await slotReference(actor, parent, process, slot);
      const serialized = object(serializeHrValue(slot));
      items.push({ id: `slot:${slot.id}`, title: String(slot.label ?? "Documento recebido"), available: Boolean(reference), pdfAvailable: reference?.mime === "application/pdf", mimeType: reference?.mime,
        fileUrl: url(source, parent, `slot:${slot.id}`), updatedAt: text(serialized.receivedAt) ?? text(serialized.updatedAt), description: reference ? "Anexo confirmado no formulário" : "Referência do arquivo requer conferência" });
    }
    return { items, folderLabel, nextCursor: page.length > limit ? encode({ family: "slots", id: String(page[limit - 1].id) }, parent) : encode({ family: "aso", id: "" }, parent) };
  }
  const base = prefix(process, parent, family);
  const nextFamily = family === "aso" ? encode({ family: "registry", id: "" }, parent) : null;
  if (!base) return { items: [], folderLabel, nextCursor: nextFamily };
  if (!permitted(actor, family, null, process, context)) return { items: [], folderLabel, nextCursor: nextFamily };
  const [files] = await bucket().getFiles({ prefix: base, startOffset: `${base}${position?.id ?? ""}`, maxResults: limit + 2, autoPaginate: false });
  const page = files.filter((file) => file.name.slice(base.length) !== position?.id).slice(0, limit + 1);
  const items = [];
  for (const file of page.slice(0, limit)) {
    const name = file.name.slice(base.length), metadata = file.metadata;
    if (!safeId(name)) continue; // Never descend into a different artifact family.
    const custom = metadata.metadata ?? {};
    if (custom.onboardingId !== parent || !validHash(custom.hashSha256)) continue;
    const mime = String(metadata.contentType ?? "application/octet-stream");
    items.push({ id: `${family}:${name}`, title: family === "aso" ? "ASO enviado" : "Ficha de registro recebida",
      mimeType: mime, available: true, pdfAvailable: mime === "application/pdf", fileUrl: url(source, parent, `${family}:${name}`), updatedAt: text(metadata.timeCreated) ?? text(metadata.updated),
      description: "Versão enviada ao processo" });
  }
  return { items, folderLabel, nextCursor: page.length > limit ? encode({ family, id: page[limit - 1].name.slice(base.length) }, parent) : nextFamily };
}

export async function readAdmissionArchiveFile(actor: ServerUserContext, id: string, parent: string | undefined) {
  if (!parent) throw unavailable();
  const snapshot = await hrDbAdmin.collection("onboardingProcesses").doc(parent).get();
  const process = snapshot.data() ?? {};
  if (!snapshot.exists || !allowedProcess(actor, process) || !await admissionArchiveReady(parent, process)) throw unavailable();
  const split = id.indexOf(":"), family = id.slice(0, split) as Family | "slot";
  const name = id.slice(split + 1);
  if (split < 1 || !safeId(name) || !["slot", "aso", "registry"].includes(family)) throw unavailable();
  const context = await accessContext(actor);
  let reference: Reference;
  if (family === "slot") {
    const slot = slotsOf(process).find((entry) => entry.id === name);
    if (!slot || !permitted(actor, "slots", slot, process, context)) throw unavailable();
    const found = await slotReference(actor, parent, process, slot);
    if (!found) throw unavailable();
    reference = found;
  } else {
    const base = prefix(process, parent, family);
    if (!base) throw unavailable();
    const path = `${base}${name}`;
    const [metadata] = await bucket().file(path).getMetadata();
    const custom = metadata.metadata ?? {};
    if (!permitted(actor, family, null, process, context) || custom.onboardingId !== parent || !validHash(custom.hashSha256)) throw unavailable();
    reference = { path, hash: String(custom.hashSha256).toLowerCase(), name: String(custom.originalName ?? (family === "aso" ? "ASO enviado" : "Ficha de registro recebida")), mime: String(metadata.contentType ?? "application/octet-stream"), generation: String(metadata.generation) };
  }
  if (!["application/pdf", "image/jpeg", "image/png"].includes(reference.mime)) throw unavailable();
  const [bytes] = await bucket().file(reference.path, reference.generation ? { generation: reference.generation } : undefined).download();
  if (reference.hash && createHash("sha256").update(bytes).digest("hex") !== reference.hash) throw new AppError({ code: "ADMISSION_ARCHIVE_INTEGRITY_FAILED", kind: "DATA_INTEGRITY", safeMessage: "A integridade do anexo não pôde ser confirmada." });
  const extension = reference.mime === "application/pdf" ? "pdf" : reference.mime === "image/png" ? "png" : "jpg";
  return { bytes, mimeType: reference.mime, filename: `${reference.name.replace(/\.[a-z0-9]{1,10}$/i, "")}.${extension}` };
}
