import 'server-only';
import { assertNoPendingDayCorrections } from './day-corrections.server';

import { randomUUID } from 'node:crypto';

import type { DocumentData, Firestore, Query, Transaction } from 'firebase-admin/firestore';

import { repPCompetenceFenceRef } from '@/features/dp/rep-p/competence-fence.server';
import { configuredRepPClock } from '@/features/dp/rep-p/hlb-ntp-clock.server';
import type { AbsenceRequestRecord } from '@/features/dp/absences/requests/workflow-types';
import { serializeShiftSwap, SHIFT_SWAP_REQUESTS } from '@/features/dp/shift-swaps/contract.server';
import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { repPDbAdmin } from '@/lib/firebase-rep-p-admin';
import { AppError } from '@/lib/observability/app-error';

import {
  absenceLookback, buildDeclaration, competenceEnded, competenceRange, diffDigests, includeClosureRoster, itemDigests, normalizeClosurePerson, overlapsCompetence, pendingOf, sha256,
  type ClosureAbsence, type ClosureAdjustment, type ClosureChanges, type ClosurePerson, type ClosureRosterPerson, type ClosureShiftSwap,
} from './closure-core';
import type { ClosureActionInput, ClosureCloseInput, ClosureAlertReviewInput } from './schemas';
import { actInstant, ADJUSTMENTS, canReview, CLOSURES, closureKey, adjustmentOperations, type AdjustmentRecord } from './service.server';
import { AUTOMATIC_ABSENCES, type AutomaticAbsenceRecord } from './automatic-absence.server';
import { adjustmentRestoresAutomaticAbsence, automaticAbsenceSuperseded } from './automatic-absence-core';
import { belongsToTimeClosureRoster } from '@/lib/hr/employment-relationship';

import { overtimeDecisionRef, type OvertimeDecisionDocument } from '../time-bank/overtime-decision-store.server';
import { overtimeDecisionEnabled } from '../time-config/rollout.server';
import { checkPersonAlerts, readPersonAlertSources, type AlertSources } from './closure-alert-check.server';
import type { ClosureAlertDecision, ReviewableAlert } from './closure-alerts';
import { canAccessUnit } from '@/lib/unit-access';
import type { DayTreatment } from '../rep-p/day-model';
import { contractualRelationshipOnDate, readRosterHistories } from '../employment-reference/service.server';
import { registeredRosterReason, rosterDate, type RosterReason } from './closure-roster';

const ABSENCES = 'dp_absenceRequests';
/** Acima disso o fechamento é recusado: lista truncada não pode virar documento de fechamento. */
const ITEM_LIMIT = 2000;
/** Escritas por transação (limite do Firestore 500): documento, versão e uma por pessoa. */
const PEOPLE_LIMIT = 450;

type Clock = { read(): Promise<{ instant: Date }> };
type Dependencies = { mainDb: Firestore; hrDb: Firestore; repDb: Firestore; clock: Clock;
  readRoster(mainDb: Firestore, workspaceId: string, competence: string): Promise<ClosureRosterPerson[]>; afterFenceAcquired?(): Promise<void> };
const unavailableClock: Clock = { async read() { throw new Error('Hora Legal não configurada.'); } };
async function readMonthlyRoster(mainDb: Firestore, workspaceId: string, competence: string) {
  const { start, end } = competenceRange(competence);
  const snapshot = await mainDb.collection('users').select('username', 'isActive', 'employmentRelationshipType',
    'terminationRelationshipType', 'admissionDate', 'terminationDate', 'scheduledContractChange', 'contractualDataPeriods')
    .limit(ITEM_LIMIT + 1).get();
  if (snapshot.size > ITEM_LIMIT) throw fail('PTRP_CLOSURE_TOO_LARGE', 'O cadastro excedeu o limite de leitura do fechamento.', 'CONFLICT');
  const histories = await readRosterHistories(mainDb, workspaceId, snapshot.docs.map((doc) => doc.id));
  const roster: ClosureRosterPerson[] = [];
  for (const doc of snapshot.docs) {
    const user = doc.data();
    const history = histories.get(doc.id);
    let reason: RosterReason | null = null;
    if (history) {
      const termination = rosterDate(user.terminationDate);
      for (let day = 1; day <= Number(end.slice(-2)); day++) {
        const date = competence + '-' + String(day).padStart(2, '0');
        if (termination && date > termination) break;
        const relationship = contractualRelationshipOnDate(history, user, date);
        if (relationship && belongsToTimeClosureRoster(relationship)) { reason = 'historical'; break; }
      }
    } else {
      reason = registeredRosterReason(user, start, end);
    }
    if (reason) roster.push({ uid: doc.id, name: typeof user.username === 'string' ? user.username.trim() || null : null, rosterReason: reason });
  }
  return roster;
}
const defaults: Dependencies = { mainDb: dbAdmin, hrDb: hrDbAdmin, repDb: repPDbAdmin,
  clock: configuredRepPClock() ?? unavailableClock, readRoster: readMonthlyRoster };

