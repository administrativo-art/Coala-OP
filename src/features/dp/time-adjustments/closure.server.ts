import 'server-only';

import type { DocumentData, Firestore, Query, Transaction } from 'firebase-admin/firestore';

import { configuredRepPClock } from '@/features/dp/rep-p/hlb-ntp-clock.server';
import type { AbsenceRequestRecord } from '@/features/dp/absences/requests/workflow-types';
import type { ServerUserContext } from '@/lib/auth-server';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { AppError } from '@/lib/observability/app-error';

import {
  absenceLookback, buildDeclaration, competenceEnded, competenceRange, diffDigests, itemDigests, overlapsCompetence, pendingOf, sha256,
  type ClosureAbsence, type ClosureAdjustment, type ClosureChanges, type ClosurePerson,
} from './closure-core';
import type { ClosureActionInput, ClosureCloseInput } from './schemas';
import { actInstant, ADJUSTMENTS, CLOSURES, closureKey, type AdjustmentRecord } from './service.server';

const ABSENCES = 'dp_absenceRequests';
/** Acima disso o fechamento é recusado: lista truncada não pode virar documento de fechamento. */
const ITEM_LIMIT = 2000;
/** Escritas por transação (limite do Firestore 500): documento, versão e uma por pessoa. */
const PEOPLE_LIMIT = 450;

type Clock = { read(): Promise<{ instant: Date }> };
type Dependencies = { hrDb: Firestore; clock: Clock };
const unavailableClock: Clock = { async read() { throw new Error('Hora Legal não configurada.'); } };
const defaults: Dependencies = { hrDb: hrDbAdmin, clock: configuredRepPClock() ?? unavailableClock };

export type ClosureReopening = { at: string; by: string; reason: string; fromVersion: number; clockSource: 'hora_legal' | 'server' };
export type ClosureRecord = {
  workspaceId: string; competence: string; status: 'open' | 'closed'; version: number;
  closedAt: string | null; closedBy: string | null; clockSource: 'hora_legal' | 'server' | null; manifestHash: string | null;
  peopleCount: number; counts: { adjustments: number; absences: number }; changes: ClosureChanges | null;
  reopenings: ClosureReopening[]; updatedAt: string;
};

