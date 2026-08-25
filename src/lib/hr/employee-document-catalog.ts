/**
 * Fase 4 — Catálogo documental enriquecido (fonte única).
 *
 * Une o catálogo-base (`employee-document-options`) com a configuração de
 * processo, duplicidade, nomenclatura, política de acesso e limiares. É a fonte
 * oficial que o backend usa para decidir destino, nome, acesso, duplicidade e
 * versão. A IA só devolve o `code`; toda regra vive aqui.
 *
 * Módulo puro (sem Firestore/Next), testável isoladamente.
 */

import {
  EMPLOYEE_DOCUMENT_TYPE_CATALOG,
  employeeDocumentTypeConfigByCode,
  type EmployeeDocumentTypeConfig,
} from "@/lib/hr/employee-document-options";
import {
  DOCUMENT_TYPE_ACCESS_POLICY,
  type AccessPolicyId,
} from "@/lib/hr/employee-document-access";

/** Como o documento é agrupado em processo/subpasta virtual. */
export type ProcessCategory =
  | "VACATION_INSTALLMENT"
  | "MONTHLY_REFERENCE"
  | "OCCUPATIONAL_EXAM"
  | "LEAVE"
  | "ADMISSION"
  | "TERMINATION"
  | "DISCIPLINARY"
  | "NONE";

export type DuplicateStrategy = "ALLOW" | "WARN" | "BLOCK" | "VERSION";

export interface DocumentTypeEnrichment {
  processCategory: ProcessCategory;
  duplicateStrategy: DuplicateStrategy;
  /** Campos que compõem a chave de duplicidade lógica (além de employeeId+code). */
  duplicateKeys: string[];
  /** Template do nome para download. Placeholders: {employeeCode} {type} {reference} {version} ... */
  downloadNameTemplate: string;
  displayNameTemplate: string;
  confirmationThreshold: number;
  readyThreshold: number;
  /** Campos sem os quais o documento precisa de confirmação humana. */
  requiredFields: string[];
  active: boolean;
}

const DEFAULT_ENRICHMENT: DocumentTypeEnrichment = {
  processCategory: "NONE",
  duplicateStrategy: "WARN",
  duplicateKeys: [],
  downloadNameTemplate: "{employeeCode}__{typeCode}__{reference}__v{version}",
  displayNameTemplate: "{typeName} — {reference}",
  confirmationThreshold: 0.75,
  readyThreshold: 0.85,
  requiredFields: [],
  active: true,
};

