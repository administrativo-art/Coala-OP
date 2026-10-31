import 'server-only';

import { FieldValue, Timestamp, type DocumentSnapshot, type QueryDocumentSnapshot, type Transaction } from 'firebase-admin/firestore';

import { buildGoalClosureBonusSnapshot } from '@/lib/goal-bonus-snapshot';
import { countsDPShiftTowardGoals } from '@/lib/dp-external-coverage';
import { dbAdmin } from '@/lib/firebase-admin';
import { AppError } from '@/lib/observability/app-error';
import type { ServerUserContext } from '@/lib/auth-server';
import { canAccessUnit } from '@/lib/unit-access';
import type { EmployeeGoal, GoalClosureSnapshot, GoalPeriodDoc } from '@/types';
import { resolveGoalDPUnit } from '@/features/goals/unit-resolution.server';
import { readOfficialScheduleShiftsInTransaction } from '@/features/dp/schedules/official-revision.server';

import type { TransitionGoalPeriodInput } from './schemas';

const MAX_PERIOD_MONTHS = 24;
const MAX_EMPLOYEE_GOALS = 200;
const MAX_SHIFTS_PER_SCHEDULE = 500;
const AUDIT_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Belem',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function dateKey(value: unknown) {
  const date = typeof (value as { toDate?: unknown })?.toDate === 'function'
    ? (value as { toDate(): Date }).toDate()
    : value instanceof Date ? value : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return DATE_FORMATTER.format(date);
}

function calendarDateKeys(startKey: string, endKey: string) {
  const result: string[] = [];
  let cursor = new Date(`${startKey}T12:00:00.000Z`);
  const end = new Date(`${endKey}T12:00:00.000Z`);
  while (cursor <= end) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return result;
}

function monthKeysBetween(startKey: string, endKey: string) {
  const [startYear, startMonth] = startKey.split('-').map(Number);
  const [endYear, endMonth] = endKey.split('-').map(Number);
  const result: Array<{ year: number; month: number }> = [];
  let year = startYear;
  let month = startMonth;
  while (year < endYear || (year === endYear && month <= endMonth)) {
    result.push({ year, month });
    if (result.length > MAX_PERIOD_MONTHS) {
      throw new AppError({ code: 'GOAL_PERIOD_RANGE_TOO_LARGE', kind: 'DATA_INTEGRITY', safeMessage: 'O período da meta é longo demais para ser encerrado com segurança.' });
    }
    month += 1;
    if (month === 13) { year += 1; month = 1; }
  }
  return result;
}

function extractShiftTimes(label: string) {
  const match = label.match(/\((\d{2}:\d{2})[–\-](\d{2}:\d{2})\)/u);
  return match ? { start: match[1], end: match[2] } : null;
}

function assertCanManage(context: ServerUserContext, kioskId: string) {
  if (!context.isDefaultAdmin
    && context.permissions.goals.manage !== true
    && context.permissions.settings.manageUsers !== true) {
    throw new AppError({ code: 'GOAL_PERIOD_STATUS_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem permissão para encerrar metas.' });
  }
  if (!canAccessUnit(context.userDoc, kioskId, { isDefaultAdmin: context.isDefaultAdmin })) {
    throw new AppError({ code: 'GOAL_PERIOD_UNIT_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem acesso à unidade desta meta.' });
  }
}

function asGoalPeriod(document: DocumentSnapshot): GoalPeriodDoc {
  return { id: document.id, ...document.data() } as unknown as GoalPeriodDoc;
}

function asEmployeeGoal(document: QueryDocumentSnapshot): EmployeeGoal {
  return { id: document.id, ...document.data() } as unknown as EmployeeGoal;
}

