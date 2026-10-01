import { z } from 'zod';

const DAY_MS = 24 * 60 * 60 * 1000;
const MINIMUM_REST_MINUTES = 11 * 60;

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const dateSchema = z.string().refine(isDate, 'Data inválida; use AAAA-MM-DD.');
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inválido; use HH:MM.');
const idSchema = z.string().trim().min(1).max(180);

const workShiftSchema = z.object({
  id: idSchema,
  employeeId: idSchema,
  unitId: idSchema,
  date: dateSchema,
  startTime: timeSchema,
  endTime: timeSchema,
  slot: z.enum(['opening', 'closing', 'intermediate', 'single']).optional(),
}).strict().refine((shift) => shift.endTime > shift.startTime, {
  path: ['endTime'],
  message: 'O fim do turno precisa ser posterior ao início.',
});

const dateRangeFields = {
  employeeId: idSchema,
  startDate: dateSchema,
  endDate: dateSchema,
};

const dateRangeSchema = z.object(dateRangeFields).strict().refine((range) => range.endDate >= range.startDate, {
  path: ['endDate'],
  message: 'O fim precisa ser igual ou posterior ao início.',
});

const vacationSchema = z.object({
  ...dateRangeFields,
  recordType: z.enum(['gozo', 'other']),
  status: z.enum(['approved', 'pending', 'rejected']),
}).strict().refine((range) => range.endDate >= range.startDate, {
  path: ['endDate'],
  message: 'O fim precisa ser igual ou posterior ao início.',
});

export const natashaRosterSnapshotSchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Competência inválida; use AAAA-MM.'),
  history: z.object({
    from: dateSchema,
    through: dateSchema,
    complete: z.boolean(),
  }).strict().nullable(),
  shifts: z.array(workShiftSchema).max(5000),
  dayOffs: z.array(z.object({ employeeId: idSchema, date: dateSchema }).strict()).max(5000),
  vacations: z.array(vacationSchema).max(2000),
  unavailabilities: z.array(dateRangeSchema).max(2000),
  fixedAssignments: z.array(z.object({
    employeeId: idSchema,
    unitId: idSchema,
    date: dateSchema,
  }).strict()).max(1000),
  fridayMatrix: z.object({
    employeeId: idSchema,
    unitId: idSchema,
    basis: z.enum(['named_person', 'role_holder']),
  }).strict().nullable(),
}).strict().superRefine((snapshot, context) => {
  const seenIds = new Set<string>();
  snapshot.shifts.forEach((shift, index) => {
    if (seenIds.has(shift.id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['shifts', index, 'id'], message: 'ID de turno duplicado.' });
    }
    seenIds.add(shift.id);
  });
});

export type NatashaRosterSnapshot = z.infer<typeof natashaRosterSnapshotSchema>;
export type NatashaIssueCategory = 'rule' | 'condition' | 'preference' | 'data';
export type NatashaIssue = {
  code: string;
  category: NatashaIssueCategory;
  date?: string;
  employeeId?: string;
  shiftIds?: string[];
  detail: string;
};

export type NatashaRosterReport = {
  period: string;
  status: 'violations' | 'incomplete' | 'checked';
  scope: 'rules_and_monthly_conditions_without_coverage';
  issues: NatashaIssue[];
  carryover: Array<{
    employeeId: string;
    endingWorkdayStreak: number;
    endingSundayStreak: number;
  }>;
};

function utcDate(value: string): number {
  return Date.parse(`${value}T00:00:00.000Z`);
}

