export type ArchivableOperationalUnit = {
  id?: string;
  isArchived?: boolean;
  mergedIntoUnitId?: string;
};

export function isActiveOperationalUnit(unit: ArchivableOperationalUnit | null | undefined) {
  return !!unit && unit.isArchived !== true;
}

export function activeOperationalUnits<T extends ArchivableOperationalUnit>(units: T[]) {
  return units.filter(isActiveOperationalUnit);
}

export function canonicalOperationalUnitId(
  unitId: string | undefined,
  units: ArchivableOperationalUnit[]
) {
  if (!unitId) return unitId;
  const unit = units.find((candidate) => candidate.id === unitId);
  return unit?.isArchived === true && unit.mergedIntoUnitId
    ? unit.mergedIntoUnitId
    : unitId;
}
