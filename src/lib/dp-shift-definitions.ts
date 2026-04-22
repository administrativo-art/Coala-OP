import type { DPShiftDefinition } from '@/types';

type ShiftUnitsShape = Pick<DPShiftDefinition, 'unitId' | 'unitName' | 'unitIds' | 'unitNames'>;

export function getShiftDefinitionUnitIds(def?: ShiftUnitsShape | null): string[] {
  if (!def) return [];

  if (Array.isArray(def.unitIds) && def.unitIds.length > 0) {
    return Array.from(new Set(def.unitIds.filter(Boolean)));
  }

  if (def.unitId) {
    return [def.unitId];
  }

  return [];
}

export function getShiftDefinitionUnitNames(def?: ShiftUnitsShape | null): string[] {
  if (!def) return [];

  if (Array.isArray(def.unitNames) && def.unitNames.length > 0) {
    return Array.from(new Set(def.unitNames.filter(Boolean)));
  }

  if (def.unitName) {
    return [def.unitName];
  }

  return [];
}

export function shiftDefinitionMatchesUnit(def: ShiftUnitsShape | null | undefined, unitId?: string) {
  const linkedUnitIds = getShiftDefinitionUnitIds(def);

  if (!unitId) return true;
  if (linkedUnitIds.length === 0) return true;

  return linkedUnitIds.includes(unitId);
}

export function getPrimaryShiftDefinitionUnitId(def?: ShiftUnitsShape | null) {
  return getShiftDefinitionUnitIds(def)[0];
}
