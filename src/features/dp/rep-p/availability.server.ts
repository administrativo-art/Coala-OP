import 'server-only';

import { createHash } from 'node:crypto';

import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { Timestamp } from 'firebase-admin/firestore';

import { repPDbAdmin } from '@/lib/firebase-rep-p-admin';
import { AppError } from '@/lib/observability/app-error';

import type { RepPSensitiveEvent } from './afd';
import { planRepPAvailabilityTransition, type RepPAvailabilityState } from './availability';
import { assertTrustedRepPClockReading, formatRepPAfdTimestamp, unconfiguredRepPClock, type RepPClock,
  type RepPClockReading } from './clock';
import { configuredRepPClock } from './hlb-ntp-clock.server';
import { repPOfficialMarkingEnabled } from './runtime-config';

const ESTABLISHMENTS = 'repP_establishments';
const EVENTS = 'repP_events';
const INCIDENTS = 'repP_availabilityIncidents';
const STATES = 'repP_availabilityStates';
const MAX_ESTABLISHMENTS = 100;
const MAX_OPEN_INCIDENTS = 20;

export type RepPAvailabilityNotification = Readonly<{
  incidentId: string;
  state: RepPAvailabilityState;
  startedAt: number;
  endedAt?: number;
  policyName: string;
  conditionName: string;
}>;

type Dependencies = Readonly<{
  repDb: Firestore;
  clock: RepPClock;
  markingEnabled: boolean;
}>;

const environmentClock = configuredRepPClock() ?? unconfiguredRepPClock;
const defaults: Dependencies = {
  repDb: repPDbAdmin,
  clock: environmentClock,
  markingEnabled: repPOfficialMarkingEnabled(),
};

type EstablishmentDocument = Readonly<{
  schemaVersion: 1;
  workspaceId: string;
  establishmentId: string;
  status: 'ready';
  timeZone: string;
  lastNsr: number;
}>;

function fail(code: string, safeMessage: string, kind: 'VALIDATION' | 'DATA_INTEGRITY' | 'CONFLICT' = 'VALIDATION') {
  return new AppError({ code, kind, retryable: false, safeMessage });
}

function digest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function eventKey(establishmentId: string, nsr: number) {
  return `${establishmentId}_${String(nsr).padStart(9, '0')}`;
}

function incidentKey(establishmentId: string, incidentId: string) {
  return digest(['availability-incident', establishmentId, incidentId]);
}

function validEstablishment(value: unknown): value is EstablishmentDocument {
  const item = value as EstablishmentDocument | undefined;
  return Boolean(item?.schemaVersion === 1 && item.status === 'ready' && item.workspaceId?.trim()
    && item.establishmentId?.trim() && item.timeZone?.trim()
    && Number.isSafeInteger(item.lastNsr) && item.lastNsr >= 0 && item.lastNsr <= 999_999_999);
}

function storedOpenIncidentIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length <= 256))]
    .slice(0, MAX_OPEN_INCIDENTS);
}

function trustedClockEvidence(reading: RepPClockReading) {
  return {
    source: reading.source,
    assurance: reading.assurance,
    observedOffsetMs: reading.observedOffsetMs,
    verifiedAt: reading.verifiedAt.toISOString(),
    serverInstant: reading.instant.toISOString(),
    attestationId: reading.attestationId,
    attestationMode: reading.attestationMode,
    quorum: reading.quorum,
    observations: reading.observations,
  };
}

function createAvailabilityEvent(params: {
  transaction: Transaction;
  deps: Dependencies;
  establishment: EstablishmentDocument;
  notification: RepPAvailabilityNotification;
  reading: RepPClockReading;
  eventCode: '07' | '08';
  nsr: number;
}) {
  const { transaction, deps, establishment, notification, reading, eventCode, nsr } = params;
  if (nsr > 999_999_999) throw fail('REP_P_NSR_EXHAUSTED', 'A sequência fiscal do estabelecimento se esgotou.', 'DATA_INTEGRITY');
  const recordedAt = formatRepPAfdTimestamp(reading.instant, establishment.timeZone);
  const event: RepPSensitiveEvent = { recordType: '6', nsr, establishmentId: establishment.establishmentId,
    recordedAt, eventCode };
  transaction.create(deps.repDb.collection(EVENTS).doc(eventKey(establishment.establishmentId, nsr)), {
    ...event,
    workspaceId: establishment.workspaceId,
    recordedDate: recordedAt.slice(0, 10),
    availabilityIncidentId: notification.incidentId,
    availabilityPolicyName: notification.policyName,
    availabilityConditionName: notification.conditionName,
    observedStartedAt: Timestamp.fromMillis(notification.startedAt * 1_000),
    ...(notification.endedAt ? { observedEndedAt: Timestamp.fromMillis(notification.endedAt * 1_000) } : {}),
    trustedClock: trustedClockEvidence(reading),
    createdAt: Timestamp.now(),
  });
}

/** Sonda a fronteira real usada pela batida: banco dedicado e quórum fresco da Hora Legal. */
export async function checkRepPCollectorAvailability(injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  const [reading] = await Promise.all([
    deps.clock.read({ requireFresh: true }),
    deps.repDb.collection(ESTABLISHMENTS).limit(1).get(),
  ]);
  assertTrustedRepPClockReading(reading);
  return { status: 'ok' as const, checkedAt: reading.instant.toISOString(), attestationId: reading.attestationId };
}

