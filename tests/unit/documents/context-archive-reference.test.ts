import assert from "node:assert/strict";
import test from "node:test";
import { contextFileReference } from "../../../src/features/documents/central/context-archive-reference";
const scope = { workspaceId: "coala", parentId: "parent", fiscalBucket: "private-fiscal" };
const hash = "a".repeat(64);
test("documentos contextuais não podem redirecionar o leitor a bytes de outra origem", () => {
  const record = { kind: "aso_admission_referral", storagePath: "hr/onboarding/parent/generated/aso-guides/guide.pdf", hashSha256: hash };
  assert.ok(contextFileReference("aso", "guide", record, scope));
  assert.equal(contextFileReference("accountant", "guide", record, scope), null);
  assert.equal(contextFileReference("aso", "guide", record, { ...scope, parentId: "another" }), null);
  assert.equal(contextFileReference("aso", "guide", { ...record, hashSha256: "invalid" }, scope), null);
  assert.equal(contextFileReference("paymentProof", "a", { proofStoragePath: "financial/payment-proofs/b/comprovante-pagamento.pdf" }, scope), null);
  assert.equal(contextFileReference("uniforms", "a", { collaboratorUserId: "person", term: { storagePath: "hr/employee-documents/other/documents/a/versions/01/original.pdf", contentHash: hash } }, scope), null);
});
test("pacote fiscal fixa workspace, bucket, geração e tamanho da origem persistida", () => {
  const record = { workspaceId: "coala", establishmentId: "est", artifacts: { bundle: { storagePath: "time-recording/fiscal-exports/coala/afd/est/export/pacote-fiscal-afd.zip", storageBucket: "private-fiscal", generation: "123", sha256: hash, size: 42 } } };
  assert.equal(contextFileReference("afd", "export", record, scope)?.generation, "123");
  for (const patch of [{ storageBucket: "other" }, { generation: "latest" }, { size: 101 * 1024 * 1024 }, { sha256: "invalid" }]) {
    assert.equal(contextFileReference("afd", "export", { ...record, artifacts: { bundle: { ...record.artifacts.bundle, ...patch } } }, scope), null);
  }
  assert.equal(contextFileReference("aej", "export", record, scope), null);
});