async function loadClosureEvidence(
  transaction: Transaction,
  periodDocument: DocumentSnapshot,
  dpUnitId: string,
) {
  const period = asGoalPeriod(periodDocument);
  const startKey = dateKey(periodDocument.get('startDate'));
  const endKey = dateKey(periodDocument.get('endDate'));
  if (!startKey || !endKey || endKey < startKey) {
    throw new AppError({ code: 'GOAL_PERIOD_DATES_INVALID', kind: 'DATA_INTEGRITY', safeMessage: 'O período da meta possui datas inválidas.' });
  }

  const employeeGoalSnapshot = await transaction.get(
    dbAdmin.collection('employeeGoals').where('periodId', '==', periodDocument.id).limit(MAX_EMPLOYEE_GOALS + 1),
  );
  if (employeeGoalSnapshot.size > MAX_EMPLOYEE_GOALS) {
    throw new AppError({ code: 'GOAL_PERIOD_PARTICIPANT_LIMIT_REACHED', kind: 'DATA_INTEGRITY', safeMessage: 'Há participantes demais para encerrar a meta com segurança.' });
  }
  const employeeGoals = employeeGoalSnapshot.docs.map(asEmployeeGoal);
  const employeeIds = new Set(employeeGoals.map((goal) => goal.employeeId));

  const schedules: QueryDocumentSnapshot[] = [];
  for (const { year, month } of monthKeysBetween(startKey, endKey)) {
    const snapshot = await transaction.get(
      dbAdmin.collection('dp_schedules')
        .where('unitId', '==', dpUnitId)
        .where('year', '==', year)
        .where('month', '==', month)
        .limit(2),
    );
    if (snapshot.size > 1) {
      throw new AppError({ code: 'GOAL_PERIOD_SCHEDULE_AMBIGUOUS', kind: 'DATA_INTEGRITY', safeMessage: 'Há mais de uma escala da unidade na mesma competência.' });
    }
    schedules.push(...snapshot.docs);
  }

  const shiftDocuments: Array<{ get: (field: string) => unknown; data: () => Record<string, unknown> }> = [];
  for (const schedule of schedules) {
    const shifts = await readOfficialScheduleShiftsInTransaction(transaction, schedule);
    if (shifts.length > MAX_SHIFTS_PER_SCHEDULE) {
      throw new AppError({ code: 'GOAL_PERIOD_SHIFT_LIMIT_REACHED', kind: 'DATA_INTEGRITY', safeMessage: 'Há turnos demais para encerrar a meta com segurança.' });
    }
    shiftDocuments.push(...shifts.map((shift) => ({ get: (field: string) => shift[field], data: () => shift })));
  }

  const externalEmployeeIds = new Set<string>();
  for (const shift of shiftDocuments) {
    const userId = String(shift.get('userId') ?? '');
    const shiftDate = String(shift.get('date') ?? '');
    if (!employeeIds.has(userId) || shift.get('type') !== 'work' || shiftDate < startKey || shiftDate > endKey) continue;
    if (!countsDPShiftTowardGoals(shift.data())) externalEmployeeIds.add(userId);
  }
  const eligibleEmployeeGoals = employeeGoals.filter((goal) => !externalEmployeeIds.has(goal.employeeId));
  const eligibleIds = new Set(eligibleEmployeeGoals.map((goal) => goal.employeeId));
  const eligibleWorkShifts = shiftDocuments.filter((shift) => {
    const shiftDate = String(shift.get('date') ?? '');
    return shift.get('type') === 'work'
      && countsDPShiftTowardGoals(shift.data())
      && eligibleIds.has(String(shift.get('userId') ?? ''))
      && shiftDate >= startKey
      && shiftDate <= endKey;
  });

  const calendarKeys = calendarDateKeys(startKey, endKey);
  const scheduledPeriodKeys = [...new Set(eligibleWorkShifts.map((shift) => String(shift.get('date'))))].sort();
  const periodUsesSchedule = period.distributionMode === 'scheduled_days';
  const periodDateKeys = periodUsesSchedule && scheduledPeriodKeys.length > 0 ? scheduledPeriodKeys : calendarKeys;
  const employeeDateKeysByGoalId: Record<string, string[]> = {};
  const employeeDayCountsByGoalId: Record<string, number> = {};
  const employeeDailyTargetsByGoalId: Record<string, number> = {};

  for (const goal of eligibleEmployeeGoals) {
    const goalUsesSchedule = periodUsesSchedule || goal.distributionMode === 'scheduled_days';
    const dates = goalUsesSchedule
      ? [...new Set(eligibleWorkShifts.flatMap((shift) => {
          if (shift.get('userId') !== goal.employeeId) return [];
          if (goal.shiftId) {
            const configured = period.shifts?.find((candidate) => candidate.id === goal.shiftId);
            const times = configured ? extractShiftTimes(configured.label ?? '') : null;
            if (!times || shift.get('startTime') !== times.start || shift.get('endTime') !== times.end) return [];
          }
          return [String(shift.get('date'))];
        }))].sort()
      : [];
    const goalDateKeys = goalUsesSchedule && dates.length > 0 ? dates : calendarKeys;
    const dayCount = Math.max(goalDateKeys.length, 1);
    employeeDateKeysByGoalId[goal.id] = goalDateKeys;
    employeeDayCountsByGoalId[goal.id] = dayCount;
    employeeDailyTargetsByGoalId[goal.id] = goal.targetValue / dayCount;
  }

  const periodDayCount = Math.max(periodDateKeys.length, 1);
  const closureSnapshot: GoalClosureSnapshot = {
    distributionMode: period.distributionMode ?? 'calendar_days',
    periodDateKeys,
    periodDayCount,
    dailyTarget: period.targetValue / periodDayCount,
    dailyUpTarget: (period.upValue ?? period.targetValue * 1.2) / periodDayCount,
    ...(period.topValue ? { dailyTopTarget: period.topValue / periodDayCount } : {}),
    employeeDateKeysByGoalId,
    employeeDayCountsByGoalId,
    employeeDailyTargetsByGoalId,
  };
  return { period, eligibleEmployeeGoals, closureSnapshot, externalEmployeeIds: [...externalEmployeeIds].sort() };
}