const ENRICHMENT: Record<string, Partial<DocumentTypeEnrichment>> = {
  PAYSLIP: {
    processCategory: "MONTHLY_REFERENCE",
    duplicateStrategy: "VERSION",
    duplicateKeys: ["referenceMonth"],
    downloadNameTemplate: "{employeeCode}__CONTRACHEQUE__{referenceMonth}__v{version}",
    displayNameTemplate: "Contracheque — {referenceMonthLabel}",
    requiredFields: ["referenceMonth"],
  },
  VACATION_NOTICE: {
    processCategory: "VACATION_INSTALLMENT",
    duplicateStrategy: "VERSION",
    duplicateKeys: ["acquisitionPeriod", "installmentNumber"],
    downloadNameTemplate: "{employeeCode}__AVISO-FERIAS__PA-{acquisitionPeriod}__P{installmentNumber}__{issueDate}__v{version}",
    displayNameTemplate: "Aviso de férias — PA {acquisitionPeriod} — Parcela {installmentNumber}",
    requiredFields: ["acquisitionPeriodStart", "acquisitionPeriodEnd", "installmentNumber"],
  },
  VACATION_RECEIPT: {
    processCategory: "VACATION_INSTALLMENT",
    duplicateStrategy: "VERSION",
    duplicateKeys: ["acquisitionPeriod", "installmentNumber"],
    downloadNameTemplate: "{employeeCode}__RECIBO-FERIAS__PA-{acquisitionPeriod}__P{installmentNumber}__v{version}",
    displayNameTemplate: "Recibo de férias — PA {acquisitionPeriod} — Parcela {installmentNumber}",
    requiredFields: ["acquisitionPeriodStart", "acquisitionPeriodEnd", "installmentNumber"],
  },
  VACATION_PAYMENT: {
    processCategory: "VACATION_INSTALLMENT",
    duplicateStrategy: "VERSION",
    duplicateKeys: ["acquisitionPeriod", "installmentNumber"],
    downloadNameTemplate: "{employeeCode}__PAGAMENTO-FERIAS__PA-{acquisitionPeriod}__P{installmentNumber}__v{version}",
    displayNameTemplate: "Comprovante de pagamento de férias — PA {acquisitionPeriod} — Parcela {installmentNumber}",
    requiredFields: ["acquisitionPeriodStart", "acquisitionPeriodEnd", "installmentNumber"],
  },
  ASO_ADMISSION: {
    processCategory: "OCCUPATIONAL_EXAM",
    duplicateStrategy: "WARN",
    duplicateKeys: ["examDate"],
    downloadNameTemplate: "{employeeCode}__ASO-ADMISSIONAL__{examDate}__v{version}",
    displayNameTemplate: "ASO admissional — {examDate}",
  },
  ASO_PERIODIC: {
    processCategory: "OCCUPATIONAL_EXAM",
    duplicateStrategy: "WARN",
    duplicateKeys: ["examDate"],
    downloadNameTemplate: "{employeeCode}__ASO-PERIODICO__{examDate}__v{version}",
    displayNameTemplate: "ASO periódico — {examDate}",
  },
  ASO_RETURN: {
    processCategory: "OCCUPATIONAL_EXAM",
    duplicateStrategy: "WARN",
    duplicateKeys: ["examDate"],
    downloadNameTemplate: "{employeeCode}__ASO-RETORNO__{examDate}__v{version}",
    displayNameTemplate: "ASO de retorno — {examDate}",
  },
  ASO_RISK_CHANGE: {
    processCategory: "OCCUPATIONAL_EXAM",
    duplicateStrategy: "WARN",
    duplicateKeys: ["examDate"],
    downloadNameTemplate: "{employeeCode}__ASO-MUDANCA-RISCO__{examDate}__v{version}",
    displayNameTemplate: "ASO de mudança de risco/função — {examDate}",
  },
  ASO_DISMISSAL: {
    processCategory: "OCCUPATIONAL_EXAM",
    duplicateStrategy: "WARN",
    duplicateKeys: ["examDate"],
    downloadNameTemplate: "{employeeCode}__ASO-DEMISSAO__{examDate}__v{version}",
    displayNameTemplate: "ASO demissional — {examDate}",
  },
  DEPENDENT_DOCUMENT: {
    processCategory: "NONE",
    duplicateStrategy: "WARN",
    duplicateKeys: ["dependentName", "dependentBirthDate"],
    downloadNameTemplate: "{employeeCode}__DEPENDENTE__{dependentName}__{dependentBirthDate}__v{version}",
    displayNameTemplate: "Documento de dependente — {dependentName}",
    requiredFields: ["dependentName", "dependentBirthDate"],
  },
  FAMILY_SALARY_TERM: {
    processCategory: "NONE",
    duplicateStrategy: "WARN",
    duplicateKeys: ["issueDate"],
    downloadNameTemplate: "{employeeCode}__SALARIO-FAMILIA-TERMO__{issueDate}__v{version}",
    displayNameTemplate: "Termo de salário-família — {issueDate}",
  },
  VACCINATION_RECORD: {
    processCategory: "NONE",
    duplicateStrategy: "WARN",
    duplicateKeys: ["dependentName", "dependentBirthDate", "issueDate"],
    downloadNameTemplate: "{employeeCode}__VACINACAO__{dependentName}__{issueDate}__v{version}",
    displayNameTemplate: "Caderneta de vacinação — {dependentName}",
  },
  SCHOOL_ATTENDANCE: {
    processCategory: "NONE",
    duplicateStrategy: "WARN",
    duplicateKeys: ["dependentName", "dependentBirthDate", "issueDate"],
    downloadNameTemplate: "{employeeCode}__FREQUENCIA-ESCOLAR__{dependentName}__{issueDate}__v{version}",
    displayNameTemplate: "Frequência escolar — {dependentName}",
  },
  MEDICAL_CERTIFICATE: {
    processCategory: "LEAVE",
    duplicateStrategy: "WARN",
    duplicateKeys: ["startDate"],
    downloadNameTemplate: "{employeeCode}__ATESTADO__{startDate}__v{version}",
    displayNameTemplate: "Atestado médico — {startDate}",
    requiredFields: ["startDate"],
  },
  EMPLOYEE_REGISTRATION: { processCategory: "ADMISSION", duplicateStrategy: "WARN", duplicateKeys: [] },
  ADMISSION_DATA_FORM: { processCategory: "ADMISSION", duplicateStrategy: "VERSION", duplicateKeys: ["admissionDate"] },
  EMPLOYMENT_CONTRACT: { processCategory: "ADMISSION", duplicateStrategy: "WARN", duplicateKeys: ["startDate"] },
  PROBATION_CONTRACT: { processCategory: "ADMISSION", duplicateStrategy: "WARN", duplicateKeys: ["startDate"] },
  PROBATION_EXTENSION: { processCategory: "ADMISSION", duplicateStrategy: "WARN", duplicateKeys: ["startDate"] },
  DISCIPLINARY_WARNING: {
    processCategory: "DISCIPLINARY",
    duplicateStrategy: "WARN",
    duplicateKeys: ["issueDate"],
    downloadNameTemplate: "{employeeCode}__ADVERTENCIA__{issueDate}__v{version}",
  },
  RESIGNATION_REQUEST: { processCategory: "TERMINATION", duplicateStrategy: "WARN", duplicateKeys: ["terminationDate"] },
  TERMINATION_NOTICE: { processCategory: "TERMINATION", duplicateStrategy: "WARN", duplicateKeys: ["terminationDate"] },
  TERMINATION_TERM: { processCategory: "TERMINATION", duplicateStrategy: "WARN", duplicateKeys: ["terminationDate"] },
  TERMINATION_PAYMENT: { processCategory: "TERMINATION", duplicateStrategy: "VERSION", duplicateKeys: ["terminationDate"] },
};

