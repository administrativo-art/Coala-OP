import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb } from "pdf-lib";

import { embedCaladeaFont } from "@/features/hr/documents/document-pdf-fonts.server";

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
  const rubricFont = pages.length > 1 ? await embedCaladeaFont(pdf) : null;
  for (const [pageIndex, page] of pages.entries()) {
    page.drawImage(overlay, {
      x: 0,
      y: 0,
      width: page.getWidth(),
      height: page.getHeight(),
    });
    if (pageIndex > 0) {
      page.drawRectangle({
        x: page.getWidth() * 0.76,
        y: 0,
        width: page.getWidth() * 0.24,
        height: 70,
        color: rgb(1, 1, 1),
      });
    }
    if (rubricFont && pageIndex < pages.length - 1) {
      page.drawText("Rubrica: ____________________", {
        x: 30,
        y: 17,
        size: 8,
        font: rubricFont,
        color: rgb(0.38, 0.42, 0.47),
      });
    }
  }
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}
