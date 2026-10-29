import { operationalUnitsOnDate, validateOperationalPeriods } from '@/lib/operational-unit-periods';
import type { DPJourney, DPShiftDefinition } from '@/types';
import type { DPJourneyResolvedBy } from './dp-journey-resolution';

type ShiftDefinitionSource = Partial<DPShiftDefinition> & { id: string };

const stringOrNull = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value : null;
const stringArray = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string')
  : [];

export function buildShiftDefinitionReference(definition: ShiftDefinitionSource | null) {
  return definition ? {
    id: definition.id,
    code: definition.code ?? null,
    name: definition.name ?? null,
    startTime: definition.startTime ?? null,
    endTime: definition.endTime ?? null,
    breakType: definition.breakType ?? null,
    breakStart: definition.breakStart ?? null,
    breakEnd: definition.breakEnd ?? null,
    breakDurationMinutes: definition.breakDurationMinutes ?? null,
    breakWindowStart: definition.breakWindowStart ?? null,
    breakWindowEnd: definition.breakWindowEnd ?? null,
    // Só aparece no fixo intercalado, para não mudar a forma das referências já congeladas.
    ...(definition.breakSegments?.length ? { breakSegments: definition.breakSegments.map((segment) => ({ ...segment })) } : {}),
    overnight: definition.overnight ?? false,
    expectedPunches: definition.expectedPunches ?? null,
    daysOfWeek: [...(definition.daysOfWeek ?? [])],
    unitId: definition.unitId ?? null,
    unitIds: [...(definition.unitIds ?? [])],
    journeyIds: [...(definition.journeyIds ?? [])],
    bizneoTemplateId: definition.bizneoTemplateId ?? null,
    description: definition.description ?? null,
    updatedAt: definition.updatedAt ?? null,
  } : null;
}

/** Historical planning reference captured with the occurrence, never evidence of attendance. */
export function buildDPShiftReference(params: {
  collaboratorId: string;
  user: Record<string, unknown>;
  journey: DPJourney;
  resolvedBy: DPJourneyResolvedBy;
  definition: ShiftDefinitionSource | null;
  executionUnitId: string;
  date: string;
  startTime: string;
  endTime: string;
  capturedAt: string;
}) {
  const { user, journey, resolvedBy, definition } = params;
  const employerUnitId = stringOrNull(user.employerUnitId);
  const employerCnpj = stringOrNull(user.employerCnpj);
  return {
    schemaVersion: 1 as const,
    source: 'dp_schedule_write' as const,
    collaboratorId: params.collaboratorId,
    capturedAt: params.capturedAt,
    basisCapturedAt: params.capturedAt,
    plannedDate: params.date,
    executionUnitId: params.executionUnitId,
    plannedStartTime: params.startTime,
    plannedEndTime: params.endTime,
    collaborator: {
      unitId: stringOrNull(user.unitId),
      unitIds: operationalUnitsOnDate({ unitIds: stringArray(user.unitIds), ...(validateOperationalPeriods(user.operationalUnitPeriods) ? { operationalUnitPeriods: user.operationalUnitPeriods } : {}) }, params.date),
      jobRoleId: stringOrNull(user.jobRoleId),
      jobRoleName: stringOrNull(user.jobRoleName),
      jobFunctionIds: stringArray(user.jobFunctionIds),
      jobFunctionNames: stringArray(user.jobFunctionNames),
      employmentCycleVersion: typeof user.employmentCycleVersion === 'number'
        && Number.isSafeInteger(user.employmentCycleVersion) && user.employmentCycleVersion >= 0
        ? user.employmentCycleVersion : null,
      employmentCycleStatus: typeof user.employmentCycleVersion === 'number'
        && Number.isSafeInteger(user.employmentCycleVersion) && user.employmentCycleVersion >= 0
        ? 'captured' as const : 'pending' as const,
      employmentRelationshipType: stringOrNull(user.employmentRelationshipType),
      employmentStatus: stringOrNull(user.employmentStatus),
      isActive: user.isActive !== false,
      admissionDate: user.admissionDate ?? null,
      terminationDate: user.terminationDate ?? null,
      employerUnitId,
      employerCnpj,
      fiscalStatus: employerUnitId && employerCnpj ? 'present_unverified' as const : 'pending' as const,
    },
    journey: {
      id: journey.id,
      lineageId: journey.lineageId,
      version: journey.version,
      name: journey.name,
      resolvedBy,
      validFrom: journey.validFrom,
      validTo: journey.validTo ?? null,
      weeklyMinutes: journey.weeklyMinutes,
      cycleLengthDays: journey.cycleLengthDays,
      days: journey.days.map((day) => ({ ...day })),
      regime: journey.regime ? { ...journey.regime } : null,
      weeklyRest: journey.weeklyRest ? { ...journey.weeklyRest } : null,
      scaleValidation: journey.scaleValidation ? { ...journey.scaleValidation } : null,
      expectedBreakMinutes: journey.expectedBreakMinutes ?? null,
      useDefinedShiftWhenShorter: journey.useDefinedShiftWhenShorter ?? null,
      toleranceMinutes: journey.toleranceMinutes ?? null,
      allowedShiftDefinitionIds: [...(journey.allowedShiftDefinitionIds ?? [])],
    },
    shiftDefinition: buildShiftDefinitionReference(definition),
  };
}

export type DPShiftReference = ReturnType<typeof buildDPShiftReference>;
