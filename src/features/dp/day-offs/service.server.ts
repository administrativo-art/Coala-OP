import 'server-only';

import { createHash } from 'node:crypto';

import { FieldValue, Timestamp, type DocumentReference, type QueryDocumentSnapshot } from 'firebase-admin/firestore';

import type { ServerUserContext } from '@/lib/auth-server';
import { isPredictedDayOffDate } from '@/lib/dp-shift-rules';
import { dbAdmin } from '@/lib/firebase-admin';
import {
  BizneoScheduleApiError,
  fetchBizneoScheduleDay,
  pushDayOffToBizneo,
  removeDayOffFromBizneo,
} from '@/lib/integrations/bizneo-admin';
import { AppError } from '@/lib/observability/app-error';
import { canAccessUnit } from '@/lib/unit-access';
import type {
  PublishDayOffInput,
  PublishDayOffResult,
  RemoveDayOffInput,
  RemoveDayOffResult,
} from './schemas';

const OPERATIONS_COLLECTION = 'dp_bizneo_day_off_operations';
const SHIFT_QUERY_LIMIT = 200;
const PUBLISHING_LEASE_MS = 2 * 60 * 1000;
const AUDIT_TTL_MS = 365 * 24 * 60 * 60 * 1000;

type PreparedDayOff = {
  operationRef: DocumentReference;
  shiftRef: DocumentReference;
  operationId: string;
  scheduleId: string;
  shiftId: string;
  userId: string;
  unitId: string;
  date: string;
  source: 'predicted' | 'manual';
  bizneoUserId: number;
  alreadyPublished: boolean;
};

type PreparedDayOffRemoval = {
  operationRef: DocumentReference;
  shiftRef: DocumentReference;
  operationId: string;
  scheduleId: string;
  shiftId: string;
  userId: string;
  unitId: string;
  date: string;
  bizneoUserId: number;
  alreadyRemoved: boolean;
};

function opaqueId(...parts: string[]) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
}

function previousDates(date: string, count: number) {
  const cursor = new Date(`${date}T12:00:00.000Z`);
  return Array.from({ length: count }, (_, index) => {
    const value = new Date(cursor);
    value.setUTCDate(value.getUTCDate() - (count - index));
    return value.toISOString().slice(0, 10);
  });
}

function timestampMillis(value: unknown) {
  return value && typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function'
    ? (value as { toMillis: () => number }).toMillis()
    : 0;
}

function isScheduleShift(document: QueryDocumentSnapshot) {
  const segments = document.ref.path.split('/');
  return segments.length === 4 && segments[0] === 'dp_schedules' && segments[2] === 'shifts';
}

function scheduleIdFromShift(document: QueryDocumentSnapshot) {
  return document.ref.parent.parent?.id ?? '';
}

function businessAudit(params: {
  context: ServerUserContext;
  action: string;
  now: Timestamp;
  requestId: string;
  metadata: Record<string, unknown>;
}) {
  return {
    workspace_id: params.context.workspace_id,
    user_id: params.context.decoded.uid,
    username: params.context.userDoc.username ?? null,
    module: 'dp.schedules',
    action: params.action,
    metadata: { ...params.metadata, request_id: params.requestId },
    ip_address: null,
    timestamp: params.now,
    ttl: Timestamp.fromMillis(params.now.toMillis() + AUDIT_TTL_MS),
  };
}

function assertPublishPermission(context: ServerUserContext) {
  if (
    !context.isDefaultAdmin
    && (
      !context.permissions.dp.schedules.view
      || !context.permissions.dp.schedules.edit
      || !context.permissions.dp.schedules.publishBizneo
    )
  ) {
    throw new AppError({
      code: 'DP_DAY_OFF_PUBLISH_FORBIDDEN',
      kind: 'AUTHORIZATION',
      safeMessage: 'Sem permissão para confirmar e publicar folgas no Bizneo.',
    });
  }
}

