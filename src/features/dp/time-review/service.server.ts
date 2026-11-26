import 'server-only';
import { assertTimeReviewEnabled, timeReviewEnabled } from '@/features/dp/time-config/rollout.server';

import { createHash } from 'node:crypto';

import type { ServerUserContext } from '@/lib/auth-server';
import { hasPublishedScheduleVersion } from '@/lib/dp-schedule-publication';
import { dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { AppError } from '@/lib/observability/app-error';
import { reportSystemError } from '@/lib/observability/reporter';
import { canAccessUserByUnit } from '@/lib/unit-access';

import type { DayView } from '@/features/dp/rep-p/day-model';
import { canReadEmployeeTimeRecording } from '@/features/dp/rep-p/employee-time-access.server';
import { businessToday, DAY_ALGORITHM_VERSION } from '@/features/dp/rep-p/month-days';
import { readPersonMonthDays } from '@/features/dp/rep-p/time-recording-month.server';
import { readOfficialScheduleShifts } from '@/features/dp/schedules/official-revision.server';
import { assertCoverageCompetenceOpen } from '@/features/dp/absences/coverage/service.server';
import { isBrazilTimeZone } from '@/features/dp/rep-p/time-zones';
import { isWindowlessFlexibleShift } from '@/features/dp/schedules/split-journey';
import { automaticAbsenceDayDeadline } from '@/features/dp/time-adjustments/automatic-absence-core';
import { sendUserPush } from '@/features/mobile/push/send.server';

import {
  addDays, canMarkReviewed, DP_REVIEW_REASONS, dailyNoticeBody, monthlyNoticeBody, reopenedNoticeBody, previousMonth, reminderWeek, resolutionOf,
  seriousIncidents, toReviewView, triggersFor, weeklyNoticeBody,
  type AbsenceDue, type DPReviewReason, type TimeReviewRequest,
} from './core';

const BUSINESS_ZONE = 'America/Fortaleza';
const SCHEDULE_LIMIT = 200;
const OPEN_LIMIT = 500;
const BELL_PATH = '/dashboard/collaborator/time-recording';
/** Caminho aceito pelo push do Coala Go hoje (`safePushPath`); a etapa 6 leva direto ao Ponto. */
const PUSH_PATH = '/dashboard/collaborator';

const requests = () => hrDbAdmin.collection('dp_timeReviewRequests');
const notifications = () => dbAdmin.collection('userNotifications');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export function reviewRequestId(workspaceId: string, employeeUid: string, date: string) {
  return hash(`${workspaceId}|${employeeUid}|${date}`).slice(0, 40);
}

function stableUuid(value: string) {
  const hex = hash(value).slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function fail(code: string, safeMessage: string, kind: 'VALIDATION' | 'AUTHORIZATION' | 'NOT_FOUND' | 'CONFLICT' = 'VALIDATION') {
  return new AppError({ code, kind, safeMessage });
}

/** Aviso no sino (idempotente pela chave) e push genérico; falha do push não desfaz o aviso. */
async function notify(workspaceId: string, uid: string, key: string, body: string, now: Date) {
  if (!timeReviewEnabled()) return false;
  const id = hash(`time-review:${key}:${uid}`);
  const eventId = stableUuid(`time-review:${key}:${uid}`);
  const ref = notifications().doc(id);
  const created = await dbAdmin.runTransaction(async (tx) => {
    if ((await tx.get(ref)).exists) return false;
    tx.create(ref, { ownerUid: uid, workspaceId, eventId, sourceEventId: `time-review:${key}`, title: 'Registro de ponto', body,
      path: BELL_PATH, readAt: null, createdAt: now.toISOString() });
    return true;
  });
  if (!created) return false;
  await sendUserPush({ workspaceId, recipientUid: uid, eventId, path: PUSH_PATH }).catch((error) => {
    reportSystemError({ error, source: 'time-review', operation: 'push', code: 'TIME_REVIEW_PUSH_FAILED', kind: 'TRANSIENT_EXTERNAL',
      severity: 'low', isTerminal: false, metadata: { key } });
  });
  return true;
}

type Shift = { uid: string; date: string; startTime: string; endTime: string; overnight: boolean; windowless: boolean; unitId: string | null };

/** Turnos de trabalho publicados do mês (a mesma varredura limitada da falta automática). */
async function publishedWorkShifts(month: string) {
  const schedules = await dbAdmin.collection('dp_schedules').where('year', '==', Number(month.slice(0, 4)))
    .where('month', '==', Number(month.slice(5, 7))).limit(SCHEDULE_LIMIT + 1).get();
  if (schedules.size > SCHEDULE_LIMIT) throw new Error('TIME_REVIEW_SCHEDULE_SCAN_TRUNCATED');
  const rows = await Promise.all(schedules.docs.filter((schedule) => hasPublishedScheduleVersion(schedule.data() ?? {}))
    .map(async (schedule) => (await readOfficialScheduleShifts({ scheduleId: schedule.id, db: dbAdmin })).shifts
      .filter((shift) => shift.type === 'work' && typeof shift.userId === 'string' && typeof shift.date === 'string'
        && typeof shift.startTime === 'string' && typeof shift.endTime === 'string')
      .map((shift): Shift => ({ uid: String(shift.userId), date: String(shift.date), startTime: String(shift.startTime),
        endTime: String(shift.endTime), overnight: shift.overnight === true, windowless: isWindowlessFlexibleShift(shift),
        // Mesmo fallback da rotina de falta: unidade do turno ou, sem ela, a da escala.
        unitId: typeof shift.unitId === 'string' ? shift.unitId : typeof schedule.get('unitId') === 'string' ? String(schedule.get('unitId')) : null }))));
  return rows.flat();
}

/** Lê o mês da pessoa uma vez por execução e devolve o dia pedido e os estados dos ajustes do dia. */
function personMonthCache(workspaceId: string, today: string) {
  const cache = new Map<string, Promise<{ days: Map<string, DayView>; adjustments: Map<string, string[]> } | null>>();
  return (uid: string, month: string) => {
    const key = `${uid}|${month}`;
    if (!cache.has(key)) {
      cache.set(key, (async () => {
        const user = await dbAdmin.collection('users').doc(uid).get();
        if (!user.exists || user.get('isActive') === false) return null;
        const hrEmployeeId = typeof user.get('hrEmployeeId') === 'string' ? String(user.get('hrEmployeeId')) : null;
        const result = await readPersonMonthDays({ workspaceId, uid, hrEmployeeId, month, today });
        const adjustments = new Map<string, string[]>();
        for (const item of result.adjustments) adjustments.set(item.workDate, [...(adjustments.get(item.workDate) ?? []), item.status]);
        return { days: new Map(result.monthDays.days.map((day) => [day.date, day])), adjustments };
      })());
    }
    return cache.get(key)!;
  };
}

/**
 * Rotina diária (08:00, horário de São Luís). Sempre: abre pedidos para os dias de ontem com erro grave e reavalia
 * os pedidos abertos (resolve quando há ajuste, ausência ou o erro sumiu). Sábado: lembrete da semana. Dia 1º:
 * resumo do mês anterior. Só avisa; não cria batida, ajuste nem falta.
 */
export async function runTimeReviewJob(workspaceId: string, injected: { now?: Date } = {}) {
  if (!timeReviewEnabled()) return { evaluated: 0, opened: 0, reopened: 0, resolved: 0, notified: 0, skipped: true };
  const now = injected.now ?? new Date();
  const today = businessToday(now);
  const yesterday = addDays(today, -1);
  const triggers = triggersFor(today);
  const monthOf = personMonthCache(workspaceId, today);
  const at = now.toISOString();
  const stats = { evaluated: 0, opened: 0, reopened: 0, resolved: 0, notified: 0 };

  // 1. Dias de ontem com erro grave.
  const shifts = (await publishedWorkShifts(yesterday.slice(0, 7))).filter((shift) => shift.date === yesterday);
  const byPerson = new Map<string, Shift[]>();
  for (const shift of shifts) byPerson.set(shift.uid, [...(byPerson.get(shift.uid) ?? []), shift]);
  const openedYesterday = new Map<string, Array<{ date: string; incidents: DayView['incidents']; automaticAbsence: AbsenceDue }>>();
  const unitZones = new Map<string, string>();
  const zoneOf = async (unitId: string | null) => {
    if (!unitId) return BUSINESS_ZONE;
    if (!unitZones.has(unitId)) {
      const unit = await dbAdmin.collection('dp_units').doc(unitId).get();
      unitZones.set(unitId, isBrazilTimeZone(unit.get('timeZone')) ? String(unit.get('timeZone')) : BUSINESS_ZONE);
    }
    return unitZones.get(unitId)!;
  };
  for (const [uid, own] of byPerson) {
    const month = await monthOf(uid, yesterday.slice(0, 7));
    const day = month?.days.get(yesterday);
    if (!month || !day) continue;
    stats.evaluated += 1;
    const serious = seriousIncidents(day);
    if (!serious.length || resolutionOf({ origin: 'system' }, day, month.adjustments.get(yesterday) ?? [])) continue;
    const ref = requests().doc(reviewRequestId(workspaceId, uid, yesterday));
    const outcome = await hrDbAdmin.runTransaction(async (tx) => {
      const current = await tx.get(ref);
      if (!current.exists) {
        const value: TimeReviewRequest = { workspaceId, employeeUid: uid, date: yesterday,
          unitIds: [...new Set(own.map((shift) => shift.unitId).filter((id): id is string => Boolean(id)))],
          status: 'open', origin: 'system', reason: null, requestedBy: null, incidents: serious, algorithmVersion: DAY_ALGORITHM_VERSION,
          createdAt: at, updatedAt: at, reviewedAt: null, resolvedAt: null, resolution: null };
        tx.create(ref, value);
        return 'opened' as const;
      }
      // Erro de volta (ajuste recusado, ausência recusada ou batida desconsiderada): o pedido resolvido reabre.
      if (current.get('status') === 'resolved') {
        tx.update(ref, { status: 'open', incidents: serious, algorithmVersion: DAY_ALGORITHM_VERSION, updatedAt: at, resolvedAt: null, resolution: null });
        return 'reopened' as const;
      }
      return 'kept' as const;
    });
    if (outcome === 'kept') continue;
    stats[outcome] += 1;
    // Mesmo prazo da rotina de falta: maior entre os turnos, flexível sem janela, fuso da unidade do primeiro turno.
    const deadline = serious.includes('missing') ? automaticAbsenceDayDeadline(yesterday, own, await zoneOf(own[0]?.unitId ?? null)) : null;
    openedYesterday.set(uid, [...(openedYesterday.get(uid) ?? []), { date: yesterday, incidents: serious,
      automaticAbsence: deadline ? { dueAt: deadline.dueAt, expired: Date.parse(deadline.dueAt) <= now.getTime() } : null }]);
  }

  // 2. Reavaliação dos pedidos abertos e dos resolvidos por ajuste ou ausência (até 62 dias).
  const truncated = (kind: string, size: number) => {
    if (size < OPEN_LIMIT) return;
    reportSystemError({ error: new Error('TIME_REVIEW_SCAN_TRUNCATED'), source: 'time-review', operation: 'scan',
      code: 'TIME_REVIEW_SCAN_TRUNCATED', kind: 'DATA_INTEGRITY', severity: 'medium', isTerminal: false, metadata: { kind, limit: OPEN_LIMIT } });
  };
  const open = await requests().where('workspaceId', '==', workspaceId).where('status', '==', 'open')
    .where('date', '>=', addDays(today, -62)).orderBy('date').limit(OPEN_LIMIT).get();
  truncated('open', open.size);
  for (const doc of open.docs) {
    const request = doc.data() as TimeReviewRequest;
    const month = await monthOf(request.employeeUid, request.date.slice(0, 7));
    const day = month?.days.get(request.date);
    if (!month || !day) continue;
    const resolution = resolutionOf(request, day, month.adjustments.get(request.date) ?? []);
    if (!resolution) continue;
    // Transação com pré-condição: um "Revisei" feito no meio da rotina não é sobrescrito.
    const changed = await hrDbAdmin.runTransaction(async (tx) => {
      const current = await tx.get(doc.ref);
      if (current.get('status') !== 'open') return false;
      tx.update(doc.ref, { status: 'resolved', resolution, resolvedAt: at, updatedAt: at });
      return true;
    });
    if (changed) stats.resolved += 1;
  }
  const resolved = await requests().where('workspaceId', '==', workspaceId).where('status', '==', 'resolved')
    .where('date', '>=', addDays(today, -62)).orderBy('date').limit(OPEN_LIMIT).get();
  truncated('resolved', resolved.size);
  for (const doc of resolved.docs) {
    const request = doc.data() as TimeReviewRequest;
    // Ontem já foi tratado no passo 1. Pedido do DP só reabre se o ajuste ou a ausência que o resolveu caiu.
    if (request.date >= yesterday || (request.origin === 'dp' && request.resolution === 'incident_cleared')) continue;
    const month = await monthOf(request.employeeUid, request.date.slice(0, 7));
    const day = month?.days.get(request.date);
    if (!month || !day) continue;
    const serious = seriousIncidents(day);
    if ((request.origin === 'system' && !serious.length) || resolutionOf(request, day, month.adjustments.get(request.date) ?? [])) continue;
    const reopened = await hrDbAdmin.runTransaction(async (tx) => {
      const current = await tx.get(doc.ref);
      if (current.get('status') !== 'resolved') return false;
      tx.update(doc.ref, { status: 'open', incidents: serious, algorithmVersion: DAY_ALGORITHM_VERSION, updatedAt: at, resolvedAt: null, resolution: null });
      return true;
    });
    if (!reopened) continue;
    stats.reopened += 1;
    if (await notify(workspaceId, request.employeeUid, `reopen:${doc.id}:${today}`, reopenedNoticeBody(request.date), now)) {
      stats.notified += 1;
    }
  }

  // 3. Avisos.
  for (const [uid, days] of openedYesterday) {
    if (await notify(workspaceId, uid, `daily:${yesterday}`, dailyNoticeBody(days), now)) stats.notified += 1;
  }
  const remind = async (kind: string, start: string, end: string, body: (count: number) => string) => {
    const pending = await requests().where('workspaceId', '==', workspaceId).where('status', '==', 'open')
      .where('date', '>=', start).where('date', '<=', end).orderBy('date').limit(OPEN_LIMIT).get();
    truncated(kind, pending.size);
    const counts = new Map<string, number>();
    for (const doc of pending.docs) counts.set(String(doc.get('employeeUid')), (counts.get(String(doc.get('employeeUid'))) ?? 0) + 1);
    for (const [uid, count] of counts) if (await notify(workspaceId, uid, `${kind}:${start}`, body(count), now)) stats.notified += 1;
  };
  if (triggers.weekly) {
    const week = reminderWeek(today);
    await remind('weekly', week.start, week.end, weeklyNoticeBody);
  }
  if (triggers.monthly) {
    const month = previousMonth(today);
    await remind('monthly', `${month}-01`, `${month}-31`, (count) => monthlyNoticeBody(count, month));
  }
  return { today, ...stats, triggers };
}

/** "Revisei este dia": só a titular, só pedido aberto, nunca em dia ímpar ou sem batidas. Não altera batida. */
export async function markReviewRequestReviewed(context: ServerUserContext, requestId: string) {
  assertTimeReviewEnabled();
  const ref = requests().doc(requestId);
  const snapshot = await ref.get();
  const request = snapshot.data() as TimeReviewRequest | undefined;
  if (!request || request.workspaceId !== context.workspace_id || request.employeeUid !== context.decoded.uid) {
    throw fail('TIME_REVIEW_NOT_FOUND', 'Pedido de revisão não encontrado.', 'NOT_FOUND');
  }
  if (request.status !== 'open') throw fail('TIME_REVIEW_NOT_OPEN', 'Este pedido já foi tratado.', 'CONFLICT');
  const hrEmployeeId = typeof context.userDoc.hrEmployeeId === 'string' ? context.userDoc.hrEmployeeId : null;
  const month = await readPersonMonthDays({ workspaceId: context.workspace_id, uid: context.decoded.uid, hrEmployeeId,
    month: request.date.slice(0, 7), today: businessToday() });
  const day = month.monthDays.days.find((item) => item.date === request.date);
  if (!day || !canMarkReviewed(day)) {
    throw fail('TIME_REVIEW_NEEDS_ADJUSTMENT', 'Dia com batida faltando: peça ajuste ou solicite ausência.', 'CONFLICT');
  }
  const at = new Date().toISOString();
  await hrDbAdmin.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    if (current.get('status') !== 'open') throw fail('TIME_REVIEW_NOT_OPEN', 'Este pedido já foi tratado.', 'CONFLICT');
    tx.update(ref, { status: 'reviewed', reviewedAt: at, updatedAt: at });
  });
  return { id: requestId, status: 'reviewed' as const, reviewedAt: at };
}