export type ClosureReopening = { at: string; by: string; reason: string; fromVersion: number; clockSource: 'hora_legal' | 'server' };
export type ClosureRecord = {
  workspaceId: string; competence: string; status: 'open' | 'closed'; version: number;
  closedAt: string | null; closedBy: string | null; clockSource: 'hora_legal' | 'server' | null; manifestHash: string | null;
  peopleCount: number; counts: { adjustments: number; absences: number; shiftSwaps: number }; changes: ClosureChanges | null;
  reopenings: ClosureReopening[]; updatedAt: string;
};

function fail(code: string, safeMessage: string, kind: 'VALIDATION' | 'CONFLICT' | 'AUTHORIZATION' = 'VALIDATION') {
  return new AppError({ code, kind, safeMessage });
}

async function acquireRepPClosureFence(deps: Dependencies, workspaceId: string, competence: string, token: string, at: string) {
  const ref = repPCompetenceFenceRef(deps.repDb, workspaceId, competence);
  await deps.repDb.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    const status = current.get('status');
    if (status === 'closed') throw fail('PTRP_CLOSURE_ALREADY_CLOSED', 'Esta competência já está fechada.', 'CONFLICT');
    if (status === 'closing' || status === 'publishing') throw fail('PTRP_CLOSURE_IN_PROGRESS', 'Há um fechamento ou publicação de escala em andamento nesta competência.', 'CONFLICT');
    tx.set(ref, { schemaVersion: 1, workspaceId, competence, status: 'closing', token, closingAt: at,
      closedAt: null, closureVersion: null, updatedAt: at }, { merge: true });
  });
  return ref;
}

async function releaseRepPClosureFence(deps: Dependencies, workspaceId: string, competence: string, token: string, at: string) {
  const ref = repPCompetenceFenceRef(deps.repDb, workspaceId, competence);
  await deps.repDb.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    if (current.get('status') === 'closing' && current.get('token') === token) {
      tx.set(ref, { status: 'open', token: null, releasedAt: at, updatedAt: at }, { merge: true });
    }
  });
}

async function sealRepPClosureFence(deps: Dependencies, workspaceId: string, competence: string, token: string,
  version: number, at: string) {
  const ref = repPCompetenceFenceRef(deps.repDb, workspaceId, competence);
  await deps.repDb.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    if (current.get('status') !== 'closing' || current.get('token') !== token) {
      throw fail('PTRP_CLOSURE_FENCE_CONFLICT', 'A trava fiscal do fechamento mudou durante a operação.', 'CONFLICT');
    }
    tx.set(ref, { status: 'closed', token: null, closureVersion: version, closedAt: at, updatedAt: at }, { merge: true });
  });
}

async function openRepPClosureFence(deps: Dependencies, workspaceId: string, competence: string, version: number, at: string) {
  const ref = repPCompetenceFenceRef(deps.repDb, workspaceId, competence);
  await deps.repDb.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    if (current.exists && current.get('closureVersion') !== version) {
      throw fail('PTRP_CLOSURE_FENCE_CONFLICT', 'A trava fiscal pertence a outra versão do fechamento.', 'CONFLICT');
    }
    tx.set(ref, { schemaVersion: 1, workspaceId, competence, status: 'open', token: null,
      reopenedFromVersion: version, reopenedAt: at, updatedAt: at }, { merge: true });
  });
}
function permissions(context: ServerUserContext) {
  const closure = context.permissions.dp.timeClosure;
  return { close: context.isDefaultAdmin || closure?.close === true, reopen: context.isDefaultAdmin || closure?.reopen === true };
}
export function assertClosureAccess(context: ServerUserContext, need: 'read' | 'close' | 'reopen') {
  const granted = permissions(context);
  const allowed = need === 'read' ? granted.close || granted.reopen : granted[need];
  if (!allowed) throw fail('PTRP_CLOSURE_FORBIDDEN', 'Sem permissão para o fechamento do ponto.', 'AUTHORIZATION');
}

