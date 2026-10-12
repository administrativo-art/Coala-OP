import { z } from "zod";

import type { JobDepartment, JobFunction, JobRole, User } from "@/types";

export const NONE = "__none__";

export const roleSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do cargo."),
  cbo: z.string()
    .trim()
    .regex(/^\d{4}-\d{2}$/, "Use o formato 0000-00.")
    .optional()
    .or(z.literal("")),
  departmentId: z.string().optional(),
  parentId: z.string().optional(),
  reportsTo: z.string().optional(),
  defaultProfileId: z.string().optional(),
  loginRestricted: z.boolean().default(false),
  isActive: z.boolean().default(true),
  description: z.string().trim().optional(),
});
export type RoleFormValues = z.infer<typeof roleSchema>;

export const functionSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome da função."),
  departmentId: z.string().optional(),
  parentId: z.string().optional(),
  compatibleRoleIds: z.array(z.string()).default([]),
  defaultProfileId: z.string().optional(),
  monthlySalary: z.coerce.number().nonnegative("Deve ser um valor positivo.").optional(),
  isActive: z.boolean().default(true),
  description: z.string().trim().optional(),
});
export type FunctionFormValues = z.infer<typeof functionSchema>;

export const departmentSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do departamento."),
  parentId: z.string().optional(),
  description: z.string().trim().optional(),
  isActive: z.boolean().default(true),
});
export type DepartmentFormValues = z.infer<typeof departmentSchema>;

export type HrTreeItem = {
  id: string;
  name: string;
  parentId?: string | null;
  reportsTo?: string | null;
  departmentName?: string | null;
  isActive?: boolean;
  order?: number;
};

export type TreeRow<T extends HrTreeItem> = {
  item: T;
  depth: number;
  /** Numeração hierárquica, ex.: "2.1". Vazia na lista plana de busca. */
  number: string;
  hasChildren: boolean;
};

export function getTreeParentId(item: HrTreeItem) {
  return item.parentId ?? item.reportsTo ?? null;
}

function compareItems(a: HrTreeItem, b: HrTreeItem) {
  return (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, "pt-BR");
}

/**
 * Achata a árvore na ordem de exibição. Itens cujo pai não existe mais viram raízes
 * (em vez de sumirem). `collapsed` esconde os descendentes de cada id recolhido.
 */
export function flattenTree<T extends HrTreeItem>(items: T[], collapsed: ReadonlySet<string> = new Set()): TreeRow<T>[] {
  const ids = new Set(items.map((item) => item.id));
  const childrenByParent = new Map<string | null, T[]>();
  for (const item of items) {
    const parentId = getTreeParentId(item);
    const key = parentId && ids.has(parentId) && parentId !== item.id ? parentId : null;
    childrenByParent.set(key, [...(childrenByParent.get(key) ?? []), item]);
  }
  childrenByParent.forEach((list) => list.sort(compareItems));

  const rows: TreeRow<T>[] = [];
  const visited = new Set<string>();
  const visit = (item: T, depth: number, number: string) => {
    if (visited.has(item.id)) return;
    visited.add(item.id);
    const children = childrenByParent.get(item.id) ?? [];
    rows.push({ item, depth, number, hasChildren: children.length > 0 });
    if (collapsed.has(item.id)) return;
    children.forEach((child, index) => visit(child, depth + 1, `${number}.${index + 1}`));
  };
  (childrenByParent.get(null) ?? []).forEach((root, index) => visit(root, 0, String(index + 1)));
  return rows;
}

/** Com busca ativa a árvore vira lista plana: um filho que casa não pode sumir porque o pai não casou. */
export function listRows<T extends HrTreeItem>(allItems: T[], matches: (item: T) => boolean, query: string, collapsed: ReadonlySet<string>): TreeRow<T>[] {
  if (!query.trim()) return flattenTree(allItems, collapsed);
  return allItems
    .filter(matches)
    .sort(compareItems)
    .map((item) => ({ item, depth: 0, number: "", hasChildren: false }));
}

export function matchesQuery(query: string, ...fields: Array<string | null | undefined>) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((value) => value?.toLowerCase().includes(needle));
}

export type LinkedRolePerson = {
  id: string;
  name: string;
  functions: Array<{ id: string; name: string; hierarchyRank: number }>;
  unitNames: string[];
};

