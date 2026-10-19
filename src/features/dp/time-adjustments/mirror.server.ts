import 'server-only';

import type { Firestore } from 'firebase-admin/firestore';

import { resolveEmploymentReferenceForSystem } from '@/features/dp/employment-reference/service.server';
import { configuredRepPClock } from '@/features/dp/rep-p/hlb-ntp-clock.server';
import { readRepPMonthOfPerson } from '@/features/dp/rep-p/own-month.server';
import { readRepPMarkingsForMirror } from '@/features/dp/rep-p/service.server';
import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { AppError } from '@/lib/observability/app-error';

import { competenceRange, type ClosurePerson } from './closure-core';
import { assertClosureAccess, type ClosureRecord } from './closure.server';
import { buildMirrorSnapshot, MIRROR_RENDERER_VERSION, mirrorIncompleteReason, mirrorSnapshotHash, type MirrorAgreement, type MirrorSnapshot } from './mirror-core';
import { mirrorFileName, renderMirrorPdf } from './mirror-pdf';
import type { MirrorActionInput } from './schemas';
import { actInstant, CLOSURES, closureKey } from './service.server';

type Clock = { read(): Promise<{ instant: Date }> };
type Dependencies = { mainDb: Firestore; hrDb: Firestore; repDb: Firestore; clock: Clock };
const unavailableClock: Clock = { async read() { throw new Error('Hora Legal não configurada.'); } };
const defaults: Dependencies = { mainDb: dbAdmin, hrDb: hrDbAdmin, repDb: hrDbAdmin, clock: configuredRepPClock() ?? unavailableClock };
type MirrorRecord = { snapshot: MirrorSnapshot; snapshotHash: string; rendererVersion: string; createdAt: string; createdBy: string; agreement: MirrorAgreement | null };

function fail(code: string, safeMessage: string, kind: 'VALIDATION' | 'CONFLICT' | 'AUTHORIZATION' | 'NOT_FOUND' = 'VALIDATION') {
  return new AppError({ code, kind, safeMessage });
}
/** O próprio espelho é do titular; ler o de outra pessoa exige o fechamento, e gerar exige poder fechar. */
function subject(context: ServerUserContext, employeeUid?: string, need: 'read' | 'close' = 'read') {
  if (!employeeUid || employeeUid === context.decoded.uid) return context.decoded.uid;
  assertClosureAccess(context, need);
  return employeeUid;
}
function refs(deps: Dependencies, workspaceId: string, competence: string, version: number, uid: string) {
  const closure = deps.hrDb.collection(CLOSURES).doc(closureKey(workspaceId, competence));
  const versionRef = closure.collection('versions').doc(String(version));
  return { closure, person: versionRef.collection('people').doc(uid), mirror: versionRef.collection('mirrors').doc(uid) };
}
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;

/** Situação do espelho da pessoa no mês: só leitura, sem gerar nada. */
export async function readMirrorStatus(context: ServerUserContext, competence: string, employeeUid?: string, injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  const uid = subject(context, employeeUid);
  const closure = (await deps.hrDb.collection(CLOSURES).doc(closureKey(context.workspace_id, competence)).get()).data() as ClosureRecord | undefined;
  if (closure?.status !== 'closed') return { competence, closure: closure ? { status: closure.status, version: closure.version } : null, mirror: null };
  const mirror = (await refs(deps, context.workspace_id, competence, closure.version, uid).mirror.get()).data() as MirrorRecord | undefined;
  return { competence, closure: { status: closure.status, version: closure.version },
    mirror: mirror ? { snapshotHash: mirror.snapshotHash, generatedAt: mirror.snapshot.generatedAt, agreement: mirror.agreement } : null };
}

