import { z } from 'zod';

import { resolveDPJourney, type DPJourneyResolutionCandidate, type DPJourneyResolutionTarget } from './dp-journey-resolution';
import { natashaTeamDirectoryReportSchema } from './natasha-team-directory';

const idSchema = z.string().trim().min(1).max(180);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const applicabilitySchema = z.object({
  scope: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('company') }).strict(),
    z.object({ kind: z.literal('unit_organization'), id: idSchema }).strict(),
    z.object({ kind: z.literal('unit_group'), id: idSchema }).strict(),
    z.object({ kind: z.literal('unit'), id: idSchema }).strict(),
  ]),
  jobRoleIds: z.array(idSchema).optional(),
  jobFunctionIds: z.array(idSchema).optional(),
  collaboratorIds: z.array(idSchema).optional(),
}).strict();

export const natashaJourneyDirectoryRequestSchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  unitIds: z.array(idSchema).min(1).max(5),
  employeeIds: z.array(idSchema).min(1).max(50),
}).strict().superRefine((input, context) => {
  if (new Set(input.unitIds).size !== input.unitIds.length) {
    context.addIssue({ code: 'custom', path: ['unitIds'], message: 'Unidade repetida.' });
  }
  if (new Set(input.employeeIds).size !== input.employeeIds.length) {
    context.addIssue({ code: 'custom', path: ['employeeIds'], message: 'Colaborador repetido.' });
  }
});

export const natashaJourneyCandidateSchema = z.object({
  id: idSchema,
  lineageId: idSchema,
  version: z.number().int().positive(),
  status: z.enum(['draft', 'published', 'archived']),
  name: z.string().trim().min(1).max(180),
  weeklyMinutes: z.number().int().positive(),
  cycleLengthDays: z.number().int().min(1).max(42),
  days: z.array(z.object({
    dayIndex: z.number().int().min(1).max(42),
    plannedMinutes: z.number().int().min(0),
    isRestDay: z.boolean(),
  }).strict()).min(1).max(42),
  regime: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('fixed') }).strict(),
    z.object({ mode: z.literal('flexible'), windowStart: z.string().optional(), windowEnd: z.string().optional() }).strict(),
  ]).optional(),
  weeklyRest: z.object({
    placement: z.enum(['fixed_cycle', 'schedule']),
    maxConsecutiveWorkDays: z.number().int().min(1).max(6),
    sundayCadenceWeeks: z.number().int().min(1).max(12).optional(),
  }).strict().optional(),
  scaleValidation: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('consecutive_days') }).strict(),
    z.object({ mode: z.literal('manual_review') }).strict(),
  ]).optional(),
  expectedBreakMinutes: z.number().int().min(0).max(480).optional(),
  useDefinedShiftWhenShorter: z.boolean().optional(),
  allowedShiftDefinitionIds: z.array(idSchema).max(100).optional(),
  applicability: applicabilitySchema,
  validFrom: dateSchema,
  validTo: dateSchema.optional(),
}).strict();

export const natashaJourneyPersonSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(180),
  jobRoleId: idSchema.optional(),
  jobFunctionIds: z.array(idSchema).max(20),
  unitId: idSchema.optional(),
  unitIds: z.array(idSchema).max(20).optional(),
  unitGroupId: idSchema.optional(),
  unitGroupIds: z.array(idSchema).max(20).optional(),
  unitOrganizationId: idSchema.optional(),
  unitOrganizationIds: z.array(idSchema).max(20).optional(),
}).strict();

export const natashaJourneyDirectorySourceSchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  unitIds: z.array(idSchema).min(1).max(5),
  team: natashaTeamDirectoryReportSchema,
  people: z.array(natashaJourneyPersonSchema).max(50),
  journeys: z.array(natashaJourneyCandidateSchema).max(100),
  sourceQueries: z.array(z.string().trim().min(1).max(300)).max(20),
}).strict();

