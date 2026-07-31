import {
  DOCUMENT_VARIABLES,
  formatDocumentVariableValue,
  isDocumentVariableKey,
} from "@/features/hr/integration/document-variables";
import {
  DOCUMENT_OUTPUT_FORMATTERS,
  formatDocumentOutput,
  type DocumentOutputFormatter,
} from "@/features/hr/documents/document-output-formatters";

/** Sub-chaves usadas dentro de loops repetíveis (ex.: filhos) — válidas sem mapeamento. */
export const LEGACY_LOOP_KEYS = ["name", "cpf", "birth_date", "relation"] as const;

export const MANUAL_FIELD_FORMATS = [
  "text",
  "multiline",
  "date_br",
  "currency_br",
  "number_br",
  "boolean_br",
  "select",
  "cbo",
  "cpf",
  "cnpj",
  "cep",
  "time_br",
] as const;
export type ManualFieldFormat = (typeof MANUAL_FIELD_FORMATS)[number];

export const MANUAL_FIELD_FORMAT_LABELS: Record<ManualFieldFormat, string> = {
  text: "Texto",
  multiline: "Texto longo",
  date_br: "Data",
  currency_br: "Moeda (R$)",
  number_br: "Número",
  boolean_br: "Sim/Não",
  select: "Lista de opções",
  cbo: "CBO",
  cpf: "CPF",
  cnpj: "CNPJ",
  cep: "CEP",
  time_br: "Horário",
};

export type SystemFieldBinding = {
  kind: "system";
  key: string;
  formatter?: DocumentOutputFormatter;
  /** Campos mapeados são obrigatórios por padrão; use false apenas para blocos opcionais. */
  required?: boolean;
};
export type ManualFieldBinding = {
  kind: "manual";
  label: string;
  format: ManualFieldFormat;
  required: boolean;
  helpText?: string;
  options?: string[];
  defaultValue?: string;
};
export type TemplateFieldBinding = SystemFieldBinding | ManualFieldBinding;
/** Chave = placeholder do DOCX sem chaves (ex.: "valor_recibo"). */
export type TemplateFieldMapping = Record<string, TemplateFieldBinding>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Sanitiza o mapeamento vindo do cliente, mantendo apenas entradas válidas para os placeholders do modelo. */
export function normalizeFieldMapping(input: unknown, variables: string[]): TemplateFieldMapping {
  if (!isRecord(input)) return {};
  const known = new Set(variables);
  const mapping: TemplateFieldMapping = {};
  for (const [placeholder, raw] of Object.entries(input)) {
    if (!known.has(placeholder) || !isRecord(raw)) continue;
    if (raw.kind === "system") {
      if (typeof raw.key === "string" && isDocumentVariableKey(raw.key)) {
        const formatter = DOCUMENT_OUTPUT_FORMATTERS.includes(raw.formatter as DocumentOutputFormatter)
          ? raw.formatter as DocumentOutputFormatter
          : undefined;
        mapping[placeholder] = {
          kind: "system",
          key: raw.key,
          ...(formatter && formatter !== "source" ? { formatter } : {}),
          ...(raw.required === false ? { required: false } : {}),
        };
      }
      continue;
    }
    if (raw.kind !== "manual") continue;
    const label = typeof raw.label === "string" ? raw.label.trim().slice(0, 120) : "";
    const format = MANUAL_FIELD_FORMATS.includes(raw.format as ManualFieldFormat)
      ? (raw.format as ManualFieldFormat)
      : "text";
    if (!label) continue;
    const options = Array.isArray(raw.options)
      ? raw.options.filter((item): item is string => typeof item === "string" && !!item.trim()).map((item) => item.trim().slice(0, 120)).slice(0, 50)
      : undefined;
    const binding: ManualFieldBinding = { kind: "manual", label, format, required: raw.required === true };
    if (typeof raw.helpText === "string" && raw.helpText.trim()) binding.helpText = raw.helpText.trim().slice(0, 240);
    if (format === "select" && options?.length) binding.options = options;
    if (typeof raw.defaultValue === "string" && raw.defaultValue.trim()) binding.defaultValue = raw.defaultValue.trim().slice(0, 240);
    mapping[placeholder] = binding;
  }
  return mapping;
}

/** Placeholders do modelo que ainda não têm origem definida (nem catálogo, nem mapeamento). */
export function pendingPlaceholders(variables: string[], mapping: TemplateFieldMapping): string[] {
  return variables.filter(
    (key) =>
      !isDocumentVariableKey(key) &&
      !(LEGACY_LOOP_KEYS as readonly string[]).includes(key) &&
      !mapping[key],
  );
}

