import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { PDFDocument } from "pdf-lib";

import { validateDocxForLetterhead } from "../src/features/hr/documents/docx-template-validation";
import { applyCoalaLetterheadToPdf } from "../src/features/hr/documents/letterhead-pdf.server";
import { convertDocxToPdf } from "../src/features/hr/documents/pdf-converter.server";
import { SYSTEM_DOCUMENT_TEMPLATES } from "../src/features/hr/documents/system-template-catalog";

const execFileAsync = promisify(execFile);
const OUTPUT_DIR = path.join(process.cwd(), "output/pdf/document-conversion-spike");
const RAW_DIR = path.join(OUTPUT_DIR, "raw");
const USE_EXISTING_PDF = process.env.DOCUMENT_SPIKE_USE_EXISTING_PDF === "true";
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const PAGE_TOLERANCE = 2;

await Promise.all([
  mkdir(OUTPUT_DIR, { recursive: true }),
  mkdir(RAW_DIR, { recursive: true }),
]);

const admissionTemplates = SYSTEM_DOCUMENT_TEMPLATES.filter(
  (template) => template.renderer === "admission_docx" && template.sourcePath,
);
const results: Array<Record<string, unknown>> = [];

for (const template of admissionTemplates) {
  try {
    const sourcePath = path.join(process.cwd(), template.sourcePath!);
    const source = await readFile(sourcePath);
    const layout = validateDocxForLetterhead(source);
    const rawName = path.basename(sourcePath).replace(/\.docx$/i, ".pdf");
    const convertedPath = path.join(RAW_DIR, rawName);
    const converted = USE_EXISTING_PDF
      ? await readFile(convertedPath)
      : await convertDocxToPdf(source);
    if (!converted) {
      throw new Error(
        "Conversor remoto indisponível. Configure DOCX_TO_PDF_URL e DOCX_TO_PDF_AUDIENCE.",
      );
    }
    if (!USE_EXISTING_PDF) await writeFile(convertedPath, converted);
    const official = await applyCoalaLetterheadToPdf(converted);
    const pdf = await PDFDocument.load(official);
    const pageSizes = pdf.getPages().map((page, index) => {
      const { width, height } = page.getSize();
      return {
        page: index + 1,
        width: Number(width.toFixed(2)),
        height: Number(height.toFixed(2)),
        a4: Math.abs(width - A4_WIDTH) <= PAGE_TOLERANCE && Math.abs(height - A4_HEIGHT) <= PAGE_TOLERANCE,
      };
    });
    const fileName = `${template.id}.pdf`;
    const outputPath = path.join(OUTPUT_DIR, fileName);
    await writeFile(outputPath, official);
    const fontOutput = await execFileAsync("pdffonts", [outputPath], { timeout: 30_000 });
    const fontRows = fontOutput.stdout
      .split(/\r?\n/)
      .slice(2)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const columns = line.split(/\s+/);
        return {
          name: columns[0],
          embedded: columns.at(-5) === "yes",
          subset: columns.at(-4) === "yes",
          unicode: columns.at(-3) === "yes",
        };
      });
    results.push({
      id: template.id,
      name: template.name,
      sourcePath: template.sourcePath,
      outputPath: `output/pdf/document-conversion-spike/${fileName}`,
      status: pageSizes.every((page) => page.a4) ? "converted" : "page_size_warning",
      pageCount: pageSizes.length,
      pageSizes,
      fonts: fontRows,
      allFontsEmbedded: fontRows.every((font) => font.embedded),
      safeArea: layout,
    });
  } catch (cause) {
    results.push({
      id: template.id,
      name: template.name,
      sourcePath: template.sourcePath,
      status: "failed",
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

const manifest = {
  generatedAt: new Date().toISOString(),
  converter: USE_EXISTING_PDF ? "existing-pdf" : "remote-gotenberg",
  usedExistingPdf: USE_EXISTING_PDF,
  templateCount: admissionTemplates.length,
  convertedCount: results.filter((result) => result.status === "converted").length,
  failedCount: results.filter((result) => result.status === "failed").length,
  safeAreaValidCount: results.filter((result) => (result.safeArea as { valid?: boolean } | undefined)?.valid).length,
  results,
};
await writeFile(
  path.join(OUTPUT_DIR, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

console.log(JSON.stringify(manifest, null, 2));
if (manifest.failedCount) process.exitCode = 1;
