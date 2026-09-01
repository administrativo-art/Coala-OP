import type { TemplateFieldMapping } from "@/features/hr/documents/field-mapping";

export const PROBATION_CONTRACT_V2_SOURCE =
  "docs/modelos-documentos/admissionais/01-contrato-experiencia-v2.docx";

export const PROBATION_CONTRACT_V2_HASH =
  "0b0ce20b71e53ad9fd5576a52bcbfb57dfdfc6f678f82a9cb8cc7f646437da52";

export const PROBATION_CONTRACT_V2_VARIABLES = [
  "contract_cct_registry",
  "contract_cct_validity",
  "contract_final_end_long",
  "contract_first_end_long",
  "contract_job_cbo",
  "contract_monthly_salary",
  "contract_start_long",
  "contract_union_employees",
  "contract_union_employers",
  "contract_work_hours",
  "contract_work_scale",
  "contract_workplace_address",
  "employee.address",
  "employee.cpf",
  "employee.name",
  "integration.employer_address",
  "integration.employer_cnpj",
  "integration.employer_name",
  "integration.job_function",
] as const;

export const PROBATION_CONTRACT_V2_FIELD_MAPPING: TemplateFieldMapping = {
  contract_job_cbo: {
    kind: "system",
    key: "integration.job_cbo",
  },
  contract_monthly_salary: {
    kind: "system",
    key: "integration.monthly_salary",
    formatter: "currency_br_with_words",
  },
  contract_union_employees: {
    kind: "system",
    key: "integration.union_employees",
  },
  contract_union_employers: {
    kind: "system",
    key: "integration.union_employers",
  },
  contract_cct_registry: {
    kind: "system",
    key: "integration.cct_registry",
  },
  contract_cct_validity: {
    kind: "system",
    key: "integration.cct_validity",
  },
  contract_work_scale: {
    kind: "system",
    key: "integration.work_scale",
  },
  contract_work_hours: {
    kind: "system",
    key: "integration.work_hours",
  },
  contract_workplace_address: {
    kind: "system",
    key: "integration.workplace_address",
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

export const PROBATION_CONTRACT_V3_SOURCE =
  "docs/modelos-documentos/admissionais/01-contrato-experiencia-v3.docx";

export const PROBATION_CONTRACT_V3_HASH =
  "eaa43b298ba99b6a948216152dd8ca58a0c969aa3416d7d3548f91f20c50f3c6";

export const PROBATION_CONTRACT_V3_VARIABLES = [
  "contract_employee_cpf",
  "contract_employer_cnpj",
  "contract_final_end_long",
  "contract_first_end_long",
  "contract_first_period_days",
  "contract_job_cbo",
  "contract_monthly_salary",
  "contract_signature_date_long",
  "contract_signature_place",
  "contract_second_period_days",
  "contract_start_long",
  "employee.address",
  "employee.name",
  "integration.employer_address",
  "integration.employer_name",
  "integration.job_function",
] as const;

export const PROBATION_CONTRACT_V3_FIELD_MAPPING: TemplateFieldMapping = {
  contract_employer_cnpj: {
    kind: "system",
    key: "integration.employer_cnpj",
    formatter: "cnpj_labeled",
  },
  contract_employee_cpf: {
    kind: "system",
    key: "employee.cpf",
    formatter: "cpf_labeled",
  },
  contract_job_cbo: {
    kind: "system",
    key: "integration.job_cbo",
    formatter: "cbo_labeled",
  },
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
  contract_first_period_days: {
    kind: "system",
    key: "integration.probation_first_period_days",
  },
  contract_second_period_days: {
    kind: "system",
    key: "integration.probation_second_period_days",
  },
  contract_final_end_long: {
    kind: "system",
    key: "integration.probation_final_end_date",
    formatter: "date_long_br",
  },
  contract_signature_place: {
    kind: "manual",
    label: "Local da assinatura",
    format: "text",
    required: true,
    defaultValue: "São Luís/MA",
  },
  contract_signature_date_long: {
    kind: "system",
    key: "integration.expected_admission_date",
    formatter: "date_long_br",
  },
};

export const PROBATION_CONTRACT_V4_SOURCE =
  "docs/modelos-documentos/admissionais/01-contrato-experiencia-v4.docx";

export const PROBATION_CONTRACT_V4_HASH =
  "02fe5039827ecc9fdb233d7ef35107da7f0c7988d7e32e16ff988dbd3aa07607";

export const PROBATION_CONTRACT_V4_VARIABLES = [
  "contract_employee_cpf",
  "contract_employer_cnpj",
  "contract_final_end_long",
  "contract_first_end_long",
  "contract_first_period_days",
  "contract_job_cbo",
  "contract_monthly_salary",
  "contract_signature_date_long",
  "contract_signature_place",
  "contract_second_period_days",
  "contract_start_long",
  "employee.address",
  "employee.name",
  "integration.employer_address",
  "integration.employer_legal_name",
  "integration.job_function",
] as const;

export const PROBATION_CONTRACT_V4_FIELD_MAPPING =
  PROBATION_CONTRACT_V3_FIELD_MAPPING;
