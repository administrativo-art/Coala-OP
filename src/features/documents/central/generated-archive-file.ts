import { assertHistoricalGeneratedSource } from "@/features/privacy/signature-person-history";
import { isGeneratedSigned } from "./archive-source-folders";

type Data = Record<string, unknown>;
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;

export class GeneratedArchiveFileError extends Error {
  constructor(readonly reason: "unavailable" | "incomplete_signature") { super(reason); }
}

/** Explicit signed-pdf never falls back to prepared bytes; pdf/docx preserve their original meaning. */
export function generatedFileReference(id: string, record: Data, format: "pdf" | "docx" | "signed-pdf") {
  if (record.status === "discarded" || record.archiveStatus === "disposed" || record.deletedAt) throw new GeneratedArchiveFileError("unavailable");
  const signed = format === "signed-pdf";
  if (signed && !isGeneratedSigned(record.signatureStatus)) throw new GeneratedArchiveFileError("incomplete_signature");
  const path = text(record[signed ? "signedStoragePath" : format === "pdf" ? "pdfStoragePath" : "storagePath"]);
  const hash = signed ? text(record.signedHash) : null;
  const requestId = signed ? text(record.signatureRequestId) : null;
  if (signed && (!path || !hash || !/^[a-f0-9]{64}$/i.test(hash) || !requestId || requestId.includes("/")
    || !path.startsWith(`signed-documents/generated/${id}/${requestId}/`))) throw new GeneratedArchiveFileError("incomplete_signature");
  if (!path) throw new GeneratedArchiveFileError("unavailable");
  return { path, hash, requestId, signed };
}

export function assertGeneratedSignedReference(id: string, generated: Data, request: Data) {
  try {
    assertHistoricalGeneratedSource(request, id, generated);
    if (!isGeneratedSigned(request.status) || request.signedStoragePath !== generated.signedStoragePath
      || request.signedHash !== generated.signedHash || (request.preSignatureHash ?? null) !== (generated.preSignatureHash ?? null)) throw new Error("divergent");
  } catch {
    throw new GeneratedArchiveFileError("incomplete_signature");
  }
}