/** Posição de cada função na hierarquia (pai antes dos filhos), usada para ordenar pessoas. */
export function functionHierarchyRanks(functions: JobFunction[]) {
  const functionById = new Map(functions.map((item) => [item.id, item]));
  const childrenByParent = new Map<string | null, JobFunction[]>();
  functions.forEach((item) => {
    const parentId = item.parentId && functionById.has(item.parentId) ? item.parentId : null;
    childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), item]);
  });
  childrenByParent.forEach((items) => {
    items.sort((left, right) =>
      (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER)
      || left.name.localeCompare(right.name, "pt-BR")
    );
  });
  const rankById = new Map<string, number>();
  const visited = new Set<string>();
  const visit = (item: JobFunction) => {
    if (visited.has(item.id)) return;
    visited.add(item.id);
    rankById.set(item.id, rankById.size);
    (childrenByParent.get(item.id) ?? []).forEach(visit);
  };
  (childrenByParent.get(null) ?? []).forEach(visit);
  functions
    .filter((item) => !visited.has(item.id))
    .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"))
    .forEach(visit);
  return rankById;
}

export function buildLinkedRolePeople(
  role: JobRole,
  activeUsers: User[],
  functions: JobFunction[],
  units: Array<{ id: string; name: string }>
): LinkedRolePerson[] {
  const functionNameById = new Map(functions.map((item) => [item.id, item.name]));
  const unitNameById = new Map(units.map((unit) => [unit.id, unit.name]));
  const ranks = functionHierarchyRanks(functions);

  return activeUsers
    .filter((user) => user.jobRoleId === role.id)
    .map((user) => {
      const currentFunctions = (user.jobFunctionIds ?? [])
        .map((id) => {
          const name = functionNameById.get(id);
          return name ? { id, name, hierarchyRank: ranks.get(id) ?? Number.MAX_SAFE_INTEGER } : null;
        })
        .filter((item): item is NonNullable<typeof item> => !!item);
      const legacyFunctionNames = (user.jobFunctionNames ?? []).filter(Boolean);
      const resolvedFunctions = currentFunctions.length > 0
        ? currentFunctions
        : Array.from(new Set(legacyFunctionNames)).map((name, index) => {
          const catalogItem = functions.find((item) => item.name === name);
          return {
            id: catalogItem?.id ?? `legacy:${name}`,
            name,
            hierarchyRank: catalogItem
              ? ranks.get(catalogItem.id) ?? Number.MAX_SAFE_INTEGER
              : Number.MAX_SAFE_INTEGER - legacyFunctionNames.length + index,
          };
        });
      return {
        id: user.id,
        name: user.username,
        functions: [...resolvedFunctions].sort((left, right) =>
          left.hierarchyRank - right.hierarchyRank || left.name.localeCompare(right.name, "pt-BR")
        ),
        unitNames: (user.unitIds ?? []).map((id) => unitNameById.get(id)).filter((name): name is string => !!name),
      };
    })
    .sort((left, right) =>
      (left.functions[0]?.hierarchyRank ?? Number.MAX_SAFE_INTEGER) - (right.functions[0]?.hierarchyRank ?? Number.MAX_SAFE_INTEGER)
      || left.name.localeCompare(right.name, "pt-BR")
    );
}

/** Por cargo: quantos colaboradores ativos o têm e quantos estão com perfil diferente do padrão do cargo. */
export function roleSyncSummary(roles: JobRole[], activeUsers: User[]) {
  const summary = new Map<string, { assigned: number; mismatched: number }>();
  for (const role of roles) summary.set(role.id, { assigned: 0, mismatched: 0 });
  const roleById = new Map(roles.map((role) => [role.id, role]));
  for (const user of activeUsers) {
    if (!user.jobRoleId) continue;
    const bucket = summary.get(user.jobRoleId);
    if (!bucket) continue;
    bucket.assigned += 1;
    const role = roleById.get(user.jobRoleId);
    if (role?.defaultProfileId && user.profileId !== role.defaultProfileId) bucket.mismatched += 1;
  }
  return summary;
}

export function normalizedSearch(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

export type DepartmentLike = Pick<JobDepartment, "id" | "name" | "isActive">;