function normalizeExternalError(cause: unknown) {
  if (cause instanceof AppError) return cause;
  if (cause instanceof BizneoScheduleApiError) {
    const transient = cause.status === 408 || cause.status === 429 || cause.status >= 500;
    return new AppError({
      code: transient ? 'BIZNEO_DAY_OFF_TEMPORARILY_UNAVAILABLE' : 'BIZNEO_DAY_OFF_REJECTED',
      kind: transient ? 'TRANSIENT_EXTERNAL' : 'PERMANENT_EXTERNAL',
      safeMessage: transient
        ? 'O Bizneo está temporariamente indisponível. A folga ficou pendente para nova tentativa.'
        : 'O Bizneo recusou a publicação da folga. Confira o vínculo da colaboradora e tente novamente.',
      cause,
    });
  }
  return new AppError({
    code: 'BIZNEO_DAY_OFF_REQUEST_FAILED',
    kind: 'TRANSIENT_EXTERNAL',
    safeMessage: 'Não foi possível acessar o Bizneo. A folga ficou pendente para nova tentativa.',
    cause,
  });
}

function normalizeRemovalError(cause: unknown) {
  if (cause instanceof AppError) return cause;
  if (cause instanceof BizneoScheduleApiError) {
    const transient = cause.status === 408 || cause.status === 429 || cause.status >= 500;
    return new AppError({
      code: transient ? 'BIZNEO_DAY_OFF_REMOVAL_TEMPORARILY_UNAVAILABLE' : 'BIZNEO_DAY_OFF_REMOVAL_REJECTED',
      kind: transient ? 'TRANSIENT_EXTERNAL' : 'PERMANENT_EXTERNAL',
      safeMessage: transient
        ? 'O Bizneo está temporariamente indisponível. A folga não foi removida e pode ser tentada novamente.'
        : 'O Bizneo recusou a remoção da folga. Ela permanece registrada no Coala One.',
      cause,
    });
  }
  return new AppError({
    code: 'BIZNEO_DAY_OFF_REMOVAL_REQUEST_FAILED',
    kind: 'TRANSIENT_EXTERNAL',
    safeMessage: 'Não foi possível remover a folga no Bizneo. Ela permanece registrada no Coala One.',
    cause,
  });
}