function fail(code: string, safeMessage: string, kind: 'VALIDATION' | 'CONFLICT' | 'AUTHORIZATION' = 'VALIDATION') {
  return new AppError({ code, kind, safeMessage });
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
    inclusion: record.inclusion ? { markedAt: record.inclusion.markedAt } : null, reason: record.reason,
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

function monthQueries(hrDb: Firestore, workspaceId: string, competence: string) {
  const { start, end } = competenceRange(competence);
  return {
    adjustments: hrDb.collection(ADJUSTMENTS).where('workspaceId', '==', workspaceId).where('workDate', '>=', start).where('workDate', '<=', end)
      .orderBy('workDate').limit(ITEM_LIMIT + 1),
    // Ausências que começam até 366 dias antes do mês; as que terminam antes dele são descartadas na memória.
    absences: hrDb.collection(ABSENCES).where('workspaceId', '==', workspaceId).where('startDate', '>=', absenceLookback(start)).where('startDate', '<=', end)
      .orderBy('startDate', 'desc').limit(ITEM_LIMIT + 1),
  };
}
async function readDeclaration(get: (query: Query<DocumentData>) => Promise<{ docs: Array<{ data(): DocumentData }>; size: number }>, hrDb: Firestore, workspaceId: string, competence: string) {
  const queries = monthQueries(hrDb, workspaceId, competence);
  const [adjustments, absences] = await Promise.all([get(queries.adjustments), get(queries.absences)]);
  const truncated = adjustments.size > ITEM_LIMIT || absences.size > ITEM_LIMIT;
  const people = buildDeclaration(adjustments.docs.slice(0, ITEM_LIMIT).map((doc) => adjustmentItem(doc.data() as AdjustmentRecord)),
    absences.docs.slice(0, ITEM_LIMIT).map((doc) => doc.data() as AbsenceRequestRecord)
      .filter((record) => record.status !== 'draft' && overlapsCompetence(record, competence)).map(absenceItem));
  return { people, truncated };
}
function counts(people: ClosurePerson[]) {
  return { adjustments: people.reduce((sum, entry) => sum + entry.adjustments.length, 0), absences: people.reduce((sum, entry) => sum + entry.absences.length, 0) };
}

/** Situação do mês e a declaração que o fechamento congelaria; com o mês fechado, a declaração da versão gravada. */
export async function readCompetenceClosure(context: ServerUserContext, competence: string, injected: Partial<Dependencies> = {}) {
  assertClosureAccess(context, 'read');
  const deps = { ...defaults, ...injected };
  const ref = deps.hrDb.collection(CLOSURES).doc(closureKey(context.workspace_id, competence));
  const snapshot = await ref.get();
  const closure = snapshot.exists ? snapshot.data() as ClosureRecord : null;
  const { people, truncated } = closure?.status === 'closed'
    ? { people: (await ref.collection('versions').doc(String(closure.version)).collection('people').limit(PEOPLE_LIMIT + 1).get()).docs.map((doc) => doc.data() as ClosurePerson), truncated: false }
    : await readDeclaration((query) => query.get(), deps.hrDb, context.workspace_id, competence);
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
  const ref = deps.hrDb.collection(CLOSURES).doc(closureKey(context.workspace_id, input.competence));
  return deps.hrDb.runTransaction(async (tx: Transaction) => {
    const snapshot = await tx.get(ref);
    const current = snapshot.exists ? snapshot.data() as ClosureRecord : null;
    if (current?.status === 'closed') throw fail('PTRP_CLOSURE_ALREADY_CLOSED', 'Esta competência já está fechada.', 'CONFLICT');
    if ((current?.version ?? 0) !== input.expectedVersion) throw fail('PTRP_CLOSURE_VERSION_CONFLICT', 'O fechamento mudou desde a sua leitura. Atualize e confira.', 'CONFLICT');
    const { people, truncated } = await readDeclaration((query) => tx.get(query), deps.hrDb, context.workspace_id, input.competence);
    if (truncated || people.length > PEOPLE_LIMIT) throw fail('PTRP_CLOSURE_TOO_LARGE', 'O mês tem mais pedidos do que o fechamento comporta numa vez. Fale com o desenvolvimento.', 'CONFLICT');
    const pending = pendingOf(people);
    if (pending.adjustments || pending.absences) {
      throw fail('PTRP_CLOSURE_PENDING', `Há pedidos sem decisão (${pending.adjustments} de ajuste, ${pending.absences} de ausência). Decida-os antes de fechar.`, 'CONFLICT');
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
}

/** Reabre com motivo e versão esperada; a versão fechada fica preservada e o próximo fechamento cria outra. */
export async function reopenCompetence(context: ServerUserContext, competence: string, input: ClosureActionInput, injected: Partial<Dependencies> = {}) {
  assertClosureAccess(context, 'reopen');
  const deps = { ...defaults, ...injected };
  const { at, clockSource } = await actInstant(deps.clock);
  const ref = deps.hrDb.collection(CLOSURES).doc(closureKey(context.workspace_id, competence));
  return deps.hrDb.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const current = snapshot.exists ? snapshot.data() as ClosureRecord : null;
    if (current?.status !== 'closed') throw fail('PTRP_CLOSURE_NOT_CLOSED', 'Esta competência não está fechada.', 'CONFLICT');
    if (current.version !== input.expectedVersion) throw fail('PTRP_CLOSURE_VERSION_CONFLICT', 'O fechamento mudou desde a sua leitura. Atualize e confira.', 'CONFLICT');
    const record: ClosureRecord = { ...current, status: 'open', updatedAt: at,
      reopenings: [...current.reopenings, { at, by: context.decoded.uid, reason: input.reason, fromVersion: current.version, clockSource }] };
    tx.set(ref, record);
    return record;
  });
}
