import { PDFDocument, type PDFFont, type PDFPage, StandardFonts, rgb } from 'pdf-lib';

import { applyCoalaLetterheadToPdf } from '@/features/hr/documents/letterhead-pdf.server';

export type VacationNoticeInstallment = {
  startDate: string;
  endDate: string;
  days: number;
  status: string;
};

type VacationNoticePdfInput = {
  companyLegalName: string;
  companyCnpj: string;
  companyAddress: string;
  employeeName: string;
  employeeCpf: string;
  employeeCtps: string;
  employeeRegistration: string;
  employeeRole: string;
  employeeAdmissionDate: string;
  employeeEmail: string;
  acquisitionPeriodStart: string;
  acquisitionPeriodEnd: string;
  concessiveDeadline: string;
  startDate: string;
  endDate: string;
  returnDate: string;
  days: number;
  entitledDays: number;
  allowanceText: string;
  thirteenthAdvanceText: string;
  unjustifiedAbsencesText?: string | null;
  paymentDeadline: string;
  noticeLeadDays: number;
  observations?: string | null;
  installments?: VacationNoticeInstallment[];
};

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const LEFT = 52;
const RIGHT = 52;
const CONTENT_WIDTH = PAGE_WIDTH - LEFT - RIGHT;
const INK = rgb(0.08, 0.13, 0.18);
const MUTED = rgb(0.36, 0.42, 0.47);
const RULE = rgb(0.82, 0.85, 0.87);
const STRONG_RULE = rgb(0.58, 0.64, 0.68);
const PETROLEUM = rgb(0.11, 0.3, 0.42);
const PANEL = rgb(0.95, 0.97, 0.98);
const WARNING = rgb(0.48, 0.32, 0);

