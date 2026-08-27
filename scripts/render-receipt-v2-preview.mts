import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { stampDocumentTemplateDemoPreview } from "../src/features/hr/documents/document-template-demo-preview.server";
import { applyCoalaLetterheadToPdf } from "../src/features/hr/documents/letterhead-pdf.server";
import { convertDocxToPdf } from "../src/features/hr/documents/pdf-converter.server";

const SOURCE = path.resolve("output/docx/recibo-schema-piloto.docx");
const OUTPUT = path.resolve("output/pdf/recibo-v2-previa-ficticia.pdf");

const converted = await convertDocxToPdf(await readFile(SOURCE));
if (!converted) {
  throw new Error("O Gotenberg remoto não converteu a prévia preenchida do recibo v2.");
}
const official = await applyCoalaLetterheadToPdf(converted);
const preview = await stampDocumentTemplateDemoPreview(official);
await mkdir(path.dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, preview);
process.stdout.write(`${OUTPUT}\n`);
