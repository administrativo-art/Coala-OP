import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { getDocumentTypeConfig, missingCriticalFields } from "../../../src/lib/hr/employee-document-catalog";

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
