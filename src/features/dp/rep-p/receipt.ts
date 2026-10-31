import { createHash } from 'node:crypto';

import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';

import { CnpjValidator } from '@/lib/company/cnpj-validator';
import { isValidCpf, normalizeCpf } from '@/lib/hr/employee-document-match';

import type { RepPCollectorId } from './core';

export const REP_P_RECEIPT_TITLE = 'Comprovante de Registro de Ponto do Trabalhador' as const;
export const REP_P_RECEIPT_RENDERER_VERSION = 'rep-p-receipt-pdf-v1' as const;
export const REP_P_INPI_PATTERN = /^\d{1,17}$/;

/**
 * Conteúdo congelado na mesma transação da marcação. O PDF é sempre derivado deste snapshot,
 * nunca do cadastro atual, para que uma reemissão não produza documento diferente.
 */
export type RepPReceiptSnapshot = Readonly<{
  schemaVersion: 1;
  title: typeof REP_P_RECEIPT_TITLE;
  nsr: number;
  markedAt: string;
  hash: string;
  employerLegalName: string;
  employerCnpj: string;
  cnoCaepf: string | null;
  workLocation: string | null;
  inpiRegistration: string;
  developerCnpj: string;
  employeeName: string;
  employeeCpf: string;
  collectorId: RepPCollectorId;
  establishmentId: string;
  executionUnitId: string;
}>;

/** Dados fictícios da prévia do catálogo de documentos; CPF e CNPJ apenas válidos no dígito. */
export const REP_P_RECEIPT_PREVIEW_SNAPSHOT: RepPReceiptSnapshot = Object.freeze({
  schemaVersion: 1, title: REP_P_RECEIPT_TITLE, nsr: 1, markedAt: '2026-01-01T08:00:00-0300',
  hash: '0'.repeat(64), employerLegalName: 'Empregador exemplo LTDA', employerCnpj: '11222333000181',
  cnoCaepf: null, workLocation: 'Endereço do local da prestação do serviço', inpiRegistration: '00000000000000000',
  developerCnpj: '14276603000125', employeeName: 'Pessoa colaboradora exemplo', employeeCpf: '52998224725',
  collectorId: '01', establishmentId: 'preview', executionUnitId: 'preview',
});

export type RepPReceiptMissingField = 'employerLegalName' | 'workLocation' | 'inpiRegistration' | 'employeeName';

export interface RepPPadesSigner {
  signPdf(content: Buffer): Promise<Readonly<{ bytes: Buffer; format: 'PAdES'; certificateCnpj: string }>>;
}

export type RepPSignedReceipt = Readonly<{
  filename: string;
  bytes: Buffer;
  sha256: string;
  unsignedSha256: string;
  certificateCnpj: string;
}>;

const hashPattern = /^[a-f0-9]{64}$/;
const timestampPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):00([+-])(\d{2})(\d{2})$/;
const collectorLabels: Record<RepPCollectorId, string> = {
  '01': 'Aplicativo mobile', '02': 'Browser (navegador internet)', '03': 'Aplicativo desktop',
  '04': 'Dispositivo eletrônico', '05': 'Outro dispositivo eletrônico não especificado',
};

function sha256(value: Buffer) { return createHash('sha256').update(value).digest('hex'); }
function present(value: string | null | undefined) { return typeof value === 'string' && value.trim().length > 0; }

export function missingRepPReceiptFields(snapshot: Pick<RepPReceiptSnapshot, RepPReceiptMissingField>): RepPReceiptMissingField[] {
  const missing: RepPReceiptMissingField[] = [];
  if (!present(snapshot.employerLegalName)) missing.push('employerLegalName');
  if (!present(snapshot.workLocation)) missing.push('workLocation');
  // Registro INPI: só dígitos, até 17 posições (o número atual tem 13; o AFD completa com espaços).
  if (typeof snapshot.inpiRegistration !== 'string'
    || snapshot.inpiRegistration !== '' && !REP_P_INPI_PATTERN.test(snapshot.inpiRegistration)) missing.push('inpiRegistration');
  if (!present(snapshot.employeeName)) missing.push('employeeName');
  return missing;
}

function assertSnapshot(snapshot: RepPReceiptSnapshot) {
  if (!snapshot || snapshot.schemaVersion !== 1 || snapshot.title !== REP_P_RECEIPT_TITLE
    || !Number.isSafeInteger(snapshot.nsr) || snapshot.nsr < 1 || snapshot.nsr > 999_999_999
    || !timestampPattern.test(snapshot.markedAt) || !hashPattern.test(snapshot.hash)
    || !CnpjValidator.validate(snapshot.employerCnpj).valid || !CnpjValidator.validate(snapshot.developerCnpj).valid
    || !isValidCpf(snapshot.employeeCpf) || !(snapshot.collectorId in collectorLabels)
    || missingRepPReceiptFields(snapshot).length > 0) {
    throw new TypeError('Snapshot incompatível com o comprovante REP-P.');
  }
}

export function formatCnpj(value: string) {
  return CnpjValidator.clean(value).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}
export function formatCpf(value: string) {
  return normalizeCpf(value).replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
}
function formatMarkedAt(value: string) {
  const [, year, month, day, hour, minute, sign, offsetHour, offsetMinute] = timestampPattern.exec(value)!;
  return `${day}/${month}/${year} às ${hour}:${minute} (UTC${sign}${offsetHour}:${offsetMinute})`;
}

