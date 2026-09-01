import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb } from "pdf-lib";

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
  const pages = pdf.getPages();
  for (const page of pages) {
    page.drawRectangle({
      x: 0,
      y: 0,
      width: page.getWidth(),
      height: 70,
      color: rgb(1, 1, 1),
    });
    page.drawImage(overlay, {
      x: 0,
      y: 0,
      width: page.getWidth(),
      height: page.getHeight(),
    });
  }
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}
