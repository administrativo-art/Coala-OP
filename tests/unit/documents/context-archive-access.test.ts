import assert from "node:assert/strict";
import test from "node:test";
import { defaultGuestPermissions, type PermissionSet } from "../../../src/types";
import { canViewContextArchive, contextWorkspaceAllowed, managesUniformArchive } from "../../../src/features/documents/central/context-archive-access";
import { generatedArchiveEntry, generatedArchivePage } from "../../../src/features/documents/central/archive-source-folders";
function merge(target: Record<string, unknown>, patch: Record<string, unknown>) {
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === "object" && !Array.isArray(value)) target[key] = merge((target[key] as Record<string, unknown>) ?? {}, value as Record<string, unknown>);
    else target[key] = value;
  }
  return target;
}
const actor = (permissions: unknown = {}, extra: Record<string, unknown> = {}) => ({ permissions: merge(structuredClone(defaultGuestPermissions) as unknown as Record<string, unknown>, permissions as Record<string, unknown>) as unknown as PermissionSet, isDefaultAdmin: false, userDoc: {}, ...extra });

test("a pasta respeita a permissão específica da origem e a interseção do comprovante financeiro", () => {
  assert.equal(canViewContextArchive("aso", actor()), false);
  assert.equal(canViewContextArchive("aso", actor({ hr: { formalization: { aso: { view: true } } } })), true);
  assert.equal(canViewContextArchive("accountant", actor({ hr: { formalization: { aso: { view: true } } } })), false);
  assert.equal(canViewContextArchive("paymentProof", actor({ financial: { view: true, paymentRequests: { view: true, viewProof: false } } })), false);
  assert.equal(canViewContextArchive("paymentProof", actor({ financial: { view: true, paymentRequests: { view: true, viewProof: true } } })), true);
  assert.equal(canViewContextArchive("paymentProof", actor({ hr: { formalization: { documents: { view: true } } } })), false);
});

test("ZIP fiscal exige gestor global e não se confunde com comprovante pessoal de ponto", () => {
  const permission = { dp: { settings: { manageTime: true } } };
  assert.equal(canViewContextArchive("afd", actor(permission, { userDoc: { unitAccessScope: "selected", unitAccessUnitIds: ["a"] } })), false);
  assert.equal(canViewContextArchive("aej", actor(permission, { userDoc: { unitAccessScope: "all" } })), true);
  assert.equal(canViewContextArchive("receipts", actor()), true);
  assert.equal(canViewContextArchive("afd", actor()), false);
});

test("workspace divergente é negado inclusive ao admin; legado sem escopo só aceita política global explícita", () => {
  assert.equal(contextWorkspaceAllowed({ workspaceId: "other" }, "coala", true), false);
  assert.equal(contextWorkspaceAllowed({}, "coala", false), false);
  assert.equal(contextWorkspaceAllowed({}, "coala", true), true);
  assert.equal(contextWorkspaceAllowed({ workspaceId: "coala" }, "coala", false), true);
});

test("perfil próprio não vira gestor de termos e fonte de manutenção preserva data e escopo explícitos", () => {
  assert.equal(managesUniformArchive(actor({ dp: { collaborators: { view: true, ownProfileOnly: true } } })), false);
  assert.equal(managesUniformArchive(actor({ stock: { uniforms: { view: true } } })), true);
  const record = { id: "maintenance", workspaceId: "coala", createdAt: "2026-11-26T10:00:00.000Z", pdfStoragePath: "maintenance.pdf" };
  assert.equal(generatedArchiveEntry(record, "coala")?.updatedAt, record.createdAt);
  assert.equal(generatedArchiveEntry(record, "other"), null);
  assert.equal(generatedArchivePage([record, { id: "next" }], 1, "other").nextCursor, "maintenance");
});

 test("admissão exige documentos e formalização", () => {
  assert.equal(canViewContextArchive("admissionUploads", actor({ hr: { formalization: { documents: { view: true } } } })), false);
  assert.equal(canViewContextArchive("admissionUploads", actor({ hr: { formalization: { view: true, documents: { view: true } } } })), true);
});