function adjustmentItem(record: AdjustmentRecord): ClosureAdjustment & { employeeUid: string; employeeName: string | null } {
  const requested = record.acts.find((act) => act.action === 'requested');
  const decision = [...record.acts].reverse().find((act) => act.action !== 'requested');
  return {
    id: record.id, employeeUid: record.employeeUid, employeeName: record.employeeName, workDate: record.workDate, kind: record.kind, status: record.status,
    original: record.target ? { nsr: record.target.nsr, markedAt: record.target.markedAt } : null,
    inclusion: record.inclusion ? { markedAt: record.inclusion.markedAt } : null,
    operations: adjustmentOperations(record).map((item) => ({ kind: item.kind,
      original: item.target ? { nsr: item.target.nsr, markedAt: item.target.markedAt } : null,
      inclusion: item.inclusion ? { markedAt: item.inclusion.markedAt } : null })), reason: record.reason,
    requestedBy: requested?.actorUid ?? record.employeeUid, requestedAt: requested?.at ?? record.createdAt,
    decidedBy: decision?.actorUid ?? null, decidedAt: decision?.at ?? null, decisionReason: decision?.reason ?? null,
  };
}
function absenceItem(record: AbsenceRequestRecord): ClosureAbsence & { beneficiaryUid: string; beneficiaryName: string | null } {
  const decision = [...(record.history ?? [])].reverse().find((entry) => ['approve', 'tacit_approve', 'reject', 'cancel'].includes(entry.action));
  return {
    id: record.id, beneficiaryUid: record.beneficiaryUid, beneficiaryName: record.beneficiaryName ?? null, typeName: record.typeSnapshot?.name ?? record.typeId,
    startDate: record.startDate, endDate: record.endDate, startTime: record.input?.startTime ?? null, endTime: record.input?.endTime ?? null,
    quantity: record.quantity, unit: record.unit, status: record.status,
    approval: record.status === 'approved' ? record.approvalOrigin ?? 'review' : null,
    decidedBy: decision?.actorUid ?? null, decidedAt: record.decidedAt ?? decision?.at ?? null, attachmentCount: record.attachments?.length ?? 0,
  };
}
function automaticAbsenceItem(record: AutomaticAbsenceRecord): ClosureAbsence & { beneficiaryUid: string; beneficiaryName: string | null } {
  return { id: record.id, beneficiaryUid: record.employeeUid, beneficiaryName: record.employeeName, typeName: 'Falta injustificada automática',
    startDate: record.workDate, endDate: record.workDate, startTime: null, endTime: null, quantity: 1, unit: 'day',
    status: 'approved', approval: 'automatic_timeout', decidedBy: null, decidedAt: record.createdAt, attachmentCount: 0,
    effect: 'unexcused_absence', automatic: true };
}

function shiftSwapItem(id: string, raw: DocumentData): ClosureShiftSwap {
  const request = serializeShiftSwap(id, raw as Record<string, unknown>);
  return {
    id: request.id, status: request.status, date: request.offeredShift.date,
    unitId: request.offeredShift.unitId, unitName: request.offeredShift.unitName,
    requesterUid: request.requesterUid, requesterName: request.requesterName,
    targetUid: request.targetUid, targetName: request.targetName,
    offeredShift: { startTime: request.offeredShift.startTime, endTime: request.offeredShift.endTime, shiftName: request.offeredShift.shiftName },
    requestedShift: { startTime: request.requestedShift.startTime, endTime: request.requestedShift.endTime, shiftName: request.requestedShift.shiftName },
    reason: request.reason, requestedAt: request.createdAt, decidedAt: request.decidedAt,
    // A declaração conserva a manifestação de vontade, sem copiar IP, e-mail, agente ou chave idempotente.
    acts: request.events.map(({ action, at, actorUid, actorName, declaration }) => ({ action, at, actorUid, actorName, declaration })),
  };
}