async function prepareDayOff(params: {
  context: ServerUserContext;
  scheduleId: string;
  input: PublishDayOffInput;
  requestId: string;
}): Promise<PreparedDayOff> {
  const { context, scheduleId, input, requestId } = params;
  assertPublishPermission(context);

  const operationId = opaqueId(context.workspace_id, input.userId, input.date);
  const operationRef = dbAdmin.collection(OPERATIONS_COLLECTION).doc(operationId);
  const scheduleRef = dbAdmin.collection('dp_schedules').doc(scheduleId);
  const userRef = dbAdmin.collection('users').doc(input.userId);
  const unitRef = dbAdmin.collection('dp_units').doc(input.unitId);
  const validationDates = previousDates(input.date, 62);
  const shiftQuery = dbAdmin.collectionGroup('shifts')
    .where('userId', '==', input.userId)
    .where('date', '>=', validationDates[0])
    .where('date', '<=', input.date)
    .orderBy('date', 'asc')
    .limit(SHIFT_QUERY_LIMIT);

  return dbAdmin.runTransaction(async (transaction) => {
    const scheduleSnapshot = await transaction.get(scheduleRef);
    const userSnapshot = await transaction.get(userRef);
    const unitSnapshot = await transaction.get(unitRef);
    const operationSnapshot = await transaction.get(operationRef);
    const shiftsSnapshot = await transaction.get(shiftQuery);

    if (!scheduleSnapshot.exists) {
      throw new AppError({ code: 'DP_SCHEDULE_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Escala não encontrada.' });
    }
    if (!userSnapshot.exists) {
      throw new AppError({ code: 'DP_DAY_OFF_USER_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Colaboradora não encontrada.' });
    }
    if (userSnapshot.get('isActive') === false) {
      throw new AppError({
        code: 'DP_DAY_OFF_USER_INACTIVE',
        kind: 'EXPECTED_BUSINESS',
        safeMessage: 'Não é possível lançar folga para uma colaboradora inativa.',
      });
    }
    if (!unitSnapshot.exists || unitSnapshot.get('isArchived') === true) {
      throw new AppError({ code: 'DP_DAY_OFF_UNIT_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Unidade não encontrada ou arquivada.' });
    }
    if (!canAccessUnit(context.userDoc, input.unitId, { isDefaultAdmin: context.isDefaultAdmin })) {
      throw new AppError({ code: 'DP_DAY_OFF_UNIT_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem acesso à unidade desta folga.' });
    }

    const scheduleMonth = Number(scheduleSnapshot.get('month'));
    const scheduleYear = Number(scheduleSnapshot.get('year'));
    const expectedPeriod = `${scheduleYear}-${String(scheduleMonth).padStart(2, '0')}`;
    if (!Number.isInteger(scheduleMonth) || !Number.isInteger(scheduleYear) || !input.date.startsWith(`${expectedPeriod}-`)) {
      throw new AppError({
        code: 'DP_DAY_OFF_OUTSIDE_SCHEDULE_PERIOD',
        kind: 'VALIDATION',
        safeMessage: 'A data da folga não pertence à competência desta escala.',
      });
    }
    const scheduleUnitId = scheduleSnapshot.get('unitId');
    if (typeof scheduleUnitId === 'string' && scheduleUnitId && scheduleUnitId !== input.unitId) {
      throw new AppError({
        code: 'DP_DAY_OFF_SCHEDULE_UNIT_MISMATCH',
        kind: 'VALIDATION',
        safeMessage: 'A unidade não corresponde à escala selecionada.',
      });
    }

    const bizneoUserId = Number(String(userSnapshot.get('registrationIdBizneo') ?? '').trim());
    if (!Number.isInteger(bizneoUserId) || bizneoUserId <= 0) {
      throw new AppError({
        code: 'DP_DAY_OFF_BIZNEO_LINK_MISSING',
        kind: 'EXPECTED_BUSINESS',
        safeMessage: 'A colaboradora não possui um vínculo válido com o Bizneo.',
      });
    }

    if (shiftsSnapshot.size === SHIFT_QUERY_LIMIT) {
      throw new AppError({
        code: 'DP_DAY_OFF_VALIDATION_LIMIT_REACHED',
        kind: 'DATA_INTEGRITY',
        safeMessage: 'Há registros demais para validar a folga com segurança.',
        metadata: { userId: input.userId, date: input.date, limit: SHIFT_QUERY_LIMIT },
      });
    }

    const relevantShifts = shiftsSnapshot.docs.filter(isScheduleShift);
    const targetShifts = relevantShifts.filter((document) => document.get('date') === input.date);
    const targetWorkShifts = targetShifts.filter((document) => document.get('type') !== 'day_off');
    if (targetWorkShifts.length > 0) {
      throw new AppError({
        code: 'DP_DAY_OFF_WORK_SHIFT_CONFLICT',
        kind: 'CONFLICT',
        safeMessage: 'A colaboradora possui um turno de trabalho nessa data. Remova ou substitua o turno antes de lançar a folga.',
      });
    }

    const explicitDayOffs = targetShifts.filter((document) => document.get('type') === 'day_off');
    if (explicitDayOffs.length > 1) {
      throw new AppError({
        code: 'DP_DAY_OFF_DUPLICATE_LOCAL_RECORDS',
        kind: 'DATA_INTEGRITY',
        safeMessage: 'Existem folgas locais duplicadas para esta colaboradora e data.',
        metadata: { userId: input.userId, date: input.date, count: explicitDayOffs.length },
      });
    }

    const existingDayOff = explicitDayOffs[0] ?? null;
    if (existingDayOff && scheduleIdFromShift(existingDayOff) !== scheduleId) {
      throw new AppError({
        code: 'DP_DAY_OFF_OTHER_SCHEDULE_CONFLICT',
        kind: 'CONFLICT',
        safeMessage: 'A folga já está registrada em outra escala desta competência.',
      });
    }
    if (input.source === 'retry' && !existingDayOff) {
      throw new AppError({
        code: 'DP_DAY_OFF_RETRY_WITHOUT_RECORD',
        kind: 'VALIDATION',
        safeMessage: 'Não existe uma folga confirmada para tentar novamente.',
      });
    }

    if (input.source === 'predicted') {
      const workedDates = new Set(
        relevantShifts
          .filter((document) => document.get('type') !== 'day_off')
          .map((document) => String(document.get('date') ?? '')),
      );
      if (!isPredictedDayOffDate(workedDates, input.date)) {
        throw new AppError({
          code: 'DP_DAY_OFF_PREDICTION_CHANGED',
          kind: 'CONFLICT',
          safeMessage: 'A sequência de trabalho mudou e esta folga não está mais prevista.',
        });
      }
    }

    if (scheduleSnapshot.get('locked') === true && !existingDayOff) {
      throw new AppError({
        code: 'DP_DAY_OFF_SCHEDULE_LOCKED',
        kind: 'CONFLICT',
        safeMessage: 'A escala está trancada e não aceita uma nova folga.',
      });
    }

    const operation = operationSnapshot.data() ?? {};
    if (
      operationSnapshot.exists
      && (
        operation.workspaceId !== context.workspace_id
        || operation.userId !== input.userId
        || operation.date !== input.date
      )
    ) {
      throw new AppError({ code: 'DP_DAY_OFF_OPERATION_COLLISION', kind: 'DATA_INTEGRITY' });
    }

    const shiftRef = existingDayOff?.ref ?? scheduleRef.collection('shifts').doc(`day-off-${operationId.slice(0, 20)}`);
    if (
      operationSnapshot.exists
      && (
        operation.scheduleId !== scheduleId
        || operation.unitId !== input.unitId
        || operation.shiftId !== shiftRef.id
      )
    ) {
      throw new AppError({
        code: 'DP_DAY_OFF_OPERATION_TARGET_CHANGED',
        kind: 'CONFLICT',
        safeMessage: 'Esta folga já está vinculada a outra escala ou unidade.',
      });
    }
    const existingOperationId = existingDayOff?.get('bizneoOperationId');
    if (
      typeof existingOperationId === 'string'
      && existingOperationId
      && existingOperationId !== operationId
    ) {
      throw new AppError({ code: 'DP_DAY_OFF_SHIFT_OPERATION_COLLISION', kind: 'DATA_INTEGRITY' });
    }
    const source = existingDayOff?.get('dayOffSource') === 'predicted' ? 'predicted' : (
      existingDayOff?.get('dayOffSource') === 'manual'
        ? 'manual'
        : input.source === 'predicted' ? 'predicted' : 'manual'
    );

    if (operation.status === 'published') {
      if (!existingDayOff || existingDayOff.get('bizneoSyncStatus') !== 'published') {
        throw new AppError({ code: 'DP_DAY_OFF_PUBLISHED_STATE_INCONSISTENT', kind: 'DATA_INTEGRITY' });
      }
      return {
        operationRef,
        shiftRef,
        operationId,
        scheduleId,
        shiftId: shiftRef.id,
        userId: input.userId,
        unitId: input.unitId,
        date: input.date,
        source,
        bizneoUserId,
        alreadyPublished: true,
      };
    }
    if (
      operation.status === 'publishing'
      && Date.now() - timestampMillis(operation.updatedAt) < PUBLISHING_LEASE_MS
    ) {
      throw new AppError({
        code: 'DP_DAY_OFF_PUBLICATION_IN_PROGRESS',
        kind: 'CONFLICT',
        safeMessage: 'Esta folga já está sendo enviada ao Bizneo.',
      });
    }
    if (
      operation.status === 'removing'
      && Date.now() - timestampMillis(operation.updatedAt) < PUBLISHING_LEASE_MS
    ) {
      throw new AppError({
        code: 'DP_DAY_OFF_REMOVAL_IN_PROGRESS',
        kind: 'CONFLICT',
        safeMessage: 'Esta folga está sendo removida do Bizneo.',
      });
    }

    const now = Timestamp.now();
    const confirmedAt = existingDayOff?.get('dayOffConfirmedAt') ?? now;
    const shiftPayload = {
      scheduleId,
      unitId: input.unitId,
      userId: input.userId,
      userName: userSnapshot.get('username') ?? null,
      date: input.date,
      startTime: '',
      endTime: '',
      type: 'day_off',
      dayOffSource: source,
      dayOffConfirmedAt: confirmedAt,
      dayOffConfirmedBy: existingDayOff?.get('dayOffConfirmedBy') ?? context.decoded.uid,
      bizneoOperationId: operationId,
      bizneoSyncStatus: 'publishing',
      bizneoSyncUpdatedAt: now,
      bizneoLastErrorCode: FieldValue.delete(),
      hasConflict: false,
      updatedAt: now,
      ...(!existingDayOff ? { createdAt: now } : {}),
    };
    transaction.set(shiftRef, shiftPayload, { merge: true });
    transaction.set(operationRef, {
      workspaceId: context.workspace_id,
      scheduleId,
      shiftId: shiftRef.id,
      userId: input.userId,
      unitId: input.unitId,
      date: input.date,
      source,
      bizneoUserId,
      status: 'publishing',
      attemptCount: Number(operation.attemptCount ?? 0) + 1,
      createdAt: operation.createdAt ?? now,
      updatedAt: now,
      lastRequestId: requestId,
      lastErrorCode: FieldValue.delete(),
      removedAt: FieldValue.delete(),
    }, { merge: true });
    const auditRef = dbAdmin.collection('actionLogs').doc();
    transaction.set(auditRef, businessAudit({
      context,
      action: existingDayOff ? 'day_off_publication_retried' : 'day_off_confirmed',
      now,
      requestId,
      metadata: {
        operation_id: operationId,
        schedule_id: scheduleId,
        shift_id: shiftRef.id,
        user_id: input.userId,
        unit_id: input.unitId,
        date: input.date,
        source,
      },
    }));

    return {
      operationRef,
      shiftRef,
      operationId,
      scheduleId,
      shiftId: shiftRef.id,
      userId: input.userId,
      unitId: input.unitId,
      date: input.date,
      source,
      bizneoUserId,
      alreadyPublished: false,
    };
  });
}

