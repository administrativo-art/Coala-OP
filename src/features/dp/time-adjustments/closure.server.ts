import 'server-only';

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
import type { ClosureActionInput, ClosureCloseInput } from './schemas';
import { actInstant, ADJUSTMENTS, CLOSURES, closureKey, adjustmentOperations, type AdjustmentRecord } from './service.server';
import { AUTOMATIC_ABSENCES, type AutomaticAbsenceRecord } from './automatic-absence.server';
import { automaticAbsenceSuperseded } from './automatic-absence-core';
import { belongsToTimeClosureRoster } from '@/lib/hr/employment-relationship';

const ABSENCES = 'dp_absenceRequests';
/** Acima disso o fechamento é recusado: lista truncada não pode virar documento de fechamento. */
const ITEM_LIMIT = 2000;
/** Escritas por transação (limite do Firestore 500): documento, versão e uma por pessoa. */
const PEOPLE_LIMIT = 450;

type Clock = { read(): Promise<{ instant: Date }> };
type Dependencies = { mainDb: Firestore; hrDb: Firestore; repDb: Firestore; clock: Clock;
  readRoster(): Promise<ClosureRosterPerson[]>; afterFenceAcquired?(): Promise<void> };
const unavailableClock: Clock = { async read() { throw new Error('Hora Legal não configurada.'); } };
async function readActiveOperationalRoster() {
  const snapshot = await dbAdmin.collection('users').limit(PEOPLE_LIMIT + 1).get();
  if (snapshot.size > PEOPLE_LIMIT) throw fail('PTRP_CLOSURE_TOO_LARGE', 'Há pessoas demais para congelar o fechamento numa única versão.', 'CONFLICT');
  return snapshot.docs
    .filter((doc) => doc.get('isActive') !== false && belongsToTimeClosureRoster(doc.get('employmentRelationshipType')))
    .map((doc) => ({ uid: doc.id, name: typeof doc.get('username') === 'string' && doc.get('username').trim() ? doc.get('username').trim() : null }));
}
const defaults: Dependencies = { mainDb: dbAdmin, hrDb: hrDbAdmin, repDb: repPDbAdmin,
  clock: configuredRepPClock() ?? unavailableClock, readRoster: readActiveOperationalRoster };

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
  const approvedAdjustmentDays = new Set(adjustmentItems.filter((item) => item.status === 'approved').map((item) => `${item.employeeUid}|${item.workDate}`));
  const automaticItems = automaticAbsences.docs.slice(0, ITEM_LIMIT).map((doc) => doc.data() as AutomaticAbsenceRecord)
    .filter((record) => record.status === 'active')
    .filter((record) => !automaticAbsenceSuperseded(record.workDate,
      new Set([...approvedAdjustmentDays].filter((key) => key.startsWith(`${record.employeeUid}|`)).map((key) => key.slice(record.employeeUid.length + 1))),
      approvedAbsences.filter((item) => item.beneficiaryUid === record.employeeUid)))
    .map(automaticAbsenceItem);
  const people = buildDeclaration(adjustmentItems, [...absenceItems, ...automaticItems]);
  return { people, truncated };
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

