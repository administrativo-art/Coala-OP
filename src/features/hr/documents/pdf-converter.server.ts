import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { cloudRunIdentityAuthorization } from "@/features/hr/documents/cloud-run-auth.server";

const execFileAsync = promisify(execFile);
const CONVERSION_TIMEOUT_MS = 60_000;
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const CONVERSION_CACHE_TTL_MS = 5 * 60_000;
const CONVERSION_CACHE_MAX_ITEMS = 20;

type PdfConversionState = {
  inFlight: Map<string, Promise<Buffer | null>>;
  cache: Map<string, { buffer: Buffer; expiresAt: number }>;
};

const PDF_CONVERSION_STATE = Symbol.for("coala.pdf-conversion-state");

function conversionState() {
  const root = globalThis as typeof globalThis & {
    [PDF_CONVERSION_STATE]?: PdfConversionState;
  };
  if (!root[PDF_CONVERSION_STATE]) {
    root[PDF_CONVERSION_STATE] = {
      inFlight: new Map(),
      cache: new Map(),
    };
  }
  return root[PDF_CONVERSION_STATE];
}

async function convertViaHttp(buffer: Buffer): Promise<Buffer | null> {
  const base = process.env.DOCX_TO_PDF_URL?.trim();
  if (!base) return null;
  const url = new URL(base);
  if (url.pathname === "/" || url.pathname === "") url.pathname = "/forms/libreoffice/convert";
  const form = new FormData();
  form.set(
    "files",
    new Blob([new Uint8Array(buffer)], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
    "documento.docx",
  );
  const audience = process.env.DOCX_TO_PDF_AUDIENCE?.trim();
  let authorization = process.env.DOCX_TO_PDF_ID_TOKEN?.trim()
    ? `Bearer ${process.env.DOCX_TO_PDF_ID_TOKEN.trim()}`
    : null;
  if (!authorization && audience) {
    try {
      authorization = await cloudRunIdentityAuthorization(audience);
    } catch (metadataCause) {
      if (process.env.NODE_ENV === "production") throw metadataCause;
      try {
        let token = "";
        const causes: unknown[] = [];
        // O token sem audience é o formato suportado por login humano local.
        // Repetimos a tentativa porque o gcloud pode disputar brevemente o lock
        // do próprio arquivo de configuração com o servidor de desenvolvimento.
        // A forma com audience fica por último e atende service accounts locais.
        for (const args of [
          ["auth", "print-identity-token", "--quiet"],
          ["auth", "print-identity-token", "--quiet"],
          ["auth", "print-identity-token", "--quiet"],
          ["auth", "print-identity-token", `--audiences=${audience}`, "--quiet"],
        ]) {
          try {
            const { stdout } = await execFileAsync("gcloud", args, {
              timeout: 20_000,
              env: {
                ...process.env,
                CLOUDSDK_CORE_DISABLE_PROMPTS: "1",
              },
            });
            token = stdout.trim();
            if (token) break;
          } catch (cause) {
            causes.push(cause);
          }
        }
        if (!token) {
          const first = causes.find((cause) => cause instanceof Error);
          throw first ?? new Error("gcloud não devolveu um identity token.");
        }
        authorization = `Bearer ${token}`;
      } catch (localCause) {
        throw new Error(
          `Não foi possível autenticar no conversor remoto: ${
            localCause instanceof Error ? localCause.message : String(localCause)
          }`,
        );
      }
    }
  }
  const response = await fetch(url, {
    method: "POST",
    body: form,
    headers: authorization ? { Authorization: authorization } : undefined,
    signal: AbortSignal.timeout(CONVERSION_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Conversor HTTP respondeu ${response.status}.`);
  return assertConvertedPdf(Buffer.from(await response.arrayBuffer()));
}

function assertConvertedPdf(buffer: Buffer) {
  if (
    buffer.byteLength < 5 ||
    buffer.byteLength > MAX_PDF_BYTES ||
    buffer.subarray(0, 4).toString() !== "%PDF"
  ) {
    throw new Error("O conversor não devolveu um PDF válido.");
  }
  return buffer;
}

/**
 * Converte um DOCX exclusivamente no serviço HTTP compatível com Gotenberg.
 * O aplicativo nunca executa o LibreOffice instalado na máquina do usuário:
 * se o serviço remoto estiver indisponível, o chamador deve degradar para DOCX.
 */
export async function convertDocxToPdf(buffer: Buffer): Promise<Buffer | null> {
  const key = createHash("sha256").update(buffer).digest("hex");
  const state = conversionState();
  const cached = state.cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return Buffer.from(cached.buffer);
  if (cached) state.cache.delete(key);
  const pending = state.inFlight.get(key);
  if (pending) return pending;

  const conversion = (async () => {
    try {
      const viaHttp = await convertViaHttp(buffer);
      if (viaHttp) return viaHttp;
    } catch (cause) {
      console.error("[pdf-converter] Falha no conversor HTTP:", cause);
    }
    return null;
  })().then((pdf) => {
    if (pdf) {
      if (state.cache.size >= CONVERSION_CACHE_MAX_ITEMS) {
        const oldest = state.cache.keys().next().value;
        if (oldest) state.cache.delete(oldest);
      }
      state.cache.set(key, {
        buffer: Buffer.from(pdf),
        expiresAt: Date.now() + CONVERSION_CACHE_TTL_MS,
      });
    }
    return pdf;
  }).finally(() => {
    state.inFlight.delete(key);
  });

  state.inFlight.set(key, conversion);
  return conversion;
}
