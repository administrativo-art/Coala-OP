import 'server-only';

import { createHash } from 'node:crypto';

import type { Firestore } from 'firebase-admin/firestore';
import { Timestamp } from 'firebase-admin/firestore';

import { resolveEmploymentReferenceForSystem } from '@/features/dp/employment-reference/service.server';
import { configuredRepPClock } from '@/features/dp/rep-p/hlb-ntp-clock.server';
import { readOwnRepPReceiptForAdjustment, REP_P_PILOT_DAY_GUARDS, repPEstablishmentForEmployer,
  repPPilotDayGuardId } from '@/features/dp/rep-p/service.server';
import { repPMarkingTimeZone } from '@/features/dp/rep-p/time-zones';
import { repPOfficialMarkingEnabled, repPOfficialStartDate, repPPilotWorkDateAllowed } from '@/features/dp/rep-p/runtime-config';
import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { repPDbAdmin } from '@/lib/firebase-rep-p-admin';
import { AppError } from '@/lib/observability/app-error';
import { canAccessUnit } from '@/lib/unit-access';

import {
  adjustmentActHash, adjustmentPayloadDigest, aejReason, zonedFiscalTimestamp,
  type AdjustmentAct, type AdjustmentKind, type AdjustmentStatus,
} from './core';
import type { AdjustmentDecisionInput, AdjustmentMonthInput, CreateAdjustmentInput } from './schemas';
import { discardedReceiptIds, pilotTreatmentsOf } from './pilot-treatments';

export const ADJUSTMENTS = 'ptrp_adjustmentRequests';
export const PILOT_ADJUSTMENTS = 'repP_pilotAdjustmentRequests';
export const TREATMENTS = 'ptrp_treatments';
export const CLASSIFICATION_REQUESTS = 'ptrp_markingClassificationRequests';
export const CLASSIFICATIONS = 'ptrp_markingClassifications';
/** Documento da competência fechada, gravado por `closure.server.ts`. Período fechado não aceita pedido nem decisão. */
export const CLOSURES = 'ptrp_competenceClosures';
/** Auditoria de cada AEJ gerado (quem, quando, período, carimbo e versões dos fechamentos usados). */
export const AEJ_EXPORTS = 'ptrp_aejExports';
const REVIEW_LIMIT = 50;
const MONTH_LIMIT = 200;
const PILOT_MARKINGS = 'repP_pilotMarkings';

export type AdjustmentOperationRecord = {
  kind: AdjustmentKind;
  target: { receiptId: string; nsr: number; markedAt: string; executionUnitId: string } | null;
  inclusion: { markedAt: string; executionUnitId: string } | null;
};
export type PilotAdjustmentOperationRecord = {
  kind: AdjustmentKind;
  target: { receiptId: string; pilotSequence: number; markedAt: string; executionUnitId: string } | null;
  inclusion: { markedAt: string; executionUnitId: string } | null;
};
export type AdjustmentRecord = {
  id: string; workspaceId: string; employeeUid: string; employeeName: string | null; workDate: string;
  scope?: 'official';
  kind: AdjustmentKind; status: AdjustmentStatus; version: number;
  establishmentId: string; unitId: string; requestDigest?: string;
  unitIds?: string[];
  target: { receiptId: string; nsr: number; markedAt: string; executionUnitId: string } | null;
  inclusion: { markedAt: string; executionUnitId: string } | null;
  operations?: AdjustmentOperationRecord[];
  reason: string; aejReason: string;
  acts: AdjustmentAct[];
  createdAt: string; updatedAt: string; decidedAt?: string; decidedBy?: string;
};
export type PilotAdjustmentRecord = Omit<AdjustmentRecord, 'scope' | 'target' | 'operations'> & {
  scope: 'pilot';
  target: PilotAdjustmentOperationRecord['target'];
  operations?: PilotAdjustmentOperationRecord[];
};
type AnyAdjustmentRecord = AdjustmentRecord | PilotAdjustmentRecord;

type Clock = { read(): Promise<{ instant: Date }> };
type Dependencies = { mainDb: Firestore; hrDb: Firestore; repDb: Firestore; clock: Clock;
  officialMarkingEnabled: boolean; officialStartDate: string; pilotEnabled: boolean; pilotUserIds: ReadonlySet<string> };
// Sem Hora Legal configurada, o ato usa o relógio do servidor e registra essa origem.
const unavailableClock: Clock = { async read() { throw new Error('Hora Legal não configurada.'); } };
const defaults: Dependencies = { mainDb: dbAdmin, hrDb: hrDbAdmin, repDb: repPDbAdmin, clock: configuredRepPClock() ?? unavailableClock,
  officialMarkingEnabled: repPOfficialMarkingEnabled(), officialStartDate: repPOfficialStartDate(),
  pilotEnabled: process.env.REP_P_PILOT_ENABLED === 'true',
  pilotUserIds: new Set((process.env.REP_P_PILOT_USER_IDS ?? '').split(',').map((value) => value.trim()).filter(Boolean)) };

