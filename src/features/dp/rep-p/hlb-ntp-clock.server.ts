import { createHash } from 'node:crypto';
import { createSocket } from 'node:dgram';

import { AppError } from '@/lib/observability/app-error';

import { REP_P_CLOCK_ATTESTATION_MAX_AGE_MS, type RepPClock, type RepPClockObservation,
  type RepPClockReading } from './clock';

const NTP_PORT = 123;
const NTP_PACKET_BYTES = 48;
const NTP_UNIX_EPOCH_SECONDS = 2_208_988_800;
const NTP_ERA_SECONDS = 4_294_967_296;
const DEFAULT_TIMEOUT_MS = 1_500;
const MAX_ROUND_TRIP_MS = 1_500;
const MAX_SERVER_DIVERGENCE_MS = 1_000;
const CACHE_REFRESH_MS = 60_000;
const REQUIRED_QUORUM = 2;

/** Servidores publicados pelo Observatório Nacional para sincronização direta com a HLB. */
export const OBSERVATORIO_NACIONAL_NTP_SERVERS = Object.freeze([
  '200.20.186.75',
  '200.20.186.94',
  '200.20.224.100',
  '200.20.224.101',
] as const);

type NtpSample = Readonly<{
  server: string;
  offsetMs: number;
  roundTripMs: number;
  stratum: number;
  verifiedAtMs: number;
}>;

type ClockAttestation = Readonly<{
  id: string;
  offsetMs: number;
  verifiedAtMs: number;
  source: string;
  quorum: number;
  observations: readonly RepPClockObservation[];
}>;

type NtpQuery = (server: string, timeoutMs: number) => Promise<NtpSample>;

function unavailable(cause?: unknown): AppError {
  return new AppError({
    code: 'REP_P_TIME_UNAVAILABLE', kind: 'TRANSIENT_EXTERNAL', retryable: true, cause,
    safeMessage: 'A marcação está temporariamente indisponível porque a hora oficial não pôde ser confirmada.',
  });
}

function writeNtpTimestamp(packet: Buffer, offset: number, unixMs: number): void {
  const ntpSeconds = unixMs / 1_000 + NTP_UNIX_EPOCH_SECONDS;
  const seconds = Math.floor(ntpSeconds) >>> 0;
  const fraction = Math.floor((ntpSeconds - Math.floor(ntpSeconds)) * 0x1_0000_0000) >>> 0;
  packet.writeUInt32BE(seconds, offset);
  packet.writeUInt32BE(fraction, offset + 4);
}

function readNtpTimestamp(packet: Buffer, offset: number, referenceUnixMs: number): number {
  const seconds = packet.readUInt32BE(offset);
  const fraction = packet.readUInt32BE(offset + 4) / 0x1_0000_0000;
  if (seconds === 0 && fraction === 0) throw new Error('NTP_TIMESTAMP_MISSING');
  const referenceNtpSeconds = referenceUnixMs / 1_000 + NTP_UNIX_EPOCH_SECONDS;
  const era = Math.round((referenceNtpSeconds - seconds) / NTP_ERA_SECONDS);
  return (seconds + era * NTP_ERA_SECONDS + fraction - NTP_UNIX_EPOCH_SECONDS) * 1_000;
}

function buildRequest(sentAtMs: number): Buffer {
  const request = Buffer.alloc(NTP_PACKET_BYTES);
  request[0] = 0x23; // leap=0, version=4, mode=3 (client)
  writeNtpTimestamp(request, 40, sentAtMs);
  return request;
}

