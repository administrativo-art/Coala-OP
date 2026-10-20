import { z } from 'zod';

const idSchema = z.string().trim().min(1).max(180);

function isCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isCalendarDate, 'Informe uma data válida.');
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const timeConfigRouteSchema = z.object({ id: idSchema }).strict();

export const applicabilitySchema = z.object({
  scope: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('company') }).strict(),
    z.object({ kind: z.literal('unit_organization'), id: idSchema }).strict(),
    z.object({ kind: z.literal('unit_group'), id: idSchema }).strict(),
    z.object({ kind: z.literal('unit'), id: idSchema }).strict(),
  ]),
  jobRoleIds: z.array(idSchema).max(30).optional(),
  jobFunctionIds: z.array(idSchema).max(30).optional(),
  collaboratorIds: z.array(idSchema).max(30).optional(),
}).strict().transform((value) => ({
  ...value,
  ...(value.jobRoleIds?.length ? { jobRoleIds: [...new Set(value.jobRoleIds)].sort() } : {}),
  ...(value.jobFunctionIds?.length ? { jobFunctionIds: [...new Set(value.jobFunctionIds)].sort() } : {}),
  ...(value.collaboratorIds?.length ? { collaboratorIds: [...new Set(value.collaboratorIds)].sort() } : {}),
}));

const validitySchema = z.object({
  validFrom: dateSchema,
  validTo: dateSchema.optional(),
}).refine((value) => !value.validTo || value.validTo >= value.validFrom, {
  message: 'O fim da vigência deve ser igual ou posterior ao início.',
  path: ['validTo'],
});

const journeyRegimeSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('fixed') }).strict(),
  z.object({
    mode: z.literal('flexible'),
    windowStart: timeSchema.optional(),
    windowEnd: timeSchema.optional(),
  }).strict(),
]).superRefine((value, context) => {
  if (value.mode === 'flexible') {
    if (Boolean(value.windowStart) !== Boolean(value.windowEnd)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [value.windowStart ? 'windowEnd' : 'windowStart'],
        message: 'Informe o início e o fim da janela flexível.',
      });
    }
    if (value.windowStart && value.windowEnd && value.windowStart === value.windowEnd) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['windowEnd'],
        message: 'A janela flexível precisa ter horários diferentes.',
      });
    }
  }
});

const weeklyRestSchema = z.object({
  placement: z.enum(['fixed_cycle', 'schedule']),
  maxConsecutiveWorkDays: z.number().int().min(1).max(6),
  sundayCadenceWeeks: z.number().int().min(1).max(12).optional(),
}).strict();

const journeyScaleValidationSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('consecutive_days') }).strict(),
  z.object({ mode: z.literal('manual_review') }).strict(),
]);

const journeyFieldsObjectSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional(),
  weeklyMinutes: z.number().int().min(1).max(7 * 24 * 60),
  cycleLengthDays: z.number().int().min(1).max(42),
  days: z.array(z.object({
    dayIndex: z.number().int().min(1).max(42),
    plannedMinutes: z.number().int().min(0).max(24 * 60),
    isRestDay: z.boolean(),
  }).strict()).min(1).max(42),
  regime: journeyRegimeSchema.default({ mode: 'fixed' }),
  weeklyRest: weeklyRestSchema.default({ placement: 'fixed_cycle', maxConsecutiveWorkDays: 6 }),
  scaleValidation: journeyScaleValidationSchema.default({ mode: 'consecutive_days' }),
  expectedBreakMinutes: z.number().int().min(0).max(480).optional(),
  useDefinedShiftWhenShorter: z.boolean().optional(),
  toleranceMinutes: z.number().int().min(0, 'A tolerância não pode ser negativa.').max(10, 'A tolerância vai até 10 minutos por dia (art. 58 §1º da CLT).').optional(),
  allowedShiftDefinitionIds: z.array(idSchema).max(100).optional(),
  applicability: applicabilitySchema,
  validFrom: dateSchema,
  validTo: dateSchema.optional(),
}).strict();

