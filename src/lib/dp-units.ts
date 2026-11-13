export type ArchivableOperationalUnit = {
  id?: string;
  isArchived?: boolean;
  mergedIntoUnitId?: string;
  createdAt?: unknown;
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

const FORTALEZA_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Aceita Timestamp do client, `{seconds}`/`{_seconds}` serializado, ISO e epoch em ms. */
function createdAtMs(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof value === 'object') {
    const candidate = value as { toMillis?: () => number; seconds?: unknown; _seconds?: unknown };
    if (typeof candidate.toMillis === 'function') return candidate.toMillis();
    const seconds = typeof candidate.seconds === 'number' ? candidate.seconds : candidate._seconds;
    if (typeof seconds === 'number') return seconds * 1000;
  }
  return null;
}

/**
 * Primeiro mês (ano*12 + mês-1, em America/Fortaleza) em que a unidade operacional existe.
 * Considera também as unidades arquivadas incorporadas a ela, que carregam a história anterior.
 * Sem data válida, retorna null (a unidade é tratada como existente em todos os períodos).
 */
export function operationalUnitFirstPeriodIndex(
  unit: ArchivableOperationalUnit,
  allUnits: ArchivableOperationalUnit[],
): number | null {
  const canonicalId = canonicalOperationalUnitId(unit.id, allUnits);
  const related = allUnits.filter((candidate) => canonicalOperationalUnitId(candidate.id, allUnits) === canonicalId);
  const dates = (related.length ? related : [unit]).map((candidate) => createdAtMs(candidate.createdAt));
  if (dates.some((date) => date === null)) return null;
  const earliest = Math.min(...(dates as number[]));
  const local = new Date(earliest - FORTALEZA_OFFSET_MS);
  return local.getUTCFullYear() * 12 + local.getUTCMonth();
}

/** Unidades que já existiam no mês informado (1-12); o mês de criação já conta. */
export function operationalUnitsExistingInPeriod<T extends ArchivableOperationalUnit>(
  units: T[],
  allUnits: ArchivableOperationalUnit[],
  year: number,
  month: number,
) {
  const period = year * 12 + (month - 1);
  return units.filter((unit) => {
    const first = operationalUnitFirstPeriodIndex(unit, allUnits);
    return first === null || first <= period;
  });
}
