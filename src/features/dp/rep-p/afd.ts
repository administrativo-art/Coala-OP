import { createHash } from 'node:crypto';

import { CnpjValidator } from '@/lib/company/cnpj-validator';
import { isValidCpf, normalizeCpf } from '@/lib/hr/employee-document-match';

import { hashRepPType7, REP_P_AFD_LAYOUT_VERSION, type RepPCollectorId, type RepPMarkingMode } from './core';

const AFD_SIGNATURE_LITERAL = 'ASSINATURA_DIGITAL_EM_ARQUIVO_P7S';
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00[+-]\d{4}$/;
const civilDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const hashPattern = /^[a-f0-9]{64}$/;

export type RepPEmployerEvent = Readonly<{
  recordType: '2'; nsr: number; establishmentId: string; recordedAt: string; responsibleCpf: string;
  employerCnpj: string; cnoCaepf?: string; employerLegalName: string; workLocation: string;
}>;
export type RepPClockAdjustmentEvent = Readonly<{
  recordType: '4'; nsr: number; establishmentId: string; beforeAt: string; adjustedAt: string; responsibleCpf: string;
}>;
export type RepPEmployeeEvent = Readonly<{
  recordType: '5'; nsr: number; establishmentId: string; recordedAt: string; operation: 'I' | 'A' | 'E';
  employeeCpf: string; employeeName: string; otherIdentifier?: string; responsibleCpf: string;
}>;
export type RepPSensitiveEvent = Readonly<{
  recordType: '6'; nsr: number; establishmentId: string; recordedAt: string; eventCode: '02' | '07' | '08';
}>;
export type RepPMarkingEvent = Readonly<{
  recordType: '7'; nsr: number; establishmentId: string; markedAt: string; employeeCpf: string;
  recordedAt: string; collectorId: RepPCollectorId; mode: RepPMarkingMode; previousHash: string | null; hash: string;
}>;
export type RepPAfdEvent = RepPEmployerEvent | RepPClockAdjustmentEvent | RepPEmployeeEvent | RepPSensitiveEvent | RepPMarkingEvent;

export type RepPAfdProfile = Readonly<{
  establishmentId: string;
  employerCnpj: string;
  cnoCaepf?: string;
  employerLegalName: string;
  inpiRegistration: string;
  developerCnpj: string;
}>;

export type RepPAfdPackage = Readonly<{
  filename: string;
  signatureFilename: string;
  bytes: Buffer;
  sha256: string;
  lineCount: number;
  counts: Readonly<Record<'2' | '3' | '4' | '5' | '6' | '7', number>>;
}>;

export interface RepPCadesSigner {
  signDetached(content: Buffer): Promise<Readonly<{
    bytes: Buffer; format: 'CAdES'; detached: true; certificateCnpj: string;
  }>>;
}

function latin1(value: string): boolean {
  return [...value].every((character) => character.codePointAt(0)! <= 255);
}
function text(value: string | undefined, width: number, required = true): string {
  const normalized = value?.trim() ?? '';
  if (required && !normalized || normalized.includes('\r') || normalized.includes('\n')
    || !latin1(normalized) || normalized.length > width) throw new TypeError('Campo alfanumérico incompatível com o AFD.');
  return normalized.padEnd(width, ' ');
}
function digits(value: string | undefined, width: number, required = true): string {
  const normalized = value?.trim() ?? '';
  if (required && !normalized || normalized && !/^\d+$/.test(normalized) || normalized.length > width) {
    throw new TypeError('Campo numérico incompatível com o AFD.');
  }
  return normalized.padEnd(width, ' ');
}
function cpf(value: string, width: 11 | 12 | 14): string {
  const normalized = normalizeCpf(value);
  if (!isValidCpf(normalized)) throw new TypeError('CPF incompatível com o AFD.');
  return normalized.padEnd(width, ' ');
}
function cnpj(value: string): string {
  const result = CnpjValidator.validate(value);
  if (!result.valid) throw new TypeError('CNPJ incompatível com o AFD.');
  return result.clean;
}
function nsr(value: number): string {
  if (!Number.isSafeInteger(value) || value < 1 || value > 999_999_999) throw new TypeError('NSR incompatível com o AFD.');
  return String(value).padEnd(9, ' ');
}
function timestamp(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T/.exec(value);
  if (!timestampPattern.test(value) || !match || !validCivilParts(match[1], match[2], match[3])
    || !Number.isFinite(Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')))) {
    throw new TypeError('Data e hora incompatíveis com o AFD.');
  }
  return value;
}
function validCivilParts(year: string, month: string, day: string) {
  const y = Number(year); const m = Number(month); const d = Number(day);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m - 1 && parsed.getUTCDate() === d;
}
function civilDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!civilDatePattern.test(value) || !match || !validCivilParts(match[1], match[2], match[3])) {
    throw new TypeError('Período inválido para o AFD.');
  }
  return value;
}

