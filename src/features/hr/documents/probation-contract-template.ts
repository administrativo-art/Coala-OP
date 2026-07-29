import type { TemplateFieldMapping } from "@/features/hr/documents/field-mapping";

export const PROBATION_CONTRACT_V2_SOURCE =
  "docs/modelos-documentos/admissionais/01-contrato-experiencia-v2.docx";

export const PROBATION_CONTRACT_V2_HASH =
  "6cddfc54a23a17964493f94c71f8af52b89d17ef953db9b7acdb5c836fbff53d";

export const PROBATION_CONTRACT_V2_VARIABLES = [
  "contract_final_end_long",
  "contract_first_end_long",
  "contract_monthly_salary",
  "contract_start_long",
  "employee.ctps_number",
  "employee.ctps_series",
  "employee.name",
  "integration.employer_address",
  "integration.employer_cnpj",
  "integration.employer_name",
  "integration.job_function",
] as const;

export const PROBATION_CONTRACT_V2_FIELD_MAPPING: TemplateFieldMapping = {
  contract_monthly_salary: {
    kind: "system",
    key: "integration.monthly_salary",
    formatter: "currency_br_with_words",
  },
  contract_start_long: {
    kind: "system",
    key: "integration.expected_admission_date",
    formatter: "date_long_br",
  },
  contract_first_end_long: {
    kind: "system",
    key: "integration.probation_first_end_date",
    formatter: "date_long_br",
  },
  contract_final_end_long: {
    kind: "system",
    key: "integration.probation_final_end_date",
    formatter: "date_long_br",
  },
};
