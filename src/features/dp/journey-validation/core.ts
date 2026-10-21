import { addDays, format, parseISO } from 'date-fns';

import { resolveDPJourney, type DPJourneyResolutionTarget, type DPJourneyResolvedBy } from '@/lib/dp-journey-resolution';
import { shiftJourneyComparisons } from '@/lib/dp-shift-duration';
import { isShiftDefinitionCompatibleWithJourney } from '@/lib/dp-time-config-rules';
import type { DPJourney } from '@/types';

export type DPJourneyValidationShift = {
  id: string;
  userId: string;
  date: string;
  type: 'work' | 'day_off';
  unitId: string;
  shiftDefinitionId?: string;
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
  }>;
  issues: DPJourneyValidationIssue[];
};

function previousDate(date: string) {
  return format(addDays(parseISO(date), -1), 'yyyy-MM-dd');
}

function nextDate(date: string) {
  return format(addDays(parseISO(date), 1), 'yyyy-MM-dd');
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
  const currentShiftsByUser = new Map<string, DPJourneyValidationShift[]>();

  params.shifts.forEach((shift) => {
    if (shift.type === 'work') {
      const workedDates = workDatesByUser.get(shift.userId) ?? new Set<string>();
      workedDates.add(shift.date);
      workDatesByUser.set(shift.userId, workedDates);
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
    const currentWorkDates = [...new Set(currentShifts.filter((shift) => shift.type === 'work').map((shift) => shift.date))].sort();
    const countsByDate: Record<string, number> = {};
    const predicted = new Set<string>();
    let personStatus: DPJourneyValidationResult['people'][string]['status'] = 'resolved';
    let primaryJourney: DPJourneyValidationResult['people'][string]['journey'];
    let carryInConsecutiveDays = 0;

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
        issues.push({ code: 'JOURNEY_NOT_FOUND', userId, date, blocking: true, message: `Nenhuma jornada vigente se aplica em ${date}.` });
        return;
      }
      if (resolution.status === 'ambiguous') {
        personStatus = 'ambiguous';
        issues.push({ code: 'JOURNEY_AMBIGUOUS', userId, date, blocking: true, message: `Mais de uma jornada com a mesma prioridade se aplica em ${date}.` });
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
              message: `O turno de ${date} não está permitido na jornada ${journey.name}.`,
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
              message: `O turno de ${date} termina antes do expediente esperado e a jornada ${journey.name} não autoriza usar o expediente definido.`,
            });
          }
        });
    });

    peopleResult[userId] = {
      status: personStatus,
      ...(primaryJourney ? { journey: primaryJourney } : {}),
      carryInConsecutiveDays,
      countsByDate,
      predictedDayOffDates: [...predicted].sort(),
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
