export type JobRoleHierarchyRecord = {
  id: string;
  name?: string | null;
  publicTitle?: string | null;
  parentId?: string | null;
  reportsTo?: string | null;
};

export type JobRoleHierarchyUpdate = {
  id: string;
  name: string;
  parentId: string;
  reportsTo: string;
};

export type ExecutiveHierarchyPlan = {
  generalDirectorId: string | null;
  deputyGeneralDirectorId: string | null;
  updates: JobRoleHierarchyUpdate[];
};

function normalizeRoleName(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function roleNames(role: JobRoleHierarchyRecord) {
  return [role.name, role.publicTitle]
    .map(normalizeRoleName)
    .filter(Boolean);
}

function hasRoleName(role: JobRoleHierarchyRecord, expected: string) {
  return roleNames(role).includes(expected);
}

function isDirector(role: JobRoleHierarchyRecord) {
  return roleNames(role).some((name) => /^diretor(?:\s|$)/.test(name));
}

function findUniqueRole(
  roles: JobRoleHierarchyRecord[],
  predicate: (role: JobRoleHierarchyRecord) => boolean,
  label: string
) {
  const matches = roles.filter(predicate);
  if (matches.length > 1) {
    throw new Error(`Há mais de um cargo identificado como ${label}.`);
  }
  return matches[0] ?? null;
}

/**
 * Mantém a hierarquia executiva canônica:
 * Diretor geral -> Vice-diretor geral -> demais diretorias.
 *
 * A função é pura para permitir auditoria e testes antes de qualquer gravação.
 */
export function planExecutiveJobRoleHierarchy(
  roles: JobRoleHierarchyRecord[]
): ExecutiveHierarchyPlan {
  const generalDirector = findUniqueRole(
    roles,
    (role) => hasRoleName(role, "diretor geral"),
    "Diretor geral"
  );
  const deputyGeneralDirector = findUniqueRole(
    roles,
    (role) => hasRoleName(role, "vice diretor geral"),
    "Vice-diretor geral"
  );

  if (!generalDirector || !deputyGeneralDirector) {
    return {
      generalDirectorId: generalDirector?.id ?? null,
      deputyGeneralDirectorId: deputyGeneralDirector?.id ?? null,
      updates: [],
    };
  }

  const expectedParents = new Map<string, string>();
  expectedParents.set(deputyGeneralDirector.id, generalDirector.id);

  for (const role of roles) {
    if (
      role.id !== generalDirector.id &&
      role.id !== deputyGeneralDirector.id &&
      isDirector(role)
    ) {
      expectedParents.set(role.id, deputyGeneralDirector.id);
    }
  }

  const updates = roles.flatMap((role) => {
    const expectedParentId = expectedParents.get(role.id);
    if (!expectedParentId) return [];
    if (
      role.parentId === expectedParentId &&
      role.reportsTo === expectedParentId
    ) {
      return [];
    }
    return [{
      id: role.id,
      name: role.name ?? role.publicTitle ?? role.id,
      parentId: expectedParentId,
      reportsTo: expectedParentId,
    }];
  });

  return {
    generalDirectorId: generalDirector.id,
    deputyGeneralDirectorId: deputyGeneralDirector.id,
    updates,
  };
}
