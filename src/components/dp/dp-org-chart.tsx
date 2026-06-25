"use client";

import React from "react";
import {
  Briefcase,
  ChevronDown,
  ChevronRight,
  Mail,
  Minus,
  Phone,
  Plus,
  RotateCcw,
  Search,
  ShieldAlert,
  X,
  Users2,
  Workflow,
} from "lucide-react";

import type { DPUnit, JobFunction, JobRole, User } from "@/types";
import { useAuth } from "@/hooks/use-auth";
import { useHrBootstrap } from "@/hooks/use-hr-bootstrap";
import { matchDPUnitForKiosk } from "@/lib/dp-kiosk-match";
import { cn } from "@/lib/utils";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

type OrgRoleNode = {
  role: JobRole;
  directUsers: User[];
  children: OrgRoleNode[];
  totalUsers: number;
  detached: boolean;
};

type OrgViewMode = "tree" | "list" | "departments" | "levels";
type FlatOrgRole = { node: OrgRoleNode; depth: number };
type FlatPersonNode = { node: PersonTreeNode; depth: number };
type PersonTreeNode = {
  id: string;
  user: User | null;
  role: JobRole;
  directReports: PersonTreeNode[];
  totalReports: number;
  depth: number;
};

type UserDetail = {
  user: User;
  role: JobRole | null;
  manager: User | null;
  directReports: User[];
};

type PersonTreeOptions = {
  getUserUnitIds: (user: User) => string[];
  getLeaderUnitIds: (user: User) => string[];
  getFunctionHierarchyRank: (user: User) => number;
};

const ORG_TONES = [
  {
    header: "bg-pink-50 text-pink-700 border-pink-100",
    dot: "bg-pink-600",
    badge: "bg-pink-50 text-pink-700",
    progress: "bg-pink-600",
  },
  {
    header: "bg-violet-50 text-violet-700 border-violet-100",
    dot: "bg-violet-600",
    badge: "bg-violet-50 text-violet-700",
    progress: "bg-violet-600",
  },
  {
    header: "bg-sky-50 text-sky-700 border-sky-100",
    dot: "bg-sky-600",
    badge: "bg-sky-50 text-sky-700",
    progress: "bg-sky-600",
  },
  {
    header: "bg-emerald-50 text-emerald-700 border-emerald-100",
    dot: "bg-emerald-600",
    badge: "bg-emerald-50 text-emerald-700",
    progress: "bg-emerald-600",
  },
  {
    header: "bg-amber-50 text-amber-700 border-amber-100",
    dot: "bg-amber-600",
    badge: "bg-amber-50 text-amber-700",
    progress: "bg-amber-600",
  },
];

const LEVEL_LABELS = [
  "Diretoria & Sócios",
  "Gerência Geral",
  "Liderança",
  "Supervisão / Análise",
  "Operação",
];

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function byName<T extends { name?: string; username?: string }>(a: T, b: T) {
  const left = (a.name ?? a.username ?? "").localeCompare(b.name ?? b.username ?? "", "pt-BR");
  return left;
}

function matchesRole(role: JobRole, query: string) {
  return [role.name, role.publicTitle, role.slug, role.description, role.publicDescription]
    .filter(Boolean)
    .some((value) => value!.toLowerCase().includes(query));
}

function matchesUser(user: User, query: string) {
  return [
    user.username,
    user.email,
    user.jobRoleName,
    ...(user.jobFunctionNames ?? []),
  ]
    .filter(Boolean)
    .some((value) => value!.toLowerCase().includes(query));
}

function summarizeFunctions(functionNames?: string[]) {
  if (!functionNames || functionNames.length === 0) return "Sem funções vinculadas";
  if (functionNames.length <= 2) return functionNames.join(", ");
  return `${functionNames.slice(0, 2).join(", ")} +${functionNames.length - 2}`;
}

function buildOrgChart({
  roles,
  users,
  query,
  showInactiveRoles,
  showEmptyRoles,
}: {
  roles: JobRole[];
  users: User[];
  query: string;
  showInactiveRoles: boolean;
  showEmptyRoles: boolean;
}) {
  const normalizedQuery = query.trim().toLowerCase();
  const eligibleRoles = [...roles]
    .filter((role) => showInactiveRoles || role.isActive)
    .sort(byName);

  const roleById = new Map(eligibleRoles.map((role) => [role.id, role]));
  const usersByRoleId = new Map<string, User[]>();
  const usersWithoutRole: User[] = [];

  for (const user of users) {
    if (!user.jobRoleId || !roleById.has(user.jobRoleId)) {
      usersWithoutRole.push(user);
      continue;
    }

    const bucket = usersByRoleId.get(user.jobRoleId) ?? [];
    bucket.push(user);
    usersByRoleId.set(user.jobRoleId, bucket);
  }

  for (const bucket of usersByRoleId.values()) {
    bucket.sort(byName);
  }
  usersWithoutRole.sort(byName);

  const childIdsByParent = new Map<string, string[]>();
  for (const role of eligibleRoles) {
    if (!role.reportsTo || !roleById.has(role.reportsTo) || role.reportsTo === role.id) {
      continue;
    }

    const bucket = childIdsByParent.get(role.reportsTo) ?? [];
    bucket.push(role.id);
    childIdsByParent.set(role.reportsTo, bucket);
  }

  for (const [parentId, childIds] of childIdsByParent.entries()) {
    childIds.sort((leftId, rightId) => byName(roleById.get(leftId)!, roleById.get(rightId)!));
    childIdsByParent.set(parentId, childIds);
  }

  const builtRoleIds = new Set<string>();

  function createNode(roleId: string, lineage: Set<string>, detached: boolean): OrgRoleNode | null {
    if (lineage.has(roleId)) return null;

    const role = roleById.get(roleId);
    if (!role) return null;

    const nextLineage = new Set(lineage);
    nextLineage.add(roleId);

    const childNodes = (childIdsByParent.get(roleId) ?? [])
      .map((childId) => createNode(childId, nextLineage, detached))
      .filter((value): value is OrgRoleNode => value !== null);

    const directUsers = usersByRoleId.get(roleId) ?? [];
    const totalUsers = directUsers.length + childNodes.reduce((sum, child) => sum + child.totalUsers, 0);
    const branchMatchesQuery =
      normalizedQuery.length === 0 ||
      matchesRole(role, normalizedQuery) ||
      directUsers.some((user) => matchesUser(user, normalizedQuery)) ||
      childNodes.length > 0;

    if (!branchMatchesQuery) return null;
    if (!showEmptyRoles && normalizedQuery.length === 0 && totalUsers === 0) return null;

    builtRoleIds.add(roleId);

    return {
      role,
      directUsers,
      children: childNodes,
      totalUsers,
      detached,
    };
  }

  const naturalRootIds = eligibleRoles
    .filter(
      (role) =>
        !role.reportsTo || !roleById.has(role.reportsTo) || role.reportsTo === role.id
    )
    .map((role) => role.id);

  const roots = naturalRootIds
    .map((roleId) => createNode(roleId, new Set<string>(), false))
    .filter((value): value is OrgRoleNode => value !== null);

  let detachedRoleCount = 0;
  for (const role of eligibleRoles) {
    if (builtRoleIds.has(role.id)) continue;

    const detachedRoot = createNode(role.id, new Set<string>(), true);
    if (!detachedRoot) continue;

    detachedRoleCount += 1;
    roots.push(detachedRoot);
  }

  roots.sort((left, right) => byName(left.role, right.role));

  const visibleUsersWithoutRole =
    normalizedQuery.length === 0
      ? usersWithoutRole
      : usersWithoutRole.filter((user) => matchesUser(user, normalizedQuery));

  const occupiedRolesCount = eligibleRoles.filter(
    (role) => (usersByRoleId.get(role.id)?.length ?? 0) > 0
  ).length;

  return {
    roots,
    detachedRoleCount,
    usersWithoutRole: visibleUsersWithoutRole,
    totalRolesCount: eligibleRoles.length,
    occupiedRolesCount,
    assignedUsersCount: users.length - usersWithoutRole.length,
    visibleRolesCount: roots.reduce((sum, node) => sum + countVisibleRoles(node), 0),
  };
}

