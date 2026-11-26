import "server-only";
import { admissionArchivePage, readAdmissionArchiveFile } from "./admission-archive.server";
import { createHash } from "node:crypto";
import { FieldPath, type Query, type DocumentSnapshot } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { adminApp, dbAdmin } from "@/lib/firebase-admin";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { repPDbAdmin } from "@/lib/firebase-rep-p-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import type { ServerUserContext } from "@/lib/auth-server";
import { canAccessUnit } from "@/lib/unit-access";
import { assertEmployeeUnitAccess } from "@/features/hr/lib/employee-document-access-server";
import { serializeHrValue } from "@/features/hr/lib/server-access";
import { getOwnRepPReceipt } from "@/features/dp/rep-p/service.server";
import { AppError } from "@/lib/observability/app-error";
import { contextFileReference } from "./context-archive-reference";
import { CONTEXT_ARCHIVE_FOLDERS, contextWorkspaceAllowed, managesUniformArchive, type ContextArchiveSource } from "./context-archive-access";

const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const idPattern = /^[^/\\\u0000]{1,256}$/;
const fail = () => new AppError({ code: "ARCHIVE_SOURCE_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Documento indisponível para seu acesso." });
const invalidCursor = () => new AppError({ code: "ARCHIVE_SOURCE_CURSOR_INVALID", kind: "VALIDATION", safeMessage: "Página de documentos inválida." });
type Position = { source: ContextArchiveSource; id: string };
function decode(source: ContextArchiveSource, cursor?: string): Position | null {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString());
    if (value.v !== 1 || value.source !== source || typeof value.id !== "string" || Object.keys(value).some((key) => !["v", "source", "id"].includes(key))) throw invalidCursor();
    const parts = value.id.split("/");
    if (source === "aso" || source === "accountant") {
      // This is only a collection-group ordering anchor, never a resource permission.
      if (parts.length % 2 || parts.length > 20 || parts.at(-2) !== "generatedDocuments" || !parts.every((part: string) => idPattern.test(part) && part !== "." && part !== "..")) throw invalidCursor();
    } else if (!idPattern.test(value.id) || value.id === "." || value.id === "..") throw invalidCursor();
    return value;
  } catch { throw invalidCursor(); }
}
const encode = (position: Position) => Buffer.from(JSON.stringify({ v: 1, ...position })).toString("base64url");
function data(snapshot: DocumentSnapshot) { return object(serializeHrValue(snapshot.data())); }
function fileUrl(source: ContextArchiveSource, id: string, parent?: string) {
  return `/api/documents/archive/sources/${source}/file?${new URLSearchParams({ id, ...(parent ? { parent } : {}) })}`;
}
type Item = { id: string; title: string; updatedAt: string | null; pdfAvailable: boolean; mimeType: string; fileUrl: string; description: string; available?: boolean; href?: string };
const kindAllowed = (source: ContextArchiveSource, record: Record<string, unknown>) => source === "aso"
  ? ["aso_admission_referral", "aso_dismissal_referral"].includes(String(record.kind)) : record.kind === "accountant_admission_form";
function processAllowed(actor: ServerUserContext, record: Record<string, unknown>) {
  return !record.documentDiscard && record.status !== "cancelled" && contextWorkspaceAllowed(record, actor.workspace_id, actor.isDefaultAdmin)
    && canAccessUnit(actor.userDoc, text(record.unitId), { isDefaultAdmin: actor.isDefaultAdmin });
}
async function uniformAllowed(actor: ServerUserContext, record: Record<string, unknown>) {
  if (!contextWorkspaceAllowed(record, actor.workspace_id, false)) return false;
  const employeeId = text(record.collaboratorUserId);
  if (!employeeId) return false;
  if (employeeId === actor.decoded.uid || employeeId === actor.userDoc.id) return true;
  if (!managesUniformArchive(actor)) return false;
  return assertEmployeeUnitAccess(actor, employeeId).then(() => true, () => false);
}

