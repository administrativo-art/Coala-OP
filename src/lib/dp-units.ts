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

  let canonicalUnitId = unitId;
  const visitedUnitIds = new Set<string>();

  while (!visitedUnitIds.has(canonicalUnitId)) {
    visitedUnitIds.add(canonicalUnitId);
    const unit = units.find((candidate) => candidate.id === canonicalUnitId);
    if (unit?.isArchived !== true || !unit.mergedIntoUnitId) break;
    canonicalUnitId = unit.mergedIntoUnitId;
  }

  return canonicalUnitId;
}

export function operationalUnitIdsMatch(
  firstUnitId: string | undefined,
  secondUnitId: string | undefined,
  units: ArchivableOperationalUnit[]
) {
  if (!firstUnitId || !secondUnitId) return firstUnitId === secondUnitId;
  return canonicalOperationalUnitId(firstUnitId, units) === canonicalOperationalUnitId(secondUnitId, units);
}

export function findOperationalUnitRecord<T extends { unitId?: string }>(
  records: readonly T[],
  unitId: string,
  units: ArchivableOperationalUnit[]
) {
  return records.find(record => record.unitId === unitId)
    ?? records.find(record => operationalUnitIdsMatch(record.unitId, unitId, units));
}