function refineJourney(value: z.infer<typeof journeyFieldsObjectSchema>, context: z.RefinementCtx) {
  if (value.validTo && value.validTo < value.validFrom) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['validTo'], message: 'O fim da vigência deve ser igual ou posterior ao início.' });
  }
  if (value.days.length !== value.cycleLengthDays) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['days'], message: 'Informe todos os dias do ciclo da jornada.' });
  }
  const indexes = value.days.map((day) => day.dayIndex);
  if (new Set(indexes).size !== indexes.length || indexes.some((index) => index > value.cycleLengthDays)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['days'], message: 'Os dias do ciclo devem ser únicos e sequenciais.' });
  }
  if (value.days.some((day) => day.isRestDay !== (day.plannedMinutes === 0))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['days'], message: 'Dia de descanso deve ter zero minuto planejado.' });
  }
  if (!value.days.some((day) => day.isRestDay)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['days'], message: 'O ciclo precisa prever ao menos um descanso semanal.' });
  }
  const cycleMinutes = value.days.reduce((sum, day) => sum + day.plannedMinutes, 0);
  if (cycleMinutes * 7 !== value.weeklyMinutes * value.cycleLengthDays) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['weeklyMinutes'], message: 'A carga semanal não corresponde à distribuição do ciclo.' });
  }
  const looksLikeTwelveByThirtySix = value.cycleLengthDays === 2
    && value.days.some((day) => day.plannedMinutes === 12 * 60)
    && value.days.some((day) => day.isRestDay);
  if (looksLikeTwelveByThirtySix && value.scaleValidation.mode !== 'manual_review') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['scaleValidation'],
      message: 'A jornada 12×36 deve permanecer em revisão manual até a validação específica de 36 horas estar disponível.',
    });
  }
}

export const createJourneySchema = journeyFieldsObjectSchema.extend({ supersedesId: idSchema.optional() }).superRefine(refineJourney);
const journeyUpdateDataSchema = journeyFieldsObjectSchema.partial().extend({
  description: journeyFieldsObjectSchema.shape.description.nullable(),
  allowedShiftDefinitionIds: journeyFieldsObjectSchema.shape.allowedShiftDefinitionIds.nullable(),
  toleranceMinutes: journeyFieldsObjectSchema.shape.toleranceMinutes.nullable(),
  validTo: journeyFieldsObjectSchema.shape.validTo.nullable(),
}).refine((value) => Object.keys(value).length > 0);
export const updateJourneySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('update'), data: journeyUpdateDataSchema }).strict(),
  z.object({ action: z.literal('publish') }).strict(),
  z.object({ action: z.literal('archive') }).strict(),
]);

const overtimeCategoryFieldsSchema = z.object({
  id: z.string().trim().min(1).max(60),
  name: z.string().trim().min(2).max(100),
  trigger: z.enum(['workday', 'specific_weekdays', 'rest_day', 'sunday', 'holiday', 'unplanned_work']),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  ratePercent: z.number().min(0).max(1000),
  destination: z.enum(['payroll', 'time_bank', 'review']),
  bankCreditFactor: z.number().positive().max(10).optional(),
  requiresApproval: z.boolean(),
}).strict().superRefine((value, context) => {
  if (value.trigger === 'specific_weekdays' && !value.weekdays?.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['weekdays'], message: 'Selecione ao menos um dia da semana.' });
  }
  if (value.trigger !== 'specific_weekdays' && value.weekdays !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['weekdays'], message: 'Dias da semana só podem ser usados na opção de dias específicos.' });
  }
  if (value.destination === 'time_bank' && value.bankCreditFactor === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['bankCreditFactor'], message: 'Informe o fator de crédito do banco de horas.' });
  }
  if (value.destination !== 'time_bank' && value.bankCreditFactor !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['bankCreditFactor'], message: 'Fator de crédito só se aplica ao banco de horas.' });
  }
});

const overtimeCategorySchema = z.preprocess((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const normalized = { ...(value as Record<string, unknown>) };
  // Compatibilidade com registros criados antes da tolerância ser
  // consolidada no nível geral da política.
  delete normalized.startsAfterMinutes;
  return normalized;
}, overtimeCategoryFieldsSchema);

const overtimeFieldsObjectSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional(),
  collectiveAgreementReference: z.string().trim().max(240).optional(),
  applicability: applicabilitySchema,
  validFrom: dateSchema,
  validTo: dateSchema.optional(),
  dailyOvertimeLimitMinutes: z.number().int().positive().max(24 * 60).optional(),
  weeklyOvertimeLimitMinutes: z.number().int().positive().max(7 * 24 * 60).optional(),
  categories: z.array(overtimeCategorySchema).min(1).max(30),
  timeBank: z.object({
    enabled: z.boolean(),
    allowNegativeBalance: z.boolean(),
    positiveLimitMinutes: z.number().int().positive().max(100000).optional(),
    negativeLimitMinutes: z.number().int().positive().max(100000).optional(),
    expirationDays: z.number().int().positive().max(3650).optional(),
    expiredBalanceDestination: z.enum(['payroll', 'forfeit', 'review']),
    cycle: z.object({
      unit: z.enum(['month', 'day']),
      length: z.number().int().min(1, 'O ciclo precisa ter ao menos 1 período.').max(366, 'O ciclo vai até 366.'),
      anchorDate: dateSchema,
      residualDestination: z.enum(['carry', 'payroll', 'review', 'forfeit']),
    }).strict().refine((cycle) => cycle.unit === 'day' || cycle.length <= 12, { message: 'O ciclo em meses vai até 12 meses.', path: ['length'] })
      .refine((cycle) => cycle.unit !== 'month' || Number(cycle.anchorDate.slice(8, 10)) <= 28, { message: 'No ciclo em meses, use marco entre os dias 1 e 28.', path: ['anchorDate'] })
      .optional(),
  }).strict(),
  externalCoverageRule: z.enum(['origin', 'execution_unit', 'manual_review']),
}).strict();

