import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { cloudRunIdentityAuthorization } from "@/features/hr/documents/cloud-run-auth.server";

const execFileAsync = promisify(execFile);
const CONVERSION_TIMEOUT_MS = 60_000;
const MAX_PDF_BYTES = 50 * 1024 * 1024;

const SOFFICE_CANDIDATES = [
  process.env.SOFFICE_PATH,
  "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  "/usr/bin/soffice",
  "/usr/bin/libreoffice",
  "soffice",
].filter((candidate): candidate is string => !!candidate);

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
  const authorization = audience
    ? await cloudRunIdentityAuthorization(audience)
    : null;
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

async function findSoffice(): Promise<string | null> {
  for (const candidate of SOFFICE_CANDIDATES) {
    if (!candidate.includes("/")) return candidate;
    try {
      await access(candidate);
      return candidate;
    } catch {
      // tenta o próximo caminho
    }
  }
  return null;
}

async function convertViaSoffice(buffer: Buffer): Promise<Buffer | null> {
  const binary = await findSoffice();
  if (!binary) return null;
  const workDir = await mkdtemp(path.join(tmpdir(), "coala-docx-pdf-"));
  try {
    const input = path.join(workDir, "documento.docx");
    await writeFile(input, buffer);
    const profileDir = path.join(workDir, "libreoffice-profile");
    await mkdir(profileDir, { recursive: true });
    await execFileAsync(binary, [
      `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
      "--headless",
      "--norestore",
      "--nodefault",
      "--nolockcheck",
      "--convert-to",
      "pdf",
      "--outdir",
      workDir,
      input,
    ], {
      timeout: CONVERSION_TIMEOUT_MS,
      env: process.env,
    });
    return assertConvertedPdf(await readFile(path.join(workDir, "documento.pdf")));
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/**
 * Converte um DOCX em PDF usando, nesta ordem: serviço HTTP compatível com Gotenberg
 * (env DOCX_TO_PDF_URL) ou LibreOffice headless local (env SOFFICE_PATH ou caminhos padrão).
 * Retorna null quando nenhum conversor está disponível — o chamador deve degradar para DOCX.
 */
export async function convertDocxToPdf(buffer: Buffer): Promise<Buffer | null> {
  try {
    const viaHttp = await convertViaHttp(buffer);
    if (viaHttp) return viaHttp;
  } catch (cause) {
    console.error("[pdf-converter] Falha no conversor HTTP:", cause);
  }
  try {
    return await convertViaSoffice(buffer);
  } catch (cause) {
    console.error("[pdf-converter] Falha no LibreOffice local:", cause);
    return null;
  }
}