function monthQueries(hrDb: Firestore, workspaceId: string, competence: string) {
  const { start, end } = competenceRange(competence);
  return {
    adjustments: hrDb.collection(ADJUSTMENTS).where('workspaceId', '==', workspaceId).where('workDate', '>=', start).where('workDate', '<=', end)
      .orderBy('workDate').limit(ITEM_LIMIT + 1),
    // Ausências que começam até 366 dias antes do mês; as que terminam antes dele são descartadas na memória.
    absences: hrDb.collection(ABSENCES).where('workspaceId', '==', workspaceId).where('startDate', '>=', absenceLookback(start)).where('startDate', '<=', end)
      .orderBy('startDate', 'desc').limit(ITEM_LIMIT + 1),
    automaticAbsences: hrDb.collection(AUTOMATIC_ABSENCES).where('workspaceId', '==', workspaceId)
      .where('workDate', '>=', start).where('workDate', '<=', end).orderBy('workDate').limit(ITEM_LIMIT + 1),
  };
}
async function readDeclaration(get: (query: Query<DocumentData>) => Promise<{ docs: Array<{ data(): DocumentData }>; size: number }>, hrDb: Firestore, workspaceId: string, competence: string) {
  const queries = monthQueries(hrDb, workspaceId, competence);
  const [adjustments, absences, automaticAbsences] = await Promise.all([get(queries.adjustments), get(queries.absences), get(queries.automaticAbsences)]);
  const truncated = adjustments.size > ITEM_LIMIT || absences.size > ITEM_LIMIT || automaticAbsences.size > ITEM_LIMIT;
  const adjustmentItems = adjustments.docs.slice(0, ITEM_LIMIT).map((doc) => adjustmentItem(doc.data() as AdjustmentRecord));
  const absenceItems = absences.docs.slice(0, ITEM_LIMIT).map((doc) => doc.data() as AbsenceRequestRecord)
    .filter((record) => record.status !== 'draft' && overlapsCompetence(record, competence)).map(absenceItem);
  const approvedAbsences = absenceItems.filter((item) => item.status === 'approved');
  const approvedAdjustmentDays = new Set(adjustmentItems.filter(adjustmentRestoresAutomaticAbsence).map((item) => `${item.employeeUid}|${item.workDate}`));
  const automaticItems = automaticAbsences.docs.slice(0, ITEM_LIMIT).map((doc) => doc.data() as AutomaticAbsenceRecord)
    .filter((record) => record.status === 'active')
    .filter((record) => !automaticAbsenceSuperseded(record.workDate,
      new Set([...approvedAdjustmentDays].filter((key) => key.startsWith(`${record.employeeUid}|`)).map((key) => key.slice(record.employeeUid.length + 1))),
      approvedAbsences.filter((item) => item.beneficiaryUid === record.employeeUid)))
    .map(automaticAbsenceItem);
  const people = buildDeclaration(adjustmentItems, [...absenceItems, ...automaticItems]);
  const pendingAutomaticSchedule = automaticAbsences.docs.some((doc) =>
    ['pending_removal', 'pending_restoration', 'review_required'].includes(String(doc.data().scheduleSyncStatus ?? '')));
  return { people, truncated, pendingAutomaticSchedule };
}

async function readShiftSwaps(mainDb: Firestore, workspaceId: string, competence: string) {
  const { start, end } = competenceRange(competence);
  const snapshot = await mainDb.collection(SHIFT_SWAP_REQUESTS).where('workspaceId', '==', workspaceId)
    .where('workDate', '>=', start).where('workDate', '<=', end).orderBy('workDate').limit(ITEM_LIMIT + 1).get();
  return { items: snapshot.docs.slice(0, ITEM_LIMIT).map((doc) => shiftSwapItem(doc.id, doc.data())), truncated: snapshot.size > ITEM_LIMIT };
}

function withShiftSwaps(people: ClosurePerson[], swaps: ClosureShiftSwap[]) {
  return buildDeclaration(
    people.flatMap((person) => person.adjustments.map((item) => ({ ...item, employeeUid: person.uid, employeeName: person.name }))),
    people.flatMap((person) => person.absences.map((item) => ({ ...item, beneficiaryUid: person.uid, beneficiaryName: person.name }))),
    swaps,
  );
}
function counts(people: ClosurePerson[]) {
  return {
    adjustments: people.reduce((sum, entry) => sum + entry.adjustments.length, 0),
    absences: people.reduce((sum, entry) => sum + entry.absences.length, 0),
    shiftSwaps: new Set(people.flatMap((entry) => entry.shiftSwaps.map((item) => item.id))).size,
  };
}

const competenceRef = (db: Firestore, workspaceId: string, competence: string) => db.collection(CLOSURES).doc(closureKey(workspaceId, competence));
const alertReviewRef = (db: Firestore, fingerprint: string) => db.collection('dp_timeClosureAlertReviews').doc(fingerprint);

