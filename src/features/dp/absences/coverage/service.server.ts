import 'server-only';

import { createHash } from 'node:crypto';
import { addDays, format, parseISO } from 'date-fns';
import { Timestamp, type DocumentSnapshot, type QueryDocumentSnapshot, type Transaction } from 'firebase-admin/firestore';

import type { ServerUserContext } from '@/lib/auth-server';
import { resolveDPShiftAssignment } from '@/lib/dp-external-coverage';
import { resolveDPJourney } from '@/lib/dp-journey-resolution';
import { buildDPShiftReference } from '@/lib/dp-shift-reference';
import { isShiftDefinitionCompatibleWithJourney } from '@/lib/dp-time-config-rules';
import { dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { AppError } from '@/lib/observability/app-error';
import { canAccessUnit } from '@/lib/unit-access';
import { usernameSearchVariants } from '@/lib/username-search';
import type { DPJourney, DPShiftDefinition } from '@/types';
import {
  validateDPJourneySchedule,
  type DPJourneyValidationPerson,
  type DPJourneyValidationShift,
  type DPJourneyValidationShiftDefinition,
} from '@/features/dp/journey-validation/core';
import { personAgendaClockRef, personAgendaVersion, readPersonAgendaVersion } from '@/features/dp/shifts/agenda-clock.server';
import { saveWorkShift } from '@/features/dp/shifts/service.server';
import { prepareActiveRevisionOperationalChanges, readActiveRevisionPersonMonth, readActiveRevisionShift } from '@/features/dp/schedules/operational-overlay.server';
import { CLOSURES, closureKey } from '@/features/dp/time-adjustments/service.server';

import { guardOccupancyWrite, operationalDayRefs, shiftOccupancySlices } from '../operational/occupancy-guard.server';
import {
  COVERAGE_HISTORY_DAYS,
  COVERAGE_MODE_LABELS,
  coverageJourneyIssues,
  evaluateCoverageAgenda,
  formatCoverageDate,
  summarizeCoverageEligibility,
  type CoverageAgendaShift,
  type CoverageEligibility,
  type CoverageIssue,
} from './core';
import type { AbsenceCoverageDecisionInput } from './schemas';
import type { AbsenceCoverageCandidate, AbsenceCoverageView } from './types';

const displacedCollection = dbAdmin.collection('dp_absenceDisplacedShifts');
const DISPLACED_LIMIT = 60;
const SAME_UNIT_QUERY_LIMIT = 60;
const EXTERNAL_QUERY_LIMIT = 15;
const CANDIDATE_LIMIT = 40;
const JOURNEY_LIMIT = 100;
const FIRESTORE_IN_LIMIT = 30;
const SHIFTS_PER_PERSON = 2 * COVERAGE_HISTORY_DAYS + 2;
const VACATIONS_PER_CHUNK = 300;
const AUDIT_TTL_MS = 365 * 86_400_000;

const fail = (code: string, safeMessage: string,
  kind: 'VALIDATION' | 'AUTHORIZATION' | 'CONFLICT' | 'NOT_FOUND' | 'DATA_INTEGRITY' | 'EXPECTED_BUSINESS' = 'CONFLICT') =>
  new AppError({ code, kind, safeMessage });

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function strings(value: unknown) {
  return Array.isArray(value) ? [...new Set(value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry)))] : [];
}

function chunks<T>(values: T[], size: number) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
}

function shiftDate(date: string, days: number) {
  return format(addDays(parseISO(date), days), 'yyyy-MM-dd');
}

function isScheduleShift(document: QueryDocumentSnapshot) {
  const segments = document.ref.path.split('/');
  return segments.length === 4 && segments[0] === 'dp_schedules' && segments[2] === 'shifts';
}

type DisplacedShift = {
  id: string;
  requestId: string;
  beneficiaryUid: string;
  unitId: string;
  scheduleId: string;
  date: string;
  startTime: string;
  endTime: string;
  shiftDefinitionId?: string;
  officialRevisionId?: string;
  coverage?: Record<string, unknown>;
};

function displacedFrom(document: DocumentSnapshot, workspaceId: string): DisplacedShift {
  const shift = document.get('shift') as Record<string, unknown> | undefined;
  const date = text(shift?.date);
  const startTime = text(shift?.startTime);
  const endTime = text(shift?.endTime);
  const unitId = text(document.get('unitId')) ?? text(shift?.unitId);
  if (!document.exists || document.get('workspaceId') !== workspaceId || !date || !startTime || !endTime || !unitId
    || !text(document.get('requestId')) || !text(document.get('scheduleId'))) {
    throw fail('DP_ABSENCE_COVERAGE_SHIFT_INVALID', 'O turno retirado desta ausência está inconsistente.', 'DATA_INTEGRITY');
  }
  return {
    id: document.id,
    requestId: String(document.get('requestId')),
    beneficiaryUid: String(document.get('beneficiaryUid') ?? ''),
    unitId,
    scheduleId: String(document.get('scheduleId')),
    date, startTime, endTime,
    ...(text(shift?.shiftDefinitionId) ? { shiftDefinitionId: text(shift?.shiftDefinitionId) } : {}),
    ...(text(document.get('officialRevisionId')) ? { officialRevisionId: text(document.get('officialRevisionId')) } : {}),
    ...(document.get('coverage') ? { coverage: document.get('coverage') as Record<string, unknown> } : {}),
  };
}

function canReadCoverage(actor: ServerUserContext, unitId: string) {
  if (actor.isDefaultAdmin) return true;
  const allowed = actor.permissions.dp.schedules.view === true || actor.permissions.dp.requests.review === true;
  return allowed && canAccessUnit(actor.userDoc, unitId, { isDefaultAdmin: false });
}

