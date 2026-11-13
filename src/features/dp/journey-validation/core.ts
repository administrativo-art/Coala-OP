import { addDays, differenceInCalendarDays, format, parseISO, startOfWeek } from 'date-fns';

import { resolveDPJourney, type DPJourneyResolutionTarget, type DPJourneyResolvedBy } from '@/lib/dp-journey-resolution';
import { shiftDurationSummary, shiftJourneyComparisons } from '@/lib/dp-shift-duration';
import { isShiftDefinitionCompatibleWithJourney } from '@/lib/dp-time-config-rules';
import type { DPJourney } from '@/types';

export type DPJourneyValidationShift = {
  id: string;
  userId: string;
  date: string;
  type: 'work' | 'day_off';
  unitId: string;
  shiftDefinitionId?: string;
  startTime?: string;
  endTime?: string;
};

export type DPJourneyValidationShiftDefinition = {
  journeyIds?: string[];
  startTime?: string;
  endTime?: string;
  overnight?: boolean;
  breakType?: 'none' | 'fixed' | 'flexible' | 'staggered';
  breakStart?: string;
  breakEnd?: string;
  breakDurationMinutes?: number;
  breakSegments?: { start: string; end: string }[];
};

export type DPJourneyValidationPerson = DPJourneyResolutionTarget & {
  name?: string;
};

export type DPJourneyValidationIssueCode =
  | 'JOURNEY_NOT_FOUND'
  | 'JOURNEY_AMBIGUOUS'
  | 'JOURNEY_MANUAL_REVIEW'
  | 'MAX_CONSECUTIVE_DAYS_EXCEEDED'
  | 'WEEKLY_REST_MISSING'
  | 'MONTHLY_REST_MISSING'
  | 'MONTHLY_REST_CAPACITY'
  | 'SUNDAY_REST_MISSING'
  | 'WEEKLY_WORKLOAD_EXCEEDED'
  | 'WEEKLY_WORKLOAD_UNVERIFIED'
  | 'SHIFT_NOT_ALLOWED'
  | 'SHIFT_SHORTER_THAN_JOURNEY';

export type DPJourneyValidationIssue = {
  code: DPJourneyValidationIssueCode;
  userId: string;
  date?: string;
  journeyId?: string;
  blocking: boolean;
  message: string;
};

export type DPJourneyValidationResult = {
  status: 'ok' | 'warning' | 'blocked';
  periodStart: string;
  periodEnd: string;
  historyFrom: string;
  version: number;
  people: Record<string, {
    status: 'resolved' | 'unresolved' | 'ambiguous' | 'manual_review';
    journey?: {
      id: string;
      lineageId: string;
      version: number;
      name: string;
      resolvedBy: DPJourneyResolvedBy;
      validationMode: 'consecutive_days' | 'manual_review';
      maxConsecutiveWorkDays: number;
    };
    carryInConsecutiveDays: number;
    countsByDate: Record<string, number>;
    predictedDayOffDates: string[];
    restSummary?: {
      distribution: 'weekly' | 'monthly_collective';
      monthRequired: number;
      monthGranted: number;
      monthRestDates: string[];
      monthAvailable: number;
      nextRestDueDate?: string;
      weeks: Array<{ start: string; end: string; required: number; granted: number; complete: boolean; workedMinutes: number | null }>;
    };
  }>;
  issues: DPJourneyValidationIssue[];
};

function previousDate(date: string) {
  return format(addDays(parseISO(date), -1), 'yyyy-MM-dd');
}

function nextDate(date: string) {
  return format(addDays(parseISO(date), 1), 'yyyy-MM-dd');
}

function displayDate(date: string) {
  return format(parseISO(date), 'dd/MM/yyyy');
}

function validationMode(journey: DPJourney) {
  return journey.scaleValidation?.mode ?? 'consecutive_days';
}

function maxConsecutiveDays(journey: DPJourney) {
  return journey.weeklyRest?.maxConsecutiveWorkDays ?? 6;
}

function journeySummary(journey: DPJourney, resolvedBy: DPJourneyResolvedBy) {
  return {
    id: journey.id,
    lineageId: journey.lineageId,
    version: journey.version,
    name: journey.name,
    resolvedBy,
    validationMode: validationMode(journey),
    maxConsecutiveWorkDays: maxConsecutiveDays(journey),
  };
}

