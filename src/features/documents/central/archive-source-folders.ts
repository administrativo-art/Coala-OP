import type { PermissionSet } from "@/types";
import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";
import type { UnitAccessUser } from "@/lib/unit-access";
import { CONTEXT_ARCHIVE_FOLDERS, canViewContextArchive, isContextArchiveSource } from "./context-archive-access";

/** Source folders always point at the authoritative records, including legacy records. */
export const ARCHIVE_SOURCE_FOLDERS = {
  generated: { label: "Documentos gerados", permission: "documents.view" },
  editor: { label: "Documentos do editor", permission: "documents.generate" },
  received: { label: "Recebidos a classificar", permission: "documents.view" },
  ...CONTEXT_ARCHIVE_FOLDERS,
} as const;

export type ArchiveFolderSource = keyof typeof ARCHIVE_SOURCE_FOLDERS;
export function canViewArchiveSource(source: ArchiveFolderSource, permissions: PermissionSet, isDefaultAdmin: boolean, userDoc: UnitAccessUser = {}) {
  if (isContextArchiveSource(source)) return canViewContextArchive(source, { permissions, isDefaultAdmin, userDoc });
  return hasFormalizationPermission(permissions, ARCHIVE_SOURCE_FOLDERS[source].permission, isDefaultAdmin);
}

export function isArchiveFolderSource(value: unknown): value is ArchiveFolderSource {
  return typeof value === "string" && Object.hasOwn(ARCHIVE_SOURCE_FOLDERS, value);
}

export function archiveSourceHref(source: ArchiveFolderSource, documentId?: string) {
  return `/dashboard/documents/archive?source=${source}${documentId ? `&document=${encodeURIComponent(documentId)}` : ""}`;
}

export type GeneratedArchiveRecord = Record<string, unknown> & { id: string };
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
export function isGeneratedSigned(value: unknown) { return value === "signed" || value === "archived"; }

/** Explicit public projection: no Storage paths, manual fields, identities or signature contacts. */
export function generatedArchiveEntry(record: GeneratedArchiveRecord, workspaceId?: string) {
  if (record.status === "discarded" || record.archiveStatus === "disposed" || record.deletedAt) return null;
  if (record.workspaceId != null && record.workspaceId !== workspaceId) return null;
  const signed = isGeneratedSigned(record.signatureStatus);
  const signedReady = Boolean(text(record.signedStoragePath) && text(record.signedHash) && text(record.signatureRequestId));
  return {
    id: record.id,
    title: text(record.templateName) ?? text(record.originalName) ?? "Documento gerado",
    protocol: text(record.protocol),
    status: text(record.status),
    signatureStatus: text(record.signatureStatus),
    updatedAt: text(record.signedAt) ?? text(record.generatedAt) ?? text(record.createdAt),
    pdfAvailable: signed ? signedReady : Boolean(text(record.pdfStoragePath)),
    signed,
    // Even an incomplete signature keeps a visible entry; the file route rejects missing evidence.
    signaturePendingArchive: signed && !signedReady,
    folder: ARCHIVE_SOURCE_FOLDERS.generated.label,
  };
}

/** Pagination advances over raw records, even when all visible records were discarded. */
export function generatedArchivePage(records: GeneratedArchiveRecord[], limit: number, workspaceId?: string) {
  return {
    items: records.slice(0, limit).map((record) => generatedArchiveEntry(record, workspaceId)).filter((item) => item !== null),
    nextCursor: records.length > limit ? records[limit - 1].id : null,
  };
}
