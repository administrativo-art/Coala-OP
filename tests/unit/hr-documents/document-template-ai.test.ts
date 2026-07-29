import assert from "node:assert/strict";
import test from "node:test";

import PizZip from "pizzip";

import {
  scanDocxTemplateForPersonalData,
  validateTemplateAiPlan,
} from "../../../src/features/hr/documents/document-template-ai";

function docx(text: string) {
  const zip = new PizZip();
  zip.folder("word")?.file("document.xml", `<w:document><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generate({ type: "nodebuffer" }) as Buffer;
}

test("bloqueia envio à IA quando a matriz contém CPF ou salário real", () => {
  const scan = scanDocxTemplateForPersonalData(docx("Eu, JOÃO DA SILVA, CPF 123.456.789-00, salário R$ 1.518,00"));
  assert.equal(scan.safeForAi, false);
  assert.deepEqual(new Set(scan.findings.map((item) => item.type)), new Set(["cpf", "salary", "filled_person_name"]));
});

test("valida trecho e contagem exata antes de qualquer aplicação", () => {
  const validation = validateTemplateAiPlan("Empresa X e Empresa X", [{
    exactText: "Empresa X",
    expectedOccurrences: 2,
    variableKey: "integration.employer_name",
    confidence: 0.99,
    rationale: "Razão social.",
  }]);
  assert.equal(validation.valid, true);
  assert.equal(validateTemplateAiPlan("Empresa X", [{
    exactText: "Empresa X",
    expectedOccurrences: 2,
    variableKey: "integration.employer_name",
    confidence: 0.99,
    rationale: "Razão social.",
  }]).valid, false);
});
