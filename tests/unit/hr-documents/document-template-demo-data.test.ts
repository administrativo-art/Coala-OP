import assert from "node:assert/strict";
import test from "node:test";

import { buildDocumentTemplateDemoData } from "../../../src/features/hr/documents/document-template-demo-data";
import {
  PROBATION_CONTRACT_V2_FIELD_MAPPING,
  PROBATION_CONTRACT_V2_VARIABLES,
} from "../../../src/features/hr/documents/probation-contract-template";

test("prévia do contrato usa valores fictícios e os formatadores reais", () => {
  const data = buildDocumentTemplateDemoData({
    variables: [...PROBATION_CONTRACT_V2_VARIABLES],
    fieldMapping: PROBATION_CONTRACT_V2_FIELD_MAPPING,
  });

  assert.equal(data.contract_job_cbo, "5134-15");
  assert.match(String(data.contract_monthly_salary), /^R\$\s*1\.787,30/);
  assert.match(String(data.contract_monthly_salary), /mil setecentos e oitenta e sete reais/i);
  assert.match(String(data.contract_start_long), /julho de 2026/i);
  assert.equal(
    (data.employee as Record<string, unknown>).name,
    "Marina Costa Almeida",
  );
});

test("prévia preenche também campos manuais sem usar cadastro real", () => {
  const data = buildDocumentTemplateDemoData({
    variables: ["custom_date", "custom_value", "custom_choice"],
    fieldMapping: {
      custom_date: {
        kind: "manual",
        label: "Data do evento",
        format: "date_br",
        required: true,
      },
      custom_value: {
        kind: "manual",
        label: "Valor do serviço",
        format: "currency_br",
        required: true,
      },
      custom_choice: {
        kind: "manual",
        label: "Modalidade",
        format: "select",
        required: true,
        options: ["Opção A", "Opção B"],
      },
    },
  });

  assert.equal(data.custom_date, "30/07/2026");
  assert.equal(data.custom_value, "R$ 475,00");
  assert.equal(data.custom_choice, "Opção A");
});