const resolvedJourneySchema = z.object({
  journeyId: idSchema,
  lineageId: idSchema,
  version: z.number().int().positive(),
  name: z.string().trim().min(1).max(180),
  resolvedBy: z.enum(['collaborator', 'function', 'job_role', 'unit', 'unit_group', 'unit_organization', 'company']),
  weeklyMinutes: z.number().int().positive(),
  cycleLengthDays: z.number().int().min(1).max(42),
  days: z.array(z.object({
    dayIndex: z.number().int().min(1).max(42),
    plannedMinutes: z.number().int().min(0),
    isRestDay: z.boolean(),
  }).strict()).min(1).max(42),
  regime: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('fixed') }).strict(),
    z.object({ mode: z.literal('flexible'), windowStart: z.string().optional(), windowEnd: z.string().optional() }).strict(),
  ]),
  validFrom: dateSchema,
  weeklyRest: z.object({
    placement: z.enum(['fixed_cycle', 'schedule']),
    maxConsecutiveWorkDays: z.number().int().min(1).max(6),
    sundayCadenceWeeks: z.number().int().min(1).max(12).optional(),
  }).strict(),
  validationMode: z.enum(['consecutive_days', 'manual_review']),
  expectedBreakMinutes: z.number().int().min(0).max(480).optional(),
  useDefinedShiftWhenShorter: z.boolean().default(true),
  allowedShiftDefinitionIds: z.array(idSchema).max(100),
}).strict();

export const natashaJourneyDirectoryReportSchema = z.object({
  status: z.enum(['ready_for_proposal', 'incomplete']),
  scope: z.literal('published_journeys_resolved_by_employee_and_date'),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  unitIds: z.array(idSchema).min(1).max(5),
  people: z.array(z.object({
    employeeId: idSchema,
    employeeName: z.string().trim().min(1).max(180),
    assignments: z.array(z.object({
      from: dateSchema,
      through: dateSchema,
      journey: resolvedJourneySchema,
    }).strict()).max(31),
  }).strict()).max(50),
  issues: z.array(z.object({
    code: z.enum(['TEAM_INCOMPLETE', 'PERSON_SCOPE_MISSING', 'JOURNEY_NOT_FOUND', 'JOURNEY_AMBIGUOUS', 'JOURNEY_MANUAL_REVIEW']),
    employeeId: idSchema.optional(),
    date: dateSchema.optional(),
    candidateJourneyIds: z.array(idSchema).max(20).optional(),
  }).strict()),
  evidence: z.object({
    sourceQueries: z.array(z.string()),
    journeyDocuments: z.number().int().min(0).max(100),
    resolvedDays: z.number().int().min(0),
    requiresHumanJourneyPremise: z.literal(false),
  }).strict(),
}).strict();

export type NatashaJourneyDirectoryReport = z.infer<typeof natashaJourneyDirectoryReportSchema>;

function datesInPeriod(period: string) {
  const [year, month] = period.split('-').map(Number);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: days }, (_, index) => `${period}-${String(index + 1).padStart(2, '0')}`);
}

function summary(journey: DPJourneyResolutionCandidate, resolvedBy: z.infer<typeof resolvedJourneySchema>['resolvedBy']) {
  return {
    journeyId: journey.id,
    lineageId: journey.lineageId,
    version: journey.version,
    name: journey.name,
    resolvedBy,
    weeklyMinutes: journey.weeklyMinutes,
    cycleLengthDays: journey.cycleLengthDays,
    days: journey.days,
    regime: journey.regime ?? { mode: 'fixed' as const },
    validFrom: journey.validFrom,
    weeklyRest: journey.weeklyRest ?? { placement: 'fixed_cycle' as const, maxConsecutiveWorkDays: 6 },
    validationMode: journey.scaleValidation?.mode ?? 'consecutive_days' as const,
    ...(journey.expectedBreakMinutes !== undefined ? { expectedBreakMinutes: journey.expectedBreakMinutes } : {}),
    useDefinedShiftWhenShorter: journey.useDefinedShiftWhenShorter ?? true,
    allowedShiftDefinitionIds: journey.allowedShiftDefinitionIds ?? [],
  };
}