function canDecideCoverage(actor: ServerUserContext, unitId: string) {
  return actor.isDefaultAdmin
    || actor.permissions.dp.schedules.edit === true && canAccessUnit(actor.userDoc, unitId, { isDefaultAdmin: false });
}

function canAssignExternal(actor: ServerUserContext) {
  return actor.isDefaultAdmin || actor.permissions.dp.schedules.assignExternal === true;
}

async function loadRequestShifts(actor: ServerUserContext, requestId: string) {
  const snapshot = await displacedCollection.where('workspaceId', '==', actor.workspace_id)
    .where('requestId', '==', requestId).limit(DISPLACED_LIMIT + 1).get();
  if (snapshot.empty) return null;
  if (snapshot.size > DISPLACED_LIMIT) throw fail('DP_ABSENCE_COVERAGE_LIMIT', 'A ausência retirou turnos demais para decidir aqui.', 'DATA_INTEGRITY');
  const shifts = snapshot.docs.map((document) => displacedFrom(document, actor.workspace_id))
    .sort((left, right) => `${left.date}${left.startTime}`.localeCompare(`${right.date}${right.startTime}`));
  const unitId = shifts[0].unitId;
  if (!canReadCoverage(actor, unitId)) {
    throw fail('DP_ABSENCE_COVERAGE_FORBIDDEN', 'Sem acesso à cobertura desta unidade.', 'AUTHORIZATION');
  }
  return { shifts, unitId, beneficiaryUid: shifts[0].beneficiaryUid };
}

/** `null` quando a ausência não retirou turnos da escala (nada a cobrir). */
export async function getAbsenceCoverage(actor: ServerUserContext, requestId: string): Promise<AbsenceCoverageView | null> {
  const loaded = await loadRequestShifts(actor, requestId);
  if (!loaded) return null;
  const { shifts, unitId, beneficiaryUid } = loaded;
  const userIds = [...new Set([beneficiaryUid, ...shifts.flatMap((shift) => [
    text(shift.coverage?.substituteUid), text(shift.coverage?.decidedByUid)].filter((id): id is string => Boolean(id)))])];
  const definitionIds = [...new Set(shifts.flatMap((shift) => shift.shiftDefinitionId ? [shift.shiftDefinitionId] : []))];
  const [unit, users, definitions] = await Promise.all([
    dbAdmin.collection('dp_units').doc(unitId).get(),
    dbAdmin.getAll(...userIds.map((id) => dbAdmin.collection('users').doc(id))),
    definitionIds.length ? dbAdmin.getAll(...definitionIds.map((id) => dbAdmin.collection('dp_shiftDefinitions').doc(id))) : Promise.resolve([]),
  ]);
  const names = new Map(users.filter((user) => user.exists).map((user) => [user.id, String(user.get('username') ?? 'Colaborador')]));
  const definitionNames = new Map(definitions.filter((definition) => definition.exists)
    .map((definition) => [definition.id, text(definition.get('name')) ?? null]));
  return {
    requestId,
    beneficiaryUid,
    beneficiaryName: names.get(beneficiaryUid) ?? 'Colaborador',
    unitId,
    unitName: text(unit.get('name')) ?? 'Unidade',
    canDecide: canDecideCoverage(actor, unitId),
    canAssignExternal: canAssignExternal(actor),
    shifts: shifts.map((shift) => {
      const coverage = shift.coverage;
      const substituteUid = text(coverage?.substituteUid);
      const decidedByUid = text(coverage?.decidedByUid);
      return {
        id: shift.id,
        date: shift.date,
        startTime: shift.startTime,
        endTime: shift.endTime,
        shiftName: shift.shiftDefinitionId ? definitionNames.get(shift.shiftDefinitionId) ?? null : null,
        decision: coverage ? {
          mode: coverage.mode as 'cover' | 'closed' | 'understaffed',
          ...(substituteUid ? { substituteUid, substituteName: names.get(substituteUid) ?? text(coverage.substituteName) ?? 'Colaborador' } : {}),
          ...(coverage.assignmentKind === 'external_coverage' ? { external: true } : {}),
          ...(text(coverage.exceptionReason) ? { exceptionReason: text(coverage.exceptionReason) } : {}),
          ...(decidedByUid ? { decidedByName: names.get(decidedByUid) ?? 'DP' } : {}),
          decidedAt: String(coverage.decidedAt ?? ''),
        } : null,
      };
    }),
  };
}

async function loadJourneys(tx?: Transaction) {
  const query = dbAdmin.collection('dp_journeys').where('status', 'in', ['published', 'archived']).limit(JOURNEY_LIMIT + 1);
  const snapshot = await (tx ? tx.get(query) : query.get());
  if (snapshot.size > JOURNEY_LIMIT) throw fail('DP_ABSENCE_COVERAGE_JOURNEY_LIMIT', 'Há jornadas demais para conferir a cobertura com segurança.', 'DATA_INTEGRITY');
  return snapshot.docs.map((document) => ({ id: document.id, ...document.data() } as DPJourney));
}

function definitionFrom(document: DocumentSnapshot): DPJourneyValidationShiftDefinition | null {
  const startTime = document.get('startTime');
  const endTime = document.get('endTime');
  if (!document.exists || typeof startTime !== 'string' || typeof endTime !== 'string') return null;
  const journeyIds = strings(document.get('journeyIds'));
  const breakType = document.get('breakType');
  return {
    ...(journeyIds.length ? { journeyIds } : {}),
    startTime, endTime,
    ...(document.get('overnight') === true ? { overnight: true } : {}),
    ...(['none', 'fixed', 'flexible', 'staggered'].includes(breakType) ? { breakType } : {}),
    ...(typeof document.get('breakStart') === 'string' ? { breakStart: document.get('breakStart') } : {}),
    ...(typeof document.get('breakEnd') === 'string' ? { breakEnd: document.get('breakEnd') } : {}),
    ...(typeof document.get('breakDurationMinutes') === 'number' ? { breakDurationMinutes: document.get('breakDurationMinutes') } : {}),
    ...(Array.isArray(document.get('breakSegments')) ? { breakSegments: document.get('breakSegments') } : {}),
  };
}