export function crc16Kermit(value: string): string {
  const bytes = Buffer.from(value, 'latin1');
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? crc >>> 1 ^ 0x8408 : crc >>> 1;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
function withCrc(prefix: string): string { return `${prefix}${crc16Kermit(prefix)}`; }

export function serializeRepPAfdEvent(event: RepPAfdEvent): string {
  if (!event.establishmentId.trim()) throw new TypeError('Estabelecimento ausente no evento AFD.');
  switch (event.recordType) {
    case '2': return withCrc(`${nsr(event.nsr)}2${timestamp(event.recordedAt)}${cpf(event.responsibleCpf, 14)}1`
      + `${cnpj(event.employerCnpj)}${digits(event.cnoCaepf, 14, false)}${text(event.employerLegalName, 150)}`
      + `${text(event.workLocation, 100)}`);
    case '4': return withCrc(`${nsr(event.nsr)}4${timestamp(event.beforeAt)}${timestamp(event.adjustedAt)}${cpf(event.responsibleCpf, 11)}`);
    case '5': return withCrc(`${nsr(event.nsr)}5${timestamp(event.recordedAt)}${event.operation}${cpf(event.employeeCpf, 12)}`
      + `${text(event.employeeName, 52)}${text(event.otherIdentifier, 4, false)}${cpf(event.responsibleCpf, 11)}`);
    case '6': return `${nsr(event.nsr)}6${timestamp(event.recordedAt)}${event.eventCode}`;
    case '7': {
      if (!hashPattern.test(event.hash) || event.hash !== hashRepPType7(event)) throw new TypeError('Hash do registro tipo 7 inválido.');
      return `${nsr(event.nsr)}7${timestamp(event.markedAt)}${cpf(event.employeeCpf, 12)}`
        + `${timestamp(event.recordedAt)}${event.collectorId}${event.mode}${event.hash}`;
    }
  }
}

function header(profile: RepPAfdProfile, startDate: string, endDate: string, generatedAt: string): string {
  const prefix = `00000000011${cnpj(profile.employerCnpj)}${digits(profile.cnoCaepf, 14, false)}`
    + `${text(profile.employerLegalName, 150)}${digits(profile.inpiRegistration, 17, false)}`
    + `${civilDate(startDate)}${civilDate(endDate)}${timestamp(generatedAt)}${REP_P_AFD_LAYOUT_VERSION}`
    + `1${cnpj(profile.developerCnpj)}${text('', 30, false)}`;
  return withCrc(prefix);
}

function trailer(counts: RepPAfdPackage['counts']): string {
  return `999999999${(['2', '3', '4', '5', '6', '7'] as const).map((type) => String(counts[type]).padEnd(9, ' ')).join('')}9`;
}

export function generateRepPAfd(input: {
  profile: RepPAfdProfile; startDate: string; endDate: string; generatedAt: string; events: readonly RepPAfdEvent[];
}): RepPAfdPackage {
  const { profile } = input;
  if (!profile.establishmentId.trim() || input.endDate < input.startDate) throw new TypeError('Perfil ou período AFD inválido.');
  const sorted = [...input.events].sort((a, b) => a.nsr - b.nsr);
  if (sorted.some((event, index) => event.establishmentId !== profile.establishmentId
    || index > 0 && event.nsr <= sorted[index - 1].nsr)) throw new TypeError('Eventos AFD fora do estabelecimento ou com NSR duplicado.');
  const counts: Record<'2' | '3' | '4' | '5' | '6' | '7', number> =
    { '2': 0, '3': 0, '4': 0, '5': 0, '6': 0, '7': 0 };
  const eventLines = sorted.map((event) => { counts[event.recordType] += 1; return serializeRepPAfdEvent(event); });
  const lines = [header(profile, input.startDate, input.endDate, input.generatedAt), ...eventLines, trailer(counts),
    text(AFD_SIGNATURE_LITERAL, 100)];
  const content = `${lines.join('\r\n')}\r\n`;
  const bytes = Buffer.from(content, 'latin1');
  const filename = `AFD${digits(profile.inpiRegistration, 17, false).trim()}${cnpj(profile.employerCnpj)}REP_P.txt`;
  return Object.freeze({ filename, signatureFilename: `${filename}.p7s`, bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'), lineCount: lines.length, counts: Object.freeze(counts) });
}

export async function signRepPAfd(pkg: RepPAfdPackage, signer: RepPCadesSigner, developerCnpj: string) {
  const signed = await signer.signDetached(pkg.bytes);
  if (signed.format !== 'CAdES' || signed.detached !== true || !Buffer.isBuffer(signed.bytes) || signed.bytes.length === 0
    || cnpj(signed.certificateCnpj) !== cnpj(developerCnpj)) throw new TypeError('Assinatura CAdES não corresponde à desenvolvedora do AFD.');
  return Object.freeze({ ...pkg, signature: Buffer.from(signed.bytes), certificateCnpj: cnpj(signed.certificateCnpj) });
}
