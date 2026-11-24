import 'server-only';
import { createHash } from 'node:crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { repPDbAdmin } from '@/lib/firebase-rep-p-admin';
import { readPersonAlertSources } from './closure-alert-check.server';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { AppError } from '@/lib/observability/app-error';
import { canAccessUnit } from '@/lib/unit-access';
import { canReview, closureKey, CLOSURES, type AdjustmentRecord } from './service.server';
import type { DayCorrection, DayCorrectionInput } from './day-corrections';

type Dependencies = { mainDb: Firestore; hrDb: Firestore; repDb: Firestore; now: () => Date };
const defaults: Dependencies = { mainDb: dbAdmin, hrDb: hrDbAdmin, repDb: repPDbAdmin, now: () => new Date() };
const corrections = (db: Firestore) => db.collection('ptrp_dayCorrections');
function closureReference(db: Firestore, workspaceId: string, date: string) {
  return db.collection(CLOSURES).doc(closureKey(workspaceId, date));
}
const events = (db: Firestore) => db.collection('ptrp_dayCorrectionEvents');
const adjustments = (db: Firestore) => db.collection('ptrp_adjustmentRequests');
function fail(message: string, kind: 'AUTHORIZATION' | 'CONFLICT' | 'NOT_FOUND' = 'CONFLICT') {
  return new AppError({ code: 'PTRP_DAY_CORRECTION_' + kind, kind, safeMessage: message });
}
function reviewer(actor: ServerUserContext, uid: string) {
  if (actor.decoded.uid === uid || !canReview(actor) || (!actor.isDefaultAdmin && actor.permissions.dp?.timeClosure?.close !== true)) {
    throw fail('Sem permissão para devolver ou decidir este dia.', 'AUTHORIZATION');
  }
}
async function assertReviewerScope(actor: ServerUserContext, uid: string, deps: Dependencies, frozenUnits?: string[]) {
  reviewer(actor, uid);
  if (frozenUnits) {
    if (!frozenUnits.length || frozenUnits.some((unit) => !canAccessUnit(actor.userDoc, unit, { isDefaultAdmin: actor.isDefaultAdmin }))) {
      throw fail('Pedido fora do seu escopo de unidades.', 'AUTHORIZATION');
    }
    return frozenUnits;
  }
  const user = await deps.mainDb.collection('users').doc(uid).get();
  if (!user.exists) throw fail('Pessoa não encontrada.', 'NOT_FOUND');
  const units = user.get('unitIds');
  return Array.isArray(units) ? units as string[] : [];

}
export async function authorizeDayCorrection(actor: ServerUserContext, input: DayCorrectionInput | { month: string; employeeUid?: string }) {
  if ('month' in input) {
    if (input.employeeUid && input.employeeUid !== actor.decoded.uid) {
      reviewer(actor, input.employeeUid);
    }
    return;
  }
  if (input.action === 'request') {
    await assertReviewerScope(actor, input.employeeUid, defaults);
    return;
  }
  const record = (await corrections(defaults.hrDb).doc(input.id).get()).data() as DayCorrection | undefined;
  if (!record || record.workspaceId !== actor.workspace_id) throw fail('Pedido não encontrado.', 'NOT_FOUND');
  if (input.action === 'respond') {
    if (record.employeeUid !== actor.decoded.uid) throw fail('Somente o titular pode responder.', 'AUTHORIZATION');
  } else await assertReviewerScope(actor, record.employeeUid, defaults, record.unitIds);
}
export async function listDayCorrections(actor: ServerUserContext, month: string, employeeUid?: string, injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  const uid = employeeUid ?? actor.decoded.uid;
  if (uid !== actor.decoded.uid) reviewer(actor, uid);
  const docs = await corrections(deps.hrDb).where('workspaceId', '==', actor.workspace_id)
    .where('employeeUid', '==', uid).where('competence', '==', month).limit(32).get();
  return { items: docs.docs.map((doc) => doc.data() as DayCorrection).filter((item) =>
    uid === actor.decoded.uid || item.unitIds.every((unit) => canAccessUnit(actor.userDoc, unit, { isDefaultAdmin: actor.isDefaultAdmin }))) };
}
export async function actOnDayCorrection(actor: ServerUserContext, input: DayCorrectionInput, injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  const id = input.action === 'request'
    ? createHash('sha256').update(JSON.stringify([actor.workspace_id, input.employeeUid, input.workDate])).digest('hex')
    : input.id;
  const ref = corrections(deps.hrDb).doc(id);
  const before = await ref.get();
  const previous = before.data() as DayCorrection | undefined;
  const uid = input.action === 'request' ? input.employeeUid : previous?.employeeUid;
  if (!uid || previous && previous.workspaceId !== actor.workspace_id) throw fail('Pedido não encontrado.', 'NOT_FOUND');
  let units: string[] | undefined;
  if (input.action === 'respond') {
    if (uid !== actor.decoded.uid) throw fail('Somente o titular pode responder.', 'AUTHORIZATION');
  } else units = await assertReviewerScope(actor, uid, deps, previous?.unitIds);
  const workDate = input.action === 'request' ? input.workDate : previous!.workDate;
  if (input.action === 'request') {
    const sources = await readPersonAlertSources(deps, actor.workspace_id, workDate.slice(0, 7), uid);
    const dayUnits = [...sources.schedule.shifts.filter((shift) => shift.date === workDate).map((shift) => shift.unitId),
      ...sources.markings.filter((marking) => marking.workDate === workDate).map((marking) => marking.executionUnitId)];
    units = [...new Set(dayUnits.filter((unit): unit is string => Boolean(unit)))];
    if (!units.length) units = [...sources.fallbackUnits];
    if (!units.length || units.some((unit) => !canAccessUnit(actor.userDoc, unit, { isDefaultAdmin: actor.isDefaultAdmin }))) {
      throw fail('O dia envolve unidades fora do seu escopo.', 'AUTHORIZATION');
    }
    const unitDocs = await deps.mainDb.getAll(...units.map((unit) => deps.mainDb.collection('dp_units').doc(unit)));
    for (const unit of unitDocs) {
      const zone = unit.get('timeZone') ?? 'America/Fortaleza';
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(deps.now());
      if (workDate >= today) throw fail('Escolha um dia encerrado no fuso da unidade.');
    }
  }
  const result = await deps.hrDb.runTransaction(async (tx) => {
    const [fresh, closure] = await Promise.all([tx.get(ref), tx.get(closureReference(deps.hrDb, actor.workspace_id, workDate))]);
    const current = fresh.data() as DayCorrection | undefined;
    if (closure.get('status') === 'closed') throw fail('Reabra a competência antes de devolver ou responder este dia.');
    if (input.action === 'request' && current?.status === 'requested' && current.reason === input.reason) return current;
    const last = current?.history.at(-1);
    if (input.action !== 'request' && current?.version === input.expectedVersion + 1
      && last?.action === input.action && last.actorUid === actor.decoded.uid && last.reason === input.reason
      && (input.action !== 'respond' || current.adjustmentId === (input.adjustmentId ?? null))) return current;
    if (input.action === 'request' && current && current.status !== 'resolved') throw fail('Já existe uma devolução em andamento neste dia.');
    if (input.action !== 'request' && (!current || current.version !== input.expectedVersion)) throw fail('O pedido mudou. Atualize a tela.');
    if (input.action === 'cancel' && current!.status === 'resolved') throw fail('Esta devolução já foi concluída.');
    let adjustmentId = input.action === 'request' ? null : current?.adjustmentId ?? null;
    if (input.action === 'respond') {
      if (current!.status !== 'requested') throw fail('Esta resposta já foi enviada.');
      adjustmentId = input.adjustmentId ?? null;
    } else if (input.action !== 'request' && input.action !== 'cancel' && current!.status !== 'responded') throw fail('Aguarde a resposta do colaborador.');
    if (adjustmentId) {
      const adjustment = (await tx.get(adjustments(deps.hrDb).doc(adjustmentId))).data() as AdjustmentRecord | undefined;
      if (!adjustment || adjustment.workspaceId !== actor.workspace_id || adjustment.employeeUid !== uid || adjustment.workDate !== workDate) {
        throw fail('O ajuste precisa pertencer à pessoa e ao dia devolvido.');
      }
      if (input.action === 'accept' && adjustment.status !== 'approved') throw fail('Decida e aprove o ajuste antes de concluir a devolução.');
    }
    const at = deps.now().toISOString();
    const value: DayCorrection = {
      id, workspaceId: actor.workspace_id, employeeUid: uid, workDate, competence: workDate.slice(0, 7),
      unitIds: input.action === 'request' ? units! : current!.unitIds,
      status: input.action === 'accept' || input.action === 'cancel' ? 'resolved' : input.action === 'respond' ? 'responded' : 'requested',
      version: (current?.version ?? 0) + 1,
      reason: input.action === 'request' || input.action === 'return' ? input.reason : current!.reason,
      response: input.action === 'request' ? null : input.action === 'respond' ? input.reason : current!.response,
      adjustmentId: input.action === 'request' ? null : adjustmentId,
      actorKeys: [...new Set([...(current?.actorKeys ?? []), 'main.users:' + actor.decoded.uid])],
      requestedBy: input.action === 'request' ? actor.decoded.uid : current!.requestedBy, updatedAt: at,
      history: [...(current?.history ?? []).slice(-99), { action: input.action, actorUid: actor.decoded.uid, reason: input.reason, at, adjustmentId }],
    };
    tx.create(events(deps.hrDb).doc(id + '_' + value.version), {
      id: id + '_' + value.version, correctionId: id, workspaceId: actor.workspace_id,
      employeeUid: uid, actorUid: actor.decoded.uid, unitIds: value.unitIds, workDate,
      version: value.version, action: input.action, reason: input.reason, adjustmentId, at,
    });
    tx.set(ref, value);
    return value;
  });
  if (input.action === 'request' || input.action === 'return') {
    const notification = deps.mainDb.collection('userNotifications').doc('day-correction-' + result.id + '-' + result.version);
    await deps.mainDb.runTransaction(async (tx) => {
      const existing = await tx.get(notification);
      if (!existing.exists) tx.create(notification, {
        ownerUid: uid, workspaceId: actor.workspace_id,
        eventId: result.id + '-' + result.version, sourceEventId: result.id,
        title: 'Correção de ponto solicitada',
        body: 'O RH pediu que você confira o dia ' + workDate.split('-').reverse().join('/') + '.',
        path: '/dashboard/collaborator/time-recording', readAt: null, createdAt: result.updatedAt,
      });
    });
  }
  return result;
}
export async function assertNoPendingDayCorrections(db: Firestore, tx: Transaction, workspaceId: string, competence: string) {
  const docs = await tx.get(corrections(db).where('workspaceId', '==', workspaceId).where('competence', '==', competence)
    .where('status', 'in', ['requested', 'responded']).limit(1));
  if (!docs.empty) throw fail('Há dias devolvidos ao colaborador ainda sem conclusão do RH.');
}
