import 'server-only';

import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { Timestamp } from 'firebase-admin/firestore';

import { zonedFiscalTimestamp } from '@/features/dp/time-adjustments/core';
import type { ServerUserContext } from '@/lib/auth-server';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { repPDbAdmin } from '@/lib/firebase-rep-p-admin';
import { AppError } from '@/lib/observability/app-error';

import { nextJourneyLocationState, type JourneyLocationState } from './journey-location-core';
import { revokeOwnJourneyLocationLease, validateOwnJourneyLocationLease } from './journey-location-lease.server';
import { REP_P_LOCATION_RETENTION_DAYS } from './location';
import { loadRepPLocationPolicies } from './location-policy.server';
import { readOwnRepPMonth, type RepPOwnScheduledShift } from './own-month.server';
import { journeyLocationBatchSchema } from './schemas';

export const JOURNEY_LOCATION_EVENTS = 'dp_journeyLocationEvents';
export const JOURNEY_LOCATION_SESSIONS = 'dp_journeyLocationSessions';
type Dependencies = {
  repDb: Firestore;
  policyDb: Firestore;
  now: () => Date;
  enabled: boolean;
  readMonth: typeof readOwnRepPMonth;
  loadPolicies: typeof loadRepPLocationPolicies;
  validateLease: typeof validateOwnJourneyLocationLease;
  revokeLease: typeof revokeOwnJourneyLocationLease;
};
const defaults: Dependencies = {
  repDb: hrDbAdmin,
  policyDb: repPDbAdmin,
  now: () => new Date(),
  // Off until the legal/privacy decision and operational pilot authorize activation.
  enabled: process.env.DP_JOURNEY_LOCATION_ENABLED === 'true',
  readMonth: readOwnRepPMonth,
  loadPolicies: loadRepPLocationPolicies,
  validateLease: validateOwnJourneyLocationLease,
  revokeLease: revokeOwnJourneyLocationLease,
};

function fail(code: string, safeMessage: string, kind: 'VALIDATION' | 'AUTHORIZATION' | 'DATA_INTEGRITY' = 'VALIDATION') {
  return new AppError({ code, kind, safeMessage });
}
function eventKey(workspaceId: string, employeeId: string, eventId: string) {
  return createHash('sha256').update(JSON.stringify(['journey-location', workspaceId, employeeId, eventId])).digest('hex');
}
function plusCivilDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function scheduleWindow(shift: RepPOwnScheduledShift) {
  if (!shift.startTime || !shift.endTime) {
    throw fail('DP_JOURNEY_LOCATION_SCHEDULE_INCOMPLETE', 'A escala não possui horário suficiente para o acompanhamento.', 'DATA_INTEGRITY');
  }
  if (!shift.unitTimeZone) {
    throw fail('DP_JOURNEY_LOCATION_TIME_ZONE_MISSING', 'A unidade precisa ter um fuso válido para o acompanhamento.', 'DATA_INTEGRITY');
  }
  const timeZone = shift.unitTimeZone;
  const startAt = Date.parse(zonedFiscalTimestamp(shift.date, shift.startTime, timeZone));
  const endDate = shift.overnight ? plusCivilDays(shift.date, 1) : shift.date;
  const endAt = Date.parse(zonedFiscalTimestamp(endDate, shift.endTime, timeZone));
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) {
    throw fail('DP_JOURNEY_LOCATION_SCHEDULE_INVALID', 'A escala não define uma janela válida para o acompanhamento.', 'DATA_INTEGRITY');
  }
  // Early arrival remains possible, but the server never accepts an unbounded civil-day trail.
  return { scheduledStartAt: startAt, scheduledEndAt: endAt, windowStartAt: startAt - 4 * 3_600_000,
    windowEndAt: endAt + 2 * 3_600_000, scheduledTimeZone: timeZone };
}
function millis(value: unknown) {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') return Number(value.toMillis());
  if (typeof value === 'string') return Date.parse(value);
  return Number.NaN;
}
function validSession(session: FirebaseFirestore.DocumentData | undefined, context: ServerUserContext, sessionId: string, workDate: string) {
  return Boolean(session && session.workspaceId === context.workspace_id && session.employeeId === context.decoded.uid
    && session.sessionId === sessionId && session.workDate === workDate && Array.isArray(session.unitIds)
    && session.policies && typeof session.policies === 'object');
}

/**
 * Stores an optional operational trail separately from REP-P/PTRP. It cannot alter a punch, receipt,
 * classification, bank calculation or payroll result; consumers may only use it for human review.
 * The session state and schedule window are authoritative on the server; attestation is only an extra control.
 */