async function markPublished(
  prepared: PreparedDayOff,
  context: ServerUserContext,
  requestId: string,
) {
  await dbAdmin.runTransaction(async (transaction) => {
    const operationSnapshot = await transaction.get(prepared.operationRef);
    const shiftSnapshot = await transaction.get(prepared.shiftRef);
    if (!operationSnapshot.exists || !shiftSnapshot.exists) {
      throw new AppError({ code: 'DP_DAY_OFF_PUBLICATION_STATE_MISSING', kind: 'DATA_INTEGRITY' });
    }
    if (
      operationSnapshot.get('shiftId') !== prepared.shiftId
      || operationSnapshot.get('workspaceId') !== context.workspace_id
      || shiftSnapshot.get('bizneoOperationId') !== prepared.operationId
    ) {
      throw new AppError({ code: 'DP_DAY_OFF_PUBLICATION_STATE_CHANGED', kind: 'CONFLICT' });
    }

    const now = Timestamp.now();
    transaction.update(prepared.operationRef, {
      status: 'published',
      publishedAt: now,
      updatedAt: now,
      lastErrorCode: FieldValue.delete(),
    });
    transaction.update(prepared.shiftRef, {
      bizneoSyncStatus: 'published',
      bizneoSyncUpdatedAt: now,
      bizneoPublishedAt: now,
      bizneoLastErrorCode: FieldValue.delete(),
      updatedAt: now,
    });
    transaction.set(dbAdmin.collection('actionLogs').doc(), businessAudit({
      context,
      action: 'day_off_published_to_bizneo',
      now,
      requestId,
      metadata: {
        operation_id: prepared.operationId,
        schedule_id: prepared.scheduleId,
        shift_id: prepared.shiftId,
        user_id: prepared.userId,
        unit_id: prepared.unitId,
        date: prepared.date,
        source: prepared.source,
      },
    }));
  });
}

