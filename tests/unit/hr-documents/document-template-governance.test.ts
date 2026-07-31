import assert from "node:assert/strict";
import test from "node:test";

import {
  documentTemplateEditBlockMessage,
  isDocumentTemplateContentEditable,
} from "../../../src/features/hr/documents/document-template-governance";

test("candidato oficial fica editável apenas durante a validação técnica", () => {
  assert.equal(isDocumentTemplateContentEditable({
    officialCandidate: true,
    status: "draft",
    workflowStatus: "technical_validation",
  }), true);
  assert.equal(isDocumentTemplateContentEditable({
    officialCandidate: true,
    status: "draft",
    workflowStatus: "rh_approval",
  }), false);
});

test("modelo publicado orienta a criação de nova versão", () => {
  const state = { officialCandidate: true, status: "published", workflowStatus: "published" };
  assert.equal(isDocumentTemplateContentEditable(state), false);
  assert.match(documentTemplateEditBlockMessage(state), /nova versão/i);
});
