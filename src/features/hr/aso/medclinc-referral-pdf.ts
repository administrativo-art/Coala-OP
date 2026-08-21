import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib';

export type MedclincReferralPdfData = {
  companyName: string;
  employerCnpj: string;
  employeeName: string;
  employeeCpf: string;
  jobFunction: string;
  serviceDate?: string | null;
  observations?: string | null;
  logoDataUri?: string | null;
  letterheadLogoDataUri?: string | null;
  examType?: 'admission' | 'dismissal';
};

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BLUE = rgb(31 / 255, 111 / 255, 178 / 255);
const BLACK = rgb(17 / 255, 17 / 255, 17 / 255);
const MUTED = rgb(92 / 255, 113 / 255, 130 / 255);
const WHITE = rgb(1, 1, 1);

const leftExams = [
  'HEMOGRAMA',
  'GLICEMIA EM JEJUM',
  'TIPAGEM SANGUÍNEA',
  'VDRL',
  'EAS - URINA',
  'EPF - FEZES',
  'TRIGLICERÍDEOS',
  'CREATININA',
  'GAMA GT',
  'MICOLÓGICO DE UNHA',
  'LIPIDOGRAMA',
  'OUTROS: ____________________',
] as const;

const rightExams = [
  'EXAME TOXICOLÓGICO',
  'AVALIAÇÃO PSICOSSOCIAL',
  'EXAME CLÍNICO - ASO',
  'AUDIOMETRIA',
  'ECG - ELETROCARDIOGRAMA',
  'EEG - ELETROENCEFALOGRAMA',
  'ESPIROMETRIA',
  'ACUIDADE VISUAL',
  'RX DO TÓRAX P.A.',
  'RAIO X DA COLUNA',
  'OUTROS: ____________________',
] as const;

function cleanPdfText(value: string) {
  return value
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u00a0/g, ' ');
}

function dataUriBytes(value?: string | null) {
  if (!value) return null;
  const match = value.match(/^data:([^;,]+);base64,([\s\S]+)$/);
  if (!match) return null;
  return { mimeType: match[1], bytes: Uint8Array.from(Buffer.from(match[2], 'base64')) };
}

function wrapText(value: string, font: PDFFont, size: number, maxWidth: number) {
  const words = cleanPdfText(value).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [' '];
  const lines: string[] = [];
  let line = words[0];
  for (const word of words.slice(1)) {
    const candidate = `${line} ${word}`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) line = candidate;
    else { lines.push(line); line = word; }
  }
  lines.push(line);
  return lines;
}

function drawWrappedText(params: {
  page: PDFPage;
  value: string;
  x: number;
  y: number;
  width: number;
  font: PDFFont;
  size: number;
  color?: ReturnType<typeof rgb>;
  lineHeight?: number;
  maxLines?: number;
}) {
  const { page, x, width, font, size } = params;
  const lineHeight = params.lineHeight ?? size * 1.15;
  const lines = wrapText(params.value, font, size, width).slice(0, params.maxLines ?? Number.POSITIVE_INFINITY);
  lines.forEach((line, index) => page.drawText(line, { x, y: params.y - index * lineHeight, font, size, color: params.color ?? BLACK }));
  return params.y - lines.length * lineHeight;
}

function drawSectionLabel(page: PDFPage, number: number, title: string, top: number, bold: PDFFont) {
  const label = `${number}. ${title}`;
  const size = 9.2;
  const width = Math.min(CONTENT_WIDTH, bold.widthOfTextAtSize(label, size) + 14);
  page.drawRectangle({ x: MARGIN, y: top - 15, width, height: 15, color: BLUE, borderColor: BLACK, borderWidth: 0.7 });
  page.drawText(label, { x: MARGIN + 7, y: top - 11.2, font: bold, size, color: WHITE });
  return top - 15;
}

function drawGridRow(params: {
  page: PDFPage;
  top: number;
  height: number;
  cells: Array<{ label: string; value: string; width: number }>;
  regular: PDFFont;
  bold: PDFFont;
}) {
  const { page, top, height, cells, regular, bold } = params;
  const bottom = top - height;
  page.drawRectangle({ x: MARGIN, y: bottom, width: CONTENT_WIDTH, height, borderColor: BLACK, borderWidth: 0.7 });
  let x = MARGIN;
  cells.forEach((cell, index) => {
    if (index > 0) page.drawLine({ start: { x, y: bottom }, end: { x, y: top }, thickness: 0.7, color: BLACK });
    page.drawText(cleanPdfText(cell.label.toUpperCase()), { x: x + 6, y: top - 10, font: bold, size: 6.2, color: MUTED });
    drawWrappedText({ page, value: cell.value || 'Não informado', x: x + 6, y: top - 22, width: cell.width - 12, font: regular, size: 8.6, lineHeight: 9.4, maxLines: 2 });
    x += cell.width;
  });
  return bottom;
}