/**
 * Confere cada pessoa contra a própria jornada (resolvida pela data e pelo vínculo) e contra a agenda já gravada:
 * folga, choque de horário, descanso de 11h, dias seguidos, turno permitido, ausência e férias.
 */
async function evaluateCandidates(workspaceId: string, target: DisplacedShift, users: DocumentSnapshot[], tx?: Transaction) {
  const result = new Map<string, CoverageEligibility>();
  if (!users.length) return result;
  const from = shiftDate(target.date, -COVERAGE_HISTORY_DAYS);
  const to = shiftDate(target.date, COVERAGE_HISTORY_DAYS);
  const uids = users.map((user) => user.id);
  const primaryUnitIds = [...new Set(users.map((user) => text(user.get('unitId')) ?? target.unitId))];
  const readQuery = <T extends FirebaseFirestore.Query<FirebaseFirestore.DocumentData>>(query: T) => tx ? tx.get(query) : query.get();
  const readDocs = (refs: FirebaseFirestore.DocumentReference[]) => tx ? tx.getAll(...refs) : dbAdmin.getAll(...refs);
  const [journeys, units, shiftChunks, vacationChunks] = await Promise.all([
    loadJourneys(tx),
    readDocs(primaryUnitIds.map((id) => dbAdmin.collection('dp_units').doc(id))),
    Promise.all(chunks(uids, FIRESTORE_IN_LIMIT).map((chunk) => readQuery(dbAdmin.collectionGroup('shifts')
      .where('userId', 'in', chunk).where('date', '>=', from).where('date', '<=', to)
      .orderBy('date', 'asc').limit(chunk.length * SHIFTS_PER_PERSON + 1)))),
    Promise.all(chunks(uids, FIRESTORE_IN_LIMIT).map((chunk) => readQuery(dbAdmin.collection('dp_vacations')
      .where('userId', 'in', chunk).limit(VACATIONS_PER_CHUNK + 1)))),
  ]);
  shiftChunks.forEach((snapshot, index) => {
    if (snapshot.size > chunks(uids, FIRESTORE_IN_LIMIT)[index].length * SHIFTS_PER_PERSON) {
      throw fail('DP_ABSENCE_COVERAGE_HISTORY_LIMIT', 'Há turnos demais no período para conferir a cobertura com segurança.', 'DATA_INTEGRITY');
    }
  });
  if (vacationChunks.some((snapshot) => snapshot.size > VACATIONS_PER_CHUNK)) {
    throw fail('DP_ABSENCE_COVERAGE_VACATION_LIMIT', 'Há registros de férias demais para conferir a cobertura com segurança.', 'DATA_INTEGRITY');
  }
  const unitsById = new Map(units.filter((unit) => unit.exists).map((unit) => [unit.id, unit]));
  const groupIds = [...new Set(units.flatMap((unit) => text(unit.get('groupId')) ? [String(unit.get('groupId'))] : []))];
  const groups = groupIds.length ? await readDocs(groupIds.map((id) => dbAdmin.collection('dp_unitGroups').doc(id))) : [];
  const groupsById = new Map(groups.filter((group) => group.exists).map((group) => [group.id, group]));

  const legacyDocs = shiftChunks.flatMap((snapshot) => snapshot.docs.filter(isScheduleShift));
  const scheduleRefs = [...new Map(legacyDocs.map((doc) => [doc.ref.parent.parent!.path, doc.ref.parent.parent!] as const)).values()];
  const scheduleDocs = scheduleRefs.length ? await readDocs(scheduleRefs) : [];
  const pointerPaths = new Set(scheduleDocs.filter((doc) => doc.get('activeRevisionId')).map((doc) => doc.ref.path));
  type CandidateShift = { id: string; path: string; get: (field: string) => unknown };
  const shiftDocs: CandidateShift[] = legacyDocs.filter((doc) => !pointerPaths.has(doc.ref.parent.parent!.path))
    .map((doc) => ({ id: doc.id, path: doc.ref.path, get: (field) => doc.get(field) }));
  const months = [...new Set([from.slice(0, 7), target.date.slice(0, 7), to.slice(0, 7)])];
  const revisionReads = uids.flatMap((uid) => months.map((month) => ({ uid, month })));
  for (const batch of chunks(revisionReads, 10)) {
    const results = await Promise.all(batch.map(({ uid, month }) => tx
      ? readActiveRevisionPersonMonth(tx, uid, month)
      : dbAdmin.runTransaction((reader) => readActiveRevisionPersonMonth(reader, uid, month))));
    results.forEach((rows) => {
      rows.filter((row) => typeof row.date === 'string' && row.date >= from && row.date <= to).forEach((row) => {
        shiftDocs.push({ id: row.id, path: `dp_schedules/${row.scheduleId}/shifts/${row.id}`,
          get: (field) => row[field] });
      });
    });
  }
  const definitionIds = [...new Set([target.shiftDefinitionId, ...shiftDocs.map((doc) => text(doc.get('shiftDefinitionId')))]
    .filter((id): id is string => Boolean(id)))];
  const definitionDocs = definitionIds.length
    ? await readDocs(definitionIds.map((id) => dbAdmin.collection('dp_shiftDefinitions').doc(id)))
    : [];
  const shiftDefinitions = Object.fromEntries(definitionDocs.flatMap((doc) => {
    const definition = definitionFrom(doc);
    return definition ? [[doc.id, definition]] : [];
  }));

  const slices = shiftOccupancySlices({ beneficiaryUid: uids[0], date: target.date,
    startTime: target.startTime, endTime: target.endTime, addsOccupancy: true });
  const markerRefs = uids.flatMap((uid) => slices.map((slice) => ({ uid, slice,
    ref: operationalDayRefs(workspaceId, uid, slice.date).marker })));
  const markers = await readDocs(markerRefs.map((entry) => entry.ref));

  users.forEach((user) => {
    const uid = user.id;
    const own = shiftDocs.filter((doc) => doc.get('userId') === uid);
    const agenda: CoverageAgendaShift[] = own.flatMap((doc) => {
      const date = text(doc.get('date'));
      const type = doc.get('type') === 'day_off' ? 'day_off' : doc.get('type') === 'work' ? 'work' : null;
      const startTime = text(doc.get('startTime')) ?? '00:00';
      const endTime = text(doc.get('endTime')) ?? '23:59';
      return date && type ? [{ date, startTime, endTime, type }] : [];
    });
    const issues: CoverageIssue[] = evaluateCoverageAgenda(target, agenda);

    markerRefs.forEach((entry, index) => {
      if (entry.uid !== uid || !markers[index].exists) return;
      const entries = markers[index].get('entries');
      const blocked = Array.isArray(entries) && entries.some((item) => item && item.blocksSchedule === true
        && ['prepared', 'active'].includes(item.state)
        && item.fromMinute < entry.slice.toMinute && entry.slice.fromMinute < item.toMinute);
      if (blocked && !issues.some((issue) => issue.code === 'ABSENCE')) {
        issues.push({ code: 'ABSENCE', blocking: true, message: 'Tem ausência aprovada nesse horário' });
      }
    });
    const onVacation = vacationChunks.some((snapshot) => snapshot.docs.some((doc) => doc.get('userId') === uid
      && doc.get('status') === 'APPROVED' && doc.get('recordType') === 'gozo'
      && typeof doc.get('startDate') === 'string' && typeof doc.get('endDate') === 'string'
      && doc.get('startDate') <= target.date && doc.get('endDate') >= target.date));
    if (onVacation) issues.push({ code: 'VACATION', blocking: true, message: 'Está de férias nesse dia' });

    const primaryUnitId = text(user.get('unitId')) ?? target.unitId;
    const unit = unitsById.get(primaryUnitId);
    const unitGroupId = text(unit?.get('groupId'));
    const unitOrganizationId = text(unit?.get('organizationId')) ?? text(unitGroupId ? groupsById.get(unitGroupId)?.get('organizationId') : undefined);
    const person: DPJourneyValidationPerson = {
      collaboratorId: uid,
      ...(text(user.get('jobRoleId')) ? { jobRoleId: text(user.get('jobRoleId')) } : {}),
      jobFunctionIds: strings(user.get('jobFunctionIds')),
      unitId: primaryUnitId,
      ...(unitGroupId ? { unitGroupId } : {}),
      ...(unitOrganizationId ? { unitOrganizationId } : {}),
    };
    const base: DPJourneyValidationShift[] = own.flatMap((doc) => {
      const date = text(doc.get('date'));
      const type = doc.get('type');
      if (!date || (type !== 'work' && type !== 'day_off')) return [];
      return [{ id: doc.path, userId: uid, date, type, unitId: text(doc.get('unitId')) ?? target.unitId,
        ...(text(doc.get('shiftDefinitionId')) ? { shiftDefinitionId: text(doc.get('shiftDefinitionId')) } : {}) }];
    });
    const hypothetical: DPJourneyValidationShift = { id: 'coverage-candidate', userId: uid, date: target.date, type: 'work',
      unitId: target.unitId, ...(target.shiftDefinitionId ? { shiftDefinitionId: target.shiftDefinitionId } : {}) };
    const validate = (shifts: DPJourneyValidationShift[]) => validateDPJourneySchedule({
      journeys, people: { [uid]: person }, shifts, shiftDefinitions,
      periodStart: target.date, periodEnd: to, historyFrom: from,
    }).issues.filter((issue) => issue.userId === uid);
    issues.unshift(...coverageJourneyIssues(validate(base), validate([...base, hypothetical])));
    result.set(uid, summarizeCoverageEligibility(issues, agenda, target));
  });
  return result;
}

