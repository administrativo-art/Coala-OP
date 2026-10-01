import { z } from 'zod';

import { natashaCoveragePlanSchema, validateNatashaCoverage, type NatashaCoveragePlan } from './natasha-roster-coverage';
import { natashaRosterSnapshotSchema, type NatashaRosterSnapshot } from './natasha-roster-validator';

const idSchema = z.string().trim().min(1).max(180);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Data inválida.');
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const slotSchema = z.enum(['opening', 'closing', 'intermediate', 'single']);

export const natashaPositionSchema = z.object({
  id: idSchema,
  unitId: idSchema,
  date: dateSchema,
  startTime: timeSchema,
  endTime: timeSchema,
  slot: slotSchema,
  requiredRoleId: idSchema.nullable(),
}).strict().refine((position) => position.endTime > position.startTime, {
  path: ['endTime'], message: 'O turno precisa terminar depois de começar.',
});

export const natashaProposalInputsSchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  employees: z.array(z.object({
    id: idSchema,
    active: z.boolean(),
    allowedUnitIds: z.array(idSchema).max(5),
    roleIds: z.array(idSchema).max(20),
  }).strict()).max(50),
  positions: z.array(natashaPositionSchema).max(500),
  nextMonthKnownShifts: z.array(z.object({
    employeeId: idSchema,
    unitId: idSchema,
    date: dateSchema,
    startTime: timeSchema,
    endTime: timeSchema,
  }).strict().refine((shift) => shift.endTime > shift.startTime, {
    path: ['endTime'], message: 'O turno precisa terminar depois de começar.',
  })).max(100),
  confirmed: z.object({
    team: z.boolean(),
    rolesAndUnitLinks: z.boolean(),
    shiftPositions: z.boolean(),
    vacations: z.boolean(),
    unavailabilities: z.boolean(),
    fixedAssignments: z.boolean(),
    nextMonthCommitments: z.boolean(),
  }).strict(),
}).strict().superRefine((input, context) => {
  const employeeIds = input.employees.map((item) => item.id);
  if (new Set(employeeIds).size !== employeeIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['employees'], message: 'Pessoa repetida.' });
  }
  const positionIds = input.positions.map((item) => item.id);
  if (new Set(positionIds).size !== positionIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['positions'], message: 'Posição repetida.' });
  }
});

export type NatashaProposalInputs = z.infer<typeof natashaProposalInputsSchema>;
export type NatashaPreflightIssue = {
  code: string;
  category: 'question' | 'data' | 'feasibility';
  detail: string;
  date?: string;
  unitId?: string;
  positionId?: string;
  employeeId?: string;
};
export type NatashaPreflightReport = {
  period: string;
  status: 'ready_for_solver' | 'questions_pending' | 'infeasible';
  scope: 'input_readiness_only';
  positions: number;
  activeEmployees: number;
  issues: NatashaPreflightIssue[];
};

const confirmationQuestions: Record<keyof NatashaProposalInputs['confirmed'], string> = {
  team: 'Confirme a equipe candidata ativa para a competência.',
  rolesAndUnitLinks: 'Confirme funções e unidades em que cada pessoa pode trabalhar.',
  shiftPositions: 'Confirme todas as posições de turno, horários e reforços por dia/unidade.',
  vacations: 'Confirme as férias de gozo aprovadas de toda a equipe candidata.',
  unavailabilities: 'Confirme indisponibilidades e folgas conhecidas, inclusive fora do sistema.',
  fixedAssignments: 'Confirme as datas fixas desta competência, inclusive se não houver nenhuma.',
  nextMonthCommitments: 'Confirme os compromissos já conhecidos do mês seguinte para verificar a continuidade.',
};

function addDays(value: string, days: number): string {
  return new Date(Date.parse(`${value}T00:00:00.000Z`) + days * 86400000).toISOString().slice(0, 10);
}

function nextPeriod(period: string): string {
  return addDays(`${period}-01`, new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).getUTCDate()).slice(0, 7);
}

