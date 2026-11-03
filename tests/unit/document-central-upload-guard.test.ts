import assert from "node:assert/strict";
import { test } from "node:test";
import { createUploadGuard } from "../../src/features/documents/central/upload-guard";

test("autoria do lote não substitui acesso atual à pessoa nem política do documento", async () => {
  const guard = createUploadGuard({ allowedPerson: async (id) => id === "allowed", allowedDocument: (item) => item.documentTypeCode !== "MEDICAL_CERTIFICATE" });
  assert.equal(await guard({ employeeId: "revoked", createdBy: "actor" }), false);
  assert.equal(await guard({ employeeId: "allowed", documentTypeCode: "MEDICAL_CERTIFICATE" }), false);
  assert.equal(await guard({ employeeId: "allowed", documentTypeCode: "ADDRESS_PROOF" }), true);
  assert.equal(await guard({ createdBy: "actor" }), false);
});

test("leituras concorrentes compartilham uma autorização por pessoa e nova página revalida", async () => {
  let calls = 0;
  let allowed = true;
  const dependencies = { allowedPerson: async () => { calls++; return allowed; }, allowedDocument: () => true };
  const page = createUploadGuard(dependencies);
  assert.deepEqual(await Promise.all([page({ employeeId: "one" }), page({ employeeId: "one" })]), [true, true]);
  assert.equal(calls, 1);
  allowed = false;
  assert.equal(await createUploadGuard(dependencies)({ employeeId: "one" }), false);
  assert.equal(calls, 2);
});
