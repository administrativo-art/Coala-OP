import { DEFAULT_COMPLEMENTARY_FIELDS } from "@/features/rh/lib/default-field-map";
import type { FieldMapEntry, FieldType, FieldVisibility } from "@/types/rh";

export const DOCUMENT_VARIABLE_SCHEMA_VERSION = "coala-documents-v1" as const;
export const DOCUMENT_VARIABLE_COUNT = 87 as const;

export type DocumentVariableSource =
  | "field_value"
  | "employee_record"
  | "user_record"
  | "reference"
  | "computed";

export type DocumentVariableResolutionStep = {
  source: DocumentVariableSource;
  path: string;
  referenceCollection?: string;
};

export type DocumentVariableFormat =
  | "text"
  | "multiline"
  | "date_br"
  | "currency_br"
  | "number_br"
  | "boolean_br"
  | "cpf"
  | "cnpj"
  | "pis"
  | "phone_br"
  | "email"
  | "select_label"
  | "multi_select_labels"
  | "reference_label"
  | "repeatable";

export type DocumentVariableCatalogEntry = {
  key: string;
  placeholder: `{{${string}}}`;
  label: string;
  section: string;
  fieldType: FieldType | "repeatable<object>" | "computed_multiline";
  format: DocumentVariableFormat;
  required: boolean;
  visibility: FieldVisibility;
  sensitive: boolean;
  writable: boolean;
  conditionals: NonNullable<FieldMapEntry["conditionals"]>;
  repeatable: NonNullable<FieldMapEntry["repeatable"]> | null;
  resolution: DocumentVariableResolutionStep[];
};

const SYSTEM_EMAIL_FIELD: FieldMapEntry = {
  bizneo_id: "coala_internal",
  label: "E-mail",
  section: "Documentos e códigos",
  type: "text",
  visibility: "restricted_total",
  employee_visible: false,
  employee_editable: false,
  order: 30,
  lgpd: {
    category: "confidential",
    legal_basis: "legal_obligation",
    retention: "employment_plus_5y",
    requires_consent: false,
  },
};

const SYSTEM_FIELDS: Record<string, FieldMapEntry> = {
  ...DEFAULT_COMPLEMENTARY_FIELDS,
  "system.documents.email": SYSTEM_EMAIL_FIELD,
};

const SYSTEM_RESOLUTION: Record<string, DocumentVariableResolutionStep[]> = {
  "system.documents.registration_bizneo": [{ source: "user_record", path: "registrationIdBizneo" }],
  "system.documents.registration_pdv": [
    { source: "user_record", path: "registrationIdPdv" },
    { source: "user_record", path: "pdvOperatorIds" },
  ],
  "system.documents.email": [{ source: "user_record", path: "email" }],
  "system.documents.access_profile": [{ source: "reference", path: "profileId", referenceCollection: "profiles" }],
  "system.role.job_role": [{ source: "reference", path: "jobRoleId", referenceCollection: "jobRoles" }],
  "system.role.operational": [{ source: "user_record", path: "operacional" }],
  "system.role.goals": [{ source: "user_record", path: "participatesInGoals" }],
  "system.role.functions": [
    { source: "user_record", path: "jobFunctionNames" },
    { source: "reference", path: "jobFunctionIds", referenceCollection: "jobFunctions" },
  ],
  "system.schedule.shift": [{ source: "reference", path: "shiftDefinitionId", referenceCollection: "dp_shiftDefinitions" }],
  "system.schedule.units": [
    { source: "reference", path: "unitIds", referenceCollection: "dp_units" },
    { source: "reference", path: "responsibleUnitIds", referenceCollection: "dp_units" },
  ],
  "system.uniforms.summary": [{ source: "computed", path: "uniforms.summary" }],
  "system.vacations.summary": [{ source: "computed", path: "vacations.summary" }],
  "system.aso.summary": [{ source: "computed", path: "aso.summary" }],
  "system.family_salary.summary": [{ source: "computed", path: "familySalary.summary" }],
  "system.transport_voucher.enabled": [{ source: "user_record", path: "needsTransportVoucher" }],
  "system.behavior.operational": [{ source: "user_record", path: "operacional" }],
  "system.behavior.goals": [{ source: "user_record", path: "participatesInGoals" }],
};

const EMPLOYEE_FALLBACKS: Record<string, DocumentVariableResolutionStep[]> = {
  "employee.name": [
    { source: "employee_record", path: "name" },
    { source: "user_record", path: "username" },
  ],
  "employee.phone": [{ source: "user_record", path: "phone" }],
  "employee.personal_email": [
    { source: "employee_record", path: "email" },
    { source: "user_record", path: "email" },
  ],
  "employee.birth_date": [{ source: "user_record", path: "birthDate" }],
  "employee.has_vt": [{ source: "user_record", path: "needsTransportVoucher" }],
  "employee.vt_daily_value": [{ source: "user_record", path: "transportVoucherValue" }],
  "employee.job_role_id": [{ source: "reference", path: "jobRoleId", referenceCollection: "jobRoles" }],
  "employee.children_under_14": [{ source: "computed", path: "children.under14Count" }],
};