function fail(code: string, safeMessage: string, kind: 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT' | 'AUTHORIZATION' = 'VALIDATION') {
  return new AppError({ code, kind, safeMessage });
}
function digest(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

/** Instante do ato pela Hora Legal; se a fonte estiver fora, usa o relógio do servidor e registra a origem. */
export async function actInstant(clock: Clock) {
  try {
    const reading = await clock.read();
    return { at: reading.instant.toISOString(), clockSource: 'hora_legal' as const };
  } catch {
    return { at: new Date().toISOString(), clockSource: 'server' as const };
  }
}

export function closureKey(workspaceId: string, workDate: string) { return `${workspaceId}_${workDate.slice(0, 7)}`; }

async function assertOpenCompetence(hrDb: Firestore, workspaceId: string, workDate: string) {
  const closure = await hrDb.collection(CLOSURES).doc(closureKey(workspaceId, workDate)).get();
  if (closure.exists && closure.get('status') === 'closed') {
    throw fail('PTRP_COMPETENCE_CLOSED', 'Esta competência já foi fechada; não aceita pedido de ajuste.', 'CONFLICT');
  }
}

async function hasActiveDiscard(hrDb: Firestore, workspaceId: string, receiptId: string) {
  const found = await hrDb.collection(TREATMENTS).where('workspaceId', '==', workspaceId).where('originalReceiptId', '==', receiptId)
    .where('status', '==', 'active').limit(1).get();
  return !found.empty;
}

function pilotMarkingsOnDay(repDb: Firestore, workspaceId: string, employeeUid: string, workDate: string) {
  return repDb.collection(PILOT_MARKINGS).where('workspaceId', '==', workspaceId)
    .where('employeeId', '==', employeeUid).where('recordedDate', '==', workDate).limit(1);
}

function officialMarkingsOnDay(repDb: Firestore, workspaceId: string, employeeUid: string, workDate: string) {
  return repDb.collection('repP_receipts').where('workspaceId', '==', workspaceId)
    .where('employeeId', '==', employeeUid).where('recordedDate', '==', workDate).limit(1);
}

function guardReservesPilotDomain(snapshot: FirebaseFirestore.DocumentSnapshot) {
  return snapshot.exists && snapshot.get('domain') !== 'adjustment';
}

async function assertNoPilotMarkingForDay(repDb: Firestore, workspaceId: string, employeeUid: string, workDate: string) {
  if (!(await pilotMarkingsOnDay(repDb, workspaceId, employeeUid, workDate).get()).empty) {
    throw fail('PTRP_PILOT_DAY_ADJUSTMENT_FORBIDDEN',
      'Batidas de ensaio não aceitam ajuste formal. Altere somente a classificação da batida.', 'CONFLICT');
  }
}

export function canReview(context: ServerUserContext) {
  return context.isDefaultAdmin || context.permissions.dp?.requests?.review === true;
}

export function adjustmentDto(value: AnyAdjustmentRecord) {
  const { aejReason: _aej, ...rest } = value;
  void _aej;
  return { ...rest, scope: value.scope ?? 'official' };
}

function timestampIso(value: unknown) {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  return typeof value === 'string' ? value : new Date(0).toISOString();
}

function classificationRequestDto(document: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot) {
  const value = document.data()!;
  return { id: document.id, employeeId: String(value.employeeId), employeeName: typeof value.employeeName === 'string' ? value.employeeName : null,
    receiptId: String(value.receiptId), workDate: String(value.workDate), markedAt: String(value.markedAt), nsr: Number(value.nsr),
    unitId: String(value.unitId), closureVersion: Number(value.closureVersion), version: Number(value.version),
    requestedPurpose: value.requestedPurpose, currentClassification: value.currentClassification ?? null, status: value.status,
    createdAt: timestampIso(value.createdAt), updatedAt: timestampIso(value.updatedAt) };
}

export function adjustmentOperations(value: Pick<AdjustmentRecord, 'kind' | 'target' | 'inclusion' | 'operations'>): AdjustmentOperationRecord[] {
  return value.operations?.length ? value.operations : [{ kind: value.kind, target: value.target, inclusion: value.inclusion }];
}
function pilotAdjustmentOperations(
  value: Pick<PilotAdjustmentRecord, 'kind' | 'target' | 'inclusion' | 'operations'>,
): PilotAdjustmentOperationRecord[] {
  return value.operations?.length ? value.operations : [{ kind: value.kind, target: value.target, inclusion: value.inclusion }];
}

type CompatibleAdjustmentInput = CreateAdjustmentInput | {
  attemptId: string; workDate: string; kind: AdjustmentKind; targetReceiptId?: string; newTime?: string; executionUnitId?: string; reason: string;
  scope?: 'official' | 'pilot';
};
function inputOperations(input: CompatibleAdjustmentInput) {
  return 'operations' in input ? input.operations : [{ kind: input.kind,
    ...(input.targetReceiptId ? { targetReceiptId: input.targetReceiptId } : {}), ...(input.newTime ? { newTime: input.newTime } : {}),
    ...(input.executionUnitId ? { executionUnitId: input.executionUnitId } : {}) }];
}
function comparableOperations(value: AdjustmentRecord) {
  return adjustmentOperations(value).map((item) => ({ kind: item.kind, targetReceiptId: item.target?.receiptId ?? null,
    newTime: item.inclusion?.markedAt.slice(11, 16) ?? null, executionUnitId: item.inclusion?.executionUnitId ?? null }));
}

function assertPilotAdjustmentAccess(context: ServerUserContext, deps: Dependencies) {
  if (deps.officialMarkingEnabled || !deps.pilotEnabled || !deps.pilotUserIds.has(context.decoded.uid)
    || context.permissions.app.timeRecording?.mark !== true) {
    throw fail('REP_P_PILOT_ADJUSTMENT_FORBIDDEN', 'A simulação de ajuste está disponível somente para participantes do ensaio.', 'AUTHORIZATION');
  }
}

async function resolveAdjustmentDomain(context: ServerUserContext, input: CompatibleAdjustmentInput, deps: Dependencies) {
  const pilotParticipant = !deps.officialMarkingEnabled && deps.pilotEnabled
    && deps.pilotUserIds.has(context.decoded.uid) && context.permissions.app.timeRecording?.mark === true;
  if (input.scope !== 'pilot' && !pilotParticipant) return 'official' as const;
  const guardRef = deps.hrDb.collection(REP_P_PILOT_DAY_GUARDS)
    .doc(repPPilotDayGuardId(context.workspace_id, context.decoded.uid, input.workDate));
  const [guard, pilotMarkings, officialMarkings] = await Promise.all([
    guardRef.get(), pilotMarkingsOnDay(deps.hrDb, context.workspace_id, context.decoded.uid, input.workDate).get(),
    officialMarkingsOnDay(deps.repDb, context.workspace_id, context.decoded.uid, input.workDate).get(),
  ]);
  const pilotEvidence = !pilotMarkings.empty || guard.get('domain') === 'pilot';
  const officialEvidence = !officialMarkings.empty || guard.get('domain') === 'adjustment';
  if (pilotEvidence && officialEvidence) {
    throw fail('REP_P_ADJUSTMENT_DAY_DOMAIN_CONFLICT', 'O domínio deste dia está inconsistente e precisa de conferência técnica.', 'CONFLICT');
  }
  if (officialEvidence) {
    if (input.scope === 'pilot') {
      throw fail('REP_P_PILOT_ADJUSTMENT_DAY_FORBIDDEN', 'Este dia pertence ao fluxo oficial e não aceita simulação.', 'CONFLICT');
    }
    return 'official' as const;
  }
  if (pilotEvidence || pilotParticipant) return 'pilot' as const;
  return input.scope === 'pilot' ? 'pilot' as const : 'official' as const;
}

async function readOwnPilotMarkingForAdjustment(context: ServerUserContext, receiptId: string, workDate: string, deps: Dependencies) {
  const marking = await deps.hrDb.collection(PILOT_MARKINGS).doc(receiptId).get();
  if (!marking.exists || marking.get('workspaceId') !== context.workspace_id || marking.get('employeeId') !== context.decoded.uid
    || marking.get('recordedDate') !== workDate || !marking.get('markedAt') || !marking.get('executionUnitId')) return null;
  const pilotSequence = Number(marking.get('sequence'));
  if (!Number.isSafeInteger(pilotSequence) || pilotSequence < 1) return null;
  return { receiptId: marking.id, pilotSequence,
    markedAt: String(marking.get('markedAt')), executionUnitId: String(marking.get('executionUnitId')) };
}

/** Simulação isolada: exercita pedido e decisão, mas nunca cria tratamento nem entra no PTRP/fechamento. */
async function createOwnPilotAdjustment(context: ServerUserContext, input: CompatibleAdjustmentInput, deps: Dependencies) {
  assertPilotAdjustmentAccess(context, deps);
  if (!repPPilotWorkDateAllowed(input.workDate, deps.officialStartDate)) {
    throw fail('REP_P_PILOT_CUTOVER_REACHED', 'A simulação não aceita datas do período oficial.', 'CONFLICT');
  }
  if (!(await officialMarkingsOnDay(deps.repDb, context.workspace_id, context.decoded.uid, input.workDate).get()).empty) {
    throw fail('REP_P_PILOT_ADJUSTMENT_DAY_FORBIDDEN', 'Este dia possui registro oficial e não aceita simulação.', 'CONFLICT');
  }
  const requestedOperations = inputOperations(input);
  const requestDigest = digest({ scope: 'pilot', workDate: input.workDate, operations: requestedOperations, reason: input.reason });
  const docId = digest(['pilot-adjustment', context.workspace_id, context.decoded.uid, input.attemptId]);
  const ref = deps.hrDb.collection(PILOT_ADJUSTMENTS).doc(docId);
  const existing = await ref.get();
  if (existing.exists) {
    const stored = existing.data() as PilotAdjustmentRecord;
    if (stored.employeeUid !== context.decoded.uid || stored.requestDigest !== requestDigest) {
      throw fail('PTRP_ADJUSTMENT_ATTEMPT_CONFLICT', 'Tentativa reutilizada com conteúdo diferente.', 'CONFLICT');
    }
    return adjustmentDto(stored);
  }
  const reference = await resolveEmploymentReferenceForSystem({ workspaceId: context.workspace_id,
    userId: context.decoded.uid, date: input.workDate, database: deps.mainDb });
  if (reference.status !== 'matched') throw fail('PTRP_EMPLOYMENT_UNRESOLVED', 'Não há vínculo válido para a data do ajuste.');

  const operations: PilotAdjustmentOperationRecord[] = [];
  for (const item of requestedOperations) {
    let target: PilotAdjustmentOperationRecord['target'] = null;
    if ('targetReceiptId' in item && item.targetReceiptId) {
      target = await readOwnPilotMarkingForAdjustment(context, item.targetReceiptId, input.workDate, deps);
      if (!target) throw fail('REP_P_PILOT_ADJUSTMENT_TARGET_INVALID', 'Batida do ensaio não encontrada neste dia.', 'NOT_FOUND');
    }
    let inclusion: PilotAdjustmentOperationRecord['inclusion'] = null;
    if ('newTime' in item && item.newTime) {
      const unitId = ('executionUnitId' in item ? item.executionUnitId : null) ?? target?.executionUnitId ?? reference.period.employerUnitId;
      if (!reference.period.unitIds.includes(unitId)) {
        throw fail('PTRP_ADJUSTMENT_UNIT_OUTSIDE_EMPLOYMENT', 'A unidade não pertence ao vínculo nesta data.', 'AUTHORIZATION');
      }
      const unit = await deps.mainDb.collection('dp_units').doc(unitId).get();
      if (!unit.exists) throw fail('PTRP_ADJUSTMENT_UNIT_NOT_FOUND', 'Unidade não encontrada.', 'NOT_FOUND');
      const zone = repPMarkingTimeZone(unit.get('timeZone'), 'America/Fortaleza');
      inclusion = { markedAt: zonedFiscalTimestamp(input.workDate, item.newTime, zone), executionUnitId: unitId };
      if (Date.parse(inclusion.markedAt.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')) > Date.now()) {
        throw fail('PTRP_ADJUSTMENT_FUTURE', 'Não é possível incluir um horário que ainda não aconteceu.');
      }
    }
    operations.push({ kind: item.kind, target, inclusion });
  }

  const pending = await deps.hrDb.collection(PILOT_ADJUSTMENTS).where('workspaceId', '==', context.workspace_id)
    .where('employeeUid', '==', context.decoded.uid).where('workDate', '==', input.workDate).where('status', '==', 'in_review').limit(10).get();
  const targetIds = new Set(operations.map((item) => item.target?.receiptId).filter((value): value is string => Boolean(value)));
  if (pending.docs.some((doc) => pilotAdjustmentOperations(doc.data() as PilotAdjustmentRecord)
    .some((item) => item.target?.receiptId && targetIds.has(item.target.receiptId)))) {
    throw fail('PTRP_ADJUSTMENT_DUPLICATE', 'Já existe uma simulação em análise para esta batida.', 'CONFLICT');
  }

  const { at, clockSource } = await actInstant(deps.clock);
  const kind = operations[0].kind;
  const target = operations.length === 1 ? operations[0].target : null;
  const inclusion = operations.length === 1 ? operations[0].inclusion : null;
  const payload = { scope: 'pilot', kind, workDate: input.workDate, operations, reason: input.reason };
  const firstAct = { action: 'requested' as const, actorUid: context.decoded.uid, role: 'titular' as const, at, clockSource };
  const unitIds = [...new Set(operations.flatMap((operation) => [operation.target?.executionUnitId, operation.inclusion?.executionUnitId])
    .filter((unitId): unitId is string => Boolean(unitId)))];
  const value: PilotAdjustmentRecord & { requestDigest: string } = {
    id: docId, scope: 'pilot', workspaceId: context.workspace_id, employeeUid: context.decoded.uid,
    employeeName: typeof context.userDoc.username === 'string' ? context.userDoc.username.slice(0, 120) : null,
    workDate: input.workDate, kind, status: 'in_review', version: 1, establishmentId: 'pilot', requestDigest,
    unitId: unitIds[0] ?? reference.period.employerUnitId, unitIds: unitIds.length ? unitIds : [reference.period.employerUnitId],
    target, inclusion, operations, reason: input.reason, aejReason: '',
    acts: [{ ...firstAct, previousHash: null, hash: adjustmentActHash(null, firstAct, adjustmentPayloadDigest(payload)) }],
    createdAt: at, updatedAt: at,
  };
  const saved = await deps.hrDb.runTransaction(async (tx) => {
    const dayGuardRef = deps.hrDb.collection(REP_P_PILOT_DAY_GUARDS)
      .doc(repPPilotDayGuardId(context.workspace_id, context.decoded.uid, input.workDate));
    const [again, dayGuard] = await Promise.all([tx.get(ref), tx.get(dayGuardRef)]);
    if (again.exists) {
      const stored = again.data() as PilotAdjustmentRecord;
      if (stored.employeeUid === context.decoded.uid && stored.requestDigest === requestDigest) return stored;
      throw fail('PTRP_ADJUSTMENT_ATTEMPT_CONFLICT', 'Pedido já registrado.', 'CONFLICT');
    }
    if (dayGuard.exists && dayGuard.get('domain') !== 'pilot') {
      throw fail('REP_P_PILOT_ADJUSTMENT_DAY_FORBIDDEN', 'Este dia pertence ao fluxo oficial e não aceita simulação.', 'CONFLICT');
    }
    tx.set(dayGuardRef, { schemaVersion: 1, mode: 'pilot', domain: 'pilot', workspaceId: context.workspace_id,
      employeeId: context.decoded.uid, workDate: input.workDate, updatedAt: Timestamp.fromDate(new Date(at)) }, { merge: true });
    tx.create(ref, value);
    return value;
  });
  return adjustmentDto(saved);
}

/** Pedido do próprio titular: valida vínculo, batida alvo e competência aberta; grava o primeiro ato encadeado. */
export async function createOwnAdjustment(context: ServerUserContext, input: CompatibleAdjustmentInput, injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  if (await resolveAdjustmentDomain(context, input, deps) === 'pilot') return createOwnPilotAdjustment(context, input, deps);
  await assertNoPilotMarkingForDay(deps.hrDb, context.workspace_id, context.decoded.uid, input.workDate);
  const requestedOperations = inputOperations(input);
  const requestDigest = digest({ workDate: input.workDate, operations: requestedOperations, reason: input.reason });
  const docId = digest(['adjustment', context.workspace_id, context.decoded.uid, input.attemptId]);
  const ref = deps.hrDb.collection(ADJUSTMENTS).doc(docId);
  const existing = await ref.get();
  if (existing.exists) {
    const stored = existing.data() as AdjustmentRecord;
    const comparableInput = requestedOperations.map((item) => ({ kind: item.kind,
      targetReceiptId: 'targetReceiptId' in item ? item.targetReceiptId : null,
      newTime: 'newTime' in item ? item.newTime : null,
      executionUnitId: 'executionUnitId' in item ? item.executionUnitId ?? null : null }));
    if (stored.employeeUid !== context.decoded.uid || (stored.requestDigest
      ? stored.requestDigest !== requestDigest
      : stored.workDate !== input.workDate || stored.reason !== input.reason
        || JSON.stringify(comparableOperations(stored)) !== JSON.stringify(comparableInput))) {
      throw fail('PTRP_ADJUSTMENT_ATTEMPT_CONFLICT', 'Tentativa reutilizada com conteúdo diferente.', 'CONFLICT');
    }
    return adjustmentDto(stored);
  }
  await assertOpenCompetence(deps.hrDb, context.workspace_id, input.workDate);
  const reference = await resolveEmploymentReferenceForSystem({ workspaceId: context.workspace_id,
    userId: context.decoded.uid, date: input.workDate, database: deps.mainDb });
  if (reference.status !== 'matched') throw fail('PTRP_EMPLOYMENT_UNRESOLVED', 'Não há vínculo válido para a data do ajuste.');

  const establishment = await repPEstablishmentForEmployer(context.workspace_id, reference.period.employer.cnpj, { repDb: deps.repDb });
  const operations: AdjustmentOperationRecord[] = [];
  for (const item of requestedOperations) {
    let target: AdjustmentOperationRecord['target'] = null;
    if ('targetReceiptId' in item && item.targetReceiptId) {
      target = await readOwnRepPReceiptForAdjustment(context, item.targetReceiptId, input.workDate, { repDb: deps.repDb });
      if (!target) throw fail('PTRP_ADJUSTMENT_TARGET_INVALID', 'Batida não encontrada neste dia.', 'NOT_FOUND');
    }
    let inclusion: AdjustmentOperationRecord['inclusion'] = null;
    if ('newTime' in item && item.newTime) {
      const unitId = ('executionUnitId' in item ? item.executionUnitId : null) ?? target?.executionUnitId ?? reference.period.employerUnitId;
      if (!reference.period.unitIds.includes(unitId)) {
        throw fail('PTRP_ADJUSTMENT_UNIT_OUTSIDE_EMPLOYMENT', 'A unidade não pertence ao vínculo nesta data.', 'AUTHORIZATION');
      }
      const unit = await deps.mainDb.collection('dp_units').doc(unitId).get();
      const zone = repPMarkingTimeZone(unit.get('timeZone'), establishment.timeZone ?? 'America/Fortaleza');
      inclusion = { markedAt: zonedFiscalTimestamp(input.workDate, item.newTime, zone), executionUnitId: unitId };
      if (Date.parse(inclusion.markedAt.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')) > Date.now()) {
        throw fail('PTRP_ADJUSTMENT_FUTURE', 'Não é possível incluir um horário que ainda não aconteceu.');
      }
    }
    operations.push({ kind: item.kind, target, inclusion });
  }

  const pending = await deps.hrDb.collection(ADJUSTMENTS).where('workspaceId', '==', context.workspace_id)
    .where('employeeUid', '==', context.decoded.uid).where('workDate', '==', input.workDate).where('status', '==', 'in_review').limit(10).get();
  const targetIds = new Set(operations.map((item) => item.target?.receiptId).filter((value): value is string => Boolean(value)));
  if (pending.docs.some((doc) => adjustmentOperations(doc.data() as AdjustmentRecord).some((item) => item.target?.receiptId && targetIds.has(item.target.receiptId)))) {
    throw fail('PTRP_ADJUSTMENT_DUPLICATE', 'Já existe um pedido em análise para esta batida.', 'CONFLICT');
  }
  for (const targetId of targetIds) {
    if (await hasActiveDiscard(deps.hrDb, context.workspace_id, targetId)) {
      throw fail('PTRP_ADJUSTMENT_ALREADY_TREATED', 'Esta batida já foi desconsiderada por um ajuste aprovado.', 'CONFLICT');
    }
  }

  const { at, clockSource } = await actInstant(deps.clock);
  const kind = operations[0].kind;
  const target = operations.length === 1 ? operations[0].target : null;
  const inclusion = operations.length === 1 ? operations[0].inclusion : null;
  const payload = { kind, workDate: input.workDate, operations, reason: input.reason };
  const firstAct = { action: 'requested' as const, actorUid: context.decoded.uid, role: 'titular' as const, at, clockSource };
  const unitIds = [...new Set(operations.flatMap((operation) => [operation.target?.executionUnitId, operation.inclusion?.executionUnitId])
    .filter((unitId): unitId is string => Boolean(unitId)))];
  const value: AdjustmentRecord & { requestDigest: string } = {
    id: docId, workspaceId: context.workspace_id, employeeUid: context.decoded.uid,
    employeeName: typeof context.userDoc.username === 'string' ? context.userDoc.username.slice(0, 120) : null,
    workDate: input.workDate, kind, status: 'in_review', version: 1,
    establishmentId: establishment.establishmentId, requestDigest,
    unitId: unitIds[0] ?? reference.period.employerUnitId, unitIds: unitIds.length ? unitIds : [reference.period.employerUnitId],
    target, inclusion, operations, reason: input.reason, aejReason: aejReason(input.reason),
    acts: [{ ...firstAct, previousHash: null, hash: adjustmentActHash(null, firstAct, adjustmentPayloadDigest(payload)) }],
    createdAt: at, updatedAt: at,
  };
  const saved = await deps.hrDb.runTransaction(async (tx) => {
    const pilotQuery = pilotMarkingsOnDay(deps.hrDb, context.workspace_id, context.decoded.uid, input.workDate);
    const pilotDayGuard = deps.hrDb.collection(REP_P_PILOT_DAY_GUARDS)
      .doc(repPPilotDayGuardId(context.workspace_id, context.decoded.uid, input.workDate));
    const [again, closure, pilotMarkings, pilotGuard] = await Promise.all([
      tx.get(ref),
      tx.get(deps.hrDb.collection(CLOSURES).doc(closureKey(context.workspace_id, input.workDate))),
      tx.get(pilotQuery),
      tx.get(pilotDayGuard),
    ]);
    if (again.exists) {
      const stored = again.data() as AdjustmentRecord;
      if (stored.workspaceId === context.workspace_id && stored.employeeUid === context.decoded.uid
        && stored.requestDigest === requestDigest) return stored;
      throw fail('PTRP_ADJUSTMENT_ATTEMPT_CONFLICT', 'Pedido já registrado.', 'CONFLICT');
    }
    if (closure.exists && closure.get('status') === 'closed') throw fail('PTRP_COMPETENCE_CLOSED', 'Esta competência já foi fechada; não aceita pedido de ajuste.', 'CONFLICT');
    if (!pilotMarkings.empty || guardReservesPilotDomain(pilotGuard)) {
      throw fail('PTRP_PILOT_DAY_ADJUSTMENT_FORBIDDEN',
        'Batidas de ensaio não aceitam ajuste formal. Altere somente a classificação da batida.', 'CONFLICT');
    }
    tx.set(pilotDayGuard, { schemaVersion: 1, mode: 'exclusion', domain: 'adjustment',
      workspaceId: context.workspace_id, employeeId: context.decoded.uid, workDate: input.workDate,
      updatedAt: Timestamp.fromDate(new Date(at)) }, { merge: true });
    tx.create(ref, value);
    return value;
  });
  return adjustmentDto(saved);
}

/** Pedidos e tratamentos do próprio titular no mês, para o Registro de ponto. */
export async function listOwnAdjustments(context: ServerUserContext, input: AdjustmentMonthInput, injected: Partial<Dependencies> = {}) {
  return listAdjustmentsOfPerson(context.workspace_id, context.decoded.uid, input, injected);
}

/** Pedidos e tratamentos mensais de uma pessoa já autorizada pelo chamador. */
export async function listAdjustmentsOfPerson(workspaceId: string, employeeUid: string, input: AdjustmentMonthInput, injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  const start = `${input.month}-01`;
  const end = `${input.month}-31`;
  const [requests, pilotRequests, treatments] = await Promise.all([
    deps.hrDb.collection(ADJUSTMENTS).where('workspaceId', '==', workspaceId).where('employeeUid', '==', employeeUid)
      .where('workDate', '>=', start).where('workDate', '<=', end).orderBy('workDate').limit(MONTH_LIMIT).get(),
    deps.hrDb.collection(PILOT_ADJUSTMENTS).where('workspaceId', '==', workspaceId).where('employeeUid', '==', employeeUid)
      .where('workDate', '>=', start).where('workDate', '<=', end).orderBy('workDate').limit(MONTH_LIMIT).get(),
    deps.hrDb.collection(TREATMENTS).where('workspaceId', '==', workspaceId).where('employeeUid', '==', employeeUid)
      .where('workDate', '>=', start).where('workDate', '<=', end).orderBy('workDate').limit(MONTH_LIMIT * 2).get(),
  ]);
  const pilotRecords = pilotRequests.docs.map((doc) => doc.data() as PilotAdjustmentRecord);
  return {
    month: input.month,
    adjustments: [
      ...requests.docs.map((doc) => adjustmentDto(doc.data() as AdjustmentRecord)),
      ...pilotRequests.docs.map((doc) => adjustmentDto(doc.data() as PilotAdjustmentRecord)),
    ]
      .sort((left, right) => left.workDate.localeCompare(right.workDate) || left.createdAt.localeCompare(right.createdAt)).slice(0, MONTH_LIMIT),
    treatments: treatments.docs.filter((doc) => doc.get('status') === 'active').map((doc) => ({
      id: doc.id, adjustmentId: String(doc.get('adjustmentId')), workDate: String(doc.get('workDate')),
      type: doc.get('type') as 'discard' | 'inclusion', originalReceiptId: (doc.get('originalReceiptId') as string | null) ?? null,
      markedAt: (doc.get('markedAt') as string | null) ?? null, executionUnitId: (doc.get('executionUnitId') as string | null) ?? null,
    })).concat(pilotTreatmentsOf(pilotRecords)),
  };
}

// Leituras do dia de um pedido para a análise (só consulta). Ficam aqui porque tocam as coleções protegidas do ponto
// (repP_ e ptrp_), que só os serviços delimitados podem citar (tests/unit/dp-rep-p-arp-deletion-guard.test.ts).
export const DAY_MARKINGS_LIMIT = 40;
const DAY_TREATMENTS_LIMIT = 40;
const DAY_HISTORY_LIMIT = 60;
type DayReadDeps = Pick<Dependencies, 'hrDb' | 'repDb'>;

/** Pedido pelo id, oficial ou da simulação do ensaio. */
export async function readAdjustmentRequestForDay(deps: DayReadDeps, adjustmentId: string) {
  const official = await deps.hrDb.collection(ADJUSTMENTS).doc(adjustmentId).get();
  if (official.exists) return { scope: 'official' as const, snapshot: official };
  return { scope: 'pilot' as const, snapshot: await deps.hrDb.collection(PILOT_ADJUSTMENTS).doc(adjustmentId).get() };
}

/**
 * Batidas do dia da pessoa: oficiais (banco do REP-P) para o pedido oficial, do ensaio (banco coala-rh, como em
 * `readOwnPilotMarkingForAdjustment`) para a simulação, nunca as duas.
 */
export function readDayMarkingDocuments(deps: DayReadDeps, scope: 'official' | 'pilot', workspaceId: string, employeeUid: string, workDate: string) {
  const database = scope === 'pilot' ? deps.hrDb : deps.repDb;
  return database.collection(scope === 'pilot' ? PILOT_MARKINGS : 'repP_receipts').where('workspaceId', '==', workspaceId)
    .where('employeeId', '==', employeeUid).where('recordedDate', '==', workDate).limit(DAY_MARKINGS_LIMIT + 1).get();
}

/** Tratamentos oficiais do dia. O ensaio não grava tratamento: o do ensaio é derivado dos pedidos aprovados (`pilot-treatments.ts`). */
export function readDayTreatmentDocuments(deps: DayReadDeps, workspaceId: string, employeeUid: string, workDate: string) {
  return deps.hrDb.collection(TREATMENTS).where('workspaceId', '==', workspaceId).where('employeeUid', '==', employeeUid)
    .where('workDate', '==', workDate).limit(DAY_TREATMENTS_LIMIT).get();
}

/** Pedidos recentes da pessoa (oficiais e do ensaio) até o dia, pelo mesmo índice da lista mensal. */
export function readAdjustmentHistoryDocuments(deps: DayReadDeps, workspaceId: string, employeeUid: string, fromDate: string, toDate: string) {
  const query = (collection: string) => deps.hrDb.collection(collection).where('workspaceId', '==', workspaceId).where('employeeUid', '==', employeeUid)
    .where('workDate', '>=', fromDate).where('workDate', '<=', toDate).orderBy('workDate').limit(DAY_HISTORY_LIMIT).get();
  return Promise.all([query(ADJUSTMENTS), query(PILOT_ADJUSTMENTS)]);
}

/** Fila de quem analisa: em análise, nas unidades acessíveis, sem os próprios pedidos. */
export async function listAdjustmentsForReview(context: ServerUserContext, injected: Partial<Dependencies> = {}) {
  if (!canReview(context)) throw fail('PTRP_ADJUSTMENT_REVIEW_FORBIDDEN', 'Sem permissão para analisar ajustes de ponto.', 'AUTHORIZATION');
  const deps = { ...defaults, ...injected };
  // Pagina até achar 50 visíveis (ou ler 500): pedidos de unidades inacessíveis não escondem os acessíveis.
  const base = deps.hrDb.collection(ADJUSTMENTS).where('workspaceId', '==', context.workspace_id)
    .where('status', '==', 'in_review').orderBy('createdAt', 'asc');
  const visible: AdjustmentRecord[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  for (let scanned = 0; visible.length < REVIEW_LIMIT && scanned < REVIEW_LIMIT * 10;) {
    const page: FirebaseFirestore.QuerySnapshot = await (cursor ? base.startAfter(cursor) : base).limit(REVIEW_LIMIT).get();
    scanned += page.size;
    for (const doc of page.docs) {
      const value = doc.data() as AdjustmentRecord;
      const units = value.unitIds?.length ? value.unitIds : [value.unitId];
      if (value.employeeUid !== context.decoded.uid
        && units.every((unitId) => canAccessUnit(context.userDoc, unitId, { isDefaultAdmin: context.isDefaultAdmin }))) {
        visible.push(value);
      }
    }
    if (page.size < REVIEW_LIMIT) break;
    cursor = page.docs[page.docs.length - 1];
  }
  const classificationSnapshot = await deps.hrDb.collection(CLASSIFICATION_REQUESTS).where('workspaceId', '==', context.workspace_id)
    .where('status', '==', 'in_review').orderBy('createdAt', 'asc').limit(REVIEW_LIMIT * 2).get();
  const classificationRequests = classificationSnapshot.docs.filter((document) => {
    const value = document.data();
    return value.employeeId !== context.decoded.uid && canAccessUnit(context.userDoc, String(value.unitId), { isDefaultAdmin: context.isDefaultAdmin });
  }).slice(0, REVIEW_LIMIT).map(classificationRequestDto);
  const pilotSnapshot = await deps.hrDb.collection(PILOT_ADJUSTMENTS).where('workspaceId', '==', context.workspace_id)
    .where('status', '==', 'in_review').orderBy('createdAt', 'asc').limit(REVIEW_LIMIT * 10).get();
  const pilotVisible = pilotSnapshot.docs.map((document) => document.data() as PilotAdjustmentRecord).filter((value) => {
    const units = value.unitIds?.length ? value.unitIds : [value.unitId];
    return value.employeeUid !== context.decoded.uid
      && units.every((unitId) => canAccessUnit(context.userDoc, unitId, { isDefaultAdmin: context.isDefaultAdmin }));
  });
  const adjustments = [...visible, ...pilotVisible].sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(0, REVIEW_LIMIT).map(adjustmentDto);
  return { adjustments, classificationRequests };
}

async function decideClassificationRequest(context: ServerUserContext, requestId: string, input: AdjustmentDecisionInput,
  deps: Dependencies) {
  const ref = deps.hrDb.collection(CLASSIFICATION_REQUESTS).doc(requestId);
  const before = await ref.get();
  if (!before.exists || before.get('workspaceId') !== context.workspace_id) throw fail('PTRP_ADJUSTMENT_NOT_FOUND', 'Pedido não encontrado.', 'NOT_FOUND');
  const owner = before.get('employeeId') === context.decoded.uid;
  if (input.action === 'cancel') {
    if (!owner) throw fail('PTRP_ADJUSTMENT_FORBIDDEN', 'Só o titular cancela o próprio pedido.', 'AUTHORIZATION');
  } else if (owner || !canReview(context) || !canAccessUnit(context.userDoc, String(before.get('unitId')), { isDefaultAdmin: context.isDefaultAdmin })) {
    throw fail(owner ? 'PTRP_ADJUSTMENT_SELF_DECISION' : 'PTRP_ADJUSTMENT_REVIEW_FORBIDDEN',
      owner ? 'Quem pediu não pode decidir o próprio ajuste.' : 'Sem permissão para decidir este ajuste.', 'AUTHORIZATION');
  }
  const status = input.action === 'approve' ? 'approved' : input.action === 'reject' ? 'rejected' : 'cancelled';
  const now = Timestamp.now();
  const receiptId = String(before.get('receiptId'));
  const receipt = await deps.repDb.collection('repP_receipts').doc(receiptId).get();
  if (!receipt.exists || receipt.get('workspaceId') !== context.workspace_id
    || receipt.get('employeeId') !== before.get('employeeId')) {
    throw fail('REP_P_MARKING_NOT_FOUND', 'Batida não encontrada.', 'NOT_FOUND');
  }
  const classificationRef = deps.hrDb.collection(CLASSIFICATIONS).doc(receiptId);
  const closureRef = deps.hrDb.collection(CLOSURES).doc(closureKey(context.workspace_id, String(before.get('workDate'))));
  const result = await deps.hrDb.runTransaction(async (tx) => {
    const [requestSnapshot, classificationSnapshot, closureSnapshot] = await Promise.all([
      tx.get(ref), tx.get(classificationRef), tx.get(closureRef),
    ]);
    if (!requestSnapshot.exists || requestSnapshot.get('status') !== 'in_review') throw fail('PTRP_ADJUSTMENT_NOT_PENDING', 'Este pedido já foi decidido.', 'CONFLICT');
    if (Number(requestSnapshot.get('version')) !== input.expectedVersion) throw fail('PTRP_ADJUSTMENT_VERSION_CONFLICT', 'O pedido mudou. Atualize e tente de novo.', 'CONFLICT');
    if (status === 'approved') {
      if (!closureSnapshot.exists || closureSnapshot.get('status') !== 'closed'
        || Number(closureSnapshot.get('version')) !== Number(requestSnapshot.get('closureVersion'))) {
        throw fail('PTRP_CLASSIFICATION_CLOSURE_CHANGED', 'O fechamento mudou desde este pedido. Atualize a classificação e envie uma nova solicitação.', 'CONFLICT');
      }
      const classification = { purpose: requestSnapshot.get('requestedPurpose'), source: 'reviewed', status: 'confirmed',
        updatedAt: now, updatedBy: context.decoded.uid };
      const current = classificationSnapshot.get('classification') ?? receipt.get('classification');
      if (current?.purpose !== requestSnapshot.get('requestedPurpose')) {
        const history = Array.isArray(classificationSnapshot.get('history')) ? classificationSnapshot.get('history') as unknown[] : [];
        tx.set(classificationRef, { schemaVersion: 1, workspaceId: context.workspace_id,
          employeeId: requestSnapshot.get('employeeId'), receiptId, workDate: requestSnapshot.get('workDate'),
          classification, history: [...history.slice(-99), { ...classification, at: now,
            actorUid: context.decoded.uid, requestId }], updatedAt: now }, { merge: true });
      }
    }
    tx.update(ref, { status, version: input.expectedVersion + 1, updatedAt: now, decidedAt: now,
      decidedBy: context.decoded.uid, decisionReason: 'reason' in input ? input.reason : null });
    return { ...classificationRequestDto(requestSnapshot), status, version: input.expectedVersion + 1, updatedAt: now.toDate().toISOString() };
  });
  return result;
}

async function decidePilotAdjustment(context: ServerUserContext, adjustmentId: string, input: AdjustmentDecisionInput, deps: Dependencies) {
  const ref = deps.hrDb.collection(PILOT_ADJUSTMENTS).doc(adjustmentId);
  const before = await ref.get();
  if (!before.exists || before.get('workspaceId') !== context.workspace_id) {
    throw fail('PTRP_ADJUSTMENT_NOT_FOUND', 'Pedido não encontrado.', 'NOT_FOUND');
  }
  const current = before.data() as PilotAdjustmentRecord;
  const isOwner = current.employeeUid === context.decoded.uid;
  if (input.action === 'cancel') {
    if (!isOwner) throw fail('PTRP_ADJUSTMENT_FORBIDDEN', 'Só o titular cancela o próprio pedido.', 'AUTHORIZATION');
  } else {
    if (isOwner) throw fail('PTRP_ADJUSTMENT_SELF_DECISION', 'Quem pediu não pode decidir o próprio ajuste.', 'AUTHORIZATION');
    const units = current.unitIds?.length ? current.unitIds : [current.unitId];
    if (!canReview(context) || !units.every((unitId) => canAccessUnit(context.userDoc, unitId, { isDefaultAdmin: context.isDefaultAdmin }))) {
      throw fail('PTRP_ADJUSTMENT_REVIEW_FORBIDDEN', 'Sem permissão para decidir este ajuste.', 'AUTHORIZATION');
    }
  }
  const { at, clockSource } = await actInstant(deps.clock);
  const action = input.action === 'approve' ? 'approved' as const : input.action === 'reject' ? 'rejected' as const : 'cancelled' as const;
  const result = await deps.hrDb.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists || snapshot.get('workspaceId') !== context.workspace_id) {
      throw fail('PTRP_ADJUSTMENT_NOT_FOUND', 'Pedido não encontrado.', 'NOT_FOUND');
    }
    const value = snapshot.data() as PilotAdjustmentRecord;
    if (value.status !== 'in_review') throw fail('PTRP_ADJUSTMENT_NOT_PENDING', 'Este pedido já foi decidido.', 'CONFLICT');
    if (value.version !== input.expectedVersion) throw fail('PTRP_ADJUSTMENT_VERSION_CONFLICT', 'O pedido mudou. Atualize e tente de novo.', 'CONFLICT');
    if (action === 'approved') {
      // Mesma regra do oficial: a batida desconsiderada por um pedido aprovado não pode ser desconsiderada de novo.
      const sameDay = await tx.get(deps.hrDb.collection(PILOT_ADJUSTMENTS).where('workspaceId', '==', value.workspaceId)
        .where('employeeUid', '==', value.employeeUid).where('workDate', '==', value.workDate).limit(40));
      const taken = discardedReceiptIds(pilotTreatmentsOf(sameDay.docs.map((doc) => doc.data() as PilotAdjustmentRecord).filter((item) => item.id !== value.id)));
      if (pilotAdjustmentOperations(value).some((operation) => operation.kind !== 'include' && operation.target && taken.has(operation.target.receiptId))) {
        throw fail('PTRP_ADJUSTMENT_ALREADY_TREATED', 'Esta batida já foi desconsiderada por outro ajuste aprovado.', 'CONFLICT');
      }
    }
    const act = { action, actorUid: context.decoded.uid, role: isOwner ? 'titular' as const : 'reviewer' as const, at, clockSource,
      ...('reason' in input ? { reason: input.reason } : {}) };
    const previousHash = value.acts.at(-1)?.hash ?? null;
    const next: PilotAdjustmentRecord = { ...value, status: action, version: value.version + 1, updatedAt: at,
      acts: [...value.acts, { ...act, previousHash,
        hash: adjustmentActHash(previousHash, act, adjustmentPayloadDigest({ scope: 'pilot', id: value.id, status: action })) }],
      ...(action !== 'cancelled' ? { decidedAt: at, decidedBy: context.decoded.uid } : {}) };
    tx.set(ref, next);
    return next;
  });
  return adjustmentDto(result);
}

/**
 * Decisão (aprovar/recusar, com justificativa obrigatória) por quem analisa, ou cancelamento pelo titular.
 * Aprovar cria, na mesma transação, a desconsideração da original e/ou a inclusão da nova em `ptrp_treatments`.
 */
export async function decideAdjustment(context: ServerUserContext, adjustmentId: string, input: AdjustmentDecisionInput, injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  const ref = deps.hrDb.collection(ADJUSTMENTS).doc(adjustmentId);
  const before = await ref.get();
  if (!before.exists) {
    const pilot = await deps.hrDb.collection(PILOT_ADJUSTMENTS).doc(adjustmentId).get();
    if (pilot.exists) return decidePilotAdjustment(context, adjustmentId, input, deps);
    return decideClassificationRequest(context, adjustmentId, input, deps);
  }
  if (before.get('workspaceId') !== context.workspace_id) throw fail('PTRP_ADJUSTMENT_NOT_FOUND', 'Pedido não encontrado.', 'NOT_FOUND');
  const current = before.data() as AdjustmentRecord;
  const isOwner = current.employeeUid === context.decoded.uid;
  if (input.action === 'cancel') {
    if (!isOwner) throw fail('PTRP_ADJUSTMENT_FORBIDDEN', 'Só o titular cancela o próprio pedido.', 'AUTHORIZATION');
  } else {
    if (isOwner) throw fail('PTRP_ADJUSTMENT_SELF_DECISION', 'Quem pediu não pode decidir o próprio ajuste.', 'AUTHORIZATION');
    const units = current.unitIds?.length ? current.unitIds : [current.unitId];
    if (!canReview(context) || !units.every((unitId) => canAccessUnit(context.userDoc, unitId, { isDefaultAdmin: context.isDefaultAdmin }))) {
      throw fail('PTRP_ADJUSTMENT_REVIEW_FORBIDDEN', 'Sem permissão para decidir este ajuste.', 'AUTHORIZATION');
    }
    await assertOpenCompetence(deps.hrDb, context.workspace_id, current.workDate);
  }
  const { at, clockSource } = await actInstant(deps.clock);
  const currentOperations = adjustmentOperations(current);
  let discardTaken = false;
  if (input.action === 'approve') for (const operation of currentOperations) {
    if (operation.target && operation.kind !== 'include' && await hasActiveDiscard(deps.hrDb, context.workspace_id, operation.target.receiptId)) discardTaken = true;
  }
  if (discardTaken) throw fail('PTRP_ADJUSTMENT_ALREADY_TREATED', 'Esta batida já foi desconsiderada por outro ajuste aprovado.', 'CONFLICT');
  const result = await deps.hrDb.runTransaction(async (tx) => {
    const pilotDayGuard = deps.hrDb.collection(REP_P_PILOT_DAY_GUARDS)
      .doc(repPPilotDayGuardId(context.workspace_id, current.employeeUid, current.workDate));
    const [snapshot, closure, pilotMarkings, pilotGuard] = await Promise.all([
      tx.get(ref),
      tx.get(deps.hrDb.collection(CLOSURES).doc(closureKey(context.workspace_id, current.workDate))),
      tx.get(pilotMarkingsOnDay(deps.hrDb, context.workspace_id, current.employeeUid, current.workDate)),
      tx.get(pilotDayGuard),
    ]);
    const value = snapshot.data() as AdjustmentRecord;
    if (input.action !== 'cancel' && closure.exists && closure.get('status') === 'closed') {
      throw fail('PTRP_COMPETENCE_CLOSED', 'Esta competência já foi fechada.', 'CONFLICT');
    }
    if (value.status !== 'in_review') throw fail('PTRP_ADJUSTMENT_NOT_PENDING', 'Este pedido já foi decidido.', 'CONFLICT');
    if (value.version !== input.expectedVersion) throw fail('PTRP_ADJUSTMENT_VERSION_CONFLICT', 'O pedido mudou. Atualize e tente de novo.', 'CONFLICT');
    const action = input.action === 'approve' ? 'approved' as const : input.action === 'reject' ? 'rejected' as const : 'cancelled' as const;
    if (action === 'approved' && (!pilotMarkings.empty || guardReservesPilotDomain(pilotGuard))) {
      throw fail('PTRP_PILOT_DAY_ADJUSTMENT_FORBIDDEN',
        'Batidas de ensaio não aceitam ajuste formal. Recuse este pedido e trate o registro oficial vigente.', 'CONFLICT');
    }
    const act = { action, actorUid: context.decoded.uid, role: isOwner ? 'titular' as const : 'reviewer' as const, at, clockSource,
      ...('reason' in input ? { reason: input.reason } : {}) };
    const previousHash = value.acts.at(-1)?.hash ?? null;
    const next: AdjustmentRecord = { ...value, status: action, version: value.version + 1, updatedAt: at,
      acts: [...value.acts, { ...act, previousHash, hash: adjustmentActHash(previousHash, act, adjustmentPayloadDigest({ id: value.id, status: action })) }],
      ...(action !== 'cancelled' ? { decidedAt: at, decidedBy: context.decoded.uid } : {}) };
    tx.set(ref, next);
    if (action === 'approved') {
      // Original preservada na ARP; o tratamento só acrescenta informação identificada (art. 82 p.ú.).
      const common = { workspaceId: value.workspaceId, employeeUid: value.employeeUid, workDate: value.workDate,
        establishmentId: value.establishmentId, adjustmentId: value.id, motivo: value.aejReason,
        requesterUid: value.employeeUid, decidedBy: context.decoded.uid, decidedAt: at, status: 'active',
        decisionReason: 'reason' in input ? input.reason : null, approvalActHash: next.acts.at(-1)!.hash };
      const operations = adjustmentOperations(value);
      for (const [index, operation] of operations.entries()) {
        const suffix = operations.length === 1 ? '' : `_${index + 1}`;
        if (operation.target && operation.kind !== 'include') {
          tx.create(deps.hrDb.collection(TREATMENTS).doc(`${value.id}${suffix}_discard`), { ...common, type: 'discard', operationIndex: index,
            originalReceiptId: operation.target.receiptId, originalNsr: operation.target.nsr, originalMarkedAt: operation.target.markedAt,
            markedAt: null, executionUnitId: operation.target.executionUnitId });
        }
        if (operation.inclusion && operation.kind !== 'discard') {
          tx.create(deps.hrDb.collection(TREATMENTS).doc(`${value.id}${suffix}_inclusion`), { ...common, type: 'inclusion', operationIndex: index,
            originalReceiptId: null, markedAt: operation.inclusion.markedAt, executionUnitId: operation.inclusion.executionUnitId });
        }
      }
    }
    return next;
  });
  return adjustmentDto(result);
}
