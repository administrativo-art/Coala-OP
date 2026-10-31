import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { FieldPath, type DocumentSnapshot, type Firestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { WORKSPACE_ID } from '@/lib/workspace';
import { hasPublishedScheduleVersion } from '@/lib/dp-schedule-publication';
import { absenceCivilDateSchema } from '../requests/schemas';
import { ABSENCE_OPERATIONAL_COVERAGE_HASH, operationalGuardRequested,
  operationalReadinessRef, shiftOccupancySlices } from './occupancy-guard.server';

const PAGE = 100;
const MAX_PER_SOURCE = 2000;
// Teto absoluto por fonte. Produção passa um maxPerSource explícito, medido antes da execução.
const MAX_PER_SOURCE_LIMIT = 20000;
const SOURCES = [
  ['coala', 'dp_schedules'], ['coala', 'shifts'], ['coala', 'dp_vacations'],
  ['coala', 'dp_absenceOperationalAvailability'], ['coala', 'dp_absenceOperationalFences'],
  ['coala', 'dp_absenceOperationalMarkers'], ['coala', 'dp_absenceOccupancyClocks'],
  ['rh', 'dp_absenceRequests'], ['rh', 'dp_absenceOccurrences'],
  ['rh', 'dp_absenceOperationalIntents'], ['rh', 'dp_absenceOutbox'],
] as const;
type Source = typeof SOURCES[number][1];
type Collected = { hash: string; counts: Record<Source, number>;
  documents: Record<Source, Map<string, QueryDocumentSnapshot>> };
const fail = (reason: string) => new Error(`Bootstrap operacional incompleto: ${reason}.`);
const validDate = (value: unknown) => absenceCivilDateSchema.safeParse(value).success;
const stringValue = (value: unknown) => typeof value === 'string' && value.length > 0 ? value : null;
const dataHash = (value: unknown): unknown => {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(dataHash);
  if (typeof value === 'object') {
    if ('toDate' in value && typeof value.toDate === 'function') return value.toDate().toISOString();
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, dataHash(entry)]));
  }
  return value;
};
async function scan(db: Firestore, name: Source, cap: number) {
  const documents = new Map<string, QueryDocumentSnapshot>();
  let last: QueryDocumentSnapshot | null = null;
  while (true) {
    let query = (name === 'shifts' ? db.collectionGroup(name) : db.collection(name))
      .orderBy(FieldPath.documentId()).limit(PAGE + 1);
    if (last) query = query.startAfter(last);
    const page = await query.get();
    if (page.size > PAGE && documents.size + PAGE >= cap) throw fail(`limite ${name}`);
    const selected = page.docs.slice(0, PAGE);
    for (const document of selected) documents.set(document.ref.path, document);
    if (documents.size > cap) throw fail(`limite ${name}`);
    if (page.size <= PAGE) break;
    last = selected.at(-1)!;
  }
  return documents;
}
async function collect(cap: number, scope: { workspaceId: string; epoch: string;
  coverageFrom: string; coverageThrough: string }): Promise<Collected> {
  const documents = {} as Collected['documents'];
  const counts = {} as Collected['counts'];
  const hash = createHash('sha256');
  hash.update(JSON.stringify({ contract: 'absence-operational-bootstrap-v1', ...scope })).update('\n');
  for (const [database, name] of SOURCES) {
    const docs = await scan(database === 'coala' ? dbAdmin : hrDbAdmin, name, cap);
    documents[name] = docs;
    counts[name] = docs.size;
    for (const [path, document] of docs) hash.update(JSON.stringify({ database, path,
      updateTime: document.updateTime?.toMillis() ?? null, data: dataHash(document.data()) })).update('\n');
  }
  return { hash: hash.digest('hex'), counts, documents };
}
function byId(docs: Map<string, QueryDocumentSnapshot>) {
  return new Map([...docs.values()].map((doc) => [doc.id, doc]));
}
function expectSource(doc: DocumentSnapshot | undefined, label: string) {
  if (!doc?.exists) throw fail(label);
  return doc;
}
/**
 * Escala legada do formato antigo (uma por mês para todas as unidades, unidade só no turno):
 * o estado ausente é publicado e seus turnos precisam ser anteriores à janela de cobertura.
 */
function legacyHistoricalSchedule(schedule: QueryDocumentSnapshot) {
  return !stringValue(schedule.get('unitId')) && hasPublishedScheduleVersion(schedule.data());
}