async function buildSnapshot(deps: Dependencies, workspaceId: string, competence: string, closure: ClosureRecord, uid: string, declaration: ClosurePerson | null) {
  const { start, end } = competenceRange(competence);
  const user = await deps.mainDb.collection('users').doc(uid).get();
  const [arp, month, reference] = await Promise.all([
    readRepPMarkingsForMirror(workspaceId, uid, start, end, { repDb: deps.repDb }),
    readRepPMonthOfPerson([uid, text(user.get('hrEmployeeId'))], competence, { db: deps.mainDb }),
    resolveEmploymentReferenceForSystem({ workspaceId, userId: uid, date: end, database: deps.mainDb }),
  ]);
  const actorIds = [...new Set((declaration?.adjustments ?? []).flatMap((item) => [item.requestedBy, item.decidedBy])
    .concat((declaration?.absences ?? []).map((item) => item.decidedBy)).filter((value): value is string => Boolean(value)))].slice(0, 100);
  const actors = actorIds.length ? await deps.mainDb.getAll(...actorIds.map((id) => deps.mainDb.collection('users').doc(id))) : [];
  const { at, clockSource } = await actInstant(deps.clock);
  const employer = reference.status === 'matched' ? reference.period.employer : null;
  return buildMirrorSnapshot({
    workspaceId, competence, closureVersion: closure.version, manifestHash: closure.manifestHash ?? '', generatedAt: at, clockSource,
    employee: { uid, name: arp.identity?.employeeName ?? declaration?.name ?? text(user.get('username')) ?? 'Colaborador', cpf: arp.identity?.employeeCpf ?? null },
    employer: { legalName: arp.identity?.employerLegalName ?? employer?.unitName ?? null, cnpj: arp.identity?.employerCnpj ?? employer?.cnpj ?? null },
    markings: arp.markings, shifts: month.shifts.map((shift) => ({ date: shift.date, type: shift.type as 'work' | 'day_off', startTime: shift.startTime, endTime: shift.endTime, shiftName: shift.shiftName })),
    declaration, truncated: arp.truncated || month.truncated,
    actors: Object.fromEntries(actors.filter((doc) => doc.exists && text(doc.get('username'))).map((doc) => [doc.id, String(doc.get('username')).slice(0, 120)])),
  });
}

/**
 * Gera o espelho uma única vez por pessoa e versão do fechamento (POST): batidas do REP-P, escala e a declaração
 * congelada. Já existindo, devolve o mesmo; o mês precisa estar fechado na versão esperada.
 */
export async function generateMirror(context: ServerUserContext, input: MirrorActionInput, injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  const uid = subject(context, input.employeeUid, 'close');
  const closureRef = deps.hrDb.collection(CLOSURES).doc(closureKey(context.workspace_id, input.competence));
  const closure = (await closureRef.get()).data() as ClosureRecord | undefined;
  if (closure?.status !== 'closed') throw fail('PTRP_MIRROR_NOT_CLOSED', 'O espelho sai depois do fechamento do mês.', 'CONFLICT');
  if (closure.version !== input.expectedVersion) throw fail('PTRP_CLOSURE_VERSION_CONFLICT', 'O fechamento mudou desde a sua leitura. Atualize e confira.', 'CONFLICT');
  const target = refs(deps, context.workspace_id, input.competence, closure.version, uid);
  const existing = (await target.mirror.get()).data() as MirrorRecord | undefined;
  if (existing) return existing;
  const declaration = ((await target.person.get()).data() as ClosurePerson | undefined) ?? null;
  // Outra pessoa só se estiver na declaração do mês ou cadastrada no sistema (o workspace é único por instalação).
  if (uid !== context.decoded.uid && !declaration && !(await deps.mainDb.collection('users').doc(uid).get()).exists) {
    throw fail('PTRP_MIRROR_SUBJECT_INVALID', 'Pessoa não encontrada.', 'NOT_FOUND');
  }
  const snapshot = await buildSnapshot(deps, context.workspace_id, input.competence, closure, uid, declaration);
  const record: MirrorRecord = { snapshot, snapshotHash: mirrorSnapshotHash(snapshot), rendererVersion: MIRROR_RENDERER_VERSION, createdAt: snapshot.generatedAt, createdBy: context.decoded.uid, agreement: null };
  return deps.hrDb.runTransaction(async (tx) => {
    const [again, current] = await Promise.all([tx.get(target.mirror), tx.get(closureRef)]);
    if (again.exists) return again.data() as MirrorRecord;
    if (current.get('status') !== 'closed' || current.get('version') !== closure.version) throw fail('PTRP_CLOSURE_VERSION_CONFLICT', 'O fechamento mudou durante a geração. Atualize e confira.', 'CONFLICT');
    tx.create(target.mirror, record);
    return record;
  });
}

