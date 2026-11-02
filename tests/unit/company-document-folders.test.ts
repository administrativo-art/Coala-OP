import assert from "node:assert/strict";
import test from "node:test";

import { companyDocumentEvidenceSection, companyDocumentFolderCode, companyDocumentNavigationCategory, TIME_RECORDING_COMPLIANCE_FOLDER } from "@/lib/documents/company-document-folders";

test("agrupa o legado REP-P e permite retirar explicitamente uma exceção", () => {
  const legacy = { category: "Trabalhista e RH", title: "REP-P — Dossiê de regularidade — 25/10/2026" };
  assert.equal(companyDocumentFolderCode(legacy), TIME_RECORDING_COMPLIANCE_FOLDER);
  assert.equal(companyDocumentFolderCode({ ...legacy, folderCode: null }), null);
  assert.equal(companyDocumentFolderCode({ ...legacy, category: "Contratos" }), null);
  assert.equal(companyDocumentFolderCode({ category: "Trabalhista e RH", title: "Convenção coletiva" }), null);
  assert.equal(companyDocumentFolderCode({ category: "Sistemas e conformidade", folderCode: TIME_RECORDING_COMPLIANCE_FOLDER }), TIME_RECORDING_COMPLIANCE_FOLDER);
  assert.equal(companyDocumentNavigationCategory(legacy), "Sistemas e conformidade");
  assert.equal(companyDocumentNavigationCategory({ ...legacy, folderCode: null }), "Trabalhista e RH");
  assert.equal(companyDocumentEvidenceSection(legacy), "versions");
  assert.equal(companyDocumentEvidenceSection({ category: "Trabalhista e RH", title: "REP-P — Relatório ITI do AFD" }), "validation");
  assert.equal(companyDocumentEvidenceSection({ category: "Trabalhista e RH", title: "REP-P — AFD de homologação" }), "samples");
});
