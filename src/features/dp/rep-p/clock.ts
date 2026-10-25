import { AppError } from '@/lib/observability/app-error';

export const REP_P_MAX_HLB_OFFSET_MS = 30_000;
export const REP_P_CLOCK_ATTESTATION_MAX_AGE_MS = 5 * 60_000;

export type RepPClockObservation = Readonly<{
  server: string;
  status: 'accepted' | 'discarded' | 'failed';
  offsetMs?: number;
  roundTripMs?: number;
  stratum?: number;
}>;

export type RepPClockReading = Readonly<{
  instant: Date;
  source: string;
  assurance: 'hlb_verified' | 'unverified';
  observedOffsetMs: number;
  verifiedAt: Date;
  attestationId: string;
  attestationMode: 'fresh' | 'cached' | 'fallback';
  quorum: number;
  observations: readonly RepPClockObservation[];
}>;

export interface RepPClock {
  read(options?: Readonly<{ requireFresh?: boolean }>): Promise<RepPClockReading>;
}

export function assertTrustedRepPClockReading(reading: RepPClockReading, evaluatedAt = new Date()): void {
  const validDates = reading?.instant instanceof Date && Number.isFinite(reading.instant.getTime())
    && reading.verifiedAt instanceof Date && Number.isFinite(reading.verifiedAt.getTime());
  const age = validDates ? evaluatedAt.getTime() - reading.verifiedAt.getTime() : Number.POSITIVE_INFINITY;
  const accepted = Array.isArray(reading?.observations)
    ? reading.observations.filter((observation) => observation.status === 'accepted') : [];
  const validEvidence = /^[a-f0-9]{64}$/.test(reading?.attestationId ?? '')
    && ['fresh', 'cached', 'fallback'].includes(reading?.attestationMode)
    && Number.isSafeInteger(reading?.quorum) && reading.quorum >= 2 && accepted.length === reading.quorum
    && new Set(accepted.map((observation) => observation.server)).size === reading.quorum
    && accepted.every((observation) => observation.server.trim()
      && Number.isFinite(observation.offsetMs) && Number.isFinite(observation.roundTripMs)
      && Number.isSafeInteger(observation.stratum) && observation.stratum! >= 1 && observation.stratum! <= 15);
  if (!validDates || !reading.source.trim() || reading.assurance !== 'hlb_verified'
    || !Number.isFinite(reading.observedOffsetMs)
    || Math.abs(reading.observedOffsetMs) > REP_P_MAX_HLB_OFFSET_MS
    || age < -5_000 || age > REP_P_CLOCK_ATTESTATION_MAX_AGE_MS || !validEvidence) {
    throw new AppError({
      code: 'REP_P_TIME_UNAVAILABLE', kind: 'TRANSIENT_EXTERNAL', retryable: true,
      safeMessage: 'A marcação está temporariamente indisponível porque a hora oficial não pôde ser confirmada.',
    });
  }
}

/** Instante oficial já atestado; recusa como a batida quando a Hora Legal não está confiável. */
export async function trustedRepPClockInstant(clock: RepPClock): Promise<Date> {
  const reading = await clock.read();
  assertTrustedRepPClockReading(reading);
  return reading.instant;
}

export const unconfiguredRepPClock: RepPClock = Object.freeze({
  async read(): Promise<RepPClockReading> {
    throw new AppError({
      code: 'REP_P_TIME_PROVIDER_UNCONFIGURED', kind: 'TRANSIENT_EXTERNAL', retryable: false,
      safeMessage: 'A marcação permanece bloqueada até a fonte de Hora Legal Brasileira ser configurada.',
    });
  },
});

export function formatRepPAfdTimestamp(instant: Date, timeZone: string): string {
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime()) || !timeZone.trim()) {
    throw new TypeError('Instante ou fuso inválido para o REP-P.');
  }
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23', timeZoneName: 'longOffset',
  });
  const parts = Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, part.value]));
  const offset = parts.timeZoneName?.match(/^GMT([+-])(\d{2}):(\d{2})$/);
  if (!parts.year || !parts.month || !parts.day || !parts.hour || !parts.minute || !offset) {
    throw new TypeError('Fuso sem deslocamento compatível com o leiaute AFD.');
  }
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00${offset[1]}${offset[2]}${offset[3]}`;
}

export function civilDateFromRepPTimestamp(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00[+-]\d{4}$/.test(value)) {
    throw new TypeError('Data e hora incompatíveis com o leiaute AFD.');
  }
  return value.slice(0, 10);
}
