import type {
  FinancialInboxClassification,
  FinancialInboxDocumentType,
} from "./types";

const MAX_LINKS = 20;
const MAX_TEXT_LENGTH = 80_000;

function decodeBasicEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

export function htmlToPlainText(value: string) {
  return decodeBasicEntities(
    value
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>|<\/div>|<\/li>|<\/tr>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

export function extractEmailAddress(value: string) {
  const angle = value.match(/<([^<>\s]+@[^<>\s]+)>/);
  const plain = value.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  return (angle?.[1] ?? plain?.[0] ?? "").trim().toLowerCase() || null;
}

function normalizeUrl(raw: string) {
  const trimmed = decodeBasicEntities(raw).replace(/[),.;]+$/, "").trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

export function extractExternalLinks(text: string, html: string) {
  const candidates: string[] = [];
  for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) candidates.push(match[1]);
  for (const match of `${text}\n${html}`.matchAll(/https?:\/\/[^\s<>"']+/gi)) candidates.push(match[0]);
  const result: string[] = [];
  for (const candidate of candidates) {
    const normalized = normalizeUrl(candidate);
    if (!normalized || result.includes(normalized)) continue;
    result.push(normalized);
    if (result.length >= MAX_LINKS) break;
  }
  return result;
}

function isoDate(day: string, month: string, year: string) {
  const parsedDay = Number(day);
  const parsedMonth = Number(month);
  const parsedYear = Number(year);
  if (parsedYear < 2000 || parsedYear > 2100 || parsedMonth < 1 || parsedMonth > 12 || parsedDay < 1 || parsedDay > 31) return null;
  return `${String(parsedYear).padStart(4, "0")}-${String(parsedMonth).padStart(2, "0")}-${String(parsedDay).padStart(2, "0")}`;
}

function extractDueDate(value: string) {
  const labeled = value.match(/(?:venc(?:imento|e(?:\s+em)?)|data\s+de\s+vencimento)\s*[:\-]?\s*(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/i);
  if (labeled) return isoDate(labeled[1], labeled[2], labeled[3]);
  return null;
}

function extractCompetence(value: string) {
  const match = value.match(/compet[eê]ncia(?:\s+de)?\s*[:\-]?\s*(0?[1-9]|1[0-2])[\/.-](20\d{2})/i);
  if (!match) return null;
  return `${match[2]}-${String(Number(match[1])).padStart(2, "0")}`;
}

function amountToCents(raw: string) {
  const normalized = raw.replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : null;
}

function extractAmount(value: string) {
  const labeled = value.match(/(?:valor(?:\s+(?:total|da\s+(?:fatura|guia|cobran[cç]a)))?|total)\s*[:\-]?\s*R\$\s*([\d.]+,\d{2})/i);
  if (labeled) return amountToCents(labeled[1]);
  const currency = value.match(/R\$\s*([\d.]+,\d{2})/i);
  return currency ? amountToCents(currency[1]) : null;
}

export function normalizePaymentBarcode(value: string) {
  const digits = value.replace(/\D/g, "");
  return [44, 46, 47, 48].includes(digits.length) ? digits : null;
}

export function extractPaymentBarcode(value: string) {
  const labeled = value.match(/(?:linha\s+digit[aá]vel|c[oó]digo\s+de\s+barras|c[oó]d(?:igo)?\s+barra)\s*[:\-]?\s*([\d.\s-]{44,70})/i);
  const candidates = [
    labeled?.[1],
    ...Array.from(value.matchAll(/(?<!\d)([\d][\d.\s-]{42,68}[\d])(?!\d)/g), (match) => match[1]),
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    const normalized = normalizePaymentBarcode(candidate);
    if (normalized) return normalized;
  }
  return null;
}

export function maskPaymentBarcode(value: string | null) {
  if (!value) return null;
  return `${value.slice(0, 5)}••••••••••••••••••••••••••••••••••${value.slice(-5)}`;
}

function documentType(value: string): { type: FinancialInboxDocumentType; confidence: "high" | "medium" | "low" } {
  if (/\bfgts\b/i.test(value)) return { type: "fgts", confidence: "high" };
  if (/\binss\b|\bdarf\b/i.test(value)) return { type: "inss_darf", confidence: "high" };
  if (/honor[aá]rio\s+cont[aá]bil|mensalidade\s+cont[aá]bil/i.test(value)) return { type: "accounting_fee", confidence: "high" };
  if (/\b(?:das|dare|iss|icms|simples\s+nacional|tributo|imposto)\b/i.test(value)) return { type: "tax", confidence: "medium" };
  if (/\b(?:energia|telefone|telefonia|internet|[aá]gua|fatura\s+vivo)\b/i.test(value)) return { type: "utility_bill", confidence: "medium" };
  if (/\b(?:boleto|cobran[cç]a|fatura|vencimento|pagar)\b/i.test(value)) return { type: "charge", confidence: "medium" };
  return { type: "other", confidence: "low" };
}

function supplierName(senderDomain: string | null, value: string) {
  if (senderDomain === "grupomse.com" || /maximus\s+contabilidade/i.test(value)) return "Maximus Contabilidade / Grupo MSE";
  return null;
}

export function classifyFinancialEmail(input: {
  subject: string;
  text?: string | null;
  html?: string | null;
  senderDomain?: string | null;
}): { textContent: string; textPreview: string; classification: FinancialInboxClassification } {
  const textContent = (input.text?.trim() || htmlToPlainText(input.html ?? "")).slice(0, MAX_TEXT_LENGTH);
  const combined = `${input.subject}\n${textContent}`;
  const identified = documentType(combined);
  const barcode = extractPaymentBarcode(combined);
  return {
    textContent,
    textPreview: textContent.replace(/\s+/g, " ").trim().slice(0, 500),
    classification: {
      documentType: identified.type,
      financeLikely: identified.type !== "other",
      confidence: identified.confidence,
      supplierName: supplierName(input.senderDomain ?? null, combined),
      competence: extractCompetence(combined),
      dueDate: extractDueDate(combined),
      amountCents: extractAmount(combined),
      barcode,
      barcodeMasked: maskPaymentBarcode(barcode),
      links: extractExternalLinks(input.text ?? "", input.html ?? ""),
    },
  };
}