async function sameUnitUsers(unitId: string, externalId: string | undefined) {
  const users = dbAdmin.collection('users');
  const keys = [unitId, ...(externalId && externalId !== unitId ? [externalId] : [])];
  const snapshots = await Promise.all([
    users.where('unitId', '==', unitId).limit(SAME_UNIT_QUERY_LIMIT).get(),
    ...keys.map((key) => users.where('unitIds', 'array-contains', key).limit(SAME_UNIT_QUERY_LIMIT).get()),
    ...keys.map((key) => users.where('assignedKioskIds', 'array-contains', key).limit(SAME_UNIT_QUERY_LIMIT).get()),
  ]);
  return [...new Map(snapshots.flatMap((snapshot) => snapshot.docs).map((doc) => [doc.id, doc])).values()];
}

async function externalUsers(search: string) {
  const users = dbAdmin.collection('users');
  const snapshots = await Promise.all(usernameSearchVariants(search).map((variant) => users.orderBy('username')
    .startAt(variant).endAt(`${variant}`).limit(EXTERNAL_QUERY_LIMIT).get()));
  return [...new Map(snapshots.flatMap((snapshot) => snapshot.docs).map((doc) => [doc.id, doc])).values()];
}

function assignmentFor(user: DocumentSnapshot, unit: DocumentSnapshot, date: string) {
  try {
    return resolveDPShiftAssignment({ executionUnitId: unit.id, executionUnitExternalId: text(unit.get('externalId')),
      user: user.data() ?? {}, date });
  } catch {
    return null;
  }
}