async function reviewDays(deps: Dependencies, actor: ServerUserContext, competence: string, version: number,
  people: ClosurePerson[], tx?: Transaction, sources?: Map<string, AlertSources>) {
  const { start, end } = competenceRange(competence);
  const result: Array<ReviewableAlert & { inScope: boolean }> = [];
  for (let offset = 0; offset < people.length; offset += 8) {
    const batch = await Promise.all(people.slice(offset, offset + 8).map(async (person) => {
      const query = deps.hrDb.collection('ptrp_treatments').where('workspaceId', '==', actor.workspace_id)
        .where('employeeUid', '==', person.uid).where('workDate', '>=', start).where('workDate', '<=', end)
        .orderBy('workDate').limit(ITEM_LIMIT + 1);
      const entries = await (tx ? tx.get(query) : query.get());
      if (entries.size > ITEM_LIMIT) throw fail('PTRP_CLOSURE_ALERT_INPUT_LIMIT', 'Há tratamentos demais para conferir o mês.', 'CONFLICT');
      const treatments = entries.docs.filter((doc) => doc.get('status') === 'active').map((doc) => ({
        type: doc.get('type'), workDate: doc.get('workDate'), adjustmentId: doc.get('adjustmentId'),
        originalReceiptId: doc.get('originalReceiptId') ?? null, markedAt: doc.get('markedAt') ?? null,
        executionUnitId: doc.get('executionUnitId') ?? null,
      } satisfies DayTreatment));
      if (sources && !sources.has(person.uid)) throw fail('PTRP_CLOSURE_ROSTER_CHANGED', 'A equipe mudou durante a conferência. Atualize e tente novamente.', 'CONFLICT');
      const checks = await checkPersonAlerts(deps, actor, competence, version, person, treatments, tx, sources?.get(person.uid));
      if (!checks.length) return [];
      const refs = checks.map(({ alert }) => alertReviewRef(deps.hrDb, alert.fingerprint));
      const decisions = await (tx ? tx.getAll(...refs) : deps.hrDb.getAll(...refs));
      return checks.map(({ alert, inScope }, index) => ({ ...alert, inScope,
        canJustify: inScope && permissions(actor).close && canReview(actor) && actor.decoded.uid !== person.uid,
        decision: decisions[index].exists ? decisions[index].data() as ClosureAlertDecision : null }));
    }));
    result.push(...batch.flat());
  }
  return result;
}

export async function previewClosureAlerts(actor: ServerUserContext, competence: string, injected: Partial<Dependencies> = {}) {
  assertClosureAccess(actor, 'read');
  const deps = { ...defaults, ...injected };
  const state = await readCompetenceClosure(actor, competence, deps);
  if (state.closure?.status === 'closed') {
    const alerts: ReviewableAlert[] = [];
    const ids = state.people.flatMap((person) => (person as ClosurePerson & { appliedAlertReviews?: string[] }).appliedAlertReviews ?? []);
    for (let offset = 0; offset < ids.length; offset += 100) {
      const docs = await deps.hrDb.getAll(...ids.slice(offset, offset + 100).map((id) => alertReviewRef(deps.hrDb, id)));
      for (const doc of docs) {
        const decision = doc.data() as ClosureAlertDecision | undefined;
        if (!decision) throw fail('PTRP_CLOSURE_ALERT_AUDIT_MISSING', 'Justificativa da versão indisponível.', 'CONFLICT');
        if (actor.isDefaultAdmin || (decision.unitIds.length && decision.unitIds.every((id) => canAccessUnit(actor.userDoc, id)))) {
          alerts.push({ ...decision, canJustify: false, decision });
        }
      }
    }
    return { expectedVersion: state.closure.version, alerts, pendingOutsideScope: 0 };
  }
  if (state.truncated) throw fail('PTRP_CLOSURE_ALERT_PREVIEW_UNAVAILABLE', 'Atualize a competência antes de conferir os alertas.', 'CONFLICT');
  if (!competenceEnded(competence, (await actInstant(deps.clock)).at)) throw fail('PTRP_CLOSURE_TOO_EARLY', 'A conferência final só está disponível após o encerramento do mês.', 'CONFLICT');
  const checks = await reviewDays(deps, actor, competence, state.closure?.version ?? 0, state.people);
  return { expectedVersion: state.closure?.version ?? 0, alerts: checks.filter((item) => item.inScope),
    pendingOutsideScope: checks.filter((item) => !item.inScope && !item.decision).length };
}

