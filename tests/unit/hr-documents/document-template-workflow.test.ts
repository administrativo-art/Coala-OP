import assert from "node:assert/strict";
import test from "node:test";

import {
  canAdvanceDocumentTemplateWorkflow,
  defaultSystemTemplateWorkflowStatus,
} from "../../../src/features/hr/documents/document-template-workflow";

test("modelo admissional não publicado começa em revisão jurídica", () => {
  assert.equal(defaultSystemTemplateWorkflowStatus({
    id: "system-admission-employment-probation-contract",
    status: "draft",
  }), "legal_review");
});

test("fluxo do modelo não permite pular homologação do RH", () => {
  assert.equal(canAdvanceDocumentTemplateWorkflow("legal_review", "rh_approval"), true);
  assert.equal(canAdvanceDocumentTemplateWorkflow("legal_review", "published"), false);
  assert.equal(canAdvanceDocumentTemplateWorkflow("rh_approval", "published"), true);
});

test("modelo publicado só pode seguir para substituído", () => {
  assert.equal(canAdvanceDocumentTemplateWorkflow("published", "superseded"), true);
  assert.equal(canAdvanceDocumentTemplateWorkflow("published", "archived"), false);
});