function drawOption(page: PDFPage, label: string, checked: boolean, x: number, y: number, regular: PDFFont, bold: PDFFont, size = 8.3) {
  page.drawText(`( ${checked ? 'X' : '  '} )`, { x, y, font: checked ? bold : regular, size, color: checked ? BLUE : BLACK });
  page.drawText(cleanPdfText(label), { x: x + 23, y, font: regular, size, color: BLACK });
}

export async function renderMedclincReferralPdf(data: MedclincReferralPdfData) {
  const document = await PDFDocument.create();
  document.setTitle(`Guia ASO ${data.examType === 'dismissal' ? 'demissional' : 'admissional'} - ${data.employeeName}`);
  document.setAuthor('Coala One');
  document.setCreator('Coala One');
  const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const [regular, bold, italic] = await Promise.all([
    document.embedFont(StandardFonts.TimesRoman),
    document.embedFont(StandardFonts.TimesRomanBold),
    document.embedFont(StandardFonts.TimesRomanItalic),
  ]);

  const logo = dataUriBytes(data.logoDataUri);
  if (logo) {
    const embedded = logo.mimeType === 'image/png' ? await document.embedPng(logo.bytes) : await document.embedJpg(logo.bytes);
    const dimensions = embedded.scaleToFit(150, 56);
    page.drawImage(embedded, { x: MARGIN, y: 714, width: dimensions.width, height: dimensions.height });
  }

  const clinicLines = [
    'Avenida Gomes de Castro, nº 178, Centro',
    'Em frente ao Ginásio Costa Rodrigues, na lateral da escola Liceu Maranhense',
    '(98) 3256-2737  -  (98) 98409-7916',
  ];
  clinicLines.forEach((line, index) => {
    const safeLine = cleanPdfText(line);
    const size = index === 1 ? 7.3 : 8.2;
    page.drawText(safeLine, { x: PAGE_WIDTH - MARGIN - bold.widthOfTextAtSize(safeLine, size), y: 755 - index * 12, font: bold, size, color: MUTED });
  });

  const title = 'GUIA DE ENCAMINHAMENTO';
  page.drawText(title, { x: (PAGE_WIDTH - bold.widthOfTextAtSize(title, 16)) / 2, y: 690, font: bold, size: 16, color: BLUE });
  const subtitle = 'Autorização de Exames';
  page.drawText(subtitle, { x: (PAGE_WIDTH - bold.widthOfTextAtSize(subtitle, 10.5)) / 2, y: 675, font: bold, size: 10.5, color: MUTED });

  let top = 664;
  top = drawSectionLabel(page, 1, 'DADOS DA EMPRESA', top, bold);
  top = drawGridRow({ page, top, height: 34, regular, bold, cells: [
    { label: 'Empresa', value: data.companyName, width: CONTENT_WIDTH * 0.4 },
    { label: 'CNPJ', value: data.employerCnpj, width: CONTENT_WIDTH * 0.3 },
    { label: 'Forma de pagamento', value: 'PIX', width: CONTENT_WIDTH * 0.3 },
  ] }) - 7;

  top = drawSectionLabel(page, 2, 'DADOS DO COLABORADOR', top, bold);
  top = drawGridRow({ page, top, height: 32, regular, bold, cells: [
    { label: 'Nome', value: data.employeeName, width: CONTENT_WIDTH * 0.46 },
    { label: 'CPF', value: data.employeeCpf, width: CONTENT_WIDTH * 0.34 },
    { label: 'Setor', value: 'GERAL', width: CONTENT_WIDTH * 0.2 },
  ] });
  top = drawGridRow({ page, top, height: 32, regular, bold, cells: [
    { label: 'Função', value: data.jobFunction, width: CONTENT_WIDTH * 0.46 },
    { label: 'Data do atendimento', value: data.serviceDate || 'A DEFINIR PELA CLÍNICA', width: CONTENT_WIDTH * 0.54 },
  ] });
  top = drawGridRow({ page, top, height: 27, regular, bold, cells: [
    { label: 'Observações', value: data.observations || ' ', width: CONTENT_WIDTH },
  ] }) - 7;

  top = drawSectionLabel(page, 3, 'TIPO DE EXAME', top, bold);
  const examTypeBottom = top - 48;
  page.drawRectangle({ x: MARGIN, y: examTypeBottom, width: CONTENT_WIDTH, height: 48, borderColor: BLACK, borderWidth: 0.7 });
  page.drawLine({ start: { x: MARGIN + CONTENT_WIDTH / 2, y: examTypeBottom }, end: { x: MARGIN + CONTENT_WIDTH / 2, y: top }, thickness: 0.7, color: BLACK });
  ['ADMISSIONAL', 'PERIÓDICO ANUAL', 'PERIÓDICO SEMESTRAL', 'DEMISSIONAL'].forEach((label, index) => drawOption(page, label, label === 'ADMISSIONAL' ? data.examType !== 'dismissal' : label === 'DEMISSIONAL' && data.examType === 'dismissal', MARGIN + 7, top - 12 - index * 10, regular, bold));
  ['RETORNO AO TRABALHO', 'MUDANÇA DE FUNÇÃO', 'OUTROS: ______________________'].forEach((label, index) => drawOption(page, label, false, MARGIN + CONTENT_WIDTH / 2 + 7, top - 12 - index * 12, regular, bold));
  top = examTypeBottom - 7;

  top = drawSectionLabel(page, 4, 'EXAMES', top, bold);
  const examsBottom = top - 156;
  page.drawRectangle({ x: MARGIN, y: examsBottom, width: CONTENT_WIDTH, height: 156, borderColor: BLACK, borderWidth: 0.7 });
  page.drawLine({ start: { x: MARGIN, y: top - 31 }, end: { x: MARGIN + CONTENT_WIDTH, y: top - 31 }, thickness: 0.7, color: BLACK });
  page.drawText('( X )', { x: MARGIN + 7, y: top - 12, font: bold, size: 8.5, color: BLUE });
  page.drawText('EXAMES CONFORME O PCMSO - PROGRAMA DE CONTROLE MÉDICO DE SAÚDE OCUPACIONAL', { x: MARGIN + 35, y: top - 12, font: regular, size: 8.2, color: BLACK });
  page.drawText('A marcação abaixo é dispensável quando a empresa já disponibilizou o PCMSO à MEDCLINIC.', { x: MARGIN + 7, y: top - 24, font: italic, size: 6.8, color: MUTED });
  page.drawLine({ start: { x: MARGIN + CONTENT_WIDTH / 2, y: examsBottom }, end: { x: MARGIN + CONTENT_WIDTH / 2, y: top - 31 }, thickness: 0.7, color: BLACK });
  leftExams.forEach((exam, index) => drawOption(page, exam, false, MARGIN + 7, top - 43 - index * 9.2, regular, bold, 7.8));
  rightExams.forEach((exam, index) => drawOption(page, exam, false, MARGIN + CONTENT_WIDTH / 2 + 7, top - 43 - index * 9.2, regular, bold, 7.8));
  top = examsBottom - 7;

  top = drawSectionLabel(page, 5, 'ENCAMINHADO PARA', top, bold);
  const referralBottom = top - 55;
  page.drawRectangle({ x: MARGIN, y: referralBottom, width: CONTENT_WIDTH, height: 55, borderColor: BLACK, borderWidth: 0.7 });
  page.drawLine({ start: { x: MARGIN + CONTENT_WIDTH / 2, y: referralBottom }, end: { x: MARGIN + CONTENT_WIDTH / 2, y: top }, thickness: 0.7, color: BLACK });
  ['CONSULTA OFTALMOLOGISTA', 'CONSULTA ORTOPEDISTA', 'CONSULTA CARDIOLOGISTA', 'OUTROS: ____________________'].forEach((label, index) => drawOption(page, label, false, MARGIN + 7, top - 12 - index * 11, regular, bold, 7.9));
  page.drawText('SEGUE RAC:  (    ) SIM   (    ) NÃO', { x: MARGIN + CONTENT_WIDTH / 2 + 7, y: top - 14, font: regular, size: 8, color: BLACK });
  page.drawText('QUAIS: _____________________________', { x: MARGIN + CONTENT_WIDTH / 2 + 7, y: top - 29, font: regular, size: 8, color: BLACK });
  page.drawText('___________________________________', { x: MARGIN + CONTENT_WIDTH / 2 + 7, y: top - 42, font: regular, size: 8, color: BLACK });
  top = referralBottom - 7;

  top = drawSectionLabel(page, 6, 'INSTRUÇÕES E AUTORIZAÇÃO', top, bold);
  const instructionsBottom = top - 65;
  page.drawRectangle({ x: MARGIN, y: instructionsBottom, width: CONTENT_WIDTH, height: 65, borderColor: BLACK, borderWidth: 0.7 });
  drawWrappedText({ page, value: 'Todos os exames laboratoriais deverão ser realizados em jejum de 12 horas (somente ingestão de água), com exceção de Tipagem Sanguínea, VHS, Hemograma e Beta HCG. Para exames laboratoriais, chegar de 07h00 às 10h00, de segunda a sexta. Atendimento por ordem de chegada.', x: MARGIN + 7, y: top - 12, width: CONTENT_WIDTH - 14, font: regular, size: 7.2, lineHeight: 8.2, maxLines: 4 });
  page.drawText('AUTORIZADO POR: _________________________________________________', { x: MARGIN + 7, y: instructionsBottom + 8, font: bold, size: 8.6, color: BLACK });

  const letterheadLogo = dataUriBytes(data.letterheadLogoDataUri);
  if (letterheadLogo) {
    const embedded = letterheadLogo.mimeType === 'image/jpeg' ? await document.embedJpg(letterheadLogo.bytes) : await document.embedPng(letterheadLogo.bytes);
    const dimensions = embedded.scaleToFit(43, 43);
    page.drawImage(embedded, { x: PAGE_WIDTH - 57, y: 7, width: dimensions.width, height: dimensions.height });
  }

  return document.save({ useObjectStreams: false });
}