function validate(pass: Collected, workspaceId: string, epoch: string, coverageFrom: string) {
  const all = pass.documents;
  const requests = byId(all.dp_absenceRequests);
  const occurrences = byId(all.dp_absenceOccurrences);
  const projections = byId(all.dp_absenceOperationalAvailability);
  const fences = byId(all.dp_absenceOperationalFences);
  const intents = byId(all.dp_absenceOperationalIntents);
  const markers = byId(all.dp_absenceOperationalMarkers);
  const clocks = byId(all.dp_absenceOccupancyClocks);
  const outbox = byId(all.dp_absenceOutbox);
  for (const schedule of all.dp_schedules.values()) {
    if (schedule.get('activeRevisionId')) throw fail('revisão oficial exige bootstrap de ocupação por overlay');
    if (schedule.get('workspaceId') && schedule.get('workspaceId') !== workspaceId) throw fail('workspace da escala');
    if (!stringValue(schedule.get('unitId')) && !legacyHistoricalSchedule(schedule)) throw fail('unidade da escala');
  }
  for (const shift of all.shifts.values()) {
    const schedule = all.dp_schedules.get(shift.ref.parent.parent?.path ?? '');
    if (schedule && legacyHistoricalSchedule(schedule)) {
      if (!stringValue(shift.get('userId')) || !validDate(shift.get('date'))) throw fail('turno legado inválido');
      if (shift.get('date') >= coverageFrom) throw fail('escala legada com turno na janela de cobertura');
      continue;
    }
    if (!schedule || !stringValue(shift.get('userId')) || !stringValue(shift.get('unitId'))
      || shift.get('unitId') !== schedule.get('unitId') || !validDate(shift.get('date'))) throw fail('turno órfão ou inválido');
    if (shift.get('type') === 'work') shiftOccupancySlices({ beneficiaryUid: shift.get('userId'),
      date: shift.get('date'), startTime: shift.get('startTime'), endTime: shift.get('endTime'), addsOccupancy: true });
    else if (shift.get('type') !== 'day_off') throw fail('tipo do turno');
  }
  for (const vacation of all.dp_vacations.values()) {
    if (vacation.get('status') !== 'APPROVED' || vacation.get('recordType') !== 'gozo') continue;
    if (!stringValue(vacation.get('userId')) || !validDate(vacation.get('startDate'))
      || !validDate(vacation.get('endDate')) || vacation.get('startDate') > vacation.get('endDate')) throw fail('férias aprovadas');
  }
  for (const request of requests.values()) {
    if (request.get('workspaceId') !== workspaceId) throw fail('workspace do pedido');
    if (request.get('operationalPending')) throw fail('pedido em preparo');
    const status = request.get('status');
    const operationalFence = request.get('operationalFence');
    if (status !== 'approved' && !(status === 'cancelled' && operationalFence)) continue;
    const projection = expectSource(projections.get(request.id), 'projeção ausente');
    const fence = expectSource(fences.get(request.id), 'fence ausente');
    const occurrence = expectSource(occurrences.get(request.id), 'ocorrência ausente');
    if (projection.get('workspaceId') !== workspaceId || projection.get('beneficiaryUid') !== request.get('beneficiaryUid')
      || projection.get('unitId') !== request.get('unitId') || projection.get('epoch') !== epoch
      || projection.get('fenceId') !== operationalFence?.fenceId
      || fence.get('fenceId') !== operationalFence?.fenceId || fence.get('epoch') !== epoch
      || occurrence.get('requestId') !== request.id || occurrence.get('workspaceId') !== workspaceId
      || occurrence.get('beneficiaryUid') !== request.get('beneficiaryUid')
      || occurrence.get('unitId') !== request.get('unitId')
      || occurrence.get('requestVersion') !== operationalFence?.requestVersion) throw fail('fonte divergente');
    const active = status === 'approved';
    if (operationalFence?.state !== (active ? 'active' : 'reversed')
      || projection.get('state') !== (active ? 'active' : 'tombstone')
      || fence.get('state') !== (active ? 'active' : 'tombstone')
      || occurrence.get('projectionStatus') !== (active ? 'active' : 'reversed')
      || active && projection.get('requestVersion') !== request.get('version')) throw fail('ack ausente');
    const outboxId = `${request.id}_${request.get('version')}_operational_${active ? 'activation' : 'reversal'}_pending`;
    if (outbox.get(outboxId)?.get('status') !== 'done') throw fail('outbox operacional pendente');
  }
  for (const occurrence of occurrences.values()) {
    const request = requests.get(occurrence.id);
    if (!request || !['approved', 'cancelled'].includes(String(request.get('status')))) throw fail('ocorrência órfã');
    if (request.get('status') === 'cancelled' && !request.get('operationalFence')) {
      throw fail('reversão operacional ausente');
    }
  }
  for (const projection of projections.values()) {
    const request = requests.get(projection.id);
    const fence = fences.get(projection.id);
    if (!request || !fence || projection.get('workspaceId') !== workspaceId || projection.get('epoch') !== epoch
      || projection.get('requestId') !== projection.id || projection.get('fenceId') !== fence.get('fenceId')
      || projection.get('state') !== fence.get('state')) throw fail('projeção órfã');
    if (projection.get('state') === 'prepared') throw fail('projeção preparada');
    const intervals = projection.get('intervals');
    if (!Array.isArray(intervals) || intervals.length < 1 || intervals.length > 180) throw fail('intervalos da projeção');
    for (const interval of intervals) {
      if (!validDate(interval.date) || !Number.isInteger(interval.fromMinute) || !Number.isInteger(interval.toMinute)
        || interval.fromMinute < 0 || interval.toMinute > 1440 || interval.fromMinute >= interval.toMinute) throw fail('intervalo inválido');
      const markerId = createHash('sha256').update(`${workspaceId}:${projection.get('beneficiaryUid')}:${interval.date}`).digest('hex');
      const marker = markers.get(markerId);
      if (projection.get('state') === 'active') {
        const clock = clocks.get(markerId);
        const entries = marker?.get('entries');
        if (!clock || clock.get('epoch') !== epoch || !marker || marker.get('epoch') !== epoch
          || !Array.isArray(entries) || !entries.some((entry) => entry.requestId === projection.id
            && entry.fenceId === projection.get('fenceId') && entry.requestVersion === projection.get('requestVersion')
            && entry.state === 'active' && entry.fromMinute === interval.fromMinute
            && entry.toMinute === interval.toMinute)) throw fail('marcador ativo ausente');
      }
    }
  }
  for (const fence of fences.values()) {
    if (!requests.has(fence.id) || !projections.has(fence.id)
      || fence.get('workspaceId') !== workspaceId || fence.get('epoch') !== epoch
      || !['active', 'tombstone'].includes(String(fence.get('state')))) throw fail('fence órfão');
  }
  for (const clock of clocks.values()) {
    const expectedId = createHash('sha256').update(`${workspaceId}:${clock.get('beneficiaryUid')}:${clock.get('date')}`).digest('hex');
    if (clock.id !== expectedId || clock.get('workspaceId') !== workspaceId || clock.get('epoch') !== epoch
      || !validDate(clock.get('date')) || !Number.isSafeInteger(clock.get('version'))
      || clock.get('version') < 1) throw fail('relógio inválido');
  }
  for (const marker of markers.values()) {
    const expectedId = createHash('sha256').update(`${workspaceId}:${marker.get('beneficiaryUid')}:${marker.get('date')}`).digest('hex');
    if (marker.id !== expectedId || marker.get('workspaceId') !== workspaceId || marker.get('epoch') !== epoch
      || !validDate(marker.get('date')) || !clocks.has(marker.id)) throw fail('marcador de outra época');
    const entries = marker.get('entries');
    if (!Array.isArray(entries) || entries.length > 20) throw fail('marcador inválido');
    for (const entry of entries) {
      const projection = projections.get(entry.requestId);
      if (entry.state !== 'active' || !projection || projection.get('state') !== 'active'
        || projection.get('fenceId') !== entry.fenceId || projection.get('requestVersion') !== entry.requestVersion
        || projection.get('beneficiaryUid') !== marker.get('beneficiaryUid')
        || !Array.isArray(projection.get('intervals'))
        || !projection.get('intervals').some((interval: { date: string; fromMinute: number; toMinute: number }) =>
          interval.date === marker.get('date') && interval.fromMinute === entry.fromMinute
          && interval.toMinute === entry.toMinute)) {
        throw fail('marcador sem ack');
      }
    }
  }
  for (const intent of intents.values()) {
    if (intent.get('workspaceId') !== workspaceId
      || !['active', 'reversed', 'aborted'].includes(String(intent.get('status')))) throw fail('intenção operacional pendente');
  }
}

