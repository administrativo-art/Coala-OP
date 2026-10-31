import 'server-only';

import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';

import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { AppError } from '@/lib/observability/app-error';
import { canAccessUnit } from '@/lib/unit-access';
import { resolveGoalDPUnit } from '@/features/goals/unit-resolution.server';
import { readOfficialScheduleShiftsInTransaction } from '@/features/dp/schedules/official-revision.server';

import type { CreateEmployeeGoalInput } from './schemas';

const MAX_PERIOD_MONTHS = 24;
const MAX_EMPLOYEE_SHIFTS_PER_SCHEDULE = 100;
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
    : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return DATE_FORMATTER.format(date);
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
      throw new AppError({ code: 'GOAL_PERIOD_RANGE_TOO_LARGE', kind: 'DATA_INTEGRITY', safeMessage: 'O período da meta é longo demais para validar a equipe.' });
    }
    month += 1;
    if (month === 13) { year += 1; month = 1; }
  }
  return result;
}

function assertCanManageGoals(context: ServerUserContext, kioskId: string) {
  if (!context.isDefaultAdmin
    && context.permissions.goals.manage !== true
    && context.permissions.settings.manageUsers !== true) {
    throw new AppError({ code: 'EMPLOYEE_GOAL_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem permissão para gerenciar participantes de metas.' });
  }
  if (!canAccessUnit(context.userDoc, kioskId, { isDefaultAdmin: context.isDefaultAdmin })) {
    throw new AppError({ code: 'EMPLOYEE_GOAL_UNIT_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem acesso à unidade desta meta.' });
  }
}