export async function justifyClosureAlert(actor: ServerUserContext, input: ClosureAlertReviewInput, injected: Partial<Dependencies> = {}) {
  assertClosureAccess(actor, 'close');
  if (!canReview(actor) || actor.decoded.uid === input.employeeUid) throw fail('PTRP_ALERT_REVIEW_FORBIDDEN', 'Sem permissão para liberar este alerta.', 'AUTHORIZATION');
  const deps = { ...defaults, ...injected };
  const state = await readCompetenceClosure(actor, input.competence, deps);
  const person = state.people.find((item) => item.uid === input.employeeUid);
  if (!person || state.truncated) throw fail('PTRP_CLOSURE_ALERT_CHANGED', 'Atualize a conferência dos alertas.', 'CONFLICT');
  const { at } = await actInstant(deps.clock);
  if (!competenceEnded(input.competence, at)) throw fail('PTRP_CLOSURE_TOO_EARLY', 'A competência ainda está em andamento.', 'CONFLICT');
  const ref = competenceRef(deps.hrDb, actor.workspace_id, input.competence);
  return deps.hrDb.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    if (current.get('status') === 'closed' || (current.get('version') ?? 0) !== input.expectedVersion) {
      throw fail('PTRP_CLOSURE_VERSION_CONFLICT', 'A versão da competência mudou. Atualize a conferência.', 'CONFLICT');
    }
    const declaration = await readDeclaration((query) => tx.get(query), deps.hrDb, actor.workspace_id, input.competence);
    if (declaration.truncated) throw fail('PTRP_CLOSURE_ALERT_INPUT_LIMIT', 'A declaração está incompleta.', 'CONFLICT');
    const fresh = declaration.people.find((entry) => entry.uid === person.uid);
    const checks = await reviewDays(deps, actor, input.competence, input.expectedVersion, [{ ...person, absences: fresh?.absences ?? [] }], tx);
    const check = checks.find((item) => item.fingerprint === input.fingerprint);
    if (!check) throw fail('PTRP_CLOSURE_ALERT_CHANGED', 'O alerta mudou. Atualize a conferência antes de justificar.', 'CONFLICT');
    if (!check.canJustify) throw fail('PTRP_ALERT_REVIEW_FORBIDDEN', 'Sem permissão para liberar este alerta.', 'AUTHORIZATION');
    if (check.decision) return check.decision;
    const decision = { workspaceId: actor.workspace_id, competence: input.competence,
        expectedVersion: input.expectedVersion, employeeUid: person.uid, date: check.date, incidents: check.incidents,
        fingerprint: check.fingerprint, unitIds: check.unitIds, by: actor.decoded.uid, at, reason: input.reason.trim() };
    tx.create(alertReviewRef(deps.hrDb, check.fingerprint), decision);
    return decision;
  });
}

/** Situação do mês e a declaração que o fechamento congelaria; com o mês fechado, a declaração da versão gravada. */
export async function readCompetenceClosure(context: ServerUserContext, competence: string, injected: Partial<Dependencies> = {}) {
  assertClosureAccess(context, 'read');
  const deps = { ...defaults, ...injected };
  const ref = competenceRef(deps.hrDb, context.workspace_id, competence);
  const snapshot = await ref.get();
  const stored = snapshot.data();
  if (stored) delete stored.bankCalculationErrors;
  const closure = stored ? stored as ClosureRecord : null;
  const { people, truncated } = closure?.status === 'closed'
    ? { people: (await ref.collection('versions').doc(String(closure.version)).collection('people').limit(PEOPLE_LIMIT + 1).get()).docs
      .map((doc) => normalizeClosurePerson(doc.data() as ClosurePerson)), truncated: false }
    : await Promise.all([
      readDeclaration((query) => query.get(), deps.hrDb, context.workspace_id, competence),
      readShiftSwaps(deps.mainDb, context.workspace_id, competence),
      deps.readRoster(deps.mainDb, context.workspace_id, competence),
    ]).then(([declaration, swaps, roster]) => {
      const people = includeClosureRoster(withShiftSwaps(declaration.people, swaps.items), roster);
      return { people, truncated: declaration.truncated || swaps.truncated || people.length > PEOPLE_LIMIT };
    });
  return { competence, closure, people, pending: pendingOf(people), counts: counts(people), truncated, can: permissions(context) };
}

/**
 * Fecha a competência numa transação: relê os pedidos do mês, recusa com pedido pendente, lista truncada ou versão
 * diferente da esperada, e grava documento, versão e declaração por pessoa com carimbo SHA-256 da declaração.
 */
