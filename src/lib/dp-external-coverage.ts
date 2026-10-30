import { operationalUnitsOnDate, type OperationalUnitPeriod } from '@/lib/operational-unit-periods';

export type DPShiftAssignment =
  | { assignmentKind: 'regular'; countsTowardGoals: true }
  | { assignmentKind: 'external_coverage'; originUnitId: string; countsTowardGoals: false };

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry)) : [];
}

export function resolveDPShiftAssignment(params: {
  executionUnitId: string;
  executionUnitExternalId?: string;
  user: { unitId?: unknown; unitIds?: unknown; assignedKioskIds?: unknown; operationalUnitPeriods?: OperationalUnitPeriod[] };
  date?: string;
}): DPShiftAssignment {
  const { executionUnitId, executionUnitExternalId, user } = params;
  // unitId é a referência financeira; unitIds contém as unidades de escala e operação.
  // Cadastros legados sem unitIds ainda usam unitId para não perder a origem.
  const operationalUnits = user.operationalUnitPeriods !== undefined
    ? operationalUnitsOnDate({ operationalUnitPeriods: user.operationalUnitPeriods }, params.date) : strings(user.unitIds);
  if (user.operationalUnitPeriods !== undefined && !operationalUnits.length) throw new Error('OPERATIONAL_PERIOD_REQUIRED');
  const canonicalUnits = [...new Set(operationalUnits.length
    ? operationalUnits : [typeof user.unitId === 'string' ? user.unitId : ''].filter(Boolean))];
  const allAffiliations = new Set([...canonicalUnits, ...(user.operationalUnitPeriods === undefined ? strings(user.assignedKioskIds) : [])]);
  if (allAffiliations.has(executionUnitId) || (executionUnitExternalId && allAffiliations.has(executionUnitExternalId))) {
    return { assignmentKind: 'regular', countsTowardGoals: true };
  }
  const originUnitId = canonicalUnits[0];
  if (!originUnitId) throw new Error('EXTERNAL_COVERAGE_ORIGIN_REQUIRED');
  return { assignmentKind: 'external_coverage', originUnitId, countsTowardGoals: false };
}

export function countsDPShiftTowardGoals(shift: { countsTowardGoals?: boolean }) {
  return shift.countsTowardGoals !== false;
}

export function externalCoverageUserIds(
  shifts: Array<{ userId?: string; countsTowardGoals?: boolean }>,
) {
  return new Set(shifts.flatMap((shift) => (
    shift.userId && !countsDPShiftTowardGoals(shift) ? [shift.userId] : []
  )));
}