function countVisibleRoles(node: OrgRoleNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countVisibleRoles(child), 0);
}

function flattenOrgRoles(nodes: OrgRoleNode[], depth = 0): FlatOrgRole[] {
  return nodes.flatMap((node) => [
    { node, depth },
    ...flattenOrgRoles(node.children, depth + 1),
  ]);
}

function flattenPersonNodes(nodes: PersonTreeNode[]): FlatPersonNode[] {
  return nodes.flatMap((node) => [
    { node, depth: node.depth },
    ...flattenPersonNodes(node.directReports),
  ]);
}

function countPersonReports(nodes: PersonTreeNode[]): number {
  return nodes.reduce((sum, node) => sum + 1 + countPersonReports(node.directReports), 0);
}

function intersects(left: string[], right: string[]) {
  return left.some((value) => right.includes(value));
}

function createPersonNode(user: User, role: JobRole, directReports: PersonTreeNode[], depth: number): PersonTreeNode {
  return {
    id: user.id,
    user,
    role,
    directReports,
    totalReports: countPersonReports(directReports),
    depth,
  };
}

function collectUsersFromPersonNodes(nodes: PersonTreeNode[]) {
  const users: User[] = [];

  function walk(list: PersonTreeNode[]) {
    for (const node of list) {
      if (node.user) users.push(node.user);
      walk(node.directReports);
    }
  }

  walk(nodes);
  return users;
}

function assignReportGroupsToManagers(
  managers: User[],
  reportGroups: PersonTreeNode[][],
  options: PersonTreeOptions
) {
  const assignments = new Map<string, PersonTreeNode[]>();
  managers.forEach((manager) => assignments.set(manager.id, []));
  if (managers.length === 0) return assignments;

  const generalManagerIndexes = managers
    .map((manager, managerIndex) =>
      options.getLeaderUnitIds(manager).length === 0 ? managerIndex : -1
    )
    .filter((managerIndex) => managerIndex >= 0);

  reportGroups.forEach((group, groupIndex) => {
    const groupUsers = collectUsersFromPersonNodes(group);
    const matchingManagerIndex = managers.findIndex((manager) => {
      const managerUnitIds = options.getLeaderUnitIds(manager);
      return (
        managerUnitIds.length > 0 &&
        groupUsers.some((user) => intersects(options.getUserUnitIds(user), managerUnitIds))
      );
    });

    const targetIndex =
      matchingManagerIndex >= 0
        ? matchingManagerIndex
        : managers.length === 1
          ? 0
          : generalManagerIndexes.length > 0
            ? generalManagerIndexes[groupIndex % generalManagerIndexes.length]
            : groupIndex % managers.length;

    const manager = managers[targetIndex];
    assignments.get(manager.id)?.push(...group);
  });

  return assignments;
}

function buildRoleUserNodes(
  role: JobRole,
  users: User[],
  childRoleGroups: PersonTreeNode[][],
  options: PersonTreeOptions,
  depth: number
) {
  if (users.length === 0) return [];

  const rankedUsers = users.map((user) => ({
    user,
    rank: options.getFunctionHierarchyRank(user),
  }));
  const maxRank = Math.max(...rankedUsers.map((item) => item.rank));
  const hasLowerFunctionLevel = maxRank > 0 && rankedUsers.some((item) => item.rank < maxRank);
  const managers = hasLowerFunctionLevel
    ? rankedUsers.filter((item) => item.rank === maxRank).map((item) => item.user)
    : users;
  const lowerFunctionGroups = hasLowerFunctionLevel
    ? buildRoleUserNodes(
      role,
      rankedUsers.filter((item) => item.rank < maxRank).map((item) => item.user),
      [],
      options,
      depth + 1
    ).map((node) => [node])
    : [];
  const assignments = assignReportGroupsToManagers(
    managers,
    [...lowerFunctionGroups, ...childRoleGroups],
    options
  );

  return managers.map((user) =>
    createPersonNode(user, role, assignments.get(user.id) ?? [], depth)
  );
}

function buildPersonTree(
  roleNodes: OrgRoleNode[],
  options: PersonTreeOptions,
  depth = 0
): PersonTreeNode[] {
  return roleNodes.flatMap<PersonTreeNode>((node) => {
    const childGroups = node.children.map((child) => buildPersonTree([child], options, depth + 1));

    if (node.directUsers.length === 0) {
      const directReports = childGroups.flat();
      return [{
        id: `role:${node.role.id}`,
        user: null,
        role: node.role,
        directReports,
        totalReports: countPersonReports(directReports),
        depth,
      }];
    }

    return buildRoleUserNodes(node.role, node.directUsers, childGroups, options, depth);
  });
}

function collectPersonIds(nodes: PersonTreeNode[]) {
  const ids: string[] = [];
  function walk(list: PersonTreeNode[]) {
    for (const node of list) {
      ids.push(node.id);
      walk(node.directReports);
    }
  }
  walk(nodes);
  return ids;
}

