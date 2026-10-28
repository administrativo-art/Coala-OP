import 'server-only';

import { createHash } from 'node:crypto';

import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

import { resolveEmploymentReferenceForSystem } from '@/features/dp/employment-reference/service.server';
import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { repPDbAdmin } from '@/lib/firebase-rep-p-admin';
import { isValidCpf, normalizeCpf } from '@/lib/hr/employee-document-match';
import { AppError } from '@/lib/observability/app-error';
import { reportSystemError } from '@/lib/observability/reporter';

import { generateRepPAfd, signRepPAfd, type RepPAfdEvent, type RepPAfdProfile, type RepPCadesSigner } from './afd';
import { assertTrustedRepPClockReading, civilDateFromRepPTimestamp, formatRepPAfdTimestamp, trustedRepPClockInstant,
  unconfiguredRepPClock, type RepPClock } from './clock';
import { assertRepPCompetenceAcceptsMarking, repPCompetenceFenceRef } from './competence-fence.server';
import { createRepPIcpSigners, inspectRepPIcpCredential, loadRepPIcpIdentity } from './icp-signer';
import { configuredRepPClock } from './hlb-ntp-clock.server';
import { isBrazilTimeZone, repPInstantMs, repPMarkingTimeZone } from './time-zones';
import { prepareRepPMarking, verifyRepPMarkingCandidate, type RepPMarkingCandidate } from './core';
import { fiscalArtifactStore, persistFiscalArtifactPair,
  type FiscalArtifactStore, type PersistedFiscalArtifacts } from './fiscal-artifact-storage.server';
import { deriveRepPOfflineMarkedAt, repPDeviceKeyId, REP_P_OFFLINE_PERMIT_TTL_MS, REP_P_OFFLINE_PREPARATION_TTL_MS, REP_P_OFFLINE_CYCLE_TTL_MS,
  verifyRepPOfflineEvidence } from './offline';
import { applyOfflineCycleAction, createOfflineCyclePermit, loadOfflineCycle, reconcileOnlineCycles, readOfflineCycleDto } from './offline-cycle.server';
import { evaluateRepPLocation, repPLocationEvidenceDigest, repPLocationSummary,
  REP_P_LOCATION_RETENTION_DAYS, type RepPLocationAttempt, type RepPLocationPolicySnapshot } from './location';
import { effectiveRepPLocationPolicy, loadRepPLocationPolicies, REP_P_LOCATION_EVIDENCE,
  repPLocationPolicyRef, disabledRepPLocationPolicy } from './location-policy.server';
import { allowedExecutionUnit, externalCoverageGrants, externalCoverageUnits } from './execution-units.server';
import { missingRepPReceiptFields, REP_P_INPI_PATTERN, REP_P_RECEIPT_TITLE, renderRepPReceiptPdf, signRepPReceipt,
  type RepPPadesSigner, type RepPReceiptSnapshot } from './receipt';
import { buildRepPReceiptArchive } from './receipt-archive';
import { isValidRepPPilotReceiptSnapshot, REP_P_PILOT_RECEIPT_TITLE, renderRepPPilotReceipt,
  type RepPPilotReceiptSnapshot } from './pilot-receipt';
import { repPOfficialMarkingEnabled, repPOfficialStartDate, repPOfficialUserIds, repPPilotWorkDateAllowed } from './runtime-config';
import { repPAfdExportSchema, repPMarkingClassificationSchema, repPMarkingSchema, repPOfflinePermitSchema, repPOwnHistorySchema, repPOwnOptionsSchema,
  type RepPAfdExportRequest, type RepPMarkingRequest, type RepPOfflinePermitRequest, type RepPOwnHistoryRequest } from './schemas';

const ESTABLISHMENTS = 'repP_establishments';
const EMPLOYEES = 'repP_employees';
const EVENTS = 'repP_events';
const ATTEMPTS = 'repP_attempts';
const EXPORT_AUDIT = 'repP_exportAudit';
const RECEIPTS = 'repP_receipts';
const OFFLINE_PERMITS = 'repP_offlinePermits';
const PILOT_OFFLINE_PERMITS = 'repP_pilotOfflinePermits';
const PILOT_HEADS = 'repP_pilotHeads';
const PILOT_MARKINGS = 'repP_pilotMarkings';
const ADJUSTMENT_REQUESTS = 'ptrp_adjustmentRequests';
const CLASSIFICATIONS = 'ptrp_markingClassifications';
export const REP_P_PILOT_CLASSIFICATION_EVENTS = 'repP_pilotClassificationEvents';
export const REP_P_PILOT_DAY_GUARDS = 'repP_pilotDayGuards';
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
const CT_SORVETES_LEGAL_NAME = 'CT SORVETES LTDA';

