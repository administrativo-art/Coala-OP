import { degrees, PDFDocument, rgb } from "pdf-lib";

import { embedCaladeaFont } from "@/features/hr/documents/document-pdf-fonts.server";

const NOTICE = "PRÉVIA COM DADOS FICTÍCIOS — SEM VALIDADE";

export async function stampDocumentTemplateDemoPreview(pdfBuffer: Buffer) {
  const pdf = await PDFDocument.load(pdfBuffer);
  const font = await embedCaladeaFont(pdf, "bold");
  const smallSize = 7;
  const noticeWidth = font.widthOfTextAtSize(NOTICE, smallSize);

  pdf.getPages().forEach((page) => {
    const { width: pageWidth, height: pageHeight } = page.getSize();
    const watermarkSize = Math.max(22, Math.min(31, pageWidth / 19));
    const watermarkWidth = font.widthOfTextAtSize(NOTICE, watermarkSize);

    page.drawText(NOTICE, {
      x: (pageWidth - noticeWidth) / 2,
      y: pageHeight - 19,
      size: smallSize,
      font,
      color: rgb(0.43, 0.33, 0.66),
      opacity: 0.82,
    });
    page.drawText(NOTICE, {
      x: (pageWidth - noticeWidth) / 2,
      y: 15,
      size: smallSize,
      font,
      color: rgb(0.43, 0.33, 0.66),
      opacity: 0.82,
    });
    page.drawText(NOTICE, {
      x: (pageWidth - watermarkWidth * 0.82) / 2,
      y: pageHeight * 0.38,
      size: watermarkSize,
      font,
      color: rgb(0.55, 0.55, 0.55),
      opacity: 0.1,
      rotate: degrees(32),
    });
  });

  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}