/** "Pedir revisão" do DP: permissão de conferência, escopo de unidades, mês aberto, motivo da lista, um por dia. */
export async function requestReviewByDp(context: ServerUserContext, employeeUid: string, input: { date: string; reason: DPReviewReason }) {
  if (!canReadEmployeeTimeRecording(context)) throw fail('TIME_REVIEW_FORBIDDEN', 'Sem permissão para pedir revisão.', 'AUTHORIZATION');
  assertTimeReviewEnabled();
  if (!(input.reason in DP_REVIEW_REASONS)) throw fail('TIME_REVIEW_REASON_INVALID', 'Escolha um motivo da lista.');
  const today = businessToday();
  if (input.date >= today) throw fail('TIME_REVIEW_DATE_INVALID', 'Só dá para pedir revisão de dias anteriores.');
  const employee = await dbAdmin.collection('users').doc(employeeUid).get();
  if (!employee.exists || !canAccessUserByUnit(context.userDoc, employee.data() ?? {}, { isDefaultAdmin: context.isDefaultAdmin })) {
    throw fail('TIME_REVIEW_EMPLOYEE_NOT_FOUND', 'Colaborador não encontrado.', 'NOT_FOUND');
  }
  // Mesma leitura do fechamento usada na cobertura de ausência; só a mensagem muda.
  await assertCoverageCompetenceOpen(context.workspace_id, input.date).catch((error: unknown) => {
    if (error instanceof AppError && error.code === 'PTRP_COMPETENCE_CLOSED') {
      throw fail('PTRP_COMPETENCE_CLOSED', 'Este mês já foi fechado; peça a reabertura para pedir revisão.', 'CONFLICT');
    }
    throw error;
  });
  const ref = requests().doc(reviewRequestId(context.workspace_id, employeeUid, input.date));
  const at = new Date().toISOString();
  const result = await hrDbAdmin.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    if (current.exists && current.get('status') === 'open') return { created: false, request: current.data() as TimeReviewRequest };
    const value: TimeReviewRequest = { workspaceId: context.workspace_id, employeeUid, date: input.date,
      unitIds: Array.isArray(employee.get('unitIds')) ? employee.get('unitIds') : [],
      status: 'open', origin: 'dp', reason: input.reason, requestedBy: context.decoded.uid, incidents: [],
      algorithmVersion: DAY_ALGORITHM_VERSION, createdAt: at, updatedAt: at, reviewedAt: null, resolvedAt: null, resolution: null };
    tx.set(ref, value);
    return { created: true, request: value };
  });
  if (result.created) {
    // Auditoria no banco principal, depois da transação do RH (transação não atravessa bancos).
    await dbAdmin.collection('actionLogs').add({ workspace_id: context.workspace_id, user_id: context.decoded.uid,
      module: 'dp.timeReview', action: 'review_requested', metadata: { employeeUid, date: input.date, reason: input.reason },
      timestamp: new Date(), ttl: new Date(Date.now() + 365 * 86_400_000) });
    const body = `O DP pediu uma revisão do dia ${input.date.slice(8, 10)}/${input.date.slice(5, 7)}: ${DP_REVIEW_REASONS[input.reason].toLowerCase()}. A revisão pode ser feita em horário de trabalho.`;
    await notify(context.workspace_id, employeeUid, `dp:${input.date}:${at}`, body, new Date(at));
  }
  return toReviewView(ref.id, result.request);
}