async function markFailed(
  prepared: PreparedDayOff,
  context: ServerUserContext,
  requestId: string,
  errorCode: string,
) {
  await dbAdmin.runTransaction(async (transaction) => {
    const operationSnapshot = await transaction.get(prepared.operationRef);
    const shiftSnapshot = await transaction.get(prepared.shiftRef);
    if (!operationSnapshot.exists || !shiftSnapshot.exists) return;
    if (
      operationSnapshot.get('shiftId') !== prepared.shiftId
      || operationSnapshot.get('workspaceId') !== context.workspace_id
      || operationSnapshot.get('lastRequestId') !== requestId
      || operationSnapshot.get('status') !== 'publishing'
      || shiftSnapshot.get('bizneoOperationId') !== prepared.operationId
      || shiftSnapshot.get('bizneoSyncStatus') === 'published'
    ) return;

    const now = Timestamp.now();
    transaction.update(prepared.operationRef, { status: 'failed', updatedAt: now, lastErrorCode: errorCode });
    transaction.update(prepared.shiftRef, {
      bizneoSyncStatus: 'failed',
      bizneoSyncUpdatedAt: now,
      bizneoLastErrorCode: errorCode,
      updatedAt: now,
    });
    transaction.set(dbAdmin.collection('actionLogs').doc(), businessAudit({
      context,
      action: 'day_off_bizneo_publication_failed',
      now,
      requestId,
      metadata: {
        operation_id: prepared.operationId,
        schedule_id: prepared.scheduleId,
        shift_id: prepared.shiftId,
        user_id: prepared.userId,
        unit_id: prepared.unitId,
        date: prepared.date,
        error_code: errorCode,
      },
    }));
  });
}

