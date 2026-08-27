import assert from "node:assert/strict";
import test from "node:test";

import {
  canAdvanceDocumentTemplateWorkflow,
  canReturnDocumentTemplateForAdjustments,
  canTransitionDocumentTemplateWorkflow,
  defaultSystemTemplateWorkflowStatus,
} from "../../../src/features/hr/documents/document-template-workflow";

test("modelo admissional não publicado começa em homologação do RH", () => {
  assert.equal(defaultSystemTemplateWorkflowStatus({
    id: "system-admission-employment-probation-contract",
    status: "draft",
  }), "rh_approval");
});

test("fluxo do modelo não permite pular homologação do RH", () => {
  assert.equal(canAdvanceDocumentTemplateWorkflow("technical_validation", "rh_approval"), true);
  assert.equal(canAdvanceDocumentTemplateWorkflow("technical_validation", "published"), false);
  assert.equal(canAdvanceDocumentTemplateWorkflow("rh_approval", "published"), true);
});

test("estado jurídico legado segue direto para homologação e publicação", () => {
  assert.equal(canAdvanceDocumentTemplateWorkflow("legal_review", "published"), true);
});

test("modelo publicado só pode seguir para substituído", () => {
  assert.equal(canAdvanceDocumentTemplateWorkflow("published", "superseded"), true);
  assert.equal(canAdvanceDocumentTemplateWorkflow("published", "archived"), false);
});

test("homologação pode devolver formalmente para ajustes técnicos", () => {
  assert.equal(canReturnDocumentTemplateForAdjustments("rh_approval", "technical_validation"), true);
  assert.equal(canReturnDocumentTemplateForAdjustments("published", "technical_validation"), false);
  assert.equal(canTransitionDocumentTemplateWorkflow({
    current: "rh_approval",
    next: "technical_validation",
    decision: "return",
  }), true);
});
