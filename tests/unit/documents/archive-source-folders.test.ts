import assert from "node:assert/strict";
import test from "node:test";
import { archiveSourceHref, generatedArchiveEntry, generatedArchivePage, isArchiveFolderSource } from "../../../src/features/documents/central/archive-source-folders";
import { generatedFileReference, assertGeneratedSignedReference, GeneratedArchiveFileError } from "../../../src/features/documents/central/generated-archive-file";

const hash = "a".repeat(64);
const signedPath = `signed-documents/generated/legacy/request/${hash}/signed.pdf`;
const generated = { id: "legacy", templateName: "Recibo", signatureStatus: "signed", signedStoragePath: signedPath, signedHash: hash, signatureRequestId: "request", pdfStoragePath: "prepared.pdf", storagePath: "original.docx" };

test("gerado legado sem titular tem pasta desde preparação e conserva a mesma entrada ao assinar", () => {
  const draft = generatedArchiveEntry({ id: "legacy", status: "review_pending", employeeId: null, onboardingId: null, parties: [{ name: "Nome não é vínculo" }] });
  assert.equal(draft?.folder, "Documentos gerados");
  const signed = generatedArchiveEntry({ ...generated, employeeId: null, employeeDocumentId: null, archiveStatus: "archived", manualValues: { secret: true }, parties: [{ email: "private@example.test" }] });
  assert.equal(signed?.id, draft?.id);
  assert.equal(signed?.signed, true);
  assert.equal(signed?.pdfAvailable, true);
  assert.equal(JSON.stringify(signed).includes("signed-documents"), false);
  assert.equal(JSON.stringify(signed).includes("secret"), false);
  assert.equal(JSON.stringify(signed).includes("example.test"), false);
});

test("página filtrada vazia mantém continuação e documentos além do limite não ficam inacessíveis", () => {
  assert.deepEqual(generatedArchivePage([{ id: "a", status: "discarded" }, { id: "b", archiveStatus: "disposed" }, { id: "c" }], 2), { items: [], nextCursor: "b" });
  const page = generatedArchivePage([{ id: "c" }], 2);
  assert.equal(page.items[0]?.id, "c");
  assert.equal(page.nextCursor, null);
});

test("assinado incompleto mantém entrada visível e nunca substitui o assinado pelo preparado", () => {
  const incomplete = { ...generated, signedStoragePath: null };
  assert.equal(generatedArchiveEntry(incomplete)?.signaturePendingArchive, true);
  assert.equal(generatedArchiveEntry(incomplete)?.pdfAvailable, false);
  assert.throws(() => generatedFileReference("legacy", incomplete, "signed-pdf"), GeneratedArchiveFileError);
  assert.deepEqual(generatedFileReference("legacy", generated, "signed-pdf"), { path: signedPath, hash, requestId: "request", signed: true });
  assert.equal(generatedFileReference("legacy", generated, "docx").path, "original.docx");
  assert.equal(generatedFileReference("legacy", generated, "pdf").path, "prepared.pdf");
  assert.equal(generatedFileReference("legacy", { ...generated, signatureStatus: "archived" }, "signed-pdf").signed, true);
  assert.equal(generatedArchiveEntry({ ...generated, signatureStatus: "archived" })?.signed, true);
  assert.throws(() => generatedFileReference("another", generated, "signed-pdf"), GeneratedArchiveFileError);
});

test("referência assinada exige mesma solicitação, versão, caminho e hash", () => {
  const request = { generatedDocumentId: "legacy", status: "signed", signedStoragePath: signedPath, signedHash: hash };
  assert.doesNotThrow(() => assertGeneratedSignedReference("legacy", generated, request));
  for (const changed of [{ generatedDocumentId: "other" }, { signedHash: "b".repeat(64) }, { signedStoragePath: "other.pdf" }, { status: "sent" }]) {
    assert.throws(() => assertGeneratedSignedReference("legacy", generated, { ...request, ...changed }), GeneratedArchiveFileError);
  }
  assert.throws(() => assertGeneratedSignedReference("legacy", generated, { ...request, personBinding: {}, sourceGeneratedVersion: 2 }), GeneratedArchiveFileError);
});

test("pastas aceitam apenas fontes conhecidas e endereço individual preserva ID", () => {
  assert.equal(isArchiveFolderSource("generated"), true);
  assert.equal(isArchiveFolderSource("__proto__"), false);
  assert.equal(archiveSourceHref("generated", "legacy"), "/dashboard/documents/archive?source=generated&document=legacy");
});
