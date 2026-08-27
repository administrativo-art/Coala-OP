import type { PixKeyType } from "./types";

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