/**
 * Converte somente transições confirmadas pelo monitor externo em eventos 6/08 e 6/07.
 * Com a coleta oficial desligada, confirma o recebimento sem tocar a ARP.
 */
export async function recordRepPAvailabilityNotification(workspaceId: string,
  notification: RepPAvailabilityNotification, injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  if (!workspaceId.trim() || !notification.incidentId.trim() || notification.incidentId.length > 256
    || !Number.isSafeInteger(notification.startedAt) || notification.startedAt <= 0
    || notification.endedAt !== undefined && (!Number.isSafeInteger(notification.endedAt) || notification.endedAt < notification.startedAt)
    || !notification.policyName.trim() || !notification.conditionName.trim()) {
    throw fail('REP_P_AVAILABILITY_NOTIFICATION_INVALID', 'Notificação de disponibilidade inválida.');
  }
  if (!deps.markingEnabled) return { status: 'official-collection-disabled' as const, establishments: 0, events: 0 };

  const [reading, establishments] = await Promise.all([
    deps.clock.read({ requireFresh: true }),
    deps.repDb.collection(ESTABLISHMENTS).where('workspaceId', '==', workspaceId).where('status', '==', 'ready')
      .limit(MAX_ESTABLISHMENTS + 1).get(),
  ]);
  assertTrustedRepPClockReading(reading);
  if (establishments.size > MAX_ESTABLISHMENTS) throw fail('REP_P_AVAILABILITY_ESTABLISHMENT_LIMIT',
    'Há estabelecimentos demais para registrar a transição com segurança.', 'DATA_INTEGRITY');

  let events = 0;
  for (const snapshot of establishments.docs) {
    const establishmentId = snapshot.id;
    const establishmentRef = deps.repDb.collection(ESTABLISHMENTS).doc(establishmentId);
    const incidentRef = deps.repDb.collection(INCIDENTS).doc(incidentKey(establishmentId, notification.incidentId));
    const stateRef = deps.repDb.collection(STATES).doc(establishmentId);
    events += await deps.repDb.runTransaction(async (transaction) => {
      const [establishmentSnapshot, incidentSnapshot, stateSnapshot] = await transaction.getAll(
        establishmentRef, incidentRef, stateRef);
      const establishment = establishmentSnapshot.data();
      if (!validEstablishment(establishment) || establishment.establishmentId !== establishmentId
        || establishment.workspaceId !== workspaceId) {
        throw fail('REP_P_AVAILABILITY_ESTABLISHMENT_INVALID', 'Cadastro fiscal inconsistente durante a transição.', 'DATA_INTEGRITY');
      }
      const storedIncidentState = incidentSnapshot.exists
        && ['open', 'closed'].includes(String(incidentSnapshot.get('state')))
        ? incidentSnapshot.get('state') as RepPAvailabilityState : null;
      const storedUnavailableNsr = Number.isSafeInteger(incidentSnapshot.get('unavailableNsr'))
        ? Number(incidentSnapshot.get('unavailableNsr')) : null;
      const openIncidentIds = storedOpenIncidentIds(stateSnapshot.get('openIncidentIds'));
      const plan = planRepPAvailabilityTransition({ incidentId: notification.incidentId,
        incomingState: notification.state, storedIncidentState, storedUnavailableNsr, openIncidentIds });
      if (plan.replayed) return 0;

      let nextNsr = establishment.lastNsr + 1;
      const createdNsrs: Partial<Record<'07' | '08', number>> = {};
      for (const eventCode of plan.eventCodes) {
        createAvailabilityEvent({ transaction, deps, establishment, notification, reading, eventCode, nsr: nextNsr });
        createdNsrs[eventCode] = nextNsr;
        nextNsr += 1;
      }
      if (plan.eventCodes.length) transaction.update(establishmentRef, { lastNsr: nextNsr - 1 });
      transaction.set(stateRef, {
        schemaVersion: 1, workspaceId, establishmentId, serviceStatus: plan.serviceStatus,
        openIncidentIds: plan.openIncidentIds, lastIncidentId: notification.incidentId,
        updatedAt: Timestamp.now(),
      }, { merge: true });
      transaction.set(incidentRef, {
        schemaVersion: 1, workspaceId, establishmentId, incidentId: notification.incidentId,
        state: notification.state, policyName: notification.policyName, conditionName: notification.conditionName,
        observedStartedAt: Timestamp.fromMillis(notification.startedAt * 1_000),
        ...(notification.endedAt ? { observedEndedAt: Timestamp.fromMillis(notification.endedAt * 1_000) } : {}),
        ...(storedUnavailableNsr ? { unavailableNsr: storedUnavailableNsr } : {}),
        ...(createdNsrs['08'] ? { unavailableNsr: createdNsrs['08'] } : {}),
        ...(createdNsrs['07'] ? { availableNsr: createdNsrs['07'] } : {}),
        updatedAt: Timestamp.now(),
      }, { merge: true });
      return plan.eventCodes.length;
    });
  }
  return { status: 'recorded' as const, establishments: establishments.size, events };
}