/** Quebra o texto pela largura medida na fonte; palavras maiores que a linha são cortadas por caractere. */
export function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) { current = candidate; continue; }
    if (current) lines.push(current);
    current = '';
    for (const character of word) {
      if (font.widthOfTextAtSize(current + character, size) > width) { lines.push(current); current = ''; }
      current += character;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

export function repPReceiptFilename(snapshot: Pick<RepPReceiptSnapshot, 'nsr' | 'markedAt'>) {
  return `comprovante-ponto-${snapshot.markedAt.slice(0, 10)}-nsr-${snapshot.nsr}.pdf`;
}

/**
 * Gera o PDF sem assinatura de forma determinística: mesmo snapshot, mesmos bytes.
 * Metadados de data usam o instante da marcação, e não o momento da renderização.
 */
export async function renderRepPReceiptPdf(snapshot: RepPReceiptSnapshot, options: { preview?: boolean; sample?: boolean } = {}): Promise<Buffer> {
  assertSnapshot(snapshot);
  const document = await PDFDocument.create({ updateMetadata: false });
  const markedAt = new Date(Date.parse(snapshot.markedAt.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')));
  document.setTitle(`${REP_P_RECEIPT_TITLE} - NSR ${snapshot.nsr}`);
  document.setSubject(`Hash SHA-256 ${snapshot.hash}`);
  document.setCreator(REP_P_RECEIPT_RENDERER_VERSION);
  document.setProducer(REP_P_RECEIPT_RENDERER_VERSION);
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

  if (options.sample) {
    // Faixa visível no topo: a amostra de homologação não pode ser confundida com comprovante.
    page.drawRectangle({ x: margin, y: y - 22, width, height: 22, color: rgb(0.75, 0.07, 0.24) });
    page.drawText('AMOSTRA - SEM VALIDADE', { x: margin + 8, y: y - 16, size: 12, font: bold, color: rgb(1, 1, 1) });
    y -= 30;
  }
  for (const line of wrap(REP_P_RECEIPT_TITLE, bold, 14, width)) {
    page.drawText(line, { x: margin, y: y - 14, size: 14, font: bold, color: ink });
    y -= 19;
  }
  y -= 6;
  page.drawLine({ start: { x: margin, y }, end: { x: margin + width, y }, thickness: 0.6, color: muted });
  y -= 14;

  const field = (label: string, value: string, font = regular, size = 10) => {
    page.drawText(label.toUpperCase(), { x: margin, y: y - 7, size: 7, font: bold, color: muted });
    y -= 11;
    for (const line of wrap(value, font, size, width)) {
      page.drawText(line, { x: margin, y: y - size, size, font, color: ink });
      y -= size + 3;
    }
    y -= 7;
  };

  field('Empregador', snapshot.employerLegalName);
  field('CNPJ do empregador', formatCnpj(snapshot.employerCnpj));
  if (present(snapshot.cnoCaepf)) field('CNO/CAEPF', snapshot.cnoCaepf!);
  field('Local da prestação do serviço', snapshot.workLocation!);
  field('Trabalhador', snapshot.employeeName);
  field('CPF do trabalhador', formatCpf(snapshot.employeeCpf));
  field('Data e horário da marcação', formatMarkedAt(snapshot.markedAt), bold, 12);
  field('NSR', String(snapshot.nsr), bold, 12);
  field('Coletor', `${snapshot.collectorId} - ${collectorLabels[snapshot.collectorId]}`);
  field('Registro do programa no INPI', snapshot.inpiRegistration);
  field('CNPJ da desenvolvedora', formatCnpj(snapshot.developerCnpj));
  field('Código hash SHA-256 da marcação', snapshot.hash, mono, 8);

  const footer = options.preview ? 'Prévia do modelo com dados fictícios - sem assinatura e sem validade.'
    : options.sample ? 'Amostra de homologação com dados fictícios, assinada digitalmente (PAdES) - sem validade como comprovante.'
      : 'Documento assinado digitalmente (PAdES).';
  page.drawText(footer, { x: margin, y: margin, size: 7, font: regular, color: muted });
  return Buffer.from(await document.save({ useObjectStreams: false }));
}

/**
 * Exige assinatura PAdES por atualização incremental: os bytes originais ficam intactos
 * e a seção acrescentada declara o dicionário de assinatura CAdES destacada.
 */
export async function signRepPReceipt(snapshot: RepPReceiptSnapshot, unsigned: Buffer, signer: RepPPadesSigner): Promise<RepPSignedReceipt> {
  const signed = await signer.signPdf(Buffer.from(unsigned));
  const appended = Buffer.isBuffer(signed?.bytes) && signed.bytes.length > unsigned.length
    ? signed.bytes.subarray(unsigned.length).toString('latin1') : '';
  const certificate = CnpjValidator.validate(signed?.certificateCnpj ?? '');
  if (signed?.format !== 'PAdES' || !appended || !signed.bytes.subarray(0, unsigned.length).equals(unsigned)
    || !appended.includes('/ByteRange') || !appended.includes('/ETSI.CAdES.detached')
    || !certificate.valid || certificate.clean !== CnpjValidator.clean(snapshot.developerCnpj)) {
    throw new TypeError('Assinatura PAdES não corresponde ao comprovante ou à desenvolvedora.');
  }
  const bytes = Buffer.from(signed.bytes);
  return Object.freeze({ filename: repPReceiptFilename(snapshot), bytes, sha256: sha256(bytes),
    unsignedSha256: sha256(unsigned), certificateCnpj: certificate.clean });
}
