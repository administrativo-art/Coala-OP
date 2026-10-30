import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';

import type { ServerUserContext } from '@/lib/auth-server';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { repPDbAdmin } from '@/lib/firebase-rep-p-admin';
import { AppError } from '@/lib/observability/app-error';

import { REP_P_LOCATION_RETENTION_DAYS } from './location';
import { loadRepPLocationPolicies } from './location-policy.server';
import { readOwnRepPMonth } from './own-month.server';
import { listRepPMarkingsOfPerson } from './service.server';
import type { JourneyLocationLeaseInput } from './schemas';
import { zonedFiscalTimestamp } from '@/features/dp/time-adjustments/core';

export const JOURNEY_LOCATION_LEASES = 'dp_journeyLocationLeases';
export const JOURNEY_LOCATION_LEASE_MINUTES = 20;
const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
const leaseId = (workspaceId: string, employeeId: string, sessionId: string) =>
  createHash('sha256').update(JSON.stringify(['journey-location-lease', workspaceId, employeeId, sessionId])).digest('hex');

type Dependencies = { hrDb: Firestore; policyDb: Firestore; now: () => Date; enabled: boolean;
  readMonth: typeof readOwnRepPMonth; readMarkings: typeof listRepPMarkingsOfPerson;
  loadPolicies: typeof loadRepPLocationPolicies };
const defaults: Dependencies = { hrDb: hrDbAdmin, policyDb: repPDbAdmin, now: () => new Date(),
  enabled: process.env.DP_JOURNEY_LOCATION_ENABLED === 'true', readMonth: readOwnRepPMonth,
  readMarkings: listRepPMarkingsOfPerson, loadPolicies: loadRepPLocationPolicies };

function denied(code: string, message: string) {
  return new AppError({ code, kind: 'AUTHORIZATION', safeMessage: message });
}

function plusCivilDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function shiftWindowContainsNow(shift: Awaited<ReturnType<typeof readOwnRepPMonth>>['shifts'][number], now: Date) {
  if (!shift.startTime || !shift.endTime || !shift.unitTimeZone) return false;
  const endDate = shift.overnight ? plusCivilDays(shift.date, 1) : shift.date;
  const startAt = Date.parse(zonedFiscalTimestamp(shift.date, shift.startTime, shift.unitTimeZone)) - 4 * 3_600_000;
  const endAt = Date.parse(zonedFiscalTimestamp(endDate, shift.endTime, shift.unitTimeZone)) + 2 * 3_600_000;
  return Number.isFinite(startAt) && Number.isFinite(endAt) && now.getTime() >= startAt && now.getTime() <= endAt;
}

function openJourneyState(markings: Awaited<ReturnType<typeof listRepPMarkingsOfPerson>>['markings'],
  workDate: string, executionUnitId: string) {
  let state: 'active' | 'paused' | 'stopped' | null = null;
  const ordered = markings.filter((item) => item.workDate === workDate && item.executionUnitId === executionUnitId)
    .sort((left, right) => Date.parse(left.markedAt) - Date.parse(right.markedAt));
  for (const marking of ordered) {
    switch (marking.classification?.purpose) {
      case 'journey_start': state = state === null || state === 'stopped' ? 'active' : null; break;
      case 'break_start': state = state === 'active' ? 'paused' : null; break;
      case 'break_end': state = state === 'paused' ? 'active' : null; break;
      case 'journey_end': state = state === 'active' || state === 'paused' ? 'stopped' : null; break;
      default: break;
    }
    if (state === null) return null;
  }
  return state;
}

