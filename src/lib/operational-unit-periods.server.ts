import 'server-only';
import { FieldValue } from 'firebase-admin/firestore';
import { operationalCivilDate, operationalUnitsOnDate, validateOperationalPeriods } from './operational-unit-periods';

/** Derive from the transaction's latest person, never a stale form projection. */
export function currentOperationalPatch(latest: Record<string, unknown>, patch: Record<string, unknown>, date = operationalCivilDate()) {
  const periods = patch.operationalUnitPeriods ?? latest.operationalUnitPeriods;
  if (!validateOperationalPeriods(periods)) return patch;
  const nextDate = periods.find((period) => period.validFrom > date)?.validFrom;
  const unitIds = operationalUnitsOnDate({ operationalUnitPeriods: periods }, date);
  return { ...patch, unitIds: operationalUnitsOnDate({ operationalUnitPeriods: periods }, date),
    ...(latest.operationalUnitPeriods === undefined && patch.operationalUnitPeriods !== undefined ? { operationalUnitCutoverDate: date } : {}),
    ...(JSON.stringify(latest.unitIds ?? []) !== JSON.stringify(unitIds) || patch.operationalUnitPeriods !== undefined ? { operationalProjectionSyncPending: true } : {}),
    operationalProjectionDate: date, nextOperationalUnitChangeDate: nextDate ?? FieldValue.delete() };
}