/** Concordância do titular: uma vez, sobre o instantâneo que ele viu, na versão fechada vigente. */
export async function agreeWithMirror(context: ServerUserContext, input: MirrorActionInput, channel: 'web' | 'mobile', injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  if (input.employeeUid && input.employeeUid !== context.decoded.uid) throw fail('PTRP_MIRROR_AGREEMENT_OWNER', 'Só o próprio trabalhador registra concordância.', 'AUTHORIZATION');
  if (!input.snapshotHash) throw fail('PTRP_MIRROR_HASH_REQUIRED', 'Abra o espelho antes de concordar.');
  const { at, clockSource } = await actInstant(deps.clock);
  const closureRef = deps.hrDb.collection(CLOSURES).doc(closureKey(context.workspace_id, input.competence));
  const target = refs(deps, context.workspace_id, input.competence, input.expectedVersion, context.decoded.uid);
  return deps.hrDb.runTransaction(async (tx) => {
    const [closure, mirror] = await Promise.all([tx.get(closureRef), tx.get(target.mirror)]);
    if (closure.get('status') !== 'closed' || closure.get('version') !== input.expectedVersion) throw fail('PTRP_CLOSURE_VERSION_CONFLICT', 'O fechamento mudou. Abra o espelho atual.', 'CONFLICT');
    const record = mirror.data() as MirrorRecord | undefined;
    if (!record) throw fail('PTRP_MIRROR_NOT_FOUND', 'Abra o espelho antes de concordar.', 'NOT_FOUND');
    if (record.snapshotHash !== input.snapshotHash) throw fail('PTRP_MIRROR_HASH_MISMATCH', 'O espelho não é o que você abriu. Abra de novo.', 'CONFLICT');
    if (record.agreement) return record;
    const incomplete = mirrorIncompleteReason(record.snapshot);
    if (incomplete) throw fail('PTRP_MIRROR_INCOMPLETE', `${incomplete} Procure o DP antes de concordar.`, 'CONFLICT');
    const agreement: MirrorAgreement = { at, clockSource, uid: context.decoded.uid, snapshotHash: record.snapshotHash, channel };
    tx.update(target.mirror, { agreement });
    return { ...record, agreement };
  });
}

/** PDF do espelho já gerado, sem gravar nada; o arquivo é sempre derivado do instantâneo. */
export async function mirrorPdf(context: ServerUserContext, competence: string, employeeUid?: string, injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  const uid = subject(context, employeeUid);
  const closure = (await deps.hrDb.collection(CLOSURES).doc(closureKey(context.workspace_id, competence)).get()).data() as ClosureRecord | undefined;
  if (closure?.status !== 'closed') throw fail('PTRP_MIRROR_NOT_CLOSED', 'O espelho sai depois do fechamento do mês.', 'NOT_FOUND');
  const record = (await refs(deps, context.workspace_id, competence, closure.version, uid).mirror.get()).data() as MirrorRecord | undefined;
  if (!record) throw fail('PTRP_MIRROR_NOT_FOUND', 'Espelho ainda não gerado.', 'NOT_FOUND');
  return { filename: mirrorFileName(record.snapshot), bytes: await renderMirrorPdf(record.snapshot, record.snapshotHash, record.agreement) };
}
