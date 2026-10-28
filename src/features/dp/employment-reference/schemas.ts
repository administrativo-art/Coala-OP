import { z } from 'zod';
import { isCivilDate } from './resolve';

const id = z.string().trim().min(1).max(180).regex(/^[A-Za-z0-9_-]+$/);

export const civilDate = z.string().refine(isCivilDate, 'Informe uma data civil válida.');
export const employmentReferenceRouteSchema = z.object({ userId: id }).strict();
export const employmentReferenceQuerySchema = z.object({
  date: civilDate.optional(),
  revision: z.string().regex(/^[1-9]\d*$/).transform(Number).refine(Number.isSafeInteger).optional(),
}).strict();

export const periodInputSchema = z.object({
  validFrom: civilDate,
  validTo: civilDate.optional(),
  employmentRelationshipType: z.enum(['clt', 'apprenticeship', 'pj', 'internship', 'partner']),
  employerUnitId: id,
  unitId: id,
  unitIds: z.array(id).min(1).max(20),
  jobRoleId: id.optional(),
  jobFunctionIds: z.array(id).max(20),
  sourceDocumentId: id,
  sourceReason: z.string().trim().min(5).max(500),
}).strict().superRefine((period, context) => {
  if (period.validTo && period.validTo < period.validFrom) {
    context.addIssue({ code: 'custom', path: ['validTo'], message: 'Fim anterior ao início.' });
  }
  if (new Set(period.unitIds).size !== period.unitIds.length || new Set(period.jobFunctionIds).size !== period.jobFunctionIds.length) {
    context.addIssue({ code: 'custom', message: 'Identificadores duplicados.' });
  }
});

const publicationFields = {
  expectedRevision: z.number().int().min(0),
  requestId: id,
  periods: z.array(periodInputSchema).min(1).max(100),
};

export const publishEmploymentReferenceBodySchema = z.object({
  ...publicationFields,
  userId: id.optional(),
}).strict();

export const publishEmploymentReferenceSchema = z.object({
  ...publicationFields,
  userId: id,
}).strict().superRefine((value, context) => {
  value.periods.forEach((period, index) => {
    if (index && value.periods[index - 1].validFrom >= period.validFrom) {
      context.addIssue({ code: 'custom', path: ['periods', index, 'validFrom'], message: 'Períodos precisam estar em ordem crescente.' });
    }
    if (index && (!value.periods[index - 1].validTo || value.periods[index - 1].validTo! >= period.validFrom)) {
      context.addIssue({ code: 'custom', path: ['periods', index], message: 'Períodos sobrepostos ou vigência anterior aberta.' });
    }
  });
});

export type EmploymentPeriodInput = z.infer<typeof periodInputSchema>;
export type PublishEmploymentReferenceInput = z.infer<typeof publishEmploymentReferenceSchema>;

export function parseEmploymentReferenceQuery(search: URLSearchParams) {
  if ([...search.keys()].some((key) => !['date', 'revision'].includes(key) || search.getAll(key).length !== 1)) return null;
  const parsed = employmentReferenceQuerySchema.safeParse(Object.fromEntries(search));
  return parsed.success ? parsed.data : null;
}

export function bindEmploymentReferencePublication(userId: string, rawBody: unknown): PublishEmploymentReferenceInput | null {
  const route = employmentReferenceRouteSchema.safeParse({ userId });
  const body = publishEmploymentReferenceBodySchema.safeParse(rawBody);
  if (!route.success || !body.success || body.data.userId && body.data.userId !== route.data.userId) return null;
  const parsed = publishEmploymentReferenceSchema.safeParse({
    userId: route.data.userId,
    expectedRevision: body.data.expectedRevision,
    requestId: body.data.requestId,
    periods: body.data.periods,
  });
  return parsed.success ? parsed.data : null;
}
