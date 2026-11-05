import { cloudRunIdentityAuthorization } from "@/features/hr/documents/cloud-run-auth.server";

/**
 * Conversor HTML -> PDF via Gotenberg (módulo Chromium).
 *
 * Reutiliza as variáveis do serviço DOCX->PDF já configurado (mesmo serviço
 * Gotenberg): DOCX_TO_PDF_URL, DOCX_TO_PDF_AUDIENCE e DOCX_TO_PDF_ID_TOKEN.
 * Não há motivo para nomes novos enquanto for o mesmo serviço.
 *
 * Diferenças deliberadas em relação a pdf-converter.server.ts:
 * - nunca executa processos (sem fallback `gcloud`): só token de ambiente ou
 *   identidade do Cloud Run; falha de autenticação vira `auth_failed`;
 * - sem cache global: o HTML varia por documento/pessoa e o conteúdo pode
 *   conter dados pessoais; guardar PDFs em memória do processo não compensa
 *   o risco de retenção e de vazamento entre escopos;
 * - não registra log algum: o chamador recebe só `reason` e decide o
 *   tratamento (não há sink novo; erro interno nunca é exposto).
 */

export const HTML_PDF_TIMEOUT_MS = 60_000;
export const HTML_PDF_MAX_INPUT_BYTES = 5 * 1024 * 1024;
export const HTML_PDF_MAX_OUTPUT_BYTES = 50 * 1024 * 1024;
/**
 * Conversões simultâneas por processo. O excedente NÃO espera: devolve `upstream_busy` na hora
 * (a rota mapeia para 503 fixo e retryable). Esperar manteria o HTML (dado pessoal) e a requisição
 * em memória por até o timeout e empilharia filas no Chromium; falhar rápido é previsível e o
 * rascunho continua salvo. É um freio por instância, não um limite global entre instâncias.
 */
export const HTML_PDF_MAX_CONCURRENT = 3;
let activeConversions = 0;
const CHROMIUM_HTML_PATH = "/forms/chromium/convert/html";
const PX_PER_INCH = 96;

export type HtmlPdfFailureReason =
  | "not_configured"
  | "auth_failed"
  | "timeout"
  | "upstream_error"
  | "upstream_busy"
  | "invalid_response"
  | "too_large"
  | "invalid_input";

export type HtmlPdfResult =
  | { ok: true; pdf: Buffer }
  | { ok: false; reason: HtmlPdfFailureReason };

export interface HtmlPdfOptions {
  paper?: { widthPx: number; heightPx: number };
  margins?: { topPx: number; bottomPx: number; leftPx: number; rightPx: number };
  deps?: {
    fetch?: typeof fetch;
    env?: Record<string, string | undefined>;
    authorize?: (audience: string) => Promise<string | null>;
    timeoutMs?: number;
  };
}

const fail = (reason: HtmlPdfFailureReason): HtmlPdfResult => ({ ok: false, reason });
const inches = (px: number) => String(Number((px / PX_PER_INCH).toFixed(4)));
const validPx = (value: number) => Number.isFinite(value) && value >= 0 && value <= 20_000;

export async function convertHtmlToPdf(
  html: string,
  options: HtmlPdfOptions = {},
): Promise<HtmlPdfResult> {
  if (
    typeof html !== "string" ||
    !html.trim() ||
    Buffer.byteLength(html, "utf8") > HTML_PDF_MAX_INPUT_BYTES
  ) {
    return fail("invalid_input");
  }
  const { paper, margins } = options;
  if (paper && (!validPx(paper.widthPx) || !validPx(paper.heightPx) || paper.widthPx <= 0 || paper.heightPx <= 0)) {
    return fail("invalid_input");
  }
  if (
    margins &&
    ![margins.topPx, margins.bottomPx, margins.leftPx, margins.rightPx].every(validPx)
  ) {
    return fail("invalid_input");
  }

  const deps = options.deps ?? {};
  const env = deps.env ?? process.env;
  const doFetch = deps.fetch ?? fetch;
  const authorize = deps.authorize ?? ((audience: string) => cloudRunIdentityAuthorization(audience));
  const timeoutMs = deps.timeoutMs ?? HTML_PDF_TIMEOUT_MS;

  const base = env.DOCX_TO_PDF_URL?.trim();
  if (!base) return fail("not_configured");
  let url: URL;
  try {
    const parsed = new URL(base);
    parsed.pathname = CHROMIUM_HTML_PATH;
    parsed.search = "";
    parsed.hash = "";
    url = parsed;
  } catch {
    return fail("not_configured");
  }

  let authorization: string | null = null;
  const token = env.DOCX_TO_PDF_ID_TOKEN?.trim();
  const audience = env.DOCX_TO_PDF_AUDIENCE?.trim();
  if (token) {
    authorization = `Bearer ${token}`;
  } else if (audience) {
    try {
      authorization = await authorize(audience);
    } catch {
      return fail("auth_failed");
    }
    if (!authorization) return fail("auth_failed");
  }

  const form = new FormData();
  form.set("files", new Blob([html], { type: "text/html" }), "index.html");
  form.set("printBackground", "true");
  if (paper) {
    form.set("paperWidth", inches(paper.widthPx));
    form.set("paperHeight", inches(paper.heightPx));
  }
  if (margins) {
    form.set("marginTop", inches(margins.topPx));
    form.set("marginBottom", inches(margins.bottomPx));
    form.set("marginLeft", inches(margins.leftPx));
    form.set("marginRight", inches(margins.rightPx));
  }

  if (activeConversions >= HTML_PDF_MAX_CONCURRENT) return fail("upstream_busy");
  activeConversions += 1;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await doFetch(url, {
      method: "POST",
      body: form,
      headers: authorization ? { Authorization: authorization } : undefined,
      signal: controller.signal,
    });
    if (!response.ok) return fail("upstream_error");
    const pdf = Buffer.from(await response.arrayBuffer());
    if (pdf.byteLength > HTML_PDF_MAX_OUTPUT_BYTES) return fail("too_large");
    if (pdf.byteLength < 5 || pdf.subarray(0, 4).toString("latin1") !== "%PDF") {
      return fail("invalid_response");
    }
    return { ok: true, pdf };
  } catch {
    return fail(controller.signal.aborted ? "timeout" : "upstream_error");
  } finally {
    activeConversions -= 1;
    clearTimeout(timer);
  }
}
