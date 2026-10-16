import 'server-only';

import { createHash } from 'node:crypto';
import type { ServerUserContext } from '@/lib/auth-server';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { AppError } from '@/lib/observability/app-error';
import { canAccessUnit } from '@/lib/unit-access';
import { requireAbsenceWorkflowReady } from '../catalog.server';
import { absenceCivilDateSchema } from './schemas';
import type { AbsenceDaySegment } from './reservations';
import type { AbsenceRequestRecord } from './workflow-types';

export type AbsenceAvailabilityShadowResult = {
  requestId: string; mode: 'shadow'; operationallyApplied: false; state: 'active' | 'reversed';
  sourceVersion: number; revision: number; intervalCount: number; blocksSchedule: boolean;
};
type Input = { expectedVersion: number; operationId: string };
type ShadowInterval = Pick<AbsenceDaySegment, 'date' | 'fromMinute' | 'toMinute'>;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const fail = (code: string, kind: 'NOT_FOUND' | 'CONFLICT' | 'AUTHORIZATION' | 'DATA_INTEGRITY') =>
  new AppError({ code, kind, safeMessage: kind === 'AUTHORIZATION' ? 'Sem acesso à unidade.' : 'Projeção de disponibilidade indisponível.' });
function validSegments(raw: unknown, unit: unknown): raw is AbsenceDaySegment[] {
  return (unit === 'day' || unit === 'hour') && Array.isArray(raw) && raw.length > 0 && raw.length <= 180
    && raw.every((segment, index) => segment
    && absenceCivilDateSchema.safeParse(segment.date).success
    && (index === 0 || raw[index - 1].date < segment.date)
    && Number.isInteger(segment.fromMinute) && Number.isInteger(segment.toMinute)
    && segment.fromMinute >= 0 && segment.toMinute <= 1440 && segment.fromMinute < segment.toMinute
    && Number.isSafeInteger(segment.quantityMinor)
    && segment.quantityMinor === (unit === 'day' ? 1 : segment.toMinute - segment.fromMinute)
    && (unit !== 'day' || segment.fromMinute === 0 && segment.toMinute === 1440)
    && typeof segment.periodKey === 'string');
}
function resultOf(requestId: string, data: { state: 'active' | 'reversed'; sourceVersion: number;
  revision: number; intervals: ShadowInterval[]; blocksSchedule: boolean }): AbsenceAvailabilityShadowResult {
  return { requestId, mode: 'shadow', operationallyApplied: false, state: data.state,
    sourceVersion: data.sourceVersion, revision: data.revision, intervalCount: data.intervals.length,
    blocksSchedule: data.blocksSchedule };
}

