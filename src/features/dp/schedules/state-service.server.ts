import 'server-only';

import { Timestamp } from 'firebase-admin/firestore';

import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { AppError } from '@/lib/observability/app-error';
import type { DPScheduleSnapshot } from '@/types';

import { validateScheduleJourneys } from '../journey-validation/service.server';

const AUDIT_TTL_MS = 365 * 24 * 60 * 60 * 1000;

function assertEdit(context: ServerUserContext) {
  if (!context.isDefaultAdmin && context.permissions.dp.schedules.edit !== true) {
    throw new AppError({ code: 'DP_SCHEDULE_STATE_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem permissão para trancar ou destrancar escalas.' });
  }
}

function audit(context: ServerUserContext, requestId: string, action: string, metadata: Record<string, unknown>, now: Timestamp) {
  return {
    workspace_id: context.workspace_id,
    user_id: context.decoded.uid,
    username: context.userDoc.username ?? null,
    module: 'dp.schedules',
    action,
    metadata: { request_id: requestId, ...metadata },
    ip_address: null,
    timestamp: now,
    ttl: Timestamp.fromMillis(now.toMillis() + AUDIT_TTL_MS),
  };
}

export async function changeDPScheduleLock(params: {
  context: ServerUserContext;
  scheduleId: string;
  action: 'lock' | 'unlock';
  snapshot?: DPScheduleSnapshot;
  authorizedSchedule?: Record<string, unknown>;
  requestId: string;
}) {
  assertEdit(params.context);
  const validation = params.action === 'lock'
    ? await validateScheduleJourneys({
        context: params.context,
        scheduleId: params.scheduleId,
        authorizedSchedule: params.authorizedSchedule,
      })
    : null;
  if (validation?.status === 'blocked') {
    throw new AppError({
      code: 'DP_SCHEDULE_JOURNEY_VALIDATION_BLOCKED',
      kind: 'EXPECTED_BUSINESS',
      safeMessage: `A escala não pode ser trancada: ${validation.issues[0]?.message ?? 'revise as jornadas aplicáveis.'}`,
      metadata: { issueCount: validation.issues.length, validationVersion: validation.version },
    });
  }

  const scheduleRef = dbAdmin.collection('dp_schedules').doc(params.scheduleId);
  await dbAdmin.runTransaction(async (transaction) => {
    const schedule = await transaction.get(scheduleRef);
    if (!schedule.exists) {
      throw new AppError({ code: 'DP_SCHEDULE_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Escala não encontrada.' });
    }
    const locked = schedule.get('locked') === true;
    if ((params.action === 'lock' && locked) || (params.action === 'unlock' && !locked)) return;
    const currentVersion = Number(schedule.get('journeyValidationVersion') ?? 0);
    if (validation && currentVersion !== validation.version) {
      throw new AppError({
        code: 'DP_SCHEDULE_JOURNEY_VALIDATION_STALE',
        kind: 'CONFLICT',
        safeMessage: 'A escala mudou durante a validação. Tente trancar novamente.',
      });
    }

    const now = Timestamp.now();
    transaction.update(scheduleRef, params.action === 'lock'
      ? {
          locked: true,
          snapshot: params.snapshot ?? { users: {} },
          journeyValidation: {
            status: validation?.status ?? 'ok',
            checkedAt: now,
            checkedBy: params.context.decoded.uid,
            version: currentVersion,
            blockingIssueCount: 0,
          },
        }
      : { locked: false });
    transaction.set(dbAdmin.collection('actionLogs').doc(), audit(
      params.context,
      params.requestId,
      params.action === 'lock' ? 'schedule_locked' : 'schedule_unlocked',
      {
        schedule_id: params.scheduleId,
        journey_validation_version: currentVersion,
        journey_validation_status: validation?.status ?? null,
      },
      now,
    ));
  });

  return { locked: params.action === 'lock', validation };
}
