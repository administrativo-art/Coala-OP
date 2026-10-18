import { createHash } from 'node:crypto';

import { CnpjValidator } from '@/lib/company/cnpj-validator';
import { isValidCpf, normalizeCpf } from '@/lib/hr/employee-document-match';

export const REP_P_AFD_LAYOUT_VERSION = '004' as const;
export const REP_P_CORE_VERSION = 'rep-p-synthetic-v1' as const;

export type RepPCollectorId = '01' | '02' | '03' | '04' | '05';
export type RepPMarkingMode = '0' | '1';

export type RepPMarkingInput = {
  attemptId: string;
  workspaceId: string;
  employeeId: string;
  employeeCpf: string;
  employmentHistoryId: string;
  employmentRevision: number;
  employerUnitId: string;
  employerCnpj: string;
  establishmentId: string;
  executionUnitId: string;
  markedAt: string;
  recordedAt: string;
  collectorId: RepPCollectorId;
  mode: RepPMarkingMode;
};

export type RepPSequenceRecord = {
  establishmentId: string;
  nsr: number;
  hash: string;
};

export type RepPSequenceState = {
  nextNsr: number;
  previousRecord: RepPSequenceRecord | null;
  existingAttempt?: RepPMarkingCandidate | null;
};

export type RepPReceiptSeed = Readonly<{
  title: 'Comprovante de Registro de Ponto do Trabalhador';
  nsr: number;
  employerCnpj: string;
  employeeCpf: string;
  markedAt: string;
  hash: string;
  collectorId: RepPCollectorId;
  establishmentId: string;
  executionUnitId: string;
  status: 'blocked_missing_legal_prerequisites';
  missingLegalPrerequisites: readonly ['employerLegalName', 'workLocationDescription', 'inpiRegistration', 'padesSignature'];
}>;

export type RepPMarkingCandidate = Readonly<{
  schemaVersion: 1;
  coreVersion: typeof REP_P_CORE_VERSION;
  complianceStatus: 'synthetic_only';
  persistenceStatus: 'not_persisted';
  layoutVersion: typeof REP_P_AFD_LAYOUT_VERSION;
  recordType: '7';
  markingId: string;
  inputDigest: string;
  attemptId: string;
  workspaceId: string;
  employeeId: string;
  employeeCpf: string;
  employeeCpfField: string;
  employmentHistoryId: string;
  employmentRevision: number;
  employerUnitId: string;
  employerCnpj: string;
  establishmentId: string;
  executionUnitId: string;
  markedAt: string;
  recordedAt: string;
  collectorId: RepPCollectorId;
  mode: '0';
  nsr: number;
  nsrField: string;
  previousHash: string | null;
  hash: string;
  receiptSeed: RepPReceiptSeed;
}>;

export type RepPPreparationIssue =
  | 'INVALID_INPUT'
  | 'OFFLINE_OUTSIDE_MVP'
  | 'INVALID_SEQUENCE'
  | 'ATTEMPT_CONFLICT'
  | 'EXISTING_ATTEMPT_INVALID';

export type RepPPreparationResult =
  | { status: 'created'; marking: RepPMarkingCandidate; sequenceAfter: Readonly<{
    nextNsr: number; previousRecord: RepPSequenceRecord;
  }> }
  | { status: 'replayed'; marking: RepPMarkingCandidate }
  | { status: 'rejected'; issue: RepPPreparationIssue };

const collectors = new Set<RepPCollectorId>(['01', '02', '03', '04', '05']);
const hashPattern = /^[a-f0-9]{64}$/;
const timestampPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):00([+-])(\d{2})(\d{2})$/;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= 180;
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = timestampPattern.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, , offsetHour, offsetMinute] = match;
  const y = Number(year); const m = Number(month); const d = Number(day);
  const h = Number(hour); const min = Number(minute); const oh = Number(offsetHour); const om = Number(offsetMinute);
  if (h > 23 || min > 59 || oh > 14 || om > 59 || (oh === 14 && om !== 0)) return false;
  const civil = new Date(Date.UTC(y, m - 1, d));
  if (civil.getUTCFullYear() !== y || civil.getUTCMonth() !== m - 1 || civil.getUTCDate() !== d) return false;
  return Number.isFinite(timestampInstant(value));
}

function timestampInstant(value: string): number {
  return Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
}

function numericField(value: string, width: number): string {
  if (!/^\d+$/.test(value) || value.length > width) throw new TypeError('Campo numérico incompatível com o leiaute AFD.');
  // Regra geral do leiaute: conteúdo começa à esquerda; posições restantes recebem espaço.
  return value.padEnd(width, ' ');
}

function nsrField(nsr: number): string {
  if (!Number.isSafeInteger(nsr) || nsr < 1 || nsr > 999_999_999) {
    throw new TypeError('NSR incompatível com o leiaute AFD.');
  }
  return numericField(String(nsr), 9);
}

