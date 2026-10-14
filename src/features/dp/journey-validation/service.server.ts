import 'server-only';

import { addDays, format, parseISO } from 'date-fns';
import type { DocumentSnapshot, QueryDocumentSnapshot } from 'firebase-admin/firestore';

import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { AppError } from '@/lib/observability/app-error';
import type { DPJourney } from '@/types';

import { getSchedule } from '../schedules/read-service.server';
import {
  validateDPJourneySchedule,
  type DPJourneyValidationPerson,
  type DPJourneyValidationResult,
  type DPJourneyValidationShift,
  type DPJourneyValidationShiftDefinition,
} from './core';

const CURRENT_SHIFT_LIMIT = 500;
const PARTICIPANT_LIMIT = 100;
const HISTORY_DAY_LIMIT = 62;
const HISTORY_SHIFT_LIMIT = 6_500;
const JOURNEY_LIMIT = 100;
const SHIFT_DEFINITION_LIMIT = 500;
const FIRESTORE_IN_LIMIT = 30;

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry)))]
    : [];
}

function chunks<T>(values: T[], size: number) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
}

function periodForSchedule(schedule: Record<string, unknown>) {
  const month = Number(schedule.month);
  const year = Number(schedule.year);
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000 || year > 2200) {
    throw new AppError({ code: 'DP_SCHEDULE_PERIOD_INVALID', kind: 'DATA_INTEGRITY', safeMessage: 'A competência da escala está inválida.' });
  }
  const periodStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const periodEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { periodStart, periodEnd };
}

function isScheduleShift(document: QueryDocumentSnapshot) {
  const segments = document.ref.path.split('/');
  return segments.length === 4 && segments[0] === 'dp_schedules' && segments[2] === 'shifts';
}

function shiftFromDocument(document: QueryDocumentSnapshot | DocumentSnapshot): DPJourneyValidationShift | null {
  const userId = stringValue(document.get('userId'));
  const date = stringValue(document.get('date'));
  const unitId = stringValue(document.get('unitId'));
  const type = document.get('type');
  if (!userId || !date || !unitId || (type !== 'work' && type !== 'day_off')) return null;
  return {
    id: document.id,
    userId,
    date,
    unitId,
    type,
    ...(stringValue(document.get('shiftDefinitionId')) ? { shiftDefinitionId: stringValue(document.get('shiftDefinitionId')) } : {}),
  };
}

async function loadJourneyCandidates() {
  const snapshot = await dbAdmin.collection('dp_journeys')
    .where('status', 'in', ['published', 'archived'])
    .limit(JOURNEY_LIMIT + 1)
    .get();
  if (snapshot.size > JOURNEY_LIMIT) {
    throw new AppError({
      code: 'DP_JOURNEY_VALIDATION_CATALOG_LIMIT',
      kind: 'DATA_INTEGRITY',
      safeMessage: 'Há jornadas demais para resolver a escala com segurança.',
    });
  }
  return snapshot.docs.map((document) => ({ id: document.id, ...document.data() } as DPJourney));
}