/** Resolve a fonte oficial de Jornadas para cada pessoa e data; não aceita premissa manual. */
export function prepareNatashaJourneyDirectory(
  raw: z.input<typeof natashaJourneyDirectorySourceSchema>,
): NatashaJourneyDirectoryReport {
  const source = natashaJourneyDirectorySourceSchema.parse(raw);
  const issues: NatashaJourneyDirectoryReport['issues'] = [];
  if (source.team.status !== 'ready_for_confirmation') issues.push({ code: 'TEAM_INCOMPLETE' });
  const peopleById = new Map(source.people.map((person) => [person.id, person]));
  const dates = datesInPeriod(source.period);
  const people: NatashaJourneyDirectoryReport['people'] = [];

  for (const employee of source.team.employees) {
    const person = peopleById.get(employee.id);
    if (!person) {
      issues.push({ code: 'PERSON_SCOPE_MISSING', employeeId: employee.id });
      continue;
    }
    const target: DPJourneyResolutionTarget = {
      collaboratorId: person.id,
      ...(person.jobRoleId ? { jobRoleId: person.jobRoleId } : {}),
      jobFunctionIds: person.jobFunctionIds,
      ...(person.unitId ? { unitId: person.unitId } : {}),
      unitIds: person.unitIds ?? [],
      ...(person.unitGroupId ? { unitGroupId: person.unitGroupId } : {}),
      unitGroupIds: person.unitGroupIds ?? [],
      ...(person.unitOrganizationId ? { unitOrganizationId: person.unitOrganizationId } : {}),
      unitOrganizationIds: person.unitOrganizationIds ?? [],
    };
    const resolvedDays: Array<{ date: string; journey: z.infer<typeof resolvedJourneySchema> }> = [];
    for (const date of dates) {
      const resolution = resolveDPJourney({ journeys: source.journeys, target, date });
      if (resolution.status === 'none') {
        issues.push({ code: 'JOURNEY_NOT_FOUND', employeeId: employee.id, date });
        continue;
      }
      if (resolution.status === 'ambiguous') {
        issues.push({ code: 'JOURNEY_AMBIGUOUS', employeeId: employee.id, date,
          candidateJourneyIds: resolution.candidates.map((journey) => journey.id) });
        continue;
      }
      const journey = summary(resolution.journey, resolution.resolvedBy);
      if (journey.validationMode === 'manual_review') {
        issues.push({ code: 'JOURNEY_MANUAL_REVIEW', employeeId: employee.id, date,
          candidateJourneyIds: [journey.journeyId] });
      }
      resolvedDays.push({ date, journey });
    }
    const assignments: NatashaJourneyDirectoryReport['people'][number]['assignments'] = [];
    for (const day of resolvedDays) {
      const previous = assignments.at(-1);
      if (previous && previous.through === dates[dates.indexOf(day.date) - 1]
        && JSON.stringify(previous.journey) === JSON.stringify(day.journey)) {
        previous.through = day.date;
      } else {
        assignments.push({ from: day.date, through: day.date, journey: day.journey });
      }
    }
    people.push({ employeeId: employee.id, employeeName: employee.name, assignments });
  }

  const report: NatashaJourneyDirectoryReport = {
    status: issues.length === 0 && people.length === source.team.employees.length
      && people.reduce((sum, person) => sum + person.assignments.reduce((count, assignment) => {
        const from = Date.parse(`${assignment.from}T00:00:00.000Z`);
        const through = Date.parse(`${assignment.through}T00:00:00.000Z`);
        return count + Math.floor((through - from) / 86_400_000) + 1;
      }, 0), 0) === source.team.employees.length * dates.length
      ? 'ready_for_proposal' : 'incomplete',
    scope: 'published_journeys_resolved_by_employee_and_date',
    period: source.period,
    unitIds: source.unitIds,
    people,
    issues,
    evidence: {
      sourceQueries: source.sourceQueries,
      journeyDocuments: source.journeys.length,
      resolvedDays: resolvedDaysCount(people),
      requiresHumanJourneyPremise: false,
    },
  };
  return natashaJourneyDirectoryReportSchema.parse(report);
}

function resolvedDaysCount(people: NatashaJourneyDirectoryReport['people']) {
  return people.reduce((sum, person) => sum + person.assignments.reduce((count, assignment) => {
    const from = Date.parse(`${assignment.from}T00:00:00.000Z`);
    const through = Date.parse(`${assignment.through}T00:00:00.000Z`);
    return count + Math.floor((through - from) / 86_400_000) + 1;
  }, 0), 0);
}
