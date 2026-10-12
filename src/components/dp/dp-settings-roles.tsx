"use client";

import React from "react";

import {
  CadastrosHero,
  CadastrosTabs,
  Chevron,
  EmptyResults,
  ListHead,
  ListRow,
  ListShell,
  ListSkeleton,
  SoftPill,
} from "@/components/cadastros/cadastros-ui";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import {
  createHrDepartment,
  createHrFunction,
  createHrRole,
  syncHrRoleProfile,
  updateHrDepartment,
  updateHrFunction,
  updateHrRole,
} from "@/features/hr/lib/client";
import { useAuth } from "@/hooks/use-auth";
import { useHrBootstrap } from "@/hooks/use-hr-bootstrap";
import { useProfiles } from "@/hooks/use-profiles";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { JobDepartment, JobFunction, JobRole } from "@/types";
import {
  DepartmentPanel,
  FunctionPanel,
  RolePanel,
  type DepartmentPanelState,
  type FunctionPanelState,
  type RolePanelState,
} from "./roles/catalog-panels";
import {
  buildLinkedRolePeople,
  listRows,
  matchesQuery,
  roleSyncSummary,
  type DepartmentFormValues,
  type FunctionFormValues,
  type HrTreeItem,
  type RoleFormValues,
  type TreeRow,
} from "./roles/roles-model";

type CatalogTab = "departments" | "roles" | "functions";

const DEPARTMENT_TEMPLATE = "minmax(280px,1.8fr) minmax(200px,1.2fr) 110px 16px";
const ROLE_TEMPLATE = "minmax(280px,1.8fr) minmax(150px,1fr) minmax(150px,1fr) 100px 150px 16px";
const FUNCTION_TEMPLATE = "minmax(280px,1.8fr) minmax(150px,1fr) minmax(190px,1.2fr) minmax(150px,1fr) 100px 16px";

function TreeNameCell<T extends HrTreeItem>({
  row,
  collapsed,
  onToggle,
}: {
  row: TreeRow<T>;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: `${row.depth * 22}px` }}>
      {row.hasChildren ? (
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "Expandir" : "Recolher"} ${row.item.name}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-ds-sm text-[11px] text-ds-ink-faint hover:bg-ds-muted hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink"
        >
          {collapsed ? "▸" : "▾"}
        </button>
      ) : (
        <span className="h-6 w-6 shrink-0" aria-hidden="true" />
      )}
      {row.number ? <span className="w-10 shrink-0 font-ds-mono text-[11px] tabular-nums text-ds-ink-faint">{row.number}</span> : null}
      <span className={cn("truncate text-[13.5px]", row.depth === 0 ? "font-bold" : "font-semibold")}>{row.item.name}</span>
      {row.item.isActive === false ? <StatusPill variant="neutral">Inativo</StatusPill> : null}
    </div>
  );
}

