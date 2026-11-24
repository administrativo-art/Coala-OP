import type { PixKeyType } from "./types";
import { CnpjValidator } from "@/lib/company/cnpj-validator";
import { isValidCpf } from "@/lib/hr/employee-document-match";

export function normalizeBrazilianDocument(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}
export function normalizePaymentText(value: unknown) {
  return String(value ?? "").trim();
}

export function inferPixKeyType(value: string): PixKeyType {
  const normalized = value.trim();
  const digits = normalized.replace(/\D/g, "");
  if (digits.length === 11 && !normalized.includes("@")) return "cpf";
  if (digits.length === 14 && !normalized.includes("@")) return "cnpj";
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return "email";
  if (/^\+?\d{10,15}$/.test(normalized.replace(/[\s()-]/g, ""))) return "phone";
  return "random";
}

const PIX_KEY_TYPES = new Set<PixKeyType>(["cpf", "cnpj", "email", "phone", "random"]);

export function resolvePixKeyType(value: string, storedType: unknown): PixKeyType {
  const normalized = String(storedType ?? "").trim().toLowerCase() as PixKeyType;
  return PIX_KEY_TYPES.has(normalized) ? normalized : inferPixKeyType(value);
}

export function pixDocumentKeyMatchesHolder(input: {
  pixKey: string;
  pixKeyType?: PixKeyType;
  holderDocument: string;
}) {
  const keyType = input.pixKeyType ?? inferPixKeyType(input.pixKey);
  if (keyType !== "cpf" && keyType !== "cnpj") return true;
  const keyDocument = normalizeBrazilianDocument(input.pixKey);
  const holderDocument = normalizeBrazilianDocument(input.holderDocument);
  return Boolean(keyDocument && holderDocument && keyDocument === holderDocument);
}

export function validBrazilianTaxId(value: unknown) {
  const document = normalizeBrazilianDocument(value);
  return document.length === 11 ? isValidCpf(document) : CnpjValidator.validate(document).valid;
}

/** Canonical Pix destination used by the expense flow and its immutable snapshot. */
export function normalizeValidatedPixKey(value: string, type: PixKeyType, holderDocument: string): string | null {
  const key = value.trim();
  const document = normalizeBrazilianDocument(holderDocument);
  if (!validBrazilianTaxId(document)) return null;
  if (type === "cpf" || type === "cnpj") {
    const digits = normalizeBrazilianDocument(key);
    if (type === "cpf" ? !isValidCpf(digits) : !CnpjValidator.validate(digits).valid) return null;
    return digits === document ? digits : null;
  }
  if (type === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(key) ? key.toLowerCase() : null;
  if (type === "random") return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key) ? key.toLowerCase() : null;
  if (type === "phone") {
    const compact = key.replace(/[\s()-]/g, "");
    if (!/^\+?\d+$/.test(compact)) return null;
    const national = compact.startsWith("+55") ? compact.slice(3) : compact.startsWith("55") && compact.length === 13 ? compact.slice(2) : compact;
    if (!/^[1-9][0-9]9[0-9]{8}$/.test(national)) return null;
    return `+55${national}`;
  }
  return null;
}

export function maskBrazilianDocument(value: unknown) {
  const digits = normalizeBrazilianDocument(value);
  if (digits.length === 11) return `***.***.***-${digits.slice(-2)}`;
  if (digits.length === 14) return `**.***.***/****-${digits.slice(-2)}`;
  if (!digits) return "Não informado";
  return `${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

export function maskPaymentDestination(value: unknown) {
  const text = normalizePaymentText(value);
  if (!text) return "Não configurado";
  if (text.includes("@")) {
    const [name, domain] = text.split("@");
    return `${name.slice(0, 2)}***@${domain}`;
  }
  const visible = text.slice(-4);
  return `${"*".repeat(Math.min(12, Math.max(4, text.length - visible.length)))}${visible}`;
}

export function toIsoString(value: unknown) {
  if (typeof value === "string" && value) return value;
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
}
