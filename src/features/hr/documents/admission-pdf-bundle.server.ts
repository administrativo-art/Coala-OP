import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type AdmissionPdfBundleComponent = {
  id: string;
  name: string;
  buffer: Buffer;
  templateId?: string | null;
  templateVersion?: number | null;
};

export type AdmissionPdfBundleIndexItem = {
  id: string;
  name: string;
  templateId: string | null;
  templateVersion: number | null;
  startPage: number;
  endPage: number;
  pageCount: number;
};

const PAGE_NUMBER_FONT_SIZE = 8;
const LOGO_WIDTH = 58;
const LOGO_HEIGHT = 25;

function assertPdf(buffer: Buffer, name: string) {
  if (buffer.byteLength < 5 || buffer.subarray(0, 4).toString() !== "%PDF") {
    throw new Error(`O documento ${name} não possui uma versão PDF válida.`);
  }
}

export async function buildAdmissionPdfBundle(params: {
  components: AdmissionPdfBundleComponent[];
  logoPng: Buffer;
  title: string;
}) {
  if (!params.components.length) throw new Error("O pacote admissional não possui documentos.");

  const bundle = await PDFDocument.create();
  bundle.setTitle(params.title);
  bundle.setAuthor("Coala Shakes");
  bundle.setCreator("Coala OP");
  bundle.setProducer("Coala OP - pacote admissional");

  const index: AdmissionPdfBundleIndexItem[] = [];
  for (const component of params.components) {
    assertPdf(component.buffer, component.name);
    const source = await PDFDocument.load(component.buffer, { ignoreEncryption: false });
    const sourcePages = await bundle.copyPages(source, source.getPageIndices());
    const startPage = bundle.getPageCount() + 1;
    sourcePages.forEach((page) => bundle.addPage(page));
    const endPage = bundle.getPageCount();
    index.push({
      id: component.id,
      name: component.name,
      templateId: component.templateId ?? null,
      templateVersion: component.templateVersion ?? null,
      startPage,
      endPage,
      pageCount: sourcePages.length,
    });
  }

  const [logo, font] = await Promise.all([
    bundle.embedPng(params.logoPng),
    bundle.embedFont(StandardFonts.Helvetica),
  ]);
  const pages = bundle.getPages();
  const totalPages = pages.length;

  pages.forEach((page, pageIndex) => {
    const { width, height } = page.getSize();
    const label = `Página ${pageIndex + 1} de ${totalPages}`;
    const labelWidth = font.widthOfTextAtSize(label, PAGE_NUMBER_FONT_SIZE);

    // Limpa o resultado antigo de PAGE/NUMPAGES de cada DOCX. A numeração
    // definitiva pertence ao PDF consolidado, não aos componentes isolados.
    page.drawRectangle({
      x: width - 128,
      y: height - 48,
      width: 104,
      height: 18,
      color: rgb(1, 1, 1),
    });
    page.drawText(label, {
      x: width - 30 - labelWidth,
      y: height - 42,
      size: PAGE_NUMBER_FONT_SIZE,
      font,
      color: rgb(0.42, 0.47, 0.52),
    });

    page.drawImage(logo, {
      x: width - 30 - LOGO_WIDTH,
      y: 14,
      width: LOGO_WIDTH,
      height: LOGO_HEIGHT,
    });
  });

  return {
    buffer: Buffer.from(await bundle.save()),
    pageCount: totalPages,
    index,
  };
}
