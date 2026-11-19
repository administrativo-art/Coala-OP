import 'server-only';

import { Timestamp } from 'firebase-admin/firestore';

import type { ServerUserContext } from '@/lib/auth-server';
import { normalizeDPCoverageDemands, resolveDPCoverageMode } from '@/lib/dp-coverage-demands';
import { dbAdmin } from '@/lib/firebase-admin';
import { AppError } from '@/lib/observability/app-error';
import { canAccessUnit } from '@/lib/unit-access';
import { WORKSPACE_ID } from '@/lib/workspace';

import type { SaveClosedScheduleDayInput, SaveCoverageDemandsInput } from '@/lib/dp-coverage-demands';

const AUDIT_TTL_MS = 365 * 24 * 60 * 60 * 1000;

function assertEditPermission(context: ServerUserContext) {
  if (!context.isDefaultAdmin && !context.permissions.dp.schedules.edit) {
    throw new AppError({
      code: 'DP_COVERAGE_DEMAND_EDIT_FORBIDDEN',
      kind: 'AUTHORIZATION',
      safeMessage: 'Sem permissão para alterar a demanda da escala.',
    });
  }
}

export async function saveCoverageDemands(params: {
  context: ServerUserContext;
  scheduleId: string;
  date: string;
  input: SaveCoverageDemandsInput;
  requestId: string;
}) {
  const { context, scheduleId, date, input, requestId } = params;
  assertEditPermission(context);

  const scheduleRef = dbAdmin.collection('dp_schedules').doc(scheduleId);
  const unitRef = dbAdmin.collection('dp_units').doc(input.unitId);

  return dbAdmin.runTransaction(async (transaction) => {
    const [scheduleSnapshot, unitSnapshot] = await Promise.all([
      transaction.get(scheduleRef),
      transaction.get(unitRef),
    ]);

    if (!scheduleSnapshot.exists) {
      throw new AppError({ code: 'DP_SCHEDULE_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Escala não encontrada.' });
    }
    if (!unitSnapshot.exists || unitSnapshot.get('isArchived') === true) {
      throw new AppError({
        code: 'DP_COVERAGE_DEMAND_UNIT_UNAVAILABLE',
        kind: 'EXPECTED_BUSINESS',
        safeMessage: 'Unidade não encontrada ou arquivada.',
      });
    }
    if (!canAccessUnit(context.userDoc, input.unitId, { isDefaultAdmin: context.isDefaultAdmin })) {
      throw new AppError({
        code: 'DP_COVERAGE_DEMAND_UNIT_FORBIDDEN',
        kind: 'AUTHORIZATION',
        safeMessage: 'Sem acesso à unidade desta escala.',
      });
    }
    if (resolveDPCoverageMode({ coverageMode: unitSnapshot.get('coverageMode') }) !== 'on_demand') {
      throw new AppError({
        code: 'DP_COVERAGE_DEMAND_MODE_MISMATCH',
        kind: 'VALIDATION',
        safeMessage: 'Esta unidade não está configurada para cobertura sob demanda.',
      });
    }

    const scheduleMonth = Number(scheduleSnapshot.get('month'));
    const scheduleYear = Number(scheduleSnapshot.get('year'));
    const expectedPeriod = `${scheduleYear}-${String(scheduleMonth).padStart(2, '0')}`;
    if (!Number.isInteger(scheduleMonth) || !Number.isInteger(scheduleYear) || !date.startsWith(`${expectedPeriod}-`)) {
      throw new AppError({
        code: 'DP_COVERAGE_DEMAND_OUTSIDE_SCHEDULE_PERIOD',
        kind: 'VALIDATION',
        safeMessage: 'A data não pertence à competência desta escala.',
      });
    }
    const scheduleUnitId = scheduleSnapshot.get('unitId');
    if (typeof scheduleUnitId !== 'string' || !scheduleUnitId || scheduleUnitId !== input.unitId) {
      throw new AppError({
        code: 'DP_COVERAGE_DEMAND_SCHEDULE_UNIT_MISMATCH',
        kind: 'VALIDATION',
        safeMessage: 'A demanda deve ser registrada na escala mensal da própria unidade.',
      });
    }

    const currentDemands = normalizeDPCoverageDemands(scheduleSnapshot.get('draftCoverageDemands') ?? scheduleSnapshot.get('coverageDemands'));
    const nextDemands = { ...currentDemands };
    if (input.windows.length > 0) nextDemands[date] = input.windows;
    else delete nextDemands[date];

    const now = Timestamp.now();
    transaction.update(scheduleRef, {
      draftCoverageDemands: nextDemands,
      publicationStatus: 'draft',
      publicationVersion: scheduleSnapshot.get('publicationVersion') ?? (scheduleSnapshot.get('publicationStatus') === 'draft' ? 0 : 1),
      draftVersion: Number(scheduleSnapshot.get('draftVersion') ?? 0) + 1,
      draftUpdatedAt: now,
      draftUpdatedBy: context.decoded.uid,
    });
    transaction.set(dbAdmin.collection('actionLogs').doc(), {
      workspace_id: context.workspace_id,
      user_id: context.decoded.uid,
      username: context.userDoc.username ?? null,
      module: 'dp.schedules',
      action: input.windows.length > 0 ? 'coverage_demand_saved' : 'coverage_demand_cleared',
      metadata: {
        request_id: requestId,
        schedule_id: scheduleId,
        unit_id: input.unitId,
        date,
        windows: input.windows.map((window) => ({
          start_time: window.startTime,
          end_time: window.endTime,
          minimum_people: window.minimumPeople,
          reason: window.reason ?? null,
        })),
      },
      ip_address: null,
      timestamp: now,
      ttl: Timestamp.fromMillis(now.toMillis() + AUDIT_TTL_MS),
    });

    return { date, windows: input.windows };
  });
}