async function loadTarget(actor: ServerUserContext, requestId: string, displacedId: string) {
  const document = await displacedCollection.doc(displacedId).get();
  if (!document.exists || document.get('workspaceId') !== actor.workspace_id || document.get('requestId') !== requestId) {
    throw fail('DP_ABSENCE_COVERAGE_SHIFT_NOT_FOUND', 'Turno retirado não encontrado.', 'NOT_FOUND');
  }
  const target = displacedFrom(document, actor.workspace_id);
  const unit = await dbAdmin.collection('dp_units').doc(target.unitId).get();
  if (!unit.exists || unit.get('isArchived') === true) {
    throw fail('DP_ABSENCE_COVERAGE_UNIT_UNAVAILABLE', 'A unidade do turno não está disponível.', 'EXPECTED_BUSINESS');
  }
  return { target, unit };
}

export async function listAbsenceCoverageCandidates(actor: ServerUserContext, requestId: string,
  input: { displacedId: string; search?: string }): Promise<{ candidates: AbsenceCoverageCandidate[] }> {
  const { target, unit } = await loadTarget(actor, requestId, input.displacedId);
  if (!canDecideCoverage(actor, target.unitId)) {
    throw fail('DP_ABSENCE_COVERAGE_FORBIDDEN', 'Sem permissão para definir a cobertura desta unidade.', 'AUTHORIZATION');
  }
  assertCoverageScheduleGeneration(await dbAdmin.collection('dp_schedules').doc(target.scheduleId).get(), target);
  const external = Boolean(input.search) && canAssignExternal(actor);
  const pool = [...await sameUnitUsers(unit.id, text(unit.get('externalId'))), ...(external ? await externalUsers(input.search!) : [])];
  const term = input.search?.toLocaleLowerCase('pt-BR');
  const people = [...new Map(pool.map((user) => [user.id, user])).values()].flatMap((user) => {
    if (user.id === target.beneficiaryUid || user.get('isActive') === false) return [];
    if (term && !String(user.get('username') ?? '').toLocaleLowerCase('pt-BR').includes(term)) return [];
    const assignment = assignmentFor(user, unit, target.date);
    if (!assignment || assignment.assignmentKind === 'external_coverage' && !external) return [];
    return [{ user, assignment }];
  }).slice(0, CANDIDATE_LIMIT);

  const originIds = [...new Set(people.flatMap(({ assignment }) => assignment.assignmentKind === 'external_coverage' ? [assignment.originUnitId] : []))];
  const [eligibility, origins] = await Promise.all([
    evaluateCandidates(actor.workspace_id, target, people.map(({ user }) => user)),
    originIds.length ? dbAdmin.getAll(...originIds.map((id) => dbAdmin.collection('dp_units').doc(id))) : Promise.resolve([]),
  ]);
  const originNames = new Map(origins.filter((origin) => origin.exists).map((origin) => [origin.id, text(origin.get('name')) ?? 'Outra unidade']));
  const candidates = people.map(({ user, assignment }) => {
    const result = eligibility.get(user.id)!;
    const isExternal = assignment.assignmentKind === 'external_coverage';
    return {
      uid: user.id,
      name: String(user.get('username') ?? 'Colaborador'),
      external: isExternal,
      originUnitName: isExternal ? originNames.get(assignment.originUnitId) ?? 'Outra unidade' : null,
      eligible: result.eligible,
      summary: result.summary,
    };
  }).sort((left, right) => Number(left.external) - Number(right.external)
    || Number(right.eligible) - Number(left.eligible)
    || left.name.localeCompare(right.name, 'pt-BR'));
  return { candidates };
}

function coverageShiftId(displacedId: string) {
  return `absence-coverage-${displacedId.slice(0, 40)}`;
}

function assertCoverageScheduleGeneration(schedule: DocumentSnapshot, target: DisplacedShift) {
  const pointer = text(schedule.get('activeRevisionId'));
  if (!schedule.exists || (pointer ?? null) !== (target.officialRevisionId ?? null)) {
    throw fail('DP_ABSENCE_COVERAGE_SCHEDULE_CHANGED', 'A escala mudou. Atualize a cobertura.');
  }
}

/**
 * Mês fechado pelo DP não recebe turno de cobertura: mudaria a escala de um espelho já entregue.
 * O fechamento fica no banco do RH, então a leitura é feita antes da gravação (mesmo padrão das ausências).
 */
export async function assertCoverageCompetenceOpen(workspaceId: string, date: string) {
  const closure = await hrDbAdmin.collection(CLOSURES).doc(closureKey(workspaceId, date)).get();
  if (closure.exists && closure.get('status') === 'closed') {
    throw fail('PTRP_COMPETENCE_CLOSED', 'O mês deste turno já foi fechado pelo DP. Peça a reabertura para definir a cobertura.');
  }
}

function operationHash(input: AbsenceCoverageDecisionInput) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

