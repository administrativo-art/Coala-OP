import 'server-only';

import type { Firestore } from 'firebase-admin/firestore';

import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { AppError } from '@/lib/observability/app-error';

import { journeyReferenceMinutes, type BankJourney } from '@/features/dp/time-bank/core';
import { AUTOMATIC_ABSENCES } from '@/features/dp/time-adjustments/automatic-absence.server';
import { automaticAbsenceSuperseded } from '@/features/dp/time-adjustments/automatic-absence-core';

import { repPOwnMonthSchema } from './schemas';
import { isBrazilTimeZone } from './time-zones';

/** Turno escalado da própria pessoa num dia, com o intervalo do cadastro do turno e a tolerância da jornada; nunca dado fiscal. */
export type RepPOwnScheduledShift = {
  date: string;
  type: 'work' | 'day_off';
  startTime: string | null;
  endTime: string | null;
  overnight: boolean;
  unitId: string | null;
  unitName: string | null;
  assignmentKind?: 'regular' | 'external_coverage';
  unitTimeZone: string | null;
  shiftName: string | null;
  breakType: 'none' | 'fixed' | 'flexible' | 'staggered';
  breakStart: string | null;
  breakEnd: string | null;
  breakDurationMinutes: number | null;
  breakWindowStart: string | null;
  breakWindowEnd: string | null;
  expectedPunches: number | null;
  executionUnitPolicy: 'scheduled' | 'free';
  locationTrackingPolicy: 'disabled' | 'punch_only' | 'workday';
  breakSegments: { start: string; end: string }[] | null;
  breakSplit: 'single' | 'multiple';
  breakPauseCount: number | null;
  breakMinPauseMinutes: number | null;
  /** Tolerância da versão da jornada resolvida na escrita do turno; null = sem jornada ou sem tolerância. */
  toleranceMinutes: number | null;
  /** Versão da jornada do turno e a carga dela no dia (referência do banco de horas); null sem jornada resolvida. */
  journeyId: string | null;
  referenceMinutes: number | null;
};

export type RepPOwnMonth = {
  month: string; shifts: RepPOwnScheduledShift[]; holidays: string[];
  /** Optional keeps injected readers and older clients compatible during rollout. */
  automaticAbsences?: string[]; truncated: boolean;
};

// Um mês tem no máximo 31 dias; dois turnos por dia cobrem trocas e coberturas sem ler mais que o necessário.
const MAX_OWN_SHIFTS = 62;

type Dependencies = { db: Firestore; hrDb: Firestore };
const defaults: Dependencies = { db: dbAdmin, hrDb: hrDbAdmin };

function toMinutes(value: string) { return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5)); }
function text(value: unknown) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function minutes(value: unknown) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null; }
function civilDateOf(value: unknown) {
  if (typeof value === 'string') return value.slice(0, 10);
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return (value.toDate() as Date).toISOString().slice(0, 10);
  return null;
}
function journeyOf(doc: { get(field: string): unknown } | undefined): BankJourney | null {
  if (!doc) return null;
  const days = doc.get('days');
  const weeklyRest = doc.get('weeklyRest') as BankJourney['weeklyRest'];
  return Array.isArray(days) && typeof doc.get('validFrom') === 'string' && Number.isInteger(doc.get('cycleLengthDays'))
    ? { days: days as BankJourney['days'], validFrom: String(doc.get('validFrom')), cycleLengthDays: Number(doc.get('cycleLengthDays')), weeklyRest: weeklyRest ?? null }
    : null;
}
function millis(value: unknown) {
  return value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function' ? Number(value.toMillis()) : 0;
}

/**
 * Escala do mês da própria pessoa para o Registro de ponto: lê as escalas do mês (uma por unidade, a trancada
 * e mais recente primeiro, como em Minha escala), só os turnos da pessoa pelo índice userId+date e os cadastros
 * de turno, unidade e versão de jornada citados. Custo por abertura: escalas do mês + turnos da pessoa (≤62) + cadastros citados.
 */
export async function readOwnRepPMonth(context: ServerUserContext, raw: unknown, injected: Partial<Dependencies> = {}): Promise<RepPOwnMonth> {
  const parsed = repPOwnMonthSchema.safeParse(raw);
  if (!parsed.success) throw new AppError({ code: 'REP_P_MONTH_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Mês inválido.' });
  return readRepPMonthOfPerson([context.decoded.uid, text(context.userDoc.id), text(context.userDoc.hrEmployeeId)], parsed.data.month, injected,
    { automaticAbsence: { workspaceId: context.workspace_id, uid: context.decoded.uid } });
}

/**
 * Escala do mês de uma pessoa pelos identificadores dela (uid e cadastro do RH). Usada pela tela própria e pelo
 * espelho do fechamento, que confere a permissão antes de chamar.
 */
