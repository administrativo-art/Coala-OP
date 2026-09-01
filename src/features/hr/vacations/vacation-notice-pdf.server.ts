import { PDFDocument, type PDFFont, type PDFPage, StandardFonts, rgb } from 'pdf-lib';

type VacationNoticePdfInput = {
  documentId: string;
  companyLegalName: string;
  companyCnpj: string;
  companyAddress: string;
  employeeName: string;
  employeeEmail: string;
  acquisitionCycle: string;
  startDate: string;
  endDate: string;
  returnDate: string;
  days: number;
  communicationDate: string;
  paymentDeadline: string;
};

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const LEFT = 58;
const RIGHT = 58;

function dateBr(value: string) {
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function cnpj(value: string) {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 14) return value;
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function paragraph(page: PDFPage, font: PDFFont, text: string, y: number, options: {
  size?: number;
  color?: ReturnType<typeof rgb>;
  lineHeight?: number;
  maxWidth?: number;
} = {}) {
  const size = options.size ?? 10.5;
  const lineHeight = options.lineHeight ?? size + 5;
  const maxWidth = options.maxWidth ?? PAGE_WIDTH - LEFT - RIGHT;
  for (const line of wrapText(text, font, size, maxWidth)) {
    page.drawText(line, {
      x: LEFT,
      y,
      size,
      font,
      color: options.color ?? rgb(0.12, 0.13, 0.18),
    });
    y -= lineHeight;
  }
  return y;
}

function field(page: PDFPage, regular: PDFFont, bold: PDFFont, label: string, value: string, y: number) {
  page.drawText(label, { x: LEFT, y, size: 9, font: bold, color: rgb(0.32, 0.34, 0.4) });
  const valueX = 184;
  const maxWidth = PAGE_WIDTH - RIGHT - valueX;
  const lines = wrapText(value || 'Não informado', regular, 9.5, maxWidth);
  lines.forEach((line, index) => {
    page.drawText(line, {
      x: valueX,
      y: y - (index * 13),
      size: 9.5,
      font: regular,
      color: rgb(0.12, 0.13, 0.18),
    });
  });
  return y - Math.max(23, lines.length * 13 + 8);
}

export async function buildVacationNoticePdf(input: VacationNoticePdfInput) {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: rgb(1, 1, 1) });
  page.drawText('AVISO DE FÉRIAS', {
    x: LEFT,
    y: 755,
    size: 17,
    font: bold,
    color: rgb(0.84, 0.08, 0.36),
  });
  page.drawText('Comunicação formal para ciência eletrônica', {
    x: LEFT,
    y: 735,
    size: 9.5,
    font: regular,
    color: rgb(0.38, 0.4, 0.46),
  });
  page.drawLine({ start: { x: LEFT, y: 718 }, end: { x: PAGE_WIDTH - RIGHT, y: 718 }, thickness: 0.8, color: rgb(0.84, 0.84, 0.87) });

  let y = 686;
  y = field(page, regular, bold, 'EMPREGADORA', input.companyLegalName, y);
  y = field(page, regular, bold, 'CNPJ', cnpj(input.companyCnpj), y);
  y = field(page, regular, bold, 'ENDEREÇO', input.companyAddress, y);
  y = field(page, regular, bold, 'COLABORADOR(A)', input.employeeName, y);
  y = field(page, regular, bold, 'E-MAIL', input.employeeEmail, y);

  y -= 8;
  y = paragraph(
    page,
    regular,
    `Comunicamos a concessão de ${input.days} dias de férias referentes ao período aquisitivo ${input.acquisitionCycle}, com início em ${dateBr(input.startDate)} e término em ${dateBr(input.endDate)}. O retorno ao trabalho está previsto para ${dateBr(input.returnDate)}.`,
    y,
  );
  y -= 12;
  y = paragraph(
    page,
    regular,
    `A remuneração das férias e, quando aplicável, o abono pecuniário deverão ser pagos até ${dateBr(input.paymentDeadline)}, observado o prazo do art. 145 da Consolidação das Leis do Trabalho.`,
    y,
  );
  y -= 12;
  y = paragraph(
    page,
    regular,
    'A assinatura eletrônica deste aviso registra o recebimento e a ciência da comunicação de férias, nos termos do art. 135 da Consolidação das Leis do Trabalho.',
    y,
  );

  y -= 24;
  page.drawText(`Comunicação emitida em ${dateBr(input.communicationDate)}.`, {
    x: LEFT,
    y,
    size: 9.5,
    font: regular,
    color: rgb(0.3, 0.32, 0.38),
  });

  y -= 56;
  page.drawLine({ start: { x: LEFT, y }, end: { x: 278, y }, thickness: 0.7, color: rgb(0.35, 0.36, 0.42) });
  page.drawLine({ start: { x: 318, y }, end: { x: PAGE_WIDTH - RIGHT, y }, thickness: 0.7, color: rgb(0.35, 0.36, 0.42) });
  page.drawText(input.companyLegalName, { x: LEFT, y: y - 16, size: 8.5, font: bold, color: rgb(0.25, 0.27, 0.32), maxWidth: 220 });
  page.drawText(input.employeeName, { x: 318, y: y - 16, size: 8.5, font: bold, color: rgb(0.25, 0.27, 0.32), maxWidth: PAGE_WIDTH - RIGHT - 318 });
  page.drawText('EMPREGADORA', { x: LEFT, y: y - 31, size: 7.5, font: regular, color: rgb(0.48, 0.5, 0.56) });
  page.drawText('COLABORADOR(A)', { x: 318, y: y - 31, size: 7.5, font: regular, color: rgb(0.48, 0.5, 0.56) });

  page.drawText(`Documento ${input.documentId} · Versão 1.0`, {
    x: LEFT,
    y: 92,
    size: 7,
    font: regular,
    color: rgb(0.52, 0.54, 0.6),
  });
  page.drawText('Documento eletrônico preservado com registro de integridade e auditoria.', {
    x: LEFT,
    y: 80,
    size: 7,
    font: regular,
    color: rgb(0.52, 0.54, 0.6),
  });

  return Buffer.from(await document.save({ useObjectStreams: false }));
}
