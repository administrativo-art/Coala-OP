import { createHash } from 'node:crypto';

export const REP_P_LOCATION_MODES = ['disabled', 'observe'] as const;
export const REP_P_LOCATION_RETENTION_DAYS = 1_825;
export type RepPLocationMode = typeof REP_P_LOCATION_MODES[number];
export type RepPLocationCaptureStatus = 'captured' | 'denied' | 'unavailable' | 'timeout' | 'unsupported' | 'error';
export type RepPLocationEvaluation = 'inside' | 'outside' | 'indeterminate' | 'not_requested';

export type RepPLocationAttempt = Readonly<{
  captureId: string;
  status: RepPLocationCaptureStatus;
  capturedAt?: string;
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
  elapsedMs: number;
}>;

export type RepPLocationPolicySnapshot = Readonly<{
  schemaVersion: 1;
  workspaceId: string;
  executionUnitId: string;
  revision: number;
  mode: RepPLocationMode;
  center: { latitude: number; longitude: number } | null;
  radiusMeters: number | null;
  maxAccuracyMeters: number | null;
  maxAgeSeconds: number | null;
  captureTimeoutMs: number | null;
  privacyNoticeUrl: string | null;
  legalBasisReference: string | null;
  retentionDays: number | null;
  participantUserIds: string[];
  activatedAt: string | null;
  activatedBy: string | null;
}>;

export type RepPLocationResult = Readonly<{
  captureStatus: RepPLocationCaptureStatus | 'not_requested';
  evaluation: RepPLocationEvaluation;
  reason: 'policy_disabled' | 'capture_failed' | 'capture_stale' | 'capture_future'
    | 'accuracy_exceeded' | 'inside' | 'outside' | 'accuracy_overlap';
  distanceMeters: number | null;
}>;

const EARTH_RADIUS_METERS = 6_371_008.8;

function radians(value: number) {
  return value * Math.PI / 180;
}

/** Distância geodésica suficiente para a área curta de uma unidade, calculada somente no servidor. */
export function repPLocationDistanceMeters(
  left: { latitude: number; longitude: number },
  right: { latitude: number; longitude: number },
) {
  const lat1 = radians(left.latitude);
  const lat2 = radians(right.latitude);
  const deltaLat = radians(right.latitude - left.latitude);
  const deltaLon = radians(right.longitude - left.longitude);
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function evaluateRepPLocation(
  policy: RepPLocationPolicySnapshot,
  attempt: RepPLocationAttempt | null | undefined,
  recordedAt: Date,
): RepPLocationResult {
  if (policy.mode === 'disabled') {
    return { captureStatus: 'not_requested', evaluation: 'not_requested', reason: 'policy_disabled', distanceMeters: null };
  }
  if (!attempt || attempt.status !== 'captured' || attempt.latitude === undefined || attempt.longitude === undefined
    || attempt.accuracyMeters === undefined || !attempt.capturedAt) {
    return { captureStatus: attempt?.status ?? 'unavailable', evaluation: 'indeterminate', reason: 'capture_failed', distanceMeters: null };
  }
  if (!policy.center || policy.radiusMeters === null || policy.maxAccuracyMeters === null || policy.maxAgeSeconds === null) {
    return { captureStatus: attempt.status, evaluation: 'indeterminate', reason: 'capture_failed', distanceMeters: null };
  }
  const capturedAt = Date.parse(attempt.capturedAt);
  const ageMs = recordedAt.getTime() - capturedAt;
  if (!Number.isFinite(capturedAt) || ageMs < -30_000) {
    return { captureStatus: attempt.status, evaluation: 'indeterminate', reason: 'capture_future', distanceMeters: null };
  }
  if (ageMs > policy.maxAgeSeconds * 1_000) {
    return { captureStatus: attempt.status, evaluation: 'indeterminate', reason: 'capture_stale', distanceMeters: null };
  }
  const distance = repPLocationDistanceMeters(policy.center, {
    latitude: attempt.latitude,
    longitude: attempt.longitude,
  });
  const distanceMeters = Math.round(distance * 10) / 10;
  if (attempt.accuracyMeters > policy.maxAccuracyMeters) {
    return { captureStatus: attempt.status, evaluation: 'indeterminate', reason: 'accuracy_exceeded', distanceMeters };
  }
  if (distance + attempt.accuracyMeters <= policy.radiusMeters) {
    return { captureStatus: attempt.status, evaluation: 'inside', reason: 'inside', distanceMeters };
  }
  if (Math.max(0, distance - attempt.accuracyMeters) > policy.radiusMeters) {
    return { captureStatus: attempt.status, evaluation: 'outside', reason: 'outside', distanceMeters };
  }
  return { captureStatus: attempt.status, evaluation: 'indeterminate', reason: 'accuracy_overlap', distanceMeters };
}

/** Digest cobre tentativa, política e resultado sem copiar coordenadas para a ARP ou para auditorias genéricas. */
export function repPLocationEvidenceDigest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function repPLocationSummary(result: RepPLocationResult) {
  return { captureStatus: result.captureStatus, evaluation: result.evaluation };
}