async function prepareRevisionCoverage(tx: Transaction, actor: ServerUserContext, target: DisplacedShift,
  unit: DocumentSnapshot, substituteUid: string, shiftId: string, expectedAgendaVersion: number,
  exceptionReason: string | undefined, operationId: string) {
  const scheduleRef = dbAdmin.collection('dp_schedules').doc(target.scheduleId);
  const [schedule, freshUnit, substitute, definition, clock] = await Promise.all([
    tx.get(scheduleRef), tx.get(unit.ref), tx.get(dbAdmin.collection('users').doc(substituteUid)),
    target.shiftDefinitionId ? tx.get(dbAdmin.collection('dp_shiftDefinitions').doc(target.shiftDefinitionId)) : Promise.resolve(null),
    tx.get(personAgendaClockRef(actor.workspace_id, substituteUid)),
  ]);
  if (!schedule.exists || schedule.get('workspaceId') !== actor.workspace_id || !target.officialRevisionId
    || schedule.get('activeRevisionId') !== target.officialRevisionId) {
    throw fail('DP_ABSENCE_COVERAGE_SCHEDULE_CHANGED', 'A escala mudou. Atualize a cobertura.');
  }
  if (!freshUnit.exists || freshUnit.get('isArchived') === true || freshUnit.id !== target.unitId) {
    throw fail('DP_ABSENCE_COVERAGE_UNIT_UNAVAILABLE', 'A unidade do turno não está disponível.');
  }
  if (schedule.get('unitId') !== target.unitId
    || `${schedule.get('year')}-${String(schedule.get('month')).padStart(2, '0')}` !== target.date.slice(0, 7)) {
    throw fail('DP_ABSENCE_COVERAGE_SCHEDULE_INVALID', 'A escala não permite esta cobertura.');
  }
  if (!substitute.exists || substitute.get('isActive') === false || substitute.id === target.beneficiaryUid) {
    throw fail('DP_ABSENCE_COVERAGE_SUBSTITUTE_INVALID', 'Escolha outra pessoa para cobrir o turno.', 'VALIDATION');
  }
  const agendaVersion = personAgendaVersion(clock);
  if (agendaVersion !== expectedAgendaVersion) {
    throw fail('DP_ABSENCE_COVERAGE_AGENDA_CHANGED', 'A agenda da pessoa mudou. Confira a cobertura novamente.');
  }
  const assignment = assignmentFor(substitute, freshUnit, target.date);
  if (!assignment) throw fail('DP_ABSENCE_COVERAGE_ORIGIN_REQUIRED', 'A unidade de origem da pessoa precisa estar definida.', 'DATA_INTEGRITY');
  if (assignment.assignmentKind === 'external_coverage' && (!canAssignExternal(actor) || !exceptionReason)) {
    throw fail('DP_ABSENCE_COVERAGE_EXTERNAL_INVALID', 'A cobertura externa exige permissão e motivo.', 'VALIDATION');
  }
  if (await readActiveRevisionShift(tx, schedule, shiftId)) {
    throw fail('DP_ABSENCE_COVERAGE_SHIFT_CONFLICT', 'Já existe outra cobertura gravada para este turno.');
  }
  const eligibility = (await evaluateCandidates(actor.workspace_id, target, [substitute], tx)).get(substitute.id)!;
  if (!eligibility.eligible) throw fail('DP_ABSENCE_COVERAGE_NOT_ELIGIBLE', eligibility.summary, 'EXPECTED_BUSINESS');
  if (target.shiftDefinitionId && (!definition?.exists || definition.get('isArchived') === true)) {
    throw fail('DP_ABSENCE_COVERAGE_DEFINITION_INVALID', 'O turno configurado não está disponível.');
  }
  const overnight = target.endTime < target.startTime;
  if (overnight && (!definition?.exists || definition.get('overnight') !== true
    || definition.get('startTime') !== target.startTime || definition.get('endTime') !== target.endTime)) {
    throw fail('DP_ABSENCE_COVERAGE_OVERNIGHT_INVALID', 'O turno noturno configurado não corresponde ao horário.');
  }
  const primaryUnitId = text(substitute.get('unitId')) ?? target.unitId;
  const primaryUnit = primaryUnitId === target.unitId ? freshUnit : await tx.get(dbAdmin.collection('dp_units').doc(primaryUnitId));
  if (!primaryUnit.exists || primaryUnit.get('isArchived') === true) throw fail('DP_ABSENCE_COVERAGE_PRIMARY_UNIT_INVALID', 'A unidade principal não está disponível.');
  const groupId = text(primaryUnit.get('groupId'));
  const group = groupId ? await tx.get(dbAdmin.collection('dp_unitGroups').doc(groupId)) : null;
  const organizationId = text(primaryUnit.get('organizationId')) ?? text(group?.get('organizationId'));
  const resolution = resolveDPJourney({ journeys: await loadJourneys(tx), target: {
    collaboratorId: substitute.id,
    ...(text(substitute.get('jobRoleId')) ? { jobRoleId: text(substitute.get('jobRoleId')) } : {}),
    jobFunctionIds: strings(substitute.get('jobFunctionIds')), unitId: primaryUnitId,
    ...(groupId ? { unitGroupId: groupId } : {}),
    ...(organizationId ? { unitOrganizationId: organizationId } : {}),
  }, date: target.date });
  if (resolution.status !== 'resolved') throw fail('DP_ABSENCE_COVERAGE_JOURNEY_INVALID', 'A jornada da pessoa não está resolvida.');
  if (!isShiftDefinitionCompatibleWithJourney({ journeyId: resolution.journey.id,
    journeyAllowedShiftDefinitionIds: resolution.journey.allowedShiftDefinitionIds,
    shiftDefinitionId: target.shiftDefinitionId, shiftJourneyIds: definition?.get('journeyIds') })) {
    throw fail('DP_ABSENCE_COVERAGE_JOURNEY_SHIFT_INVALID', 'O turno não é permitido pela jornada da pessoa.');
  }
  await guardOccupancyWrite(tx, actor.workspace_id, shiftOccupancySlices({ beneficiaryUid: substitute.id,
    date: target.date, startTime: target.startTime, endTime: target.endTime, addsOccupancy: true }), 4);
  const now = Timestamp.now();
  const referenceRef = dbAdmin.collection('dp_shiftReferenceHistory').doc();
  const reference = buildDPShiftReference({ collaboratorId: substitute.id, user: substitute.data() ?? {},
    journey: resolution.journey, resolvedBy: resolution.resolvedBy,
    definition: definition?.exists ? { id: definition.id, ...definition.data() } as DPShiftDefinition : null,
    executionUnitId: target.unitId, date: target.date, startTime: target.startTime,
    endTime: target.endTime, capturedAt: now.toDate().toISOString() });
  const shift = { id: shiftId, scheduleId: target.scheduleId, unitId: target.unitId, userId: substitute.id,
    userName: substitute.get('username') ?? null, date: target.date, startTime: target.startTime,
    endTime: target.endTime, overnight, type: 'work', hasConflict: false,
    assignmentKind: assignment.assignmentKind, countsTowardGoals: assignment.countsTowardGoals,
    ...(assignment.assignmentKind === 'external_coverage' ? { originUnitId: assignment.originUnitId, exceptionReason } : {}),
    ...(target.shiftDefinitionId ? { shiftDefinitionId: target.shiftDefinitionId } : {}),
    journeyResolution: { journeyId: resolution.journey.id, lineageId: resolution.journey.lineageId,
      version: resolution.journey.version, name: resolution.journey.name, resolvedBy: resolution.resolvedBy,
      validationMode: resolution.journey.scaleValidation?.mode ?? 'consecutive_days',
      maxConsecutiveWorkDays: resolution.journey.weeklyRest?.maxConsecutiveWorkDays ?? 6, resolvedAt: now },
    referenceRevisionId: referenceRef.id, createdAt: now, updatedAt: now };
  const overlay = await prepareActiveRevisionOperationalChanges({ tx, schedule, workspaceId: actor.workspace_id,
    changes: [{ shiftId, previous: null, next: shift }], actorId: actor.decoded.uid, reason: 'absence_coverage' });
  return { substitute, assignmentKind: assignment.assignmentKind, apply() {
    overlay.apply();
    tx.set(personAgendaClockRef(actor.workspace_id, substitute.id), { workspaceId: actor.workspace_id,
      userId: substitute.id, version: agendaVersion + 1, updatedAt: now });
    tx.create(referenceRef, { workspaceId: actor.workspace_id, scheduleId: target.scheduleId, shiftId,
      shiftPath: `dp_schedules/${target.scheduleId}/shifts/${shiftId}`, userId: substitute.id,
      actorId: actor.decoded.uid, requestId: operationId, event: 'created', previousRevisionId: null,
      reference, capturedAt: now });
  } };
}