function levelLabel(depth: number) {
  return LEVEL_LABELS[depth] ?? `Nível ${depth + 1}`;
}

function getUserPhone(user: User) {
  const withPhone = user as User & {
    phone?: string;
    phoneNumber?: string;
    whatsapp?: string;
    telefone?: string;
  };
  return withPhone.phone ?? withPhone.phoneNumber ?? withPhone.whatsapp ?? withPhone.telefone ?? "";
}

function roleFunctionNames(role: JobRole, functions: JobFunction[]) {
  return functions
    .filter((item) => (item.compatibleRoleIds ?? []).includes(role.id))
    .map((item) => item.name)
    .sort((left, right) => left.localeCompare(right, "pt-BR"));
}

function normalizeOrgText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function functionLabels(item: JobFunction) {
  return [item.name, item.publicTitle, item.slug]
    .map(normalizeOrgText)
    .filter(Boolean);
}

function getUserFunctionIds(user: User, functions: JobFunction[]) {
  const ids = new Set((user.jobFunctionIds ?? []).filter(Boolean));
  const userFunctionNames = new Set((user.jobFunctionNames ?? []).map(normalizeOrgText).filter(Boolean));

  if (userFunctionNames.size === 0) return Array.from(ids);

  for (const item of functions) {
    if (functionLabels(item).some((label) => userFunctionNames.has(label))) {
      ids.add(item.id);
    }
  }

  return Array.from(ids);
}

function getUserFunctionTexts(user: User, functionsById: Map<string, JobFunction>, functionIds: string[]) {
  const values = new Set((user.jobFunctionNames ?? []).map(normalizeOrgText).filter(Boolean));

  for (const functionId of functionIds) {
    const item = functionsById.get(functionId);
    if (!item) continue;
    functionLabels(item).forEach((label) => values.add(label));
  }

  return Array.from(values);
}

function createFunctionHierarchyRankGetter(functions: JobFunction[]) {
  const functionsById = new Map(functions.map((item) => [item.id, item]));
  const childIdsByParentId = new Map<string, string[]>();

  for (const item of functions) {
    if (!item.parentId || !functionsById.has(item.parentId)) continue;
    const childIds = childIdsByParentId.get(item.parentId) ?? [];
    childIds.push(item.id);
    childIdsByParentId.set(item.parentId, childIds);
  }

  const rankByFunctionId = new Map<string, number>();

  function functionRank(functionId: string, lineage = new Set<string>()): number {
    if (rankByFunctionId.has(functionId)) return rankByFunctionId.get(functionId)!;
    if (lineage.has(functionId)) return 0;

    const nextLineage = new Set(lineage);
    nextLineage.add(functionId);
    const childRanks = (childIdsByParentId.get(functionId) ?? []).map((childId) =>
      functionRank(childId, nextLineage)
    );
    const rank = childRanks.length === 0 ? 0 : 1 + Math.max(...childRanks);
    rankByFunctionId.set(functionId, rank);
    return rank;
  }

  return (user: User) => {
    const functionIds = getUserFunctionIds(user, functions);
    const structuralRank = functionIds.reduce(
      (rank, functionId) => Math.max(rank, functionRank(functionId)),
      0
    );
    const functionTexts = getUserFunctionTexts(user, functionsById, functionIds);
    const leadershipRank = functionTexts.some((value) =>
      /\b(lider|supervisor|coordenador|gerente|diretor|encarregado|responsavel)\b/.test(value)
    )
      ? 1
      : 0;

    return Math.max(structuralRank, leadershipRank);
  };
}

function resolveUnitReferenceIds(reference: string, units: DPUnit[]) {
  if (!reference) return [];
  if (units.some((unit) => unit.id === reference)) return [reference];

  const matchedUnit = units.length > 0 ? matchDPUnitForKiosk(reference, units) : undefined;
  return matchedUnit ? [reference, matchedUnit.id] : [reference];
}

function getCanonicalUnitReference(reference: string, units: DPUnit[]) {
  if (!reference) return reference;
  if (units.some((unit) => unit.id === reference)) return reference;
  return matchDPUnitForKiosk(reference, units)?.id ?? reference;
}

function getUserUnitIds(user: User, units: DPUnit[] = []) {
  const ids = new Set<string>();

  for (const unitId of user.unitIds ?? []) {
    resolveUnitReferenceIds(unitId, units).forEach((id) => ids.add(id));
  }

  for (const kioskId of user.assignedKioskIds ?? []) {
    resolveUnitReferenceIds(kioskId, units).forEach((id) => ids.add(id));
  }

  return Array.from(ids);
}

function getUserUnitNames(user: User, units: DPUnit[]) {
  const unitNameById = new Map(units.map((unit) => [unit.id, unit.name]));
  const unitIds = new Set<string>();

  for (const unitId of user.unitIds ?? []) {
    unitIds.add(getCanonicalUnitReference(unitId, units));
  }

  for (const kioskId of user.assignedKioskIds ?? []) {
    unitIds.add(getCanonicalUnitReference(kioskId, units));
  }

  const names = Array.from(unitIds).map((unitId) => unitNameById.get(unitId) ?? unitId);
  return names.length > 0 ? names : ["Sem unidade"];
}

function getLeaderUnitIds(user: User, units: DPUnit[] = []) {
  if (user.responsibleUnitIds !== undefined) {
    return Array.from(
      new Set(
        user.responsibleUnitIds.flatMap((unitId) => resolveUnitReferenceIds(unitId, units))
      )
    );
  }
  return [];
}

function displayFunctionBadges(names: string[]) {
  if (names.length === 0) return ["Sem função"];
  return names.slice(0, 2);
}

function StatCard({
  title,
  value,
  hint,
  icon: Icon,
  tone = "slate",
}: {
  title: string;
  value: number;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "slate" | "pink" | "emerald" | "sky";
}) {
  const toneClass = {
    slate: "text-slate-950",
    pink: "text-pink-600",
    emerald: "text-emerald-600",
    sky: "text-sky-600",
  }[tone];

  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{title}</p>
        <p className={cn("mt-1 text-3xl font-bold leading-none", toneClass)}>{value}</p>
        <p className="mt-2 text-[11px] text-slate-400">{hint}</p>
      </div>
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200 bg-slate-50 text-slate-500">
        <Icon className="h-5 w-5" />
      </div>
    </div>
  );
}