/** A short lease is issued only from live server policy. Device ownership is deliberately irrelevant. */
export async function issueOwnJourneyLocationLease(context: ServerUserContext, input: JourneyLocationLeaseInput,
  injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  if (!deps.enabled) throw denied('DP_JOURNEY_LOCATION_DISABLED', 'O acompanhamento de jornada não está disponível.');
  const now = deps.now();
  const month = await deps.readMonth(context, { month: input.workDate.slice(0, 7) });
  const shift = month.shifts.find((item) => item.date === input.workDate && item.type === 'work');
  if (!shift || shift.executionUnitPolicy !== 'free' || shift.locationTrackingPolicy !== 'workday' || !shiftWindowContainsNow(shift, now)) {
    throw denied('DP_JOURNEY_LOCATION_NOT_CONFIGURED', 'Este turno não usa acompanhamento durante a jornada.');
  }
  const history = await deps.readMarkings(context.workspace_id, context.decoded.uid,
    { startDate: input.workDate, endDate: input.workDate });
  if (openJourneyState(history.markings, input.workDate, input.executionUnitId) !== 'active') {
    throw denied('DP_JOURNEY_LOCATION_JOURNEY_INACTIVE', 'O acompanhamento só fica disponível durante a jornada ativa.');
  }
  const policy = (await deps.loadPolicies(deps.policyDb, context.workspace_id, [input.executionUnitId])).get(input.executionUnitId);
  if (!policy || policy.mode !== 'observe' || !policy.participantUserIds.includes(context.decoded.uid)
    || !policy.legalBasisReference || policy.retentionDays !== REP_P_LOCATION_RETENTION_DAYS) {
    throw denied('DP_JOURNEY_LOCATION_POLICY_INACTIVE', 'O acompanhamento não está ativo para esta pessoa e unidade.');
  }
  const expiresAt = new Date(now.getTime() + JOURNEY_LOCATION_LEASE_MINUTES * 60_000);
  const token = randomBytes(32).toString('base64url');
  await deps.hrDb.collection(JOURNEY_LOCATION_LEASES).doc(leaseId(context.workspace_id, context.decoded.uid, input.sessionId)).set({
    schemaVersion: 1, workspaceId: context.workspace_id, employeeId: context.decoded.uid, sessionId: input.sessionId,
    workDate: input.workDate, executionUnitId: input.executionUnitId, tokenHash: tokenHash(token),
    policyRevision: policy.revision, issuedAt: Timestamp.fromDate(now), expiresAt: Timestamp.fromDate(expiresAt),
    lastRenewedAt: Timestamp.fromDate(now), status: 'active', purpose: 'operational_journey_between_units_human_review_only',
  }, { merge: true });
  return { leaseToken: token, expiresAt: expiresAt.toISOString(), config: {
    movingMinSeconds: 120, movingMinMeters: 120, stationaryMaxSeconds: 900, maxAccuracyMeters: 150,
  } };
}

export async function validateOwnJourneyLocationLease(context: ServerUserContext, input: {
  sessionId: string; workDate: string; executionUnitId: string; leaseToken: string;
}, injected: Pick<Dependencies, 'hrDb' | 'now'> = { hrDb: hrDbAdmin, now: () => new Date() }) {
  const snapshot = await injected.hrDb.collection(JOURNEY_LOCATION_LEASES)
    .doc(leaseId(context.workspace_id, context.decoded.uid, input.sessionId)).get();
  const expiresAt = snapshot.get('expiresAt');
  if (!snapshot.exists || snapshot.get('workspaceId') !== context.workspace_id || snapshot.get('employeeId') !== context.decoded.uid
    || snapshot.get('sessionId') !== input.sessionId || snapshot.get('workDate') !== input.workDate
    || snapshot.get('executionUnitId') !== input.executionUnitId
    || snapshot.get('status') !== 'active' || snapshot.get('tokenHash') !== tokenHash(input.leaseToken)
    || !(expiresAt instanceof Timestamp) || expiresAt.toMillis() <= injected.now().getTime()) {
    throw denied('DP_JOURNEY_LOCATION_LEASE_INVALID', 'A autorização temporária de localização expirou.');
  }
  return snapshot.data()!;
}

export async function revokeOwnJourneyLocationLease(context: ServerUserContext, sessionId: string,
  injected: Pick<Dependencies, 'hrDb' | 'now'> = { hrDb: hrDbAdmin, now: () => new Date() }) {
  const ref = injected.hrDb.collection(JOURNEY_LOCATION_LEASES)
    .doc(leaseId(context.workspace_id, context.decoded.uid, sessionId));
  const snapshot = await ref.get();
  if (snapshot.exists && snapshot.get('workspaceId') === context.workspace_id
    && snapshot.get('employeeId') === context.decoded.uid && snapshot.get('sessionId') === sessionId) {
    await ref.set({ status: 'revoked', revokedAt: Timestamp.fromDate(injected.now()) }, { merge: true });
  }
}
