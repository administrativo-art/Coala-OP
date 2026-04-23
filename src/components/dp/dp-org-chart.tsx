"use client";

import React from "react";
import {
  Briefcase,
  ChevronDown,
  ChevronRight,
  Search,
  ShieldAlert,
  UserRoundX,
  Users2,
  Workflow,
} from "lucide-react";

import type { JobRole, User } from "@/types";
import { useAuth } from "@/hooks/use-auth";
import { useHrBootstrap } from "@/hooks/use-hr-bootstrap";
import { cn } from "@/lib/utils";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
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

function StatCard({
  title,
  value,
  hint,
  icon: Icon,
}: {
  title: string;
  value: number;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4 p-5">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="text-2xl font-semibold">{value}</p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        <div className="rounded-xl border bg-muted/50 p-2.5">
          <Icon className="h-5 w-5 text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  );
}

function CollaboratorPill({ user }: { user: User }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border bg-background/70 px-3 py-2">
      <Avatar className="h-9 w-9">
        <AvatarFallback className="text-xs">{initials(user.username)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{user.username}</p>
        <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        <p className="truncate text-xs text-muted-foreground">
          {summarizeFunctions(user.jobFunctionNames)}
        </p>
      </div>
    </div>
  );
}

function OrgRoleBranch({
  node,
  depth,
  forceExpand,
  roleNameById,
}: {
  node: OrgRoleNode;
  depth: number;
  forceExpand: boolean;
  roleNameById: Map<string, string>;
}) {
  const hasChildren = node.children.length > 0;
  const [open, setOpen] = React.useState(depth < 1);

  React.useEffect(() => {
    if (forceExpand) {
      setOpen(true);
    }
  }, [forceExpand]);

  return (
    <div className={cn(depth > 0 && "pl-5 border-l border-dashed border-border")}>
      <Card className="shadow-sm">
        <CardContent className="space-y-4 p-4">
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => hasChildren && setOpen((current) => !current)}
              className={cn(
                "mt-0.5 flex h-7 w-7 items-center justify-center rounded-md border bg-muted/40 text-muted-foreground transition-colors",
                hasChildren ? "hover:bg-muted" : "cursor-default opacity-70"
              )}
              aria-label={hasChildren ? (open ? "Recolher ramo" : "Expandir ramo") : "Sem subcargos"}
              disabled={!hasChildren}
            >
              {hasChildren ? (
                open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
              ) : (
                <Briefcase className="h-4 w-4" />
              )}
            </button>

            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold">{node.role.name}</h3>
                    {!node.role.isActive && <Badge variant="outline">Inativo</Badge>}
                    {node.detached && (
                      <Badge className="border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-50" variant="outline">
                        Hierarquia ajustada
                      </Badge>
                    )}
                    {node.role.loginRestricted && (
                      <Badge className="border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-50" variant="outline">
                        Login restrito
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {node.role.publicTitle || node.role.name}
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      Reporta para:{" "}
                      {node.role.reportsTo
                        ? roleNameById.get(node.role.reportsTo) ?? "Cargo não encontrado"
                        : "Topo da estrutura"}
                    </span>
                    <span>
                      {node.directUsers.length} colaborador{node.directUsers.length === 1 ? "" : "es"} direto
                      {node.directUsers.length === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">
                    {node.totalUsers} no ramo
                  </Badge>
                  {hasChildren && (
                    <Badge variant="outline">
                      {node.children.length} subcargo{node.children.length === 1 ? "" : "s"}
                    </Badge>
                  )}
                </div>
              </div>

              {node.directUsers.length > 0 ? (
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {node.directUsers.map((user) => (
                    <CollaboratorPill key={user.id} user={user} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nenhum colaborador ativo está vinculado diretamente a este cargo.
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {open && hasChildren && (
        <div className="mt-3 space-y-3">
          {node.children.map((child) => (
            <OrgRoleBranch
              key={child.role.id}
              node={child}
              depth={depth + 1}
              forceExpand={forceExpand}
              roleNameById={roleNameById}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function DPOrgChart() {
  const { activeUsers } = useAuth();
  const { roles, loading, error, refresh, access } = useHrBootstrap();

  const [query, setQuery] = React.useState("");
  const [showInactiveRoles, setShowInactiveRoles] = React.useState(false);
  const [showEmptyRoles, setShowEmptyRoles] = React.useState(true);

  const usersInScope = React.useMemo(
    () => activeUsers.filter((user) => user.isActive !== false).sort(byName),
    [activeUsers]
  );

  const roleNameById = React.useMemo(
    () => new Map(roles.map((role) => [role.id, role.name])),
    [roles]
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
            Cadastre cargos em <strong>Cargos &amp; Funções</strong> e depois vincule os colaboradores para montar a hierarquia.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-xl">
              <Workflow className="h-5 w-5" />
              Organograma
            </CardTitle>
            <CardDescription>
              Leitura derivada de cargos e colaboradores ativos. O modelo atual de permissões continua vindo do perfil do usuário.
            </CardDescription>
          </div>

          <div className="space-y-3 xl:min-w-[360px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar cargo, colaborador, e-mail ou função"
                className="pl-9"
              />
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2 text-muted-foreground">
                <Switch checked={showEmptyRoles} onCheckedChange={setShowEmptyRoles} />
                Mostrar cargos sem colaboradores
              </label>
              <label className="flex items-center gap-2 text-muted-foreground">
                <Switch checked={showInactiveRoles} onCheckedChange={setShowInactiveRoles} />
                Mostrar cargos inativos
              </label>
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Cargos visíveis"
          value={chart.visibleRolesCount}
          hint={`${chart.totalRolesCount} cargos no filtro atual`}
          icon={Briefcase}
        />
        <StatCard
          title="Cargos ocupados"
          value={chart.occupiedRolesCount}
          hint="Ao menos um colaborador ativo vinculado"
          icon={Users2}
        />
        <StatCard
          title="Colaboradores com cargo"
          value={chart.assignedUsersCount}
          hint={`${usersInScope.length} colaboradores ativos considerados`}
          icon={Workflow}
        />
        <StatCard
          title="Sem cargo"
          value={chart.usersWithoutRole.length}
          hint="Precisam de vínculo para entrar na árvore"
          icon={UserRoundX}
        />
      </div>

      {chart.detachedRoleCount > 0 && (
        <Card className="border-amber-200 bg-amber-50/70">
          <CardContent className="flex items-start gap-3 p-4">
            <ShieldAlert className="mt-0.5 h-5 w-5 text-amber-700" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-amber-900">
                A hierarquia tem {chart.detachedRoleCount} ramo{chart.detachedRoleCount === 1 ? "" : "s"} ajustado{chart.detachedRoleCount === 1 ? "" : "s"} automaticamente.
              </p>
              <p className="text-sm text-amber-800">
                Isso acontece quando um cargo aponta para um superior inexistente, para si mesmo ou entra em um ciclo. A tela mantém esses cargos visíveis sem afetar a usabilidade atual.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          {chart.roots.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                Nenhum ramo corresponde aos filtros atuais.
              </CardContent>
            </Card>
          ) : (
            chart.roots.map((node) => (
              <OrgRoleBranch
                key={node.role.id}
                node={node}
                depth={0}
                forceExpand={query.trim().length > 0}
                roleNameById={roleNameById}
              />
            ))
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Leitura da estrutura</CardTitle>
              <CardDescription>
                A árvore usa o campo <strong>Reporta para</strong> do cargo e os vínculos dos colaboradores.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>Permissões continuam vindo de <code>profileId</code>.</p>
              <p>O cargo só organiza RH e prepara regras futuras como restrição de login por escala.</p>
              <p>Colaboradores sem cargo ficam fora da árvore até serem vinculados.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Colaboradores sem cargo</CardTitle>
              <CardDescription>
                Eles continuam operando normalmente, mas ainda não aparecem no organograma.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {chart.usersWithoutRole.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhum colaborador ativo sem cargo no filtro atual.
                </p>
              ) : (
                chart.usersWithoutRole.map((user) => (
                  <CollaboratorPill key={user.id} user={user} />
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