function fridayDates(period: string): string[] {
  const count = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).getUTCDate();
  return Array.from({ length: count }, (_, index) => `${period}-${String(index + 1).padStart(2, '0')}`)
    .filter((date) => new Date(`${date}T00:00:00.000Z`).getUTCDay() === 5);
}

/** Pré-voo de dados para o calculador futuro; não atribui pessoas nem gera escala. */
export function assessNatashaProposalInputs(
  snapshot: NatashaRosterSnapshot,
  coveragePlan: NatashaCoveragePlan,
  inputs: NatashaProposalInputs,
): NatashaPreflightReport {
  natashaRosterSnapshotSchema.parse(snapshot);
  natashaCoveragePlanSchema.parse(coveragePlan);
  natashaProposalInputsSchema.parse(inputs);
  const issues: NatashaPreflightIssue[] = [];
  const add = (issue: NatashaPreflightIssue) => { issues.push(issue); };
  const first = `${inputs.period}-01`;
  const previous = addDays(first, -1);
  const expectedUnits = new Set(coveragePlan.expectedUnitIds);
  const employees = new Map(inputs.employees.map((person) => [person.id, person]));

  if (snapshot.period !== inputs.period || coveragePlan.period !== inputs.period) {
    add({ code: 'PERIOD_MISMATCH', category: 'data', detail: 'Snapshot, demanda e entradas devem ter a mesma competência.' });
  }
  if (snapshot.shifts.some((shift) => shift.date.startsWith(`${inputs.period}-`))) {
    add({ code: 'TARGET_SHIFTS_PRESENT', category: 'data', detail: 'O pré-voo para montar escala aceita histórico, não turnos já lançados no mês alvo.' });
  }
  if (!snapshot.history?.complete || snapshot.history.from > addDays(first, -14) || snapshot.history.through !== previous) {
    add({ code: 'HISTORY_INCOMPLETE', category: 'question', detail: 'Confirme os 14 dias anteriores em todas as unidades, inclusive dias sem turno.' });
  }
  if (!coveragePlan.scopeConfirmed) {
    add({ code: 'COVERAGE_SCOPE_UNCONFIRMED', category: 'question', detail: 'Confirme que todas as unidades e dias do mês estão na demanda.' });
  }
  for (const [key, detail] of Object.entries(confirmationQuestions) as Array<[keyof NatashaProposalInputs['confirmed'], string]>) {
    if (!inputs.confirmed[key]) add({ code: `CONFIRM_${key.toUpperCase()}`, category: 'question', detail });
  }
  if (snapshot.fridayMatrix === null) {
    add({ code: 'FRIDAY_MATRIX_POLICY', category: 'question', detail: 'A sexta na matriz vincula Heucilene nominalmente ou a pessoa que ocupa a função de líder? Confirme pessoa e unidade.' });
  }
  if (inputs.employees.filter((person) => person.active).length === 0) {
    add({ code: 'NO_ACTIVE_EMPLOYEES', category: 'question', detail: 'Informe ao menos uma pessoa ativa para a equipe candidata.' });
  }
  if (inputs.positions.length === 0) {
    add({ code: 'NO_POSITIONS', category: 'question', detail: 'Informe as posições de turno que precisam ser preenchidas.' });
  }

  const eligibility = (position: NatashaProposalInputs['positions'][number], employeeId: string) => {
    const employee = employees.get(employeeId);
    return Boolean(employee?.active && employee.allowedUnitIds.includes(position.unitId)
      && (position.requiredRoleId === null || employee.roleIds.includes(position.requiredRoleId))
      && !snapshot.vacations.some((vacation) => vacation.employeeId === employeeId && vacation.status === 'approved'
        && vacation.recordType === 'gozo' && position.date >= vacation.startDate && position.date <= vacation.endDate)
      && !snapshot.unavailabilities.some((range) => range.employeeId === employeeId
        && position.date >= range.startDate && position.date <= range.endDate)
      && !snapshot.dayOffs.some((dayOff) => dayOff.employeeId === employeeId && dayOff.date === position.date));
  };

  for (const position of inputs.positions) {
    if (!position.date.startsWith(`${inputs.period}-`) || !expectedUnits.has(position.unitId)) {
      add({ code: 'POSITION_OUTSIDE_SCOPE', category: 'data', detail: 'Posição fora da competência ou das unidades declaradas.',
        positionId: position.id, date: position.date, unitId: position.unitId });
      continue;
    }
    if (!inputs.employees.some((person) => eligibility(position, person.id))) {
      add({ code: 'POSITION_WITHOUT_CANDIDATE', category: 'feasibility', detail: 'Nenhuma pessoa ativa e disponível pode ocupar esta posição.',
        positionId: position.id, date: position.date, unitId: position.unitId });
    }
  }

  for (const fixed of snapshot.fixedAssignments) {
    if (!inputs.positions.some((position) => position.unitId === fixed.unitId && position.date === fixed.date
      && eligibility(position, fixed.employeeId))) {
      add({ code: 'FIXED_ASSIGNMENT_WITHOUT_POSITION', category: 'feasibility', detail: 'Não há posição elegível para a data fixa.',
        employeeId: fixed.employeeId, unitId: fixed.unitId, date: fixed.date });
    }
  }
  if (snapshot.fridayMatrix) {
    for (const date of fridayDates(inputs.period)) {
      if (!inputs.positions.some((position) => position.unitId === snapshot.fridayMatrix?.unitId
        && position.date === date && eligibility(position, snapshot.fridayMatrix.employeeId))) {
        add({ code: 'FRIDAY_MATRIX_WITHOUT_POSITION', category: 'feasibility', detail: 'Não há posição elegível na matriz para a pessoa confirmada nesta sexta.',
          employeeId: snapshot.fridayMatrix.employeeId, unitId: snapshot.fridayMatrix.unitId, date });
      }
    }
  }

  const firstNext = `${nextPeriod(inputs.period)}-01`;
  const lastKnownDay = addDays(firstNext, 13);
  for (const shift of inputs.nextMonthKnownShifts) {
    if (shift.date < firstNext || shift.date > lastKnownDay) {
      add({ code: 'NEXT_MONTH_SHIFT_OUTSIDE_WINDOW', category: 'data', detail: 'Compromisso seguinte fora dos primeiros 14 dias do mês posterior.',
        employeeId: shift.employeeId, unitId: shift.unitId, date: shift.date });
    }
  }

  const capacitySnapshot: NatashaRosterSnapshot = {
    ...snapshot,
    shifts: [
      ...snapshot.shifts.filter((shift) => shift.date < first),
      ...inputs.positions.filter((position) => position.date.startsWith(`${inputs.period}-`)).map((position) => ({
        id: `position:${position.id}`, employeeId: `position:${position.id}`,
        unitId: position.unitId, date: position.date, startTime: position.startTime,
        endTime: position.endTime, slot: position.slot,
      })),
    ],
  };
  const coverage = validateNatashaCoverage(capacitySnapshot, coveragePlan);
  for (const gap of coverage.issues) {
    if (gap.code === 'COVERAGE_GAP') {
      add({ code: 'POSITIONS_DO_NOT_COVER_DEMAND', category: 'feasibility',
        detail: `Faltam posições de ${gap.startTime} a ${gap.endTime}: ${gap.scheduledPeople}/${gap.requiredPeople} pessoas.`,
        date: gap.date, unitId: gap.unitId });
    } else if (gap.category === 'data' && gap.code !== 'SCOPE_UNCONFIRMED') {
      add({ code: `COVERAGE_${gap.code}`, category: 'data', detail: 'Corrija a abrangência ou o calendário da demanda.',
        date: gap.date, unitId: gap.unitId });
    }
  }
  const hasQuestionOrData = issues.some((issue) => issue.category !== 'feasibility');
  return {
    period: inputs.period,
    status: hasQuestionOrData ? 'questions_pending' : issues.length > 0 ? 'infeasible' : 'ready_for_solver',
    scope: 'input_readiness_only',
    positions: inputs.positions.length,
    activeEmployees: inputs.employees.filter((person) => person.active).length,
    issues,
  };
}
