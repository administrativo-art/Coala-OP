import assert from "node:assert/strict";
import test from "node:test";
import { planSignedAdmissionArchive } from "../../src/features/hr/documents/signed-admission-archive";

const workflows = ["contract", "privacy"].map((templateId, index) => ({ id: `workflow-${index}`, templateId, status: "signed", signatureRequestId: "signature_bundle_person" }));
const request = { status: "signed", signedStoragePath: "private/package/signed.pdf", signedHash: "a".repeat(64), manifest: { schemaVersion: 1, packageType: "admission", components: [{ templateId: "contract" }, { templateId: "privacy" }, { templateId: "system-admission-bundle-closing-term" }] } };

test("um pacote com vários componentes produz uma única identidade de arquivo, estável na retomada", () => {
  const plan = planSignedAdmissionArchive("person", workflows, request);
  assert.equal(plan.kind, "create");
  assert.equal(plan.workflowIds.length, 2);
  if (plan.kind !== "create") throw Error("Plano inesperado");
  assert.equal(plan.signedStoragePath, request.signedStoragePath);
  const retry = planSignedAdmissionArchive("person", [...workflows].reverse(), request);
  if (retry.kind !== "create") throw Error("Retomada inesperada");
  assert.equal(plan.documentId, retry.documentId);
  const deselected = planSignedAdmissionArchive("person", [...workflows, { ...workflows[0], id: "old", templateId: "old", selected: false }], request);
  assert.equal(deselected.kind, "create");
});

test("arquivo legado já referenciado é preservado sem plano para novas cópias", () => {
  const result = planSignedAdmissionArchive("person", workflows.map((item, index) => ({ ...item, employeeDocumentId: `legacy-${index}` })), request);
  assert.equal(result.kind, "existing");
  if (result.kind === "existing") assert.deepEqual(result.documentIds, ["legacy-0", "legacy-1"]);
});

test("assinatura incompleta mantém componentes reservados sem arquivar como documentos avulsos", () => {
  const result = planSignedAdmissionArchive("person", [{ ...workflows[0], status: "sent" }, workflows[1]], request);
  assert.equal(result.kind, "none");
  assert.equal(result.workflowIds.length, 2);
  assert.equal(planSignedAdmissionArchive("person", workflows, { ...request, status: "sent" }).kind, "none");
});

test("divergência de manifesto, hash ausente e arquivamento parcial bloqueiam a promoção", () => {
  assert.throws(() => planSignedAdmissionArchive("person", workflows.slice(0, 1), request), /manifesto/);
  assert.throws(() => planSignedAdmissionArchive("person", workflows, { ...request, signedHash: "" }), /hash/);
  assert.throws(() => planSignedAdmissionArchive("person", [{ ...workflows[0], employeeDocumentId: "legacy" }, workflows[1]], request), /parcialmente/);
});

test("assinaturas avulsas não entram na promoção do pacote admissional", () => {
  assert.deepEqual(planSignedAdmissionArchive("person", [{ ...workflows[0], signatureRequestId: "independent" }], request), { requestId: "signature_bundle_person", workflowIds: [], kind: "none" });
});
