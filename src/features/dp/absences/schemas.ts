import { z } from 'zod';

import { applicabilitySchema } from '@/features/dp/time-config/schemas';
import { absencePoliciesConflict } from '@/lib/dp-absence-rules';

const idSchema = z.string().trim().min(1).max(180);
function isCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data no formato AAAA-MM-DD.').refine(isCalendarDate, 'Informe uma data válida.');

const absencePolicySchema = z.object({
  id: z.string().trim().min(1).max(60),
  name: z.string().trim().min(2).max(120),
  employmentRelationshipTypes: z.array(z.enum(['clt', 'apprenticeship', 'internship'])).min(1).max(3)
    .transform((values) => [...new Set(values)].sort()),
  applicability: applicabilitySchema,
  calculation: z.enum(['scheduled_workdays', 'calendar_days', 'calendar_days_until_return']),
  maxUnitsPerRequest: z.number().positive().max(366).optional(),
  maxUnitsPerPeriod: z.number().positive().max(3660).optional(),
  limitPeriod: z.enum(['month', 'year']).optional(),
  minimumNoticeDays: z.number().int().min(0).max(365).optional(),
  maximumRetroactiveDays: z.number().int().min(0).max(3650).optional(),
  attachment: z.enum(['not_required', 'required']),
  approvalFlow: z.enum(['automatic', 'manager', 'dp', 'manager_then_dp']),
  rejectionReasonRequired: z.boolean(),
  allowFutureEdit: z.boolean(),
  allowFutureCancel: z.boolean(),
  instructions: z.string().trim().max(2000).optional(),
}).strict().superRefine((value, context) => {
  if (value.maxUnitsPerPeriod !== undefined && value.limitPeriod === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['limitPeriod'], message: 'Informe o período do limite acumulado.' });
  }
  if (value.maxUnitsPerPeriod === undefined && value.limitPeriod !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['maxUnitsPerPeriod'], message: 'Informe o limite acumulado.' });
  }
});

const absenceTypeFieldsSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional(),
  color: z.enum(['pink', 'red', 'orange', 'amber', 'yellow', 'green', 'teal', 'cyan', 'blue', 'indigo', 'violet', 'slate']),
  requestUnits: z.array(z.enum(['day', 'hour'])).min(1).max(2).transform((values) => [...new Set(values)].sort()),
  initiatedBy: z.array(z.enum(['collaborator', 'manager', 'dp', 'system'])).min(1).max(4).transform((values) => [...new Set(values)].sort()),
  workdayEffect: z.enum(['excused_absence', 'unexcused_absence', 'worked_credit', 'time_bank_debit', 'manual_review']),
  includeInAbsenteeism: z.boolean(),
  blocksSchedule: z.boolean(),
  policies: z.array(absencePolicySchema).min(1).max(20),
  validFrom: dateSchema,
  validTo: dateSchema.optional(),
}).strict();

function refineAbsenceType(value: z.infer<typeof absenceTypeFieldsSchema>, context: z.RefinementCtx) {
  if (value.validTo && value.validTo < value.validFrom) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['validTo'], message: 'O fim da vigência deve ser igual ou posterior ao início.' });
  }
  const ids = value.policies.map((policy) => policy.id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['policies'], message: 'Os códigos das regras devem ser únicos.' });
  }
  for (let left = 0; left < value.policies.length; left += 1) {
    for (let right = left + 1; right < value.policies.length; right += 1) {
      if (absencePoliciesConflict(value.policies[left], value.policies[right])) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['policies', right],
          message: `A regra “${value.policies[right].name}” empata com “${value.policies[left].name}” para o mesmo público. Refine a abrangência.`,
        });
      }
    }
  }
}

export const createAbsenceTypeSchema = absenceTypeFieldsSchema.extend({ supersedesId: idSchema.optional() }).superRefine(refineAbsenceType);
const absenceTypeUpdateDataSchema = absenceTypeFieldsSchema.partial().extend({
  description: absenceTypeFieldsSchema.shape.description.nullable(),
  validTo: absenceTypeFieldsSchema.shape.validTo.nullable(),
}).refine((value) => Object.keys(value).length > 0, 'Informe ao menos uma alteração.');
export const updateAbsenceTypeSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('update'), data: absenceTypeUpdateDataSchema }).strict(),
  z.object({ action: z.literal('publish') }).strict(),
  z.object({ action: z.literal('archive') }).strict(),
]);
export const completeAbsenceTypeSchema = absenceTypeFieldsSchema.superRefine(refineAbsenceType);
export const absenceTypeRouteSchema = z.object({ id: idSchema }).strict();

export type CreateAbsenceTypeInput = z.infer<typeof createAbsenceTypeSchema>;
export type UpdateAbsenceTypeInput = z.infer<typeof updateAbsenceTypeSchema>;
