import { formatDocumentVariableValue } from "@/features/hr/integration/document-variables";

export const DOCUMENT_OUTPUT_FORMATTERS = [
  "source",
  "date_br",
  "date_long_br",
  "currency_br",
  "currency_br_with_words",
  "cpf_full",
  "cpf_masked",
  "cnpj",
  "cpf_labeled",
  "cnpj_labeled",
  "cbo_labeled",
  "registry_number_labeled",
  "nonbreaking_range",
  "uppercase",
] as const;

export type DocumentOutputFormatter = (typeof DOCUMENT_OUTPUT_FORMATTERS)[number];

const UNITS = [
  "",
  "um",
  "dois",
  "três",
  "quatro",
  "cinco",
  "seis",
  "sete",
  "oito",
  "nove",
];
const TEENS = [
  "dez",
  "onze",
  "doze",
  "treze",
  "quatorze",
  "quinze",
  "dezesseis",
  "dezessete",
  "dezoito",
  "dezenove",
];
const TENS = [
  "",
  "",
  "vinte",
  "trinta",
  "quarenta",
  "cinquenta",
  "sessenta",
  "setenta",
  "oitenta",
  "noventa",
];
const HUNDREDS = [
  "",
  "cento",
  "duzentos",
  "trezentos",
  "quatrocentos",
  "quinhentos",
  "seiscentos",
  "setecentos",
  "oitocentos",
  "novecentos",
];

function underThousand(value: number) {
  if (value === 100) return "cem";
  const parts: string[] = [];
  const hundred = Math.floor(value / 100);
  const remainder = value % 100;
  if (hundred) parts.push(HUNDREDS[hundred]);
  if (remainder >= 10 && remainder < 20) parts.push(TEENS[remainder - 10]);
  else {
    const ten = Math.floor(remainder / 10);
    const unit = remainder % 10;
    if (ten) parts.push(TENS[ten]);
    if (unit) parts.push(UNITS[unit]);
  }
  return parts.filter(Boolean).join(" e ");
}

function integerInWords(value: number) {
  if (value === 0) return "zero";
  if (value < 1_000) return underThousand(value);
  const groups = [
    { size: 1_000_000_000, singular: "bilhão", plural: "bilhões" },
    { size: 1_000_000, singular: "milhão", plural: "milhões" },
    { size: 1_000, singular: "mil", plural: "mil" },
  ];
  let remainder = value;
  const parts: string[] = [];
  for (const group of groups) {
    const count = Math.floor(remainder / group.size);
    if (!count) continue;
    if (group.size === 1_000 && count === 1) parts.push("mil");
    else parts.push(`${integerInWords(count)} ${count === 1 ? group.singular : group.plural}`);
    remainder %= group.size;
  }
  if (remainder) parts.push(underThousand(remainder));
  return parts.join(remainder > 0 && remainder < 100 ? " e " : " ");
}

function currencyWithWords(value: unknown) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "";
  const normalized = Math.round(Math.abs(amount) * 100);
  const reais = Math.floor(normalized / 100);
  const cents = normalized % 100;
  const numeric = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(amount).replace(/^R\$\s+/, "R$\u00A0");
  const words = [
    `${integerInWords(reais)} ${reais === 1 ? "real" : "reais"}`,
    cents ? `${integerInWords(cents)} ${cents === 1 ? "centavo" : "centavos"}` : "",
  ].filter(Boolean).join(" e ");
  return `${numeric} (${amount < 0 ? "menos " : ""}${words})`;
}

function labeledValue(prefix: string, value: unknown) {
  const text = String(value ?? "").trim();
  return text ? `${prefix}\u00A0${text}` : "";
}

function labeledCpf(value: unknown) {
  return labeledValue(
    "CPF",
    formatDocumentVariableValue(value, "cpf"),
  );
}

function labeledCnpj(value: unknown) {
  return labeledValue(
    "CNPJ",
    formatDocumentVariableValue(value, "cnpj"),
  );
}

function labeledCbo(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length === 6
    ? labeledValue("CBO", `${digits.slice(0, 4)}-${digits.slice(4)}`)
    : "";
}

function labeledRegistryNumber(value: unknown) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/^(?:n[º°˚o.]?|número)\s*/iu, "");
  return labeledValue("nº", normalized);
}

function nonbreakingRange(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/\s+a\s+/giu, "\u00A0a\u00A0");
}

function dateLong(value: unknown) {
  const normalized = formatDocumentVariableValue(value, "date_br");
  if (!normalized) return "";
  const [day, month, year] = normalized.split("/").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function formatDocumentOutput(
  value: unknown,
  formatter: DocumentOutputFormatter = "source",
) {
  switch (formatter) {
    case "date_br": return formatDocumentVariableValue(value, "date_br");
    case "date_long_br": return dateLong(value);
    case "currency_br": return formatDocumentVariableValue(value, "currency_br");
    case "currency_br_with_words": return currencyWithWords(value);
    case "cpf_full": return formatDocumentVariableValue(value, "cpf");
    case "cpf_masked": {
      const digits = String(value ?? "").replace(/\D/g, "");
      return digits.length === 11 ? `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**` : "";
    }
    case "cnpj": return formatDocumentVariableValue(value, "cnpj");
    case "cpf_labeled": return labeledCpf(value);
    case "cnpj_labeled": return labeledCnpj(value);
    case "cbo_labeled": return labeledCbo(value);
    case "registry_number_labeled": return labeledRegistryNumber(value);
    case "nonbreaking_range": return nonbreakingRange(value);
    case "uppercase": return String(value ?? "").toLocaleUpperCase("pt-BR");
    case "source":
    default:
      return value;
  }
}
