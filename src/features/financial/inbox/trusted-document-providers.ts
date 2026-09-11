export type TrustedFinancialDocumentProvider = {
  key: "superlogica" | "maximus" | "acessorias";
  name: string;
};

function normalizedDomain(value: string) {
  return value.trim().toLowerCase().replace(/^\*\./, "").replace(/^\.+|\.+$/g, "");
}

function hostMatches(hostname: string, allowedDomain: string) {
  const host = normalizedDomain(hostname);
  const allowed = normalizedDomain(allowedDomain);
  return Boolean(host && allowed && (host === allowed || host.endsWith(`.${allowed}`)));
}

function parsedSecureUrl(rawUrl: string | URL) {
  try {
    const url = rawUrl instanceof URL ? rawUrl : new URL(rawUrl);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
    const hostname = normalizedDomain(url.hostname);
    if (!hostname || hostname === "localhost" || hostname.endsWith(".local")) return null;
    return { url, hostname, pathname: url.pathname.replace(/\/{2,}/g, "/") };
  } catch {
    return null;
  }
}

/**
 * Allowlist independente do remetente. Cada provedor é autorizado somente no
 * host e na rota usados para entregar documentos financeiros públicos.
 */
export function trustedFinancialDocumentProvider(
  rawUrl: string | URL,
): TrustedFinancialDocumentProvider | null {
  const parsed = parsedSecureUrl(rawUrl);
  if (!parsed) return null;
  const { hostname, pathname } = parsed;

  if (hostMatches(hostname, "superlogica.net")
    && /^\/clients\/areadocliente\/publico\/(?:cobranca\/|espelhonfsepdf\/?$)/i.test(pathname)) {
    return { key: "superlogica", name: "Superlógica — plataforma de cobrança" };
  }

  if (hostname === "documentos.grupomse.com" && /^\/guia\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/i.test(pathname)) {
    return { key: "maximus", name: "Maximus / Grupo MSE" };
  }

  if (hostname === "app.acessorias.com" && pathname.toLowerCase() === "/getguia.php") {
    return { key: "acessorias", name: "Acessórias — plataforma documental" };
  }

  if (hostname === "acessorias.s3.us-east-2.amazonaws.com"
    && /^\/econtinuo\/.+\.(?:pdf|xml|png|jpe?g)$/i.test(pathname)) {
    return { key: "acessorias", name: "Acessórias — armazenamento documental" };
  }

  return null;
}