export async function publishDayOff(params: {
  context: ServerUserContext;
  scheduleId: string;
  input: PublishDayOffInput;
  requestId: string;
}): Promise<PublishDayOffResult> {
  const prepared = await prepareDayOff(params);
  if (prepared.alreadyPublished) {
    return {
      dayOff: {
        scheduleId: prepared.scheduleId,
        shiftId: prepared.shiftId,
        userId: prepared.userId,
        unitId: prepared.unitId,
        date: prepared.date,
        source: prepared.source,
        bizneoSyncStatus: 'published',
      },
      alreadyPublished: true,
    };
  }

  try {
    const before = await fetchBizneoScheduleDay(prepared.bizneoUserId, prepared.date);
    if (before?.absenceCount && before.kind !== 'one_time_rest') {
      throw new AppError({
        code: 'BIZNEO_DAY_OFF_ABSENCE_CONFLICT',
        kind: 'EXPECTED_BUSINESS',
        safeMessage: 'O Bizneo já possui uma ausência nessa data. A folga não foi sobrescrita.',
      });
    }

    if (before?.kind !== 'one_time_rest') {
      await pushDayOffToBizneo(prepared.bizneoUserId, prepared.date);
      const after = await fetchBizneoScheduleDay(prepared.bizneoUserId, prepared.date);
      if (after?.kind !== 'one_time_rest') {
        throw new AppError({
          code: 'BIZNEO_DAY_OFF_VERIFICATION_FAILED',
          kind: 'PERMANENT_EXTERNAL',
          safeMessage: 'O Bizneo recebeu a operação, mas não confirmou a folga. Tente novamente.',
        });
      }
    }

    await markPublished(prepared, params.context, params.requestId);
  } catch (cause) {
    const error = normalizeExternalError(cause);
    await markFailed(prepared, params.context, params.requestId, error.code).catch(() => undefined);
    throw error;
  }

  return {
    dayOff: {
      scheduleId: prepared.scheduleId,
      shiftId: prepared.shiftId,
      userId: prepared.userId,
      unitId: prepared.unitId,
      date: prepared.date,
      source: prepared.source,
      bizneoSyncStatus: 'published',
    },
    alreadyPublished: false,
  };
}