function refineOvertimePolicy(value: z.infer<typeof overtimeFieldsObjectSchema>, context: z.RefinementCtx) {
  if (value.validTo && value.validTo < value.validFrom) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['validTo'], message: 'O fim da vigência deve ser igual ou posterior ao início.' });
  }
  if (new Set(value.categories.map((category) => category.id)).size !== value.categories.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['categories'], message: 'Os códigos das faixas de hora extra devem ser únicos.' });
  }
  if (!value.timeBank.enabled && value.categories.some((category) => category.destination === 'time_bank')) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['timeBank', 'enabled'], message: 'Ative o banco de horas para usar uma faixa com esse destino.' });
  }
}

export const createOvertimePolicySchema = overtimeFieldsObjectSchema.extend({ supersedesId: idSchema.optional() }).superRefine(refineOvertimePolicy);
const overtimeUpdateDataSchema = overtimeFieldsObjectSchema.partial().extend({
  description: overtimeFieldsObjectSchema.shape.description.nullable(),
  collectiveAgreementReference: overtimeFieldsObjectSchema.shape.collectiveAgreementReference.nullable(),
  validTo: overtimeFieldsObjectSchema.shape.validTo.nullable(),
  dailyOvertimeLimitMinutes: overtimeFieldsObjectSchema.shape.dailyOvertimeLimitMinutes.nullable(),
  weeklyOvertimeLimitMinutes: overtimeFieldsObjectSchema.shape.weeklyOvertimeLimitMinutes.nullable(),
}).refine((value) => Object.keys(value).length > 0);
export const updateOvertimePolicySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('update'), data: overtimeUpdateDataSchema }).strict(),
  z.object({ action: z.literal('publish') }).strict(),
  z.object({ action: z.literal('archive') }).strict(),
]);

const nullableOptionalString = z.string().trim().min(1).max(240).nullable().optional();
const shiftDefinitionFieldsObjectSchema = z.object({
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(2).max(120),
  startTime: timeSchema,
  endTime: timeSchema,
  breakStart: nullableOptionalString,
  breakEnd: nullableOptionalString,
  breakType: z.enum(['none', 'fixed', 'flexible', 'staggered']).optional(),
  breakDurationMinutes: z.number().int().min(1).max(480).nullable().optional(),
  breakWindowStart: nullableOptionalString,
  breakWindowEnd: nullableOptionalString,
  breakSegments: z.array(z.object({ start: timeSchema, end: timeSchema }).strict()).min(2).max(6).nullable().optional(),
  breakSplit: z.enum(['single', 'multiple']).nullable().optional(),
  breakPauseCount: z.number().int().min(2).max(10).nullable().optional(),
  breakMinPauseMinutes: z.number().int().min(1).max(60).nullable().optional(),
  unitId: nullableOptionalString,
  unitName: nullableOptionalString,
  unitIds: z.array(idSchema).max(100).optional(),
  unitNames: z.array(z.string().trim().min(1).max(240)).max(100).optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7),
  bizneoTemplateId: nullableOptionalString,
  journeyIds: z.array(idSchema).max(30).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  configurationNotes: z.string().trim().max(2000).nullable().optional(),
  overnight: z.boolean().optional(),
  expectedPunches: z.number().int().min(2).max(12).nullable().optional(),
  executionUnitPolicy: z.enum(['scheduled', 'free']).optional(),
}).strict();

