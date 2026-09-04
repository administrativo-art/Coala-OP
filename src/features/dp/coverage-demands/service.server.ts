import 'server-only';

import { FieldValue, Timestamp } from 'firebase-admin/firestore';

import type { ServerUserContext } from '@/lib/auth-server';
import { normalizeDPCoverageDemands, resolveDPCoverageMode } from '@/lib/dp-coverage-demands';
import { dbAdmin } from '@/lib/firebase-admin';
import { AppError } from '@/lib/observability/app-error';
import { canAccessUnit } from '@/lib/unit-access';

import type { SaveCoverageDemandsInput } from '@/lib/dp-coverage-demands';

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
    if (scheduleSnapshot.get('locked') === true) {
      throw new AppError({
        code: 'DP_COVERAGE_DEMAND_SCHEDULE_LOCKED',
        kind: 'CONFLICT',
        safeMessage: 'A escala está trancada.',
      });
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

    const currentDemands = normalizeDPCoverageDemands(scheduleSnapshot.get('coverageDemands'));
    const nextDemands = { ...currentDemands };
    if (input.windows.length > 0) nextDemands[date] = input.windows;
    else delete nextDemands[date];

    const now = Timestamp.now();
    transaction.update(scheduleRef, {
      coverageDemands: Object.keys(nextDemands).length > 0 ? nextDemands : FieldValue.delete(),
      updatedAt: now,
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
