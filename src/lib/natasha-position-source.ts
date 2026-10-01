import { z } from 'zod';

import type { NatashaProposalInputs } from './natasha-proposal-preflight';
import { natashaCoveragePlanSchema, validateNatashaCoverage, type NatashaCoveragePlan } from './natasha-roster-coverage';
import { natashaShiftDirectoryReportSchema, type NatashaShiftDirectoryReport } from './natasha-shift-directory';
import type { NatashaRosterSnapshot } from './natasha-roster-validator';

const idSchema = z.string().trim().min(1).max(180);
const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Data inválida.');
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const slotSchema = z.enum(['opening', 'closing', 'intermediate', 'single']);

const standardTemplateSchema = z.object({
  key: idSchema,
  unitId: idSchema,
  shiftDefinitionId: idSchema,
  slot: slotSchema,
  count: z.number().int().min(1).max(10),
  requiredRoleId: idSchema.nullable(),
}).strict();

const overrideShiftSchema = z.object({
  source: z.literal('shift_definition'),
  key: idSchema,
  shiftDefinitionId: idSchema,
  slot: slotSchema,
  count: z.number().int().min(1).max(10),
  requiredRoleId: idSchema.nullable(),
}).strict();

const overrideCustomSchema = z.object({
  source: z.literal('custom'),
  key: idSchema,
  startTime: timeSchema,
  endTime: timeSchema,
  slot: slotSchema,
  count: z.number().int().min(1).max(10),
  requiredRoleId: idSchema.nullable(),
}).strict().refine((position) => position.endTime > position.startTime, {
  path: ['endTime'], message: 'O horário especial deve terminar depois de começar.',
});

export const natashaPositionDecisionsSchema = z.object({
  period: periodSchema,
  standardTemplates: z.array(standardTemplateSchema).max(100),
  dateOverrides: z.array(z.object({
    unitId: idSchema,
    date: dateSchema,
    reason: z.string().trim().min(1).max(300),
    positions: z.array(z.union([overrideShiftSchema, overrideCustomSchema])).max(20),
  }).strict()).max(155),
  confirmed: z.object({
    shiftDefinitions: z.boolean(),
    standardPositions: z.boolean(),
    slotClassifications: z.boolean(),
    roleRequirements: z.boolean(),
    specialDatesAndReinforcements: z.boolean(),
  }).strict(),
}).strict().superRefine((decisions, context) => {
  const templateKeys = decisions.standardTemplates.map((item) => `${item.unitId}\u0000${item.key}`);
  if (new Set(templateKeys).size !== templateKeys.length) {
    context.addIssue({ code: 'custom', path: ['standardTemplates'], message: 'Chave padrão repetida na unidade.' });
  }
  const overrideKeys = decisions.dateOverrides.map((item) => `${item.unitId}\u0000${item.date}`);
  if (new Set(overrideKeys).size !== overrideKeys.length) {
    context.addIssue({ code: 'custom', path: ['dateOverrides'], message: 'Exceção repetida para unidade e data.' });
  }
  decisions.dateOverrides.forEach((override, index) => {
    const keys = override.positions.map((item) => item.key);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({ code: 'custom', path: ['dateOverrides', index, 'positions'], message: 'Chave de posição repetida.' });
    }
  });
});

export type NatashaPositionDecisions = z.infer<typeof natashaPositionDecisionsSchema>;
type PositionIssueCode =
  | 'CONFIRM_SHIFT_DEFINITIONS' | 'CONFIRM_STANDARD_POSITIONS' | 'CONFIRM_SLOT_CLASSIFICATIONS'
  | 'CONFIRM_ROLE_REQUIREMENTS' | 'CONFIRM_SPECIAL_DATES' | 'SHIFT_DIRECTORY_INCOMPLETE'
  | 'COVERAGE_SCOPE_UNCONFIRMED' | 'PERIOD_MISMATCH' | 'UNIT_SCOPE_MISMATCH'
  | 'DECISION_OUTSIDE_SCOPE' | 'SHIFT_DEFINITION_NOT_FOUND' | 'SHIFT_NOT_ALLOWED_IN_UNIT'
  | 'SHIFT_HAS_BREAK_UNSUPPORTED' | 'SHIFT_NOT_ACTIVE_ON_DATE' | 'NO_APPLICABLE_STANDARD_POSITION'
  | 'POSITION_LIMIT_REACHED' | 'POSITION_ID_COLLISION' | 'POSITIONS_ON_CLOSED_DAY'
  | 'POSITIONS_DO_NOT_COVER_DEMAND' | 'COVERAGE_SOURCE_INVALID';
