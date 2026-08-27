import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { decideDocumentAction, type DocumentDecisionInput } from "../../../src/lib/hr/employee-document-decision";

const ok: DocumentDecisionInput = {
  userHasPermission: true,
  fileSafe: true,
  duplicateResolution: "NEW_DOCUMENT",
  employeeMatchStatus: "MATCH",
  multipleDocumentsDetected: false,
  legibility: "GOOD",
  documentTypeCode: "PAYSLIP",
  missingCriticalFields: [],
  documentTypeConfidence: 0.95,
  confirmationThreshold: 0.75,
};

describe("decideDocumentAction — ordem de prioridade", () => {
  test("tudo válido → READY_TO_FILE", () => {
    assert.equal(decideDocumentAction(ok).action, "READY_TO_FILE");
  });
  test("sem permissão → BLOCKED", () => {
    assert.equal(decideDocumentAction({ ...ok, userHasPermission: false }).action, "BLOCKED");
  });
  test("arquivo inseguro → BLOCKED", () => {
    assert.equal(decideDocumentAction({ ...ok, fileSafe: false }).action, "BLOCKED");
  });
  test("duplicata exata → EXACT_DUPLICATE", () => {
    assert.equal(decideDocumentAction({ ...ok, duplicateResolution: "EXACT_DUPLICATE" }).action, "EXACT_DUPLICATE");
  });
  test("CPF divergente → EMPLOYEE_MISMATCH (mesmo com tudo mais ok)", () => {
    assert.equal(decideDocumentAction({ ...ok, employeeMatchStatus: "MISMATCH" }).action, "EMPLOYEE_MISMATCH");
  });
  test("múltiplos documentos → REVIEW_REQUIRED", () => {
    assert.equal(decideDocumentAction({ ...ok, multipleDocumentsDetected: true }).action, "REVIEW_REQUIRED");
  });
  test("ilegível → REQUEST_NEW_FILE", () => {
    assert.equal(decideDocumentAction({ ...ok, legibility: "POOR" }).action, "REQUEST_NEW_FILE");
  });
  test("tipo desconhecido → REVIEW_REQUIRED", () => {
    assert.equal(decideDocumentAction({ ...ok, documentTypeCode: "UNKNOWN_DOCUMENT" }).action, "REVIEW_REQUIRED");
  });
  test("colaborador desconhecido → REVIEW_REQUIRED", () => {
    assert.equal(decideDocumentAction({ ...ok, employeeMatchStatus: "UNKNOWN" }).action, "REVIEW_REQUIRED");
  });
  test("possível colaborador → CONFIRMATION_REQUIRED", () => {
    assert.equal(decideDocumentAction({ ...ok, employeeMatchStatus: "POSSIBLE_MATCH" }).action, "CONFIRMATION_REQUIRED");
  });
  test("campo crítico ausente → CONFIRMATION_REQUIRED", () => {
    assert.equal(decideDocumentAction({ ...ok, missingCriticalFields: ["referenceMonth"] }).action, "CONFIRMATION_REQUIRED");
  });
  test("confiança baixa → REVIEW_REQUIRED", () => {
    assert.equal(decideDocumentAction({ ...ok, documentTypeConfidence: 0.5 }).action, "REVIEW_REQUIRED");
  });
});