export async function readRepPMonthOfPerson(ids: Array<string | null | undefined>, competence: string, injected: Partial<Dependencies> = {}, options: { holidays?: boolean; automaticAbsence?: { workspaceId: string; uid: string } } = {}): Promise<RepPOwnMonth> {
  const { db, hrDb } = { ...defaults, ...injected };
  const [year, month] = competence.split('-').map(Number);
  const start = `${competence}-01`;
  const end = `${competence}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}`;
  const ownIds = [...new Set(ids.filter((value): value is string => Boolean(value)))].slice(0, 10);

  const [schedules, shifts, automaticAbsences] = await Promise.all([
    db.collection('dp_schedules').where('year', '==', year).where('month', '==', month).select('unitId', 'locked', 'createdAt', 'calendarId').get(),
    db.collectionGroup('shifts').where('userId', 'in', ownIds).where('date', '>=', start).where('date', '<=', end)
      .orderBy('date', 'asc').limit(MAX_OWN_SHIFTS).get(),
    options.automaticAbsence ? hrDb.collection(AUTOMATIC_ABSENCES)
      .where('workspaceId', '==', options.automaticAbsence.workspaceId).where('employeeUid', '==', options.automaticAbsence.uid)
      .where('workDate', '>=', start).where('workDate', '<=', end).orderBy('workDate').limit(32).get() : null,
  ]);
  const latestByUnit = new Map<string, string>();
  for (const schedule of [...schedules.docs].sort((left, right) =>
    Number(right.get('locked') === true) - Number(left.get('locked') === true) || millis(right.get('createdAt')) - millis(left.get('createdAt')))) {
    const scope = String(schedule.get('unitId') ?? '__legacy__');
    if (!latestByUnit.has(scope)) latestByUnit.set(scope, schedule.id);
  }
  const official = new Set(latestByUnit.values());
  const ownShifts = shifts.docs.filter((doc) => official.has(doc.ref.parent.parent?.id ?? ''));

  const definitionIds = [...new Set(ownShifts.map((doc) => text(doc.get('shiftDefinitionId'))).filter((value): value is string => Boolean(value)))];
  const unitIds = [...new Set(ownShifts.map((doc) => text(doc.get('unitId'))).filter((value): value is string => Boolean(value)))];
  // Cada versão publicada da jornada é imutável: ler pelo id resolvido na escrita dá a tolerância daquele dia.
  const journeyIds = [...new Set(ownShifts.map((doc) => text(doc.get('journeyResolution.journeyId'))).filter((value): value is string => Boolean(value)))];
  const [definitions, units, journeys] = await Promise.all([
    definitionIds.length ? db.getAll(...definitionIds.map((id) => db.collection('dp_shiftDefinitions').doc(id))) : [],
    unitIds.length ? db.getAll(...unitIds.map((id) => db.collection('dp_units').doc(id))) : [],
    journeyIds.length ? db.getAll(...journeyIds.map((id) => db.collection('dp_journeys').doc(id))) : [],
  ]);
  const journeyById = new Map(journeys.filter((doc) => doc.exists).map((doc) => [doc.id, doc]));
  const toleranceByJourney = new Map([...journeyById].map(([id, doc]) => [id, minutes(doc.get('toleranceMinutes'))]));
  // Feriados do calendário das escalas oficiais do mês, só para o banco de horas (um calendário por ano, até 200 datas).
  const calendarIds = !options.holidays ? [] : [...new Set(schedules.docs.filter((doc) => official.has(doc.id)).map((doc) => text(doc.get('calendarId'))).filter((value): value is string => Boolean(value)))].slice(0, 10);
  const holidaySnapshots = await Promise.all(calendarIds.map((id) => db.collection('dp_calendars').doc(id).collection('holidays').limit(200).get()));
  // Ponto facultativo (`optional`) não é feriado para o banco.
  const holidays = [...new Set(holidaySnapshots.flatMap((snapshot) => snapshot.docs.filter((doc) => doc.get('type') !== 'optional').map((doc) => civilDateOf(doc.get('date')))).filter((date): date is string => Boolean(date) && date! >= start && date! <= end))].sort();
  const definitionById = new Map(definitions.filter((doc) => doc.exists).map((doc) => [doc.id, doc]));
  const unitNameById = new Map(units.filter((doc) => doc.exists).map((doc) => [doc.id, text(doc.get('name'))]));
  const unitTimeZoneById = new Map(units.filter((doc) => doc.exists && isBrazilTimeZone(doc.get('timeZone')))
    .map((doc) => [doc.id, String(doc.get('timeZone'))]));

  const result: RepPOwnScheduledShift[] = ownShifts.map((doc) => {
    const definition = definitionById.get(text(doc.get('shiftDefinitionId')) ?? '');
    const breakStart = text(definition?.get('breakStart'));
    const breakEnd = text(definition?.get('breakEnd'));
    const declaredBreak = text(definition?.get('breakType'));
    const breakType = (['none', 'fixed', 'flexible', 'staggered'] as const).find((value) => value === declaredBreak)
      ?? (breakStart && breakEnd ? 'fixed' : 'none');
    const unitId = text(doc.get('unitId'));
    const rawSegments = definition?.get('breakSegments');
    const segments = breakType === 'fixed' && Array.isArray(rawSegments)
      ? rawSegments.filter((segment) => typeof segment?.start === 'string' && typeof segment?.end === 'string')
        .map((segment) => ({ start: String(segment.start), end: String(segment.end) }))
      : null;
    return {
      date: String(doc.get('date')),
      type: doc.get('type') === 'day_off' ? 'day_off' : 'work',
      startTime: text(doc.get('startTime')),
      endTime: text(doc.get('endTime')),
      overnight: doc.get('overnight') === true,
      unitId,
      unitName: unitId ? unitNameById.get(unitId) ?? null : null,
      assignmentKind: doc.get('assignmentKind') === 'external_coverage' ? 'external_coverage' : 'regular',
      unitTimeZone: unitId ? unitTimeZoneById.get(unitId) ?? null : null,
      shiftName: text(definition?.get('name')),
      breakType,
      breakStart: breakType === 'fixed' ? breakStart : null,
      breakEnd: breakType === 'fixed' ? breakEnd : null,
      breakDurationMinutes: breakType === 'fixed' && segments
        ? segments.reduce((sum, segment) => sum + Math.max(0, toMinutes(segment.end) - toMinutes(segment.start)), 0)
        : breakType === 'fixed' && breakStart && breakEnd
        ? Math.max(0, Number(breakEnd.slice(0, 2)) * 60 + Number(breakEnd.slice(3)) - Number(breakStart.slice(0, 2)) * 60 - Number(breakStart.slice(3)))
        : minutes(definition?.get('breakDurationMinutes')),
      breakWindowStart: breakType === 'staggered' ? text(definition?.get('breakWindowStart')) : null,
      breakWindowEnd: breakType === 'staggered' ? text(definition?.get('breakWindowEnd')) : null,
      expectedPunches: minutes(definition?.get('expectedPunches')),
      executionUnitPolicy: definition?.get('executionUnitPolicy') === 'free' ? 'free' : 'scheduled',
      locationTrackingPolicy: (['disabled', 'punch_only', 'workday'] as const).find((value) => value === definition?.get('locationTrackingPolicy')) ?? 'disabled',
      breakSegments: segments?.length ? segments : null,
      breakSplit: definition?.get('breakSplit') === 'multiple' && breakType !== 'fixed' ? 'multiple' : 'single',
      breakPauseCount: minutes(definition?.get('breakPauseCount')),
      breakMinPauseMinutes: minutes(definition?.get('breakMinPauseMinutes')),
      toleranceMinutes: toleranceByJourney.get(text(doc.get('journeyResolution.journeyId')) ?? '') ?? null,
      journeyId: journeyById.has(text(doc.get('journeyResolution.journeyId')) ?? '') ? text(doc.get('journeyResolution.journeyId')) : null,
      referenceMinutes: journeyReferenceMinutes(journeyOf(journeyById.get(text(doc.get('journeyResolution.journeyId')) ?? '')), String(doc.get('date'))),
    };
  });
  const automaticDates = new Set(automaticAbsences?.docs.filter((doc) => doc.get('status') === 'active').map((doc) => String(doc.get('workDate'))) ?? []);
  let effectiveAutomaticDates = [...automaticDates];
  if (options.automaticAbsence && automaticDates.size) {
    const [approvedAbsences, approvedAdjustments] = await Promise.all([
      hrDb.collection('dp_absenceRequests').where('workspaceId', '==', options.automaticAbsence.workspaceId)
        .where('beneficiaryUid', '==', options.automaticAbsence.uid).where('startDate', '<=', end).limit(100).get(),
      hrDb.collection('ptrp_adjustmentRequests').where('workspaceId', '==', options.automaticAbsence.workspaceId)
        .where('employeeUid', '==', options.automaticAbsence.uid).where('workDate', '>=', start).where('workDate', '<=', end).limit(100).get(),
    ]);
    const periods = approvedAbsences.docs.filter((doc) => doc.get('status') === 'approved')
      .map((doc) => ({ startDate: String(doc.get('startDate')), endDate: String(doc.get('endDate')) }));
    const adjustmentDates = new Set(approvedAdjustments.docs.filter((doc) => doc.get('status') === 'approved').map((doc) => String(doc.get('workDate'))));
    effectiveAutomaticDates = effectiveAutomaticDates.filter((date) => !automaticAbsenceSuperseded(date, adjustmentDates, periods));
  }
  return { month: competence, shifts: result, holidays,
    automaticAbsences: effectiveAutomaticDates.sort(),
    truncated: shifts.size >= MAX_OWN_SHIFTS };
}