export async function closeCompetence(context: ServerUserContext, input: ClosureCloseInput, injected: Partial<Dependencies> = {}) {
  assertClosureAccess(context, 'close');
  const deps = { ...defaults, ...injected };
  const { at, clockSource } = await actInstant(deps.clock);
  if (!competenceEnded(input.competence, at)) throw fail('PTRP_CLOSURE_TOO_EARLY', 'Só é possível fechar um mês encerrado há pelo menos um dia em todos os fusos.');
  const roster = await deps.readRoster(deps.mainDb, context.workspace_id, input.competence);
  // A competência já terminou: novas trocas não podem ser abertas. Uma troca pendente lida aqui só pode caminhar
  // para um estado terminal, então uma leitura concorrente no máximo bloqueia conservadoramente esta tentativa.
  const swaps = await readShiftSwaps(deps.mainDb, context.workspace_id, input.competence);
  const ref = competenceRef(deps.hrDb, context.workspace_id, input.competence);
  const classificationPendingQuery = deps.hrDb.collection('ptrp_markingClassificationRequests')
    .where('workspaceId', '==', context.workspace_id).where('status', '==', 'in_review')
    .where('workDate', '>=', `${input.competence}-01`).where('workDate', '<=', `${input.competence}-31`).limit(1);
  const fenceToken = randomUUID();
  await acquireRepPClosureFence(deps, context.workspace_id, input.competence, fenceToken, at);
  try {
    await deps.afterFenceAcquired?.();
  } catch (cause) {
    await releaseRepPClosureFence(deps, context.workspace_id, input.competence, fenceToken, at);
    throw cause;
  }
  let record: ClosureRecord;
  try {
    // A trava fiscal já impede publicação da escala e novas batidas retroativas. As
    // classificações, decisões e tratamentos do RH ainda são relidos na transação abaixo.
    const initial = await readDeclaration((query) => query.get(), deps.hrDb, context.workspace_id, input.competence);
    const subjects = includeClosureRoster(withShiftSwaps(initial.people, swaps.items), roster);
    if (initial.truncated || swaps.truncated || subjects.length > PEOPLE_LIMIT) throw fail('PTRP_CLOSURE_TOO_LARGE', 'A lista do fechamento excede o limite.', 'CONFLICT');
    const sources = new Map<string, AlertSources>();
    for (let offset = 0; offset < subjects.length; offset += 8) {
      await Promise.all(subjects.slice(offset, offset + 8).map(async ({ uid }) => {
        sources.set(uid, await readPersonAlertSources(deps, context.workspace_id, input.competence, uid));
      }));
    }
    record = await deps.hrDb.runTransaction(async (tx: Transaction) => {
    const [snapshot, classificationPending] = await Promise.all([tx.get(ref), tx.get(classificationPendingQuery)]);
    await assertNoPendingDayCorrections(deps.hrDb, tx, context.workspace_id, input.competence);
    const current = snapshot.exists ? snapshot.data() as ClosureRecord : null;
    if (current?.status === 'closed') throw fail('PTRP_CLOSURE_ALREADY_CLOSED', 'Esta competência já está fechada.', 'CONFLICT');
    if ((current?.version ?? 0) !== input.expectedVersion) throw fail('PTRP_CLOSURE_VERSION_CONFLICT', 'O fechamento mudou desde a sua leitura. Atualize e confira.', 'CONFLICT');
    const declaration = await readDeclaration((query) => tx.get(query), deps.hrDb, context.workspace_id, input.competence);
    if (declaration.pendingAutomaticSchedule) throw fail('PTRP_AUTOMATIC_ABSENCE_SCHEDULE_PENDING',
      'Há falta automática ainda não reconciliada com a escala. Resolva a pendência antes de fechar o ponto.', 'CONFLICT');
    const people = includeClosureRoster(withShiftSwaps(declaration.people, swaps.items), roster);
    const truncated = declaration.truncated || swaps.truncated;
    if (truncated || people.length > PEOPLE_LIMIT) throw fail('PTRP_CLOSURE_TOO_LARGE', 'O mês tem mais pedidos do que o fechamento comporta numa vez. Fale com o desenvolvimento.', 'CONFLICT');
    const pending = pendingOf(people);
    if (pending.adjustments || pending.absences || pending.shiftSwaps || !classificationPending.empty) {
      throw fail('PTRP_CLOSURE_PENDING', `Há pedidos sem decisão (${pending.adjustments} de ajuste, ${pending.absences} de ausência, ${pending.shiftSwaps} de troca de turno${classificationPending.empty ? '' : ', classificação de batida pendente'}). Decida-os antes de fechar.`, 'CONFLICT');
    }
    const reviewed = await reviewDays(deps, context, input.competence, input.expectedVersion, people, tx, sources);
    const blocked = reviewed.filter((item) => !item.decision);
    if (blocked.length) throw fail('PTRP_CLOSURE_CRITICAL_ALERT', `Há ${blocked.length} dia(s) com alerta grave sem justificativa. Confira os alertas antes de fechar.`, 'CONFLICT');
    // Escolhas da hora extra entram na versão e no carimbo; a apuração oficial usa só o que foi congelado aqui.
    const decisionDocs = overtimeDecisionEnabled() && people.length
      ? await tx.getAll(...people.map((person) => overtimeDecisionRef(deps.hrDb, context.workspace_id, input.competence, person.uid))) : [];
    const frozen: ClosurePerson[] = people.map((person, index) => {
      const days = (decisionDocs[index]?.data() as OvertimeDecisionDocument | undefined)?.days;
      return days && Object.keys(days).length ? { ...person, overtimeDecisions: days } : person;
    });
    const version = (current?.version ?? 0) + 1;
    const digests = itemDigests(people);
    const previous = current?.version ? (await tx.get(ref.collection('versions').doc(String(current.version)))).get('itemDigests') as Record<string, string> | undefined : undefined;
    const changes = diffDigests(previous ?? null, digests);
    const manifestHash = sha256({ competence: input.competence, workspaceId: context.workspace_id, version, people: frozen, ...(reviewed.length ? { releases: reviewed.map((item) => item.decision) } : {}) });
    const record: ClosureRecord = {
      workspaceId: context.workspace_id, competence: input.competence, status: 'closed', version, closedAt: at, closedBy: context.decoded.uid, clockSource,
      manifestHash, peopleCount: people.length, counts: counts(people), changes, reopenings: current?.reopenings ?? [], updatedAt: at,
    };
    const versionRef = ref.collection('versions').doc(String(version));
    tx.set(ref, record);
    tx.create(versionRef, { ...record, itemDigests: digests });
    for (const person of frozen) {
      const applied = reviewed.filter((item) => item.employeeUid === person.uid);
      const breakReviewDates = applied.filter((item) => item.incidents.includes('short_break') || item.incidents.includes('missing_break')).map((item) => item.date);
      tx.create(versionRef.collection('people').doc(person.uid), applied.length ? {
        ...person, appliedAlertReviews: applied.map((item) => item.fingerprint), breakReviewDates,
      } : person);
    }
      return record;
    });
  } catch (cause) {
    await releaseRepPClosureFence(deps, context.workspace_id, input.competence, fenceToken, at);
    throw cause;
  }
  // Se esta etapa falhar, a trava permanece em `closing`: é mais seguro bloquear novas batidas
  // retroativas do que abrir uma janela depois que o PTRP já congelou a versão.
  await sealRepPClosureFence(deps, context.workspace_id, input.competence, fenceToken, record.version, at);
  return record;
}

