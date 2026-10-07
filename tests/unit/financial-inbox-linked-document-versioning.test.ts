import assert from "node:assert/strict";
import test from "node:test";

import {
  linkedDocumentVersionId,
  shouldArchiveLinkedDocumentVersion,
} from "../../src/features/financial/inbox/linked-document-versioning";

test("arquiva nova versão quando o mesmo link passa a entregar outro PDF", () => {
  const fingerprint = "a".repeat(64);
  const firstHash = "b".repeat(64);
  const updatedHash = "c".repeat(64);
  const attachments = [{ sha256: firstHash }];

  assert.equal(shouldArchiveLinkedDocumentVersion(attachments, firstHash), false);
  assert.equal(shouldArchiveLinkedDocumentVersion(attachments, updatedHash), true);
  assert.notEqual(
    linkedDocumentVersionId(fingerprint, firstHash),
    linkedDocumentVersionId(fingerprint, updatedHash),
  );
});

test("recusa identidade incompleta para não sobrescrever uma versão arquivada", () => {
  assert.throws(() => linkedDocumentVersionId("a".repeat(12), "b".repeat(64)));
  assert.throws(() => linkedDocumentVersionId("a".repeat(64), "hash-invalido"));
});
