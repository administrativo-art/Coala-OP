import 'server-only';

import { FieldValue, Timestamp, type QueryDocumentSnapshot } from 'firebase-admin/firestore';

import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { AppError } from '@/lib/observability/app-error';
import { canAccessUnit } from '@/lib/unit-access';

import type { SaveWorkShiftInput } from './schemas';

const OCCUPANCY_QUERY_LIMIT = 21;
const AUDIT_TTL_MS = 365 * 24 * 60 * 60 * 1000;

function isScheduleShift(document: QueryDocumentSnapshot) {
  const segments = document.ref.path.split('/');
  return segments.length === 4 && segments[0] === 'dp_schedules' && segments[2] === 'shifts';
}

function scheduleIdFromShift(document: QueryDocumentSnapshot) {
  return document.ref.parent.parent?.id ?? '';
}

function assertEditPermission(context: ServerUserContext) {
  if (!context.isDefaultAdmin && !context.permissions.dp.schedules.edit) {
    throw new AppError({
      code: 'DP_SHIFT_EDIT_FORBIDDEN',
      kind: 'AUTHORIZATION',
      safeMessage: 'Sem permissão para alterar turnos.',
    });
  }
}

export async function saveWorkShift(params: {
  context: ServerUserContext;
  scheduleId: string;
  shiftId: string;
  input: SaveWorkShiftInput;
  mode: 'create' | 'update';
  requestId: string;
}) {
  const { context, scheduleId, shiftId, input, mode, requestId } = params;
  assertEditPermission(context);

  const scheduleRef = dbAdmin.collection('dp_schedules').doc(scheduleId);
  const shiftRef = scheduleRef.collection('shifts').doc(shiftId);
  const userRef = dbAdmin.collection('users').doc(input.userId);
  const unitRef = dbAdmin.collection('dp_units').doc(input.unitId);
  const occupancyQuery = dbAdmin.collectionGroup('shifts')
    .where('userId', '==', input.userId)
    .where('date', '==', input.date)
    .limit(OCCUPANCY_QUERY_LIMIT);

  return dbAdmin.runTransaction(async (transaction) => {
    const scheduleSnapshot = await transaction.get(scheduleRef);
    const shiftSnapshot = await transaction.get(shiftRef);
    const userSnapshot = await transaction.get(userRef);
    const unitSnapshot = await transaction.get(unitRef);
    const occupancySnapshot = await transaction.get(occupancyQuery);

    if (!scheduleSnapshot.exists) {
      throw new AppError({ code: 'DP_SCHEDULE_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Escala não encontrada.' });
    }
    if (scheduleSnapshot.get('locked') === true) {
      throw new AppError({ code: 'DP_SHIFT_SCHEDULE_LOCKED', kind: 'CONFLICT', safeMessage: 'A escala está trancada.' });
    }
    if (!userSnapshot.exists || userSnapshot.get('isActive') === false) {
      throw new AppError({ code: 'DP_SHIFT_USER_UNAVAILABLE', kind: 'EXPECTED_BUSINESS', safeMessage: 'Colaboradora não encontrada ou inativa.' });
    }
    if (!unitSnapshot.exists || unitSnapshot.get('isArchived') === true) {
      throw new AppError({ code: 'DP_SHIFT_UNIT_UNAVAILABLE', kind: 'EXPECTED_BUSINESS', safeMessage: 'Unidade não encontrada ou arquivada.' });
    }
    if (!canAccessUnit(context.userDoc, input.unitId, { isDefaultAdmin: context.isDefaultAdmin })) {
      throw new AppError({ code: 'DP_SHIFT_UNIT_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem acesso à unidade do turno.' });
    }

    const scheduleMonth = Number(scheduleSnapshot.get('month'));
    const scheduleYear = Number(scheduleSnapshot.get('year'));
    const expectedPeriod = `${scheduleYear}-${String(scheduleMonth).padStart(2, '0')}`;
    if (!Number.isInteger(scheduleMonth) || !Number.isInteger(scheduleYear) || !input.date.startsWith(`${expectedPeriod}-`)) {
      throw new AppError({ code: 'DP_SHIFT_OUTSIDE_SCHEDULE_PERIOD', kind: 'VALIDATION', safeMessage: 'A data não pertence à competência desta escala.' });
    }
    const scheduleUnitId = scheduleSnapshot.get('unitId');
    if (typeof scheduleUnitId === 'string' && scheduleUnitId && scheduleUnitId !== input.unitId) {
      throw new AppError({ code: 'DP_SHIFT_SCHEDULE_UNIT_MISMATCH', kind: 'VALIDATION', safeMessage: 'A unidade não corresponde à escala selecionada.' });
    }
    if (mode === 'create' && shiftSnapshot.exists) {
      throw new AppError({ code: 'DP_SHIFT_ID_COLLISION', kind: 'CONFLICT', safeMessage: 'O turno já existe. Atualize a escala e tente novamente.' });
    }
    if (mode === 'update' && !shiftSnapshot.exists) {
      throw new AppError({ code: 'DP_SHIFT_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Turno não encontrado.' });
    }
    if (shiftSnapshot.exists && shiftSnapshot.get('type') === 'day_off') {
      throw new AppError({ code: 'DP_SHIFT_DAY_OFF_IMMUTABLE', kind: 'CONFLICT', safeMessage: 'Uma folga não pode ser convertida diretamente em turno.' });
    }
    if (occupancySnapshot.size === OCCUPANCY_QUERY_LIMIT) {
      throw new AppError({
        code: 'DP_SHIFT_VALIDATION_LIMIT_REACHED',
        kind: 'DATA_INTEGRITY',
        safeMessage: 'Há registros demais para validar o turno com segurança.',
      });
    }

    const relevantOccupancies = occupancySnapshot.docs.filter(isScheduleShift);
    const dayOff = relevantOccupancies.find((document) => document.get('type') === 'day_off');
    if (dayOff) {
      throw new AppError({
        code: 'DP_SHIFT_DAY_OFF_CONFLICT',
        kind: 'CONFLICT',
        safeMessage: 'Existe uma folga confirmada nesta data. Remova a folga antes de atribuir o turno.',
      });
    }

    const hasCrossUnitConflict = relevantOccupancies.some((document) => (
      document.id !== shiftId
      && document.get('type') !== 'day_off'
      && scheduleIdFromShift(document) !== scheduleId
    ));
    const now = Timestamp.now();
    const basePayload = {
      scheduleId,
      unitId: input.unitId,
      userId: input.userId,
      userName: input.userName ?? userSnapshot.get('username') ?? null,
      date: input.date,
      startTime: input.startTime,
      endTime: input.endTime,
      type: 'work',
      hasConflict: hasCrossUnitConflict,
      updatedAt: now,
    };

    if (mode === 'create') {
      transaction.create(shiftRef, {
        ...basePayload,
        ...(input.shiftDefinitionId ? { shiftDefinitionId: input.shiftDefinitionId } : {}),
        createdAt: now,
      });
      transaction.update(scheduleRef, { shiftCount: FieldValue.increment(1) });
    } else {
      transaction.update(shiftRef, {
        ...basePayload,
        shiftDefinitionId: input.shiftDefinitionId ?? FieldValue.delete(),
      });
    }
    transaction.set(dbAdmin.collection('actionLogs').doc(), {
      workspace_id: context.workspace_id,
      user_id: context.decoded.uid,
      username: context.userDoc.username ?? null,
      module: 'dp.schedules',
      action: mode === 'create' ? 'shift_created' : 'shift_updated',
      metadata: {
        request_id: requestId,
        schedule_id: scheduleId,
        shift_id: shiftId,
        user_id: input.userId,
        unit_id: input.unitId,
        date: input.date,
        has_cross_unit_conflict: hasCrossUnitConflict,
      },
      ip_address: null,
      timestamp: now,
      ttl: Timestamp.fromMillis(now.toMillis() + AUDIT_TTL_MS),
    });

    return { shiftId, hasConflict: hasCrossUnitConflict };
  });
}