function refineShiftDefinition(value: z.infer<typeof shiftDefinitionFieldsObjectSchema>, context: z.RefinementCtx) {
  const hasBreakStart = typeof value.breakStart === 'string';
  const hasBreakEnd = typeof value.breakEnd === 'string';
  const effectiveBreakType = value.breakType ?? (hasBreakStart && hasBreakEnd ? 'fixed' : 'none');
  const segments = value.breakSegments ?? null;
  if (segments) {
    if (effectiveBreakType !== 'fixed') {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['breakSegments'], message: 'Vários horários só existem no intervalo fixo intercalado.' });
    }
    if (hasBreakStart || hasBreakEnd) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['breakSegments'], message: 'No fixo intercalado, informe só a lista de horários.' });
    }
    segments.forEach((segment, index) => {
      if (segment.end <= segment.start) context.addIssue({ code: z.ZodIssueCode.custom, path: ['breakSegments', index, 'end'], message: 'O fim da pausa deve ser depois do início.' });
      if (index > 0 && segment.start < segments[index - 1].end) context.addIssue({ code: z.ZodIssueCode.custom, path: ['breakSegments', index, 'start'], message: 'As pausas devem estar em ordem e sem sobreposição.' });
    });
  }
  if ((value.breakSplit === 'multiple' || value.breakPauseCount) && !['flexible', 'staggered'].includes(String(value.breakType))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['breakSplit'], message: 'Várias pausas só existem no intervalo livre ou de janela.' });
  }
  if (value.breakMinPauseMinutes && value.breakPauseCount && value.breakDurationMinutes
    && value.breakMinPauseMinutes * value.breakPauseCount > value.breakDurationMinutes) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['breakMinPauseMinutes'], message: 'Pausa mínima × quantidade de pausas passa da duração total.' });
  }
  if (value.breakPauseCount && value.breakSplit !== 'multiple') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['breakPauseCount'], message: 'A quantidade de pausas exige a opção de várias pausas.' });
  }
  if (hasBreakStart !== hasBreakEnd) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['breakStart'], message: 'Informe início e fim do intervalo.' });
  }
  if (effectiveBreakType === 'fixed' && !segments && (!hasBreakStart || !hasBreakEnd)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['breakStart'], message: 'Informe o início e o fim do intervalo pré-definido.' });
  }
  if (effectiveBreakType !== 'fixed' && (hasBreakStart || hasBreakEnd)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['breakStart'], message: 'Horários fixos só podem ser usados no intervalo pré-definido.' });
  }
  const needsDuration = effectiveBreakType === 'flexible' || effectiveBreakType === 'staggered';
  if (needsDuration && !value.breakDurationMinutes) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['breakDurationMinutes'], message: 'Informe a duração do intervalo.' });
  }
  const hasWindowStart = typeof value.breakWindowStart === 'string';
  const hasWindowEnd = typeof value.breakWindowEnd === 'string';
  if (effectiveBreakType === 'staggered' && (!hasWindowStart || !hasWindowEnd)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['breakWindowStart'], message: 'Informe o início e o fim da janela do intervalo intercalado.' });
  }
  if (effectiveBreakType !== 'staggered' && (hasWindowStart || hasWindowEnd)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['breakWindowStart'], message: 'A janela de horário só pode ser usada no intervalo intercalado.' });
  }
  if (!value.overnight && value.endTime <= value.startTime) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['endTime'], message: 'Turno com saída no dia seguinte deve ser marcado como noturno.' });
  }
  if (value.unitIds && value.unitNames && value.unitIds.length !== value.unitNames.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['unitNames'], message: 'Unidades e nomes precisam ter o mesmo tamanho.' });
  }
}

export const createShiftDefinitionSchema = shiftDefinitionFieldsObjectSchema.superRefine(refineShiftDefinition);
export const updateShiftDefinitionSchema = shiftDefinitionFieldsObjectSchema.partial().extend({
  isArchived: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0);
export const completeShiftDefinitionSchema = shiftDefinitionFieldsObjectSchema.extend({
  isArchived: z.boolean().optional(),
}).superRefine(refineShiftDefinition);
export const completeJourneySchema = journeyFieldsObjectSchema.superRefine(refineJourney);
export const completeOvertimePolicySchema = overtimeFieldsObjectSchema.superRefine(refineOvertimePolicy);

export type CreateJourneyInput = z.infer<typeof createJourneySchema>;
export type UpdateJourneyInput = z.infer<typeof updateJourneySchema>;
export type CreateOvertimePolicyInput = z.infer<typeof createOvertimePolicySchema>;
export type UpdateOvertimePolicyInput = z.infer<typeof updateOvertimePolicySchema>;
export type CreateShiftDefinitionInput = z.infer<typeof createShiftDefinitionSchema>;
export type UpdateShiftDefinitionInput = z.infer<typeof updateShiftDefinitionSchema>;

// Exportado para testes de contrato de vigência.
export const timeConfigValiditySchema = validitySchema;
