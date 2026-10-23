import { createHash } from 'node:crypto';

import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';

export const REP_P_PILOT_RECEIPT_TITLE = 'Ensaio de registro de ponto' as const;

export type RepPPilotReceiptSnapshot = Readonly<{
  schemaVersion: 1;
  title: typeof REP_P_PILOT_RECEIPT_TITLE;
  sequence: number;
  markedAt: string;
  hash: string;
  employeeName: string;
  unitName: string;
  workLocation: string;
  collectorId: '01' | '02';
}>;

export const REP_P_PILOT_RECEIPT_PREVIEW_SNAPSHOT: RepPPilotReceiptSnapshot = {
  schemaVersion: 1,
  title: REP_P_PILOT_RECEIPT_TITLE,
  sequence: 12,
  markedAt: '2026-10-22T09:15:00-0300',
  hash: 'a'.repeat(64),
  employeeName: 'Pessoa colaboradora (demonstração)',
  unitName: 'Unidade de demonstração',
  workLocation: 'Endereço fictício para prévia',
  collectorId: '01',
};

const timestampPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):00([+-])(\d{2})(\d{2})$/;
const hashPattern = /^[a-f0-9]{64}$/;

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) { current = candidate; continue; }
    if (current) lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

function assertSnapshot(snapshot: RepPPilotReceiptSnapshot) {
  if (!snapshot || snapshot.schemaVersion !== 1 || snapshot.title !== REP_P_PILOT_RECEIPT_TITLE
    || !Number.isSafeInteger(snapshot.sequence) || snapshot.sequence < 1
    || !timestampPattern.test(snapshot.markedAt) || !hashPattern.test(snapshot.hash)
    || !snapshot.employeeName.trim() || !snapshot.unitName.trim() || !snapshot.workLocation.trim()
    || !['01', '02'].includes(snapshot.collectorId)) {
    throw new TypeError('Snapshot incompatível com o comprovante de ensaio.');
  }
}

function formattedInstant(value: string) {
  const [, year, month, day, hour, minute, sign, offsetHour, offsetMinute] = timestampPattern.exec(value)!;
  return `${day}/${month}/${year} às ${hour}:${minute} (UTC${sign}${offsetHour}:${offsetMinute})`;
}

export function repPPilotReceiptFilename(snapshot: Pick<RepPPilotReceiptSnapshot, 'sequence' | 'markedAt'>) {
  return `ensaio-ponto-${snapshot.markedAt.slice(0, 10)}-sequencia-${snapshot.sequence}.pdf`;
}

/** Documento deliberadamente não fiscal: não usa NSR, INPI, CPF, CNPJ nem assinatura ICP-Brasil. */
export async function renderRepPPilotReceipt(snapshot: RepPPilotReceiptSnapshot) {
  assertSnapshot(snapshot);
  const document = await PDFDocument.create({ updateMetadata: false });
  const markedAt = new Date(Date.parse(snapshot.markedAt.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')));
  document.setTitle(`${REP_P_PILOT_RECEIPT_TITLE} - sequência ${snapshot.sequence}`);
  document.setSubject('Ensaio operacional sem validade como comprovante REP-P');
  document.setCreator('coala-rep-p-pilot-v1');
  document.setProducer('coala-rep-p-pilot-v1');
  document.setCreationDate(markedAt);
  document.setModificationDate(markedAt);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const mono = await document.embedFont(StandardFonts.Courier);
  const page = document.addPage([420, 595.28]);
  const margin = 32;
  const width = page.getWidth() - margin * 2;
  let y = page.getHeight() - margin;
  const ink = rgb(0.1, 0.1, 0.12);
  const muted = rgb(0.38, 0.38, 0.42);
  page.drawRectangle({ x: margin, y: y - 28, width, height: 28, color: rgb(0.75, 0.07, 0.24) });
  page.drawText('ENSAIO - SEM VALIDADE COMO REP-P', { x: margin + 8, y: y - 19, size: 11, font: bold, color: rgb(1, 1, 1) });
  y -= 42;
  page.drawText(REP_P_PILOT_RECEIPT_TITLE, { x: margin, y: y - 16, size: 16, font: bold, color: ink });
  y -= 34;
  const field = (label: string, value: string, font = regular, size = 10) => {
    page.drawText(label.toUpperCase(), { x: margin, y: y - 7, size: 7, font: bold, color: muted });
    y -= 11;
    for (const line of wrap(value, font, size, width)) {
      page.drawText(line, { x: margin, y: y - size, size, font, color: ink });
      y -= size + 3;
    }
    y -= 7;
  };
  field('Colaborador', snapshot.employeeName);
  field('Unidade escolhida', snapshot.unitName);
  field('Local', snapshot.workLocation);
  field('Data e hora do ensaio', formattedInstant(snapshot.markedAt), bold, 12);
  field('Sequência do ensaio', String(snapshot.sequence), bold, 12);
  field('Canal', snapshot.collectorId === '01' ? 'Coala Go' : 'Coala One no navegador');
  field('Hash técnico do ensaio', snapshot.hash, mono, 8);
  const note = 'Este documento serve apenas para testar o fluxo. Não possui NSR, não integra a ARP, não entra no AFD/AEJ, não participa do fechamento e não substitui o registro oficial vigente.';
  let noteY = margin + 34;
  for (const line of wrap(note, regular, 7.5, width)) {
    page.drawText(line, { x: margin, y: noteY, size: 7.5, font: regular, color: muted });
    noteY -= 10;
  }
  const bytes = Buffer.from(await document.save({ useObjectStreams: false }));
  return { bytes, filename: repPPilotReceiptFilename(snapshot), sha256: createHash('sha256').update(bytes).digest('hex') };
}