function parseResponse(params: {
  response: Buffer;
  request: Buffer;
  server: string;
  sentAtMs: number;
  receivedAtMs: number;
}): NtpSample {
  const { response, request, server, sentAtMs, receivedAtMs } = params;
  if (response.length < NTP_PACKET_BYTES) throw new Error('NTP_PACKET_TOO_SHORT');
  const leap = response[0] >>> 6;
  const version = (response[0] >>> 3) & 0x07;
  const mode = response[0] & 0x07;
  const stratum = response[1];
  if (leap === 3 || (version !== 3 && version !== 4) || mode !== 4 || stratum < 1 || stratum > 15) {
    throw new Error('NTP_RESPONSE_UNTRUSTED');
  }
  if (!response.subarray(24, 32).equals(request.subarray(40, 48))) throw new Error('NTP_ORIGIN_MISMATCH');

  const receivedByServerMs = readNtpTimestamp(response, 32, sentAtMs);
  const transmittedByServerMs = readNtpTimestamp(response, 40, receivedAtMs);
  const roundTripMs = (receivedAtMs - sentAtMs) - (transmittedByServerMs - receivedByServerMs);
  const offsetMs = ((receivedByServerMs - sentAtMs) + (transmittedByServerMs - receivedAtMs)) / 2;
  if (!Number.isFinite(roundTripMs) || !Number.isFinite(offsetMs)
    || roundTripMs < -2 || roundTripMs > MAX_ROUND_TRIP_MS) throw new Error('NTP_DELAY_UNTRUSTED');
  return { server, offsetMs, roundTripMs: Math.max(0, roundTripMs), stratum, verifiedAtMs: receivedAtMs };
}

async function queryServer(server: string, timeoutMs: number): Promise<NtpSample> {
  return new Promise((resolve, reject) => {
    const socket = createSocket('udp4');
    const sentAtMs = Date.now();
    const request = buildRequest(sentAtMs);
    let settled = false;
    const finish = (error?: unknown, sample?: NtpSample) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch { /* O socket pode falhar antes do bind implícito. */ }
      if (error) reject(error);
      else resolve(sample!);
    };
    const timer = setTimeout(() => finish(new Error('NTP_TIMEOUT')), timeoutMs);
    socket.once('error', finish);
    socket.once('message', (response, remote) => {
      try {
        if (remote.address !== server || remote.port !== NTP_PORT) throw new Error('NTP_REMOTE_MISMATCH');
        finish(undefined, parseResponse({ response, request, server, sentAtMs, receivedAtMs: Date.now() }));
      } catch (cause) {
        finish(cause);
      }
    });
    socket.send(request, NTP_PORT, server, (error) => { if (error) finish(error); });
  });
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function selectAttestation(samples: readonly NtpSample[]): ClockAttestation {
  const bestByServer = new Map<string, NtpSample>();
  for (const sample of samples) {
    if (!sample.server.trim() || !Number.isFinite(sample.offsetMs) || !Number.isFinite(sample.roundTripMs)
      || !Number.isFinite(sample.verifiedAtMs) || sample.roundTripMs > MAX_ROUND_TRIP_MS
      || sample.stratum < 1 || sample.stratum > 15) continue;
    const prior = bestByServer.get(sample.server);
    if (!prior || sample.roundTripMs < prior.roundTripMs) bestByServer.set(sample.server, sample);
  }
  const usable = [...bestByServer.values()]
    .sort((left, right) => left.offsetMs - right.offsetMs);
  const clusters = usable.map((first, start) => usable.slice(start)
    .filter((sample) => sample.offsetMs - first.offsetMs <= MAX_SERVER_DIVERGENCE_MS));
  const maxClusterSize = Math.max(0, ...clusters.map((candidate) => candidate.length));
  const maximalClusters = clusters.filter((candidate) => candidate.length === maxClusterSize);
  if (maximalClusters.length !== 1) throw unavailable(new Error('NTP_AMBIGUOUS_QUORUM'));
  const cluster = maximalClusters[0] ?? [];
  if (cluster.length < REQUIRED_QUORUM) throw unavailable();
  const offsetMs = median(cluster.map((sample) => sample.offsetMs));
  const verifiedAtMs = Math.max(...cluster.map((sample) => sample.verifiedAtMs));
  const servers = cluster.map((sample) => sample.server).sort();
  const acceptedServers = new Set(servers);
  const observations: readonly RepPClockObservation[] = usable.map((sample): RepPClockObservation => ({
    server: sample.server, status: acceptedServers.has(sample.server) ? 'accepted' : 'discarded',
    offsetMs: sample.offsetMs, roundTripMs: sample.roundTripMs, stratum: sample.stratum,
  })).sort((left, right) => left.server.localeCompare(right.server));
  const source = `Observatorio Nacional NTP (${servers.join(',')}; quorum=${cluster.length})`;
  const canonical = JSON.stringify({ offsetMs, verifiedAtMs, source, quorum: cluster.length, observations });
  return { id: createHash('sha256').update(canonical).digest('hex'), offsetMs, verifiedAtMs, source,
    quorum: cluster.length, observations };
}

