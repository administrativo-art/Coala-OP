import assert from "node:assert/strict";
import test from "node:test";

import {
  admissionDocumentJobRoleCbo,
  missingAdmissionDocumentJobRoleCbo,
} from "../../../src/features/hr/onboarding/admission-document-prerequisites";

test("normaliza somente CBO no formato oficial aceito pelo cadastro", () => {
  assert.equal(admissionDocumentJobRoleCbo("5134-35"), "5134-35");
  assert.equal(admissionDocumentJobRoleCbo(" 5134-35 "), "5134-35");
  assert.equal(admissionDocumentJobRoleCbo("513435"), null);
  assert.equal(admissionDocumentJobRoleCbo(null), null);
});

test("impede iniciar integração documental com cargo sem CBO", () => {
  assert.equal(missingAdmissionDocumentJobRoleCbo({
    generateSignatureDocuments: true,
    jobRoleCbo: null,
  }), true);
  assert.equal(missingAdmissionDocumentJobRoleCbo({
    generateSignatureDocuments: true,
    jobRoleCbo: "5134-35",
  }), false);
  assert.equal(missingAdmissionDocumentJobRoleCbo({
    generateSignatureDocuments: false,
    jobRoleCbo: null,
  }), false);
});