export function DPSettingsRoles() {
  const { firebaseUser, activeUsers } = useAuth();
  const { departments, roles, functions, units, loading, error, refresh, access } = useHrBootstrap();
  const { profiles } = useProfiles();
  const { toast } = useToast();

  const [tab, setTab] = React.useState<CatalogTab>("roles");
  const [queries, setQueries] = React.useState<Record<CatalogTab, string>>({ departments: "", roles: "", functions: "" });
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(new Set());
  const [departmentPanel, setDepartmentPanel] = React.useState<DepartmentPanelState | null>(null);
  const [rolePanel, setRolePanel] = React.useState<RolePanelState | null>(null);
  const [functionPanel, setFunctionPanel] = React.useState<FunctionPanelState | null>(null);
  const [syncingRoleId, setSyncingRoleId] = React.useState<string | null>(null);

  const departmentNameById = React.useMemo(() => new Map(departments.map((item) => [item.id, item.name])), [departments]);
  const roleNameById = React.useMemo(() => new Map(roles.map((item) => [item.id, item.name])), [roles]);
  const profileNameById = React.useMemo(() => new Map(profiles.map((item) => [item.id, item.name])), [profiles]);
  const summaryByRole = React.useMemo(() => roleSyncSummary(roles, activeUsers), [roles, activeUsers]);

  const toggleCollapsed = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const departmentRows = React.useMemo(
    () => listRows<JobDepartment>(departments, (item) => matchesQuery(queries.departments, item.name, item.slug, item.description), queries.departments, collapsed),
    [departments, queries.departments, collapsed]
  );
  const roleRows = React.useMemo(
    () => listRows<JobRole>(roles, (item) => matchesQuery(queries.roles, item.name, item.publicTitle, item.slug, item.departmentName), queries.roles, collapsed),
    [roles, queries.roles, collapsed]
  );
  const functionRows = React.useMemo(
    () => listRows<JobFunction>(functions, (item) => matchesQuery(queries.functions, item.name, item.publicTitle, item.slug, item.departmentName), queries.functions, collapsed),
    [functions, queries.functions, collapsed]
  );

  const linkedPeople = React.useMemo(
    () => (rolePanel?.mode === "people" ? buildLinkedRolePeople(rolePanel.item, activeUsers, functions, units) : []),
    [rolePanel, activeUsers, functions, units]
  );

  /* Cada gravação lança o erro; o painel mostra a mensagem junto do formulário. */

  async function handleRoleSubmit(values: RoleFormValues, role: JobRole | null) {
    if (!firebaseUser) return;
    const payload = {
      name: values.name,
      cbo: values.cbo || undefined,
      departmentId: values.departmentId || null,
      departmentName: values.departmentId ? departmentNameById.get(values.departmentId) ?? null : null,
      parentId: values.parentId || null,
      reportsTo: values.parentId || null,
      defaultProfileId: values.defaultProfileId || undefined,
      loginRestricted: values.loginRestricted,
      isActive: values.isActive,
      description: values.description || undefined,
    };
    if (role) await updateHrRole(firebaseUser, role.id, payload);
    else await createHrRole(firebaseUser, payload);
    await refresh();
  }

  async function handleFunctionSubmit(values: FunctionFormValues, item: JobFunction | null) {
    if (!firebaseUser) return;
    const payload = {
      name: values.name,
      departmentId: values.departmentId || null,
      departmentName: values.departmentId ? departmentNameById.get(values.departmentId) ?? null : null,
      parentId: values.parentId || null,
      compatibleRoleIds: values.compatibleRoleIds,
      defaultProfileId: values.defaultProfileId || undefined,
      salaryRange: values.monthlySalary !== undefined ? { min: values.monthlySalary, currency: "BRL" } : undefined,
      isActive: values.isActive,
      description: values.description || undefined,
    };
    if (item) await updateHrFunction(firebaseUser, item.id, payload);
    else await createHrFunction(firebaseUser, payload);
    await refresh();
  }

  async function handleDepartmentSubmit(values: DepartmentFormValues, department: JobDepartment | null) {
    if (!firebaseUser) return;
    const name = values.name.trim();
    if (!name) return;
    const payload = {
      name,
      parentId: values.parentId || null,
      description: values.description || undefined,
      isActive: values.isActive,
    };
    if (department) await updateHrDepartment(firebaseUser, department.id, payload);
    else await createHrDepartment(firebaseUser, payload);
    await refresh();
  }

  async function handleRoleProfileSync(role: JobRole) {
    if (!firebaseUser) return;
    try {
      setSyncingRoleId(role.id);
      const result = await syncHrRoleProfile(firebaseUser, role.id);
      toast({
        title:
          result.updatedUsers.length > 0
            ? `Perfil aplicado a ${result.updatedUsers.length} colaborador${result.updatedUsers.length === 1 ? "" : "es"}.`
            : "Nenhum colaborador precisava de atualização.",
        description: result.targetProfileName ? `Cargo sincronizado com o perfil padrão ${result.targetProfileName}.` : undefined,
      });
      await refresh();
    } catch (syncError) {
      toast({
        title: syncError instanceof Error ? syncError.message : "Erro ao aplicar perfil padrão.",
        variant: "destructive",
      });
    } finally {
      setSyncingRoleId(null);
    }
  }

  if (loading) {
    return (
      <div className="rounded-ds-card-lg border border-ds-border bg-ds-warm" role="status" aria-label="Carregando cargos e funções">
        <ListSkeleton rows={6} />
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="space-y-3 rounded-ds-card-lg border border-ds-confirm-border bg-ds-confirm-bg p-6">
        <p className="text-sm font-extrabold text-ds-confirm-ink">Catálogo de RH indisponível</p>
        <p className="text-[13px] text-ds-confirm-ink">Não foi possível carregar cargos e funções neste momento. {error}</p>
        <Button type="button" variant="ds-secondary" size="md" onClick={() => void refresh()}>Tentar novamente</Button>
      </div>
    );
  }

  if (!access.canView) {
    return <p role="alert" className="rounded-ds-card border border-ds-border p-6 text-sm text-ds-ink-muted">Sem permissão para acessar o catálogo de cargos e funções.</p>;
  }

  const canManage = access.canManageCatalog;
  const tabItems = [
    { id: "departments", label: "Departamentos", count: departments.length },
    { id: "roles", label: "Cargos", count: roles.length },
    { id: "functions", label: "Funções", count: functions.length },
  ];
  const primary = !canManage
    ? undefined
    : tab === "departments"
      ? { label: "Novo departamento", onClick: () => setDepartmentPanel({ mode: "create" }) }
      : tab === "roles"
        ? { label: "Novo cargo", onClick: () => setRolePanel({ mode: "create" }) }
        : { label: "Nova função", onClick: () => setFunctionPanel({ mode: "create" }) };
  const placeholder = tab === "departments" ? "Buscar departamento" : tab === "roles" ? "Buscar cargo" : "Buscar função";
  const rowsCount = tab === "departments" ? departmentRows.length : tab === "roles" ? roleRows.length : functionRows.length;
  const total = tab === "departments" ? departments.length : tab === "roles" ? roles.length : functions.length;
  const activeCount =
    tab === "departments"
      ? departments.filter((item) => item.isActive !== false).length
      : tab === "roles"
        ? roles.filter((item) => item.isActive).length
        : functions.filter((item) => item.isActive).length;
  const noun = tab === "departments" ? "departamentos" : tab === "roles" ? "cargos" : "funções";
  const searching = queries[tab].trim().length > 0;
  const hint = tab === "departments"
    ? "Estruture áreas e subáreas com níveis livres."
    : tab === "roles"
      ? "Base do organograma. Crie níveis de cargo como no plano de contas."
      : "Atribuições complementares, compatíveis com um ou mais cargos.";

  return (
    <div className="space-y-5">
      <CadastrosHero
        kicker="Cargos e funções"
        tabs={<CadastrosTabs tabs={tabItems} active={tab} onChange={(id) => setTab(id as CatalogTab)} />}
        search={{ value: queries[tab], placeholder, onChange: (value) => setQueries((current) => ({ ...current, [tab]: value })) }}
        primary={primary}
        chips={[]}
        activeChip="all"
        onChip={() => undefined}
      />

      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="text-[28px] font-extrabold tracking-[-0.03em]">{rowsCount}</span>
        <span className="text-[13px] text-ds-ink-faint">de {total} {noun} · {activeCount} ativos</span>
        <span className="text-[13px] text-ds-ink-muted">· {hint}</span>
      </div>
      {searching ? <p className="-mt-3 text-xs text-ds-ink-muted">Com busca ativa a lista aparece sem hierarquia.</p> : null}

      <ListShell minWidth={tab === "departments" ? 760 : 980}>
        {tab === "departments" ? (
          <>
            <ListHead template={DEPARTMENT_TEMPLATE}>
              <span>Departamento</span>
              <span>Descrição</span>
              <span>Situação</span>
              <span />
            </ListHead>
            {departmentRows.map((row) => (
              <ListRow
                key={row.item.id}
                template={DEPARTMENT_TEMPLATE}
                isOpen={departmentPanel?.mode !== "create" && departmentPanel?.item.id === row.item.id}
                isSelected={false}
                isMuted={row.item.isActive === false}
                onOpen={() => setDepartmentPanel({ mode: "view", item: row.item })}
                label={`Abrir ${row.item.name}`}
              >
                <TreeNameCell row={row} collapsed={collapsed.has(row.item.id)} onToggle={() => toggleCollapsed(row.item.id)} />
                <span className="truncate text-xs text-ds-ink-muted">{row.item.description || (row.item.parentId ? "Subdepartamento" : "Raiz")}</span>
                <StatusPill variant={row.item.isActive === false ? "neutral" : "ok"}>{row.item.isActive === false ? "Inativo" : "Ativo"}</StatusPill>
                <Chevron />
              </ListRow>
            ))}
            {departmentRows.length === 0 ? (
              departments.length === 0
                ? <p className="px-5 py-12 text-center text-sm text-ds-ink-muted">Nenhum departamento cadastrado.</p>
                : <EmptyResults title="Nenhum departamento encontrado com essa busca." onClear={() => setQueries((current) => ({ ...current, departments: "" }))} />
            ) : null}
          </>
        ) : null}

        {tab === "roles" ? (
          <>
            <ListHead template={ROLE_TEMPLATE}>
              <span>Cargo</span>
              <span>Departamento</span>
              <span>Perfil padrão</span>
              <span>Vinculados</span>
              <span>Situação</span>
              <span />
            </ListHead>
            {roleRows.map((row) => {
              const role = row.item;
              const sync = summaryByRole.get(role.id) ?? { assigned: 0, mismatched: 0 };
              return (
                <ListRow
                  key={role.id}
                  template={ROLE_TEMPLATE}
                  isOpen={rolePanel?.mode !== "create" && rolePanel?.item.id === role.id}
                  isSelected={false}
                  isMuted={role.isActive === false}
                  onOpen={() => setRolePanel({ mode: "view", item: role })}
                  label={`Abrir ${role.name}`}
                >
                  <TreeNameCell row={row} collapsed={collapsed.has(role.id)} onToggle={() => toggleCollapsed(role.id)} />
                  <span className="truncate text-[13px]">{role.departmentId ? departmentNameById.get(role.departmentId) ?? role.departmentName ?? "Departamento removido" : <SoftPill isEmpty>Sem departamento</SoftPill>}</span>
                  <span className="truncate text-[13px]">{role.defaultProfileId ? profileNameById.get(role.defaultProfileId) ?? role.defaultProfileId : <SoftPill isEmpty>Sem perfil</SoftPill>}</span>
                  <div className="flex flex-col items-start gap-1">
                    <span className="text-xs font-semibold">{sync.assigned}</span>
                    {role.defaultProfileId && sync.mismatched > 0 ? <StatusPill variant="warn">{sync.mismatched} fora do padrão</StatusPill> : null}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <StatusPill variant={role.isActive ? "ok" : "neutral"}>{role.isActive ? "Ativo" : "Inativo"}</StatusPill>
                    {role.loginRestricted ? <StatusPill variant="info">Login por escala</StatusPill> : null}
                  </div>
                  <Chevron />
                </ListRow>
              );
            })}
            {roleRows.length === 0 ? (
              roles.length === 0
                ? <p className="px-5 py-12 text-center text-sm text-ds-ink-muted">Nenhum cargo cadastrado.</p>
                : <EmptyResults title="Nenhum cargo encontrado com essa busca." onClear={() => setQueries((current) => ({ ...current, roles: "" }))} />
            ) : null}
          </>
        ) : null}

        {tab === "functions" ? (
          <>
            <ListHead template={FUNCTION_TEMPLATE}>
              <span>Função</span>
              <span>Departamento</span>
              <span>Cargos compatíveis</span>
              <span>Perfil padrão</span>
              <span>Situação</span>
              <span />
            </ListHead>
            {functionRows.map((row) => {
              const item = row.item;
              const compatible = (item.compatibleRoleIds ?? []).map((id) => roleNameById.get(id) ?? id);
              return (
                <ListRow
                  key={item.id}
                  template={FUNCTION_TEMPLATE}
                  isOpen={functionPanel?.mode !== "create" && functionPanel?.item.id === item.id}
                  isSelected={false}
                  isMuted={item.isActive === false}
                  onOpen={() => setFunctionPanel({ mode: "view", item })}
                  label={`Abrir ${item.name}`}
                >
                  <TreeNameCell row={row} collapsed={collapsed.has(item.id)} onToggle={() => toggleCollapsed(item.id)} />
                  <span className="truncate text-[13px]">{item.departmentId ? departmentNameById.get(item.departmentId) ?? item.departmentName ?? "Departamento removido" : <SoftPill isEmpty>Sem departamento</SoftPill>}</span>
                  <span className="truncate text-xs text-ds-ink-muted">{compatible.length > 0 ? compatible.join(", ") : "Sem restrição de cargo"}</span>
                  <span className="truncate text-[13px]">{item.defaultProfileId ? profileNameById.get(item.defaultProfileId) ?? item.defaultProfileId : <SoftPill isEmpty>Sem perfil</SoftPill>}</span>
                  <StatusPill variant={item.isActive ? "ok" : "neutral"}>{item.isActive ? "Ativo" : "Inativo"}</StatusPill>
                  <Chevron />
                </ListRow>
              );
            })}
            {functionRows.length === 0 ? (
              functions.length === 0
                ? <p className="px-5 py-12 text-center text-sm text-ds-ink-muted">Nenhuma função cadastrada.</p>
                : <EmptyResults title="Nenhuma função encontrada com essa busca." onClear={() => setQueries((current) => ({ ...current, functions: "" }))} />
            ) : null}
          </>
        ) : null}
      </ListShell>

      <DepartmentPanel
        state={departmentPanel}
        departments={departments}
        canManage={canManage}
        onClose={() => setDepartmentPanel(null)}
        onMode={setDepartmentPanel}
        onSubmit={handleDepartmentSubmit}
      />
      <RolePanel
        state={rolePanel}
        roles={roles}
        departments={departments}
        profiles={profiles}
        departmentNameById={departmentNameById}
        profileNameById={profileNameById}
        summary={rolePanel && rolePanel.mode !== "create" ? summaryByRole.get(rolePanel.item.id) ?? { assigned: 0, mismatched: 0 } : { assigned: 0, mismatched: 0 }}
        people={linkedPeople}
        canManage={canManage}
        syncing={!!rolePanel && rolePanel.mode !== "create" && syncingRoleId === rolePanel.item.id}
        onClose={() => setRolePanel(null)}
        onMode={setRolePanel}
        onSubmit={handleRoleSubmit}
        onSyncProfile={handleRoleProfileSync}
      />
      <FunctionPanel
        state={functionPanel}
        functions={functions}
        roles={roles}
        departments={departments}
        profiles={profiles}
        departmentNameById={departmentNameById}
        roleNameById={roleNameById}
        profileNameById={profileNameById}
        canManage={canManage}
        onClose={() => setFunctionPanel(null)}
        onMode={setFunctionPanel}
        onSubmit={handleFunctionSubmit}
      />
    </div>
  );
}