type Dependencies = Readonly<{
  repDb: Firestore; pilotDb: Firestore; mainDb: Firestore; hrDb: Firestore; clock: RepPClock; signer: RepPCadesSigner;
  receiptSigner: RepPPadesSigner; markingEnabled: boolean; officialUserIds: ReadonlySet<string>;
  pilotEnabled: boolean; pilotUserIds: ReadonlySet<string>; officialStartDate: string;
  fiscalStore: FiscalArtifactStore;
  afdPageSize?: number; afdMaxEvents?: number; now?: () => Date;
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
const defaults: Dependencies = { repDb: repPDbAdmin, pilotDb: hrDbAdmin, mainDb: dbAdmin, hrDb: hrDbAdmin,
  clock: environmentClock,
  signer: environmentCadesSigner, receiptSigner: environmentPadesSigner,
  markingEnabled: repPOfficialMarkingEnabled(),
  officialUserIds: repPOfficialUserIds(),
  officialStartDate: repPOfficialStartDate(),
  pilotEnabled: process.env.REP_P_PILOT_ENABLED === 'true',
  pilotUserIds: new Set((process.env.REP_P_PILOT_USER_IDS ?? '').split(',').map((value) => value.trim()).filter(Boolean)),
  fiscalStore: fiscalArtifactStore };

export type RepPReceiptState = Readonly<{
  receiptId: string; receiptStatus: 'available' | 'pending'; receiptIssue: string | null;
}>;

type EstablishmentDocument = {
  schemaVersion: 1; workspaceId: string; establishmentId: string; status: 'ready'; timeZone: string;
  profile: RepPAfdProfile; lastNsr: number; lastType7Hash: string | null; lastType7Nsr: number | null;
};

type OfflinePermitDocument = {
  schemaVersion: 1; scope?: 'official' | 'pilot'; workspaceId: string; employeeId: string; requestDigest: string;
  permitId: string; installationId: string; deviceKeyId: string; devicePublicKey: string;
  keySecurity: 'tee' | 'strongbox'; bootCount: number; anchorElapsedRealtimeMs: number;
  anchorInstant: string; issuedAt: string; expiresAt: string; establishmentId: string;
  employerCnpj: string; units: Array<{ id: string; name: string; timeZone: string }>;
  coverageGrants?: Array<Awaited<ReturnType<typeof externalCoverageGrants>>[number] & {
    workDate: string; workLocation: string | null; timeZone: string;
  }>;
  protocolVersion?: 2; preparationExpiresAt?: string; cycle?: import('./offline-cycle.server').OfflineCycleDto;
  status: 'active' | 'revoked' | 'closed'; lastAcceptedSequence: number; lastAcceptedHash: string | null;
};

function offlineCoverageGrant(permit: OfflinePermitDocument, workDate: string, unitId: string) {
  return permit.coverageGrants?.find((grant) => (grant.workDate === workDate
    || grant.overnight && grant.scheduledDate === grant.workDate
      && new Date(`${grant.workDate}T00:00:00.000Z`).getTime() + 86_400_000 === new Date(`${workDate}T00:00:00.000Z`).getTime())
    && grant.executionUnitId === unitId) ?? null;
}

type PilotMarkingDocument = {
  cycleId?: string;
  schemaVersion: 1; mode: 'pilot'; workspaceId: string; employeeId: string; requestDigest: string;
  markingId: string; receiptId: string; sequence: number; nsr: number; workDate: string; recordedDate: string;
  markedAt: string; recordedAt: string; employerUnitId: string; executionUnitId: string;
  establishmentId: string; collectorId: '01' | '02'; hash: string; employeeName: string;
  unitName: string; workLocation: string; status: 'pending' | 'issued';
  snapshot: RepPPilotReceiptSnapshot; locationSummary: LocationSummary | null;
  classification?: { purpose: 'journey_start' | 'break_start' | 'break_end' | 'journey_end';
    source: 'declared'; status: 'confirmed'; updatedAt: Timestamp; updatedBy: string };
  classificationRevision?: number;
};

function fail(code: string, safeMessage: string, kind: 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT' | 'DATA_INTEGRITY' | 'AUTHORIZATION' = 'VALIDATION') {
  return new AppError({ code, kind, safeMessage });
}
function markingAllowedForProfile(context: ServerUserContext) {
  return context.permissions.app.timeRecording?.mark === true;
}
function markingAllowedForOfficialUser(context: ServerUserContext, deps: Dependencies) {
  return deps.officialUserIds.has(context.decoded.uid);
}
function locationPolicyForActor(context: ServerUserContext, policy: RepPLocationPolicySnapshot) {
  return policy.participantUserIds.includes(context.decoded.uid)
    ? policy : disabledRepPLocationPolicy(context.workspace_id, policy.executionUnitId);
}
function digest(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function establishmentKey(workspaceId: string, cnpj: string) { return digest(['establishment', workspaceId, cnpj]); }
function employeeKey(establishmentId: string, userId: string) { return digest(['employee', establishmentId, userId]); }
function eventKey(establishmentId: string, nsr: number) { return `${establishmentId}_${String(nsr).padStart(9, '0')}`; }
function pilotHeadKey(workspaceId: string, employeeId: string) { return digest(['pilot-head', workspaceId, employeeId]); }
export function repPPilotDayGuardId(workspaceId: string, employeeId: string, workDate: string) {
  return digest(['pilot-day', workspaceId, employeeId, workDate]);
}
function pilotReceiptKey(workspaceId: string, employeeId: string, attemptId: string) {
  return `pilot_${digest(['pilot-marking', workspaceId, employeeId, attemptId])}`;
}
function recordedDate(event: RepPAfdEvent) {
  return (event.recordType === '4' ? event.adjustedAt : event.recordedAt).slice(0, 10);
}

type LocationSummary = ReturnType<typeof repPLocationSummary>;
function storedLocationSummary(value: unknown): LocationSummary | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (!['captured', 'denied', 'unavailable', 'timeout', 'unsupported', 'error', 'not_requested'].includes(String(raw.captureStatus))
    || !['inside', 'outside', 'indeterminate', 'not_requested'].includes(String(raw.evaluation))) return null;
  return { captureStatus: raw.captureStatus as LocationSummary['captureStatus'], evaluation: raw.evaluation as LocationSummary['evaluation'] };
}

function prepareLocationEvidence(params: {
  policy: RepPLocationPolicySnapshot; attempt?: RepPLocationAttempt; markedAt: Date;
  workspaceId: string; employeeId: string; markingId: string; evidenceId: string; executionUnitId: string;
}) {
  if (params.policy.mode === 'disabled') return { summary: null, evidence: null, expiresAt: null };
  const result = evaluateRepPLocation(params.policy, params.attempt, params.markedAt);
  const location = params.attempt?.status === 'captured' ? {
    latitude: params.attempt.latitude, longitude: params.attempt.longitude,
    accuracyMeters: params.attempt.accuracyMeters, capturedAt: params.attempt.capturedAt,
  } : null;
  const core = {
    schemaVersion: 1, workspaceId: params.workspaceId, employeeId: params.employeeId,
    markingId: params.markingId, evidenceId: params.evidenceId, executionUnitId: params.executionUnitId,
    channelTrust: 'client_reported', retentionClass: 'time_location_evidence', legalHold: false,
    policy: {
      schemaVersion: params.policy.schemaVersion, workspaceId: params.policy.workspaceId,
      executionUnitId: params.policy.executionUnitId, revision: params.policy.revision, mode: params.policy.mode,
      center: params.policy.center, radiusMeters: params.policy.radiusMeters,
      maxAccuracyMeters: params.policy.maxAccuracyMeters, maxAgeSeconds: params.policy.maxAgeSeconds,
      captureTimeoutMs: params.policy.captureTimeoutMs, privacyNoticeUrl: params.policy.privacyNoticeUrl,
      legalBasisReference: params.policy.legalBasisReference, retentionDays: params.policy.retentionDays,
      activatedAt: params.policy.activatedAt, activatedBy: params.policy.activatedBy,
    }, capture: {
      captureId: params.attempt?.captureId ?? null, status: params.attempt?.status ?? 'unavailable',
      elapsedMs: params.attempt?.elapsedMs ?? 0, location,
    }, result,
  } as const;
  const retentionDays = params.policy.retentionDays ?? REP_P_LOCATION_RETENTION_DAYS;
  return { summary: repPLocationSummary(result), evidence: { ...core, digest: repPLocationEvidenceDigest(core) },
    expiresAt: new Date(params.markedAt.getTime() + retentionDays * 86_400_000) };
}

type PreparedLocationEvidence = NonNullable<ReturnType<typeof prepareLocationEvidence>['evidence']>;
async function persistLocationEvidenceBestEffort(deps: Dependencies, prepared: {
  evidence: PreparedLocationEvidence; recordedDate: string; recordedAt: Date; expiresAt: Date;
}) {
  const target = deps.repDb.collection(REP_P_LOCATION_EVIDENCE).doc(prepared.evidence.evidenceId);
  try {
    const existing = await target.get();
    if (existing.exists) {
      if (existing.get('digest') !== prepared.evidence.digest) {
        reportSystemError({
          error: new AppError({ code: 'REP_P_LOCATION_EVIDENCE_DIGEST_MISMATCH', kind: 'DATA_INTEGRITY',
            safeMessage: 'A evidência de localização existente não corresponde à marcação.' }),
          source: 'rep-p', operation: 'persist-location-evidence',
          metadata: { evidenceId: prepared.evidence.evidenceId, markingId: prepared.evidence.markingId },
        });
      }
      return;
    }
    await target.create({
      ...prepared.evidence, recordedDate: prepared.recordedDate,
      recordedAt: Timestamp.fromDate(prepared.recordedAt), expiresAt: Timestamp.fromDate(prepared.expiresAt),
      createdAt: Timestamp.now(),
    });
  } catch (cause) {
    // A localização é acessória e nunca pode desfazer/impedir uma marcação já aceita.
    reportSystemError({
      error: cause, source: 'rep-p', operation: 'persist-location-evidence',
      code: 'REP_P_LOCATION_EVIDENCE_PERSISTENCE_FAILED', kind: 'TRANSIENT_EXTERNAL', severity: 'medium',
      metadata: { evidenceId: prepared.evidence.evidenceId, markingId: prepared.evidence.markingId },
      isTerminal: false,
    });
  }
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

function offlinePermitDto(permit: OfflinePermitDocument) {
  return {
    scope: permit.scope ?? 'official',
    ...(permit.protocolVersion === 2 ? { protocolVersion: 2, preparationExpiresAt: permit.preparationExpiresAt, ...(permit.cycle ? { cycle: permit.cycle } : {}) } : {}),
    permitId: permit.permitId, installationId: permit.installationId, deviceKeyId: permit.deviceKeyId,
    keySecurity: permit.keySecurity, bootCount: permit.bootCount,
    anchorElapsedRealtimeMs: permit.anchorElapsedRealtimeMs, anchorInstant: permit.anchorInstant,
    issuedAt: permit.issuedAt, expiresAt: permit.expiresAt, units: permit.units,
  };
}

async function replayOfflinePermitDto(db: Firestore, context: ServerUserContext, stored: OfflinePermitDocument) {
  if (stored.protocolVersion !== 2) return offlinePermitDto(stored);
  const cycle = await reconcileOnlineCycles(db, context, stored.scope ?? 'official');
  return offlinePermitDto({ ...stored, ...(cycle?.permitId === stored.permitId ? { cycle } : {}) });
}

function assertOfflineDeviceKey(input: RepPOfflinePermitRequest) {
  let calculatedKeyId: string;
  try { calculatedKeyId = repPDeviceKeyId(input.devicePublicKey); }
  catch { throw fail('REP_P_OFFLINE_DEVICE_KEY_INVALID', 'A chave segura deste aparelho não pôde ser validada.', 'DATA_INTEGRITY'); }
  if (calculatedKeyId !== input.deviceKeyId) {
    throw fail('REP_P_OFFLINE_DEVICE_KEY_MISMATCH', 'A identidade criptográfica deste aparelho não confere.', 'DATA_INTEGRITY');
  }
}

/** Autorização segregada para ensaiar a contingência sem tocar ARP, NSR, AFD, AEJ ou fechamento. */
async function issueOwnPilotOfflinePermit(context: ServerUserContext, input: RepPOfflinePermitRequest, deps: Dependencies) {
  if (!deps.pilotEnabled || !markingAllowedForProfile(context) || !deps.pilotUserIds.has(context.decoded.uid)) {
    throw fail('REP_P_MARKING_PROFILE_DISABLED', 'O registro de ponto ainda não foi liberado para este perfil.', 'AUTHORIZATION');
  }
  if (input.protocolVersion === 2) await reconcileOnlineCycles(deps.pilotDb, context, 'pilot');
  assertOfflineDeviceKey(input);
  const requestDigest = digest(['pilot-offline-permit', context.workspace_id, context.decoded.uid, input]);
  const permitId = `pilot_${digest(['offline-permit', context.workspace_id, context.decoded.uid, input.permitRequestId])}`;
  const permitRef = deps.pilotDb.collection(PILOT_OFFLINE_PERMITS).doc(permitId);
  const existing = await permitRef.get();
  if (existing.exists) {
    const stored = existing.data() as OfflinePermitDocument;
    if (stored.scope !== 'pilot' || stored.workspaceId !== context.workspace_id
      || stored.employeeId !== context.decoded.uid || stored.requestDigest !== requestDigest) {
      throw fail('REP_P_OFFLINE_PERMIT_CONFLICT', 'Autorização de ensaio reutilizada com conteúdo diferente.', 'CONFLICT');
    }
    return replayOfflinePermitDto(deps.pilotDb, context, stored);
  }
  const reference = await resolveEmploymentReferenceForSystem({ workspaceId: context.workspace_id,
    userId: context.decoded.uid, date: input.workDate, database: deps.mainDb });
  if (reference.status !== 'matched') throw fail('REP_P_EMPLOYMENT_UNRESOLVED', 'Não há vínculo histórico válido para ativar a contingência de ensaio.', 'DATA_INTEGRITY');
  if (!['clt', 'apprenticeship'].includes(reference.period.employmentRelationshipType)) {
    throw fail('REP_P_EMPLOYMENT_NOT_ELIGIBLE', 'O vínculo não está habilitado para registro de ponto.', 'VALIDATION');
  }
  if (reference.period.employer.cnpj !== CT_SORVETES_CNPJ) {
    throw fail('REP_P_PILOT_EMPLOYER_UNSUPPORTED', 'O ensaio está limitado ao empregador homologado.', 'DATA_INTEGRITY');
  }
  const coverage = await externalCoverageGrants(deps.mainDb, context.decoded.uid, input.workDate, reference.period.unitIds);
  const permittedUnitIds = [...new Set([...reference.period.unitIds,
    ...coverage.map((grant) => grant.executionUnitId)])].slice(0, 30);
  const unitDocs = await Promise.all(permittedUnitIds
    .map((unitId) => deps.mainDb.collection('dp_units').doc(unitId).get()));
  const readyCoverageIds = new Set(coverage.flatMap((grant) => {
    const unit = unitDocs.find((doc) => doc.id === grant.executionUnitId);
    return unit?.exists && isBrazilTimeZone(unit.get('timeZone')) && String(unit.get('address') ?? '').trim()
      ? [grant.executionUnitId] : [];
  }));
  const units = unitDocs.filter((unit) => unit.exists && isBrazilTimeZone(unit.get('timeZone'))
    && (reference.period.unitIds.includes(unit.id) || readyCoverageIds.has(unit.id))).map((unit) => ({
    id: unit.id, name: String(unit.get('name') ?? unit.id), timeZone: String(unit.get('timeZone')),
  }));
  const coverageGrants = coverage.flatMap((grant) => {
    const unit = unitDocs.find((doc) => doc.id === grant.executionUnitId);
    const permitted = units.find((item) => item.id === grant.executionUnitId);
    const workLocation = String(unit?.get('address') ?? '').trim();
    return permitted && workLocation ? [{ ...grant, workDate: input.workDate, workLocation,
      timeZone: permitted.timeZone }] : [];
  });
  if (!units.length) throw fail('REP_P_PILOT_UNIT_TIME_ZONE_MISSING', 'Cadastre o fuso da unidade antes do ensaio.', 'DATA_INTEGRITY');
  const reading = await deps.clock.read();
  assertTrustedRepPClockReading(reading);
  if (!units.some((unit) => civilDateFromRepPTimestamp(formatRepPAfdTimestamp(reading.instant, unit.timeZone)) === input.workDate)) {
    throw fail('REP_P_WORK_DATE_MISMATCH', 'A data do aparelho não corresponde à Hora Legal das unidades.', 'VALIDATION');
  }
  const issuedAt = reading.instant.toISOString();
  const permit: OfflinePermitDocument = {
    schemaVersion: 1, scope: 'pilot', workspaceId: context.workspace_id, employeeId: context.decoded.uid, requestDigest,
    permitId, installationId: input.installationId, deviceKeyId: input.deviceKeyId,
    devicePublicKey: input.devicePublicKey, keySecurity: input.keySecurity, bootCount: input.bootCount,
    anchorElapsedRealtimeMs: input.anchorElapsedRealtimeMs, anchorInstant: issuedAt, issuedAt,
    ...(input.protocolVersion === 2 ? { protocolVersion: 2 as const,
      preparationExpiresAt: new Date(reading.instant.getTime() + REP_P_OFFLINE_PREPARATION_TTL_MS).toISOString() } : {}),
    expiresAt: new Date(reading.instant.getTime() + (input.protocolVersion === 2
      ? REP_P_OFFLINE_PREPARATION_TTL_MS + REP_P_OFFLINE_CYCLE_TTL_MS : REP_P_OFFLINE_PERMIT_TTL_MS)).toISOString(),
    establishmentId: `pilot_${digest([context.workspace_id, reference.period.employer.cnpj])}`,
    employerCnpj: reference.period.employer.cnpj, units, coverageGrants, status: 'active', lastAcceptedSequence: 0,
    lastAcceptedHash: null,
  };
  try { return offlinePermitDto(await createOfflineCyclePermit(deps.pilotDb, permitRef, permit) as OfflinePermitDocument); }
  catch (cause) {
    const code = (cause as { code?: number | string } | null)?.code;
    if (code !== 6 && code !== 'already-exists' && !String((cause as Error | null)?.message).includes('ALREADY_EXISTS')) throw cause;
    const stored = (await permitRef.get()).data() as OfflinePermitDocument | undefined;
    if (!stored || stored.scope !== 'pilot' || stored.requestDigest !== requestDigest
      || stored.employeeId !== context.decoded.uid) {
      throw fail('REP_P_OFFLINE_PERMIT_CONFLICT', 'Não foi possível confirmar a autorização de ensaio.', 'CONFLICT');
    }
    return replayOfflinePermitDto(deps.pilotDb, context, stored);
  }
  return offlinePermitDto(permit);
}

/** Autoriza o Coala Go oficial a preservar marcações durante uma queda de rede. */
export async function issueOwnRepPOfflinePermit(context: ServerUserContext, raw: unknown, injected: Partial<Dependencies> = {}) {
  const parsed = repPOfflinePermitSchema.safeParse(raw);
  if (!parsed.success) throw fail('REP_P_OFFLINE_PERMIT_INPUT_INVALID', 'Solicitação de contingência inválida.');
  const input: RepPOfflinePermitRequest = parsed.data;
  const deps = { ...defaults, ...injected };
  if (!deps.markingEnabled && deps.pilotEnabled) return issueOwnPilotOfflinePermit(context, input, deps);
  if (!deps.markingEnabled) throw fail('REP_P_MARKING_DISABLED', 'O registro de ponto ainda não foi liberado.', 'AUTHORIZATION');
  if (!markingAllowedForProfile(context) || !markingAllowedForOfficialUser(context, deps)) {
    throw fail('REP_P_MARKING_PROFILE_DISABLED', 'O registro de ponto ainda não foi liberado para este perfil.', 'AUTHORIZATION');
  }
  if (input.protocolVersion === 2) await reconcileOnlineCycles(deps.repDb, context, 'official');
  assertOfflineDeviceKey(input);

  const requestDigest = digest([context.workspace_id, context.decoded.uid, input]);
  const permitId = digest(['offline-permit', context.workspace_id, context.decoded.uid, input.permitRequestId]);
  const permitRef = deps.repDb.collection(OFFLINE_PERMITS).doc(permitId);
  const existing = await permitRef.get();
  if (existing.exists) {
    const stored = existing.data() as OfflinePermitDocument;
    if (stored.workspaceId !== context.workspace_id || stored.employeeId !== context.decoded.uid
      || stored.requestDigest !== requestDigest) throw fail('REP_P_OFFLINE_PERMIT_CONFLICT', 'Autorização offline reutilizada com conteúdo diferente.', 'CONFLICT');
    return replayOfflinePermitDto(deps.repDb, context, stored);
  }

  const reference = await resolveEmploymentReferenceForSystem({ workspaceId: context.workspace_id,
    userId: context.decoded.uid, date: input.workDate, database: deps.mainDb });
  if (reference.status !== 'matched') throw fail('REP_P_EMPLOYMENT_UNRESOLVED', 'Não há vínculo histórico válido para ativar a contingência.', 'DATA_INTEGRITY');
  if (reference.period.employmentRelationshipType !== 'clt' && reference.period.employmentRelationshipType !== 'apprenticeship') {
    throw fail('REP_P_EMPLOYMENT_NOT_ELIGIBLE', 'O vínculo não está habilitado para registro de ponto.', 'VALIDATION');
  }
  const establishmentId = establishmentKey(context.workspace_id, reference.period.employer.cnpj);
  const coverage = await externalCoverageGrants(deps.mainDb, context.decoded.uid, input.workDate, reference.period.unitIds);
  const [establishment, ...unitDocs] = await Promise.all([
    deps.repDb.collection(ESTABLISHMENTS).doc(establishmentId).get(),
    ...[...new Set([...reference.period.unitIds,
      ...coverage.map((grant) => grant.executionUnitId)])].slice(0, 30)
      .map((unitId) => deps.mainDb.collection('dp_units').doc(unitId).get()),
  ]);
  const establishmentData = establishment.data();
  if (!validEstablishment(establishmentData) || establishmentData.workspaceId !== context.workspace_id
    || establishmentData.profile.employerCnpj !== reference.period.employer.cnpj) {
    throw fail('REP_P_ESTABLISHMENT_NOT_READY', 'O estabelecimento ainda não está habilitado no REP-P.', 'DATA_INTEGRITY');
  }
  const readyCoverageIds = new Set(coverage.flatMap((grant) => {
    const unit = unitDocs.find((doc) => doc.id === grant.executionUnitId);
    return unit?.exists && isBrazilTimeZone(unit.get('timeZone')) && String(unit.get('address') ?? '').trim()
      ? [grant.executionUnitId] : [];
  }));
  const units = unitDocs.filter((unit) => unit.exists
    && (reference.period.unitIds.includes(unit.id) || readyCoverageIds.has(unit.id))).map((unit) => ({ id: unit.id,
    name: String(unit.get('name') ?? unit.id), timeZone: repPMarkingTimeZone(unit.get('timeZone'), establishmentData.timeZone) }));
  const coverageGrants = coverage.flatMap((grant) => {
    const unit = unitDocs.find((doc) => doc.id === grant.executionUnitId);
    const permitted = units.find((item) => item.id === grant.executionUnitId);
    const workLocation = String(unit?.get('address') ?? '').trim();
    return permitted && workLocation ? [{ ...grant, workDate: input.workDate, workLocation,
      timeZone: permitted.timeZone }] : [];
  });
  if (!units.length) throw fail('REP_P_EXECUTION_UNIT_MISSING', 'Nenhuma unidade válida está disponível para a contingência.', 'DATA_INTEGRITY');
  const reading = await deps.clock.read();
  assertTrustedRepPClockReading(reading);
  if (!units.some((unit) => civilDateFromRepPTimestamp(formatRepPAfdTimestamp(reading.instant, unit.timeZone)) === input.workDate)) {
    throw fail('REP_P_WORK_DATE_MISMATCH', 'A data do aparelho não corresponde à hora oficial das unidades.', 'VALIDATION');
  }
  const issuedAt = reading.instant.toISOString();
  const permit: OfflinePermitDocument = {
    schemaVersion: 1, scope: 'official', workspaceId: context.workspace_id, employeeId: context.decoded.uid, requestDigest,
    permitId, installationId: input.installationId, deviceKeyId: input.deviceKeyId,
    devicePublicKey: input.devicePublicKey, keySecurity: input.keySecurity, bootCount: input.bootCount,
    anchorElapsedRealtimeMs: input.anchorElapsedRealtimeMs, anchorInstant: issuedAt, issuedAt,
    ...(input.protocolVersion === 2 ? { protocolVersion: 2 as const,
      preparationExpiresAt: new Date(reading.instant.getTime() + REP_P_OFFLINE_PREPARATION_TTL_MS).toISOString() } : {}),
    expiresAt: new Date(reading.instant.getTime() + (input.protocolVersion === 2
      ? REP_P_OFFLINE_PREPARATION_TTL_MS + REP_P_OFFLINE_CYCLE_TTL_MS : REP_P_OFFLINE_PERMIT_TTL_MS)).toISOString(),
    establishmentId, employerCnpj: reference.period.employer.cnpj, units, coverageGrants, status: 'active',
    lastAcceptedSequence: 0, lastAcceptedHash: null,
  };
  try { return offlinePermitDto(await createOfflineCyclePermit(deps.repDb, permitRef, permit) as OfflinePermitDocument); }
  catch (cause) {
    const code = (cause as { code?: number | string } | null)?.code;
    if (code !== 6 && code !== 'already-exists' && !String((cause as Error | null)?.message).includes('ALREADY_EXISTS')) throw cause;
    const raced = await permitRef.get();
    const stored = raced.data() as OfflinePermitDocument | undefined;
    if (!stored || stored.requestDigest !== requestDigest || stored.employeeId !== context.decoded.uid) {
      throw fail('REP_P_OFFLINE_PERMIT_CONFLICT', 'Não foi possível confirmar a autorização offline.', 'CONFLICT');
    }
    return replayOfflinePermitDto(deps.repDb, context, stored);
  }
  return offlinePermitDto(permit);
}

function validPilotMarking(value: unknown): value is PilotMarkingDocument {
  const item = value as PilotMarkingDocument | undefined;
  return Boolean(item && item.schemaVersion === 1 && item.mode === 'pilot' && item.workspaceId?.trim()
    && item.employeeId?.trim() && /^pilot_[a-f0-9]{64}$/.test(item.receiptId)
    && item.markingId === item.receiptId && Number.isSafeInteger(item.sequence) && item.sequence >= 1
    && /^\d{4}-\d{2}-\d{2}$/.test(item.workDate) && item.recordedDate === item.workDate
    && item.nsr === item.sequence && /^[a-f0-9]{64}$/.test(item.hash)
    && isValidRepPPilotReceiptSnapshot(item.snapshot)
    && (!item.classification || Number.isSafeInteger(item.classificationRevision) && Number(item.classificationRevision) >= 1)
    && ['pending', 'issued'].includes(item.status));
}

async function issuePilotReceipt(deps: Dependencies, marking: PilotMarkingDocument): Promise<RepPReceiptState> {
  const ref = deps.pilotDb.collection(PILOT_MARKINGS).doc(marking.receiptId);
  const current = await ref.get();
  const stored = current.data();
  if (!current.exists || !validPilotMarking(stored) || stored.requestDigest !== marking.requestDigest) {
    throw fail('REP_P_PILOT_RECEIPT_CORRUPT', 'O comprovante do ensaio não corresponde à marcação.', 'DATA_INTEGRITY');
  }
  if (stored.status === 'issued') return { receiptId: stored.receiptId, receiptStatus: 'available', receiptIssue: null };
  try {
    const rendered = await renderRepPPilotReceipt(stored.snapshot);
    return deps.pilotDb.runTransaction(async (transaction) => {
      const latest = await transaction.get(ref);
      const latestData = latest.data();
      if (!latest.exists || !validPilotMarking(latestData) || latestData.requestDigest !== marking.requestDigest) {
        throw fail('REP_P_PILOT_RECEIPT_CORRUPT', 'O comprovante do ensaio não corresponde à marcação.', 'DATA_INTEGRITY');
      }
      if (latestData.status === 'issued') return { receiptId: latestData.receiptId, receiptStatus: 'available' as const, receiptIssue: null };
      transaction.update(ref, { status: 'issued', filename: rendered.filename, pdf: rendered.bytes,
        sha256: rendered.sha256, issuedAt: Timestamp.now(), lastIssue: null });
      return { receiptId: latestData.receiptId, receiptStatus: 'available' as const, receiptIssue: null };
    });
  } catch (cause) {
    await ref.update({ lastIssue: 'REP_P_PILOT_RECEIPT_RENDER_FAILED', lastAttemptAt: Timestamp.now() }).catch(() => undefined);
    reportSystemError({ error: cause, source: 'rep-p', operation: 'issue-pilot-receipt',
      code: 'REP_P_PILOT_RECEIPT_RENDER_FAILED', kind: 'UNEXPECTED_APPLICATION', severity: 'medium',
      metadata: { receiptId: marking.receiptId }, isTerminal: false });
    return { receiptId: marking.receiptId, receiptStatus: 'pending', receiptIssue: 'REP_P_PILOT_RECEIPT_RENDER_FAILED' };
  }
}

async function preparePilotOfflineMarking(context: ServerUserContext, input: RepPMarkingRequest, deps: Dependencies) {
  const evidence = input.offline;
  if (!evidence || evidence.scope !== 'pilot' || input.channel !== 'mobile') {
    throw fail('REP_P_PILOT_OFFLINE_INPUT_INVALID', 'Marcação local do ensaio inválida.');
  }
  const permitRef = deps.pilotDb.collection(PILOT_OFFLINE_PERMITS).doc(evidence.permitId);
  const permitSnapshot = await permitRef.get();
  const permit = permitSnapshot.data() as OfflinePermitDocument | undefined;
  if (!permitSnapshot.exists || !permit || permit.schemaVersion !== 1 || permit.scope !== 'pilot'
    || permit.status !== 'active' || permit.workspaceId !== context.workspace_id
    || permit.employeeId !== context.decoded.uid || permit.permitId !== evidence.permitId
    || permit.deviceKeyId !== evidence.deviceKeyId || permit.bootCount !== evidence.bootCount) {
    throw fail('REP_P_PILOT_OFFLINE_PERMIT_INVALID', 'A autorização local do ensaio não é válida para esta conta e aparelho.', 'AUTHORIZATION');
  }
  const permittedUnit = permit.units.find((unit) => unit.id === input.executionUnitId);
  if (!permittedUnit) throw fail('REP_P_EXECUTION_UNIT_OUTSIDE_PERMIT', 'A unidade não pertence à autorização local.', 'AUTHORIZATION');
  let markedAt: string;
  try {
    markedAt = deriveRepPOfflineMarkedAt({ anchorInstant: permit.anchorInstant,
      anchorElapsedRealtimeMs: permit.anchorElapsedRealtimeMs, elapsedRealtimeMs: evidence.elapsedRealtimeMs,
      maxElapsedMs: permit.protocolVersion === 2 ? REP_P_OFFLINE_PREPARATION_TTL_MS + REP_P_OFFLINE_CYCLE_TTL_MS : undefined,
      timeZone: permittedUnit.timeZone });
  } catch { throw fail('REP_P_PILOT_OFFLINE_TIME_INVALID', 'A hora preservada no aparelho não pôde ser validada.', 'DATA_INTEGRITY'); }
  if (evidence.markedAt !== markedAt || civilDateFromRepPTimestamp(markedAt) !== input.workDate
    || Date.parse(markedAt.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')) > Date.parse(permit.expiresAt)) {
    throw fail('REP_P_PILOT_OFFLINE_TIME_MISMATCH', 'A hora preservada não corresponde à autorização do ensaio.', 'DATA_INTEGRITY');
  }
  if (!verifyRepPOfflineEvidence({ scope: 'pilot', permitId: evidence.permitId, attemptId: input.attemptId,
    executionUnitId: input.executionUnitId, deviceKeyId: evidence.deviceKeyId,
    elapsedRealtimeMs: evidence.elapsedRealtimeMs, bootCount: evidence.bootCount,
    sequence: evidence.sequence, previousLocalHash: evidence.previousLocalHash, cycle: evidence.cycle, markedAt,
    publicKeyBase64: permit.devicePublicKey, localHash: evidence.localHash, signature: evidence.signature })) {
    throw fail('REP_P_PILOT_OFFLINE_SIGNATURE_INVALID', 'A assinatura da marcação preservada é inválida.', 'DATA_INTEGRITY');
  }
  return { evidence, permit, permitRef, permittedUnit, markedAt };
}

/**
 * Ensaio nominal anterior à homologação: usa Hora Legal, vínculo e unidade reais, mas fica fora da ARP.
 * Não produz NSR fiscal, AFD, AEJ, espelho ou fechamento e o PDF traz aviso ostensivo de ausência de validade.
 */
async function recordOwnPilotMarking(context: ServerUserContext, input: RepPMarkingRequest, deps: Dependencies) {
  const { locationAttempt: _ignoredLocationAttempt, ...pilotInput } = input;
  void _ignoredLocationAttempt;
  const requestDigest = digest([context.workspace_id, context.decoded.uid, pilotInput]);
  const receiptId = pilotReceiptKey(context.workspace_id, context.decoded.uid, input.attemptId);
  const markingRef = deps.pilotDb.collection(PILOT_MARKINGS).doc(receiptId);
  const existing = await markingRef.get();
  const existingData = existing.data();
  if (existing.exists) {
    if (!validPilotMarking(existingData) || existingData.workspaceId !== context.workspace_id
      || existingData.employeeId !== context.decoded.uid || existingData.requestDigest !== requestDigest) {
      throw fail('REP_P_PILOT_ATTEMPT_CONFLICT', 'Tentativa de ensaio reutilizada com conteúdo diferente.', 'CONFLICT');
    }
    const receipt = await issuePilotReceipt(deps, existingData);
    return { status: 'replayed' as const, marking: existingData, pilot: true as const,
      offlineCycle: input.offline ? await readOfflineCycleDto(deps.pilotDb, context, input.offline.cycle?.id) : await reconcileOnlineCyclesBestEffort(deps.pilotDb, context, 'pilot'),
      location: storedLocationSummary(existingData.locationSummary), ...receipt };
  }
  if (!input.offline && input.onlineScope === 'pilot' && (deps.markingEnabled || !deps.pilotEnabled || !deps.pilotUserIds.has(context.decoded.uid))) {
    throw fail('REP_P_PILOT_ONLINE_REPLAY_ONLY', 'Esta tentativa foi preparada no piloto. Confira o envio anterior; ela não será convertida em ponto oficial.', 'CONFLICT');
  }
  if (!repPPilotWorkDateAllowed(input.workDate, deps.officialStartDate)) {
    throw fail('REP_P_PILOT_CUTOVER_REACHED', 'O ensaio não aceita marcações na data de início do período oficial.', 'CONFLICT');
  }
  const reference = await resolveEmploymentReferenceForSystem({ workspaceId: context.workspace_id,
    userId: context.decoded.uid, date: input.workDate, database: deps.mainDb });
  if (reference.status !== 'matched') throw fail('REP_P_EMPLOYMENT_UNRESOLVED', 'Não há fotografia inicial do vínculo válida para a data do ensaio.', 'DATA_INTEGRITY');
  if (!['clt', 'apprenticeship'].includes(reference.period.employmentRelationshipType)) {
    throw fail('REP_P_EMPLOYMENT_NOT_ELIGIBLE', 'O vínculo não está habilitado para registro de ponto.', 'VALIDATION');
  }
  if (input.offline?.cycle) await reconcileOnlineCycles(deps.pilotDb, context, 'pilot');
  const offline = input.offline ? await preparePilotOfflineMarking(context, input, deps) : null;
  const coverageGrant = offline && offlineCoverageGrant(offline.permit, input.workDate, input.executionUnitId);
  if (!coverageGrant && !await allowedExecutionUnit(deps.mainDb, context.decoded.uid, input.workDate, reference.period.unitIds, input.executionUnitId)) {
    throw fail('REP_P_EXECUTION_UNIT_OUTSIDE_EMPLOYMENT', 'A unidade não está no vínculo nem na cobertura escalada para esta data.', 'AUTHORIZATION');
  }
  const [identity, executionUnit] = await Promise.all([
    loadStrictIdentity(deps.hrDb, context.decoded.uid),
    deps.mainDb.collection('dp_units').doc(input.executionUnitId).get(),
  ]);
  if (!executionUnit.exists && !coverageGrant) throw fail('REP_P_EXECUTION_UNIT_MISSING', 'Unidade de execução não encontrada.', 'NOT_FOUND');
  const timeZone = coverageGrant?.timeZone ?? String(executionUnit.get('timeZone') ?? '');
  if (!isBrazilTimeZone(timeZone)) throw fail('REP_P_PILOT_UNIT_TIME_ZONE_MISSING', 'Cadastre o fuso da unidade antes do ensaio.', 'DATA_INTEGRITY');
  const employeeName = identity.name;
  const employeeCpf = identity.cpf;
  const employerCnpj = reference.period.employer.cnpj;
  if (employerCnpj !== CT_SORVETES_CNPJ) {
    throw fail('REP_P_PILOT_EMPLOYER_UNSUPPORTED', 'O ensaio está limitado ao empregador homologado.', 'DATA_INTEGRITY');
  }
  const employerName = CT_SORVETES_LEGAL_NAME;
  const unitName = coverageGrant ? offline!.permittedUnit.name : String(executionUnit.get('name') ?? '').trim();
  const workLocation = coverageGrant?.workLocation ?? String(executionUnit.get('address') ?? '').trim();
  if (!employeeName || !employerName || !unitName || !workLocation) {
    throw fail('REP_P_PILOT_IDENTITY_INCOMPLETE', 'Identificação da pessoa, empregador ou unidade incompleta.', 'DATA_INTEGRITY');
  }
  if (offline && (offline.permit.employerCnpj !== employerCnpj
    || offline.permittedUnit.timeZone !== timeZone || offline.permit.establishmentId !== `pilot_${digest([context.workspace_id, employerCnpj])}`)) {
    throw fail('REP_P_PILOT_OFFLINE_CONTEXT_CHANGED', 'O vínculo ou a unidade mudou depois da autorização local.', 'CONFLICT');
  }
  const reading = await deps.clock.read();
  assertTrustedRepPClockReading(reading);
  const markedAt = offline?.markedAt ?? formatRepPAfdTimestamp(reading.instant, timeZone);
  const recordedAt = formatRepPAfdTimestamp(reading.instant, timeZone);
  if (civilDateFromRepPTimestamp(markedAt) !== input.workDate) {
    throw fail('REP_P_WORK_DATE_MISMATCH', 'A data do ensaio não corresponde à Hora Legal da unidade.', 'VALIDATION');
  }
  const headRef = deps.pilotDb.collection(PILOT_HEADS).doc(pilotHeadKey(context.workspace_id, context.decoded.uid));
  const dayGuardRef = deps.pilotDb.collection(REP_P_PILOT_DAY_GUARDS)
    .doc(repPPilotDayGuardId(context.workspace_id, context.decoded.uid, input.workDate));
  const adjustmentQuery = deps.pilotDb.collection(ADJUSTMENT_REQUESTS)
    .where('workspaceId', '==', context.workspace_id).where('employeeUid', '==', context.decoded.uid)
    .where('workDate', '==', input.workDate).limit(1);
  const collectorId = input.channel === 'mobile' ? '01' as const : '02' as const;
  const establishmentId = `pilot_${digest([context.workspace_id, reference.period.employer.cnpj])}`;
  const committed = await deps.pilotDb.runTransaction(async (transaction) => {
    const [[prior, head, dayGuard, currentPermit], adjustments] = await Promise.all([
      transaction.getAll(markingRef, headRef, dayGuardRef, ...(offline ? [offline.permitRef] : [])),
      transaction.get(adjustmentQuery),
    ]);
    const raced = prior.data();
    if (prior.exists) {
      if (!validPilotMarking(raced) || raced.workspaceId !== context.workspace_id
        || raced.employeeId !== context.decoded.uid || raced.requestDigest !== requestDigest) {
        throw fail('REP_P_PILOT_ATTEMPT_CONFLICT', 'Tentativa de ensaio reutilizada com conteúdo diferente.', 'CONFLICT');
      }
      return { status: 'replayed' as const, marking: raced, locationEvidence: null };
    }
    const cycle = offline ? await loadOfflineCycle(transaction, deps.pilotDb, context, offline.permit,
      offline.evidence, input.attemptId, reading.instant.getTime())
      : null;
    if (!adjustments.empty || dayGuard.get('domain') === 'adjustment') {
      throw fail('REP_P_PILOT_DAY_ADJUSTMENT_FORBIDDEN',
        'Este dia já possui solicitação formal de ajuste e não pode receber batida de ensaio.', 'CONFLICT');
    }
    if (offline) {
      const current = currentPermit?.data() as OfflinePermitDocument | undefined;
      if (!current || current.scope !== 'pilot' || current.status !== 'active'
        || current.deviceKeyId !== offline.evidence.deviceKeyId || current.bootCount !== offline.evidence.bootCount) {
        throw fail('REP_P_PILOT_OFFLINE_PERMIT_REVOKED', 'A autorização local do ensaio foi revogada.', 'AUTHORIZATION');
      }
      if (offline.evidence.sequence !== current.lastAcceptedSequence + 1
        || offline.evidence.previousLocalHash !== current.lastAcceptedHash) {
        throw fail('REP_P_PILOT_OFFLINE_SEQUENCE_INVALID', 'A sequência local do ensaio está incompleta ou fora de ordem.', 'CONFLICT');
      }
    }
    const lastSequence = head.exists ? Number(head.get('lastSequence')) : 0;
    if (!Number.isSafeInteger(lastSequence) || lastSequence < 0) {
      throw fail('REP_P_PILOT_SEQUENCE_CORRUPT', 'A sequência do ensaio está inconsistente.', 'DATA_INTEGRITY');
    }
    const sequence = lastSequence + 1;
    const hash = digest(['rep-p-pilot-v1', context.workspace_id, context.decoded.uid, input.attemptId,
      sequence, markedAt, reference.historyId, reference.revision, reference.period.employerUnitId,
      input.executionUnitId, collectorId]);
    const snapshot: RepPPilotReceiptSnapshot = { schemaVersion: 2, title: REP_P_PILOT_RECEIPT_TITLE,
      sequence, markedAt, hash, employerName, employerCnpj, employeeName, employeeCpf, unitName, workLocation,
      collectorId, developerName: CT_SORVETES_LEGAL_NAME, developerCnpj: CT_SORVETES_CNPJ };
    const classifiedAt = Timestamp.now();
    const organizationalClassification = input.declaredPurpose ? {
      classification: { purpose: input.declaredPurpose, source: 'declared' as const, status: 'confirmed' as const,
        updatedAt: classifiedAt, updatedBy: context.decoded.uid },
      classificationRevision: 1,
    } : {};
    const marking: PilotMarkingDocument = { schemaVersion: 1, mode: 'pilot', workspaceId: context.workspace_id,
      employeeId: context.decoded.uid, requestDigest, markingId: receiptId, receiptId, sequence, nsr: sequence,
      workDate: input.workDate, recordedDate: input.workDate, markedAt, recordedAt,
      employerUnitId: reference.period.employerUnitId,
      executionUnitId: input.executionUnitId, establishmentId, collectorId, hash, employeeName, unitName,
      workLocation, status: 'pending', snapshot, locationSummary: null, ...organizationalClassification };
    const cycleInfo = cycle?.commit(receiptId);
    transaction.create(markingRef, { ...marking, ...(offline ? {} : { cycleCandidate: { committedAt: FieldValue.serverTimestamp(), attemptId: input.attemptId, instantMs: reading.instant.getTime(), purpose: input.declaredPurpose ?? null, receiptId } }), attemptId: input.attemptId, employmentHistoryId: reference.historyId,
      employmentRevision: reference.revision, trustedClock: { source: reading.source, assurance: reading.assurance,
        observedOffsetMs: reading.observedOffsetMs, verifiedAt: reading.verifiedAt.toISOString(),
        serverInstant: reading.instant.toISOString(), attestationId: reading.attestationId,
        attestationMode: reading.attestationMode, quorum: reading.quorum, observations: reading.observations },
      ...(offline ? { pilotOfflineEvidence: { scope: 'pilot', permitId: offline.permit.permitId,
        installationId: offline.permit.installationId, deviceKeyId: offline.evidence.deviceKeyId,
        keySecurity: offline.permit.keySecurity, bootCount: offline.evidence.bootCount,
        sequence: offline.evidence.sequence, previousLocalHash: offline.evidence.previousLocalHash,
        localHash: offline.evidence.localHash, signature: offline.evidence.signature,
        elapsedRealtimeMs: offline.evidence.elapsedRealtimeMs, permitIssuedAt: offline.permit.issuedAt,
        permitExpiresAt: offline.permit.expiresAt, ...(offline.evidence.cycle ? { cycle: offline.evidence.cycle } : {}) } } : {}),
      createdAt: Timestamp.now() });
    if (input.declaredPurpose) {
      const classificationEventRef = deps.pilotDb.collection(REP_P_PILOT_CLASSIFICATION_EVENTS)
        .doc(digest([receiptId, 'classification', 1]));
      transaction.create(classificationEventRef, { schemaVersion: 1, mode: 'pilot', workspaceId: context.workspace_id,
        employeeId: context.decoded.uid, markingId: receiptId, receiptId, revision: 1, previousPurpose: null,
        purpose: input.declaredPurpose, source: 'declared', status: 'confirmed', at: classifiedAt,
        actorUid: context.decoded.uid });
    }
    transaction.set(headRef, { schemaVersion: 1, mode: 'pilot', workspaceId: context.workspace_id,
      employeeId: context.decoded.uid, lastSequence: sequence, updatedAt: Timestamp.now() });
    transaction.set(dayGuardRef, { schemaVersion: 1, mode: 'pilot', domain: 'pilot', workspaceId: context.workspace_id,
      employeeId: context.decoded.uid, workDate: input.workDate, updatedAt: Timestamp.now() }, { merge: true });
    if (offline) transaction.update(offline.permitRef, { lastAcceptedSequence: offline.evidence.sequence,
      lastAcceptedHash: offline.evidence.localHash, lastAcceptedAt: Timestamp.now() });
    return { status: 'recorded' as const, marking, offlineCycle: cycleInfo ?? null, locationEvidence: null };
  });
  if (committed.locationEvidence) await persistLocationEvidenceBestEffort(deps, committed.locationEvidence);
  const receipt = await issuePilotReceipt(deps, committed.marking);
  return { status: committed.status, marking: committed.marking, offlineCycle: input.offline ? ('offlineCycle' in committed ? committed.offlineCycle : undefined) : await reconcileOnlineCyclesBestEffort(deps.pilotDb, context, 'pilot'), pilot: true as const,
    location: storedLocationSummary(committed.marking.locationSummary), ...receipt };
}

async function reconcileOnlineCyclesBestEffort(db: Firestore, context: ServerUserContext, scope: 'official' | 'pilot') {
  try { return await reconcileOnlineCycles(db, context, scope, 2); }
  catch { return undefined; } // Original and receipt survive; offline remains blocked until reconciliation.
}

async function readOwnOfficialOnlineReplay(context: ServerUserContext, input: RepPMarkingRequest, deps: Dependencies) {
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
    const receipt = await settleRepPReceipt(deps, prior);
    return { status: 'replayed' as const, marking: prior,
      offlineCycle: await reconcileOnlineCyclesBestEffort(deps.repDb, context, 'official'),
      location: storedLocationSummary(existingAttempt.get('locationSummary')), ...receipt };
  }
  return null;
}

export async function recordOwnRepPMarking(context: ServerUserContext, raw: unknown, injected: Partial<Dependencies> = {}) {
  const parsed = repPMarkingSchema.safeParse(raw);
  if (!parsed.success) throw fail('REP_P_MARKING_INPUT_INVALID', 'Solicitação de marcação inválida.');
  const input: RepPMarkingRequest = parsed.data;
  const deps = { ...defaults, ...injected };
  // Uma fila piloto emitida antes da troca de flags termina sempre no domínio piloto. A autorização assinada e
  // ainda válida basta para sincronizar; desligar o piloto impede novas autorizações, não promove nem apaga a fila.
  if (input.offline?.scope === 'pilot') {
    if (!markingAllowedForProfile(context)) {
      throw new AppError({ code: 'REP_P_MARKING_PROFILE_DISABLED', kind: 'AUTHORIZATION', retryable: false,
        safeMessage: 'O registro de ponto ainda não foi liberado para este perfil.' });
    }
    return recordOwnPilotMarking(context, input, deps);
  }
  if (input.onlineScope === 'pilot') {
    if (!markingAllowedForProfile(context)) throw fail('REP_P_MARKING_PROFILE_DISABLED', 'O perfil não permite registro de ponto.', 'AUTHORIZATION');
    return recordOwnPilotMarking(context, input, deps);
  }
  if (input.onlineScope === 'official' && !deps.markingEnabled) {
    if (!markingAllowedForProfile(context)) throw fail('REP_P_MARKING_PROFILE_DISABLED', 'O perfil não permite registro de ponto.', 'AUTHORIZATION');
    const replay = await readOwnOfficialOnlineReplay(context, input, deps);
    if (replay) return replay;
    throw fail('REP_P_MARKING_DISABLED', 'A marcação oficial ainda não está habilitada.', 'AUTHORIZATION');
  }
  if (!deps.markingEnabled && !deps.pilotEnabled) {
    throw new AppError({ code: 'REP_P_MARKING_DISABLED', kind: 'AUTHORIZATION', retryable: false,
      safeMessage: 'A marcação real permanece bloqueada até a conclusão das pendências de implantação do REP-P.' });
  }
  if (!markingAllowedForProfile(context)
    || deps.markingEnabled && !markingAllowedForOfficialUser(context, deps)
    || !deps.markingEnabled && deps.pilotEnabled && !deps.pilotUserIds.has(context.decoded.uid)) {
    throw new AppError({ code: 'REP_P_MARKING_PROFILE_DISABLED', kind: 'AUTHORIZATION', retryable: false,
      safeMessage: 'O registro de ponto ainda não foi liberado para este perfil.' });
  }
  if (!deps.markingEnabled) return recordOwnPilotMarking(context, input, deps);
  if (input.offline) return recordOwnOfflineRepPMarking(context, input, deps);
  const requestDigest = digest([context.workspace_id, context.decoded.uid, input]);
  const attemptRef = deps.repDb.collection(ATTEMPTS).doc(digest([context.workspace_id, context.decoded.uid, input.attemptId]));
  const replay = await readOwnOfficialOnlineReplay(context, input, deps);
  if (replay) return replay;
  const reference = await resolveEmploymentReferenceForSystem({ workspaceId: context.workspace_id,
    userId: context.decoded.uid, date: input.workDate, database: deps.mainDb });
  if (reference.status !== 'matched') throw fail('REP_P_EMPLOYMENT_UNRESOLVED', 'Não há vínculo histórico válido para a data da marcação.', 'DATA_INTEGRITY');
  if (reference.period.employmentRelationshipType !== 'clt' && reference.period.employmentRelationshipType !== 'apprenticeship') {
    throw fail('REP_P_EMPLOYMENT_NOT_ELIGIBLE', 'O vínculo não está habilitado para registro de ponto.', 'VALIDATION');
  }
  if (!await allowedExecutionUnit(deps.mainDb, context.decoded.uid, input.workDate, reference.period.unitIds, input.executionUnitId)) {
    throw fail('REP_P_EXECUTION_UNIT_OUTSIDE_EMPLOYMENT', 'A unidade não está no vínculo nem na cobertura escalada para esta data.', 'AUTHORIZATION');
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
  if (!reference.period.unitIds.includes(input.executionUnitId) && !isBrazilTimeZone(executionUnit.get('timeZone'))) {
    throw fail('REP_P_EXECUTION_UNIT_TIME_ZONE_MISSING', 'Cadastre o fuso da unidade externa antes da batida.', 'DATA_INTEGRITY');
  }
  const reading = await deps.clock.read();
  assertTrustedRepPClockReading(reading);
  // O instante é um só (Hora Legal); o fuso gravado é o da unidade de execução, ou o do estabelecimento sem cadastro.
  // O fuso é lido antes da transação: troca concomitante no cadastro vale a partir da batida seguinte.
  const fiscalTimestamp = formatRepPAfdTimestamp(reading.instant, repPMarkingTimeZone(executionUnit.get('timeZone'), establishmentData.timeZone));
  if (civilDateFromRepPTimestamp(fiscalTimestamp) !== input.workDate) {
    throw fail('REP_P_WORK_DATE_MISMATCH', 'A data da marcação não corresponde à hora oficial da unidade.', 'VALIDATION');
  }
  const establishmentRef = deps.repDb.collection(ESTABLISHMENTS).doc(establishmentId);
  const employeeRef = deps.repDb.collection(EMPLOYEES).doc(employeeKey(establishmentId, context.decoded.uid));
  const competenceFenceRef = repPCompetenceFenceRef(deps.repDb, context.workspace_id, input.workDate.slice(0, 7));
  const locationPolicyRef = repPLocationPolicyRef(deps.repDb, context.workspace_id, input.executionUnitId);
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
    const [establishment, employee, attempt, competenceFence, locationPolicyDocument] = await transaction.getAll(
      establishmentRef, employeeRef, attemptRef, competenceFenceRef, locationPolicyRef);
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
      return { status: 'replayed' as const, marking: prior,
        location: storedLocationSummary(attempt.get('locationSummary')), locationEvidence: null };
    }
    assertRepPCompetenceAcceptsMarking(competenceFence, context.workspace_id, input.workDate.slice(0, 7));
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
    const locationPolicy = locationPolicyForActor(context,
      effectiveRepPLocationPolicy(locationPolicyDocument.data(), context.workspace_id, input.executionUnitId));
    const location = prepareLocationEvidence({ policy: locationPolicy, attempt: input.locationAttempt,
      markedAt: reading.instant, workspaceId: context.workspace_id, employeeId: context.decoded.uid,
      markingId: prepared.marking.markingId, evidenceId: eventRef.id, executionUnitId: input.executionUnitId });
    transaction.create(eventRef, { ...prepared.marking, arpPersistenceStatus: 'persisted', recordedDate: input.workDate,
      trustedClock: { source: reading.source, assurance: reading.assurance, observedOffsetMs: reading.observedOffsetMs,
        verifiedAt: reading.verifiedAt.toISOString(), serverInstant: reading.instant.toISOString(),
        attestationId: reading.attestationId, attestationMode: reading.attestationMode,
        quorum: reading.quorum, observations: reading.observations }, createdAt: Timestamp.now() });
    transaction.create(attemptRef, { workspaceId: context.workspace_id, employeeId: context.decoded.uid,
      requestDigest, marking: prepared.marking, cycleCandidate: { committedAt: FieldValue.serverTimestamp(), attemptId: input.attemptId, instantMs: reading.instant.getTime(), purpose: input.declaredPurpose ?? null, receiptId: eventRef.id }, locationSummary: location.summary, createdAt: Timestamp.now() });
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
    const organizationalClassification = input.declaredPurpose ? {
      classification: { purpose: input.declaredPurpose, source: 'declared', status: 'confirmed', updatedAt: createdAt,
        updatedBy: context.decoded.uid },
      classificationHistory: [{ purpose: input.declaredPurpose, source: 'declared', status: 'confirmed', at: createdAt,
        actorUid: context.decoded.uid }],
    } : {};
    transaction.create(deps.repDb.collection(RECEIPTS).doc(eventRef.id), { schemaVersion: 1,
      workspaceId: context.workspace_id, employeeId: context.decoded.uid, establishmentId,
      nsr: prepared.marking.nsr, markingId: prepared.marking.markingId, recordedDate: input.workDate, status: 'pending', snapshot,
      attempts: 0, lastIssue: null, createdAt, nextAttemptAt: createdAt, ...organizationalClassification });
    return { status: 'recorded' as const, marking: prepared.marking, location: location.summary,
      locationEvidence: location.evidence && location.expiresAt ? {
        evidence: location.evidence, recordedDate: input.workDate, recordedAt: reading.instant,
        expiresAt: location.expiresAt,
      } : null };
  });
  if (committed.locationEvidence) await persistLocationEvidenceBestEffort(deps, committed.locationEvidence);
  const receipt = await settleRepPReceipt(deps, committed.marking);
  return { status: committed.status, marking: committed.marking, offlineCycle: await reconcileOnlineCyclesBestEffort(deps.repDb, context, 'official'), location: committed.location, ...receipt };
}