async function prepareDayOffRemoval(params: {
  context: ServerUserContext;
  scheduleId: string;
  input: RemoveDayOffInput;
  requestId: string;
}): Promise<PreparedDayOffRemoval> {
  const { context, scheduleId, input, requestId } = params;
  assertPublishPermission(context);

  const operationId = opaqueId(context.workspace_id, input.userId, input.date);
  const operationRef = dbAdmin.collection(OPERATIONS_COLLECTION).doc(operationId);
  const scheduleRef = dbAdmin.collection('dp_schedules').doc(scheduleId);
  const shiftRef = scheduleRef.collection('shifts').doc(input.shiftId);
  const userRef = dbAdmin.collection('users').doc(input.userId);
  const unitRef = dbAdmin.collection('dp_units').doc(input.unitId);

  return dbAdmin.runTransaction(async (transaction) => {
    const scheduleSnapshot = await transaction.get(scheduleRef);
    const shiftSnapshot = await transaction.get(shiftRef);
    const operationSnapshot = await transaction.get(operationRef);
    const userSnapshot = await transaction.get(userRef);
    const unitSnapshot = await transaction.get(unitRef);

    const operation = operationSnapshot.data() ?? {};
    if (
      operationSnapshot.exists
      && (
        operation.workspaceId !== context.workspace_id
        || operation.userId !== input.userId
        || operation.date !== input.date
        || operation.scheduleId !== scheduleId
        || operation.shiftId !== input.shiftId
        || operation.unitId !== input.unitId
      )
    ) {
      throw new AppError({ code: 'DP_DAY_OFF_REMOVAL_OPERATION_MISMATCH', kind: 'DATA_INTEGRITY' });
    }

    if (!scheduleSnapshot.exists) {
      throw new AppError({ code: 'DP_SCHEDULE_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Escala não encontrada.' });
    }
    if (!userSnapshot.exists) {
      throw new AppError({ code: 'DP_DAY_OFF_USER_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Colaboradora não encontrada.' });
    }
    if (!unitSnapshot.exists) {
      throw new AppError({ code: 'DP_DAY_OFF_UNIT_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Unidade não encontrada.' });
    }
    if (!canAccessUnit(context.userDoc, input.unitId, { isDefaultAdmin: context.isDefaultAdmin })) {
      throw new AppError({ code: 'DP_DAY_OFF_UNIT_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem acesso à unidade desta folga.' });
    }
    if (!shiftSnapshot.exists && operation.status === 'removed') {
      return {
        operationRef,
        shiftRef,
        operationId,
        scheduleId,
        shiftId: input.shiftId,
        userId: input.userId,
        unitId: input.unitId,
        date: input.date,
        bizneoUserId: Number(operation.bizneoUserId ?? 0),
        alreadyRemoved: true,
      };
    }
    if (!shiftSnapshot.exists) {
      throw new AppError({ code: 'DP_DAY_OFF_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Folga não encontrada.' });
    }
    if (
      shiftSnapshot.get('type') !== 'day_off'
      || shiftSnapshot.get('userId') !== input.userId
      || shiftSnapshot.get('unitId') !== input.unitId
      || shiftSnapshot.get('date') !== input.date
      || shiftSnapshot.get('bizneoOperationId') !== operationId
    ) {
      throw new AppError({
        code: 'DP_DAY_OFF_REMOVAL_TARGET_MISMATCH',
        kind: 'CONFLICT',
        safeMessage: 'A folga mudou desde que a página foi carregada. Atualize a escala e tente novamente.',
      });
    }
    if (!operationSnapshot.exists) {
      throw new AppError({ code: 'DP_DAY_OFF_REMOVAL_OPERATION_MISSING', kind: 'DATA_INTEGRITY' });
    }
    if (
      operation.status === 'removing'
      && Date.now() - timestampMillis(operation.updatedAt) < PUBLISHING_LEASE_MS
    ) {
      throw new AppError({
        code: 'DP_DAY_OFF_REMOVAL_IN_PROGRESS',
        kind: 'CONFLICT',
        safeMessage: 'Esta folga já está sendo removida do Bizneo.',
      });
    }

    const bizneoUserId = Number(String(userSnapshot.get('registrationIdBizneo') ?? '').trim());
    if (!Number.isInteger(bizneoUserId) || bizneoUserId <= 0) {
      throw new AppError({
        code: 'DP_DAY_OFF_BIZNEO_LINK_MISSING',
        kind: 'EXPECTED_BUSINESS',
        safeMessage: 'A colaboradora não possui um vínculo válido com o Bizneo.',
      });
    }

    const now = Timestamp.now();
    transaction.update(shiftRef, {
      bizneoSyncStatus: 'removing',
      bizneoSyncUpdatedAt: now,
      bizneoLastErrorCode: FieldValue.delete(),
      updatedAt: now,
    });
    transaction.update(operationRef, {
      status: 'removing',
      removalAttemptCount: Number(operation.removalAttemptCount ?? 0) + 1,
      updatedAt: now,
      lastRemovalRequestId: requestId,
      lastErrorCode: FieldValue.delete(),
    });
    transaction.set(dbAdmin.collection('actionLogs').doc(), businessAudit({
      context,
      action: 'day_off_removal_requested',
      now,
      requestId,
      metadata: {
        operation_id: operationId,
        schedule_id: scheduleId,
        shift_id: input.shiftId,
        user_id: input.userId,
        unit_id: input.unitId,
        date: input.date,
      },
    }));

    return {
      operationRef,
      shiftRef,
      operationId,
      scheduleId,
      shiftId: input.shiftId,
      userId: input.userId,
      unitId: input.unitId,
      date: input.date,
      bizneoUserId,
      alreadyRemoved: false,
    };
  });
}

