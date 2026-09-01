import {
  formatManualValue,
  type ManualFieldBinding,
  type TemplateFieldMapping,
} from "@/features/hr/documents/field-mapping";
import { formatDocumentOutput } from "@/features/hr/documents/document-output-formatters";
import {
  DOCUMENT_VARIABLES,
  formatDocumentVariableValue,
  type DocumentVariableCatalogEntry,
} from "@/features/hr/integration/document-variables";

const DEMO_RAW_VALUES: Record<string, unknown> = {
  "employee.name": "Marina Costa Almeida",
  "employee.cpf": "52998224725",
  "employee.rg": "1234567",
  "employee.email": "marina.almeida@exemplo.com",
  "employee.address": "Rua das Flores, 120, Centro, São Luís/MA, CEP 65010-000",
  "employee.ctps_number": "1234567",
  "employee.ctps_series": "0001/MA",
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
  "receipt.city": "São Luís",
  "receipt.state": "MA",
  "receipt.direction": "Pagamos",
  "receipt.issueDate": "2026-07-30",
  "receipt.issuer.snapshot.document": "14276603000125",
  "receipt.issuer.snapshot.name": "Coala Shakes Alimentos LTDA",
  "receipt.items": [
    {
      name: "Manutenção",
      description: "Serviço de manutenção preventiva",
      value: "R$ 350,00",
    },
    {
      name: "Materiais",
      description: "Reposição de materiais",
      value: "R$ 125,00",
    },
  ],
  "receipt.number": "REC-2026-000112",
  "receipt.payment.account": "12345-6",
  "receipt.payment.agency": "0001",
  "receipt.payment.bank": "Banco de exemplo",
  "receipt.payment.method": "Pix",
  "receipt.payment.methodLabel": "Pix",
  "receipt.payment.pixKey": "financeiro@exemplo.com",
  "receipt.recipient.snapshot.document": "52998224725",
  "receipt.recipient.snapshot.name": "Marina Costa Almeida",
  "receipt.total": "R$\u00A0475,00",
  "receipt.totalWithWords": "R$ 475,00 (quatrocentos e setenta e cinco reais)",
};

function setPath(root: Record<string, unknown>, key: string, value: unknown) {
  const parts = key.split(".");
  let cursor = root;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      cursor[part] = value;
      return;
    }
    const existing = cursor[part];
    cursor[part] = existing && typeof existing === "object" && !Array.isArray(existing)
      ? existing
      : {};
    cursor = cursor[part] as Record<string, unknown>;
  });
}

function rawDemoValue(entry: DocumentVariableCatalogEntry) {
  if (DEMO_RAW_VALUES[entry.key] !== undefined) return DEMO_RAW_VALUES[entry.key];
  if (entry.format === "date_br") return "2026-07-30";
  if (entry.format === "currency_br") return 1787.3;
  if (entry.format === "cpf") return "52998224725";
  if (entry.format === "cnpj") return "14276603000125";
  if (entry.format === "phone_br") return "98988887777";
  if (entry.format === "boolean_br") return true;
  if (entry.format === "checkbox_mark") return true;
  if (entry.format === "number_br") return 1;
  if (entry.format === "repeatable") return [];
  return `Exemplo de ${entry.label.toLocaleLowerCase("pt-BR")}`;
}

function catalogDemoValue(key: string, formatter?: Parameters<typeof formatDocumentOutput>[1]) {
  const entry = DOCUMENT_VARIABLES.find((candidate) => candidate.key === key);
  if (!entry) return DEMO_RAW_VALUES[key] ?? `Exemplo de ${key}`;
  const raw = rawDemoValue(entry);
  return formatter
    ? formatDocumentOutput(raw, formatter)
    : formatDocumentVariableValue(raw, entry.format);
}

function manualDemoValue(binding: ManualFieldBinding) {
  if (binding.defaultValue) return formatManualValue(binding.defaultValue, binding.format);
  const rawByFormat: Record<ManualFieldBinding["format"], unknown> = {
    text: `Exemplo de ${binding.label.toLocaleLowerCase("pt-BR")}`,
    multiline: `Texto fictício para demonstrar o preenchimento de ${binding.label.toLocaleLowerCase("pt-BR")}.`,
    date_br: "2026-07-30",
    currency_br: 475,
    number_br: 1,
    boolean_br: true,
    select: binding.options?.[0] ?? "Opção de exemplo",
    cbo: "513415",
    cpf: "52998224725",
    cnpj: "14276603000125",
    cep: "65010000",
    time_br: "14:00",
  };
  return formatManualValue(rawByFormat[binding.format], binding.format);
}

/**
 * Produz uma prévia realista sem consultar cadastros nem persistir uma geração.
 * Os valores são deliberadamente fictícios e exercitam os mesmos formatadores
 * e mapeamentos usados pelo motor de geração.
 */
export function buildDocumentTemplateDemoData(params: {
  variables: string[];
  fieldMapping?: TemplateFieldMapping;
}) {
  const data: Record<string, unknown> = {};
  const mapping = params.fieldMapping ?? {};

  params.variables.forEach((placeholder) => {
    const binding = mapping[placeholder];
    if (binding?.kind === "system") {
      setPath(data, placeholder, catalogDemoValue(binding.key, binding.formatter));
      return;
    }
    if (binding?.kind === "manual") {
      setPath(data, placeholder, manualDemoValue(binding));
      return;
    }
    setPath(data, placeholder, catalogDemoValue(placeholder));
  });

  return data;
}
