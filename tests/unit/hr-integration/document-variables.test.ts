import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DOCUMENT_VARIABLE_CATALOG,
  DOCUMENT_VARIABLE_COUNT,
  DOCUMENT_VARIABLES,
  formatDocumentVariableValue,
  getDocumentVariable,
} from "../../../src/features/hr/integration/document-variables";

describe("catálogo de variáveis documentais", () => {
  test("mantém o catálogo versionado de variáveis documentais", () => {
    assert.equal(DOCUMENT_VARIABLES.length, DOCUMENT_VARIABLE_COUNT);
    assert.equal(Object.keys(DOCUMENT_VARIABLE_CATALOG).length, DOCUMENT_VARIABLE_COUNT);
    assert.ok(getDocumentVariable("employee.name"));
    assert.ok(getDocumentVariable("system.documents.email"));
    assert.deepEqual(getDocumentVariable("integration.probation_first_period_days")?.resolution, [{
      source: "onboarding",
      path: "probationV2.config.firstPeriodDays",
    }]);
    assert.deepEqual(getDocumentVariable("integration.probation_second_period_days")?.resolution, [{
      source: "onboarding",
      path: "probationV2.config.secondPeriodDays",
    }]);
  });

  test("preserva condicionais e grupo repetível do mapa de RH", () => {
    const cnh = getDocumentVariable("employee.cnh_number");
    assert.equal(cnh?.conditionals[0]?.field, "employee.has_cnh");
    assert.equal(cnh?.conditionals[0]?.value, true);

    const children = getDocumentVariable("employee.children");
    assert.equal(children?.fieldType, "repeatable<object>");
    assert.equal(children?.repeatable?.enabled, true);
  });

  test("prioriza a fonte operacional oficial do vale-transporte", () => {
    assert.deepEqual(getDocumentVariable("employee.has_vt")?.resolution[0], {
      source: "user_record",
      path: "needsTransportVoucher",
    });
    assert.deepEqual(getDocumentVariable("employee.vt_daily_value")?.resolution[0], {
      source: "user_record",
      path: "transportVoucherValue",
    });
  });

  test("usa o CPF confirmado no formulário enquanto o colaborador ainda não existe", () => {
    assert.deepEqual(getDocumentVariable("employee.cpf")?.resolution, [
      { source: "field_value", path: "employee.cpf" },
      { source: "onboarding", path: "publicFormAnswers.cpf" },
    ]);
  });

  test("mantém resumos sistêmicos com fonte computada operacional", () => {
    assert.deepEqual(getDocumentVariable("integration.job_cbo")?.resolution, [{ source: "computed", path: "employment.jobCbo" }]);
    assert.deepEqual(getDocumentVariable("system.uniforms.summary")?.resolution, [{ source: "computed", path: "uniforms.summary" }]);
    assert.deepEqual(getDocumentVariable("system.vacations.summary")?.resolution, [{ source: "computed", path: "vacations.summary" }]);
    assert.deepEqual(getDocumentVariable("system.aso.summary")?.resolution, [{ source: "computed", path: "aso.summary" }]);
    assert.deepEqual(getDocumentVariable("system.family_salary.summary")?.resolution, [{ source: "computed", path: "familySalary.summary" }]);
  });

  test("formata datas, moedas, booleanos e documentos sem vazar objetos", () => {
    assert.equal(formatDocumentVariableValue("2026-07-17", "date_br"), "17/07/2026");
    assert.equal(formatDocumentVariableValue(8.4, "currency_br"), "R$ 8,40");
    assert.equal(formatDocumentVariableValue(true, "boolean_br"), "Sim");
    assert.equal(formatDocumentVariableValue("12345678901", "cpf"), "123.456.789-01");
    assert.equal(formatDocumentVariableValue([{ label: "A" }, { label: "B" }], "multi_select_labels"), "A, B");
    assert.equal(formatDocumentVariableValue([{ name: "Filho" }], "repeatable"), "");
  });
});