/**
 * One-shot audit (demo emulators or production, as accepted by operationalGuardRequested). Two equal scans are
 * evidence under an operator quiescence barrier, not a distributed snapshot.
 */
export async function bootstrapAbsenceOperationalReadiness(input: {
  workspaceId: string; coverageFrom: string; coverageThrough: string; quiescenceConfirmed: true;
  betweenPasses?: () => Promise<void>;
  maxPerSource?: number;
}) {
  if (!operationalGuardRequested() || input.workspaceId !== WORKSPACE_ID || !input.quiescenceConfirmed
    || !validDate(input.coverageFrom) || !validDate(input.coverageThrough)
    || input.coverageFrom > input.coverageThrough
    || input.maxPerSource !== undefined && (!Number.isInteger(input.maxPerSource)
      || input.maxPerSource < 1 || input.maxPerSource > MAX_PER_SOURCE_LIMIT)) throw fail('escopo/gate inválido');
  const readiness = operationalReadinessRef(input.workspaceId);
  const runId = randomUUID();
  const started = await dbAdmin.runTransaction(async (tx) => {
    const before = await tx.get(readiness);
    if (before.exists && !['bootstrapping', 'ready'].includes(String(before.get('state')))) throw fail('recibo incompatível');
    const epoch = before.exists ? before.get('epoch') : randomUUID();
    if (typeof epoch !== 'string') throw fail('época inválida');
    tx.set(readiness, { workspaceId: input.workspaceId, state: 'bootstrapping', epoch,
      runId, bootstrapComplete: false, coverageHash: ABSENCE_OPERATIONAL_COVERAGE_HASH,
      scopeKind: 'workspace_all', coverageFrom: input.coverageFrom, coverageThrough: input.coverageThrough,
      quiescenceConfirmed: true, startedAt: new Date().toISOString() });
    return { epoch };
  });
  const scope = { workspaceId: input.workspaceId, epoch: started.epoch,
    coverageFrom: input.coverageFrom, coverageThrough: input.coverageThrough };
  const first = await collect(input.maxPerSource ?? MAX_PER_SOURCE, scope);
  validate(first, input.workspaceId, started.epoch, input.coverageFrom);
  await input.betweenPasses?.();
  const second = await collect(input.maxPerSource ?? MAX_PER_SOURCE, scope);
  validate(second, input.workspaceId, started.epoch, input.coverageFrom);
  if (first.hash !== second.hash || JSON.stringify(first.counts) !== JSON.stringify(second.counts)) throw fail('fontes mudaram entre passagens');
  await dbAdmin.runTransaction(async (tx) => {
    const current = await tx.get(readiness);
    if (!current.exists || current.get('state') !== 'bootstrapping' || current.get('runId') !== runId
      || current.get('epoch') !== started.epoch || current.get('coverageHash') !== ABSENCE_OPERATIONAL_COVERAGE_HASH
      || current.get('scopeKind') !== 'workspace_all' || current.get('bootstrapComplete') !== false
      || current.get('coverageFrom') !== input.coverageFrom
      || current.get('coverageThrough') !== input.coverageThrough) {
      throw fail('recibo alterado');
    }
    tx.update(readiness, { state: 'ready', bootstrapComplete: true,
      scopeHash: second.hash, sourceCounts: second.counts, completedAt: new Date().toISOString() });
  });
  return { mode: process.env.FIRESTORE_EMULATOR_HOST ? 'demo_bootstrap' as const : 'production_bootstrap' as const,
    state: 'ready' as const, epoch: started.epoch,
    hash: second.hash, counts: second.counts };
}