function cpfField(cpf: string): string {
  const clean = normalizeCpf(cpf);
  if (!isValidCpf(clean)) throw new TypeError('CPF incompatível com o registro REP-P.');
  return numericField(clean, 12);
}

function inputDigest(input: RepPMarkingInput): string {
  return sha256(JSON.stringify([
    REP_P_CORE_VERSION, input.attemptId, input.workspaceId, input.employeeId, normalizeCpf(input.employeeCpf),
    input.employmentHistoryId, String(input.employmentRevision), input.employerUnitId,
    CnpjValidator.clean(input.employerCnpj), input.establishmentId, input.executionUnitId,
    input.markedAt, input.recordedAt, input.collectorId, input.mode,
  ]));
}

function validInput(input: RepPMarkingInput): boolean {
  return Boolean(input && typeof input === 'object'
    && identifier(input.attemptId) && identifier(input.workspaceId) && identifier(input.employeeId)
    && isValidCpf(input.employeeCpf) && identifier(input.employmentHistoryId)
    && Number.isSafeInteger(input.employmentRevision) && input.employmentRevision >= 1
    && identifier(input.employerUnitId) && CnpjValidator.validate(input.employerCnpj).valid
    && identifier(input.establishmentId) && identifier(input.executionUnitId)
    && validTimestamp(input.markedAt) && validTimestamp(input.recordedAt)
    && timestampInstant(input.recordedAt) >= timestampInstant(input.markedAt)
    && collectors.has(input.collectorId) && (input.mode === '0' || input.mode === '1'));
}