export async function validateScheduleJourneys(params: {
  context: ServerUserContext;
  scheduleId: string;
  authorizedSchedule?: Record<string, unknown>;
}): Promise<DPJourneyValidationResult> {
  const schedule = params.authorizedSchedule ?? await getSchedule(params.context, params.scheduleId);
  const { periodStart, periodEnd } = periodForSchedule(schedule);
  const historyFrom = format(addDays(parseISO(periodStart), -HISTORY_DAY_LIMIT), 'yyyy-MM-dd');
  const scheduleRef = dbAdmin.collection('dp_schedules').doc(params.scheduleId);
  const currentSnapshot = await scheduleRef.collection('shifts').orderBy('date').limit(CURRENT_SHIFT_LIMIT + 1).get();
  if (currentSnapshot.size > CURRENT_SHIFT_LIMIT) {
    throw new AppError({ code: 'DP_SCHEDULE_SHIFT_LIMIT_REACHED', kind: 'DATA_INTEGRITY', safeMessage: 'A escala possui turnos demais para validar com segurança.' });
  }

  const currentShifts = currentSnapshot.docs.map(shiftFromDocument).filter((shift): shift is DPJourneyValidationShift => Boolean(shift));
  const participantIds = [...new Set(currentShifts.filter((shift) => shift.type === 'work').map((shift) => shift.userId))].sort();
  if (participantIds.length > PARTICIPANT_LIMIT) {
    throw new AppError({ code: 'DP_JOURNEY_VALIDATION_PARTICIPANT_LIMIT', kind: 'DATA_INTEGRITY', safeMessage: 'A escala possui colaboradores demais para validar em uma única operação.' });
  }
  if (participantIds.length === 0) {
    return validateDPJourneySchedule({
      journeys: [],
      people: {},
      shifts: currentShifts,
      periodStart,
      periodEnd,
      historyFrom,
      version: Number(schedule.journeyValidationVersion ?? 0),
    });
  }

  const historyDocuments = new Map(currentSnapshot.docs.map((document) => [document.ref.path, document]));
  for (const participantChunk of chunks(participantIds, FIRESTORE_IN_LIMIT)) {
    const remaining = HISTORY_SHIFT_LIMIT - historyDocuments.size;
    if (remaining <= 0) {
      throw new AppError({ code: 'DP_JOURNEY_VALIDATION_HISTORY_LIMIT', kind: 'DATA_INTEGRITY', safeMessage: 'O histórico necessário excede o limite seguro de validação.' });
    }
    const participantSet = new Set(participantChunk);
    const currentDuplicateAllowance = currentShifts.filter((shift) => participantSet.has(shift.userId)).length;
    const historySnapshot = await dbAdmin.collectionGroup('shifts')
      .where('userId', 'in', participantChunk)
      .where('date', '>=', historyFrom)
      .where('date', '<=', periodEnd)
      .orderBy('date', 'asc')
      .limit(remaining + currentDuplicateAllowance + 1)
      .get();
    historySnapshot.docs.filter(isScheduleShift).forEach((document) => historyDocuments.set(document.ref.path, document));
    if (historyDocuments.size > HISTORY_SHIFT_LIMIT) {
      throw new AppError({ code: 'DP_JOURNEY_VALIDATION_HISTORY_LIMIT', kind: 'DATA_INTEGRITY', safeMessage: 'O histórico necessário excede o limite seguro de validação.' });
    }
  }

  const userDocuments = await dbAdmin.getAll(...participantIds.map((id) => dbAdmin.collection('users').doc(id)));
  const fallbackUnitId = stringValue(schedule.unitId);
  const primaryUnitIds = [...new Set(userDocuments.map((document) => stringValue(document.get('unitId')) ?? fallbackUnitId).filter((id): id is string => Boolean(id)))];
  const unitDocuments = primaryUnitIds.length
    ? await dbAdmin.getAll(...primaryUnitIds.map((id) => dbAdmin.collection('dp_units').doc(id)))
    : [];
  const unitsById = new Map(unitDocuments.filter((document) => document.exists).map((document) => [document.id, document]));
  const groupIds = [...new Set(unitDocuments.map((document) => stringValue(document.get('groupId'))).filter((id): id is string => Boolean(id)))];
  const groupDocuments = groupIds.length
    ? await dbAdmin.getAll(...groupIds.map((id) => dbAdmin.collection('dp_unitGroups').doc(id)))
    : [];
  const groupsById = new Map(groupDocuments.filter((document) => document.exists).map((document) => [document.id, document]));
  const people: Record<string, DPJourneyValidationPerson> = {};
  userDocuments.forEach((document) => {
    if (!document.exists) return;
    const unitId = stringValue(document.get('unitId')) ?? fallbackUnitId;
    const unit = unitId ? unitsById.get(unitId) : undefined;
    const unitGroupId = stringValue(unit?.get('groupId'));
    const group = unitGroupId ? groupsById.get(unitGroupId) : undefined;
    const unitOrganizationId = stringValue(unit?.get('organizationId')) ?? stringValue(group?.get('organizationId'));
    people[document.id] = {
      collaboratorId: document.id,
      ...(stringValue(document.get('username')) ? { name: stringValue(document.get('username')) } : {}),
      ...(stringValue(document.get('jobRoleId')) ? { jobRoleId: stringValue(document.get('jobRoleId')) } : {}),
      jobFunctionIds: stringArray(document.get('jobFunctionIds')),
      ...(unitId ? { unitId } : {}),
      ...(unitGroupId ? { unitGroupId } : {}),
      ...(unitOrganizationId ? { unitOrganizationId } : {}),
    };
  });

  const journeys = await loadJourneyCandidates();
  const shifts = [...historyDocuments.values()].map(shiftFromDocument).filter((shift): shift is DPJourneyValidationShift => Boolean(shift));
  const shiftDefinitionIds = [...new Set(shifts.flatMap((shift) => shift.shiftDefinitionId ? [shift.shiftDefinitionId] : []))];
  if (shiftDefinitionIds.length > SHIFT_DEFINITION_LIMIT) {
    throw new AppError({
      code: 'DP_JOURNEY_VALIDATION_SHIFT_DEFINITION_LIMIT',
      kind: 'DATA_INTEGRITY',
      safeMessage: 'Há definições de turno demais para validar a escala com segurança.',
    });
  }
  const shiftDefinitionDocuments = shiftDefinitionIds.length
    ? await dbAdmin.getAll(...shiftDefinitionIds.map((id) => dbAdmin.collection('dp_shiftDefinitions').doc(id)))
    : [];
  const shiftDefinitions = Object.fromEntries(shiftDefinitionDocuments.flatMap((document) => {
    if (!document.exists) return [];
    const journeyIds = stringArray(document.get('journeyIds'));
    const startTime = document.get('startTime');
    const endTime = document.get('endTime');
    if (typeof startTime !== 'string' || typeof endTime !== 'string') return [];
    const breakType = document.get('breakType');
    const breakStart = document.get('breakStart');
    const breakEnd = document.get('breakEnd');
    const breakDurationMinutes = document.get('breakDurationMinutes');
    return [[document.id, {
      ...(journeyIds.length ? { journeyIds } : {}),
      startTime,
      endTime,
      ...(document.get('overnight') === true ? { overnight: true } : {}),
      ...(['none', 'fixed', 'flexible', 'staggered'].includes(breakType) ? { breakType } : {}),
      ...(typeof breakStart === 'string' ? { breakStart } : {}),
      ...(typeof breakEnd === 'string' ? { breakEnd } : {}),
      ...(typeof breakDurationMinutes === 'number' ? { breakDurationMinutes } : {}),
    } as DPJourneyValidationShiftDefinition]];
  }));
  return validateDPJourneySchedule({
    journeys,
    people,
    shifts,
    shiftDefinitions,
    periodStart,
    periodEnd,
    historyFrom,
    version: Number(schedule.journeyValidationVersion ?? 0),
  });
}