/** RH-only derived state. This does not consume the operational projection outbox or change any shift. */
export async function reconcileAbsenceAvailabilityShadow(actor: ServerUserContext, requestId: string, input: Input) {
  await requireAbsenceWorkflowReady();
  if (!actor.isDefaultAdmin && actor.permissions.dp.schedules.edit !== true) throw fail('ABSENCE_SHADOW_FORBIDDEN', 'AUTHORIZATION');
  const requestRef = hrDbAdmin.collection('dp_absenceRequests').doc(requestId);
  const occurrenceRef = hrDbAdmin.collection('dp_absenceOccurrences').doc(requestId);
  const shadowRef = hrDbAdmin.collection('dp_absenceAvailabilityShadow').doc(requestId);
  const receiptId = hash(`${requestId}:${input.operationId}`);
  const receiptRef = hrDbAdmin.collection('dp_absenceShadowOperations').doc(receiptId);
  return hrDbAdmin.runTransaction(async (tx) => {
    const requestDoc = await tx.get(requestRef);
    if (!requestDoc.exists) throw fail('ABSENCE_SHADOW_NOT_FOUND', 'NOT_FOUND');
    const request = requestDoc.data() as AbsenceRequestRecord;
    if (request.workspaceId !== actor.workspace_id) throw fail('ABSENCE_SHADOW_NOT_FOUND', 'NOT_FOUND');
    if (!canAccessUnit(actor.userDoc, request.unitId, { isDefaultAdmin: actor.isDefaultAdmin })) throw fail('ABSENCE_SHADOW_FORBIDDEN', 'AUTHORIZATION');
    if (request.version !== input.expectedVersion) throw fail('ABSENCE_SHADOW_VERSION_CONFLICT', 'CONFLICT');
    if (!['approved', 'cancelled'].includes(request.status)) throw fail('ABSENCE_SHADOW_STATE_UNAVAILABLE', 'CONFLICT');
    const [occurrenceDoc, shadowDoc, receiptDoc] = await Promise.all([
      tx.get(occurrenceRef), tx.get(shadowRef), tx.get(receiptRef),
    ]);
    if (!occurrenceDoc.exists || occurrenceDoc.get('status') !== 'approved'
      || occurrenceDoc.get('requestId') !== requestId || occurrenceDoc.get('workspaceId') !== request.workspaceId
      || occurrenceDoc.get('beneficiaryUid') !== request.beneficiaryUid || occurrenceDoc.get('unitId') !== request.unitId
      || !Number.isSafeInteger(occurrenceDoc.get('requestVersion')) || occurrenceDoc.get('requestVersion') < 1
      || !Number.isSafeInteger(occurrenceDoc.get('revision')) || occurrenceDoc.get('revision') < 1
      || !validSegments(occurrenceDoc.get('segments'), occurrenceDoc.get('unit'))
      || typeof occurrenceDoc.get('typeSnapshot')?.blocksSchedule !== 'boolean') {
      throw fail('ABSENCE_SHADOW_SOURCE_UNPROVEN', 'DATA_INTEGRITY');
    }
    const occurrenceVersion = occurrenceDoc.get('requestVersion') as number;
    const revision = occurrenceDoc.get('revision') as number;
    const originalSegments = occurrenceDoc.get('segments') as AbsenceDaySegment[];
    const reversalRef = hrDbAdmin.collection('dp_absenceReversals').doc(`${requestId}_${request.version}`);
    const reversal = request.status === 'cancelled' ? await tx.get(reversalRef) : null;
    if (request.status === 'approved' && (occurrenceVersion !== request.version || revision !== request.revision
      || JSON.stringify(originalSegments) !== JSON.stringify(request.segments))) {
      throw fail('ABSENCE_SHADOW_SOURCE_UNPROVEN', 'DATA_INTEGRITY');
    }
    if (request.status === 'cancelled' && (!reversal?.exists || reversal.get('requestId') !== requestId
      || reversal.get('workspaceId') !== request.workspaceId || reversal.get('originalVersion') !== occurrenceVersion
      || reversal.get('reversalVersion') !== request.version
      || JSON.stringify(reversal.get('originalSegments')) !== JSON.stringify(originalSegments))) {
      throw fail('ABSENCE_SHADOW_REVERSAL_UNPROVEN', 'DATA_INTEGRITY');
    }
    if (receiptDoc.exists) {
      if (receiptDoc.get('requestId') !== requestId || receiptDoc.get('workspaceId') !== actor.workspace_id
        || receiptDoc.get('actorUid') !== actor.decoded.uid || receiptDoc.get('expectedVersion') !== input.expectedVersion) {
        throw fail('ABSENCE_SHADOW_OPERATION_CONFLICT', 'CONFLICT');
      }
      const previous = receiptDoc.get('result') as AbsenceAvailabilityShadowResult | undefined;
      if (!previous || previous.requestId !== requestId || previous.mode !== 'shadow'
        || previous.operationallyApplied !== false || previous.sourceVersion !== request.version) {
        throw fail('ABSENCE_SHADOW_OPERATION_CONFLICT', 'DATA_INTEGRITY');
      }
      return previous;
    }
    const previousVersion = shadowDoc.exists ? shadowDoc.get('sourceVersion') : 0;
    if (!Number.isSafeInteger(previousVersion) || previousVersion > request.version) throw fail('ABSENCE_SHADOW_STALE', 'DATA_INTEGRITY');
    const state = request.status === 'approved' ? 'active' as const : 'reversed' as const;
    const intervals: ShadowInterval[] = state === 'active'
      ? originalSegments.map(({ date, fromMinute, toMinute }) => ({ date, fromMinute, toMinute })) : [];
    const blocksSchedule = state === 'active' && occurrenceDoc.get('typeSnapshot').blocksSchedule === true;
    const timestamp = new Date().toISOString();
    const shadow = { requestId, workspaceId: request.workspaceId, beneficiaryUid: request.beneficiaryUid,
      unitId: request.unitId, shadow: true, mode: 'shadow', operationallyApplied: false,
      state, sourceVersion: request.version, revision, occurrenceVersion, blocksSchedule,
      intervals, reconciledAt: timestamp };
    const result = resultOf(requestId, shadow);
    tx.set(shadowRef, shadow);
    tx.create(receiptRef, { requestId, workspaceId: request.workspaceId, actorUid: actor.decoded.uid,
      expectedVersion: input.expectedVersion, operationId: input.operationId, shadow: true,
      result, at: timestamp });
    tx.create(hrDbAdmin.collection('dp_absenceAudit').doc(`shadow_${receiptId}`), { requestId,
      workspaceId: request.workspaceId, beneficiaryUid: request.beneficiaryUid, actorUid: actor.decoded.uid,
      action: state === 'active' ? 'shadow_ready' : 'shadow_reversed', sourceVersion: request.version,
      shadow: true, at: timestamp, ttl: new Date(Date.now() + 365 * 86_400_000) });
    return result;
  });
}
