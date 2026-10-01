import { z } from 'zod';

import { natashaTeamDirectoryReportSchema } from './natasha-team-directory';

const idSchema = z.string().trim().min(1).max(180);
const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Data inválida.');

export const natashaAvailabilityRequestSchema = z.object({
  period: periodSchema,
  unitIds: z.array(idSchema).min(1).max(5),
}).strict().superRefine((input, context) => {
  if (new Set(input.unitIds).size !== input.unitIds.length) {
    context.addIssue({ code: 'custom', path: ['unitIds'], message: 'Unidade repetida.' });
  }
});

const rawVacationSchema = z.object({
  id: idSchema,
  userId: idSchema,
  startDate: dateSchema,
  endDate: dateSchema,
  recordType: z.enum(['gozo', 'venda']),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'PLANNED']),
}).passthrough().refine((vacation) => vacation.endDate >= vacation.startDate, {
  path: ['endDate'], message: 'O fim das férias deve ser posterior ao início.',
});

export const natashaAvailabilitySourceSchema = z.object({
  period: periodSchema,
  team: natashaTeamDirectoryReportSchema,
  vacationDocuments: z.array(z.record(z.string(), z.unknown())).max(300),
  sourceQuery: z.string().trim().min(1).max(300),
}).strict();

const availabilityVacationSchema = z.object({
  id: idSchema,
  employeeId: idSchema,
  employeeName: z.string().trim().min(1).max(180),
  startDate: dateSchema,
  endDate: dateSchema,
  recordType: z.literal('gozo'),
  status: z.enum(['approved', 'pending', 'planned']),
}).strict();

export const natashaAvailabilityReportSchema = z.object({
  status: z.enum(['ready_for_confirmation', 'questions_pending', 'incomplete']),
  scope: z.literal('candidate_vacations_and_external_unavailability_prompt'),
  period: periodSchema,
  window: z.object({
    from: dateSchema,
    through: dateSchema,
    queryEnd: dateSchema,
  }).strict(),
  candidates: z.array(z.object({ id: idSchema, name: z.string().trim().min(1).max(180) }).strict()).max(50),
  approvedVacations: z.array(availabilityVacationSchema.extend({ status: z.literal('approved') })).max(300),
  unresolvedVacations: z.array(availabilityVacationSchema.extend({ status: z.enum(['pending', 'planned']) })).max(300),
  issues: z.array(z.object({
    code: z.enum(['TEAM_SOURCE_INCOMPLETE', 'MALFORMED_VACATION', 'UNRESOLVED_VACATION']),
    vacationId: idSchema.optional(),
    employeeId: idSchema.optional(),
  }).strict()),
  evidence: z.object({
    sourceQuery: z.string(),
    candidateDocumentsExamined: z.number().int().min(0),
    outsideCandidateDocumentsOmitted: z.literal(true),
    ignoredSalesOrRejected: z.number().int().min(0),
    requiresHumanConfirmation: z.literal(true),
    externalUnavailabilitiesIncluded: z.literal(false),
    dayOffsIncluded: z.literal(false),
  }).strict(),
}).strict();

export type NatashaAvailabilityReport = z.infer<typeof natashaAvailabilityReportSchema>;

function addDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function natashaAvailabilityWindow(period: string) {
  periodSchema.parse(period);
  const firstNextMonth = new Date(`${period}-01T00:00:00.000Z`);
  firstNextMonth.setUTCMonth(firstNextMonth.getUTCMonth() + 1);
  const nextStart = firstNextMonth.toISOString().slice(0, 10);
  const through = addDays(nextStart, 13);
  return {
    from: `${period}-01`,
    through,
    // O cadastro aceita no máximo 30 dias de gozo. A margem captura um período
    // iniciado no último dia da janela sem consultar férias futuras sem limite.
    queryEnd: addDays(through, 29),
  };
}