function dateBr(value: string) {
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function weekday(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function cnpj(value: string) {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 14) return value;
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function cpf(value: string) {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 11) return value;
  return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function drawWrappedText(
  page: PDFPage,
  font: PDFFont,
  text: string,
  x: number,
  y: number,
  options: {
    size: number;
    width: number;
    lineHeight: number;
    color?: ReturnType<typeof rgb>;
    maxLines?: number;
  },
) {
  const lines = wrapText(text, font, options.size, options.width).slice(0, options.maxLines);
  lines.forEach((line, index) => page.drawText(line, {
    x,
    y: y - (index * options.lineHeight),
    size: options.size,
    font,
    color: options.color ?? INK,
  }));
  return lines.length;
}

function drawSectionTitle(page: PDFPage, regular: PDFFont, bold: PDFFont, number: string, title: string, y: number, side?: string) {
  page.drawText(number, { x: LEFT, y, size: 6.5, font: regular, color: STRONG_RULE });
  page.drawText(title, { x: LEFT + 14, y, size: 7.4, font: bold, color: PETROLEUM });
  if (side) {
    const width = regular.widthOfTextAtSize(side, 6.5);
    page.drawText(side, { x: PAGE_WIDTH - RIGHT - width, y, size: 6.5, font: regular, color: MUTED });
  }
  page.drawLine({
    start: { x: LEFT, y: y - 6 },
    end: { x: PAGE_WIDTH - RIGHT, y: y - 6 },
    thickness: 0.55,
    color: RULE,
  });
}

function drawField(
  page: PDFPage,
  regular: PDFFont,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
  options: { maxLines?: number } = {},
) {
  page.drawText(label, { x, y, size: 5.8, font: regular, color: MUTED });
  drawWrappedText(page, regular, value || 'Não informado', x, y - 10, {
    size: 7.6,
    width,
    lineHeight: 9,
    maxLines: options.maxLines ?? 1,
  });
  page.drawLine({
    start: { x, y: y - 21 },
    end: { x: x + width, y: y - 21 },
    thickness: 0.45,
    color: RULE,
    dashArray: [1.2, 1.5],
  });
}

function drawCondition(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
) {
  page.drawText(label, { x, y, size: 5.9, font: regular, color: MUTED });
  const valueWidth = bold.widthOfTextAtSize(value, 6.8);
  page.drawText(value, {
    x: Math.max(x + width * 0.43, x + width - valueWidth),
    y,
    size: 6.8,
    font: bold,
    color: INK,
  });
  page.drawLine({
    start: { x, y: y - 5 },
    end: { x: x + width, y: y - 5 },
    thickness: 0.4,
    color: RULE,
    dashArray: [1.2, 1.5],
  });
}

export async function buildVacationNoticePdf(input: VacationNoticePdfInput) {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: rgb(1, 1, 1) });

  page.drawText(input.companyLegalName, { x: LEFT, y: 776, size: 9.2, font: bold, color: INK });
  page.drawText(`CNPJ ${cnpj(input.companyCnpj)}`, { x: LEFT, y: 764, size: 6.2, font: regular, color: MUTED });
  drawWrappedText(page, regular, input.companyAddress, LEFT, 754, {
    size: 5.8,
    width: 290,
    lineHeight: 7,
    color: MUTED,
    maxLines: 2,
  });
  const title = 'Aviso de férias';
  page.drawText(title, {
    x: PAGE_WIDTH - RIGHT - bold.widthOfTextAtSize(title, 12),
    y: 757,
    size: 12,
    font: bold,
    color: PETROLEUM,
  });
  page.drawLine({ start: { x: LEFT, y: 735 }, end: { x: PAGE_WIDTH - RIGHT, y: 735 }, thickness: 1, color: INK });

  let y = 715;
  drawSectionTitle(page, regular, bold, '1', 'Identificação do colaborador', y);
  y -= 20;
  drawField(page, regular, 'Nome completo', input.employeeName, LEFT, y, CONTENT_WIDTH);
  y -= 31;
  const columnGap = 26;
  const columnWidth = (CONTENT_WIDTH - columnGap) / 2;
  const rightColumn = LEFT + columnWidth + columnGap;
  drawField(page, regular, 'CPF', cpf(input.employeeCpf), LEFT, y, columnWidth);
  drawField(page, regular, 'CTPS / série (ou CTPS Digital)', input.employeeCtps, rightColumn, y, columnWidth);
  y -= 31;
  drawField(page, regular, 'Matrícula', input.employeeRegistration, LEFT, y, columnWidth);
  drawField(page, regular, 'Função', input.employeeRole, rightColumn, y, columnWidth);
  y -= 31;
  drawField(page, regular, 'Admissão', dateBr(input.employeeAdmissionDate), LEFT, y, columnWidth);
  drawField(page, regular, 'E-mail para ciência', input.employeeEmail, rightColumn, y, columnWidth);

  y -= 42;
  drawSectionTitle(page, regular, bold, '2', 'Período concedido', y, `${input.days} dias corridos`);
  y -= 68;
  const boxBottom = y;
  const boxHeight = 54;
  page.drawRectangle({
    x: LEFT,
    y: boxBottom,
    width: CONTENT_WIDTH,
    height: boxHeight,
    color: PANEL,
    borderColor: PETROLEUM,
    borderWidth: 0.8,
  });
  const boxColumnWidth = CONTENT_WIDTH / 3;
  [1, 2].forEach((index) => page.drawLine({
    start: { x: LEFT + boxColumnWidth * index, y: boxBottom },
    end: { x: LEFT + boxColumnWidth * index, y: boxBottom + boxHeight },
    thickness: 0.5,
    color: index === 2 ? STRONG_RULE : RULE,
  }));
  const summary = [
    { label: 'Início das férias', value: input.startDate, color: INK },
    { label: 'Último dia de férias', value: input.endDate, color: INK },
    { label: 'Retorno ao trabalho', value: input.returnDate, color: PETROLEUM },
  ];
  summary.forEach((item, index) => {
    const x = LEFT + boxColumnWidth * index + 12;
    page.drawText(item.label, { x, y: boxBottom + 39, size: 5.8, font: regular, color: MUTED });
    page.drawText(dateBr(item.value), { x, y: boxBottom + 21, size: 10.8, font: bold, color: item.color });
    page.drawText(weekday(item.value), { x, y: boxBottom + 8, size: 5.9, font: regular, color: MUTED });
  });

  y = boxBottom - 13;
  const installments = (input.installments ?? []).slice(0, 3);
  if (installments.length > 1) {
    const widths = [50, 116, 116, 52, CONTENT_WIDTH - 334];
    const labels = ['Parcela', 'Início', 'Término', 'Dias', 'Situação'];
    let x = LEFT;
    labels.forEach((label, index) => {
      page.drawText(label, { x, y, size: 5.8, font: bold, color: MUTED });
      x += widths[index];
    });
    y -= 13;
    installments.forEach((installment, index) => {
      const values = [
        `${index + 1}ª`,
        dateBr(installment.startDate),
        dateBr(installment.endDate),
        String(installment.days),
        installment.status,
      ];
      let rowX = LEFT;
      values.forEach((value, valueIndex) => {
        page.drawText(value, { x: rowX, y, size: 6.5, font: regular, color: INK });
        rowX += widths[valueIndex];
      });
      page.drawLine({ start: { x: LEFT, y: y - 4 }, end: { x: PAGE_WIDTH - RIGHT, y: y - 4 }, thickness: 0.4, color: RULE });
      y -= 14;
    });
    y -= 3;
  }

  drawSectionTitle(page, regular, bold, '3', 'Condições da concessão', y);
  y -= 20;
  const conditions = [
    ['Período aquisitivo', `${dateBr(input.acquisitionPeriodStart)} a ${dateBr(input.acquisitionPeriodEnd)}`],
    ['Limite do período concessivo', dateBr(input.concessiveDeadline)],
    ...(input.unjustifiedAbsencesText ? [['Faltas injustificadas no período', input.unjustifiedAbsencesText]] : []),
    ['Direito apurado', `${input.entitledDays} dias`],
    ['Abono pecuniário (art. 143)', input.allowanceText],
    ['Antecipação da 1ª parcela do 13º', input.thirteenthAdvanceText],
    ['Pagamento até', dateBr(input.paymentDeadline)],
    ['Antecedência deste aviso', `${input.noticeLeadDays} dias`],
  ];
  conditions.forEach(([label, value], index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    drawCondition(
      page,
      regular,
      bold,
      label,
      value,
      column === 0 ? LEFT : rightColumn,
      y - row * 19,
      columnWidth,
    );
  });
  y -= Math.ceil(conditions.length / 2) * 19 + 3;

  if (input.observations?.trim()) {
    const observationLines = wrapText(input.observations.trim(), regular, 6.8, CONTENT_WIDTH - 18).slice(0, 2);
    const observationHeight = 18 + observationLines.length * 8;
    page.drawLine({ start: { x: LEFT, y }, end: { x: LEFT, y: y - observationHeight }, thickness: 1.6, color: WARNING });
    page.drawText('Observações', { x: LEFT + 8, y: y - 7, size: 5.8, font: bold, color: WARNING });
    observationLines.forEach((line, index) => page.drawText(line, {
      x: LEFT + 8,
      y: y - 17 - (index * 8),
      size: 6.8,
      font: regular,
      color: INK,
    }));
    y -= observationHeight + 7;
  }

  const receiptHeight = 142;
  const receiptTop = y - 5;
  const receiptBottom = receiptTop - receiptHeight;
  page.drawRectangle({
    x: LEFT,
    y: receiptBottom,
    width: CONTENT_WIDTH,
    height: receiptHeight,
    borderColor: STRONG_RULE,
    borderWidth: 0.65,
  });
  const declaration = 'Declaro ter recebido este aviso na data de assinatura eletrônica, com plena ciência do período de férias concedido, das condições de pagamento e da data de retorno ao trabalho, para os fins do art. 135 da Consolidação das Leis do Trabalho.';
  drawWrappedText(page, regular, declaration, LEFT + 14, receiptTop - 18, {
    size: 7.8,
    width: CONTENT_WIDTH - 28,
    lineHeight: 10.5,
    maxLines: 4,
  });

  const signatureY = receiptBottom + 44;
  const signatureWidth = (CONTENT_WIDTH - 34) / 2;
  const employeeSignatureX = LEFT + signatureWidth + 34;
  page.drawLine({ start: { x: LEFT + 14, y: signatureY }, end: { x: LEFT + 14 + signatureWidth, y: signatureY }, thickness: 0.65, color: INK });
  page.drawLine({ start: { x: employeeSignatureX, y: signatureY }, end: { x: employeeSignatureX + signatureWidth, y: signatureY }, thickness: 0.65, color: INK });
  page.drawText(input.companyLegalName, { x: LEFT + 14, y: signatureY - 13, size: 6.8, font: bold, color: INK, maxWidth: signatureWidth });
  page.drawText(input.employeeName, { x: employeeSignatureX, y: signatureY - 13, size: 6.8, font: bold, color: INK, maxWidth: signatureWidth });
  page.drawText(`Empregadora · CNPJ ${cnpj(input.companyCnpj)}`, { x: LEFT + 14, y: signatureY - 24, size: 5.5, font: regular, color: MUTED, maxWidth: signatureWidth });
  page.drawText(`Colaborador(a) · CPF ${cpf(input.employeeCpf)}`, { x: employeeSignatureX, y: signatureY - 24, size: 5.5, font: regular, color: MUTED, maxWidth: signatureWidth });

  const content = Buffer.from(await document.save({ useObjectStreams: false }));
  return applyCoalaLetterheadToPdf(content);
}