export interface EnrichedDocumentTypeConfig extends EmployeeDocumentTypeConfig, DocumentTypeEnrichment {
  accessPolicyId: AccessPolicyId;
}

/** Configuração oficial completa de um tipo (base + acesso + enriquecimento). */
export function getDocumentTypeConfig(code: string | null | undefined): EnrichedDocumentTypeConfig {
  const base = employeeDocumentTypeConfigByCode(code);
  const enrichment = { ...DEFAULT_ENRICHMENT, ...(ENRICHMENT[base.code] ?? {}) };
  const accessPolicyId = DOCUMENT_TYPE_ACCESS_POLICY[base.code] ?? "HR_RESTRICTED";
  return { ...base, ...enrichment, accessPolicyId };
}

/** Todos os códigos ativos do catálogo (para validação de retorno da IA). */
export function activeDocumentTypeCodes(): string[] {
  return EMPLOYEE_DOCUMENT_TYPE_CATALOG.map((item) => item.code).filter(
    (code) => (ENRICHMENT[code]?.active ?? DEFAULT_ENRICHMENT.active) !== false,
  );
}

export function missingCriticalFields(
  config: Pick<EnrichedDocumentTypeConfig, "requiredFields" | "confirmationThreshold">,
  fields: Record<string, unknown>,
  fieldConfidences: Record<string, number> = {},
): string[] {
  return config.requiredFields.filter((key) => {
    const value = fields[key];
    if (value == null || value === "") return true;
    if (!Object.prototype.hasOwnProperty.call(fieldConfidences, key)) return false;

    const confidence = fieldConfidences[key];
    return !Number.isFinite(confidence) || confidence < config.confirmationThreshold;
  });
}
