import assert from "node:assert/strict";
import test from "node:test";

import { documentTemplateDisplayStatus } from "../../src/features/hr/documents/document-template-display-status";

test("status visível acompanha as três fases de preparação", () => {
  assert.equal(documentTemplateDisplayStatus({ status: "draft" }), "Em mapeamento pela IA");
  assert.equal(
    documentTemplateDisplayStatus({ status: "draft", aiMappingPlan: { reviewed: false } }),
    "Em edição manual",
  );
  assert.equal(
    documentTemplateDisplayStatus({ status: "draft", aiMappingPlan: { reviewed: true } }),
    "Em teste visual",
  );
});

test("teste visual libera modelo comum e encaminha oficial ao RH", () => {
  assert.equal(
    documentTemplateDisplayStatus({
      status: "draft",
      aiMappingPlan: { reviewed: true },
      fieldPreparationTestedAt: "2026-07-29T18:00:00.000Z",
    }),
    "Disponível",
  );
  assert.equal(
    documentTemplateDisplayStatus({
      status: "draft",
      officialCandidate: true,
      workflowStatus: "technical_validation",
      aiMappingPlan: { reviewed: true },
      fieldPreparationTestedAt: "2026-07-29T18:00:00.000Z",
    }),
    "Pronto para homologação do RH",
  );
});

test("aprovações oficiais prevalecem depois da preparação", () => {
  assert.equal(
    documentTemplateDisplayStatus({ status: "draft", workflowStatus: "legal_review" }),
    "Em homologação pelo RH",
  );
  assert.equal(
    documentTemplateDisplayStatus({ status: "draft", workflowStatus: "rh_approval" }),
    "Em homologação pelo RH",
  );
  assert.equal(
    documentTemplateDisplayStatus({ status: "published", workflowStatus: "published" }),
    "Publicado",
  );
});

test("status persistido pode ser filtrado sem depender de inferência da interface", () => {
  assert.equal(
    documentTemplateDisplayStatus({ status: "draft", preparationStatus: "visual_test" }),
    "Em teste visual",
  );
  assert.equal(
    documentTemplateDisplayStatus({
      status: "draft",
      officialCandidate: true,
      preparationStatus: "ready_for_rh_approval",
    }),
    "Pronto para homologação do RH",
  );
  assert.equal(
    documentTemplateDisplayStatus({
      status: "draft",
      officialCandidate: true,
      preparationStatus: "ready_for_legal_review",
    }),
    "Pronto para homologação do RH",
  );
});