function normalizeForMatch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Sugere uma variável do catálogo para um placeholder livre, comparando com labels e chaves. */
export function suggestSystemKey(placeholder: string): string | null {
  const target = normalizeForMatch(placeholder);
  if (!target) return null;
  let best: { key: string; score: number } | null = null;
  for (const entry of DOCUMENT_VARIABLES) {
    if (entry.format === "repeatable") continue;
    const label = normalizeForMatch(entry.label);
    const keyTail = normalizeForMatch(entry.key.split(".").pop() ?? "");
    let score = 0;
    if (label === target || keyTail === target) score = 3;
    else if (label.includes(target) || target.includes(label)) score = 2;
    else {
      const targetTokens = new Set(target.split(" "));
      const overlap = label.split(" ").filter((token) => targetTokens.has(token)).length;
      if (overlap && overlap >= Math.min(2, targetTokens.size)) score = 1;
    }
    if (score > (best?.score ?? 0)) best = { key: entry.key, score };
  }
  return best?.key ?? null;
}

export function parseManualNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  let normalized = value.replace(/\s|R\$/g, "");
  if (normalized.includes(",")) normalized = normalized.replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Formata um valor informado na geração conforme o tipo configurado no campo manual. */
export function formatManualValue(value: unknown, format: ManualFieldFormat): string {
  if (value === null || value === undefined || value === "") return "";
  switch (format) {
    case "date_br":
      return formatDocumentVariableValue(value, "date_br");
    case "currency_br":
    case "number_br": {
      const parsed = parseManualNumber(value);
      return parsed === null ? "" : formatDocumentVariableValue(parsed, format);
    }
    case "boolean_br": {
      if (value === true || value === "true" || value === "Sim" || value === "sim") return "Sim";
      if (value === false || value === "false" || value === "Não" || value === "nao" || value === "não") return "Não";
      return "";
    }
    case "cbo": {
      const digits = String(value).replace(/\D/g, "");
      return digits.length === 6
        ? `CBO\u00A0${digits.slice(0, 4)}-${digits.slice(4)}`
        : "";
    }
    case "cpf":
      return formatDocumentVariableValue(value, "cpf");
    case "cnpj":
      return formatDocumentVariableValue(value, "cnpj");
    case "cep": {
      const digits = String(value).replace(/\D/g, "");
      return digits.length === 8 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : "";
    }
    case "time_br": {
      const text = String(value).trim();
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text)) return "";
      return text;
    }
    case "multiline":
    case "select":
    case "text":
    default:
      return String(value).trim();
  }
}

function setPath(root: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".");
  let cursor = root;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) cursor[part] = value;
    else {
      const next = cursor[part];
      cursor = cursor[part] = isRecord(next) ? next : {};
    }
  });
}

export type ApplyFieldMappingResult = {
  data: Record<string, unknown>;
  /** Labels dos campos manuais obrigatórios sem valor. */
  missingManual: string[];
  /** Placeholders ligados ao sistema que não foram resolvidos. */
  missingSystem: string[];
};

/**
 * Injeta no payload de geração os valores dos placeholders mapeados: campos de sistema
 * copiam o valor já resolvido/formatado da variável do catálogo; campos manuais usam o
 * valor informado na geração, formatado conforme o tipo configurado.
 */
export function applyFieldMapping(params: {
  data: Record<string, unknown>;
  flat: Record<string, unknown>;
  rawFlat?: Record<string, unknown>;
  mapping: TemplateFieldMapping;
  manualValues?: Record<string, unknown>;
}): ApplyFieldMappingResult {
  const data = params.data;
  const missingManual: string[] = [];
  const missingSystem: string[] = [];
  for (const [placeholder, binding] of Object.entries(params.mapping)) {
    if (binding.kind === "system") {
      const sourceValue = binding.formatter
        ? params.rawFlat?.[binding.key] ?? params.flat[binding.key]
        : params.flat[binding.key];
      const formatted = binding.formatter
        ? formatDocumentOutput(sourceValue, binding.formatter)
        : sourceValue ?? "";
      const empty = formatted === null
        || formatted === undefined
        || formatted === ""
        || (Array.isArray(formatted) && formatted.length === 0);
      if (binding.required !== false && empty) missingSystem.push(placeholder);
      setPath(
        data,
        placeholder,
        formatted,
      );
      continue;
    }
    const raw = params.manualValues?.[placeholder] ?? binding.defaultValue;
    const formatted = formatManualValue(raw, binding.format);
    if (binding.required && !formatted) missingManual.push(binding.label);
    setPath(data, placeholder, formatted);
  }
  return { data, missingManual, missingSystem };
}