function CollaboratorPill({
  user,
  units,
  onSelect,
  selected = false,
}: {
  user: User;
  units?: DPUnit[];
  onSelect?: (user: User) => void;
  selected?: boolean;
}) {
  const unitNames = units ? getUserUnitNames(user, units) : [];
  const content = (
    <>
      <Avatar className="h-10 w-10 shrink-0 border-2 border-white shadow-sm">
        <AvatarImage src={user.avatarUrl || undefined} alt={user.username} />
        <AvatarFallback className="bg-amber-100 text-xs font-bold text-amber-600">{initials(user.username)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 text-left">
        <p className="truncate text-sm font-bold text-slate-950">{user.username}</p>
        <p className="truncate text-xs text-slate-500">{user.email}</p>
        <p className="truncate text-xs text-slate-400">
          {summarizeFunctions(user.jobFunctionNames)}
        </p>
        {unitNames.length > 0 ? (
          <p className="mt-0.5 truncate text-[11px] font-medium text-sky-600">
            {unitNames.join(", ")}
          </p>
        ) : null}
      </div>
    </>
  );

  if (!onSelect) {
    return (
      <div className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(user)}
      className={cn(
        "flex min-w-0 items-center gap-3 rounded-xl border bg-white px-3 py-2.5 shadow-sm transition",
        selected
          ? "border-pink-300 ring-2 ring-pink-100"
          : "border-slate-200 hover:border-pink-200 hover:bg-pink-50/30"
      )}
    >
      {content}
    </button>
  );
}

function PersonTreeCard({
  node,
  selected,
  expanded,
  functionsByRoleId,
  units,
  onSelect,
  onToggle,
}: {
  node: PersonTreeNode;
  selected: boolean;
  expanded: boolean;
  functionsByRoleId: Map<string, string[]>;
  units: DPUnit[];
  onSelect: (user: User) => void;
  onToggle: () => void;
}) {
  const tone = ORG_TONES[Math.min(node.depth, ORG_TONES.length - 1)];
  const hasChildren = node.directReports.length > 0;
  const isVacant = !node.user;
  const userFunctionNames = node.user?.jobFunctionNames?.filter(Boolean) ?? [];
  const compatibleFunctionNames = functionsByRoleId.get(node.role.id) ?? [];
  const effectiveFunctionNames = node.user ? userFunctionNames : compatibleFunctionNames;
  const functionLine = summarizeFunctions(effectiveFunctionNames);
  const unitNames = node.user ? getUserUnitNames(node.user, units) : [];

  return (
    <div className="relative flex flex-col items-center">
      <button
        type="button"
        onClick={() => node.user && onSelect(node.user)}
        disabled={!node.user}
        className={cn(
          "w-48 overflow-hidden rounded-2xl border bg-white text-center shadow-sm transition",
          selected
            ? "border-pink-400 shadow-pink-100 ring-2 ring-pink-300"
            : node.user
              ? "border-slate-200 hover:-translate-y-0.5 hover:border-pink-200 hover:shadow-md"
              : "border-dashed border-slate-300 bg-slate-50"
        )}
      >
        <div className={cn("flex h-12 items-center justify-center border-b", tone.header)}>
          {node.user ? (
            <Avatar className="h-9 w-9 border-2 border-white shadow-sm">
              <AvatarImage src={node.user.avatarUrl || undefined} alt={node.user.username} />
              <AvatarFallback
                className="text-xs font-bold"
                style={node.user.color ? { backgroundColor: node.user.color, color: "#fff" } : undefined}
              >
                {initials(node.user.username)}
              </AvatarFallback>
            </Avatar>
          ) : (
            <span className="grid h-9 w-9 place-items-center rounded-full border-2 border-white bg-white text-[10px] font-bold text-slate-400 shadow-sm">
              Vago
            </span>
          )}
        </div>
        <div className="px-3 py-3">
          <p className="truncate text-xs font-bold text-slate-950">{node.user?.username ?? "Cargo vago"}</p>
          <p className="mt-0.5 truncate text-[11px] text-slate-500">{node.role.publicTitle || node.role.name}</p>
          <p
            className={cn(
              "mt-1 truncate text-[10px] font-bold",
              effectiveFunctionNames.length === 0
                ? "text-slate-400"
                : isVacant
                  ? "text-sky-700"
                  : "text-emerald-700"
            )}
          >
            {functionLine}
          </p>
          {unitNames.length > 0 ? (
            <p className="mt-1 truncate text-[10px] font-bold uppercase tracking-wide text-sky-600">
              {unitNames.join(", ")}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap justify-center gap-1">
            <span className={cn(
              "rounded-full border px-2 py-0.5 text-[9px] font-bold",
              isVacant
                ? "border-amber-200 bg-amber-50 text-amber-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
            )}>
              {isVacant ? "Vago" : "Ativo"}
            </span>
          </div>
        </div>
      </button>

      {hasChildren && (
        <button
          type="button"
          onClick={onToggle}
          className="absolute -bottom-3 grid h-6 w-6 place-items-center rounded-full border border-slate-200 bg-white text-slate-400 shadow-sm transition hover:border-pink-200 hover:text-pink-600"
          aria-label={expanded ? "Recolher reportes" : "Expandir reportes"}
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
      )}
    </div>
  );
}

function PersonTreeNodeView({
  node,
  expandedIds,
  selectedUserId,
  forceExpand,
  functionsByRoleId,
  units,
  onToggle,
  onSelect,
}: {
  node: PersonTreeNode;
  expandedIds: Set<string>;
  selectedUserId: string | null;
  forceExpand: boolean;
  functionsByRoleId: Map<string, string[]>;
  units: DPUnit[];
  onToggle: (id: string) => void;
  onSelect: (user: User) => void;
}) {
  const hasChildren = node.directReports.length > 0;
  const expanded = forceExpand || expandedIds.has(node.id);

  return (
    <div className="flex flex-col items-center">
      <PersonTreeCard
        node={node}
        selected={!!node.user && selectedUserId === node.user.id}
        expanded={expanded}
        functionsByRoleId={functionsByRoleId}
        units={units}
        onSelect={onSelect}
        onToggle={() => onToggle(node.id)}
      />

      {hasChildren && expanded && (
        <>
          <div className="h-7 w-px border-l border-slate-200" />
          <div className="relative flex gap-8">
            {node.directReports.length > 1 && (
              <div className="absolute left-20 right-20 top-0 border-t border-slate-200" />
            )}
            {node.directReports.map((child) => (
              <div key={child.id} className="flex flex-col items-center">
                <div className="h-7 w-px border-l border-slate-200" />
                <PersonTreeNodeView
                  node={child}
                  expandedIds={expandedIds}
                  selectedUserId={selectedUserId}
                  forceExpand={forceExpand}
                  functionsByRoleId={functionsByRoleId}
                  units={units}
                  onToggle={onToggle}
                  onSelect={onSelect}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function UserDetailPanel({
  detail,
  units,
  onClose,
  onSelectUser,
}: {
  detail: UserDetail;
  units: DPUnit[];
  onClose: () => void;
  onSelectUser: (user: User) => void;
}) {
  const phone = getUserPhone(detail.user);
  const department = detail.role?.departmentName ?? "Sem departamento";
  const unitNames = getUserUnitNames(detail.user, units);
  const responsibleUnitNames =
    detail.user.responsibleUnitIds && detail.user.responsibleUnitIds.length > 0
      ? detail.user.responsibleUnitIds.map((unitId) => units.find((unit) => unit.id === unitId)?.name ?? unitId)
      : [];

  return (
    <aside className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)]">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-bold text-slate-950">Detalhe</h3>
        <button
          type="button"
          onClick={onClose}
          className="grid h-8 w-8 place-items-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-900"
          aria-label="Fechar detalhe"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="bg-pink-50 px-5 py-6 text-center">
        <Avatar className="mx-auto h-16 w-16 border-4 border-white shadow-sm">
          <AvatarImage src={detail.user.avatarUrl || undefined} alt={detail.user.username} />
          <AvatarFallback
            className="text-lg font-bold"
            style={detail.user.color ? { backgroundColor: detail.user.color, color: "#fff" } : undefined}
          >
            {initials(detail.user.username)}
          </AvatarFallback>
        </Avatar>
        <h3 className="mt-3 truncate text-lg font-bold text-slate-950">{detail.user.username}</h3>
        <p className="truncate text-sm text-slate-500">
          {detail.role?.publicTitle || detail.user.jobRoleName || detail.role?.name || "Sem cargo"}
        </p>
        <p className="mt-1 truncate text-xs font-bold uppercase tracking-wide text-sky-700">
          {unitNames.join(", ")}
        </p>
        <div className="mt-3 flex justify-center gap-2">
          <span className="rounded-full border border-pink-200 bg-white/70 px-3 py-1 text-xs font-bold text-pink-700">
            {department}
          </span>
          <span className="rounded-full border border-emerald-200 bg-white/70 px-3 py-1 text-xs font-bold text-emerald-700">
            Ativo
          </span>
        </div>
      </div>

      <div className="divide-y divide-slate-100">
        {detail.manager && (
          <div className="px-5 py-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Reporta para</p>
            <button
              type="button"
              onClick={() => onSelectUser(detail.manager!)}
              className="mt-2 flex w-full items-center gap-3 rounded-xl p-2 text-left transition hover:bg-slate-50"
            >
              <Avatar className="h-8 w-8">
                <AvatarImage src={detail.manager.avatarUrl || undefined} alt={detail.manager.username} />
                <AvatarFallback className="bg-amber-100 text-[10px] font-bold text-amber-600">
                  {initials(detail.manager.username)}
                </AvatarFallback>
              </Avatar>
              <span className="truncate text-sm font-bold text-slate-800">{detail.manager.username}</span>
            </button>
          </div>
        )}

        <div className="px-5 py-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Responsabilidade</p>
          <p className="mt-2 text-sm text-slate-600">
            {responsibleUnitNames.length > 0
              ? responsibleUnitNames.join(", ")
              : "Geral / unidades remanescentes"}
          </p>
        </div>

        <div className="px-5 py-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Reportes diretos · {detail.directReports.length}
          </p>
          <div className="mt-3 space-y-2">
            {detail.directReports.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhum reporte direto no filtro atual.</p>
            ) : (
              detail.directReports.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => onSelectUser(user)}
                  className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition hover:bg-slate-50"
                >
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={user.avatarUrl || undefined} alt={user.username} />
                    <AvatarFallback className="bg-emerald-100 text-[10px] font-bold text-emerald-600">
                      {initials(user.username)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-800">{user.username}</p>
                    <p className="truncate text-xs text-slate-400">{user.jobRoleName || "Sem cargo"}</p>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="space-y-3 px-5 py-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Contato</p>
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Mail className="h-4 w-4 text-slate-400" />
            <span className="min-w-0 truncate">{detail.user.email || "Sem e-mail cadastrado"}</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Phone className="h-4 w-4 text-slate-400" />
            <span className="min-w-0 truncate">{phone || "Sem telefone cadastrado"}</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

export function DPOrgChart() {
  const { activeUsers } = useAuth();
  const { roles, functions, units, loading, error, refresh, access } = useHrBootstrap();

  const [viewMode, setViewMode] = React.useState<OrgViewMode>("tree");
  const [query, setQuery] = React.useState("");
  const [showInactiveRoles, setShowInactiveRoles] = React.useState(false);
  const [showEmptyRoles, setShowEmptyRoles] = React.useState(true);
  const [selectedUserId, setSelectedUserId] = React.useState<string | null>(null);
  const [zoom, setZoom] = React.useState(0.76);
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  const [expandedPersonIds, setExpandedPersonIds] = React.useState<Set<string>>(new Set());
  const [expandedListRoleIds, setExpandedListRoleIds] = React.useState<Set<string>>(new Set());
  const panStartRef = React.useRef<{ pointerId: number; x: number; y: number; panX: number; panY: number } | null>(null);
  const initializedExpansionRef = React.useRef(false);

  const usersInScope = React.useMemo(
    () => activeUsers.filter((user) => user.isActive !== false).sort(byName),
    [activeUsers]
  );

  const chart = React.useMemo(
    () =>
      buildOrgChart({
        roles,
        users: usersInScope,
        query,
        showInactiveRoles,
        showEmptyRoles,
      }),
    [query, roles, showInactiveRoles, showEmptyRoles, usersInScope]
  );

  const flatRoles = React.useMemo(() => flattenOrgRoles(chart.roots), [chart.roots]);
  const getFunctionHierarchyRank = React.useMemo(
    () => createFunctionHierarchyRankGetter(functions),
    [functions]
  );
  const personRoots = React.useMemo(
    () => buildPersonTree(chart.roots, {
      getUserUnitIds: (user) => getUserUnitIds(user, units),
      getLeaderUnitIds: (user) => getLeaderUnitIds(user, units),
      getFunctionHierarchyRank,
    }),
    [chart.roots, getFunctionHierarchyRank, units]
  );
  const flatPersonNodes = React.useMemo(() => flattenPersonNodes(personRoots), [personRoots]);
  const allPersonIds = React.useMemo(() => collectPersonIds(personRoots), [personRoots]);
  const functionsByRoleId = React.useMemo(() => {
    const map = new Map<string, string[]>();
    for (const role of roles) {
      map.set(role.id, roleFunctionNames(role, functions));
    }
    return map;
  }, [functions, roles]);

  const departmentGroups = React.useMemo(() => {
    const groups = new Map<string, { name: string; items: FlatOrgRole[]; userCount: number }>();
    for (const item of flatRoles) {
      const name = item.node.role.departmentName || "Sem departamento";
      const current = groups.get(name) ?? { name, items: [], userCount: 0 };
      current.items.push(item);
      current.userCount += item.node.directUsers.length;
      groups.set(name, current);
    }
    return Array.from(groups.values()).sort((a, b) => {
      if (a.name === "Sem departamento") return 1;
      if (b.name === "Sem departamento") return -1;
      return a.name.localeCompare(b.name, "pt-BR");
    });
  }, [flatRoles]);

  const personLevelGroups = React.useMemo(() => {
    const groups = new Map<number, { depth: number; label: string; items: FlatPersonNode[]; userCount: number }>();
    for (const item of flatPersonNodes) {
      const current = groups.get(item.depth) ?? {
        depth: item.depth,
        label: levelLabel(item.depth),
        items: [],
        userCount: 0,
      };
      current.items.push(item);
      current.userCount += item.node.user ? 1 : 0;
      groups.set(item.depth, current);
    }
    return Array.from(groups.values()).sort((a, b) => a.depth - b.depth);
  }, [flatPersonNodes]);

  const personIndex = React.useMemo(() => {
    const nodeByUserId = new Map<string, PersonTreeNode>();
    const managerByUserId = new Map<string, User | null>();

    function walk(nodes: PersonTreeNode[], manager: User | null) {
      for (const node of nodes) {
        if (node.user) {
          nodeByUserId.set(node.user.id, node);
          managerByUserId.set(node.user.id, manager);
        }
        walk(node.directReports, node.user ?? manager);
      }
    }

    walk(personRoots, null);
    return { nodeByUserId, managerByUserId };
  }, [personRoots]);

  const userById = React.useMemo(
    () => new Map(usersInScope.map((user) => [user.id, user])),
    [usersInScope]
  );

  const selectedUserDetail = React.useMemo<UserDetail | null>(() => {
    if (!selectedUserId) return null;
    const user = userById.get(selectedUserId);
    if (!user) return null;

    const node = personIndex.nodeByUserId.get(user.id);
    const role = node?.role ?? roles.find((item) => item.id === user.jobRoleId) ?? null;

    return {
      user,
      role,
      manager: personIndex.managerByUserId.get(user.id) ?? null,
      directReports: node?.directReports.flatMap((item) => item.user ? [item.user] : []) ?? [],
    };
  }, [personIndex, roles, selectedUserId, userById]);

  React.useEffect(() => {
    if (!initializedExpansionRef.current && personRoots.length > 0) {
      setExpandedPersonIds(new Set(personRoots.map((node) => node.id)));
      initializedExpansionRef.current = true;
    }
  }, [personRoots]);

  React.useEffect(() => {
    if (selectedUserId && !userById.has(selectedUserId)) {
      setSelectedUserId(null);
    }
  }, [selectedUserId, userById]);

  const handleSelectUser = React.useCallback((user: User) => {
    setSelectedUserId(user.id);
  }, []);

  const togglePersonExpand = React.useCallback((id: string) => {
    setExpandedPersonIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleListRole = React.useCallback((id: string) => {
    setExpandedListRoleIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleExpandAll = React.useCallback(() => {
    setExpandedPersonIds(new Set(allPersonIds));
  }, [allPersonIds]);

  const handleCollapseAll = React.useCallback(() => {
    setExpandedPersonIds(new Set());
  }, []);

  const resetTreeView = React.useCallback(() => {
    setZoom(0.76);
    setPan({ x: 0, y: 0 });
  }, []);

  const handleTreeWheel = React.useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.08 : 0.92;
    setZoom((current) => Math.min(Math.max(current * factor, 0.45), 1.6));
  }, []);

  const handlePanPointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, input, select, textarea, a")) return;

    panStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [pan.x, pan.y]);

  const handlePanPointerMove = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const start = panStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    setPan({
      x: start.panX + event.clientX - start.x,
      y: start.panY + event.clientY - start.y,
    });
  }, []);

  const handlePanPointerEnd = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (panStartRef.current?.pointerId !== event.pointerId) return;
    panStartRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  const renderFlatRole = (item: FlatOrgRole, index: number) => {
    const tone = ORG_TONES[Math.min(item.depth, ORG_TONES.length - 1)];
    const roleFunctions = functionsByRoleId.get(item.node.role.id) ?? [];
    const hasUsers = item.node.directUsers.length > 0;
    const listExpanded = expandedListRoleIds.has(item.node.role.id);
    return (
      <div
        key={item.node.role.id}
        className="border-b border-slate-100 px-4 py-3 last:border-b-0"
        style={{ paddingLeft: `${16 + item.depth * 28}px` }}
      >
        <div className="flex flex-col gap-3">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className={cn("h-2 w-2 shrink-0 rounded-full", tone.dot)} />
              <span className="w-7 shrink-0 text-right font-mono text-[11px] text-slate-400">{index + 1}</span>
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-bold text-slate-950">{item.node.role.name}</p>
                  {item.node.role.departmentName ? (
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", tone.badge)}>
                      {item.node.role.departmentName}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 truncate text-xs text-slate-500">{item.node.role.publicTitle || item.node.role.name}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {displayFunctionBadges(roleFunctions).map((name) => (
                    <span
                      key={name}
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px] font-bold",
                        name === "Sem função"
                          ? "border-slate-200 bg-slate-50 text-slate-400"
                          : "border-emerald-200 bg-emerald-50 text-emerald-700"
                      )}
                    >
                      {name}
                    </span>
                  ))}
                  {roleFunctions.length > 2 ? (
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold text-slate-400">
                      +{roleFunctions.length - 2}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
            {hasUsers ? (
              <button
                type="button"
                onClick={() => toggleListRole(item.node.role.id)}
                className="flex shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-600 transition hover:border-pink-200 hover:text-pink-700"
                aria-expanded={listExpanded}
              >
                {item.node.directUsers.length} ocupante{item.node.directUsers.length === 1 ? "" : "s"}
                {listExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
            ) : (
              <span className="shrink-0 rounded-full border border-dashed border-slate-200 px-3 py-1 text-xs font-bold text-slate-400">
                Sem colaborador direto
              </span>
            )}
          </div>

          {hasUsers && listExpanded ? (
            <div className="ml-12 flex flex-wrap gap-2 rounded-xl border border-slate-100 bg-slate-50/60 p-2">
              {item.node.directUsers.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => handleSelectUser(user)}
                  className={cn(
                    "max-w-full truncate rounded-full border px-3 py-1 text-xs font-bold transition",
                    selectedUserId === user.id
                      ? "border-pink-300 bg-pink-50 text-pink-700 ring-2 ring-pink-100"
                      : "border-slate-200 bg-white text-slate-700 hover:border-pink-200 hover:text-pink-700"
                  )}
                >
                  {user.username}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-36 w-full" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-28 w-full" />
          ))}
        </div>
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Organograma indisponível</CardTitle>
          <CardDescription>
            Não foi possível carregar a base de cargos neste momento.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{error}</p>
          <button
            type="button"
            onClick={() => void refresh()}
            className="text-sm font-medium text-primary hover:underline"
          >
            Tentar novamente
          </button>
        </CardContent>
      </Card>
    );
  }

  if (!access.canView) {
    return (
      <p className="rounded-lg border p-6 text-sm text-muted-foreground">
        Sem permissão para acessar o organograma.
      </p>
    );
  }

  if (roles.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Nenhum cargo cadastrado</CardTitle>
          <CardDescription>
            O organograma depende do catálogo de cargos e da vinculação dos colaboradores.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Cadastre cargos em <strong>Cargos e funções</strong> e depois vincule os colaboradores para montar a hierarquia.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-3">
        <StatCard
          title="Pessoas"
          value={chart.assignedUsersCount}
          hint="na estrutura"
          icon={Users2}
          tone="slate"
        />
        <StatCard
          title="Níveis"
          value={personLevelGroups.length}
          hint="hierárquicos"
          icon={Workflow}
          tone="pink"
        />
        <StatCard
          title="Depts."
          value={departmentGroups.length}
          hint="formais"
          icon={Briefcase}
          tone="sky"
        />
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex w-full flex-wrap gap-1 rounded-2xl bg-slate-100/70 p-1 lg:w-auto">
          {([
            { value: "tree", label: "Árvore" },
            { value: "list", label: "Lista" },
            { value: "departments", label: "Departamentos" },
            { value: "levels", label: "Níveis" },
          ] as const).map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setViewMode(item.value)}
              className={cn(
                "rounded-xl px-4 py-2 text-sm font-semibold transition",
                viewMode === item.value
                  ? "bg-white text-slate-950 shadow-sm"
                  : "text-slate-500 hover:bg-white/70 hover:text-slate-900"
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="relative w-full lg:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar pessoa ou cargo."
            className="h-11 rounded-xl border-slate-200 bg-white pl-9 shadow-sm placeholder:text-slate-400 focus-visible:ring-pink-200"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-slate-500">
          <Switch checked={showEmptyRoles} onCheckedChange={setShowEmptyRoles} />
          Mostrar cargos sem colaboradores
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-500">
          <Switch checked={showInactiveRoles} onCheckedChange={setShowInactiveRoles} />
          Mostrar cargos inativos
        </label>
      </div>

      {chart.detachedRoleCount > 0 && (
        <Card className="border-amber-200 bg-amber-50/70">
          <CardContent className="flex items-start gap-3 p-4">
            <ShieldAlert className="mt-0.5 h-5 w-5 text-amber-700" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-amber-900">
                {chart.detachedRoleCount} cargo{chart.detachedRoleCount === 1 ? "" : "s"} sem hierarquia definida.
              </p>
              <p className="text-sm text-amber-800">
                {chart.detachedRoleCount === 1 ? "Esse cargo aponta" : "Esses cargos apontam"} para um superior inexistente ou removido. Corrija em <strong>Cargos e funções</strong>.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className={cn("grid gap-4", selectedUserDetail && "xl:grid-cols-[minmax(0,1fr)_320px]")}>
        <div className="min-w-0 space-y-4">
          {viewMode === "tree" && (
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCollapseAll}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
                  >
                    Recolher
                  </button>
                  <button
                    type="button"
                    onClick={handleExpandAll}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
                  >
                    Expandir
                  </button>
                  <p className="text-sm text-slate-400">scroll para zoom · arraste para mover · clique num cartão para detalhe</p>
                </div>
                <div className="flex items-center rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
                  <button
                    type="button"
                    onClick={() => setZoom((current) => Math.max(current - 0.1, 0.45))}
                    className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-950"
                    aria-label="Diminuir zoom"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="w-12 text-center text-xs font-bold tabular-nums text-slate-500">{Math.round(zoom * 100)}%</span>
                  <button
                    type="button"
                    onClick={() => setZoom((current) => Math.min(current + 0.1, 1.6))}
                    className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-950"
                    aria-label="Aumentar zoom"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                  <div className="mx-1 h-5 w-px bg-slate-200" />
                  <button
                    type="button"
                    onClick={resetTreeView}
                    className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-950"
                    aria-label="Centralizar árvore"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div
                className="min-h-[640px] cursor-grab overflow-hidden bg-[radial-gradient(circle_at_1px_1px,rgba(236,72,153,0.12)_1px,transparent_0)] bg-[length:24px_24px] p-10 active:cursor-grabbing xl:min-h-[720px]"
                onWheel={handleTreeWheel}
                onPointerDown={handlePanPointerDown}
                onPointerMove={handlePanPointerMove}
                onPointerUp={handlePanPointerEnd}
                onPointerCancel={handlePanPointerEnd}
              >
                {personRoots.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-white/80 p-6 text-sm text-slate-500">
                    Nenhum colaborador corresponde aos filtros atuais.
                  </div>
                ) : (
                  <div
                    className="flex min-w-max justify-center gap-12"
                    style={{
                      transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                      transformOrigin: "top center",
                    }}
                  >
                    {personRoots.map((node) => (
                      <PersonTreeNodeView
                        key={node.id}
                        node={node}
                        expandedIds={expandedPersonIds}
                        selectedUserId={selectedUserId}
                        forceExpand={query.trim().length > 0}
                        functionsByRoleId={functionsByRoleId}
                        units={units}
                        onToggle={togglePersonExpand}
                        onSelect={handleSelectUser}
                      />
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          {viewMode === "list" && (
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-4 py-3">
                <h3 className="text-sm font-bold text-slate-950">Lista hierárquica</h3>
                <p className="mt-1 text-xs text-slate-500">Cargos ordenados por profundidade e reporting line.</p>
              </div>
              {flatRoles.length === 0 ? (
                <div className="p-6 text-sm text-slate-500">Nenhum cargo no filtro atual.</div>
              ) : (
                flatRoles.map(renderFlatRole)
              )}
            </section>
          )}

          {viewMode === "departments" && (
            <div className="space-y-4">
              {departmentGroups.map((group, groupIndex) => {
                const tone = ORG_TONES[groupIndex % ORG_TONES.length];
                return (
                  <section key={group.name} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <div className={cn("flex items-center justify-between gap-3 border-b px-5 py-4", tone.header)}>
                      <div className="flex min-w-0 items-center gap-3">
                        <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-sm font-bold text-white", tone.dot)}>
                          {group.name.slice(0, 3).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <h3 className="truncate text-lg font-bold">{group.name}</h3>
                          <p className="text-sm opacity-80">{group.items.length} cargos · {group.userCount} pessoas</p>
                        </div>
                      </div>
                      <span className="shrink-0 text-sm font-bold">{group.userCount} pessoa{group.userCount === 1 ? "" : "s"}</span>
                    </div>
                    <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
                      {group.items.map(({ node }) => {
                        const roleFunctions = functionsByRoleId.get(node.role.id) ?? [];
                        return (
                          <div key={node.role.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-bold text-slate-950">{node.role.name}</p>
                                <p className="truncate text-xs text-slate-500">{node.role.publicTitle || node.role.name}</p>
                              </div>
                              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                                {node.directUsers.length}
                              </span>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1">
                              {displayFunctionBadges(roleFunctions).map((name) => (
                                <span
                                  key={name}
                                  className={cn(
                                    "rounded-full border px-2 py-0.5 text-[10px] font-bold",
                                    name === "Sem função"
                                      ? "border-slate-200 bg-slate-50 text-slate-400"
                                      : "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  )}
                                >
                                  {name}
                                </span>
                              ))}
                              {roleFunctions.length > 2 ? (
                                <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold text-slate-400">
                                  +{roleFunctions.length - 2}
                                </span>
                              ) : null}
                            </div>
                            {node.directUsers.length > 0 ? (
                              <div className="mt-3 space-y-2">
                                {node.directUsers.slice(0, 2).map((user) => (
                                  <CollaboratorPill
                                    key={user.id}
                                    user={user}
                                    units={units}
                                    onSelect={handleSelectUser}
                                    selected={selectedUserId === user.id}
                                  />
                                ))}
                                {node.directUsers.length > 2 ? (
                                  <p className="text-xs font-medium text-slate-400">+{node.directUsers.length - 2} pessoa{node.directUsers.length - 2 === 1 ? "" : "s"}</p>
                                ) : null}
                              </div>
                            ) : (
                              <p className="mt-3 text-xs text-slate-400">Sem colaborador direto.</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          {viewMode === "levels" && (
            <div className="space-y-4">
              {personLevelGroups.map((group, groupIndex) => {
                const tone = ORG_TONES[groupIndex % ORG_TONES.length];
                const percent = usersInScope.length > 0 ? Math.round((group.userCount / usersInScope.length) * 100) : 0;
                return (
                  <section key={group.depth} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <div className={cn("flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4", tone.header)}>
                      <div className="flex min-w-0 items-center gap-3">
                        <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold text-white", tone.dot)}>
                          {group.depth + 1}
                        </span>
                        <div className="min-w-0">
                          <h3 className="truncate text-lg font-bold">{group.label}</h3>
                          <p className="text-sm opacity-80">{group.userCount} pessoas · {group.items.length} posições</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="hidden h-2 w-40 rounded-full bg-white/50 md:block">
                          <div className={cn("h-full rounded-full", tone.progress)} style={{ width: `${Math.max(6, percent)}%` }} />
                        </div>
                        <span className="text-sm font-bold">{percent}%</span>
                      </div>
                    </div>
                    <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
                      {group.items.map(({ node }) => {
                        const roleFunctions = node.user
                          ? node.user.jobFunctionNames ?? []
                          : functionsByRoleId.get(node.role.id) ?? [];
                        return (
                          <div key={node.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-bold text-slate-950">{node.user?.username ?? "Cargo vago"}</p>
                                <p className="truncate text-xs text-slate-500">{node.role.publicTitle || node.role.name}</p>
                              </div>
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                                {node.totalReports}
                              </span>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1">
                              {displayFunctionBadges(roleFunctions).map((name) => (
                                <span
                                  key={name}
                                  className={cn(
                                    "rounded-full border px-2 py-0.5 text-[10px] font-bold",
                                    name === "Sem função"
                                      ? "border-slate-200 bg-slate-50 text-slate-400"
                                      : "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  )}
                                >
                                  {name}
                                </span>
                              ))}
                              {roleFunctions.length > 2 ? (
                                <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold text-slate-400">
                                  +{roleFunctions.length - 2}
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-3 space-y-2">
                              {node.user ? (
                                <CollaboratorPill
                                  user={node.user}
                                  units={units}
                                  onSelect={handleSelectUser}
                                  selected={selectedUserId === node.user.id}
                                />
                              ) : (
                                <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                                  Sem colaborador nesta posição.
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3">
              <h3 className="text-sm font-bold text-slate-950">Colaboradores sem cargo</h3>
              <p className="mt-1 text-xs text-slate-500">Eles continuam operando normalmente, mas ainda não aparecem no organograma.</p>
            </div>
            <div className="grid gap-2 p-4 md:grid-cols-2 xl:grid-cols-3">
              {chart.usersWithoutRole.length === 0 ? (
                <p className="text-sm text-slate-500">Nenhum colaborador ativo sem cargo no filtro atual.</p>
              ) : (
                chart.usersWithoutRole.map((user) => (
                  <CollaboratorPill
                    key={user.id}
                    user={user}
                    units={units}
                    onSelect={handleSelectUser}
                    selected={selectedUserId === user.id}
                  />
                ))
              )}
            </div>
          </section>
        </div>

        {selectedUserDetail && (
          <UserDetailPanel
            detail={selectedUserDetail}
            units={units}
            onClose={() => setSelectedUserId(null)}
            onSelectUser={handleSelectUser}
          />
        )}
      </div>
    </div>
  );
}