/** Reabre com motivo e versão esperada; a versão fechada fica preservada e o próximo fechamento cria outra. */
export async function reopenCompetence(context: ServerUserContext, competence: string, input: ClosureActionInput, injected: Partial<Dependencies> = {}) {
  assertClosureAccess(context, 'reopen');
  const deps = { ...defaults, ...injected };
  const { at, clockSource } = await actInstant(deps.clock);
  const ref = competenceRef(deps.hrDb, context.workspace_id, competence);
  const record = await deps.hrDb.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const stored = snapshot.data();
    if (stored) delete stored.bankCalculationErrors;
    const current = stored ? stored as ClosureRecord : null;
    if (current?.status !== 'closed') throw fail('PTRP_CLOSURE_NOT_CLOSED', 'Esta competência não está fechada.', 'CONFLICT');
    if (current.version !== input.expectedVersion) throw fail('PTRP_CLOSURE_VERSION_CONFLICT', 'O fechamento mudou desde a sua leitura. Atualize e confira.', 'CONFLICT');
    const record: ClosureRecord = { ...current, status: 'open', updatedAt: at,
      reopenings: [...current.reopenings, { at, by: context.decoded.uid, reason: input.reason, fromVersion: current.version, clockSource }] };
    tx.set(ref, record);
    return record;
  });
  // A ARP só volta a aceitar marcações da competência depois que o PTRP já está aberto.
  await openRepPClosureFence(deps, context.workspace_id, competence, input.expectedVersion, at);
  return record;
}
