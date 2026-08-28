import assert from "node:assert/strict";
import test from "node:test";

import { onboardingDocumentPreviewKind } from "../../../src/features/hr/onboarding/document-preview";

test("identifica imagens pelos caminhos de upload do onboarding", () => {
  assert.equal(onboardingDocumentPreviewKind({
    filePath: "hr/onboarding/token/arquivo-identidade.JPG",
    fileUrl: null,
  }), "image");
  assert.equal(onboardingDocumentPreviewKind({
    filePath: null,
    fileUrl: "https://storage.test/o/hr%2Fonboarding%2Ffoto.png?alt=media&token=abc",
  }), "image");
});

test("mantém PDF no visualizador incorporado e arquivos legados no fallback", () => {
  assert.equal(onboardingDocumentPreviewKind({
    filePath: "hr/onboarding/token/documento.pdf",
    fileUrl: null,
  }), "pdf");
  assert.equal(onboardingDocumentPreviewKind({
    filePath: "hr/onboarding/token/arquivo-sem-extensao",
    fileUrl: "/api/hr/document/legacy",
  }), "unknown");
});
