import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { onboardingDocumentTypeCode } from "../../../src/lib/hr/onboarding-document-classification";
import { DEFAULT_ONBOARDING_DOCUMENTS, mergeOnboardingDocumentModels } from "../../../src/lib/recruitment-onboarding";

describe("classificação de documentos da integração", () => {
  test("mapeia documentos universais antigos sem documentTypeCode", () => {
    assert.equal(onboardingDocumentTypeCode({ id: "identity_document", label: "Identidade" }), "PERSONAL_ID");
    assert.equal(onboardingDocumentTypeCode({ id: "profile_photo", label: "Foto" }), "PROFILE_PHOTO");
    assert.equal(onboardingDocumentTypeCode({ id: "aso_admission", label: "ASO" }), "ASO_ADMISSION");
  });

  test("mapeia documentos dinâmicos dos filhos", () => {
    assert.equal(onboardingDocumentTypeCode({ id: "child_1_birth_certificate", label: "Certidão" }), "DEPENDENT_DOCUMENT");
    assert.equal(onboardingDocumentTypeCode({ id: "child_2_vaccination", label: "Vacinação" }), "VACCINATION_RECORD");
    assert.equal(onboardingDocumentTypeCode({ id: "child_3_school_attendance", label: "Escola" }), "SCHOOL_ATTENDANCE");
  });

  test("mantém a foto obrigatória mesmo se o modelo tentar torná-la opcional", () => {
    const documents = mergeOnboardingDocumentModels([
      { id: "profile_photo", label: "Foto do colaborador", required: false },
    ]);
    const photo = documents.find((document) => document.id === "profile_photo");
    assert.ok(photo);
    assert.equal(photo.required, true);
    assert.equal(photo.documentTypeCode, "PROFILE_PHOTO");
  });

  test("mantém o ASO no fluxo dedicado, fora dos documentos iniciais", () => {
    assert.equal(DEFAULT_ONBOARDING_DOCUMENTS.some((document) => document.documentTypeCode === "ASO_ADMISSION"), false);

    const documents = mergeOnboardingDocumentModels([
      { id: "aso_admission", label: "ASO admissional", documentTypeCode: "ASO_ADMISSION", required: true },
    ]);
    assert.equal(documents.some((document) => document.documentTypeCode === "ASO_ADMISSION"), false);
  });
});