/**
 * Prepara férias de toda a equipe candidata. A confirmação de indisponibilidades
 * externas e folgas continua explícita e humana; listas vazias não são inferidas.
 */
export function prepareNatashaAvailability(
  raw: z.input<typeof natashaAvailabilitySourceSchema>,
): NatashaAvailabilityReport {
  const source = natashaAvailabilitySourceSchema.parse(raw);
  const window = natashaAvailabilityWindow(source.period);
  const candidates = source.team.employees.map((employee) => ({ id: employee.id, name: employee.name }));
  const candidateNames = new Map(candidates.map((employee) => [employee.id, employee.name]));
  const approvedVacations: NatashaAvailabilityReport['approvedVacations'] = [];
  const unresolvedVacations: NatashaAvailabilityReport['unresolvedVacations'] = [];
  const issues: NatashaAvailabilityReport['issues'] = [];
  let candidateDocumentsExamined = 0;
  let ignoredSalesOrRejected = 0;

  if (source.team.status !== 'ready_for_confirmation') issues.push({ code: 'TEAM_SOURCE_INCOMPLETE' });

  for (const rawVacation of source.vacationDocuments) {
    const rawEmployeeId = typeof rawVacation.userId === 'string' ? rawVacation.userId.trim() : '';
    if (rawEmployeeId && !candidateNames.has(rawEmployeeId)) continue;
    candidateDocumentsExamined += 1;
    const parsed = rawVacationSchema.safeParse(rawVacation);
    if (!parsed.success) {
      // Não devolve identificadores de um documento cuja pessoa não pôde ser
      // validada dentro do escopo autorizado.
      issues.push({ code: 'MALFORMED_VACATION' });
      continue;
    }
    const vacation = parsed.data;
    const employeeName = candidateNames.get(vacation.userId);
    if (!employeeName) continue;
    if (vacation.startDate > window.through || vacation.endDate < window.from) continue;
    if (vacation.recordType !== 'gozo' || vacation.status === 'REJECTED') {
      ignoredSalesOrRejected += 1;
      continue;
    }
    const normalized = {
      id: vacation.id,
      employeeId: vacation.userId,
      employeeName,
      startDate: vacation.startDate,
      endDate: vacation.endDate,
      recordType: 'gozo' as const,
    };
    if (vacation.status === 'APPROVED') {
      approvedVacations.push({ ...normalized, status: 'approved' });
    } else {
      const status = vacation.status === 'PENDING' ? 'pending' as const : 'planned' as const;
      unresolvedVacations.push({ ...normalized, status });
      issues.push({ code: 'UNRESOLVED_VACATION', vacationId: vacation.id, employeeId: vacation.userId });
    }
  }

  approvedVacations.sort((left, right) => left.startDate.localeCompare(right.startDate) || left.employeeName.localeCompare(right.employeeName, 'pt-BR'));
  unresolvedVacations.sort((left, right) => left.startDate.localeCompare(right.startDate) || left.employeeName.localeCompare(right.employeeName, 'pt-BR'));
  const hasMalformedOrTeamIssue = issues.some((issue) => issue.code !== 'UNRESOLVED_VACATION');
  const report = {
    status: hasMalformedOrTeamIssue ? 'incomplete' as const
      : unresolvedVacations.length > 0 ? 'questions_pending' as const
        : 'ready_for_confirmation' as const,
    scope: 'candidate_vacations_and_external_unavailability_prompt' as const,
    period: source.period,
    window,
    candidates,
    approvedVacations,
    unresolvedVacations,
    issues,
    evidence: {
      sourceQuery: source.sourceQuery,
      candidateDocumentsExamined,
      outsideCandidateDocumentsOmitted: true as const,
      ignoredSalesOrRejected,
      requiresHumanConfirmation: true as const,
      externalUnavailabilitiesIncluded: false as const,
      dayOffsIncluded: false as const,
    },
  };
  return natashaAvailabilityReportSchema.parse(report);
}