export async function saveClosedScheduleDay({ context, scheduleId, date, input, requestId }: {
  context: ServerUserContext; scheduleId: string; date: string;
  input: SaveClosedScheduleDayInput; requestId: string;
}) {
  assertEditPermission(context);
  if (!input.schedules.some((target) => target.scheduleId === scheduleId)) {
    throw new AppError({ code: 'DP_SCHEDULE_CLOSED_TARGET_INVALID', kind: 'VALIDATION' });
  }
  const scheduleRefs = input.schedules.map((target) => dbAdmin.collection('dp_schedules').doc(target.scheduleId));
  const unitRefs = input.schedules.map((target) => dbAdmin.collection('dp_units').doc(target.unitId));
  return dbAdmin.runTransaction(async (transaction) => {
    const documents = await transaction.getAll(...scheduleRefs, ...unitRefs);
    const now = Timestamp.now();
    const changed = [];
    for (let index = 0; index < scheduleRefs.length; index++) {
      const schedule = documents[index];
      const unit = documents[index + scheduleRefs.length];
      const target = input.schedules[index];
      if (!schedule.exists || !unit.exists || unit.get('isArchived') === true
        || schedule.get('unitId') !== target.unitId
        || (schedule.get('workspaceId') ?? WORKSPACE_ID) !== context.workspace_id
        || !canAccessUnit(context.userDoc, target.unitId, { isDefaultAdmin: context.isDefaultAdmin })) {
        throw new AppError({ code: 'DP_SCHEDULE_CLOSED_UNIT_FORBIDDEN', kind: 'AUTHORIZATION',
          safeMessage: 'Sem acesso a uma das unidades desta escala.' });
      }
      const period = `${schedule.get('year')}-${String(schedule.get('month')).padStart(2, '0')}`;
      if (date.slice(0, 7) !== period) {
        throw new AppError({ code: 'DP_SCHEDULE_CLOSED_PERIOD_INVALID', kind: 'VALIDATION',
          safeMessage: 'A data precisa pertencer à competência das escalas selecionadas.' });
      }
      const dates = new Set<string>(schedule.get('draftClosedDates') ?? schedule.get('closedDates') ?? []);
      if (dates.has(date) === input.closed) continue;
      if (input.closed) dates.add(date);
      else dates.delete(date);
      transaction.update(schedule.ref, {
        draftClosedDates: [...dates].sort(), publicationStatus: 'draft',
        publicationVersion: schedule.get('publicationVersion') ?? (schedule.get('publicationStatus') === 'draft' ? 0 : 1),
        draftVersion: Number(schedule.get('draftVersion') ?? 0) + 1,
        draftUpdatedAt: now, draftUpdatedBy: context.decoded.uid,
      });
      changed.push(target.scheduleId);
    }
    if (changed.length) transaction.create(dbAdmin.collection('actionLogs').doc(), {
      workspace_id: context.workspace_id, user_id: context.decoded.uid,
      username: context.userDoc.username ?? null, module: 'dp.schedules',
      action: input.closed ? 'schedule_day_closed' : 'schedule_day_reopened',
      metadata: { request_id: requestId, date, schedule_ids: changed },
      ip_address: null, timestamp: now, ttl: Timestamp.fromMillis(now.toMillis() + AUDIT_TTL_MS),
    });
    return { changed };
  });
}