/**
 * Pré-voo somente leitura: uma passada de coleta + validação, sem gravar o recibo nem exigir quiescência.
 * Serve para achar dados que fariam o bootstrap falhar antes da janela de congelamento.
 */
export async function auditAbsenceOperationalSources(input: {
  workspaceId: string; coverageFrom: string; coverageThrough: string; maxPerSource?: number;
}) {
  if (!operationalGuardRequested() || input.workspaceId !== WORKSPACE_ID
    || !validDate(input.coverageFrom) || !validDate(input.coverageThrough)
    || input.coverageFrom > input.coverageThrough
    || input.maxPerSource !== undefined && (!Number.isInteger(input.maxPerSource)
      || input.maxPerSource < 1 || input.maxPerSource > MAX_PER_SOURCE_LIMIT)) throw fail('escopo/gate inválido');
  const readiness = await operationalReadinessRef(input.workspaceId).get();
  const epoch = typeof readiness.get('epoch') === 'string' ? readiness.get('epoch') as string : 'pre-bootstrap';
  const pass = await collect(input.maxPerSource ?? MAX_PER_SOURCE, { workspaceId: input.workspaceId, epoch,
    coverageFrom: input.coverageFrom, coverageThrough: input.coverageThrough });
  try {
    validate(pass, input.workspaceId, epoch, input.coverageFrom);
    return { mode: 'dry_run' as const, valid: true as const, readinessState: readiness.get('state') ?? null, counts: pass.counts };
  } catch (error) {
    return { mode: 'dry_run' as const, valid: false as const, readinessState: readiness.get('state') ?? null,
      reason: error instanceof Error ? error.message : 'falha desconhecida', counts: pass.counts };
  }
}

export const ABSENCE_BOOTSTRAP_LIMITS = { pageSize: PAGE, maxPerSource: MAX_PER_SOURCE, maxPerSourceLimit: MAX_PER_SOURCE_LIMIT,
  sourceCount: SOURCES.length, passes: 2 } as const;
