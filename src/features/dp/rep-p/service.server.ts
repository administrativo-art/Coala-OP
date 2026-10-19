import 'server-only';

import { createHash } from 'node:crypto';

import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

import { resolveEmploymentReferenceForSystem } from '@/features/dp/employment-reference/service.server';
import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { isValidCpf, normalizeCpf } from '@/lib/hr/employee-document-match';
import { AppError } from '@/lib/observability/app-error';

import { generateRepPAfd, signRepPAfd, type RepPAfdEvent, type RepPAfdProfile, type RepPCadesSigner } from './afd';
import { assertTrustedRepPClockReading, civilDateFromRepPTimestamp, formatRepPAfdTimestamp, trustedRepPClockInstant,
  unconfiguredRepPClock, type RepPClock } from './clock';
import { createRepPIcpSigners, inspectRepPIcpCredential, loadRepPIcpIdentity } from './icp-signer';
import { configuredRepPClock } from './hlb-ntp-clock.server';
import { prepareRepPMarking, verifyRepPMarkingCandidate, type RepPMarkingCandidate } from './core';
import { missingRepPReceiptFields, REP_P_INPI_PATTERN, REP_P_RECEIPT_TITLE, renderRepPReceiptPdf, signRepPReceipt,
  type RepPPadesSigner, type RepPReceiptSnapshot } from './receipt';
import { repPAfdExportSchema, repPMarkingSchema, repPOwnHistorySchema, repPOwnOptionsSchema, type RepPAfdExportRequest, type RepPMarkingRequest,
  type RepPOwnHistoryRequest } from './schemas';

const ESTABLISHMENTS = 'repP_establishments';
const EMPLOYEES = 'repP_employees';
const EVENTS = 'repP_events';
const ATTEMPTS = 'repP_attempts';
const EXPORT_AUDIT = 'repP_exportAudit';
const RECEIPTS = 'repP_receipts';
// Leitura em páginas para o AFD sair inteiro e de pronto (art. 81 §2º); o teto só protege memória.
const AFD_PAGE_SIZE = 2_500;
// Medido em 18/10/2026: 100 mil eventos somam ~340 MB ao processo (instância de 1 GiB); 50 mil deixam margem.
const MAX_AFD_EVENTS = 50_000;
const MAX_RECEIPT_RETRIES_PER_RUN = 50;
// Espera entre tentativas de um mesmo comprovante: 15 min, depois 30 min no máximo (art. 80 II). Ordenar a fila
// pela próxima tentativa impede que pendentes que falham sempre ocupem o lote e deixem os demais sem emissão.
const RECEIPT_RETRY_BASE_MS = 15 * 60_000;
const RECEIPT_RETRY_MAX_MS = 30 * 60_000;
const MAX_HISTORY_MARKINGS = 300;
const MAX_PENDING_RECEIPTS = 100;
const CT_SORVETES_CNPJ = '14276603000125';

type Dependencies = Readonly<{
  repDb: Firestore; mainDb: Firestore; hrDb: Firestore; clock: RepPClock; signer: RepPCadesSigner;
  receiptSigner: RepPPadesSigner; markingEnabled: boolean; afdPageSize?: number; afdMaxEvents?: number; now?: () => Date;
}>;

const unavailableSigner: RepPCadesSigner = Object.freeze({
  async signDetached(): Promise<never> {
    throw new AppError({ code: 'REP_P_CADES_UNAVAILABLE', kind: 'TRANSIENT_EXTERNAL', retryable: false,
      safeMessage: 'A exportação AFD permanece bloqueada até o assinador CAdES ICP-Brasil ser configurado.' });
  },
});
const unavailableReceiptSigner: RepPPadesSigner = Object.freeze({
  async signPdf(): Promise<never> {
    throw new AppError({ code: 'REP_P_PADES_UNAVAILABLE', kind: 'TRANSIENT_EXTERNAL', retryable: false,
      safeMessage: 'O comprovante permanece pendente até o assinador PAdES ICP-Brasil ser configurado.' });
  },
});

/**
 * Credencial A1 da desenvolvedora vinda do Secret Manager (App Hosting expõe como variável).
 * Sem a variável, os assinadores continuam recusando; credencial inválida falha fechada a cada uso.
 */
const environmentClock: RepPClock = configuredRepPClock() ?? unconfiguredRepPClock;
let icpSigners: ReturnType<typeof createRepPIcpSigners> | null = null;
function environmentIcpSigners() {
  const pem = process.env.REP_P_ICP_SIGNER_PEM;
  if (!pem?.trim()) return null;
  icpSigners ??= createRepPIcpSigners(loadRepPIcpIdentity(pem, CT_SORVETES_CNPJ),
    // Instante gravado na assinatura (/M do PAdES, signingTime do CAdES) vem da Hora Legal; sem ela, a assinatura espera.
    () => trustedRepPClockInstant(environmentClock));
  return icpSigners;
}
const environmentCadesSigner: RepPCadesSigner = Object.freeze({
  signDetached: (content: Buffer) => (environmentIcpSigners()?.cades ?? unavailableSigner).signDetached(content),
});
const environmentPadesSigner: RepPPadesSigner = Object.freeze({
  signPdf: (content: Buffer) => (environmentIcpSigners()?.pades ?? unavailableReceiptSigner).signPdf(content),
});
const defaults: Dependencies = { repDb: hrDbAdmin, mainDb: dbAdmin, hrDb: hrDbAdmin,
  clock: environmentClock,
  signer: environmentCadesSigner, receiptSigner: environmentPadesSigner,
  markingEnabled: process.env.REP_P_MARKING_ENABLED === 'true' };

