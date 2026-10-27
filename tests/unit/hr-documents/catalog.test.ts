import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { getDocumentTypeConfig, missingCriticalFields } from "../../../src/lib/hr/employee-document-catalog";
import { EMPLOYEE_DOCUMENT_SUBFOLDERS } from "../../../src/lib/hr/employee-document-options";

describe("missingCriticalFields", () => {
  const config = getDocumentTypeConfig("PAYSLIP"); // requiredFields: ["referenceMonth"], threshold 0.75

  test("campo presente e com confiança suficiente → não falta", () => {
    const r = missingCriticalFields(config, { referenceMonth: "2026-07" }, { referenceMonth: 0.95 });
    assert.deepEqual(r, []);
  });

  test("campo ausente → falta", () => {
    const r = missingCriticalFields(config, {}, {});
    assert.deepEqual(r, ["referenceMonth"]);
  });

  test("campo presente mas confiança baixa → falta", () => {
    const r = missingCriticalFields(config, { referenceMonth: "2026-07" }, { referenceMonth: 0.4 });
    assert.deepEqual(r, ["referenceMonth"]);
  });

  test("campo presente sem confiança explícita → não falta", () => {
    const r = missingCriticalFields(config, { referenceMonth: "2026-07" }, {});
    assert.deepEqual(r, []);
  });

  test("campo presente com confiança inválida → falta", () => {
    const r = missingCriticalFields(config, { referenceMonth: "2026-07" }, { referenceMonth: Number.NaN });
    assert.deepEqual(r, ["referenceMonth"]);
  });

  test("tipo sem requiredFields → nunca falta", () => {
    const r = missingCriticalFields(getDocumentTypeConfig("ADDRESS_PROOF"), {}, {});
    assert.deepEqual(r, []);
  });
});

describe("catálogo das duas macros documentais", () => {
  test("inclui pacote admissional e requisição de ASO com acesso derivado pelo catálogo", () => {
    assert.equal(getDocumentTypeConfig("ADMISSION_PACKAGE").category, "admission");
    assert.equal(getDocumentTypeConfig("ASO_REQUEST").category, "occupational_health");
  });

  test("documentos de dependentes ficam juntos e não na pasta de benefícios", () => {
    const dependents = EMPLOYEE_DOCUMENT_SUBFOLDERS.personal?.find((folder) => folder.id === "dependents");
    assert.deepEqual(dependents?.typeCodes, ["DEPENDENT_DOCUMENT", "VACCINATION_RECORD", "SCHOOL_ATTENDANCE"]);
    assert.equal(getDocumentTypeConfig("VACCINATION_RECORD").category, "personal");
    assert.equal(getDocumentTypeConfig("SCHOOL_ATTENDANCE").category, "personal");
  });

  test("catálogo distingue contratos civis PJ/PF de documentos admissionais", () => {
    assert.equal(getDocumentTypeConfig("SERVICE_PROVIDER_CONTRACT_PJ").category, "contracts");
    assert.equal(getDocumentTypeConfig("SERVICE_PROVIDER_CONTRACT_ADDENDUM").category, "contracts");
    assert.equal(getDocumentTypeConfig("SERVICE_PROVIDER_CONTRACT_PF").category, "contracts");
  });
});
