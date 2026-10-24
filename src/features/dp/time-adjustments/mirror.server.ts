import 'server-only';

import type { Firestore } from 'firebase-admin/firestore';

import { resolveEmploymentReferenceForSystem } from '@/features/dp/employment-reference/service.server';
import { configuredRepPClock } from '@/features/dp/rep-p/hlb-ntp-clock.server';
import { readRepPMonthOfPerson } from '@/features/dp/rep-p/own-month.server';
import { readRepPMarkingsForMirror } from '@/features/dp/rep-p/service.server';
import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { repPDbAdmin } from '@/lib/firebase-rep-p-admin';
import { AppError } from '@/lib/observability/app-error';
import { canAccessUserByUnit } from '@/lib/unit-access';

import { competenceRange, normalizeClosurePerson, type ClosurePerson } from './closure-core';
import { assertClosureAccess, type ClosureRecord } from './closure.server';
import { buildMirrorSnapshot, MIRROR_RENDERER_VERSION, mirrorSnapshotHash, type MirrorAgreement, type MirrorSnapshot } from './mirror-core';
import { mirrorFileName, renderMirrorPdf } from './mirror-pdf';
import type { MirrorActionInput } from './schemas';
import { actInstant, CLOSURES, closureKey } from './service.server';

type Clock = { read(): Promise<{ instant: Date }> };
type Dependencies = { mainDb: Firestore; hrDb: Firestore; repDb: Firestore; clock: Clock };
const unavailableClock: Clock = { async read() { throw new Error('Hora Legal não configurada.'); } };
const defaults: Dependencies = { mainDb: dbAdmin, hrDb: hrDbAdmin, repDb: repPDbAdmin, clock: configuredRepPClock() ?? unavailableClock };
type MirrorRecord = { snapshot: MirrorSnapshot; snapshotHash: string; rendererVersion: string; createdAt: string; createdBy: string; agreement: MirrorAgreement | null };

function fail(code: string, safeMessage: string, kind: 'VALIDATION' | 'CONFLICT' | 'AUTHORIZATION' | 'NOT_FOUND' = 'VALIDATION') {
  return new AppError({ code, kind, safeMessage });
}
/** O próprio espelho é do titular; outro exige fechamento e uma unidade visível ao operador. */
async function subject(deps: Dependencies, context: ServerUserContext, employeeUid?: string, need: 'read' | 'close' = 'read') {
  if (!employeeUid || employeeUid === context.decoded.uid) return context.decoded.uid;
  assertClosureAccess(context, need);
  const employee = await deps.mainDb.collection('users').doc(employeeUid).get();
  if (!employee.exists || !canAccessUserByUnit(context.userDoc, employee.data() ?? {}, { isDefaultAdmin: context.isDefaultAdmin })) {
    throw fail('PTRP_MIRROR_SUBJECT_NOT_FOUND', 'Pessoa não encontrada.', 'NOT_FOUND');
  }
  return employeeUid;
}
function refs(deps: Dependencies, workspaceId: string, competence: string, version: number, uid: string) {
  const closure = deps.hrDb.collection(CLOSURES).doc(closureKey(workspaceId, competence));
  const versionRef = closure.collection('versions').doc(String(version));
  return { closure, person: versionRef.collection('people').doc(uid), mirror: versionRef.collection('mirrors').doc(uid) };
}
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;

/** Situação do pacote do fechamento; a recusa vem da solicitação de assinatura (webhook genérico da Autentique). */
async function packageStatus(hrDb: Firestore, pack: { status: string; signatureRequestId: string; sentAt?: string | null; signedAt?: string | null }) {
  const refused = pack.status === 'sent' && (await hrDb.collection('hrSignatureRequests').doc(pack.signatureRequestId).get()).get('status') === 'rejected';
  return { status: refused ? 'refused' : pack.status, sentAt: pack.sentAt ?? null, signedAt: pack.signedAt ?? null };
}

/** Situação do espelho da pessoa no mês: só leitura, sem gerar nada. */
export async function readMirrorStatus(context: ServerUserContext, competence: string, employeeUid?: string, injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  const uid = await subject(deps, context, employeeUid);
  const closure = (await deps.hrDb.collection(CLOSURES).doc(closureKey(context.workspace_id, competence)).get()).data() as ClosureRecord | undefined;
  if (closure?.status !== 'closed') return { competence, closure: closure ? { status: closure.status, version: closure.version } : null, mirror: null };
  const target = refs(deps, context.workspace_id, competence, closure.version, uid);
  const [mirror, pack] = await Promise.all([target.mirror.get(), target.closure.collection('versions').doc(String(closure.version)).collection('packages').doc(uid).get()]);
  const record = mirror.data() as MirrorRecord | undefined;
  return { competence, closure: { status: closure.status, version: closure.version },
    mirror: record ? { snapshotHash: record.snapshotHash, generatedAt: record.snapshot.generatedAt, agreement: record.agreement } : null,
    // Situação da assinatura do pacote do fechamento (espelho e contracheque) na Autentique.
    package: pack.exists ? await packageStatus(deps.hrDb, pack.data() as { status: string; signatureRequestId: string; sentAt?: string | null; signedAt?: string | null }) : null };
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
    .concat((declaration?.absences ?? []).map((item) => item.decidedBy))
    .concat((declaration?.shiftSwaps ?? []).flatMap((item) => item.acts.map((act) => act.actorUid)))
    .filter((value): value is string => Boolean(value)))].slice(0, 100);
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
  const uid = await subject(deps, context, input.employeeUid, 'close');
  const closureRef = deps.hrDb.collection(CLOSURES).doc(closureKey(context.workspace_id, input.competence));
  const closure = (await closureRef.get()).data() as ClosureRecord | undefined;
  if (closure?.status !== 'closed') throw fail('PTRP_MIRROR_NOT_CLOSED', 'O espelho sai depois do fechamento do mês.', 'CONFLICT');
  if (closure.version !== input.expectedVersion) throw fail('PTRP_CLOSURE_VERSION_CONFLICT', 'O fechamento mudou desde a sua leitura. Atualize e confira.', 'CONFLICT');
  const target = refs(deps, context.workspace_id, input.competence, closure.version, uid);
  const existing = (await target.mirror.get()).data() as MirrorRecord | undefined;
  if (existing) return existing;
  const rawDeclaration = (await target.person.get()).data() as ClosurePerson | undefined;
  const declaration = rawDeclaration ? normalizeClosurePerson(rawDeclaration) : null;
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

/** PDF do espelho já gerado, sem gravar nada; o arquivo é sempre derivado do instantâneo. */
export async function mirrorPdf(context: ServerUserContext, competence: string, employeeUid?: string, injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  const uid = await subject(deps, context, employeeUid);
  const closure = (await deps.hrDb.collection(CLOSURES).doc(closureKey(context.workspace_id, competence)).get()).data() as ClosureRecord | undefined;
  if (closure?.status !== 'closed') throw fail('PTRP_MIRROR_NOT_CLOSED', 'O espelho sai depois do fechamento do mês.', 'NOT_FOUND');
  const record = (await refs(deps, context.workspace_id, competence, closure.version, uid).mirror.get()).data() as MirrorRecord | undefined;
  if (!record) throw fail('PTRP_MIRROR_NOT_FOUND', 'Espelho ainda não gerado.', 'NOT_FOUND');
  return { filename: mirrorFileName(record.snapshot), bytes: await renderMirrorPdf(record.snapshot, record.snapshotHash, record.agreement) };
}