export type NatashaPositionSourceReport = {
  period: string;
  status: 'ready_for_preflight' | 'questions_pending' | 'coverage_gaps';
  scope: 'confirmed_shift_positions_only';
  positions: NatashaProposalInputs['positions'];
  trace: Array<{
    positionId: string;
    decisionKey: string;
    source: 'shift_definition' | 'custom';
    shiftDefinitionId: string | null;
    override: boolean;
  }>;
  issues: Array<{
    code: PositionIssueCode;
    category: 'question' | 'data' | 'coverage';
    unitId?: string;
    date?: string;
    shiftDefinitionId?: string;
    startTime?: string;
    endTime?: string;
    requiredPeople?: number;
    scheduledPeople?: number;
  }>;
  evidence: {
    sourceShiftDefinitionIds: string[];
    overrideDates: string[];
    requiresHumanConfirmation: false;
    inferredSlotClassifications: 0;
  };
};
type PositionIssue = NatashaPositionSourceReport['issues'][number];
type ShiftDefinition = NatashaShiftDirectoryReport['shiftDefinitions'][number];

function sameValues(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function weekday(date: string) {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function positionId(unitId: string, date: string, key: string, instance: number) {
  return `pos:${date}:${stableHash(`${unitId}\u0000${key}`)}:${instance}`;
}

/**
 * Converte horários confirmados em posições. O código/nome do turno nunca
 * determina abertura, fechamento ou intermediário; essa classificação é decisão explícita.
 */
export function prepareNatashaPositions(
  coveragePlanInput: NatashaCoveragePlan,
  shiftDirectoryInput: NatashaShiftDirectoryReport,
  decisionsInput: NatashaPositionDecisions,
): NatashaPositionSourceReport {
  const coveragePlan = natashaCoveragePlanSchema.parse(coveragePlanInput);
  const shiftDirectory = natashaShiftDirectoryReportSchema.parse(shiftDirectoryInput);
  const decisions = natashaPositionDecisionsSchema.parse(decisionsInput);
  const issues: PositionIssue[] = [];
  const issueKeys = new Set<string>();
  const add = (issue: PositionIssue) => {
    const key = JSON.stringify(issue);
    if (!issueKeys.has(key)) {
      issueKeys.add(key);
      issues.push(issue);
    }
  };
  const confirmations: Array<[keyof NatashaPositionDecisions['confirmed'], PositionIssue['code']]> = [
    ['shiftDefinitions', 'CONFIRM_SHIFT_DEFINITIONS'],
    ['standardPositions', 'CONFIRM_STANDARD_POSITIONS'],
    ['slotClassifications', 'CONFIRM_SLOT_CLASSIFICATIONS'],
    ['roleRequirements', 'CONFIRM_ROLE_REQUIREMENTS'],
    ['specialDatesAndReinforcements', 'CONFIRM_SPECIAL_DATES'],
  ];
  for (const [field, code] of confirmations) {
    if (!decisions.confirmed[field]) add({ code, category: 'question' });
  }
  if (shiftDirectory.status !== 'ready_for_confirmation') add({ code: 'SHIFT_DIRECTORY_INCOMPLETE', category: 'data' });
  if (!coveragePlan.scopeConfirmed) add({ code: 'COVERAGE_SCOPE_UNCONFIRMED', category: 'question' });
  if (decisions.period !== coveragePlan.period) add({ code: 'PERIOD_MISMATCH', category: 'data' });
  if (!sameValues(coveragePlan.expectedUnitIds, shiftDirectory.unitIds)) add({ code: 'UNIT_SCOPE_MISMATCH', category: 'data' });

  const expectedUnits = new Set(coveragePlan.expectedUnitIds);
  const definitions = new Map(shiftDirectory.shiftDefinitions.map((definition) => [definition.id, definition]));
  const validTemplates: Array<z.infer<typeof standardTemplateSchema> & { definition: ShiftDefinition }> = [];
  for (const template of decisions.standardTemplates) {
    if (!expectedUnits.has(template.unitId)) {
      add({ code: 'DECISION_OUTSIDE_SCOPE', category: 'data', unitId: template.unitId, shiftDefinitionId: template.shiftDefinitionId });
      continue;
    }
    const definition = definitions.get(template.shiftDefinitionId);
    if (!definition) {
      add({ code: 'SHIFT_DEFINITION_NOT_FOUND', category: 'data', unitId: template.unitId, shiftDefinitionId: template.shiftDefinitionId });
      continue;
    }
    if (!definition.allowedUnitIds.includes(template.unitId)) {
      add({ code: 'SHIFT_NOT_ALLOWED_IN_UNIT', category: 'data', unitId: template.unitId, shiftDefinitionId: definition.id });
      continue;
    }
    if (definition.breakStart || definition.breakEnd) {
      add({ code: 'SHIFT_HAS_BREAK_UNSUPPORTED', category: 'question', unitId: template.unitId, shiftDefinitionId: definition.id });
      continue;
    }
    validTemplates.push({ ...template, definition });
  }

  const overrides = new Map<string, NatashaPositionDecisions['dateOverrides'][number]>();
  for (const override of decisions.dateOverrides) {
    if (!expectedUnits.has(override.unitId) || !override.date.startsWith(`${decisions.period}-`)) {
      add({ code: 'DECISION_OUTSIDE_SCOPE', category: 'data', unitId: override.unitId, date: override.date });
      continue;
    }
    overrides.set(`${override.unitId}\u0000${override.date}`, override);
  }

  const positions: NatashaPositionSourceReport['positions'] = [];
  const trace: NatashaPositionSourceReport['trace'] = [];
  const seenPositionIds = new Set<string>();
  let limitReached = false;
  const appendPositions = (params: {
    unitId: string;
    date: string;
    key: string;
    startTime: string;
    endTime: string;
    slot: z.infer<typeof slotSchema>;
    count: number;
    requiredRoleId: string | null;
    source: 'shift_definition' | 'custom';
    shiftDefinitionId: string | null;
    override: boolean;
  }) => {
    for (let instance = 1; instance <= params.count; instance += 1) {
      if (positions.length >= 500) {
        limitReached = true;
        return;
      }
      const id = positionId(params.unitId, params.date, params.key, instance);
      if (seenPositionIds.has(id)) {
        add({ code: 'POSITION_ID_COLLISION', category: 'data', unitId: params.unitId, date: params.date });
        continue;
      }
      seenPositionIds.add(id);
      positions.push({
        id,
        unitId: params.unitId,
        date: params.date,
        startTime: params.startTime,
        endTime: params.endTime,
        slot: params.slot,
        requiredRoleId: params.requiredRoleId,
      });
      trace.push({
        positionId: id,
        decisionKey: params.key,
        source: params.source,
        shiftDefinitionId: params.shiftDefinitionId,
        override: params.override,
      });
    }
  };

  for (const unit of coveragePlan.units) {
    if (!expectedUnits.has(unit.unitId)) continue;
    for (const day of unit.days) {
      const override = overrides.get(`${unit.unitId}\u0000${day.date}`);
      if (override) {
        for (const specification of override.positions) {
          if (specification.source === 'custom') {
            appendPositions({
              unitId: unit.unitId, date: day.date, key: specification.key,
              startTime: specification.startTime, endTime: specification.endTime,
              slot: specification.slot, count: specification.count,
              requiredRoleId: specification.requiredRoleId, source: 'custom',
              shiftDefinitionId: null, override: true,
            });
            continue;
          }
          const definition = definitions.get(specification.shiftDefinitionId);
          if (!definition) {
            add({ code: 'SHIFT_DEFINITION_NOT_FOUND', category: 'data', unitId: unit.unitId,
              date: day.date, shiftDefinitionId: specification.shiftDefinitionId });
          } else if (!definition.allowedUnitIds.includes(unit.unitId)) {
            add({ code: 'SHIFT_NOT_ALLOWED_IN_UNIT', category: 'data', unitId: unit.unitId,
              date: day.date, shiftDefinitionId: definition.id });
          } else if (!definition.daysOfWeek.includes(weekday(day.date))) {
            add({ code: 'SHIFT_NOT_ACTIVE_ON_DATE', category: 'question', unitId: unit.unitId,
              date: day.date, shiftDefinitionId: definition.id });
          } else if (definition.breakStart || definition.breakEnd) {
            add({ code: 'SHIFT_HAS_BREAK_UNSUPPORTED', category: 'question', unitId: unit.unitId,
              shiftDefinitionId: definition.id });
          } else {
            appendPositions({
              unitId: unit.unitId, date: day.date, key: specification.key,
              startTime: definition.startTime, endTime: definition.endTime,
              slot: specification.slot, count: specification.count,
              requiredRoleId: specification.requiredRoleId, source: 'shift_definition',
              shiftDefinitionId: definition.id, override: true,
            });
          }
        }
        continue;
      }
      if (day.status !== 'open') continue;
      const applicable = validTemplates.filter((template) => template.unitId === unit.unitId
        && template.definition.daysOfWeek.includes(weekday(day.date)));
      if (applicable.length === 0) {
        add({ code: 'NO_APPLICABLE_STANDARD_POSITION', category: 'question', unitId: unit.unitId, date: day.date });
      }
      for (const template of applicable) {
        appendPositions({
          unitId: unit.unitId, date: day.date, key: template.key,
          startTime: template.definition.startTime, endTime: template.definition.endTime,
          slot: template.slot, count: template.count,
          requiredRoleId: template.requiredRoleId, source: 'shift_definition',
          shiftDefinitionId: template.definition.id, override: false,
        });
      }
    }
  }
  if (limitReached) add({ code: 'POSITION_LIMIT_REACHED', category: 'data' });

  const capacitySnapshot: NatashaRosterSnapshot = {
    period: coveragePlan.period,
    history: null,
    shifts: positions.map((position, index) => ({
      id: `capacity:${index + 1}`,
      employeeId: `capacity:${index + 1}`,
      unitId: position.unitId,
      date: position.date,
      startTime: position.startTime,
      endTime: position.endTime,
      slot: position.slot,
    })),
    dayOffs: [], vacations: [], unavailabilities: [], fixedAssignments: [], fridayMatrix: null,
  };
  const coverage = validateNatashaCoverage(capacitySnapshot, coveragePlan);
  for (const issue of coverage.issues) {
    if (issue.code === 'COVERAGE_GAP') {
      add({ code: 'POSITIONS_DO_NOT_COVER_DEMAND', category: 'coverage', unitId: issue.unitId,
        date: issue.date, startTime: issue.startTime, endTime: issue.endTime,
        requiredPeople: issue.requiredPeople, scheduledPeople: issue.scheduledPeople });
    } else if (issue.code === 'SHIFT_ON_CLOSED_DAY') {
      add({ code: 'POSITIONS_ON_CLOSED_DAY', category: 'data', unitId: issue.unitId, date: issue.date });
    } else if (issue.code !== 'SCOPE_UNCONFIRMED') {
      add({ code: 'COVERAGE_SOURCE_INVALID', category: 'data', unitId: issue.unitId, date: issue.date });
    }
  }

  const hasQuestionOrData = issues.some((issue) => issue.category !== 'coverage');
  const hasCoverage = issues.some((issue) => issue.category === 'coverage');
  return {
    period: decisions.period,
    status: hasQuestionOrData ? 'questions_pending' : hasCoverage ? 'coverage_gaps' : 'ready_for_preflight',
    scope: 'confirmed_shift_positions_only',
    positions,
    trace,
    issues,
    evidence: {
      sourceShiftDefinitionIds: [...new Set(trace.flatMap((item) => item.shiftDefinitionId ? [item.shiftDefinitionId] : []))].sort(),
      overrideDates: [...new Set(decisions.dateOverrides.map((item) => item.date))].sort(),
      requiresHumanConfirmation: false,
      inferredSlotClassifications: 0,
    },
  };
}
