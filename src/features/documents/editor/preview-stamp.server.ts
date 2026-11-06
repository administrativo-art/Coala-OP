import { degrees, PDFDocument, rgb } from "pdf-lib";

import { embedCaladeaFont } from "@/features/hr/documents/document-pdf-fonts.server";

const NOTICE = "PRÉVIA — NÃO É O DOCUMENTO FINAL";

/**
 * Marca de prévia para o modo `resolved` (dados reais do titular). O carimbo legado
 * `stampDocumentTemplateDemoPreview` afirma "dados fictícios" e seria falso aqui; por isso só ele
 * é reutilizado no modo `sample`. Mesmo desenho (faixa superior/inferior e marca d'água).
 */
export async function stampEditorResolvedPreview(pdfBuffer: Buffer): Promise<Buffer> {
  const pdf = await PDFDocument.load(pdfBuffer);
  const font = await embedCaladeaFont(pdf, "bold");
  const small = 7;
  const smallWidth = font.widthOfTextAtSize(NOTICE, small);
  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    const size = Math.max(22, Math.min(31, width / 19));
    const markWidth = font.widthOfTextAtSize(NOTICE, size);
    const color = rgb(0.43, 0.33, 0.66);
    page.drawText(NOTICE, { x: (width - smallWidth) / 2, y: height - 19, size: small, font, color, opacity: 0.82 });
    page.drawText(NOTICE, { x: (width - smallWidth) / 2, y: 15, size: small, font, color, opacity: 0.82 });
    page.drawText(NOTICE, {
      x: (width - markWidth * 0.82) / 2,
      y: height * 0.38,
      size,
      font,
      color: rgb(0.55, 0.55, 0.55),
      opacity: 0.1,
      rotate: degrees(32),
    });
  }
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}