function validSequence(state: RepPSequenceState, establishmentId: string): boolean {
  if (!state || typeof state !== 'object' || !Number.isSafeInteger(state.nextNsr)
    || state.nextNsr < 1 || state.nextNsr > 999_999_999) return false;
  if (state.nextNsr === 1) return state.previousRecord === null;
  if (state.previousRecord === null) return true;
  return state.previousRecord.establishmentId === establishmentId
    && Number.isSafeInteger(state.previousRecord.nsr)
    && state.previousRecord.nsr >= 1
    && state.previousRecord.nsr < state.nextNsr
    && hashPattern.test(state.previousRecord.hash);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function cloneMarking(marking: RepPMarkingCandidate): RepPMarkingCandidate {
  return deepFreeze(JSON.parse(JSON.stringify(marking)) as RepPMarkingCandidate);
}

/**
 * Serializa exatamente os campos 1–7 do registro tipo 7 e acrescenta o hash do registro anterior,
 * quando existente, conforme o leiaute AFD 004. A linha AFD completa e sua assinatura não são geradas aqui.
 */
export function serializeRepPType7HashSource(input: {
  nsr: number;
  markedAt: string;
  employeeCpf: string;
  recordedAt: string;
  collectorId: RepPCollectorId;
  mode: RepPMarkingMode;
  previousHash: string | null;
}): string {
  if (!validTimestamp(input.markedAt) || !validTimestamp(input.recordedAt)
    || !collectors.has(input.collectorId) || (input.mode !== '0' && input.mode !== '1')
    || input.previousHash !== null && !hashPattern.test(input.previousHash)) {
    throw new TypeError('Campos incompatíveis com o hash do registro tipo 7.');
  }
  return `${nsrField(input.nsr)}7${input.markedAt}${cpfField(input.employeeCpf)}${input.recordedAt}`
    + `${input.collectorId}${input.mode}${input.previousHash ?? ''}`;
}

export function hashRepPType7(input: Parameters<typeof serializeRepPType7HashSource>[0]): string {
  return sha256(serializeRepPType7HashSource(input));
}

export function verifyRepPMarkingCandidate(marking: RepPMarkingCandidate): boolean {
  try {
    if (!marking || marking.schemaVersion !== 1 || marking.coreVersion !== REP_P_CORE_VERSION
      || marking.complianceStatus !== 'synthetic_only' || marking.persistenceStatus !== 'not_persisted'
      || marking.layoutVersion !== REP_P_AFD_LAYOUT_VERSION || marking.recordType !== '7'
      || marking.mode !== '0' || !hashPattern.test(marking.hash)
      || marking.nsrField !== nsrField(marking.nsr) || marking.employeeCpfField !== cpfField(marking.employeeCpf)
      || marking.inputDigest !== inputDigest(marking)
      || marking.markingId !== `rep-p:${marking.establishmentId}:${marking.nsr}:${marking.inputDigest.slice(0, 16)}`
      || marking.hash !== hashRepPType7(marking)
      || marking.receiptSeed.hash !== marking.hash || marking.receiptSeed.nsr !== marking.nsr
      || marking.receiptSeed.title !== 'Comprovante de Registro de Ponto do Trabalhador'
      || marking.receiptSeed.status !== 'blocked_missing_legal_prerequisites'
      || marking.receiptSeed.employerCnpj !== marking.employerCnpj
      || marking.receiptSeed.employeeCpf !== marking.employeeCpf
      || marking.receiptSeed.markedAt !== marking.markedAt
      || marking.receiptSeed.collectorId !== marking.collectorId
      || marking.receiptSeed.establishmentId !== marking.establishmentId
      || marking.receiptSeed.executionUnitId !== marking.executionUnitId
      || JSON.stringify(marking.receiptSeed.missingLegalPrerequisites)
        !== JSON.stringify(['employerLegalName', 'workLocationDescription', 'inpiRegistration', 'padesSignature'])) return false;
    return validInput(marking);
  } catch {
    return false;
  }
}

/** Prepara uma transição determinística. Persistência, transação de NSR, ARP e assinatura ficam fora deste core. */
export function prepareRepPMarking(input: RepPMarkingInput, state: RepPSequenceState): RepPPreparationResult {
  if (!validInput(input)) return { status: 'rejected', issue: 'INVALID_INPUT' };
  if (input.mode === '1') return { status: 'rejected', issue: 'OFFLINE_OUTSIDE_MVP' };
  const digest = inputDigest(input);

  if (state?.existingAttempt) {
    if (!verifyRepPMarkingCandidate(state.existingAttempt)) {
      return { status: 'rejected', issue: 'EXISTING_ATTEMPT_INVALID' };
    }
    if (state.existingAttempt.attemptId !== input.attemptId || state.existingAttempt.inputDigest !== digest) {
      return { status: 'rejected', issue: 'ATTEMPT_CONFLICT' };
    }
    return { status: 'replayed', marking: cloneMarking(state.existingAttempt) };
  }

  if (!validSequence(state, input.establishmentId)) return { status: 'rejected', issue: 'INVALID_SEQUENCE' };
  const previousHash = state.previousRecord?.hash ?? null;
  const hash = hashRepPType7({ nsr: state.nextNsr, markedAt: input.markedAt,
    employeeCpf: input.employeeCpf, recordedAt: input.recordedAt, collectorId: input.collectorId,
    mode: input.mode, previousHash });
  const cleanCpf = normalizeCpf(input.employeeCpf);
  const cleanCnpj = CnpjValidator.clean(input.employerCnpj);
  const marking = deepFreeze<RepPMarkingCandidate>({
    schemaVersion: 1, coreVersion: REP_P_CORE_VERSION, complianceStatus: 'synthetic_only',
    persistenceStatus: 'not_persisted', layoutVersion: REP_P_AFD_LAYOUT_VERSION, recordType: '7',
    markingId: `rep-p:${input.establishmentId}:${state.nextNsr}:${digest.slice(0, 16)}`,
    inputDigest: digest, attemptId: input.attemptId, workspaceId: input.workspaceId,
    employeeId: input.employeeId, employeeCpf: cleanCpf, employeeCpfField: cpfField(cleanCpf),
    employmentHistoryId: input.employmentHistoryId, employmentRevision: input.employmentRevision,
    employerUnitId: input.employerUnitId, employerCnpj: cleanCnpj,
    establishmentId: input.establishmentId, executionUnitId: input.executionUnitId,
    markedAt: input.markedAt, recordedAt: input.recordedAt, collectorId: input.collectorId,
    mode: '0', nsr: state.nextNsr, nsrField: nsrField(state.nextNsr), previousHash, hash,
    receiptSeed: {
      title: 'Comprovante de Registro de Ponto do Trabalhador', nsr: state.nextNsr,
      employerCnpj: cleanCnpj, employeeCpf: cleanCpf, markedAt: input.markedAt, hash,
      collectorId: input.collectorId, establishmentId: input.establishmentId,
      executionUnitId: input.executionUnitId, status: 'blocked_missing_legal_prerequisites',
      missingLegalPrerequisites: ['employerLegalName', 'workLocationDescription', 'inpiRegistration', 'padesSignature'],
    },
  });
  return {
    status: 'created', marking,
    sequenceAfter: deepFreeze({ nextNsr: state.nextNsr + 1,
      previousRecord: { establishmentId: input.establishmentId, nsr: state.nextNsr, hash } }),
  };
}

/** Verifica uma cadeia de marcações de um único estabelecimento; outros tipos podem ocupar NSRs intermediários. */
export function verifyRepPChain(markings: readonly RepPMarkingCandidate[]): boolean {
  if (!Array.isArray(markings) || markings.length === 0) return false;
  return markings.every((marking, index) => {
    if (!verifyRepPMarkingCandidate(marking)) return false;
    const previous = markings[index - 1];
    if (index === 0) return marking.nsr >= 1 && marking.previousHash === null;
    return marking.establishmentId === previous.establishmentId
      && marking.nsr > previous.nsr && marking.previousHash === previous.hash;
  });
}
