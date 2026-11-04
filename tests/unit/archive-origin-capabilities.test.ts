import assert from "node:assert/strict";
import test from "node:test";
import { canArchiveFinancialMessage, canArchiveTemplateVersion, canRemoveEmployeeArchiveDocument } from "../../src/features/documents/central/archive-origin-capabilities";

test("documentos do colaborador respeitam origem, estado e permissão", () => {
  assert.equal(canRemoveEmployeeArchiveDocument({ source: "onboarding", canManageEmployeeDocuments: true, canReviewGenerated: true }), false);
  assert.equal(canRemoveEmployeeArchiveDocument({ source: "generated", status: "final", canManageEmployeeDocuments: true, canReviewGenerated: true }), false);
  assert.equal(canRemoveEmployeeArchiveDocument({ source: "generated", status: "review_pending", canManageEmployeeDocuments: false, canReviewGenerated: true }), true);
  assert.equal(canRemoveEmployeeArchiveDocument({ source: "autentique_signature", canManageEmployeeDocuments: true, canReviewGenerated: false }), true);
  assert.equal(canRemoveEmployeeArchiveDocument({ canManageEmployeeDocuments: false, canReviewGenerated: true }), false);
});

test("modelo só arquiva versão substituída", () => {
  assert.equal(canArchiveTemplateVersion("published", true), false);
  assert.equal(canArchiveTemplateVersion("superseded", false), false);
  assert.equal(canArchiveTemplateVersion("superseded", true), true);
});

test("financeiro só arquiva cobrança identificada com permissão", () => {
  assert.equal(canArchiveFinancialMessage("archived", true), false);
  assert.equal(canArchiveFinancialMessage("identified", false), false);
  assert.equal(canArchiveFinancialMessage("identified", true), true);
});
