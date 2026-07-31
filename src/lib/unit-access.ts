import type { UnitAccessScope, User } from '@/types';

export type UnitAccessUser = Partial<Pick<
  User,
  | 'unitIds'
  | 'assignedKioskIds'
  | 'unitAccessScope'
  | 'unitAccessUnitIds'
>>;

export type UnitAccessResolution = {
  scope: UnitAccessScope;
  allUnits: boolean;
  unitIds: string[];
};

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry ?? '').trim())
    .filter(Boolean);
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

export function normalizeUnitAccessScope(value: unknown): UnitAccessScope {
  if (value === 'all' || value === 'selected') return value;
  return 'linked';
}

export function isUnitAccessScope(value: unknown): value is UnitAccessScope {
  return value === 'linked' || value === 'selected' || value === 'all';
}

export function getLinkedUnitIds(user: UnitAccessUser): string[] {
  return unique([
    ...stringArray(user.unitIds),
    ...stringArray(user.assignedKioskIds),
  ]);
}

export function resolveUnitAccess(
  user: UnitAccessUser,
  options: { isDefaultAdmin?: boolean } = {},
): UnitAccessResolution {
  if (options.isDefaultAdmin) {
    return { scope: 'all', allUnits: true, unitIds: [] };
  }

  const scope = normalizeUnitAccessScope(user.unitAccessScope);
  if (scope === 'all') {
    return { scope, allUnits: true, unitIds: [] };
  }

  return {
    scope,
    allUnits: false,
    unitIds: scope === 'selected'
      ? unique(stringArray(user.unitAccessUnitIds))
      : getLinkedUnitIds(user),
  };
}

export function canAccessUnit(
  user: UnitAccessUser,
  unitId: string | null | undefined,
  options: { isDefaultAdmin?: boolean } = {},
) {
  const resolution = resolveUnitAccess(user, options);
  if (resolution.allUnits) return true;
  if (!unitId) return false;
  return resolution.unitIds.includes(unitId);
}

export function canAccessAnyUnit(
  user: UnitAccessUser,
  unitIds: Array<string | null | undefined>,
  options: { isDefaultAdmin?: boolean } = {},
) {
  const resolution = resolveUnitAccess(user, options);
  if (resolution.allUnits) return true;

  const allowed = new Set(resolution.unitIds);
  return unitIds.some((unitId) => typeof unitId === 'string' && allowed.has(unitId));
}

export function canAccessUserByUnit(
  actor: UnitAccessUser,
  target: UnitAccessUser,
  options: { isDefaultAdmin?: boolean } = {},
) {
  return canAccessAnyUnit(actor, getLinkedUnitIds(target), options);
}

export function canDelegateUnitAccess(
  actor: UnitAccessUser,
  target: UnitAccessUser,
  options: { isDefaultAdmin?: boolean } = {},
) {
  const actorAccess = resolveUnitAccess(actor, options);
  if (actorAccess.allUnits) return true;

  const targetAccess = resolveUnitAccess(target);
  if (targetAccess.allUnits) return false;

  const actorUnitIds = new Set(actorAccess.unitIds);
  return targetAccess.unitIds.every((unitId) => actorUnitIds.has(unitId));
}

export function filterUnitsByAccess<T extends { id: string }>(
  units: T[],
  user: UnitAccessUser,
  options: { isDefaultAdmin?: boolean } = {},
) {
  const resolution = resolveUnitAccess(user, options);
  if (resolution.allUnits) return units;
  const allowed = new Set(resolution.unitIds);
  return units.filter((unit) => allowed.has(unit.id));
}
