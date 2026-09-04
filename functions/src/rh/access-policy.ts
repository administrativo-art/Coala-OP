import type { RhRole } from './types.js';

type PermissionSource = Record<string, unknown> | null | undefined;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nested(source: PermissionSource, ...path: string[]): unknown {
  let current: unknown = source;
  for (const key of path) {
    current = record(current)?.[key];
  }
  return current;
}

function explicitRhRole(source: PermissionSource): RhRole | null {
  const value = nested(source, 'dp', 'rh_role');
  return value === 'employee' || value === 'manager' || value === 'admin' ? value : null;
}

function enabled(source: PermissionSource, ...path: string[]): boolean {
  return nested(source, ...path) === true;
}

export function resolveRhRoleFromPermissions(params: {
  tokenIsDefaultAdmin?: boolean;
  profileIsDefaultAdmin?: boolean;
  userPermissions?: PermissionSource;
  profilePermissions?: PermissionSource;
}): RhRole | null {
  const sources = [params.profilePermissions, params.userPermissions];

  if (
    params.tokenIsDefaultAdmin === true
    || params.profileIsDefaultAdmin === true
    || sources.some((source) => enabled(source, 'settings', 'manageUsers'))
  ) {
    return 'admin';
  }

  for (const source of sources) {
    const role = explicitRhRole(source);
    if (role) return role;
  }

  if (sources.some((source) => (
    enabled(source, 'dp', 'collaborators', 'edit')
    || enabled(source, 'dp', 'collaborators', 'view')
  ))) {
    return 'manager';
  }

  return null;
}

export function canEditRhProfilesFromPermissions(params: {
  tokenIsDefaultAdmin?: boolean;
  profileIsDefaultAdmin?: boolean;
  userPermissions?: PermissionSource;
  profilePermissions?: PermissionSource;
}): boolean {
  const sources = [params.profilePermissions, params.userPermissions];

  if (
    params.tokenIsDefaultAdmin === true
    || params.profileIsDefaultAdmin === true
    || sources.some((source) => enabled(source, 'settings', 'manageUsers'))
  ) {
    return true;
  }

  if (sources.some((source) => {
    const role = explicitRhRole(source);
    return role === 'admin' || role === 'manager';
  })) {
    return true;
  }

  return sources.some((source) => (
    enabled(source, 'dp', 'collaborators', 'edit')
    || enabled(source, 'dp', 'rh', 'collaborators', 'edit')
  ));
}
