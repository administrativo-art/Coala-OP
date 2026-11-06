import {
  DOCUMENT_VARIABLES,
  type DocumentVariableFormat,
} from "@/features/hr/integration/document-variables";

/**
 * Valores de exemplo para a pré-visualização do editor. Todos são fictícios e determinísticos
 * (CPF/CNPJ com dígitos de teste, nomes genéricos), sem PII real.
 *
 * Por que não reutilizar `document-template-demo-data.ts`: `DEMO_RAW_VALUES` não é exportado e a
 * função pública exige binding/mapeamento de templates DOCX. Aqui os valores seguem o formato do
 * catálogo e cobrem todas as chaves; as frases abaixo repetem o estilo daquele arquivo.
 */
const KEY_OVERRIDES: Record<string, unknown> = {
  "employee.name": "Marina Costa Almeida",
  "employee.cpf": "52998224725",
  "employee.address": "Rua das Flores, 120, Centro, São Luís/MA, CEP 65010-000",
  "integration.employer_name": "Coala Shakes Alimentos LTDA",
  "integration.employer_legal_name": "C T SORVETES LTDA",
  "integration.employer_cnpj": "14276603000125",
  "integration.employer_address": "Avenida dos Holandeses, 1000, São Luís/MA, CEP 65071-380",
  "integration.job_function": "Atendente de balcão",
  "integration.job_role": "Atendimento",
  "integration.job_cbo": "5134-15",
  "integration.monthly_salary": 1787.3,
  "integration.expected_admission_date": "2026-07-25",
  "integration.probation_first_period_days": 30,
  "integration.probation_second_period_days": 60,
  "integration.probation_first_end_date": "2026-08-23",
  "integration.probation_final_end_date": "2026-10-22",
  "integration.work_scale": "6x1",
  "integration.work_hours": "14h às 22h20",
  "integration.weekly_hours": 44,
  "integration.workplace_address": "Shopping da Ilha, São Luís/MA",
  "integration.union_employees": "Sindicato dos Trabalhadores em Alimentação",
  "integration.union_employers": "Sindicato Patronal de Alimentação",
  "integration.cct_registry": "MA000123/2026",
  "integration.cct_validity": "01/01/2026 a 31/12/2026",
  "integration.image_voice_authorized_mark": true,
};

const FORMAT_DEFAULTS: Record<DocumentVariableFormat, unknown> = {
  text: "Texto de exemplo",
  multiline: "Primeira linha de exemplo; segunda linha de exemplo",
  date_br: "2026-01-15",
  currency_br: 1500,
  number_br: 10,
  boolean_br: true,
  cpf: "52998224725",
  cnpj: "14276603000125",
  pis: "12345678919",
  phone_br: "98999990000",
  email: "exemplo@exemplo.com",
  select_label: "Opção de exemplo",
  multi_select_labels: ["Opção A", "Opção B"],
  reference_label: "Referência de exemplo",
  checkbox_mark: true,
  repeatable: "",
};

/** Valores brutos (antes de `formatDocumentVariableValue`), uma entrada por chave do catálogo. */
export const EDITOR_SAMPLE_VALUES: Readonly<Record<string, unknown>> = Object.freeze(
  Object.fromEntries(
    DOCUMENT_VARIABLES.map((variable) => [
      variable.key,
      variable.key in KEY_OVERRIDES ? KEY_OVERRIDES[variable.key] : FORMAT_DEFAULTS[variable.format],
    ]),
  ),
);