export async function decideAbsenceCoverage(actor: ServerUserContext, requestId: string, input: AbsenceCoverageDecisionInput) {
  const { target, unit } = await loadTarget(actor, requestId, input.displacedId);
  if (!canDecideCoverage(actor, target.unitId)) {
    throw fail('DP_ABSENCE_COVERAGE_FORBIDDEN', 'Sem permissão para definir a cobertura desta unidade.', 'AUTHORIZATION');
  }
  const hash = operationHash(input);
  if (target.coverage) {
    if (target.coverage.operationId === input.operationId && target.coverage.operationHash === hash) {
      return getAbsenceCoverage(actor, requestId);
    }
    throw fail('DP_ABSENCE_COVERAGE_ALREADY_DECIDED', 'A cobertura deste turno já foi definida. Atualize a tela.');
  }

  let substitute: DocumentSnapshot | null = null;
  let assignmentKind: 'regular' | 'external_coverage' | null = null;
  const shiftId = coverageShiftId(target.id);
  const schedule = await dbAdmin.collection('dp_schedules').doc(target.scheduleId).get();
  assertCoverageScheduleGeneration(schedule, target);
  const revisionMode = Boolean(schedule.get('activeRevisionId'));
  let revisionAgendaVersion: number | null = null;
  let legacyAgendaVersion: number | null = null;
  let legacyCreateNeeded = false;
  if (input.mode === 'cover') {
    substitute = await dbAdmin.collection('users').doc(input.substituteUid).get();
    if (!substitute.exists || substitute.get('isActive') === false || substitute.id === target.beneficiaryUid) {
      throw fail('DP_ABSENCE_COVERAGE_SUBSTITUTE_INVALID', 'Escolha outra pessoa para cobrir o turno.', 'VALIDATION');
    }
    const assignment = assignmentFor(substitute, unit, target.date);
    if (!assignment) throw fail('DP_ABSENCE_COVERAGE_ORIGIN_REQUIRED', 'A unidade de origem da pessoa precisa estar definida.', 'DATA_INTEGRITY');
    assignmentKind = assignment.assignmentKind;
    if (assignmentKind === 'external_coverage') {
      if (!canAssignExternal(actor)) throw fail('DP_ABSENCE_COVERAGE_EXTERNAL_FORBIDDEN', 'Sem permissão para trazer pessoas de outra unidade.', 'AUTHORIZATION');
      if (!input.exceptionReason) throw fail('DP_ABSENCE_COVERAGE_REASON_REQUIRED', 'Informe o motivo da cobertura por outra unidade.', 'VALIDATION');
    }
    if (revisionMode) {
      await assertCoverageCompetenceOpen(actor.workspace_id, target.date);
      revisionAgendaVersion = await readPersonAgendaVersion(actor.workspace_id, substitute.id);
    } else {
      const existing = await dbAdmin.collection('dp_schedules').doc(target.scheduleId).collection('shifts').doc(shiftId).get();
      if (existing.exists && existing.get('userId') !== input.substituteUid) {
        throw fail('DP_ABSENCE_COVERAGE_SHIFT_CONFLICT', 'Já existe outra cobertura gravada para este turno.');
      }
      if (!existing.exists) {
        await assertCoverageCompetenceOpen(actor.workspace_id, target.date);
        // Lida antes da conferência: se outra gravação mexer na agenda da pessoa até o turno ser gravado, a gravação recusa.
        legacyAgendaVersion = await readPersonAgendaVersion(actor.workspace_id, substitute.id);
        const eligibility = (await evaluateCandidates(actor.workspace_id, target, [substitute])).get(substitute.id)!;
        if (!eligibility.eligible) throw fail('DP_ABSENCE_COVERAGE_NOT_ELIGIBLE', eligibility.summary, 'EXPECTED_BUSINESS');
        legacyCreateNeeded = true;
      }
    }
  }

  const reference = displacedCollection.doc(target.id);
  const taskRef = dbAdmin.collection('dp_responsibilityTasks').doc(`${requestId}_schedule_recomposition`);
  const siblingsQuery = displacedCollection.where('workspaceId', '==', actor.workspace_id)
    .where('requestId', '==', requestId).limit(DISPLACED_LIMIT + 1);
  await dbAdmin.runTransaction(async (tx) => {
    const [current, siblings, task, currentSchedule] = await Promise.all([
      tx.get(reference), tx.get(siblingsQuery), tx.get(taskRef),
      tx.get(dbAdmin.collection('dp_schedules').doc(target.scheduleId)),
    ]);
    assertCoverageScheduleGeneration(currentSchedule, target);
    const stored = current.get('coverage') as Record<string, unknown> | undefined;
    if (stored) {
      if (stored.operationId === input.operationId && stored.operationHash === hash) return;
      throw fail('DP_ABSENCE_COVERAGE_ALREADY_DECIDED', 'A cobertura deste turno já foi definida. Atualize a tela.');
    }
    if (input.mode === 'cover' && revisionMode) {
      if (revisionAgendaVersion === null) throw fail('DP_ABSENCE_COVERAGE_AGENDA_CHANGED', 'A agenda da pessoa mudou.');
      const prepared = await prepareRevisionCoverage(tx, actor, target, unit, input.substituteUid,
        shiftId, revisionAgendaVersion, input.exceptionReason, input.operationId);
      substitute = prepared.substitute;
      assignmentKind = prepared.assignmentKind;
      prepared.apply();
    }
    if (input.mode === 'cover' && !revisionMode && legacyCreateNeeded) {
      if (legacyAgendaVersion === null || !substitute) throw fail('DP_ABSENCE_COVERAGE_AGENDA_CHANGED', 'A agenda da pessoa mudou.');
      await saveWorkShift({ context: actor, scheduleId: target.scheduleId, shiftId, mode: 'create',
        requestId: input.operationId, expectedAgendaVersion: legacyAgendaVersion, transaction: tx,
        input: { userId: substitute.id, unitId: target.unitId, date: target.date,
          startTime: target.startTime, endTime: target.endTime,
          ...(target.shiftDefinitionId ? { shiftDefinitionId: target.shiftDefinitionId } : {}),
          ...(assignmentKind === 'external_coverage' ? { exceptionReason: input.exceptionReason } : {}) },
      });
    }
    if (input.mode === 'cover' && !revisionMode && !legacyCreateNeeded) {
      const existing = await tx.get(dbAdmin.collection('dp_schedules').doc(target.scheduleId).collection('shifts').doc(shiftId));
      if (!existing.exists || existing.get('userId') !== input.substituteUid) {
        throw fail('DP_ABSENCE_COVERAGE_SHIFT_CONFLICT', 'O turno de cobertura mudou. Atualize a tela.');
      }
    }
    const now = new Date().toISOString();
    const substituteName = substitute ? String(substitute.get('username') ?? 'Colaborador') : undefined;
    tx.update(reference, { coverage: {
      mode: input.mode,
      ...(substitute ? { substituteUid: substitute.id, substituteName, assignmentKind,
        shiftPath: `dp_schedules/${target.scheduleId}/shifts/${shiftId}` } : {}),
      ...(input.mode === 'cover' && input.exceptionReason && assignmentKind === 'external_coverage'
        ? { exceptionReason: input.exceptionReason } : {}),
      decidedByUid: actor.decoded.uid, decidedAt: now, operationId: input.operationId, operationHash: hash,
    } });
    const allDecided = siblings.docs.every((doc) => doc.id === target.id || Boolean(doc.get('coverage')));
    if (allDecided && task.exists && task.get('workspaceId') === actor.workspace_id
      && ['unassigned', 'pending', 'claimed'].includes(String(task.get('status')))) {
      const version = Number(task.get('version')) + 1;
      tx.update(taskRef, { status: 'resolved', resolvedByUid: actor.decoded.uid, resolvedAt: now,
        resolutionNote: 'Cobertura definida em todos os turnos retirados.', version, updatedAt: now });
      tx.create(dbAdmin.collection('dp_responsibilityTaskAudit').doc(`${taskRef.id}_${version}`), {
        workspaceId: actor.workspace_id, taskId: taskRef.id, version, action: 'resolved_by_coverage_decision',
        actorUid: actor.decoded.uid, at: now,
      });
    }
    if (substitute) {
      const notificationId = createHash('sha256').update(`absence-coverage:${target.id}:${substitute.id}`).digest('hex');
      tx.create(dbAdmin.collection('userNotifications').doc(notificationId), {
        ownerUid: substitute.id, workspaceId: actor.workspace_id, sourceEventId: `absence-coverage:${target.id}`,
        eventId: notificationId.slice(0, 32), title: 'Cobertura de turno',
        body: `Você vai cobrir o turno de ${formatCoverageDate(target.date)}, das ${target.startTime} às ${target.endTime}, em ${text(unit.get('name')) ?? 'outra unidade'}.`,
        path: '/dashboard/collaborator/schedule', readAt: null, createdAt: now,
      });
    }
    tx.create(dbAdmin.collection('actionLogs').doc(), {
      workspace_id: actor.workspace_id, user_id: actor.decoded.uid, username: actor.userDoc.username ?? null,
      module: 'dp.absences', action: 'absence_coverage_decided',
      metadata: { request_id: requestId, displaced_id: target.id, mode: input.mode, unit_id: target.unitId,
        substitute_uid: substitute?.id ?? null, assignment_kind: assignmentKind, label: COVERAGE_MODE_LABELS[input.mode] },
      ip_address: null, timestamp: Timestamp.now(), ttl: Timestamp.fromMillis(Date.now() + AUDIT_TTL_MS),
    });
  });
  return getAbsenceCoverage(actor, requestId);
}