/** Page eligible versions directly; validate at most 25 distinct process parents before exposing metadata. */
async function admissionPage(source: "aso" | "accountant", actor: ServerUserContext, limit: number, position: Position | null) {
  const kinds = source === "aso" ? ["aso_admission_referral", "aso_dismissal_referral"] : ["accountant_admission_form"];
  let query = hrDbAdmin.collectionGroup("generatedDocuments").where("kind", "in", kinds).orderBy(FieldPath.documentId());
  if (position) query = query.startAfter(hrDbAdmin.doc(position.id));
  const page = await query.select("kind", "fileName", "generatedAt", "storagePath", "hashSha256").limit(limit + 1).get();
  const records = page.docs.slice(0, limit).filter((doc) => {
    const parts = doc.ref.path.split("/");
    return parts.length === 4 && parts[0] === "onboardingProcesses" && parts[2] === "generatedDocuments";
  });
  const parents = [...new Set(records.map((doc) => doc.ref.parent.parent!.path))];
  const snapshots = parents.length ? await hrDbAdmin.getAll(...parents.map((path) => hrDbAdmin.doc(path)), { fieldMask: ["workspaceId", "unitId", "status", "documentDiscard"] }) : [];
  const allowed = new Set(snapshots.filter((parent) => parent.exists && processAllowed(actor, parent.data() ?? {})).map((parent) => parent.ref.path));
  const items: Item[] = records.flatMap((doc) => {
    const parent = doc.ref.parent.parent!;
    if (!allowed.has(parent.path)) return [];
    const record = data(doc);
    if (!text(record.storagePath)) return [];
    const reference = contextFileReference(source, doc.id, record, { workspaceId: actor.workspace_id, parentId: parent.id });
    return [{ id: `${parent.id}:${doc.id}`, title: text(record.fileName) ?? CONTEXT_ARCHIVE_FOLDERS[source].label,
      updatedAt: text(record.generatedAt), pdfAvailable: Boolean(reference), available: Boolean(reference), mimeType: "application/pdf",
      fileUrl: fileUrl(source, doc.id, parent.id), href: `/dashboard/hr/recruitment/integration?process=${encodeURIComponent(parent.id)}`,
      description: reference ? "Versão preservada no processo de admissão" : "Arquivamento requer conferência na origem" }];
  });
  return { items, nextCursor: page.size > limit ? encode({ source, id: page.docs[limit - 1].ref.path }) : null };
}

export async function contextArchivePage(source: ContextArchiveSource, actor: ServerUserContext, limit: number, cursor?: string, mine = false, parentId?: string) {
  if (source === "admissionUploads") return admissionArchivePage(actor, limit, cursor, parentId);
  const position = decode(source, cursor);
  if (source === "aso" || source === "accountant") return admissionPage(source, actor, limit, position);
  let query: Query;
  if (source === "paymentProof") {
    query = financialDbAdmin.collection("bankPaymentRequests");
    if (!actor.isDefaultAdmin) query = query.where("workspaceId", "==", actor.workspace_id);
    query = query.select("workspaceId", "description", "paidAt", "createdAt", "proofStoragePath");
  } else if (source === "uniforms") {
    query = dbAdmin.collection("uniformTransactions").where("workspaceId", "==", actor.workspace_id);
    if (mine || !managesUniformArchive(actor)) query = query.where("collaboratorUserId", "==", actor.decoded.uid);
    query = query.select("workspaceId", "collaboratorUserId", "occurredAt", "createdAt", "term.storagePath", "term.fileName", "term.contentHash", "term.archiveStatus");
  } else if (source === "receipts" || source === "pilotReceipts") {
    query = (source === "receipts" ? repPDbAdmin.collection("repP_receipts") : hrDbAdmin.collection("repP_pilotMarkings")).where("workspaceId", "==", actor.workspace_id).where("employeeId", "==", actor.decoded.uid)
      .select("filename", "recordedDate", "status", "issuedAt"); // Never load the PDF blob/CPF during listing.
  } else {
    query = (source === "afd" ? repPDbAdmin.collection("repP_exportAudit") : hrDbAdmin.collection("ptrp_aejExports"))
      .where("workspaceId", "==", actor.workspace_id).select("workspaceId", "generatedAt", "filename", "status", "artifacts.bundle", "establishmentId");
  }
  query = query.orderBy(FieldPath.documentId());
  if (position) query = query.startAfter(position.id);
  const page = await query.limit(limit + 1).get();
  const items: Item[] = [];
  const uniformAccess = new Map<string, Promise<boolean>>();
  for (const doc of page.docs.slice(0, limit)) {
    const record = data(doc);
    if (source === "paymentProof" && (!contextWorkspaceAllowed(record, actor.workspace_id, actor.isDefaultAdmin) || !text(record.proofStoragePath))) continue;
    if (source === "uniforms") {
      const person = text(record.collaboratorUserId) ?? "";
      if (!uniformAccess.has(person)) uniformAccess.set(person, uniformAllowed(actor, record));
      if (!text(object(record.term).storagePath) || !await uniformAccess.get(person)) continue;
    }
    if ((source === "receipts" || source === "pilotReceipts") && record.status !== "issued") continue;
    if ((source === "afd" || source === "aej") && !text(object(object(record.artifacts).bundle).storagePath)) continue;
    const zip = source === "afd" || source === "aej";
    const title = source === "paymentProof" ? text(record.description) ?? "Comprovante de pagamento" : source === "uniforms" ? text(object(record.term).fileName) ?? "Termo de uniforme" : text(record.filename) ?? CONTEXT_ARCHIVE_FOLDERS[source].label;
    const reference = (source === "receipts" || source === "pilotReceipts") ? null : contextFileReference(source, doc.id, record, { workspaceId: actor.workspace_id, fiscalBucket: process.env.REP_P_FISCAL_STORAGE_BUCKET?.trim() });
    const available = source === "receipts" || source === "pilotReceipts" || Boolean(reference);
    items.push({ id: doc.id, available, title: zip ? `${title}.zip` : title, updatedAt: text(record.paidAt) ?? text(record.generatedAt) ?? text(record.issuedAt) ?? text(record.occurredAt) ?? text(record.createdAt), pdfAvailable: !zip && available, mimeType: zip ? "application/zip" : "application/pdf", fileUrl: fileUrl(source, doc.id), description: available ? CONTEXT_ARCHIVE_FOLDERS[source].label : "Arquivamento requer conferência na origem" });
  }
  return { items, nextCursor: page.size > limit ? encode({ source, id: page.docs[limit - 1].id }) : null };
}