export type RepPReceiptState = Readonly<{
  receiptId: string; receiptStatus: 'available' | 'pending'; receiptIssue: string | null;
}>;

type EstablishmentDocument = {
  schemaVersion: 1; workspaceId: string; establishmentId: string; status: 'ready'; timeZone: string;
  profile: RepPAfdProfile; lastNsr: number; lastType7Hash: string | null; lastType7Nsr: number | null;
};

function fail(code: string, safeMessage: string, kind: 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT' | 'DATA_INTEGRITY' | 'AUTHORIZATION' = 'VALIDATION') {
  return new AppError({ code, kind, safeMessage });
}
function digest(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function establishmentKey(workspaceId: string, cnpj: string) { return digest(['establishment', workspaceId, cnpj]); }
function employeeKey(establishmentId: string, userId: string) { return digest(['employee', establishmentId, userId]); }
function eventKey(establishmentId: string, nsr: number) { return `${establishmentId}_${String(nsr).padStart(9, '0')}`; }
function recordedDate(event: RepPAfdEvent) {
  return (event.recordType === '4' ? event.adjustedAt : event.recordedAt).slice(0, 10);
}
function validEstablishment(value: unknown): value is EstablishmentDocument {
  const item = value as EstablishmentDocument | undefined;
  return Boolean(item && item.schemaVersion === 1 && item.status === 'ready' && item.workspaceId?.trim()
    && item.establishmentId?.trim() && item.timeZone?.trim() && item.profile?.establishmentId === item.establishmentId
    && Number.isSafeInteger(item.lastNsr) && item.lastNsr >= 0 && item.lastNsr <= 999_999_999
    && (item.lastType7Hash === null && item.lastType7Nsr === null
      || typeof item.lastType7Hash === 'string' && /^[a-f0-9]{64}$/.test(item.lastType7Hash)
        && Number.isSafeInteger(item.lastType7Nsr) && item.lastType7Nsr! >= 1 && item.lastType7Nsr! <= item.lastNsr));
}
function sameProfile(left: RepPAfdProfile, right: RepPAfdProfile) {
  return left.establishmentId === right.establishmentId && left.employerCnpj === right.employerCnpj
    && (left.cnoCaepf ?? '') === (right.cnoCaepf ?? '') && left.employerLegalName === right.employerLegalName
    && left.inpiRegistration === right.inpiRegistration && left.developerCnpj === right.developerCnpj;
}

async function loadStrictIdentity(hrDb: Firestore, userId: string) {
  const snapshot = await hrDb.collection('employees').where('auth_uid', '==', userId).limit(2).get();
  if (snapshot.size !== 1) throw fail('REP_P_EMPLOYEE_IDENTITY_UNRESOLVED', 'A identidade oficial do colaborador não está unívoca no RH.', 'DATA_INTEGRITY');
  const employee = snapshot.docs[0];
  const cpfDocument = await employee.ref.collection('field_values').doc('employee.cpf').get();
  const cpf = normalizeCpf(String(cpfDocument.get('value_text') ?? ''));
  const name = String(employee.get('name') ?? '').trim();
  if (!cpfDocument.exists || !isValidCpf(cpf) || !name) {
    throw fail('REP_P_EMPLOYEE_IDENTITY_INCOMPLETE', 'CPF ou nome oficial do colaborador está incompleto.', 'DATA_INTEGRITY');
  }
  return { employeeDocumentId: employee.id, cpf, name };
}

/** Provisiona a identidade fiscal na ARP e consome NSRs 2/5. Uso administrativo interno, sem rota pública. */
export async function provisionRepPReferenceData(input: {
  workspaceId: string; responsibleCpf: string; timeZone: string; profile: RepPAfdProfile;
  employee: { userId: string; cpf: string; name: string }; workLocation: string;
}, injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  if (!input.workspaceId.trim() || !input.timeZone.trim() || input.profile.developerCnpj !== CT_SORVETES_CNPJ
    || !isValidCpf(input.responsibleCpf) || !isValidCpf(input.employee.cpf) || !input.employee.userId.trim()
    || !input.employee.name.trim() || !input.workLocation.trim() || !REP_P_INPI_PATTERN.test(input.profile.inpiRegistration)
    || !input.profile.employerLegalName.trim()) throw fail('REP_P_SETUP_INVALID', 'Cadastro REP-P inválido.');
  const expectedId = establishmentKey(input.workspaceId, input.profile.employerCnpj);
  if (input.profile.establishmentId !== expectedId) throw fail('REP_P_ESTABLISHMENT_ID_INVALID', 'Identificador fiscal do estabelecimento inválido.');
  const reading = await deps.clock.read();
  assertTrustedRepPClockReading(reading);
  const now = formatRepPAfdTimestamp(reading.instant, input.timeZone);
  generateRepPAfd({ profile: input.profile, startDate: now.slice(0, 10), endDate: now.slice(0, 10),
    generatedAt: now, events: [] });
  const establishmentRef = deps.repDb.collection(ESTABLISHMENTS).doc(expectedId);
  const employeeRef = deps.repDb.collection(EMPLOYEES).doc(employeeKey(expectedId, input.employee.userId));
  return deps.repDb.runTransaction(async (transaction) => {
    const [establishment, employee] = await transaction.getAll(establishmentRef, employeeRef);
    const state = establishment.exists ? establishment.data() : null;
    if (employee.exists) {
      if (!state || !validEstablishment(state) || state.workspaceId !== input.workspaceId
        || !sameProfile(state.profile, input.profile) || state.timeZone !== input.timeZone) {
        throw fail('REP_P_ESTABLISHMENT_INCONSISTENT', 'Cadastro fiscal do estabelecimento está inconsistente.', 'DATA_INTEGRITY');
      }
      if (employee.get('cpf') !== normalizeCpf(input.employee.cpf) || employee.get('name') !== input.employee.name.trim()) {
        throw fail('REP_P_EMPLOYEE_ALREADY_DIFFERENT', 'O empregado já possui outra identidade fiscal na ARP.', 'CONFLICT');
      }
      return { establishmentId: expectedId, replayed: true } as const;
    }
    if (state && (!validEstablishment(state) || state.workspaceId !== input.workspaceId
      || !sameProfile(state.profile, input.profile) || state.timeZone !== input.timeZone)) {
      throw fail('REP_P_ESTABLISHMENT_INCONSISTENT', 'Cadastro fiscal do estabelecimento está inconsistente.', 'DATA_INTEGRITY');
    }
    let nextNsr = state ? state.lastNsr + 1 : 1;
    if (!state) {
      const employerEvent: RepPAfdEvent = { recordType: '2', nsr: nextNsr++, establishmentId: expectedId,
        recordedAt: now, responsibleCpf: input.responsibleCpf, employerCnpj: input.profile.employerCnpj,
        ...(input.profile.cnoCaepf ? { cnoCaepf: input.profile.cnoCaepf } : {}), employerLegalName: input.profile.employerLegalName,
        workLocation: input.workLocation };
      transaction.create(deps.repDb.collection(EVENTS).doc(eventKey(expectedId, employerEvent.nsr)), {
        ...employerEvent, workspaceId: input.workspaceId, recordedDate: recordedDate(employerEvent), createdAt: Timestamp.now() });
    }
    const employeeEvent: RepPAfdEvent = { recordType: '5', nsr: nextNsr++, establishmentId: expectedId,
      recordedAt: now, operation: 'I', employeeCpf: input.employee.cpf, employeeName: input.employee.name,
      responsibleCpf: input.responsibleCpf };
    transaction.create(deps.repDb.collection(EVENTS).doc(eventKey(expectedId, employeeEvent.nsr)), {
      ...employeeEvent, workspaceId: input.workspaceId, recordedDate: recordedDate(employeeEvent), createdAt: Timestamp.now() });
    transaction.create(employeeRef, { schemaVersion: 1, workspaceId: input.workspaceId, establishmentId: expectedId,
      userId: input.employee.userId, cpf: normalizeCpf(input.employee.cpf), name: input.employee.name.trim(), status: 'active', createdAt: Timestamp.now() });
    transaction.set(establishmentRef, { schemaVersion: 1, workspaceId: input.workspaceId, establishmentId: expectedId,
      status: 'ready', timeZone: input.timeZone, profile: input.profile, lastNsr: nextNsr - 1,
      lastType7Hash: state?.lastType7Hash ?? null, lastType7Nsr: state?.lastType7Nsr ?? null });
    return { establishmentId: expectedId, replayed: false } as const;
  });
}

export async function recordOwnRepPMarking(context: ServerUserContext, raw: unknown, injected: Partial<Dependencies> = {}) {
  const parsed = repPMarkingSchema.safeParse(raw);
  if (!parsed.success) throw fail('REP_P_MARKING_INPUT_INVALID', 'Solicitação de marcação inválida.');
  const input: RepPMarkingRequest = parsed.data;
  const deps = { ...defaults, ...injected };
  if (!deps.markingEnabled) {
    throw new AppError({ code: 'REP_P_MARKING_DISABLED', kind: 'AUTHORIZATION', retryable: false,
      safeMessage: 'A marcação real permanece bloqueada até a conclusão das pendências de implantação do REP-P.' });
  }
  const requestDigest = digest([context.workspace_id, context.decoded.uid, input]);
  const attemptRef = deps.repDb.collection(ATTEMPTS).doc(digest([context.workspace_id, context.decoded.uid, input.attemptId]));
  const existingAttempt = await attemptRef.get();
  if (existingAttempt.exists) {
    if (existingAttempt.get('workspaceId') !== context.workspace_id
      || existingAttempt.get('employeeId') !== context.decoded.uid
      || existingAttempt.get('requestDigest') !== requestDigest) {
      throw fail('REP_P_ATTEMPT_CONFLICT', 'Tentativa reutilizada com conteúdo diferente.', 'CONFLICT');
    }
    const prior = existingAttempt.get('marking') as RepPMarkingCandidate;
    if (!verifyRepPMarkingCandidate(prior)) {
      throw fail('REP_P_ATTEMPT_CORRUPT', 'Tentativa persistida inconsistente.', 'DATA_INTEGRITY');
    }
    return { status: 'replayed' as const, marking: prior, ...await settleRepPReceipt(deps, prior) };
  }
  const reference = await resolveEmploymentReferenceForSystem({ workspaceId: context.workspace_id,
    userId: context.decoded.uid, date: input.workDate, database: deps.mainDb });
  if (reference.status !== 'matched') throw fail('REP_P_EMPLOYMENT_UNRESOLVED', 'Não há vínculo histórico válido para a data da marcação.', 'DATA_INTEGRITY');
  if (reference.period.employmentRelationshipType !== 'clt' && reference.period.employmentRelationshipType !== 'apprenticeship') {
    throw fail('REP_P_EMPLOYMENT_NOT_ELIGIBLE', 'O vínculo não está habilitado para registro de ponto.', 'VALIDATION');
  }
  if (!reference.period.unitIds.includes(input.executionUnitId)) {
    throw fail('REP_P_EXECUTION_UNIT_OUTSIDE_EMPLOYMENT', 'A unidade de execução não pertence à abrangência vigente do vínculo.', 'AUTHORIZATION');
  }
  const establishmentId = establishmentKey(context.workspace_id, reference.period.employer.cnpj);
  const [identity, executionUnit, establishmentBefore] = await Promise.all([
    loadStrictIdentity(deps.hrDb, context.decoded.uid), deps.mainDb.collection('dp_units').doc(input.executionUnitId).get(),
    deps.repDb.collection(ESTABLISHMENTS).doc(establishmentId).get(),
  ]);
  if (!executionUnit.exists) throw fail('REP_P_EXECUTION_UNIT_MISSING', 'Unidade de execução não encontrada.', 'NOT_FOUND');
  const establishmentData = establishmentBefore.data();
  if (!validEstablishment(establishmentData) || establishmentData.workspaceId !== context.workspace_id
    || establishmentData.profile.employerCnpj !== reference.period.employer.cnpj) {
    throw fail('REP_P_ESTABLISHMENT_NOT_READY', 'O estabelecimento ainda não está habilitado no REP-P.', 'DATA_INTEGRITY');
  }
  const reading = await deps.clock.read();
  assertTrustedRepPClockReading(reading);
  const fiscalTimestamp = formatRepPAfdTimestamp(reading.instant, establishmentData.timeZone);
  if (civilDateFromRepPTimestamp(fiscalTimestamp) !== input.workDate) {
    throw fail('REP_P_WORK_DATE_MISMATCH', 'A data da marcação não corresponde à hora oficial do estabelecimento.', 'VALIDATION');
  }
  const establishmentRef = deps.repDb.collection(ESTABLISHMENTS).doc(establishmentId);
  const employeeRef = deps.repDb.collection(EMPLOYEES).doc(employeeKey(establishmentId, context.decoded.uid));
  const collectorId = input.channel === 'mobile' ? '01' as const : '02' as const;
  const workLocation = String(executionUnit.get('address') ?? '').trim() || null;
  // Cadastro fixo que o comprovante exige: sem ele a batida é recusada antes de consumir NSR,
  // para nunca existir marcação cujo comprovante não possa ser emitido. Falha só do assinador
  // continua gravando a batida com comprovante pendente.
  if (missingRepPReceiptFields({ employerLegalName: establishmentData.profile.employerLegalName, workLocation,
    inpiRegistration: establishmentData.profile.inpiRegistration, employeeName: identity.name }).length) {
    throw fail('REP_P_RECEIPT_PREREQUISITES_MISSING',
      'O registro de ponto está indisponível nesta unidade até o cadastro do comprovante ser completado pelo DP.', 'DATA_INTEGRITY');
  }
  const committed = await deps.repDb.runTransaction(async (transaction) => {
    const [establishment, employee, attempt] = await transaction.getAll(establishmentRef, employeeRef, attemptRef);
    const current = establishment.data();
    if (!validEstablishment(current) || current.workspaceId !== context.workspace_id
      || !sameProfile(current.profile, establishmentData.profile)
      || current.timeZone !== establishmentData.timeZone) {
      throw fail('REP_P_ESTABLISHMENT_CHANGED', 'O cadastro fiscal mudou durante a marcação.', 'CONFLICT');
    }
    if (!employee.exists || employee.get('status') !== 'active' || employee.get('cpf') !== identity.cpf
      || employee.get('name') !== identity.name || employee.get('userId') !== context.decoded.uid) {
      throw fail('REP_P_EMPLOYEE_NOT_READY', 'A identidade do empregado ainda não está habilitada na ARP.', 'DATA_INTEGRITY');
    }
    if (attempt.exists) {
      if (attempt.get('requestDigest') !== requestDigest) throw fail('REP_P_ATTEMPT_CONFLICT', 'Tentativa reutilizada com conteúdo diferente.', 'CONFLICT');
      const prior = attempt.get('marking') as RepPMarkingCandidate;
      if (!verifyRepPMarkingCandidate(prior)) throw fail('REP_P_ATTEMPT_CORRUPT', 'Tentativa persistida inconsistente.', 'DATA_INTEGRITY');
      return { status: 'replayed' as const, marking: prior };
    }
    const prepared = prepareRepPMarking({ attemptId: input.attemptId, workspaceId: context.workspace_id,
      employeeId: context.decoded.uid, employeeCpf: identity.cpf, employmentHistoryId: reference.historyId,
      employmentRevision: reference.revision, employerUnitId: reference.period.employerUnitId,
      employerCnpj: reference.period.employer.cnpj, establishmentId, executionUnitId: input.executionUnitId,
      markedAt: fiscalTimestamp, recordedAt: fiscalTimestamp, collectorId, mode: '0' }, {
      nextNsr: current.lastNsr + 1,
      previousRecord: current.lastType7Hash && current.lastType7Nsr
        ? { establishmentId, nsr: current.lastType7Nsr, hash: current.lastType7Hash } : null,
    });
    if (prepared.status !== 'created') throw fail('REP_P_SEQUENCE_INVALID', 'Sequência fiscal inconsistente.', 'DATA_INTEGRITY');
    const eventRef = deps.repDb.collection(EVENTS).doc(eventKey(establishmentId, prepared.marking.nsr));
    transaction.create(eventRef, { ...prepared.marking, arpPersistenceStatus: 'persisted', recordedDate: input.workDate,
      trustedClock: { source: reading.source, assurance: reading.assurance, observedOffsetMs: reading.observedOffsetMs,
        verifiedAt: reading.verifiedAt.toISOString(), serverInstant: reading.instant.toISOString(),
        attestationId: reading.attestationId, attestationMode: reading.attestationMode,
        quorum: reading.quorum, observations: reading.observations }, createdAt: Timestamp.now() });
    transaction.create(attemptRef, { workspaceId: context.workspace_id, employeeId: context.decoded.uid,
      requestDigest, marking: prepared.marking, createdAt: Timestamp.now() });
    transaction.update(establishmentRef, { lastNsr: prepared.marking.nsr, lastType7Hash: prepared.marking.hash,
      lastType7Nsr: prepared.marking.nsr });
    // O comprovante nasce pendente na mesma unidade atômica: a batida nunca depende da assinatura,
    // mas o conteúdo do documento fica congelado com os dados vigentes no instante da marcação.
    const snapshot: RepPReceiptSnapshot = { schemaVersion: 1, title: REP_P_RECEIPT_TITLE,
      nsr: prepared.marking.nsr, markedAt: prepared.marking.markedAt, hash: prepared.marking.hash,
      employerLegalName: current.profile.employerLegalName, employerCnpj: current.profile.employerCnpj,
      cnoCaepf: current.profile.cnoCaepf ?? null, workLocation, inpiRegistration: current.profile.inpiRegistration,
      developerCnpj: current.profile.developerCnpj, employeeName: identity.name, employeeCpf: identity.cpf,
      collectorId, establishmentId, executionUnitId: input.executionUnitId };
    const createdAt = Timestamp.now();
    transaction.create(deps.repDb.collection(RECEIPTS).doc(eventRef.id), { schemaVersion: 1,
      workspaceId: context.workspace_id, employeeId: context.decoded.uid, establishmentId,
      nsr: prepared.marking.nsr, markingId: prepared.marking.markingId, recordedDate: input.workDate, status: 'pending', snapshot,
      attempts: 0, lastIssue: null, createdAt, nextAttemptAt: createdAt });
    return { status: 'recorded' as const, marking: prepared.marking };
  });
  return { ...committed, ...await settleRepPReceipt(deps, committed.marking) };
}

/** Depois do commit, a resposta da batida nunca falha por causa do comprovante; o estado fica explícito. */
function settleRepPReceipt(deps: Dependencies, marking: RepPMarkingCandidate): Promise<RepPReceiptState> {
  return issueRepPReceipt(deps, marking).catch((cause: unknown) => ({
    receiptId: eventKey(marking.establishmentId, marking.nsr), receiptStatus: 'pending' as const, receiptIssue: issueCode(cause) }));
}

function sameReceiptSnapshot(snapshot: RepPReceiptSnapshot | undefined, marking: RepPMarkingCandidate) {
  return Boolean(snapshot && snapshot.nsr === marking.nsr && snapshot.hash === marking.hash
    && snapshot.markedAt === marking.markedAt && snapshot.employeeCpf === marking.employeeCpf
    && snapshot.employerCnpj === marking.employerCnpj && snapshot.establishmentId === marking.establishmentId
    && snapshot.executionUnitId === marking.executionUnitId && snapshot.collectorId === marking.collectorId);
}

function nextReceiptAttempt(deps: Dependencies, attemptsSoFar: number) {
  const delay = Math.min(RECEIPT_RETRY_BASE_MS * 2 ** Math.max(attemptsSoFar, 0), RECEIPT_RETRY_MAX_MS);
  return Timestamp.fromMillis((deps.now?.() ?? new Date()).getTime() + delay);
}

function issueCode(cause: unknown) {
  return cause instanceof AppError ? cause.code : 'REP_P_RECEIPT_SIGNATURE_REJECTED';
}

/**
 * Emite o comprovante de uma marcação já persistida. Nunca cria nem altera a marcação; a primeira emissão
 * gravada prevalece e uma emissão concorrente descarta os próprios bytes em vez de sobrescrevê-la.
 */
async function issueRepPReceipt(deps: Dependencies, marking: RepPMarkingCandidate): Promise<RepPReceiptState> {
  const receiptId = eventKey(marking.establishmentId, marking.nsr);
  const receiptRef = deps.repDb.collection(RECEIPTS).doc(receiptId);
  const current = await receiptRef.get();
  const pending = async (receiptIssue: string): Promise<RepPReceiptState> => {
    await receiptRef.update({ attempts: FieldValue.increment(1), lastIssue: receiptIssue, lastAttemptAt: Timestamp.now(),
      nextAttemptAt: nextReceiptAttempt(deps, Number(current.get('attempts') ?? 0)) }).catch(() => undefined);
    return { receiptId, receiptStatus: 'pending', receiptIssue };
  };
  if (!current.exists) return { receiptId, receiptStatus: 'pending', receiptIssue: 'REP_P_RECEIPT_MISSING' };
  if (current.get('status') === 'issued') return { receiptId, receiptStatus: 'available', receiptIssue: null };
  const snapshot = current.get('snapshot') as RepPReceiptSnapshot | undefined;
  if (current.get('markingId') !== marking.markingId || !sameReceiptSnapshot(snapshot, marking)) {
    throw fail('REP_P_RECEIPT_CORRUPT', 'O comprovante persistido não corresponde à marcação.', 'DATA_INTEGRITY');
  }
  if (missingRepPReceiptFields(snapshot!).length) return pending('REP_P_RECEIPT_FIELDS_MISSING');
  let signed: Awaited<ReturnType<typeof signRepPReceipt>>;
  try {
    signed = await signRepPReceipt(snapshot!, await renderRepPReceiptPdf(snapshot!), deps.receiptSigner);
  } catch (cause) {
    return pending(issueCode(cause));
  }
  return deps.repDb.runTransaction(async (transaction) => {
    const latest = await transaction.get(receiptRef);
    if (latest.get('status') === 'issued') return { receiptId, receiptStatus: 'available' as const, receiptIssue: null };
    transaction.update(receiptRef, { status: 'issued', filename: signed.filename, pdf: signed.bytes,
      sha256: signed.sha256, unsignedSha256: signed.unsignedSha256, certificateCnpj: signed.certificateCnpj,
      attempts: FieldValue.increment(1), lastIssue: null, issuedAt: Timestamp.now() });
    return { receiptId, receiptStatus: 'available' as const, receiptIssue: null };
  });
}

async function loadOwnReceipt(context: ServerUserContext, receiptId: string, deps: Dependencies) {
  const notFound = () => fail('REP_P_RECEIPT_NOT_FOUND', 'Comprovante não encontrado.', 'NOT_FOUND');
  if (!/^[a-f0-9]{64}_\d{9}$/.test(receiptId)) throw notFound();
  const receipt = await deps.repDb.collection(RECEIPTS).doc(receiptId).get();
  // Documento alheio e inexistente respondem igual para não permitir descoberta.
  if (!receipt.exists || receipt.get('workspaceId') !== context.workspace_id
    || receipt.get('employeeId') !== context.decoded.uid) throw notFound();
  return receipt;
}

/** Leitura sem efeitos: devolve os bytes assinados gravados na emissão, sem regenerar. */
export async function getOwnRepPReceipt(context: ServerUserContext, receiptId: string, injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  const receipt = await loadOwnReceipt(context, receiptId, deps);
  if (receipt.get('status') !== 'issued') {
    throw new AppError({ code: 'REP_P_RECEIPT_PENDING', kind: 'CONFLICT', retryable: true,
      safeMessage: 'O ponto foi registrado, mas o comprovante ainda não foi emitido.' });
  }
  const bytes = Buffer.from(receipt.get('pdf') as Uint8Array);
  if (createHash('sha256').update(bytes).digest('hex') !== receipt.get('sha256')) {
    throw fail('REP_P_RECEIPT_CORRUPT', 'O comprovante armazenado não confere com sua integridade.', 'DATA_INTEGRITY');
  }
  return { filename: String(receipt.get('filename')), bytes, sha256: String(receipt.get('sha256')) };
}

/** Recupera um comprovante pendente da própria marcação sem registrar nova batida. */
export async function retryOwnRepPReceipt(context: ServerUserContext, receiptId: string, injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  const receipt = await loadOwnReceipt(context, receiptId, deps);
  const event = await deps.repDb.collection(EVENTS).doc(receiptId).get();
  const marking = event.data() as RepPMarkingCandidate | undefined;
  if (!marking || marking.workspaceId !== context.workspace_id
    || marking.markingId !== receipt.get('markingId') || !verifyRepPMarkingCandidate(marking)) {
    throw fail('REP_P_RECEIPT_CORRUPT', 'O comprovante persistido não corresponde à marcação.', 'DATA_INTEGRITY');
  }
  return issueRepPReceipt(deps, marking);
}

/**
 * Reemissão automática dos comprovantes pendentes do workspace cuja próxima tentativa já venceu, na ordem dela.
 * Nunca registra batida nem altera a ARP: só emite o comprovante de marcações já persistidas.
 */
export async function retryPendingRepPReceipts(params: { workspaceId: string; limit?: number }, injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  const pending = await deps.repDb.collection(RECEIPTS).where('workspaceId', '==', params.workspaceId)
    .where('status', '==', 'pending').where('nextAttemptAt', '<=', Timestamp.fromDate(deps.now?.() ?? new Date()))
    .orderBy('nextAttemptAt').limit(params.limit ?? MAX_RECEIPT_RETRIES_PER_RUN).get();
  const result = { attempted: 0, issued: 0, stillPending: 0, failed: 0 };
  for (const receipt of pending.docs) {
    result.attempted += 1;
    try {
      const marking = (await deps.repDb.collection(EVENTS).doc(receipt.id).get()).data() as RepPMarkingCandidate | undefined;
      if (!marking || marking.workspaceId !== params.workspaceId || marking.markingId !== receipt.get('markingId')
        || !verifyRepPMarkingCandidate(marking)) {
        result.failed += 1;
        // Registra a falha no próprio comprovante para a operação enxergar; nunca emite às cegas.
        await receipt.ref.update({ attempts: FieldValue.increment(1), lastIssue: 'REP_P_RECEIPT_MARKING_UNVERIFIABLE',
          lastAttemptAt: Timestamp.now(), nextAttemptAt: nextReceiptAttempt(deps, Number(receipt.get('attempts') ?? 0)) })
          .catch(() => undefined);
        continue;
      }
      const state = await issueRepPReceipt(deps, marking);
      if (state.receiptStatus === 'available') result.issued += 1; else result.stillPending += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}

export type RepPServiceDependencies = Partial<Dependencies>;

export async function exportSignedRepPAfd(context: ServerUserContext, raw: unknown, injected: Partial<Dependencies> = {}) {
  const parsed = repPAfdExportSchema.safeParse(raw);
  if (!parsed.success) throw fail('REP_P_AFD_INPUT_INVALID', 'Período de exportação inválido.');
  const input: RepPAfdExportRequest = parsed.data;
  const deps = { ...defaults, ...injected };
  const establishment = await deps.repDb.collection(ESTABLISHMENTS).doc(input.establishmentId).get();
  const state = establishment.data();
  if (!validEstablishment(state) || state.workspaceId !== context.workspace_id) {
    throw fail('REP_P_AFD_ESTABLISHMENT_MISSING', 'Estabelecimento REP-P não encontrado.', 'NOT_FOUND');
  }
  const reading = await deps.clock.read();
  assertTrustedRepPClockReading(reading);
  const generatedAt = formatRepPAfdTimestamp(reading.instant, state.timeZone);
  const pageSize = deps.afdPageSize ?? AFD_PAGE_SIZE;
  const maxEvents = deps.afdMaxEvents ?? MAX_AFD_EVENTS;
  const base = deps.repDb.collection(EVENTS)
    .where('workspaceId', '==', context.workspace_id).where('establishmentId', '==', input.establishmentId)
    .where('recordedDate', '>=', input.startDate).where('recordedDate', '<=', input.endDate)
    .orderBy('recordedDate').orderBy('nsr');
  // Todas as páginas na mesma fotografia (transação somente leitura): batida gravada durante a
  // exportação fica fora do arquivo inteiro, em vez de abrir lacuna de NSR no meio dele.
  const events = await deps.repDb.runTransaction(async (transaction) => {
    const collected: RepPAfdEvent[] = [];
    for (let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null; ;) {
      const page: FirebaseFirestore.QuerySnapshot = await transaction.get((cursor ? base.startAfter(cursor) : base).limit(pageSize));
      collected.push(...page.docs.map((document) => document.data() as RepPAfdEvent));
      if (collected.length > maxEvents) {
        throw fail('REP_P_AFD_RANGE_TOO_LARGE', 'O período excede o limite seguro de exportação. Divida o intervalo de datas.');
      }
      if (page.size < pageSize) return collected;
      cursor = page.docs[page.docs.length - 1];
    }
  }, { readOnly: true });
  events.sort((a, b) => a.nsr - b.nsr);
  const pkg = generateRepPAfd({ profile: state.profile, startDate: input.startDate, endDate: input.endDate, generatedAt, events });
  const signed = await signRepPAfd(pkg, deps.signer, state.profile.developerCnpj);
  await deps.repDb.collection(EXPORT_AUDIT).add({ schemaVersion: 1, workspaceId: context.workspace_id,
    establishmentId: input.establishmentId, startDate: input.startDate, endDate: input.endDate,
    generatedAt, actorId: context.decoded.uid, layoutVersion: '004', filename: signed.filename,
    signatureFilename: signed.signatureFilename, sha256: signed.sha256, certificateCnpj: signed.certificateCnpj,
    counts: signed.counts, lineCount: signed.lineCount, createdAt: Timestamp.now() });
  return { filename: signed.filename, afdBase64: signed.bytes.toString('base64'), sha256: signed.sha256,
    signatureFilename: signed.signatureFilename, signatureBase64: signed.signature.toString('base64'),
    certificateCnpj: signed.certificateCnpj, counts: signed.counts, lineCount: signed.lineCount };
}

function receiptTimestampMillis(value: unknown) {
  return value instanceof Timestamp ? value.toMillis() : null;
}

/**
 * Histórico do próprio colaborador por período. Lê só o catálogo de comprovantes (um por batida),
 * filtrado por pessoa e data no Firestore e limitado; nunca devolve bytes, CPF nem dados de terceiros.
 */
export async function listOwnRepPMarkings(context: ServerUserContext, raw: unknown, injected: Partial<Dependencies> = {}) {
  const parsed = repPOwnHistorySchema.safeParse(raw);
  if (!parsed.success) throw fail('REP_P_HISTORY_INPUT_INVALID', 'Período de consulta inválido.');
  const input: RepPOwnHistoryRequest = parsed.data;
  const deps = { ...defaults, ...injected };
  const snapshot = await deps.repDb.collection(RECEIPTS)
    .where('workspaceId', '==', context.workspace_id).where('employeeId', '==', context.decoded.uid)
    .where('recordedDate', '>=', input.startDate).where('recordedDate', '<=', input.endDate)
    .orderBy('recordedDate').limit(MAX_HISTORY_MARKINGS + 1).get();
  const markings = snapshot.docs.slice(0, MAX_HISTORY_MARKINGS).map((document) => {
    const receipt = document.get('snapshot') as RepPReceiptSnapshot;
    return { receiptId: document.id, workDate: String(document.get('recordedDate')), nsr: receipt.nsr,
      markedAt: receipt.markedAt, executionUnitId: receipt.executionUnitId, collectorId: receipt.collectorId,
      hash: receipt.hash, receiptStatus: document.get('status') === 'issued' ? 'available' as const : 'pending' as const,
      receiptIssue: document.get('status') === 'issued' ? null : (document.get('lastIssue') as string | null) ?? null };
  }).sort((left, right) => left.markedAt.localeCompare(right.markedAt) || left.nsr - right.nsr);
  return { startDate: input.startDate, endDate: input.endDate, markings, truncated: snapshot.size > MAX_HISTORY_MARKINGS };
}

/** Monitoração do DP: comprovantes ainda pendentes no workspace, mais antigos primeiro, sem CPF nem bytes. */
export async function listPendingRepPReceipts(context: ServerUserContext, injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  const snapshot = await deps.repDb.collection(RECEIPTS)
    .where('workspaceId', '==', context.workspace_id).where('status', '==', 'pending')
    .orderBy('createdAt').limit(MAX_PENDING_RECEIPTS + 1).get();
  const receipts = snapshot.docs.slice(0, MAX_PENDING_RECEIPTS).map((document) => ({
    receiptId: document.id, employeeId: String(document.get('employeeId')), establishmentId: String(document.get('establishmentId')),
    nsr: Number(document.get('nsr')), workDate: String(document.get('recordedDate') ?? ''),
    attempts: Number(document.get('attempts') ?? 0), lastIssue: (document.get('lastIssue') as string | null) ?? null,
    createdAtMs: receiptTimestampMillis(document.get('createdAt')),
    lastAttemptAtMs: receiptTimestampMillis(document.get('lastAttemptAt')),
  }));
  return { receipts, truncated: snapshot.size > MAX_PENDING_RECEIPTS };
}

/**
 * Unidades em que o colaborador pode registrar na data, pela abrangência do vínculo histórico.
 * Só leitura: não consulta hora, não toca a ARP e não antecipa se o estabelecimento está habilitado.
 */
export async function listOwnRepPExecutionUnits(context: ServerUserContext, raw: unknown, injected: Partial<Dependencies> = {}) {
  const parsed = repPOwnOptionsSchema.safeParse(raw);
  if (!parsed.success) throw fail('REP_P_OPTIONS_INPUT_INVALID', 'Data inválida.');
  const deps = { ...defaults, ...injected };
  const reference = await resolveEmploymentReferenceForSystem({ workspaceId: context.workspace_id,
    userId: context.decoded.uid, date: parsed.data.workDate, database: deps.mainDb });
  if (reference.status !== 'matched') return { workDate: parsed.data.workDate, eligible: false as const, executionUnits: [], officialClock: null };
  const eligible = reference.period.employmentRelationshipType === 'clt'
    || reference.period.employmentRelationshipType === 'apprenticeship';
  const unitIds = [...new Set(reference.period.unitIds)].slice(0, 30);
  const units = unitIds.length ? await deps.mainDb.getAll(...unitIds.map((id) => deps.mainDb.collection('dp_units').doc(id))) : [];
  const executionUnits = units.filter((unit) => unit.exists)
    .map((unit) => ({ id: unit.id, name: String(unit.get('name') ?? unit.id),
      employer: unit.id === reference.period.employerUnitId }))
    .sort((left, right) => Number(right.employer) - Number(left.employer) || left.name.localeCompare(right.name, 'pt-BR'));
  return { workDate: parsed.data.workDate, eligible, executionUnits: eligible ? executionUnits : [],
    officialClock: eligible ? await readOfficialClock(deps, context.workspace_id, reference.period.employer.cnpj) : null };
}

/**
 * Hora oficial para o relógio exibido no coletor (Anexo IX, item 3): instante verificado contra a
 * Hora Legal e fuso do estabelecimento. Indisponível vira null com o motivo; a batida também falharia.
 */
async function readOfficialClock(deps: Dependencies, workspaceId: string, employerCnpj: string) {
  const establishment = (await deps.repDb.collection(ESTABLISHMENTS).doc(establishmentKey(workspaceId, employerCnpj)).get()).data();
  if (!validEstablishment(establishment) || establishment.workspaceId !== workspaceId) {
    return { available: false as const, issue: 'REP_P_ESTABLISHMENT_NOT_READY' };
  }
  try {
    const reading = await deps.clock.read();
    assertTrustedRepPClockReading(reading);
    return { available: true as const, instant: reading.instant.toISOString(), timeZone: establishment.timeZone };
  } catch (cause) {
    return { available: false as const, issue: cause instanceof AppError ? cause.code : 'REP_P_TIME_UNAVAILABLE' };
  }
}

/** Validade do e-CNPJ configurado, para o DP renovar antes do vencimento. Não lê nem devolve a chave. */
export function getRepPSignerStatus(now = new Date()) {
  return inspectRepPIcpCredential(process.env.REP_P_ICP_SIGNER_PEM, CT_SORVETES_CNPJ, now);
}

export const repPIdentifiersForTest = Object.freeze({ establishmentKey, employeeKey, eventKey, receiptKey: eventKey });