async function markDayOffRemoved(
  prepared: PreparedDayOffRemoval,
  context: ServerUserContext,
  requestId: string,
) {
  await dbAdmin.runTransaction(async (transaction) => {
    const operationSnapshot = await transaction.get(prepared.operationRef);
    const shiftSnapshot = await transaction.get(prepared.shiftRef);
    if (!operationSnapshot.exists) {
      throw new AppError({ code: 'DP_DAY_OFF_REMOVAL_STATE_MISSING', kind: 'DATA_INTEGRITY' });
    }
    if (!shiftSnapshot.exists && operationSnapshot.get('status') === 'removed') return;
    if (
      !shiftSnapshot.exists
      || operationSnapshot.get('workspaceId') !== context.workspace_id
      || operationSnapshot.get('shiftId') !== prepared.shiftId
      || operationSnapshot.get('lastRemovalRequestId') !== requestId
      || operationSnapshot.get('status') !== 'removing'
      || shiftSnapshot.get('bizneoOperationId') !== prepared.operationId
    ) {
      throw new AppError({ code: 'DP_DAY_OFF_REMOVAL_STATE_CHANGED', kind: 'CONFLICT' });
    }

    const now = Timestamp.now();
    transaction.delete(prepared.shiftRef);
    transaction.update(prepared.operationRef, {
      status: 'removed',
      removedAt: now,
      updatedAt: now,
      lastErrorCode: FieldValue.delete(),
    });
    transaction.set(dbAdmin.collection('actionLogs').doc(), businessAudit({
      context,
      action: 'day_off_removed_from_bizneo',
      now,
      requestId,
      metadata: {
        operation_id: prepared.operationId,
        schedule_id: prepared.scheduleId,
        shift_id: prepared.shiftId,
        user_id: prepared.userId,
        unit_id: prepared.unitId,
        date: prepared.date,
      },
    }));
  });
}

async function markDayOffRemovalFailed(
  prepared: PreparedDayOffRemoval,
  context: ServerUserContext,
  requestId: string,
  errorCode: string,
) {
  await dbAdmin.runTransaction(async (transaction) => {
    const operationSnapshot = await transaction.get(prepared.operationRef);
    const shiftSnapshot = await transaction.get(prepared.shiftRef);
    if (!operationSnapshot.exists || !shiftSnapshot.exists) return;
    if (
      operationSnapshot.get('workspaceId') !== context.workspace_id
      || operationSnapshot.get('shiftId') !== prepared.shiftId
      || operationSnapshot.get('lastRemovalRequestId') !== requestId
      || operationSnapshot.get('status') !== 'removing'
      || shiftSnapshot.get('bizneoOperationId') !== prepared.operationId
    ) return;

    const now = Timestamp.now();
    transaction.update(prepared.operationRef, {
      status: 'removal_failed',
      updatedAt: now,
      lastErrorCode: errorCode,
    });
    transaction.update(prepared.shiftRef, {
      bizneoSyncStatus: 'removal_failed',
      bizneoSyncUpdatedAt: now,
      bizneoLastErrorCode: errorCode,
      updatedAt: now,
    });
    transaction.set(dbAdmin.collection('actionLogs').doc(), businessAudit({
      context,
      action: 'day_off_bizneo_removal_failed',
      now,
      requestId,
      metadata: {
        operation_id: prepared.operationId,
        schedule_id: prepared.scheduleId,
        shift_id: prepared.shiftId,
        user_id: prepared.userId,
        unit_id: prepared.unitId,
        date: prepared.date,
        error_code: errorCode,
      },
    }));
  });
}

export async function removeDayOff(params: {
  context: ServerUserContext;
  scheduleId: string;
  input: RemoveDayOffInput;
  requestId: string;
}): Promise<RemoveDayOffResult> {
  const prepared = await prepareDayOffRemoval(params);
  if (prepared.alreadyRemoved) return { removed: true, alreadyRemoved: true };

  try {
    const before = await fetchBizneoScheduleDay(prepared.bizneoUserId, prepared.date);
    if (before?.kind === 'one_time_rest') {
      await removeDayOffFromBizneo(prepared.bizneoUserId, prepared.date);
      const after = await fetchBizneoScheduleDay(prepared.bizneoUserId, prepared.date);
      if (after?.kind === 'one_time_rest') {
        throw new AppError({
          code: 'BIZNEO_DAY_OFF_REMOVAL_VERIFICATION_FAILED',
          kind: 'PERMANENT_EXTERNAL',
          safeMessage: 'O Bizneo recebeu a operação, mas a folga continua ativa. Tente novamente.',
        });
      }
    }
    await markDayOffRemoved(prepared, params.context, params.requestId);
  } catch (cause) {
    const error = normalizeRemovalError(cause);
    await markDayOffRemovalFailed(prepared, params.context, params.requestId, error.code).catch(() => undefined);
    throw error;
  }

  return { removed: true, alreadyRemoved: false };
}