export async function transitionGoalPeriod(params: {
  context: ServerUserContext;
  periodId: string;
  input: TransitionGoalPeriodInput;
  requestId: string;
}) {
  const { context, periodId, input, requestId } = params;
  const periodRef = dbAdmin.collection('goalPeriods').doc(periodId);
  const initial = await periodRef.get();
  if (!initial.exists) throw new AppError({ code: 'GOAL_PERIOD_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Período de meta não encontrado.' });
  const kioskId = String(initial.get('kioskId') ?? '');
  assertCanManage(context, kioskId);
  const { dpUnit } = input.status === 'active' ? { dpUnit: null } : await resolveGoalDPUnit(kioskId);

  await dbAdmin.runTransaction(async (transaction) => {
    const fresh = await transaction.get(periodRef);
    if (!fresh.exists) throw new AppError({ code: 'GOAL_PERIOD_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Período de meta não encontrado.' });
    if (fresh.get('kioskId') !== kioskId) throw new AppError({ code: 'GOAL_PERIOD_UNIT_CHANGED', kind: 'CONFLICT', safeMessage: 'A unidade da meta mudou. Atualize a página e tente novamente.' });
    assertCanManage(context, kioskId);
    const now = Timestamp.now();

    if (input.status === 'active') {
      if (fresh.get('status') === 'active') return;
      transaction.update(periodRef, {
        status: 'active',
        closureNote: FieldValue.delete(),
        closedBy: FieldValue.delete(),
        closedAt: FieldValue.delete(),
        closureSnapshot: FieldValue.delete(),
        updatedAt: now,
      });
      transaction.set(dbAdmin.collection('actionLogs').doc(), {
        workspace_id: context.workspace_id,
        user_id: context.decoded.uid,
        username: context.userDoc.username ?? null,
        module: 'goals',
        action: 'goal_period_reopened',
        metadata: { request_id: requestId, period_id: periodId, kiosk_id: kioskId },
        ip_address: null,
        timestamp: now,
        ttl: Timestamp.fromMillis(now.toMillis() + AUDIT_TTL_MS),
      });
      return;
    }

    if (fresh.get('status') !== 'active') {
      throw new AppError({ code: 'GOAL_PERIOD_NOT_ACTIVE', kind: 'CONFLICT', safeMessage: 'Somente uma meta ativa pode ser encerrada ou cancelada.' });
    }
    if (!dpUnit) throw new AppError({ code: 'GOAL_PERIOD_DP_UNIT_REQUIRED', kind: 'DATA_INTEGRITY' });
    const evidence = await loadClosureEvidence(transaction, fresh, dpUnit.id);
    const bonus = input.status === 'closed'
      ? buildGoalClosureBonusSnapshot({
          period: evidence.period,
          employeeGoals: evidence.eligibleEmployeeGoals,
          periodDayCount: evidence.closureSnapshot.periodDayCount,
          source: 'closure',
        })
      : null;
    const closureSnapshot = {
      ...evidence.closureSnapshot,
      ...(bonus ? { bonus: { ...bonus, capturedAt: now } } : {}),
      capturedAt: now,
    };
    transaction.update(periodRef, {
      status: input.status,
      closureNote: input.closureNote,
      closedBy: context.decoded.uid,
      closedAt: now,
      closureSnapshot,
      updatedAt: now,
    });
    transaction.set(dbAdmin.collection('actionLogs').doc(), {
      workspace_id: context.workspace_id,
      user_id: context.decoded.uid,
      username: context.userDoc.username ?? null,
      module: 'goals',
      action: input.status === 'closed' ? 'goal_period_closed' : 'goal_period_cancelled',
      metadata: {
        request_id: requestId,
        period_id: periodId,
        kiosk_id: kioskId,
        excluded_external_employee_ids: evidence.externalEmployeeIds,
      },
      ip_address: null,
      timestamp: now,
      ttl: Timestamp.fromMillis(now.toMillis() + AUDIT_TTL_MS),
    });
  });
}