export async function readContextArchiveFile(source: ContextArchiveSource, actor: ServerUserContext, id: string, parentId?: string) {
  if (source === "admissionUploads") return readAdmissionArchiveFile(actor, id, parentId);
  if (source === "receipts" || source === "pilotReceipts") {
    if (source === "receipts" && id.startsWith("pilot_") || source === "pilotReceipts" && !id.startsWith("pilot_")) throw fail();
    const receipt = await getOwnRepPReceipt(actor, id);
    return { bytes: receipt.bytes, filename: receipt.filename, mimeType: "application/pdf" };
  }
  let record: Record<string, unknown>;
  if (source === "aso" || source === "accountant") {
    if (!parentId) throw fail();
    const parent = await hrDbAdmin.collection("onboardingProcesses").doc(parentId).get();
    if (!parent.exists || !processAllowed(actor, parent.data() ?? {})) throw fail();
    const doc = await parent.ref.collection("generatedDocuments").doc(id).get();
    record = doc.data() ?? {};
    if (!doc.exists || !kindAllowed(source, record)) throw fail();
  } else if (source === "paymentProof") {
    const doc = await financialDbAdmin.collection("bankPaymentRequests").doc(id).get();
    record = doc.data() ?? {};
    if (!doc.exists || !contextWorkspaceAllowed(record, actor.workspace_id, actor.isDefaultAdmin)) throw fail();
  } else if (source === "uniforms") {
    const doc = await dbAdmin.collection("uniformTransactions").doc(id).get();
    record = doc.data() ?? {};
    if (!doc.exists || !await uniformAllowed(actor, record)) throw fail();
  } else {
    const doc = await (source === "afd" ? repPDbAdmin.collection("repP_exportAudit") : hrDbAdmin.collection("ptrp_aejExports")).doc(id).get();
    record = doc.data() ?? {};
    if (!doc.exists || record.workspaceId !== actor.workspace_id) throw fail();
  }
  const stored = contextFileReference(source, id, record, { workspaceId: actor.workspace_id, parentId, fiscalBucket: process.env.REP_P_FISCAL_STORAGE_BUCKET?.trim() });
  if (!stored) throw fail();
  const file = getStorage(adminApp).bucket(stored.bucket ?? firebaseClientConfig.storageBucket).file(stored.path, stored.generation ? { generation: stored.generation } : undefined);
  const [bytes] = await file.download();
  if (stored.hash && createHash("sha256").update(bytes).digest("hex") !== stored.hash || stored.size !== undefined && bytes.byteLength !== stored.size || stored.mimeType === "application/pdf" && bytes.subarray(0, 4).toString() !== "%PDF" || stored.mimeType === "application/zip" && bytes.subarray(0, 4).toString("hex") !== "504b0304") throw new AppError({ code: "ARCHIVE_SOURCE_INTEGRITY_FAILED", kind: "DATA_INTEGRITY", safeMessage: "Não foi possível conferir a integridade do documento arquivado." });
  return { bytes, filename: stored.filename, mimeType: stored.mimeType };
}