/** Sincroniza uma marcação preservada pelo Coala Go; o NSR só nasce nesta transação no servidor. */
async function recordOwnOfflineRepPMarking(context: ServerUserContext, input: RepPMarkingRequest,
  deps: Dependencies) {
  const evidence = input.offline;
  if (!evidence || (evidence.scope !== undefined && evidence.scope !== 'official') || input.channel !== 'mobile') {
    throw fail('REP_P_OFFLINE_INPUT_INVALID', 'Marcação offline inválida.');
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
    if (!verifyRepPMarkingCandidate(prior) || prior.mode !== '1') {
      throw fail('REP_P_ATTEMPT_CORRUPT', 'Tentativa offline persistida inconsistente.', 'DATA_INTEGRITY');
    }
    return { status: 'replayed' as const, marking: prior,
      offlineCycle: await readOfflineCycleDto(deps.repDb, context, evidence.cycle?.id),
      location: storedLocationSummary(existingAttempt.get('locationSummary')), ...await settleRepPReceipt(deps, prior) };
  }

  if (evidence.cycle) await reconcileOnlineCycles(deps.repDb, context, 'official');
  const permitRef = deps.repDb.collection(OFFLINE_PERMITS).doc(evidence.permitId);
  const permitSnapshot = await permitRef.get();
  const permit = permitSnapshot.data() as OfflinePermitDocument | undefined;
  if (!permitSnapshot.exists || !permit || permit.schemaVersion !== 1 || permit.status !== 'active'
    || permit.workspaceId !== context.workspace_id || permit.employeeId !== context.decoded.uid
    || permit.permitId !== evidence.permitId || permit.deviceKeyId !== evidence.deviceKeyId
    || permit.bootCount !== evidence.bootCount) {
    throw fail('REP_P_OFFLINE_PERMIT_INVALID', 'A autorização offline não é válida para esta conta e aparelho.', 'AUTHORIZATION');
  }
  const permittedUnit = permit.units.find((unit) => unit.id === input.executionUnitId);
  if (!permittedUnit) throw fail('REP_P_EXECUTION_UNIT_OUTSIDE_PERMIT', 'A unidade não pertence à autorização offline.', 'AUTHORIZATION');
  let expectedMarkedAt: string;
  try {
    expectedMarkedAt = deriveRepPOfflineMarkedAt({ anchorInstant: permit.anchorInstant,
      anchorElapsedRealtimeMs: permit.anchorElapsedRealtimeMs, elapsedRealtimeMs: evidence.elapsedRealtimeMs,
      maxElapsedMs: permit.protocolVersion === 2 ? REP_P_OFFLINE_PREPARATION_TTL_MS + REP_P_OFFLINE_CYCLE_TTL_MS : undefined,
      timeZone: permittedUnit.timeZone });
  } catch { throw fail('REP_P_OFFLINE_TIME_INVALID', 'A hora preservada no aparelho não pôde ser validada.', 'DATA_INTEGRITY'); }
  if (evidence.markedAt !== expectedMarkedAt || civilDateFromRepPTimestamp(expectedMarkedAt) !== input.workDate
    || Date.parse(expectedMarkedAt.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')) > Date.parse(permit.expiresAt)) {
    throw fail('REP_P_OFFLINE_TIME_MISMATCH', 'A hora da marcação não corresponde à autorização offline.', 'DATA_INTEGRITY');
  }
  if (!verifyRepPOfflineEvidence({ scope: 'official', permitId: evidence.permitId, attemptId: input.attemptId,
    executionUnitId: input.executionUnitId, deviceKeyId: evidence.deviceKeyId,
    elapsedRealtimeMs: evidence.elapsedRealtimeMs, bootCount: evidence.bootCount,
    sequence: evidence.sequence, previousLocalHash: evidence.previousLocalHash, cycle: evidence.cycle,
    markedAt: evidence.markedAt, publicKeyBase64: permit.devicePublicKey,
    localHash: evidence.localHash, signature: evidence.signature })) {
    throw fail('REP_P_OFFLINE_SIGNATURE_INVALID', 'A assinatura da marcação preservada no aparelho é inválida.', 'DATA_INTEGRITY');
  }

  const reference = await resolveEmploymentReferenceForSystem({ workspaceId: context.workspace_id,
    userId: context.decoded.uid, date: input.workDate, database: deps.mainDb });
  if (reference.status !== 'matched') throw fail('REP_P_EMPLOYMENT_UNRESOLVED', 'Não há vínculo histórico válido para a data da marcação.', 'DATA_INTEGRITY');
  if (reference.period.employmentRelationshipType !== 'clt' && reference.period.employmentRelationshipType !== 'apprenticeship') {
    throw fail('REP_P_EMPLOYMENT_NOT_ELIGIBLE', 'O vínculo não está habilitado para registro de ponto.', 'VALIDATION');
  }
  const coverageGrant = offlineCoverageGrant(permit, input.workDate, input.executionUnitId);
  if (!coverageGrant && !await allowedExecutionUnit(deps.mainDb, context.decoded.uid, input.workDate, reference.period.unitIds, input.executionUnitId)) {
    throw fail('REP_P_EXECUTION_UNIT_OUTSIDE_EMPLOYMENT', 'A unidade não está no vínculo nem na cobertura escalada para esta data.', 'AUTHORIZATION');
  }
  const establishmentId = establishmentKey(context.workspace_id, reference.period.employer.cnpj);
  if (establishmentId !== permit.establishmentId || reference.period.employer.cnpj !== permit.employerCnpj) {
    throw fail('REP_P_OFFLINE_EMPLOYMENT_CHANGED', 'O vínculo empregador mudou depois da autorização offline.', 'CONFLICT');
  }
  const [identity, executionUnit, establishmentBefore] = await Promise.all([
    loadStrictIdentity(deps.hrDb, context.decoded.uid), deps.mainDb.collection('dp_units').doc(input.executionUnitId).get(),
    deps.repDb.collection(ESTABLISHMENTS).doc(establishmentId).get(),
  ]);
  if (!executionUnit.exists && !coverageGrant) throw fail('REP_P_EXECUTION_UNIT_MISSING', 'Unidade de execução não encontrada.', 'NOT_FOUND');
  const establishmentData = establishmentBefore.data();
  if (!validEstablishment(establishmentData) || establishmentData.workspaceId !== context.workspace_id
    || establishmentData.profile.employerCnpj !== reference.period.employer.cnpj) {
    throw fail('REP_P_ESTABLISHMENT_NOT_READY', 'O estabelecimento ainda não está habilitado no REP-P.', 'DATA_INTEGRITY');
  }
  if ((coverageGrant?.timeZone ?? repPMarkingTimeZone(executionUnit.get('timeZone'), establishmentData.timeZone)) !== permittedUnit.timeZone) {
    throw fail('REP_P_OFFLINE_UNIT_CHANGED', 'O fuso da unidade mudou depois da autorização offline.', 'CONFLICT');
  }
  const reading = await deps.clock.read();
  assertTrustedRepPClockReading(reading);
  const recordedAt = formatRepPAfdTimestamp(reading.instant, permittedUnit.timeZone);
  const workLocation = coverageGrant?.workLocation ?? (String(executionUnit.get('address') ?? '').trim() || null);
  if (missingRepPReceiptFields({ employerLegalName: establishmentData.profile.employerLegalName, workLocation,
    inpiRegistration: establishmentData.profile.inpiRegistration, employeeName: identity.name }).length) {
    throw fail('REP_P_RECEIPT_PREREQUISITES_MISSING',
      'O registro de ponto está indisponível nesta unidade até o cadastro do comprovante ser completado pelo DP.', 'DATA_INTEGRITY');
  }

  const establishmentRef = deps.repDb.collection(ESTABLISHMENTS).doc(establishmentId);
  const employeeRef = deps.repDb.collection(EMPLOYEES).doc(employeeKey(establishmentId, context.decoded.uid));
  const competenceFenceRef = repPCompetenceFenceRef(deps.repDb, context.workspace_id, input.workDate.slice(0, 7));
  const locationPolicyRef = repPLocationPolicyRef(deps.repDb, context.workspace_id, input.executionUnitId);
  const committed = await deps.repDb.runTransaction(async (transaction) => {
    const [establishment, employee, attempt, currentPermit, competenceFence, locationPolicyDocument] = await transaction.getAll(
      establishmentRef, employeeRef, attemptRef, permitRef, competenceFenceRef, locationPolicyRef);
    const current = establishment.data();
    if (!validEstablishment(current) || current.workspaceId !== context.workspace_id
      || !sameProfile(current.profile, establishmentData.profile) || current.timeZone !== establishmentData.timeZone) {
      throw fail('REP_P_ESTABLISHMENT_CHANGED', 'O cadastro fiscal mudou durante a sincronização.', 'CONFLICT');
    }
    if (!employee.exists || employee.get('status') !== 'active' || employee.get('cpf') !== identity.cpf
      || employee.get('name') !== identity.name || employee.get('userId') !== context.decoded.uid) {
      throw fail('REP_P_EMPLOYEE_NOT_READY', 'A identidade do empregado ainda não está habilitada na ARP.', 'DATA_INTEGRITY');
    }
    if (attempt.exists) {
      if (attempt.get('requestDigest') !== requestDigest) throw fail('REP_P_ATTEMPT_CONFLICT', 'Tentativa reutilizada com conteúdo diferente.', 'CONFLICT');
      const prior = attempt.get('marking') as RepPMarkingCandidate;
      if (!verifyRepPMarkingCandidate(prior) || prior.mode !== '1') throw fail('REP_P_ATTEMPT_CORRUPT', 'Tentativa persistida inconsistente.', 'DATA_INTEGRITY');
      return { status: 'replayed' as const, marking: prior,
        location: storedLocationSummary(attempt.get('locationSummary')), locationEvidence: null };
    }
    assertRepPCompetenceAcceptsMarking(competenceFence, context.workspace_id, input.workDate.slice(0, 7));
    const currentPermitData = currentPermit.data() as OfflinePermitDocument | undefined;
    if (!currentPermitData || currentPermitData.status !== 'active'
      || currentPermitData.deviceKeyId !== evidence.deviceKeyId || currentPermitData.bootCount !== evidence.bootCount) {
      throw fail('REP_P_OFFLINE_PERMIT_REVOKED', 'A autorização offline foi revogada.', 'AUTHORIZATION');
    }
    if (evidence.sequence !== currentPermitData.lastAcceptedSequence + 1
      || evidence.previousLocalHash !== currentPermitData.lastAcceptedHash) {
      throw fail('REP_P_OFFLINE_SEQUENCE_INVALID', 'A sequência das marcações offline está incompleta ou fora de ordem.', 'CONFLICT');
    }
    const cycle = await loadOfflineCycle(transaction, deps.repDb, context, permit, evidence,
      input.attemptId, reading.instant.getTime());
    const prepared = prepareRepPMarking({ attemptId: input.attemptId, workspaceId: context.workspace_id,
      employeeId: context.decoded.uid, employeeCpf: identity.cpf, employmentHistoryId: reference.historyId,
      employmentRevision: reference.revision, employerUnitId: reference.period.employerUnitId,
      employerCnpj: reference.period.employer.cnpj, establishmentId, executionUnitId: input.executionUnitId,
      markedAt: expectedMarkedAt, recordedAt, collectorId: '01', mode: '1' }, {
      nextNsr: current.lastNsr + 1,
      previousRecord: current.lastType7Hash && current.lastType7Nsr
        ? { establishmentId, nsr: current.lastType7Nsr, hash: current.lastType7Hash } : null,
    });
    if (prepared.status !== 'created') throw fail('REP_P_SEQUENCE_INVALID', 'Sequência fiscal inconsistente.', 'DATA_INTEGRITY');
    const eventRef = deps.repDb.collection(EVENTS).doc(eventKey(establishmentId, prepared.marking.nsr));
    const locationPolicy = locationPolicyForActor(context,
      effectiveRepPLocationPolicy(locationPolicyDocument.data(), context.workspace_id, input.executionUnitId));
    // A fila offline atual assina a marcação, mas não a coordenada. Por isso ela registra somente a indisponibilidade,
    // sem aceitar posição não vinculada à assinatura criptográfica do aparelho.
    const location = prepareLocationEvidence({ policy: locationPolicy,
      markedAt: new Date(expectedMarkedAt.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')),
      workspaceId: context.workspace_id, employeeId: context.decoded.uid,
      markingId: prepared.marking.markingId, evidenceId: eventRef.id, executionUnitId: input.executionUnitId });
    cycle?.commit(eventRef.id);
    transaction.create(eventRef, { ...prepared.marking, arpPersistenceStatus: 'persisted', recordedDate: input.workDate,
      offlineEvidence: { permitId: permit.permitId, installationId: permit.installationId,
        deviceKeyId: evidence.deviceKeyId, keySecurity: permit.keySecurity, bootCount: evidence.bootCount,
        sequence: evidence.sequence, previousLocalHash: evidence.previousLocalHash, localHash: evidence.localHash,
        signature: evidence.signature, elapsedRealtimeMs: evidence.elapsedRealtimeMs,
        permitIssuedAt: permit.issuedAt, permitExpiresAt: permit.expiresAt, ...(evidence.cycle ? { cycle: evidence.cycle } : {}) },
      trustedClock: { source: reading.source, assurance: reading.assurance, observedOffsetMs: reading.observedOffsetMs,
        verifiedAt: reading.verifiedAt.toISOString(), serverInstant: reading.instant.toISOString(),
        attestationId: reading.attestationId, attestationMode: reading.attestationMode,
        quorum: reading.quorum, observations: reading.observations }, createdAt: Timestamp.now() });
    transaction.create(attemptRef, { workspaceId: context.workspace_id, employeeId: context.decoded.uid,
      requestDigest, marking: prepared.marking, locationSummary: location.summary, createdAt: Timestamp.now() });
    transaction.update(establishmentRef, { lastNsr: prepared.marking.nsr, lastType7Hash: prepared.marking.hash,
      lastType7Nsr: prepared.marking.nsr });
    transaction.update(permitRef, { lastAcceptedSequence: evidence.sequence, lastAcceptedHash: evidence.localHash,
      lastAcceptedAt: Timestamp.now() });
    const snapshot: RepPReceiptSnapshot = { schemaVersion: 1, title: REP_P_RECEIPT_TITLE,
      nsr: prepared.marking.nsr, markedAt: prepared.marking.markedAt, hash: prepared.marking.hash,
      employerLegalName: current.profile.employerLegalName, employerCnpj: current.profile.employerCnpj,
      cnoCaepf: current.profile.cnoCaepf ?? null, workLocation, inpiRegistration: current.profile.inpiRegistration,
      developerCnpj: current.profile.developerCnpj, employeeName: identity.name, employeeCpf: identity.cpf,
      collectorId: '01', establishmentId, executionUnitId: input.executionUnitId };
    const createdAt = Timestamp.now();
    const organizationalClassification = input.declaredPurpose ? {
      classification: { purpose: input.declaredPurpose, source: 'declared', status: 'confirmed', updatedAt: createdAt,
        updatedBy: context.decoded.uid },
      classificationHistory: [{ purpose: input.declaredPurpose, source: 'declared', status: 'confirmed', at: createdAt,
        actorUid: context.decoded.uid }],
    } : {};
    transaction.create(deps.repDb.collection(RECEIPTS).doc(eventRef.id), { schemaVersion: 1,
      workspaceId: context.workspace_id, employeeId: context.decoded.uid, establishmentId,
      nsr: prepared.marking.nsr, markingId: prepared.marking.markingId, recordedDate: input.workDate,
      status: 'pending', snapshot, attempts: 0, lastIssue: null, createdAt, nextAttemptAt: createdAt,
      ...organizationalClassification });
    return { status: 'recorded' as const, marking: prepared.marking, location: location.summary,
      locationEvidence: location.evidence && location.expiresAt ? {
        evidence: location.evidence, recordedDate: input.workDate,
        recordedAt: new Date(recordedAt.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')),
        expiresAt: location.expiresAt,
      } : null };
  });
  if (committed.locationEvidence) await persistLocationEvidenceBestEffort(deps, committed.locationEvidence);
  return { status: committed.status, marking: committed.marking, location: committed.location,
    ...await settleRepPReceipt(deps, committed.marking) };
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
  if (/^pilot_[a-f0-9]{64}$/.test(receiptId)) {
    const receipt = await deps.pilotDb.collection(PILOT_MARKINGS).doc(receiptId).get();
    if (!receipt.exists || receipt.get('workspaceId') !== context.workspace_id
      || receipt.get('employeeId') !== context.decoded.uid || !validPilotMarking(receipt.data())) throw notFound();
    return { receipt, pilot: true as const };
  }
  if (!/^[a-f0-9]{64}_\d{9}$/.test(receiptId)) throw notFound();
  const receipt = await deps.repDb.collection(RECEIPTS).doc(receiptId).get();
  // Documento alheio e inexistente respondem igual para não permitir descoberta.
  if (!receipt.exists || receipt.get('workspaceId') !== context.workspace_id
    || receipt.get('employeeId') !== context.decoded.uid) throw notFound();
  return { receipt, pilot: false as const };
}

/** Leitura sem efeitos: devolve os bytes assinados gravados na emissão, sem regenerar. */
export async function getOwnRepPReceipt(context: ServerUserContext, receiptId: string, injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  const { receipt } = await loadOwnReceipt(context, receiptId, deps);
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
  const loaded = await loadOwnReceipt(context, receiptId, deps);
  const { receipt } = loaded;
  if (loaded.pilot) return issuePilotReceipt(deps, receipt.data() as PilotMarkingDocument);
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
  const auditRef = deps.repDb.collection(EXPORT_AUDIT).doc();
  const auditBase = { schemaVersion: 2, workspaceId: context.workspace_id,
    establishmentId: input.establishmentId, startDate: input.startDate, endDate: input.endDate,
    generatedAt, actorId: context.decoded.uid, layoutVersion: '004', filename: signed.filename,
    signatureFilename: signed.signatureFilename, sha256: signed.sha256, certificateCnpj: signed.certificateCnpj,
    counts: signed.counts, lineCount: signed.lineCount };
  await auditRef.set({ ...auditBase, status: 'archiving', createdAt: Timestamp.now() });
  let artifacts: PersistedFiscalArtifacts | undefined;
  try {
    artifacts = await persistFiscalArtifactPair({ store: deps.fiscalStore, kind: 'afd', workspaceId: context.workspace_id,
      establishmentId: input.establishmentId, exportId: auditRef.id, filename: signed.filename, content: signed.bytes,
      expectedSha256: signed.sha256, signatureFilename: signed.signatureFilename, signature: Buffer.from(signed.signature) });
    await auditRef.set({ ...auditBase, status: 'exported', artifacts, completedAt: Timestamp.now() }, { merge: true });
  } catch (cause) {
    await auditRef.set({ status: 'archive_failed', ...(artifacts ? { artifacts } : {}), updatedAt: Timestamp.now() }, { merge: true }).catch(() => undefined);
    throw new AppError({ code: 'REP_P_AFD_ARCHIVE_FAILED', kind: 'TRANSIENT_EXTERNAL', retryable: true,
      safeMessage: 'O AFD foi gerado, mas não pôde ser arquivado com segurança. Tente novamente.', cause });
  }
  return { filename: signed.filename, afdBase64: signed.bytes.toString('base64'), sha256: signed.sha256,
    signatureFilename: signed.signatureFilename, signatureBase64: signed.signature.toString('base64'),
    certificateCnpj: signed.certificateCnpj, counts: signed.counts, lineCount: signed.lineCount,
    exportId: auditRef.id, archived: true as const };
}

/** Estabelecimentos fiscais disponíveis para a tela administrativa de exportação AFD/AEJ. */
export async function listRepPFiscalEstablishments(context: ServerUserContext, injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  const snapshot = await deps.repDb.collection(ESTABLISHMENTS).where('workspaceId', '==', context.workspace_id).limit(101).get();
  if (snapshot.size > 100) throw fail('REP_P_ESTABLISHMENT_LIMIT', 'Há estabelecimentos demais para listar com segurança.', 'CONFLICT');
  return snapshot.docs.flatMap((doc) => {
    const data = doc.data();
    if (!validEstablishment(data)) return [];
    return [{ id: doc.id, legalName: data.profile.employerLegalName, cnpj: data.profile.employerCnpj, timeZone: data.timeZone }];
  }).sort((left, right) => left.legalName.localeCompare(right.legalName, 'pt-BR'));
}

function receiptTimestampMillis(value: unknown) {
  return value instanceof Timestamp ? value.toMillis() : null;
}

/**
 * Histórico do próprio colaborador por período. Lê só o catálogo de comprovantes (um por batida),
 * filtrado por pessoa e data no Firestore e limitado; nunca devolve bytes, CPF nem dados de terceiros.
 */
export async function listOwnRepPMarkings(context: ServerUserContext, raw: unknown, injected: Partial<Dependencies> = {}) {
  return listRepPMarkingsOfPerson(context.workspace_id, context.decoded.uid, raw, injected);
}

/** Classificação organizacional: nunca altera a marcação fiscal. Em competência fechada vira pedido pendente. */
export async function classifyOwnRepPMarking(context: ServerUserContext, receiptId: string, raw: unknown,
  injected: Partial<Dependencies> = {}) {
  const parsed = repPMarkingClassificationSchema.safeParse(raw);
  if (!parsed.success) throw fail('REP_P_CLASSIFICATION_INPUT_INVALID', 'Escolha uma classificação válida.');
  const deps = { ...defaults, ...injected };
  if (/^pilot_[a-f0-9]{64}$/.test(receiptId)) {
    const receiptRef = deps.pilotDb.collection(PILOT_MARKINGS).doc(receiptId);
    const now = Timestamp.now();
    const classification = { purpose: parsed.data.purpose, source: 'declared' as const, status: 'confirmed' as const,
      updatedAt: now, updatedBy: context.decoded.uid };
    return deps.pilotDb.runTransaction(async (tx) => {
      const receipt = await tx.get(receiptRef);
      const stored = receipt.data();
      if (!receipt.exists || !validPilotMarking(stored) || stored.workspaceId !== context.workspace_id
        || stored.employeeId !== context.decoded.uid) {
        throw fail('REP_P_MARKING_NOT_FOUND', 'Batida não encontrada.', 'NOT_FOUND');
      }
      if (stored.classification?.purpose === parsed.data.purpose) {
        return { classification: stored.classification, changeStatus: 'applied' as const };
      }
      const currentRevision = stored.classification ? Number(stored.classificationRevision) : 0;
      if (!Number.isSafeInteger(currentRevision) || currentRevision < 0) {
        throw fail('REP_P_PILOT_CLASSIFICATION_CORRUPT', 'A trilha de classificação do ensaio está inconsistente.', 'DATA_INTEGRITY');
      }
      const revision = currentRevision + 1;
      const classificationEventRef = deps.pilotDb.collection(REP_P_PILOT_CLASSIFICATION_EVENTS)
        .doc(digest([receiptId, 'classification', revision]));
      tx.create(classificationEventRef, { schemaVersion: 1, mode: 'pilot', workspaceId: context.workspace_id,
        employeeId: context.decoded.uid, markingId: receiptId, receiptId, revision,
        previousPurpose: stored.classification?.purpose ?? null, purpose: parsed.data.purpose,
        source: 'declared', status: 'confirmed', at: now, actorUid: context.decoded.uid });
      tx.update(receiptRef, { classification, classificationRevision: revision, updatedAt: now });
      return { classification, changeStatus: 'applied' as const };
    });
  }
  const receiptRef = deps.repDb.collection(RECEIPTS).doc(receiptId);
  const receipt = await receiptRef.get();
  if (!receipt.exists || receipt.get('workspaceId') !== context.workspace_id || receipt.get('employeeId') !== context.decoded.uid) {
    throw fail('REP_P_MARKING_NOT_FOUND', 'Batida não encontrada.', 'NOT_FOUND');
  }
  const snapshot = receipt.get('snapshot') as RepPReceiptSnapshot;
  const workDate = String(receipt.get('recordedDate'));
  const now = Timestamp.now();
  const classification = { purpose: parsed.data.purpose, source: 'declared', status: 'confirmed', updatedAt: now,
    updatedBy: context.decoded.uid };
  // A classificação pertence ao PTRP e não altera a ARP. Assim ela e o fechamento continuam
  // coordenados na mesma transação mesmo com a ARP em banco dedicado.
  return deps.hrDb.runTransaction(async (tx) => {
    const closureRef = deps.hrDb.collection('ptrp_competenceClosures').doc(`${context.workspace_id}_${workDate.slice(0, 7)}`);
    const classificationRef = deps.hrDb.collection(CLASSIFICATIONS).doc(receiptId);
    const closure = await tx.get(closureRef);
    const classificationDocument = await tx.get(classificationRef);
    const closureVersion = Number(closure.get('version') ?? 0);
    const headId = digest([context.workspace_id, context.decoded.uid, receiptId, closureVersion]);
    const headRef = deps.hrDb.collection('ptrp_markingClassificationRequestHeads').doc(headId);
    const head = await tx.get(headRef);
    const activeRequestId = typeof head.get('activeRequestId') === 'string' ? String(head.get('activeRequestId')) : null;
    const activeRef = activeRequestId ? deps.hrDb.collection('ptrp_markingClassificationRequests').doc(activeRequestId) : null;
    const active = activeRef ? await tx.get(activeRef) : null;
    const activePending = Boolean(active?.exists && active.get('status') === 'in_review');
    const supersedeActive = () => {
      if (!activeRef || !active || !activePending) return;
      tx.update(activeRef, { status: 'superseded', version: Number(active.get('version') ?? 0) + 1,
        updatedAt: now, supersededAt: now, supersededBy: context.decoded.uid });
    };
    const currentClassification = (classificationDocument.get('classification') ?? receipt.get('classification')) as { purpose?: string } | null | undefined;
    if (currentClassification?.purpose === parsed.data.purpose) {
      supersedeActive();
      if (head.exists && activePending) tx.set(headRef, { activeRequestId: null, activePurpose: null, updatedAt: now }, { merge: true });
      return { classification: currentClassification, changeStatus: 'applied' as const };
    }
    if (closure.exists && closure.get('status') === 'closed') {
      if (activePending && active?.get('requestedPurpose') === parsed.data.purpose) {
        return { classification, changeStatus: 'in_review' as const };
      }
      supersedeActive();
      const sequence = Number(head.get('sequence') ?? 0) + 1;
      const requestRef = deps.hrDb.collection('ptrp_markingClassificationRequests')
        .doc(digest([headId, sequence, parsed.data.purpose]));
      tx.create(requestRef, { id: requestRef.id, headId, requestSequence: sequence,
        workspaceId: context.workspace_id, employeeId: context.decoded.uid,
        employeeName: typeof context.userDoc.username === 'string' ? context.userDoc.username.slice(0, 120) : null,
        receiptId, workDate, competence: workDate.slice(0, 7), unitId: snapshot.executionUnitId,
        markedAt: snapshot.markedAt, nsr: snapshot.nsr, closureVersion, requestedPurpose: parsed.data.purpose,
        currentClassification: currentClassification ?? null, status: 'in_review', version: 1,
        createdAt: now, updatedAt: now, createdBy: context.decoded.uid });
      tx.set(headRef, { id: headId, workspaceId: context.workspace_id, employeeId: context.decoded.uid,
        receiptId, workDate, closureVersion, sequence, activeRequestId: requestRef.id,
        activePurpose: parsed.data.purpose, updatedAt: now }, { merge: false });
      return { classification, changeStatus: 'in_review' as const };
    }
    supersedeActive();
    if (head.exists && activePending) tx.set(headRef, { activeRequestId: null, activePurpose: null, updatedAt: now }, { merge: true });
    const history = Array.isArray(classificationDocument.get('history')) ? classificationDocument.get('history') as unknown[] : [];
    tx.set(classificationRef, { schemaVersion: 1, workspaceId: context.workspace_id, employeeId: context.decoded.uid,
      receiptId, workDate, classification, history: [...history.slice(-99), {
        purpose: parsed.data.purpose, source: 'declared', status: 'confirmed', at: now, actorUid: context.decoded.uid,
      }], updatedAt: now }, { merge: true });
    return { classification, changeStatus: 'applied' as const };
  });
}

/** Exporta os comprovantes assinados da própria pessoa e relaciona pendências sem fingir que o pacote está completo. */
export async function exportOwnRepPReceipts(context: ServerUserContext, raw: unknown, injected: Partial<Dependencies> = {}) {
  const parsed = repPOwnHistorySchema.safeParse(raw);
  if (!parsed.success) throw fail('REP_P_RECEIPT_ARCHIVE_INPUT_INVALID', 'Período de exportação inválido.');
  const deps = { ...defaults, ...injected };
  const snapshot = await deps.repDb.collection(RECEIPTS)
    .where('workspaceId', '==', context.workspace_id).where('employeeId', '==', context.decoded.uid)
    .where('recordedDate', '>=', parsed.data.startDate).where('recordedDate', '<=', parsed.data.endDate)
    .orderBy('recordedDate').limit(MAX_HISTORY_MARKINGS + 1).get();
  if (snapshot.size > MAX_HISTORY_MARKINGS) {
    throw fail('REP_P_RECEIPT_ARCHIVE_TRUNCATED', 'O período tem comprovantes demais. Divida o intervalo de datas.', 'CONFLICT');
  }
  try {
    return buildRepPReceiptArchive({ startDate: parsed.data.startDate, endDate: parsed.data.endDate,
      generatedAt: (deps.now?.() ?? new Date()).toISOString(),
      receipts: snapshot.docs.map((document) => {
        const receipt = document.get('snapshot') as RepPReceiptSnapshot | undefined;
        if (!receipt) throw new TypeError('Comprovante sem instantâneo.');
        const issued = document.get('status') === 'issued';
        return { receiptId: document.id, workDate: String(document.get('recordedDate')), nsr: receipt.nsr,
          markedAt: receipt.markedAt, status: issued ? 'issued' as const : 'pending' as const,
          issue: issued ? null : (document.get('lastIssue') as string | null) ?? null,
          filename: issued ? String(document.get('filename') ?? '') : null,
          pdf: issued ? document.get('pdf') as Uint8Array | undefined : null,
          sha256: issued ? String(document.get('sha256') ?? '') : null };
      }) });
  } catch (cause) {
    if (cause instanceof RangeError) throw fail('REP_P_RECEIPT_ARCHIVE_TOO_LARGE', 'O pacote ficou grande demais. Divida o intervalo de datas.', 'CONFLICT');
    throw fail('REP_P_RECEIPT_ARCHIVE_CORRUPT', 'Um comprovante armazenado não confere com sua integridade.', 'DATA_INTEGRITY');
  }
}

/** Mesma leitura limitada do histórico, para uma pessoa já autorizada pelo chamador. */
export async function listRepPMarkingsOfPerson(workspaceId: string, employeeUid: string, raw: unknown, injected: Partial<Dependencies> = {}) {
  const parsed = repPOwnHistorySchema.safeParse(raw);
  if (!parsed.success) throw fail('REP_P_HISTORY_INPUT_INVALID', 'Período de consulta inválido.');
  const input: RepPOwnHistoryRequest = parsed.data;
  const deps = { ...defaults, ...injected };
  const baseFilters = (database: Firestore, collection: string) => database.collection(collection)
    .where('workspaceId', '==', workspaceId).where('employeeId', '==', employeeUid)
    .where('recordedDate', '>=', input.startDate).where('recordedDate', '<=', input.endDate)
    .orderBy('recordedDate').limit(MAX_HISTORY_MARKINGS + 1);
  const [snapshot, pilotSnapshot] = await Promise.all([
    baseFilters(deps.repDb, RECEIPTS).get(),
    baseFilters(deps.pilotDb, PILOT_MARKINGS).get(),
  ]);
  const overlays = snapshot.docs.length ? await deps.hrDb.getAll(...snapshot.docs
    .map((document) => deps.hrDb.collection(CLASSIFICATIONS).doc(document.id))) : [];
  const official = snapshot.docs.map((document, index) => {
    const receipt = document.get('snapshot') as RepPReceiptSnapshot;
    return { receiptId: document.id, workDate: String(document.get('recordedDate')), nsr: receipt.nsr,
      markedAt: receipt.markedAt, executionUnitId: receipt.executionUnitId, collectorId: receipt.collectorId,
      hash: receipt.hash, receiptStatus: document.get('status') === 'issued' ? 'available' as const : 'pending' as const,
      receiptIssue: document.get('status') === 'issued' ? null : (document.get('lastIssue') as string | null) ?? null,
      classification: overlays[index]?.get('classification') ?? document.get('classification') ?? null, pilot: false as const };
  });
  const pilot = pilotSnapshot.docs.flatMap((document) => {
    const data = document.data();
    if (!validPilotMarking(data)) return [];
    return [{ receiptId: document.id, workDate: data.workDate, nsr: data.sequence,
      markedAt: data.markedAt, executionUnitId: data.executionUnitId, collectorId: data.collectorId,
      hash: data.hash, receiptStatus: data.status === 'issued' ? 'available' as const : 'pending' as const,
      receiptIssue: data.status === 'issued' ? null : String(document.get('lastIssue') ?? '') || null,
      classification: document.get('classification') ?? null, pilot: true as const }];
  });
  const combined = [...official, ...pilot]
    .sort((left, right) => repPInstantMs(left.markedAt) - repPInstantMs(right.markedAt) || left.nsr - right.nsr);
  return { startDate: input.startDate, endDate: input.endDate, markings: combined.slice(0, MAX_HISTORY_MARKINGS),
    truncated: snapshot.size > MAX_HISTORY_MARKINGS || pilotSnapshot.size > MAX_HISTORY_MARKINGS || combined.length > MAX_HISTORY_MARKINGS };
}

/** Batidas de ensaio que podem compor somente a prévia do mês aberto. Nunca é usada no fechamento. */
export async function readRepPPilotMarkingsForBank(workspaceId: string, employeeId: string, startDate: string, endDate: string,
  injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  const snapshot = await deps.pilotDb.collection(PILOT_MARKINGS)
    .where('workspaceId', '==', workspaceId).where('employeeId', '==', employeeId)
    .where('recordedDate', '>=', startDate).where('recordedDate', '<=', endDate)
    .orderBy('recordedDate').limit(MAX_HISTORY_MARKINGS + 1).get();
  return {
    markings: snapshot.docs.slice(0, MAX_HISTORY_MARKINGS).flatMap((document) => {
      const data = document.data();
      return validPilotMarking(data) ? [{ workDate: data.workDate, nsr: data.sequence, markedAt: data.markedAt,
        executionUnitId: data.executionUnitId, collectorId: data.collectorId }] : [];
    }),
    truncated: snapshot.size > MAX_HISTORY_MARKINGS,
  };
}

/**
 * Batidas de uma pessoa num período para o espelho do fechamento (Etapa 6): mesma consulta do histórico próprio,
 * chamada só pelo serviço de espelho depois de conferir a permissão. Devolve também a identidade congelada no
 * comprovante mais recente (nome, CPF e empregador), que o espelho usa em vez do cadastro atual.
 */
export async function readRepPMarkingsForMirror(workspaceId: string, employeeId: string, startDate: string, endDate: string, injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  const snapshot = await deps.repDb.collection(RECEIPTS)
    .where('workspaceId', '==', workspaceId).where('employeeId', '==', employeeId)
    .where('recordedDate', '>=', startDate).where('recordedDate', '<=', endDate)
    .orderBy('recordedDate').limit(MAX_HISTORY_MARKINGS + 1).get();
  const receipts = snapshot.docs.slice(0, MAX_HISTORY_MARKINGS).map((document) => ({ workDate: String(document.get('recordedDate')), receipt: document.get('snapshot') as RepPReceiptSnapshot }))
    .sort((left, right) => repPInstantMs(left.receipt.markedAt) - repPInstantMs(right.receipt.markedAt) || left.receipt.nsr - right.receipt.nsr);
  const latest = receipts.at(-1)?.receipt;
  return {
    markings: receipts.map(({ workDate, receipt }) => ({ workDate, nsr: receipt.nsr, markedAt: receipt.markedAt, executionUnitId: receipt.executionUnitId, collectorId: receipt.collectorId })),
    identity: latest ? { employeeName: latest.employeeName, employeeCpf: latest.employeeCpf, employerLegalName: latest.employerLegalName, employerCnpj: latest.employerCnpj } : null,
    truncated: snapshot.size > MAX_HISTORY_MARKINGS,
  };
}

/**
 * Insumos do AEJ (Etapa 6, parte 4) para um estabelecimento e período, chamados só pelo serviço do AEJ depois de
 * conferir a permissão: perfil fiscal, batidas originais (eventos tipo 7, a fonte do AFD) e o vínculo uid → CPF e
 * nome pelo catálogo de comprovantes, tudo na mesma fotografia somente leitura. Também carimba a geração pela
 * Hora Legal no fuso do estabelecimento.
 */
export async function readRepPForAej(workspaceId: string, establishmentId: string, startDate: string, endDate: string, injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  const state = (await deps.repDb.collection(ESTABLISHMENTS).doc(establishmentId).get()).data();
  if (!validEstablishment(state) || state.workspaceId !== workspaceId) throw fail('REP_P_AFD_ESTABLISHMENT_MISSING', 'Estabelecimento REP-P não encontrado.', 'NOT_FOUND');
  const reading = await deps.clock.read();
  assertTrustedRepPClockReading(reading);
  const maxEvents = deps.afdMaxEvents ?? MAX_AFD_EVENTS;
  const { markings, receipts } = await deps.repDb.runTransaction(async (transaction) => {
    const events = await transaction.get(deps.repDb.collection(EVENTS).where('workspaceId', '==', workspaceId).where('establishmentId', '==', establishmentId)
      .where('recordedDate', '>=', startDate).where('recordedDate', '<=', endDate).orderBy('recordedDate').orderBy('nsr').limit(maxEvents + 1));
    const catalog = await transaction.get(deps.repDb.collection(RECEIPTS).where('workspaceId', '==', workspaceId).where('establishmentId', '==', establishmentId)
      .where('recordedDate', '>=', startDate).where('recordedDate', '<=', endDate).limit(maxEvents + 1));
    if (events.size > maxEvents || catalog.size > maxEvents) throw fail('REP_P_AFD_RANGE_TOO_LARGE', 'O período excede o limite seguro de exportação. Divida o intervalo de datas.');
    return {
      markings: events.docs.map((doc) => doc.data()).filter((event) => event.recordType === '7').map((event) => ({
        receiptId: eventKey(establishmentId, Number(event.nsr)), nsr: Number(event.nsr), markedAt: String(event.markedAt),
        employeeCpf: String(event.employeeCpf), workDate: String(event.recordedDate) })),
      receipts: catalog.docs.map((doc) => ({ employeeId: String(doc.get('employeeId')), snapshot: doc.get('snapshot') as RepPReceiptSnapshot })),
    };
  }, { readOnly: true });
  const people = new Map<string, { uid: string; name: string }>();
  for (const receipt of receipts) people.set(receipt.snapshot.employeeCpf, { uid: receipt.employeeId, name: receipt.snapshot.employeeName });
  return { profile: state.profile, timeZone: state.timeZone, generatedAt: formatRepPAfdTimestamp(reading.instant, state.timeZone), markings,
    people: [...people.entries()].map(([cpf, person]) => ({ cpf, ...person })) };
}

/** CPF e nome oficiais pelo cadastro do RH, para o AEJ de quem só tem inclusão aprovada no período. */
export async function readRepPEmployeeIdentity(userId: string, injected: Partial<Dependencies> = {}) {
  const { cpf, name } = await loadStrictIdentity(({ ...defaults, ...injected }).hrDb, userId);
  return { cpf, name };
}

/** CNPJ da desenvolvedora do REP-P e do PTRP, titular do certificado que assina AFD e AEJ. */
export const REP_P_DEVELOPER_CNPJ = CT_SORVETES_CNPJ;

/** Assinatura CAdES destacada da desenvolvedora (a mesma do AFD), para o AEJ gerado pelo PTRP. */
export async function signPtrpDetached(content: Buffer, injected: Partial<Dependencies> = {}) {
  return ({ ...defaults, ...injected }).signer.signDetached(content);
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
 * Unidades em que o colaborador pode registrar na data, pelo vínculo histórico ou por cobertura excepcional escalada.
 * Só leitura: consulta a HLB para o relógio informativo, não toca a ARP e não antecipa se o
 * estabelecimento está habilitado. Hora disponível nunca substitui vínculo, gate ou unidade.
 */
export async function listOwnRepPExecutionUnits(context: ServerUserContext, raw: unknown, injected: Partial<Dependencies> = {}) {
  const parsed = repPOwnOptionsSchema.safeParse(raw);
  if (!parsed.success) throw fail('REP_P_OPTIONS_INPUT_INVALID', 'Data inválida.');
  const deps = { ...defaults, ...injected };
  const mode = deps.markingEnabled ? 'official' as const : deps.pilotEnabled ? 'pilot' as const : 'disabled' as const;
  const officialUserAllowed = markingAllowedForOfficialUser(context, deps);
  const journeyLocationEnabled = mode === 'official' && officialUserAllowed && process.env.DP_JOURNEY_LOCATION_ENABLED === 'true';
  if (mode === 'disabled' || !markingAllowedForProfile(context)
    || mode === 'official' && !officialUserAllowed
    || mode === 'pilot' && !deps.pilotUserIds.has(context.decoded.uid)) {
    return { workDate: parsed.data.workDate, eligible: false as const, markingEnabled: false as const,
      mode, journeyLocationEnabled, executionUnits: [], officialClock: await readInformationalClock(deps) };
  }
  const reference = await resolveEmploymentReferenceForSystem({ workspaceId: context.workspace_id,
    userId: context.decoded.uid, date: parsed.data.workDate, database: deps.mainDb });
  if (reference.status !== 'matched') return { workDate: parsed.data.workDate, eligible: false as const,
    markingEnabled: true as const, mode, journeyLocationEnabled, executionUnits: [],
    officialClock: await readInformationalClock(deps) };
  const eligible = reference.period.employmentRelationshipType === 'clt'
    || reference.period.employmentRelationshipType === 'apprenticeship';
  const unitIds = [...new Set([...reference.period.unitIds,
    ...await externalCoverageUnits(deps.mainDb, context.decoded.uid, parsed.data.workDate, reference.period.unitIds)])].slice(0, 30);
  const units = unitIds.length
    ? await deps.mainDb.getAll(...unitIds.map((id) => deps.mainDb.collection('dp_units').doc(id))) : [];
  const locationPolicies = mode === 'pilot'
    ? new Map(unitIds.map((unitId) => [unitId, disabledRepPLocationPolicy(context.workspace_id, unitId)]))
    : await loadRepPLocationPolicies(deps.repDb, context.workspace_id, unitIds);
  const executionUnits = units.filter((unit) => unit.exists
    && (reference.period.unitIds.includes(unit.id)
      || isBrazilTimeZone(unit.get('timeZone')) && String(unit.get('address') ?? '').trim()))
    .map((unit) => {
      const location = locationPolicies.get(unit.id)!;
      const collectorLocation = locationPolicyForActor(context, location);
      return { id: unit.id, name: String(unit.get('name') ?? unit.id),
        employer: unit.id === reference.period.employerUnitId,
        timeZone: isBrazilTimeZone(unit.get('timeZone')) ? String(unit.get('timeZone')) : null,
        locationPolicy: { mode: collectorLocation.mode, revision: collectorLocation.revision,
          captureTimeoutMs: collectorLocation.captureTimeoutMs, maxAccuracyMeters: collectorLocation.maxAccuracyMeters,
          privacyNoticeUrl: collectorLocation.privacyNoticeUrl } };
    })
    .sort((left, right) => Number(right.employer) - Number(left.employer) || left.name.localeCompare(right.name, 'pt-BR'));
  return { workDate: parsed.data.workDate, eligible, markingEnabled: true as const, mode, journeyLocationEnabled,
    executionUnits: eligible ? executionUnits : [],
    officialClock: eligible && executionUnits.length ? (mode === 'pilot'
      ? await readPilotClock(deps, executionUnits.find((unit) => unit.timeZone)?.timeZone ?? null)
      : await readOfficialClock(deps, context.workspace_id, reference.period.employer.cnpj))
      : await readInformationalClock(deps) };
}

/** Relógio visual de quem consulta Ponto sem poder bater; nunca participa de uma marcação. */
async function readInformationalClock(deps: Dependencies) {
  return readPilotClock(deps, 'America/Belem');
}

async function readPilotClock(deps: Dependencies, timeZone: string | null) {
  if (!timeZone || !isBrazilTimeZone(timeZone)) return { available: false as const, issue: 'REP_P_PILOT_UNIT_TIME_ZONE_MISSING' };
  try {
    const reading = await deps.clock.read();
    assertTrustedRepPClockReading(reading);
    return { available: true as const, instant: reading.instant.toISOString(), timeZone };
  } catch (cause) {
    return { available: false as const, issue: cause instanceof AppError ? cause.code : 'REP_P_TIME_UNAVAILABLE' };
  }
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

/**
 * Leituras para o ajuste de ponto (PTRP), sem escrita na ARP: a batida do próprio titular no dia e o fuso do
 * estabelecimento. Ficam aqui porque só o serviço do REP-P acessa as coleções `repP_*`.
 */
export async function readOwnRepPReceiptForAdjustment(context: ServerUserContext, receiptId: string, workDate: string,
  injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  const receipt = await deps.repDb.collection(RECEIPTS).doc(receiptId).get();
  const snapshot = receipt.get('snapshot') as Partial<RepPReceiptSnapshot> | undefined;
  if (!receipt.exists || receipt.get('workspaceId') !== context.workspace_id || receipt.get('employeeId') !== context.decoded.uid
    || receipt.get('recordedDate') !== workDate || !snapshot?.nsr || !snapshot.markedAt || !snapshot.executionUnitId) return null;
  return { receiptId: receipt.id, nsr: snapshot.nsr, markedAt: snapshot.markedAt, executionUnitId: snapshot.executionUnitId };
}

export async function repPEstablishmentForEmployer(workspaceId: string, employerCnpj: string, injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  const id = establishmentKey(workspaceId, employerCnpj);
  const data = (await deps.repDb.collection(ESTABLISHMENTS).doc(id).get()).data();
  return { establishmentId: id, timeZone: typeof data?.timeZone === 'string' ? data.timeZone : null };
}

/** Owner-only auxiliary state; failure cannot undo an already committed online marking. */
export async function applyOwnRepPOfflineCycleAction(context: ServerUserContext, raw: unknown,
  injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  return applyOfflineCycleAction(context, raw, { repDb: deps.repDb, pilotDb: deps.pilotDb,
    clock: { async read() { const reading = await deps.clock.read(); assertTrustedRepPClockReading(reading); return reading; } } });
}