export async function createEmployeeGoal(params: {
  context: ServerUserContext;
  input: CreateEmployeeGoalInput;
  requestId: string;
}) {
  const { context, input, requestId } = params;
  assertCanManageGoals(context, input.kioskId);

  const { dpUnit } = await resolveGoalDPUnit(input.kioskId);

  const identity = `${input.periodId}\u0000${input.employeeId}\u0000${input.shiftId ?? '__all__'}`;
  const ref = dbAdmin.collection('employeeGoals').doc(`participant_${createHash('sha256').update(identity).digest('hex')}`);
  await dbAdmin.runTransaction(async (transaction) => {
    const [period, employee] = await Promise.all([
      transaction.get(dbAdmin.collection('goalPeriods').doc(input.periodId)),
      transaction.get(dbAdmin.collection('users').doc(input.employeeId)),
    ]);
    if (!period.exists || period.get('kioskId') !== input.kioskId) {
      throw new AppError({ code: 'EMPLOYEE_GOAL_PERIOD_INVALID', kind: 'VALIDATION', safeMessage: 'Período de meta inválido para esta unidade.' });
    }
    if (period.get('status') !== 'active') {
      throw new AppError({ code: 'EMPLOYEE_GOAL_PERIOD_CLOSED', kind: 'CONFLICT', safeMessage: 'A equipe só pode ser alterada enquanto a meta estiver ativa.' });
    }
    if (!employee.exists || employee.get('isActive') === false) {
      throw new AppError({ code: 'EMPLOYEE_GOAL_EMPLOYEE_INVALID', kind: 'VALIDATION', safeMessage: 'Colaborador não encontrado ou inativo.' });
    }
    const periodShifts = Array.isArray(period.get('shifts')) ? period.get('shifts') as Array<{ id?: unknown }> : [];
    if (input.shiftId && !periodShifts.some((shift) => shift?.id === input.shiftId)) {
      throw new AppError({ code: 'EMPLOYEE_GOAL_SHIFT_INVALID', kind: 'VALIDATION', safeMessage: 'O turno selecionado não pertence a este período de meta.' });
    }

    const startKey = dateKey(period.get('startDate'));
    const endKey = dateKey(period.get('endDate'));
    if (!startKey || !endKey || endKey < startKey) {
      throw new AppError({ code: 'EMPLOYEE_GOAL_PERIOD_DATES_INVALID', kind: 'DATA_INTEGRITY', safeMessage: 'O período da meta possui datas inválidas.' });
    }

    const schedules = [];
    for (const { year, month } of monthKeysBetween(startKey, endKey)) {
      const snapshot = await transaction.get(
        dbAdmin.collection('dp_schedules')
          .where('unitId', '==', dpUnit.id)
          .where('year', '==', year)
          .where('month', '==', month)
          .limit(2),
      );
      if (snapshot.size > 1) {
        throw new AppError({ code: 'EMPLOYEE_GOAL_SCHEDULE_AMBIGUOUS', kind: 'DATA_INTEGRITY', safeMessage: 'Há mais de uma escala para a unidade no mesmo período.' });
      }
      schedules.push(...snapshot.docs);
    }

    for (const schedule of schedules) {
      const shifts = await readOfficialScheduleShiftsInTransaction(transaction, schedule, { userId: input.employeeId });
      if (shifts.length > MAX_EMPLOYEE_SHIFTS_PER_SCHEDULE) {
        throw new AppError({ code: 'EMPLOYEE_GOAL_SHIFT_LIMIT_REACHED', kind: 'DATA_INTEGRITY', safeMessage: 'Há turnos demais para validar este colaborador com segurança.' });
      }
      if (shifts.some((shift) => {
        const shiftDate = String(shift.date ?? '');
        return shift.type === 'work'
          && shiftDate >= startKey
          && shiftDate <= endKey
          && shift.countsTowardGoals === false;
      })) {
        throw new AppError({
          code: 'EMPLOYEE_GOAL_EXTERNAL_COVERAGE_INELIGIBLE',
          kind: 'EXPECTED_BUSINESS',
          safeMessage: 'Cobertura externa não participa das metas da unidade de execução.',
        });
      }
    }

    const existingIdentityQuery = input.shiftId
      ? dbAdmin.collection('employeeGoals')
          .where('periodId', '==', input.periodId)
          .where('employeeId', '==', input.employeeId)
          .where('shiftId', '==', input.shiftId)
          .limit(1)
      : dbAdmin.collection('employeeGoals')
          .where('periodId', '==', input.periodId)
          .where('employeeId', '==', input.employeeId)
          .limit(1001);
    const [deterministicExisting, legacyExisting] = await Promise.all([
      transaction.get(ref),
      transaction.get(existingIdentityQuery),
    ]);
    if (!input.shiftId && legacyExisting.size > 1000) {
      throw new AppError({ code: 'EMPLOYEE_GOAL_IDENTITY_LIMIT_REACHED', kind: 'DATA_INTEGRITY', safeMessage: 'Há participações demais para validar esta pessoa com segurança.' });
    }
    const duplicate = deterministicExisting.exists || legacyExisting.docs.some((goal) => (
      input.shiftId ? goal.get('shiftId') === input.shiftId : !goal.get('shiftId')
    ));
    if (duplicate) {
      throw new AppError({ code: 'EMPLOYEE_GOAL_DUPLICATE', kind: 'CONFLICT', safeMessage: 'Este colaborador já participa desta meta no turno selecionado.' });
    }

    const now = Timestamp.now();
    transaction.create(ref, { ...input, createdAt: now, updatedAt: now });
    transaction.set(dbAdmin.collection('actionLogs').doc(), {
      workspace_id: context.workspace_id,
      user_id: context.decoded.uid,
      username: context.userDoc.username ?? null,
      module: 'goals',
      action: 'employee_goal_created',
      metadata: { request_id: requestId, employee_goal_id: ref.id, period_id: input.periodId, employee_id: input.employeeId, kiosk_id: input.kioskId },
      ip_address: null,
      timestamp: now,
      ttl: Timestamp.fromMillis(now.toMillis() + AUDIT_TTL_MS),
    });
  });

  return { id: ref.id, ...input };
}