function fieldFormat(key: string, field: FieldMapEntry): DocumentVariableFormat {
  if (key === "employee.cpf") return "cpf";
  if (key === "employee.employer_cnpj") return "cnpj";
  if (key === "employee.pis") return "pis";
  if (key === "employee.phone" || key === "employee.emergency_phone") return "phone_br";
  if (key === "employee.personal_email" || key === "system.documents.email") return "email";
  if (key === "employee.children") return "repeatable";

  if (field.type === "date") return "date_br";
  if (field.type === "currency") return "currency_br";
  if (field.type === "number") return "number_br";
  if (field.type === "boolean") return "boolean_br";
  if (field.type === "single_select") return "select_label";
  if (field.type === "multi_select") return "multi_select_labels";
  if (field.type.startsWith("ref:")) return "reference_label";
  if (field.type === "multiline") return "multiline";
  return "text";
}

function fieldResolution(key: string): DocumentVariableResolutionStep[] {
  const system = SYSTEM_RESOLUTION[key];
  if (system) return system;

  const base: DocumentVariableResolutionStep = { source: "field_value", path: key };
  const special = EMPLOYEE_FALLBACKS[key] ?? [];
  if (key === "employee.has_vt" || key === "employee.vt_daily_value") {
    return [...special, base];
  }
  if (key === "employee.children_under_14") return [...special, base];
  return [base, ...special];
}

function isSensitive(field: FieldMapEntry) {
  return field.lgpd?.category === "sensitive" || field.visibility === "confidential";
}

function buildCatalogEntry(key: string, field: FieldMapEntry): DocumentVariableCatalogEntry {
  const repeatable = field.repeatable ?? field.group?.repeatable ?? null;
  const computedSummary = key.startsWith("system.") && key.endsWith(".summary");
  return {
    key,
    placeholder: `{{${key}}}`,
    label: field.label,
    section: field.section,
    fieldType: key === "employee.children"
      ? "repeatable<object>"
      : computedSummary
        ? "computed_multiline"
        : field.type,
    format: fieldFormat(key, field),
    required: field.required === true,
    visibility: field.visibility,
    sensitive: isSensitive(field),
    writable: key.startsWith("employee.") && field.employee_editable === true,
    conditionals: field.conditionals ?? [],
    repeatable,
    resolution: fieldResolution(key),
  };
}

export const DOCUMENT_VARIABLE_CATALOG = Object.freeze(
  Object.fromEntries(
    Object.entries(SYSTEM_FIELDS)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, field]) => [key, buildCatalogEntry(key, field)]),
  ) as Record<string, DocumentVariableCatalogEntry>,
);

export const DOCUMENT_VARIABLES = Object.freeze(Object.values(DOCUMENT_VARIABLE_CATALOG));

export function isDocumentVariableKey(value: string): value is keyof typeof DOCUMENT_VARIABLE_CATALOG {
  return Object.prototype.hasOwnProperty.call(DOCUMENT_VARIABLE_CATALOG, value);
}

export function getDocumentVariable(value: string) {
  return DOCUMENT_VARIABLE_CATALOG[value] ?? null;
}

function digits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function maskCpf(value: unknown) {
  const raw = digits(value);
  return raw.length === 11 ? raw.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : String(value ?? "");
}

function maskCnpj(value: unknown) {
  const raw = digits(value);
  return raw.length === 14
    ? raw.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5")
    : String(value ?? "");
}

function maskPis(value: unknown) {
  const raw = digits(value);
  return raw.length === 11 ? raw.replace(/(\d{3})(\d{5})(\d{2})(\d)/, "$1.$2.$3-$4") : String(value ?? "");
}

function maskPhone(value: unknown) {
  const raw = digits(value);
  if (raw.length === 11) return raw.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  if (raw.length === 10) return raw.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  return String(value ?? "");
}

function toDate(value: unknown): Date | null {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (value && typeof value === "object" && "toDate" in value) {
    const maybeToDate = (value as { toDate?: unknown }).toDate;
    if (typeof maybeToDate === "function") return maybeToDate.call(value) as Date;
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function labelValue(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return String(record.label ?? record.name ?? record.value ?? "");
  }
  return String(value ?? "");
}

export function formatDocumentVariableValue(
  value: unknown,
  format: DocumentVariableFormat,
  locale = "pt-BR",
) {
  if (value === null || value === undefined || value === "") return "";

  switch (format) {
    case "date_br": {
      const date = toDate(value);
      return date
        ? new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" }).format(date)
        : "";
    }
    case "currency_br": {
      const number = Number(value);
      return Number.isFinite(number)
        ? new Intl.NumberFormat(locale, { style: "currency", currency: "BRL" }).format(number)
        : "";
    }
    case "number_br": {
      const number = Number(value);
      return Number.isFinite(number) ? new Intl.NumberFormat(locale).format(number) : "";
    }
    case "boolean_br":
      return value === true ? "Sim" : value === false ? "Não" : "";
    case "cpf":
      return maskCpf(value);
    case "cnpj":
      return maskCnpj(value);
    case "pis":
      return maskPis(value);
    case "phone_br":
      return maskPhone(value);
    case "email":
      return String(value).trim().toLowerCase();
    case "multi_select_labels":
      return Array.isArray(value) ? value.map(labelValue).filter(Boolean).join(", ") : labelValue(value);
    case "select_label":
    case "reference_label":
      return labelValue(value);
    case "repeatable":
      return "";
    case "multiline":
    case "text":
    default:
      return typeof value === "object" ? labelValue(value) : String(value);
  }
}