export async function recordOwnJourneyLocation(context: ServerUserContext, raw: unknown, injected: Partial<Dependencies> = {}) {
  const parsed = journeyLocationBatchSchema.safeParse(raw);
  if (!parsed.success) throw fail('DP_JOURNEY_LOCATION_INPUT_INVALID', parsed.error.issues[0]?.message ?? 'Localização inválida.');
  const deps = { ...defaults, ...injected };
  // A resposta terminal faz o aparelho interromper o serviço e remover a fila já capturada quando o kill switch
  // é desligado. Nenhuma leitura nem escrita de localização acontece neste caminho.
  if (!deps.enabled) return { acceptedEventIds: parsed.data.events.map((event) => event.eventId), stopRequested: true };
  const first = parsed.data.events[0];
  if (parsed.data.events.some((event) => event.executionUnitId !== first.executionUnitId)) {
    throw fail('DP_JOURNEY_LOCATION_UNIT_MISMATCH', 'O lote de localização não corresponde à unidade autorizada.');
  }
  const unitIds = [...new Set(parsed.data.events.map((event) => event.executionUnitId))];
  const now = deps.now();
  await deps.validateLease(context, { sessionId: first.sessionId, workDate: first.workDate,
    executionUnitId: first.executionUnitId, leaseToken: parsed.data.leaseToken },
    { hrDb: deps.repDb, now: deps.now });
  if (parsed.data.events.some((event) => Date.parse(event.capturedAt) > now.getTime() + 5 * 60_000)) {
    throw fail('DP_JOURNEY_LOCATION_TIME_INVALID', 'O horário de uma amostra não corresponde à jornada.');
  }

  const sessionRef = deps.repDb.collection(JOURNEY_LOCATION_SESSIONS)
    .doc(eventKey(context.workspace_id, context.decoded.uid, first.sessionId));
  const preliminary = (await sessionRef.get()).data();
  let initial: FirebaseFirestore.DocumentData | undefined;
  if (!preliminary) {
    const month = await deps.readMonth(context, { month: first.workDate.slice(0, 7) });
    const shift = month.shifts.find((item) => item.date === first.workDate && item.type === 'work');
    if (!shift || shift.executionUnitPolicy !== 'free' || shift.locationTrackingPolicy !== 'workday') {
      throw fail('DP_JOURNEY_LOCATION_NOT_CONFIGURED', 'Este turno não usa acompanhamento entre unidades.', 'AUTHORIZATION');
    }
    const window = scheduleWindow(shift);
    initial = {
      schemaVersion: 2, workspaceId: context.workspace_id, employeeId: context.decoded.uid,
      sessionId: first.sessionId, workDate: first.workDate, unitIds: [], policies: {}, state: null,
      scheduledTimeZone: window.scheduledTimeZone,
      scheduledStartAt: Timestamp.fromMillis(window.scheduledStartAt), scheduledEndAt: Timestamp.fromMillis(window.scheduledEndAt),
      windowStartAt: Timestamp.fromMillis(window.windowStartAt), windowEndAt: Timestamp.fromMillis(window.windowEndAt),
      purpose: 'operational_journey_between_units_human_review_only', createdAt: Timestamp.fromDate(now),
      expiresAt: Timestamp.fromMillis(now.getTime() + REP_P_LOCATION_RETENTION_DAYS * 86_400_000),
    };
  } else if (!validSession(preliminary, context, first.sessionId, first.workDate)) {
    throw fail('DP_JOURNEY_LOCATION_SESSION_INVALID', 'A sessão de localização não corresponde à jornada.', 'DATA_INTEGRITY');
  }

  const livePolicies = await deps.loadPolicies(deps.policyDb, context.workspace_id, unitIds);
  const policyActive = unitIds.every((unitId) => {
    const policy = livePolicies.get(unitId);
    return policy?.mode === 'observe' && policy.participantUserIds.includes(context.decoded.uid)
      && Boolean(policy.legalBasisReference) && policy.retentionDays === REP_P_LOCATION_RETENTION_DAYS;
  });
  if (!policyActive && !preliminary) {
    throw fail('DP_JOURNEY_LOCATION_POLICY_INACTIVE', 'O acompanhamento não está ativo para esta pessoa e unidade.', 'AUTHORIZATION');
  }
  if (!policyActive) {
    // Revocation acknowledges and discards the delayed mobile batch, so coordinates do not remain
    // retrying on the device and no new position is stored after the policy ceased to apply.
    await deps.repDb.runTransaction(async (transaction) => {
      const current = await transaction.get(sessionRef);
      const session = current.data();
      if (!validSession(session, context, first.sessionId, first.workDate)) {
        throw fail('DP_JOURNEY_LOCATION_SESSION_INVALID', 'A sessão de localização não corresponde à jornada.', 'DATA_INTEGRITY');
      }
      if (session!.state !== 'stopped') transaction.update(sessionRef, {
        state: 'stopped', stoppedReason: 'policy_revoked', stoppedAt: Timestamp.fromDate(now), updatedAt: Timestamp.fromDate(now),
      });
    });
    await deps.revokeLease(context, first.sessionId, { hrDb: deps.repDb, now: deps.now });
    return { acceptedEventIds: parsed.data.events.map((event) => event.eventId), stopRequested: true };
  }

  const refs = parsed.data.events.map((event) => deps.repDb.collection(JOURNEY_LOCATION_EVENTS)
    .doc(eventKey(context.workspace_id, context.decoded.uid, event.eventId)));
  const outcome = await deps.repDb.runTransaction(async (transaction) => {
    const current = await transaction.get(sessionRef);
    const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
    const session = current.exists ? current.data() : initial;
    if (!validSession(session, context, first.sessionId, first.workDate)) {
      throw fail('DP_JOURNEY_LOCATION_SESSION_INVALID', 'A sessão de localização não corresponde à jornada.', 'DATA_INTEGRITY');
    }
    const windowStartAt = millis(session!.windowStartAt);
    const windowEndAt = millis(session!.windowEndAt);
    let state = (session!.state ?? null) as JourneyLocationState | null;
    let lastCapturedAt = millis(session!.lastCapturedAt);
    if (!Number.isFinite(lastCapturedAt)) lastCapturedAt = Number.NEGATIVE_INFINITY;
    let lastPositionCapturedAt = millis(session!.lastPositionCapturedAt);
    if (!Number.isFinite(lastPositionCapturedAt)) lastPositionCapturedAt = Number.NEGATIVE_INFINITY;
    let eventCount = Number(session!.eventCount ?? 0);
    const unitSet = new Set<string>((session!.unitIds as unknown[]).filter((value): value is string => typeof value === 'string'));
    const policies = { ...(session!.policies as Record<string, unknown>) };

    parsed.data.events.forEach((event, index) => {
      const existing = snapshots[index];
      if (existing.exists) {
        if (existing.get('workspaceId') !== context.workspace_id || existing.get('employeeId') !== context.decoded.uid
          || existing.get('sessionId') !== event.sessionId || existing.get('workDate') !== event.workDate
          || existing.get('eventId') !== event.eventId) {
          throw fail('DP_JOURNEY_LOCATION_EVENT_CONFLICT', 'Um evento de localização conflita com o histórico.', 'DATA_INTEGRITY');
        }
        return;
      }
      const capturedAt = Date.parse(event.capturedAt);
      if (!Number.isFinite(capturedAt) || capturedAt < windowStartAt || capturedAt > windowEndAt || capturedAt < lastCapturedAt) {
        throw fail('DP_JOURNEY_LOCATION_TIME_INVALID', 'O horário de uma amostra não corresponde à janela autorizada da escala.');
      }
      try { state = nextJourneyLocationState(state, event.eventType); }
      catch { throw fail('DP_JOURNEY_LOCATION_SEQUENCE_INVALID', 'A sequência do acompanhamento não corresponde ao ciclo da jornada.'); }
      lastCapturedAt = capturedAt;
      if (event.latitude !== undefined && event.latitude !== null) {
        if (capturedAt - lastPositionCapturedAt < 30_000) {
          // A restart can produce an eager first fix. Acknowledge and ignore only that redundant
          // sample instead of terminating the whole authorized journey.
          return;
        }
        lastPositionCapturedAt = capturedAt;
      }
      eventCount += 1;
      if (eventCount > 500) throw fail('DP_JOURNEY_LOCATION_SESSION_LIMIT', 'A sessão atingiu o limite de amostras autorizado.');
      unitSet.add(event.executionUnitId);
      const policy = livePolicies.get(event.executionUnitId)!;
      policies[event.executionUnitId] = { revision: policy.revision, legalBasisReference: policy.legalBasisReference };
      transaction.create(refs[index], {
        schemaVersion: 2, workspaceId: context.workspace_id, employeeId: context.decoded.uid,
        eventId: event.eventId, sessionId: event.sessionId, workDate: event.workDate,
        executionUnitId: event.executionUnitId, eventType: event.eventType,
        capturedAt: Timestamp.fromMillis(capturedAt),
        position: event.latitude === undefined || event.latitude === null ? null : {
          latitude: event.latitude, longitude: event.longitude, accuracyMeters: event.accuracyMeters,
        },
        policyRevision: Number(policy.revision), legalBasisReference: String(policy.legalBasisReference),
        purpose: 'operational_journey_between_units_human_review_only', receivedAt: Timestamp.fromDate(now),
        expiresAt: session!.expiresAt,
      });
    });
    const update = {
      state, unitIds: [...unitSet], policies, eventCount,
      lastCapturedAt: Timestamp.fromMillis(lastCapturedAt),
      ...(Number.isFinite(lastPositionCapturedAt) ? { lastPositionCapturedAt: Timestamp.fromMillis(lastPositionCapturedAt) } : {}),
      updatedAt: Timestamp.fromDate(now),
      ...(state === 'stopped' ? { stoppedAt: Timestamp.fromMillis(lastCapturedAt), stoppedReason: 'client_stop' } : {}),
    };
    if (current.exists) transaction.update(sessionRef, update);
    else transaction.create(sessionRef, { ...session, ...update });
    return { acceptedEventIds: parsed.data.events.map((event) => event.eventId), stopRequested: false };
  });
  if (parsed.data.events.some((event) => event.eventType === 'stop')) {
    await deps.revokeLease(context, first.sessionId, { hrDb: deps.repDb, now: deps.now });
  }
  return outcome;
}