function isoDate(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string {
  return isoDate(utcDate(value) + days * DAY_MS);
}

function monthBounds(period: string): { first: string; last: string; previous: string } {
  const first = `${period}-01`;
  const nextMonth = new Date(utcDate(first));
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const nextFirst = isoDate(nextMonth.getTime());
  return { first, last: addDays(nextFirst, -1), previous: addDays(first, -1) };
}

function weekday(value: string): number {
  return new Date(utcDate(value)).getUTCDay();
}

function minutesAt(shift: NatashaRosterSnapshot['shifts'][number], edge: 'start' | 'end'): number {
  const time = edge === 'start' ? shift.startTime : shift.endTime;
  const [hours, minutes] = time.split(':').map(Number);
  return utcDate(shift.date) / 60000 + hours * 60 + minutes;
}

function isInRange(date: string, range: { startDate: string; endDate: string }): boolean {
  return date >= range.startDate && date <= range.endDate;
}

/**
 * Conferência pura e somente de leitura. `checked` não significa escala completa:
 * demanda de cobertura, turnos vinculados e preferências de distribuição ainda
 * precisam de um contrato/calculador próprios.
 */
export function validateNatashaRoster(snapshot: NatashaRosterSnapshot): NatashaRosterReport {
  const { first, last, previous } = monthBounds(snapshot.period);
  const issues: NatashaIssue[] = [];
  const add = (issue: NatashaIssue) => { issues.push(issue); };

  const historyReady = snapshot.history !== null
    && snapshot.history.complete
    && snapshot.history.from <= addDays(first, -14)
    && snapshot.history.through === previous;
  if (!historyReady) {
    add({
      code: 'HISTORY_INCOMPLETE', category: 'data',
      detail: `Confirme todos os turnos de ${addDays(first, -14)} até ${previous}, em todas as unidades; ausência de lançamento não prova folga.`,
    });
  }
  if (snapshot.fridayMatrix === null) {
    add({
      code: 'FRIDAY_MATRIX_POLICY_UNCONFIRMED', category: 'data',
      detail: 'Pergunte se a sexta na matriz é exigência nominal da Heucilene ou de quem ocupa a função de líder; informe pessoa e unidade do mês.',
    });
  }

  const declaredLowerBound = snapshot.history?.from ?? first;
  // Dois domingos anteriores cabem em duas semanas; não varrer anos de
  // calendário ao calcular a sequência dominical.
  const lowerBound = declaredLowerBound > addDays(first, -14) ? declaredLowerBound : addDays(first, -14);
  const shifts = snapshot.shifts.filter((shift) => {
    if (shift.date > last || shift.date < declaredLowerBound) {
      add({
        code: 'SHIFT_OUTSIDE_SNAPSHOT', category: 'data', date: shift.date,
        employeeId: shift.employeeId, shiftIds: [shift.id],
        detail: 'Turno fora do intervalo declarado para histórico e competência; não foi conferido.',
      });
      return false;
    }
    return true;
  });

  const byEmployee = new Map<string, typeof shifts>();
  for (const shift of shifts) {
    const employeeShifts = byEmployee.get(shift.employeeId) ?? [];
    employeeShifts.push(shift);
    byEmployee.set(shift.employeeId, employeeShifts);

    if (shift.date < first) continue;
    const vacation = snapshot.vacations.find((item) => item.employeeId === shift.employeeId
      && item.recordType === 'gozo' && item.status === 'approved' && isInRange(shift.date, item));
    if (vacation) {
      add({ code: 'APPROVED_VACATION', category: 'rule', date: shift.date,
        employeeId: shift.employeeId, shiftIds: [shift.id],
        detail: `Turno durante gozo aprovado (${vacation.startDate} a ${vacation.endDate}).` });
    }
    const unavailable = snapshot.unavailabilities.find((item) => item.employeeId === shift.employeeId && isInRange(shift.date, item));
    if (unavailable) {
      add({ code: 'UNAVAILABLE', category: 'rule', date: shift.date,
        employeeId: shift.employeeId, shiftIds: [shift.id], detail: 'Turno durante indisponibilidade informada.' });
    }
    if (snapshot.dayOffs.some((item) => item.employeeId === shift.employeeId && item.date === shift.date)) {
      add({ code: 'WORK_ON_DAY_OFF', category: 'rule', date: shift.date,
        employeeId: shift.employeeId, shiftIds: [shift.id], detail: 'Turno e folga lançados para a mesma pessoa e data.' });
    }
  }

  for (const [employeeId, employeeShifts] of byEmployee) {
    employeeShifts.sort((a, b) => minutesAt(a, 'start') - minutesAt(b, 'start') || a.id.localeCompare(b.id));
    for (let index = 1; index < employeeShifts.length; index += 1) {
      const prior = employeeShifts[index - 1];
      const current = employeeShifts[index];
      if (current.date < first) continue;
      const interval = minutesAt(current, 'start') - minutesAt(prior, 'end');
      if (interval < 0) {
        add({ code: 'OVERLAPPING_SHIFTS', category: 'rule', date: current.date,
          employeeId, shiftIds: [prior.id, current.id], detail: 'Turnos com horários sobrepostos, inclusive entre unidades.' });
      } else if (interval < MINIMUM_REST_MINUTES) {
        add({ code: 'REST_UNDER_11_HOURS', category: 'rule', date: current.date,
          employeeId, shiftIds: [prior.id, current.id],
          detail: `Intervalo entre jornadas de ${Math.floor(interval / 60)}h${String(interval % 60).padStart(2, '0')}; mínimo de 11h.` });
      }
      if (utcDate(current.date) - utcDate(prior.date) === DAY_MS) {
        if (prior.slot === 'closing' && current.slot === 'opening') {
          add({ code: 'OPENING_AFTER_CLOSING', category: 'preference', date: current.date,
            employeeId, shiftIds: [prior.id, current.id],
            detail: 'Abertura após fechamento no dia anterior; justificar se inevitável.' });
        } else if (!prior.slot || !current.slot) {
          add({ code: 'SLOT_CLASSIFICATION_MISSING', category: 'data', date: current.date,
            employeeId, shiftIds: [prior.id, current.id],
            detail: 'Não foi possível conferir abertura após fechamento: classificação do turno ausente.' });
        }
      }
    }

    const workedDates = [...new Set(employeeShifts.map((shift) => shift.date))].sort();
    let streak = 0;
    let lastWorkedDate: string | null = null;
    for (const date of workedDates) {
      streak = lastWorkedDate !== null && utcDate(date) - utcDate(lastWorkedDate) === DAY_MS ? streak + 1 : 1;
      if (date >= first && streak > 6) {
        add({ code: 'SEVENTH_CONSECUTIVE_DAY', category: 'rule', date, employeeId,
          detail: `${streak} dias consecutivos de trabalho; máximo de seis.` });
      }
      lastWorkedDate = date;
    }

    const workedSet = new Set(workedDates);
    let sundayStreak = 0;
    for (let cursor = lowerBound; cursor <= last; cursor = addDays(cursor, 1)) {
      if (weekday(cursor) !== 0) continue;
      sundayStreak = workedSet.has(cursor) ? sundayStreak + 1 : 0;
      if (cursor >= first && sundayStreak > 2) {
        add({ code: 'THIRD_CONSECUTIVE_SUNDAY', category: 'rule', date: cursor, employeeId,
          detail: `${sundayStreak} domingos consecutivos de trabalho; o terceiro deve ser de descanso.` });
      }
    }
  }

  for (const fixed of snapshot.fixedAssignments) {
    if (fixed.date < first || fixed.date > last) {
      add({ code: 'FIXED_DATE_OUTSIDE_PERIOD', category: 'data', date: fixed.date, employeeId: fixed.employeeId,
        detail: 'A condição mensal está fora da competência.' });
      continue;
    }
    if (!shifts.some((shift) => shift.employeeId === fixed.employeeId && shift.unitId === fixed.unitId && shift.date === fixed.date)) {
      add({ code: 'FIXED_ASSIGNMENT_MISSING', category: 'condition', date: fixed.date, employeeId: fixed.employeeId,
        detail: `A data fixa do mês não foi atendida na unidade ${fixed.unitId}.` });
    }
  }

  if (snapshot.fridayMatrix !== null) {
    for (let cursor = first; cursor <= last; cursor = addDays(cursor, 1)) {
      if (weekday(cursor) !== 5) continue;
      if (!shifts.some((shift) => shift.employeeId === snapshot.fridayMatrix?.employeeId
        && shift.unitId === snapshot.fridayMatrix?.unitId && shift.date === cursor)) {
        add({ code: 'FRIDAY_MATRIX_MISSING', category: 'rule', date: cursor,
          employeeId: snapshot.fridayMatrix.employeeId,
          detail: `A pessoa confirmada para as sextas não está escalada na matriz (${snapshot.fridayMatrix.unitId}).` });
      }
    }
  }

  const employeeIds = new Set([
    ...byEmployee.keys(),
    ...snapshot.dayOffs.map((item) => item.employeeId),
    ...snapshot.fixedAssignments.map((item) => item.employeeId),
    ...(snapshot.fridayMatrix ? [snapshot.fridayMatrix.employeeId] : []),
  ]);
  const carryover = [...employeeIds].sort().map((employeeId) => {
    const worked = new Set(byEmployee.get(employeeId)?.map((shift) => shift.date) ?? []);
    let endingWorkdayStreak = 0;
    for (let cursor = last; worked.has(cursor); cursor = addDays(cursor, -1)) endingWorkdayStreak += 1;
    let lastSunday = last;
    while (weekday(lastSunday) !== 0) lastSunday = addDays(lastSunday, -1);
    let endingSundayStreak = 0;
    for (let cursor = lastSunday; worked.has(cursor); cursor = addDays(cursor, -7)) endingSundayStreak += 1;
    return { employeeId, endingWorkdayStreak, endingSundayStreak };
  });

  const order: Record<NatashaIssueCategory, number> = { rule: 0, condition: 1, data: 2, preference: 3 };
  issues.sort((a, b) => order[a.category] - order[b.category]
    || (a.date ?? '').localeCompare(b.date ?? '')
    || (a.employeeId ?? '').localeCompare(b.employeeId ?? '')
    || a.code.localeCompare(b.code));
  const hasViolations = issues.some((issue) => issue.category === 'rule' || issue.category === 'condition');
  const hasDataGaps = issues.some((issue) => issue.category === 'data');
  return {
    period: snapshot.period,
    status: hasViolations ? 'violations' : hasDataGaps ? 'incomplete' : 'checked',
    scope: 'rules_and_monthly_conditions_without_coverage',
    issues,
    carryover,
  };
}