/** Situação do mês e a declaração que o fechamento congelaria; com o mês fechado, a declaração da versão gravada. */
export async function readCompetenceClosure(context: ServerUserContext, competence: string, injected: Partial<Dependencies> = {}) {
  assertClosureAccess(context, 'read');
  const deps = { ...defaults, ...injected };
  const ref = deps.hrDb.collection(CLOSURES).doc(closureKey(context.workspace_id, competence));
  const snapshot = await ref.get();
  const closure = snapshot.exists ? snapshot.data() as ClosureRecord : null;
  const { people, truncated } = closure?.status === 'closed'
    ? { people: (await ref.collection('versions').doc(String(closure.version)).collection('people').limit(PEOPLE_LIMIT + 1).get()).docs
      .map((doc) => normalizeClosurePerson(doc.data() as ClosurePerson)), truncated: false }
    : await Promise.all([
      readDeclaration((query) => query.get(), deps.hrDb, context.workspace_id, competence),
      readShiftSwaps(deps.mainDb, context.workspace_id, competence),
      deps.readRoster(),
    ]).then(([declaration, swaps, roster]) => ({
      truncated: declaration.truncated || swaps.truncated,
      people: includeClosureRoster(withShiftSwaps(declaration.people, swaps.items), roster),
    }));
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
  const roster = await deps.readRoster();
  // A competência já terminou: novas trocas não podem ser abertas. Uma troca pendente lida aqui só pode caminhar
  // para um estado terminal, então uma leitura concorrente no máximo bloqueia conservadoramente esta tentativa.
  const swaps = await readShiftSwaps(deps.mainDb, context.workspace_id, input.competence);
  const ref = deps.hrDb.collection(CLOSURES).doc(closureKey(context.workspace_id, input.competence));
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
    record = await deps.hrDb.runTransaction(async (tx: Transaction) => {
    const [snapshot, classificationPending] = await Promise.all([tx.get(ref), tx.get(classificationPendingQuery)]);
    const current = snapshot.exists ? snapshot.data() as ClosureRecord : null;
    if (current?.status === 'closed') throw fail('PTRP_CLOSURE_ALREADY_CLOSED', 'Esta competência já está fechada.', 'CONFLICT');
    if ((current?.version ?? 0) !== input.expectedVersion) throw fail('PTRP_CLOSURE_VERSION_CONFLICT', 'O fechamento mudou desde a sua leitura. Atualize e confira.', 'CONFLICT');
    const declaration = await readDeclaration((query) => tx.get(query), deps.hrDb, context.workspace_id, input.competence);
    const people = includeClosureRoster(withShiftSwaps(declaration.people, swaps.items), roster);
    const truncated = declaration.truncated || swaps.truncated;
    if (truncated || people.length > PEOPLE_LIMIT) throw fail('PTRP_CLOSURE_TOO_LARGE', 'O mês tem mais pedidos do que o fechamento comporta numa vez. Fale com o desenvolvimento.', 'CONFLICT');
    const pending = pendingOf(people);
    if (pending.adjustments || pending.absences || pending.shiftSwaps || !classificationPending.empty) {
      throw fail('PTRP_CLOSURE_PENDING', `Há pedidos sem decisão (${pending.adjustments} de ajuste, ${pending.absences} de ausência, ${pending.shiftSwaps} de troca de turno${classificationPending.empty ? '' : ', classificação de batida pendente'}). Decida-os antes de fechar.`, 'CONFLICT');
    }
    const version = (current?.version ?? 0) + 1;
    const digests = itemDigests(people);
    const previous = current?.version ? (await tx.get(ref.collection('versions').doc(String(current.version)))).get('itemDigests') as Record<string, string> | undefined : undefined;
    const changes = diffDigests(previous ?? null, digests);
    const manifestHash = sha256({ competence: input.competence, workspaceId: context.workspace_id, version, people });
    const record: ClosureRecord = {
      workspaceId: context.workspace_id, competence: input.competence, status: 'closed', version, closedAt: at, closedBy: context.decoded.uid, clockSource,
      manifestHash, peopleCount: people.length, counts: counts(people), changes, reopenings: current?.reopenings ?? [], updatedAt: at,
    };
    const versionRef = ref.collection('versions').doc(String(version));
    tx.set(ref, record);
    tx.create(versionRef, { ...record, itemDigests: digests });
    for (const person of people) tx.create(versionRef.collection('people').doc(person.uid), person);
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
  const ref = deps.hrDb.collection(CLOSURES).doc(closureKey(context.workspace_id, competence));
  const record = await deps.hrDb.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const current = snapshot.exists ? snapshot.data() as ClosureRecord : null;
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