export function validateDPJourneySchedule(params: {
  journeys: DPJourney[];
  people: Record<string, DPJourneyValidationPerson>;
  shifts: DPJourneyValidationShift[];
  shiftDefinitions?: Record<string, DPJourneyValidationShiftDefinition>;
  periodStart: string;
  periodEnd: string;
  historyFrom: string;
  version?: number;
}): DPJourneyValidationResult {
  const issues: DPJourneyValidationIssue[] = [];
  const peopleResult: DPJourneyValidationResult['people'] = {};
  const workDatesByUser = new Map<string, Set<string>>();
  const dayOffDatesByUser = new Map<string, Set<string>>();
  const currentShiftsByUser = new Map<string, DPJourneyValidationShift[]>();

  params.shifts.forEach((shift) => {
    if (shift.type === 'work') {
      const workedDates = workDatesByUser.get(shift.userId) ?? new Set<string>();
      workedDates.add(shift.date);
      workDatesByUser.set(shift.userId, workedDates);
    }
    if (shift.type === 'day_off') {
      const days = dayOffDatesByUser.get(shift.userId) ?? new Set<string>();
      days.add(shift.date);
      dayOffDatesByUser.set(shift.userId, days);
    }
    if (shift.date >= params.periodStart && shift.date <= params.periodEnd) {
      const current = currentShiftsByUser.get(shift.userId) ?? [];
      current.push(shift);
      currentShiftsByUser.set(shift.userId, current);
    }
  });

  currentShiftsByUser.forEach((currentShifts, userId) => {
    const person = params.people[userId];
    const workedDates = workDatesByUser.get(userId) ?? new Set<string>();
    const dayOffDates = dayOffDatesByUser.get(userId) ?? new Set<string>();
    const currentWorkDates = [...new Set(currentShifts.filter((shift) => shift.type === 'work').map((shift) => shift.date))].sort();
    const countsByDate: Record<string, number> = {};
    const predicted = new Set<string>();
    let personStatus: DPJourneyValidationResult['people'][string]['status'] = 'resolved';
    let primaryJourney: DPJourneyValidationResult['people'][string]['journey'];
    let carryInConsecutiveDays = 0;
    let restSummary: DPJourneyValidationResult['people'][string]['restSummary'];

    if (!person) {
      personStatus = 'unresolved';
      issues.push({ code: 'JOURNEY_NOT_FOUND', userId, blocking: true, message: 'Não foi possível carregar os dados do colaborador para resolver a jornada.' });
    }

    currentWorkDates.forEach((date) => {
      let cursor = date;
      let count = 0;
      while (workedDates.has(cursor) && count < 63) {
        count += 1;
        cursor = previousDate(cursor);
      }
      countsByDate[date] = count;
      if (date === currentWorkDates[0]) carryInConsecutiveDays = Math.max(0, count - 1);
      if (!person) return;

      const resolution = resolveDPJourney({ journeys: params.journeys, target: person, date });
      if (resolution.status === 'none') {
        personStatus = 'unresolved';
        issues.push({ code: 'JOURNEY_NOT_FOUND', userId, date, blocking: true, message: `Nenhuma jornada vigente se aplica em ${displayDate(date)}.` });
        return;
      }
      if (resolution.status === 'ambiguous') {
        personStatus = 'ambiguous';
        issues.push({ code: 'JOURNEY_AMBIGUOUS', userId, date, blocking: true, message: `Mais de uma jornada com a mesma prioridade se aplica em ${displayDate(date)}.` });
        return;
      }

      const journey = resolution.journey;
      primaryJourney ??= journeySummary(journey, resolution.resolvedBy);
      if (validationMode(journey) === 'manual_review') {
        personStatus = 'manual_review';
        if (!issues.some((issue) => issue.code === 'JOURNEY_MANUAL_REVIEW' && issue.userId === userId && issue.journeyId === journey.id)) {
          issues.push({
            code: 'JOURNEY_MANUAL_REVIEW',
            userId,
            date,
            journeyId: journey.id,
            blocking: true,
            message: `${journey.name} exige revisão manual antes do fechamento da escala.`,
          });
        }
        return;
      }

      const maximum = maxConsecutiveDays(journey);
      if (count > maximum) {
        issues.push({
          code: 'MAX_CONSECUTIVE_DAYS_EXCEEDED',
          userId,
          date,
          journeyId: journey.id,
          blocking: true,
          message: `${count} dias consecutivos; a jornada permite no máximo ${maximum}.`,
        });
      }
      if (journey.weeklyRest?.placement === 'schedule' && count === maximum) {
        const expectedDayOff = nextDate(date);
        if (!workedDates.has(expectedDayOff)) predicted.add(expectedDayOff);
      }

      currentShifts
        .filter((shift) => shift.type === 'work' && shift.date === date)
        .forEach((shift) => {
          const shiftDefinition = shift.shiftDefinitionId
            ? params.shiftDefinitions?.[shift.shiftDefinitionId]
            : undefined;
          if (!isShiftDefinitionCompatibleWithJourney({
            journeyId: journey.id,
            journeyAllowedShiftDefinitionIds: journey.allowedShiftDefinitionIds,
            shiftDefinitionId: shift.shiftDefinitionId,
            shiftJourneyIds: shiftDefinition?.journeyIds,
          })) {
            issues.push({
              code: 'SHIFT_NOT_ALLOWED',
              userId,
              date,
              journeyId: journey.id,
              blocking: true,
              message: `O turno de ${displayDate(date)} não está permitido na jornada ${journey.name}.`,
            });
          }
          if (shiftDefinition?.startTime
            && shiftDefinition.endTime
            && journey.useDefinedShiftWhenShorter === false
            && shiftJourneyComparisons({ ...shiftDefinition, startTime: shiftDefinition.startTime, endTime: shiftDefinition.endTime }, journey)
              .some((comparison) => comparison.endsBeforeExpected)) {
            issues.push({
              code: 'SHIFT_SHORTER_THAN_JOURNEY',
              userId,
              date,
              journeyId: journey.id,
              blocking: true,
              message: `O turno de ${displayDate(date)} termina antes do expediente esperado e a jornada ${journey.name} não autoriza usar o expediente definido.`,
            });
          }
        });
    });

    if (person) {
      const daysInMonth = differenceInCalendarDays(parseISO(params.periodEnd), parseISO(params.periodStart)) + 1;
      const monthDates = Array.from({ length: daysInMonth }, (_, index) => format(addDays(parseISO(params.periodStart), index), 'yyyy-MM-dd'));
      const resolveAt = (date: string) => resolveDPJourney({ journeys: params.journeys, target: person, date });
      const resolvedMonth = monthDates.map((date) => ({ date, result: resolveAt(date) }));
      const configured = resolvedMonth.filter(({ result }) => result.status === 'resolved' && result.journey.weeklyRest?.distribution);
      if (configured.length) {
        const invalid = resolvedMonth.find(({ result }) => result.status !== 'resolved' || validationMode(result.journey) === 'manual_review');
        const modes = new Set(resolvedMonth.map(({ result }) => result.status === 'resolved' ? result.journey.weeklyRest?.distribution : undefined));
        if (invalid || modes.size !== 1) {
          issues.push({ code: 'JOURNEY_MANUAL_REVIEW', userId, date: invalid?.date, blocking: true,
            message: `${person.name ?? 'Colaborador'}: a competência tem jornadas sem resolução ou com regras de repouso diferentes; confira a troca de vigência antes de publicar.` });
        } else {
          const distribution = configured[0].result.status === 'resolved' ? configured[0].result.journey.weeklyRest!.distribution! : 'weekly';
          const journey = configured[0].result.status === 'resolved' ? configured[0].result.journey : undefined;
          if (!journey) throw new Error('Jornada resolvida ausente.');
          primaryJourney ??= journeySummary(journey, configured[0].result.status === 'resolved' ? configured[0].result.resolvedBy : 'company');
          const weeks: NonNullable<typeof restSummary>['weeks'] = [];
          for (let weekStart = startOfWeek(parseISO(params.periodStart), { weekStartsOn: 1 });
            format(weekStart, 'yyyy-MM-dd') <= params.periodEnd; weekStart = addDays(weekStart, 7)) {
            const start = format(weekStart, 'yyyy-MM-dd');
            const end = format(addDays(weekStart, 6), 'yyyy-MM-dd');
            const dates = Array.from({ length: 7 }, (_, index) => format(addDays(weekStart, index), 'yyyy-MM-dd'));
            const complete = end <= params.periodEnd;
            const weekResolutions = dates.map(resolveAt);
            if (complete && weekResolutions.some((result) => result.status !== 'resolved')) {
              issues.push({ code: 'JOURNEY_MANUAL_REVIEW', userId, date: end, blocking: true,
                message: `${person.name ?? 'Colaborador'}: não foi possível conferir a vigência da semana ${displayDate(start)} a ${displayDate(end)}.` });
              continue;
            }
            const granted = dates.filter((date) => dayOffDates.has(date) && !workedDates.has(date)).length;
            const required = distribution === 'weekly' ? 2 : 1;
            const weekWork = params.shifts.filter((shift) => shift.userId === userId && shift.type === 'work' && shift.date >= start && shift.date <= end);
            const durations = weekWork.map((shift) => {
              const definition = shift.shiftDefinitionId ? params.shiftDefinitions?.[shift.shiftDefinitionId] : undefined;
              if (!shift.startTime || !shift.endTime || !definition) return null;
              return shiftDurationSummary({ ...definition, startTime: shift.startTime, endTime: shift.endTime }).workedMinutes;
            });
            const workedMinutes = durations.some((duration) => duration === null)
              ? null : durations.reduce<number>((sum, duration) => sum + (duration ?? 0), 0);
            weeks.push({ start, end, required, granted, complete, workedMinutes });
            if (complete && weekWork.length && workedMinutes === null) issues.push({ code: 'WEEKLY_WORKLOAD_UNVERIFIED', userId, date: end,
              journeyId: journey.id, blocking: false,
              message: `${person.name ?? 'Colaborador'}: não foi possível conferir a carga de todos os turnos da semana ${displayDate(start)} a ${displayDate(end)}.` });
            if (distribution === 'weekly' && complete && granted < required) issues.push({ code: 'WEEKLY_REST_MISSING', userId, date: end,
              journeyId: journey.id, blocking: true,
              message: `${person.name ?? 'Colaborador'}: semana ${displayDate(start)} a ${displayDate(end)} tem ${granted}/${required} repousos registrados.` });
            const weekLimits = weekResolutions.filter((result) => result.status === 'resolved').map((result) => result.journey.weeklyMinutes);
            const weeklyLimit = weekLimits.length ? Math.min(...weekLimits) : journey.weeklyMinutes;
            if (workedMinutes !== null && workedMinutes > weeklyLimit) issues.push({ code: 'WEEKLY_WORKLOAD_EXCEEDED', userId,
              date: end, journeyId: journey.id, blocking: true,
              message: `${person.name ?? 'Colaborador'}: semana ${displayDate(start)} a ${displayDate(end)} tem ${Math.floor(workedMinutes / 60)}h${String(workedMinutes % 60).padStart(2, '0')} de trabalho; a jornada prevê ${Math.floor(weeklyLimit / 60)}h${String(weeklyLimit % 60).padStart(2, '0')}.` });
          }
          const monthRequired = Math.ceil(daysInMonth * 2 / 7);
          const monthRestDates = [...dayOffDates].filter((date) => date >= params.periodStart && date <= params.periodEnd && !workedDates.has(date)).sort();
          const monthGranted = monthRestDates.length;
          const monthAvailable = Array.from({ length: daysInMonth }, (_, index) => format(addDays(parseISO(params.periodStart), index), 'yyyy-MM-dd'))
            .filter((date) => !workedDates.has(date) && !dayOffDates.has(date)).length;
          const lastRest = [...dayOffDates].filter((date) => date <= params.periodEnd && !workedDates.has(date)).sort().at(-1);
          const nextRestDueDate = distribution === 'monthly_collective' && lastRest
            ? format(addDays(parseISO(lastRest), 7), 'yyyy-MM-dd') : undefined;
          restSummary = { distribution, monthRequired, monthGranted, monthRestDates, monthAvailable, weeks,
            ...(nextRestDueDate ? { nextRestDueDate } : {}) };
          if (distribution === 'monthly_collective') {
            let lastReportedEnd = '';
            for (let cursor = parseISO(params.periodStart); format(cursor, 'yyyy-MM-dd') <= params.periodEnd; cursor = addDays(cursor, 1)) {
              const end = format(cursor, 'yyyy-MM-dd');
              const start = format(addDays(cursor, -6), 'yyyy-MM-dd');
              if (end <= lastReportedEnd) continue;
              const windowDates = Array.from({ length: 7 }, (_, index) => format(addDays(cursor, index - 6), 'yyyy-MM-dd'));
              if (windowDates.some((date) => resolveAt(date).status !== 'resolved')) {
                issues.push({ code: 'JOURNEY_MANUAL_REVIEW', userId, date: end, blocking: true,
                  message: `${person.name ?? 'Colaborador'}: não foi possível conferir a vigência de ${displayDate(start)} a ${displayDate(end)}.` });
                lastReportedEnd = format(addDays(cursor, 6), 'yyyy-MM-dd');
                continue;
              }
              const hasRest = windowDates
                .some((date) => dayOffDates.has(date) && !workedDates.has(date));
              if (!hasRest) {
                issues.push({ code: 'WEEKLY_REST_MISSING', userId, date: end, journeyId: journey.id, blocking: true,
                  message: `${person.name ?? 'Colaborador'}: não há repouso registrado de ${displayDate(start)} a ${displayDate(end)}.` });
                lastReportedEnd = format(addDays(cursor, 6), 'yyyy-MM-dd');
              }
            }
          }
          if (distribution === 'monthly_collective' && monthGranted < monthRequired) issues.push({ code: 'MONTHLY_REST_MISSING', userId,
            journeyId: journey.id, blocking: true,
            message: `${person.name ?? 'Colaborador'}: faltam ${monthRequired - monthGranted} repousos no mês (${monthGranted}/${monthRequired}).` });
          if (distribution === 'monthly_collective' && monthGranted < monthRequired && monthAvailable <= monthRequired - monthGranted) {
            const impossible = monthAvailable < monthRequired - monthGranted;
            issues.push({ code: 'MONTHLY_REST_CAPACITY', userId, journeyId: journey.id, blocking: impossible,
              message: impossible
                ? `${person.name ?? 'Colaborador'}: restam apenas ${monthAvailable} dias livres para ${monthRequired - monthGranted} repousos pendentes.`
                : `${person.name ?? 'Colaborador'}: os ${monthAvailable} dias livres restantes precisam ser repousos.` });
          }
          if (resolvedMonth.some(({ result }) => result.status === 'resolved' && result.journey.weeklyRest?.sundayCadenceWeeks)) {
            let consecutiveSundays = 0;
            for (let cursor = parseISO(params.historyFrom); format(cursor, 'yyyy-MM-dd') <= params.periodEnd; cursor = addDays(cursor, 1)) {
              if (cursor.getDay() !== 0) continue;
              const date = format(cursor, 'yyyy-MM-dd');
              const sundayJourney = resolveAt(date);
              const cadence = sundayJourney.status === 'resolved' ? sundayJourney.journey.weeklyRest?.sundayCadenceWeeks : undefined;
              consecutiveSundays = dayOffDates.has(date) && !workedDates.has(date) ? 0 : consecutiveSundays + 1;
              if (date >= params.periodStart && cadence && consecutiveSundays >= cadence) issues.push({ code: 'SUNDAY_REST_MISSING', userId,
                date, journeyId: journey.id, blocking: true,
                message: `${person.name ?? 'Colaborador'}: repouso dominical necessário em ${displayDate(date)}.` });
            }
          }
        }
      }
    }

    peopleResult[userId] = {
      status: personStatus,
      ...(primaryJourney ? { journey: primaryJourney } : {}),
      carryInConsecutiveDays,
      countsByDate,
      predictedDayOffDates: [...predicted].sort(),
      ...(restSummary ? { restSummary } : {}),
    };
  });

  const blocking = issues.some((issue) => issue.blocking);
  return {
    status: blocking ? 'blocked' : issues.length ? 'warning' : 'ok',
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
    historyFrom: params.historyFrom,
    version: params.version ?? 0,
    people: peopleResult,
    issues,
  };
}
