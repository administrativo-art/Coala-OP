import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";

async function loadLetterheadOverlay() {
  return readFile(path.join(
    process.cwd(),
    "src/features/hr/documents/assets/coala-shakes-letterhead-overlay-a4-v2.png",
  ));
}

export async function applyCoalaLetterheadToPdf(input: Buffer) {
  const [pdf, overlayBuffer] = await Promise.all([
    PDFDocument.load(input),
    loadLetterheadOverlay(),
  ]);
  const overlay = await pdf.embedPng(overlayBuffer);
  for (const page of pdf.getPages()) {
    page.drawImage(overlay, {
      x: 0,
      y: 0,
      width: page.getWidth(),
      height: page.getHeight(),
    });
  }
  return Buffer.from(await pdf.save());
}
