import 'server-only';

import { Timestamp } from 'firebase-admin/firestore';

import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { AppError } from '@/lib/observability/app-error';
import { canAccessUnit } from '@/lib/unit-access';
import { guardOccupancyWrite, operationalGuardRequested, shiftOccupancySlices, type OccupancySlice } from '@/features/dp/absences/operational/occupancy-guard.server';
import { preparePublicationFenceAdvance } from './publication-fence.server';

const MAX_SHIFT_DELETIONS = 400;
const AUDIT_TTL_MS = 365 * 24 * 60 * 60 * 1000;

export async function deleteDPSchedule(params: {
  context: ServerUserContext;
  scheduleId: string;
  requestId: string;
}) {
  const { context, scheduleId, requestId } = params;
  if (!context.isDefaultAdmin && context.permissions.dp.schedules.delete !== true) {
    throw new AppError({ code: 'DP_SCHEDULE_DELETE_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem permissão para excluir escalas.' });
  }

  const scheduleRef = dbAdmin.collection('dp_schedules').doc(scheduleId);
  await dbAdmin.runTransaction(async (transaction) => {
    const schedule = await transaction.get(scheduleRef);
    if (!schedule.exists) {
      throw new AppError({ code: 'DP_SCHEDULE_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Escala não encontrada.' });
    }
    if (schedule.get('activeRevisionId')) {
      throw new AppError({ code: 'DP_SCHEDULE_DELETE_REVISION_NOT_READY', kind: 'CONFLICT', safeMessage: 'A exclusão desta revisão oficial aguarda integração.' });
    }
    const unitId = schedule.get('unitId');
    if (typeof unitId !== 'string' || !unitId) {
      throw new AppError({ code: 'DP_SCHEDULE_UNIT_REQUIRED', kind: 'DATA_INTEGRITY', safeMessage: 'A escala precisa estar vinculada a uma unidade para ser excluída.' });
    }
    if (!canAccessUnit(context.userDoc, unitId, { isDefaultAdmin: context.isDefaultAdmin })) {
      throw new AppError({ code: 'DP_SCHEDULE_UNIT_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem acesso à unidade desta escala.' });
    }

    const unit = await transaction.get(dbAdmin.collection('dp_units').doc(unitId));
    if (!unit.exists || unit.get('isArchived') === true) {
      throw new AppError({ code: 'DP_SCHEDULE_UNIT_UNAVAILABLE', kind: 'EXPECTED_BUSINESS', safeMessage: 'Escalas históricas de unidades incorporadas não podem ser excluídas.' });
    }
    const shifts = await transaction.get(scheduleRef.collection('shifts').limit(MAX_SHIFT_DELETIONS + 1));
    if (shifts.size > MAX_SHIFT_DELETIONS) {
      throw new AppError({ code: 'DP_SCHEDULE_DELETE_LIMIT_REACHED', kind: 'DATA_INTEGRITY', safeMessage: 'A escala possui turnos demais para exclusão segura em uma única operação.' });
    }

    const operationIds = [...new Set(shifts.docs.flatMap((shift) => {
      const operationId = shift.get('bizneoOperationId');
      return typeof operationId === 'string' && operationId ? [operationId] : [];
    }))];
    const operations = operationIds.length
      ? await transaction.getAll(...operationIds.map((operationId) => dbAdmin.collection('dp_bizneo_day_off_operations').doc(operationId)))
      : [];
    const hasBizneoOperationInProgress = shifts.docs.some((shift) => ['publishing', 'removing'].includes(String(shift.get('bizneoSyncStatus') ?? '')))
      || operations.some((operation) => operation.exists && ['publishing', 'removing'].includes(String(operation.get('status') ?? '')));
    if (hasBizneoOperationInProgress) {
      throw new AppError({
        code: 'DP_SCHEDULE_BIZNEO_OPERATION_IN_PROGRESS',
        kind: 'CONFLICT',
        safeMessage: 'Aguarde a publicação ou remoção de folgas no Bizneo antes de excluir a escala.',
      });
    }

    const publicationFence = await preparePublicationFenceAdvance(transaction, context.workspace_id,
      shifts.docs.map((shift) => String(shift.get('userId') ?? '')));
    if (operationalGuardRequested()) {
      const slices: OccupancySlice[] = shifts.docs.flatMap((shift) => {
        const beneficiaryUid = String(shift.get('userId') ?? '');
        const date = String(shift.get('date') ?? '');
        if (shift.get('type') === 'day_off') return [{ beneficiaryUid, date, fromMinute: 0, toMinute: 1440, addsOccupancy: false }];
        return shiftOccupancySlices({ beneficiaryUid, date,
          startTime: shift.get('startTime') as string, endTime: shift.get('endTime') as string,
          addsOccupancy: false });
      });
      await guardOccupancyWrite(transaction, context.workspace_id, slices, shifts.size + 2);
    }
    publicationFence.apply();
    const now = Timestamp.now();
    shifts.docs.forEach((shift) => transaction.delete(shift.ref));
    transaction.delete(scheduleRef);
    transaction.set(dbAdmin.collection('actionLogs').doc(), {
      workspace_id: context.workspace_id,
      user_id: context.decoded.uid,
      username: context.userDoc.username ?? null,
      module: 'dp.schedules',
      action: 'schedule_deleted',
      metadata: { request_id: requestId, schedule_id: scheduleId, unit_id: unitId, shift_count: shifts.size },
      ip_address: null,
      timestamp: now,
      ttl: Timestamp.fromMillis(now.toMillis() + AUDIT_TTL_MS),
    });
  });
}
