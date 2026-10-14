import 'server-only';

import type { DocumentSnapshot } from 'firebase-admin/firestore';

import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { AppError } from '@/lib/observability/app-error';
import { canAccessUnit } from '@/lib/unit-access';

const SHIFT_LIST_LIMIT = 500;

function serializeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(serializeValue);
  if (typeof (value as { toDate?: unknown })?.toDate === 'function') {
    return (value as { toDate(): Date }).toDate().toISOString();
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, nested]) => [key, serializeValue(nested)]),
    );
  }
  return value;
}

function serializeDocument(document: DocumentSnapshot): { id: string } & Record<string, unknown> {
  return { id: document.id, ...(serializeValue(document.data()) as Record<string, unknown>) };
}

export async function getSchedule(context: ServerUserContext, scheduleId: string) {
  assertCanViewSchedule(context);
  const schedule = await dbAdmin.collection('dp_schedules').doc(scheduleId).get();
  if (!schedule.exists) {
    throw new AppError({ code: 'DP_SCHEDULE_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Escala não encontrada.' });
  }
  const unitId = schedule.get('unitId');
  const unit = typeof unitId === 'string' ? await dbAdmin.collection('dp_units').doc(unitId).get() : null;
  const externalUnitId = unit?.exists ? String(unit.get('externalId') ?? '') : '';
  const canAccess = typeof unitId === 'string' && (
    canAccessUnit(context.userDoc, unitId, { isDefaultAdmin: context.isDefaultAdmin })
    || (externalUnitId && canAccessUnit(context.userDoc, externalUnitId, { isDefaultAdmin: context.isDefaultAdmin }))
  );
  if (!canAccess) {
    throw new AppError({ code: 'DP_SCHEDULE_UNIT_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem acesso à unidade desta escala.' });
  }
  return serializeDocument(schedule);
}

function assertCanViewSchedule(context: ServerUserContext) {
  if (!context.isDefaultAdmin && context.permissions.dp.schedules.view !== true) {
    throw new AppError({
      code: 'DP_SCHEDULE_VIEW_FORBIDDEN',
      kind: 'AUTHORIZATION',
      safeMessage: 'Sem permissão para consultar esta escala.',
    });
  }
}

export async function listScheduleShifts(context: ServerUserContext, scheduleId: string) {
  assertCanViewSchedule(context);
  const schedule = await dbAdmin.collection('dp_schedules').doc(scheduleId).get();
  if (!schedule.exists) {
    throw new AppError({ code: 'DP_SCHEDULE_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Escala não encontrada.' });
  }
  const unitId = schedule.get('unitId');
  const unit = typeof unitId === 'string' ? await dbAdmin.collection('dp_units').doc(unitId).get() : null;
  const externalUnitId = unit?.exists ? String(unit.get('externalId') ?? '') : '';
  const canAccess = typeof unitId === 'string' && (
    canAccessUnit(context.userDoc, unitId, { isDefaultAdmin: context.isDefaultAdmin })
    || (externalUnitId && canAccessUnit(context.userDoc, externalUnitId, { isDefaultAdmin: context.isDefaultAdmin }))
  );
  if (!canAccess) {
    throw new AppError({ code: 'DP_SCHEDULE_UNIT_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem acesso à unidade desta escala.' });
  }

  const shifts = await schedule.ref.collection('shifts').orderBy('date').limit(SHIFT_LIST_LIMIT + 1).get();
  if (shifts.size > SHIFT_LIST_LIMIT) {
    throw new AppError({
      code: 'DP_SCHEDULE_SHIFT_LIMIT_REACHED',
      kind: 'DATA_INTEGRITY',
      safeMessage: 'A escala possui turnos demais para carregar com segurança.',
    });
  }
  return shifts.docs.map(serializeDocument);
}