function readingFrom(attestation: ClockAttestation, nowMs: number,
  attestationMode: RepPClockReading['attestationMode']): RepPClockReading {
  return {
    instant: new Date(nowMs + attestation.offsetMs),
    source: attestation.source,
    assurance: 'hlb_verified',
    observedOffsetMs: attestation.offsetMs,
    verifiedAt: new Date(attestation.verifiedAtMs),
    attestationId: attestation.id,
    attestationMode,
    quorum: attestation.quorum,
    observations: attestation.observations,
  };
}

export function createObservatorioNacionalNtpClock(options: {
  now?: () => number;
  query?: NtpQuery;
  timeoutMs?: number;
} = {}): RepPClock {
  const now = options.now ?? Date.now;
  const query = options.query ?? queryServer;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let cached: ClockAttestation | null = null;
  let pending: Promise<ClockAttestation> | null = null;

  async function refresh(): Promise<ClockAttestation> {
    const settled = await Promise.allSettled(OBSERVATORIO_NACIONAL_NTP_SERVERS.map((server) => query(server, timeoutMs)));
    const samples = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    const attestation = selectAttestation(samples);
    const observedServers = new Set(samples.map((sample) => sample.server));
    const observations = [...attestation.observations,
      ...OBSERVATORIO_NACIONAL_NTP_SERVERS.filter((server) => !observedServers.has(server))
        .map((server) => ({ server, status: 'failed' as const }))]
      .sort((left, right) => left.server.localeCompare(right.server));
    const canonical = JSON.stringify({ offsetMs: attestation.offsetMs, verifiedAtMs: attestation.verifiedAtMs,
      source: attestation.source, quorum: attestation.quorum, observations });
    return { ...attestation, id: createHash('sha256').update(canonical).digest('hex'), observations };
  }

  return Object.freeze({
    async read(options?: Readonly<{ requireFresh?: boolean }>): Promise<RepPClockReading> {
      const startedAtMs = now();
      if (!options?.requireFresh && cached && startedAtMs - cached.verifiedAtMs <= CACHE_REFRESH_MS) {
        return readingFrom(cached, startedAtMs, 'cached');
      }
      try {
        pending ??= refresh().finally(() => { pending = null; });
        cached = await pending;
        return readingFrom(cached, now(), 'fresh');
      } catch (cause) {
        const fallbackAtMs = now();
        if (!options?.requireFresh && cached && fallbackAtMs - cached.verifiedAtMs <= REP_P_CLOCK_ATTESTATION_MAX_AGE_MS) {
          return readingFrom(cached, fallbackAtMs, 'fallback');
        }
        throw cause instanceof AppError ? cause : unavailable(cause);
      }
    },
  });
}

export const observatorioNacionalNtpClock = createObservatorioNacionalNtpClock();

export function configuredRepPClock(env?: Readonly<{ REP_P_HLB_NTP_ENABLED?: string }>): RepPClock | null {
  const enabled = env ? env.REP_P_HLB_NTP_ENABLED : process.env['REP_P_HLB_NTP_ENABLED'];
  return enabled === 'true' ? observatorioNacionalNtpClock : null;
}

export const repPNtpClockForTest = Object.freeze({ buildRequest, parseResponse, queryServer, selectAttestation });
