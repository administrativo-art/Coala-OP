import { isIP } from "node:net";

import { trustedFinancialDocumentProvider } from "./trusted-document-providers";

const DOCUMENT_TERMS = /(?:boleto|fatura|invoice|cobranca|cobran[cç]a|documento|arquivo|download|segunda.?via|conta|guia|nfse|nota.?fiscal|pdf|xml)/i;
const REJECTED_TERMS = /(?:unsubscribe|descadastrar|optout|preferencias|privacy|privacidade|marketing|tracking)/i;

function normalizedDomain(value: string) {
  return value.trim().toLowerCase().replace(/^\*\./, "").replace(/^\.+|\.+$/g, "");
}

export function registrableDomain(hostname: string) {
  const labels = normalizedDomain(hostname).split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const brazilianSecondLevel = new Set(["com", "net", "org", "gov", "edu"]);
  return labels.at(-1) === "br" && brazilianSecondLevel.has(labels.at(-2) ?? "")
    ? labels.slice(-3).join(".")
    : labels.slice(-2).join(".");
}

function hostMatches(hostname: string, allowedDomain: string) {
  const host = normalizedDomain(hostname);
  const allowed = normalizedDomain(allowedDomain);
  return Boolean(host && allowed && (host === allowed || host.endsWith(`.${allowed}`)));
}

/**
 * Plataformas documentais conhecidas podem entregar boletos e notas em nome de
 * vários fornecedores. A confiança é limitada ao host e às rotas públicas de
 * documento, nunca ao domínio inteiro da plataforma.
 */
export function isTrustedFinancialDocumentProviderUrl(url: URL) {
  return trustedFinancialDocumentProvider(url) !== null;
}

export function configuredFinancialDocumentDomains(value = process.env.FINANCIAL_INBOX_DOCUMENT_DOMAINS ?? "") {
  return value.split(",").map(normalizedDomain).filter(Boolean);
}

export function isPrivateNetworkAddress(address: string) {
  if (address === "::1" || address === "0:0:0:0:0:0:0:1") return true;
  if (address.toLowerCase().startsWith("fc") || address.toLowerCase().startsWith("fd") || address.toLowerCase().startsWith("fe80:")) return true;
  if (address.startsWith("::ffff:")) return isPrivateNetworkAddress(address.slice(7));
  if (isIP(address) !== 4) return false;
  const parts = address.split(".").map(Number);
  return parts[0] === 10
    || parts[0] === 127
    || parts[0] === 0
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
    || (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19))
    || parts[0] >= 224;
}

export function isAllowedFinancialDocumentUrl(
  rawUrl: string,
  senderDomain: string | null,
  configuredDomains = configuredFinancialDocumentDomains(),
) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
    const hostname = normalizedDomain(url.hostname);
    if (!hostname || hostname === "localhost" || hostname.endsWith(".local") || isIP(hostname)) return false;
    const senderRoot = senderDomain ? registrableDomain(senderDomain) : "";
    return isTrustedFinancialDocumentProviderUrl(url)
      || (senderRoot ? hostMatches(hostname, senderRoot) : false)
      || configuredDomains.some((domain) => hostMatches(hostname, domain));
  } catch {
    return false;
  }
}

export function isLikelyFinancialDocumentUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    const searchable = `${url.hostname}${decodeURIComponent(url.pathname)}${decodeURIComponent(url.search)}`;
    return !REJECTED_TERMS.test(searchable) && DOCUMENT_TERMS.test(searchable);
  } catch {
    return false;
  }
}

export function safeFinancialDocumentSourceUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    url.search = "";
    url.hash = "";
    return url.toString().slice(0, 1000);
  } catch {
    return null;
  }
}
