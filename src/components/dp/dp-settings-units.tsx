"use client";

import React, { useMemo, useState } from "react";

import {
  CadastrosHero,
  CadastrosTabs,
  Chevron,
  EmptyResults,
  ListHead,
  ListRow,
  ListShell,
  ListSkeleton,
  Mono,
  SoftPill,
} from "@/components/cadastros/cadastros-ui";
import { buildChips } from "@/components/cadastros/cadastros-utils";
import { useDP } from "@/components/dp-context";
import { Segmented } from "@/components/patterns/segmented";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { useAuth } from "@/hooks/use-auth";
import { useDPBootstrap } from "@/hooks/use-dp-bootstrap";
import { useHrBootstrap } from "@/hooks/use-hr-bootstrap";
import { useKiosks } from "@/hooks/use-kiosks";
import { CnpjValidator } from "@/lib/company/cnpj-validator";
import { dpOperatingHoursSchema } from "@/lib/dp-operating-hours";
import { shiftDefinitionMatchesUnit } from "@/lib/dp-shift-definitions";
import { activeOperationalUnits } from "@/lib/dp-units";
import { cn } from "@/lib/utils";
import type { DPUnit, DPUnitGroup, DPUnitOrganization } from "@/types";
import {
  GroupPanel,
  OrganizationPanel,
  type GroupPanelState,
  type OrganizationPanelState,
} from "./units/structure-panels";
import { UnitDetailPanel } from "./units/unit-detail-panel";
import { UnitWizardModal, type UnitDialogState } from "./units/unit-wizard-modal";
import {
  buildGroupedGroupEntries,
  buildGroupedUnitEntries,
  buildResponsibilityPayload,
  coverageSummaryFor,
  describeResponsibility,
  matchUnitByName,
  mergeOperationalUnits,
  pluralize,
  sortByName,
  unitExternalLabel,
  type GroupByMode,
  type GroupForm,
  type ListBand,
  type MergedOperationalUnit,
  type OrganizationForm,
  type UnitForm,
} from "./units/units-model";

type UnitsTab = "units" | "groups" | "organizations";

const NO_GROUP = "__no_group__";
const NO_ORGANIZATION = "__no_organization__";

const UNIT_TEMPLATE = "minmax(200px,1.5fr) minmax(150px,1fr) minmax(130px,0.9fr) minmax(190px,1.3fr) 120px 84px 16px";
const GROUP_TEMPLATE = "minmax(220px,1.5fr) minmax(160px,1fr) 110px minmax(200px,1.3fr) 16px";
const ORGANIZATION_TEMPLATE = "minmax(240px,1.6fr) 100px 110px minmax(200px,1.3fr) 16px";

/** Busca sem acento e sem caixa; não remove palavras como “quiosque”, ao contrário do casamento de nomes. */
function searchKey(value: string | undefined) {
  return (value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function matchesSearch(query: string, ...fields: Array<string | undefined>) {
  const needle = searchKey(query.trim());
  if (!needle) return true;
  return fields.some((field) => searchKey(field).includes(needle));
}

export function DPSettingsUnits() {
  const {
    addUnit,
    updateUnit,
    deleteUnit,
    addUnitGroup,
    updateUnitGroup,
    deleteUnitGroup,
    addUnitOrganization,
    updateUnitOrganization,
    deleteUnitOrganization,
  } = useDP();
  const { permissions, activeUsers } = useAuth();
  const { roles, functions } = useHrBootstrap();
  const { units, unitGroups, unitOrganizations, shiftDefinitions, unitsLoading, unitsError } = useDPBootstrap();
  const { kiosks } = useKiosks();
  const canManageUnits = !!(
    permissions.settings.manageUsers ||
    permissions.settings.manageKiosks ||
    permissions.dp?.settings?.manageUnits
  );

  const [tab, setTab] = useState<UnitsTab>("units");
  const [search, setSearch] = useState("");
  const [chipByTab, setChipByTab] = useState<Record<UnitsTab, string>>({ units: "all", groups: "all", organizations: "all" });
  const [groupBy, setGroupBy] = useState<Record<UnitsTab, GroupByMode>>({ units: "none", groups: "none", organizations: "none" });
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [selectedUnitKey, setSelectedUnitKey] = useState<string | null>(null);
  const [unitDialog, setUnitDialog] = useState<UnitDialogState | null>(null);
  const [groupPanel, setGroupPanel] = useState<GroupPanelState | null>(null);
  const [organizationPanel, setOrganizationPanel] = useState<OrganizationPanelState | null>(null);
  const [saving, setSaving] = useState<"organization" | "group" | "unit" | "delete" | null>(null);

  const organizations = useMemo(() => sortByName(activeOperationalUnits(unitOrganizations)), [unitOrganizations]);
  const groups = useMemo(() => sortByName(unitGroups), [unitGroups]);
  const sortedUnits = useMemo(() => sortByName(activeOperationalUnits(units)), [units]);
  const directory = useMemo(
    () => ({
      roles: sortByName(roles.filter((role) => role.isActive !== false)),
      functions: sortByName(functions.filter((item) => item.isActive !== false)),
      users: sortByName(activeUsers.filter((user) => user.isActive !== false).map((user) => ({ ...user, name: user.username }))),
    }),
    [roles, functions, activeUsers]
  );
  const organizationById = useMemo(() => new Map(organizations.map((item) => [item.id, item])), [organizations]);
  const groupById = useMemo(() => new Map(groups.map((item) => [item.id, item])), [groups]);
  const mergedUnits = useMemo(() => mergeOperationalUnits(sortedUnits, kiosks), [sortedUnits, kiosks]);

  const registeredKioskIds = useMemo(
    () => new Set(mergedUnits.filter((unit) => unit.dpUnit).map((unit) => unit.kiosk?.id).filter(Boolean) as string[]),
    [mergedUnits]
  );
  const syncCandidates = useMemo(
    () => sortByName(kiosks.filter((kiosk) => !registeredKioskIds.has(kiosk.id))),
    [kiosks, registeredKioskIds]
  );

  /** Grupo e organização efetivos de uma unidade; vínculo para registro removido conta como ausente. */
  function structureOf(unit: MergedOperationalUnit) {
    const group = unit.groupId ? groupById.get(unit.groupId) : undefined;
    const organizationId = group?.organizationId ?? unit.organizationId;
    const organization = organizationId ? organizationById.get(organizationId) : undefined;
    return { group, organization };
  }

  function shiftsFor(unit: MergedOperationalUnit) {
    const dpUnit = unit.dpUnit ?? (unit.kiosk ? matchUnitByName(unit.kiosk.name, units) : undefined);
    return dpUnit ? shiftDefinitions.filter((shift) => shiftDefinitionMatchesUnit(shift, dpUnit.id)) : [];
  }

  function organizationOfGroup(group: DPUnitGroup) {
    return group.organizationId ? organizationById.get(group.organizationId) : undefined;
  }

  function unitsOfGroup(groupId: string) {
    return mergedUnits.filter((unit) => structureOf(unit).group?.id === groupId);
  }

  function unitsOfOrganization(organizationId: string) {
    return mergedUnits.filter((unit) => structureOf(unit).organization?.id === organizationId);
  }

  const searchedUnits = useMemo(
    () =>
      mergedUnits.filter((unit) => {
        const { group, organization } = structureOf(unit);
        return matchesSearch(search, unit.name, group?.name, organization?.name, unit.dpUnit?.cnpj, unit.dpUnit?.unitType, unit.pdvFilialId);
      }),
    // structureOf depende só de mapas já listados.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mergedUnits, search, groupById, organizationById]
  );
  const searchedGroups = useMemo(
    () => groups.filter((group) => matchesSearch(search, group.name, organizationOfGroup(group)?.name, group.responsibleUserName, group.responsibleSourceName)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, search, organizationById]
  );
  const searchedOrganizations = useMemo(
    () => organizations.filter((item) => matchesSearch(search, item.name, item.description, item.responsibleUserName, item.responsibleSourceName)),
    [organizations, search]
  );

  const unitChips = useMemo(() => {
    const entries = [
      ...groups.map((group) => ({
        id: group.id,
        label: group.name,
        count: searchedUnits.filter((unit) => structureOf(unit).group?.id === group.id).length,
      })),
      { id: NO_GROUP, label: "Sem grupo", count: searchedUnits.filter((unit) => !structureOf(unit).group).length },
    ];
    return buildChips(searchedUnits.length, entries, chipByTab.units, "Todas");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, searchedUnits, chipByTab.units]);

  const groupChips = useMemo(() => {
    const entries = [
      ...organizations.map((organization) => ({
        id: organization.id,
        label: organization.name,
        count: searchedGroups.filter((group) => group.organizationId === organization.id).length,
      })),
      {
        id: NO_ORGANIZATION,
        label: "Sem organização",
        count: searchedGroups.filter((group) => !organizationOfGroup(group)).length,
      },
    ];
    return buildChips(searchedGroups.length, entries, chipByTab.groups, "Todos");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizations, searchedGroups, chipByTab.groups]);

  const visibleUnits = useMemo(() => {
    const chip = chipByTab.units;
    if (chip === "all") return searchedUnits;
    return searchedUnits.filter((unit) => {
      const { group } = structureOf(unit);
      return chip === NO_GROUP ? !group : group?.id === chip;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchedUnits, chipByTab.units, groupById, organizationById]);

  const visibleGroups = useMemo(() => {
    const chip = chipByTab.groups;
    if (chip === "all") return searchedGroups;
    return searchedGroups.filter((group) =>
      chip === NO_ORGANIZATION ? !organizationOfGroup(group) : group.organizationId === chip
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchedGroups, chipByTab.groups, organizationById]);

  const unitEntries = useMemo(
    () => buildGroupedUnitEntries(visibleUnits, groupBy.units, organizations, groups, structureOf),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleUnits, groupBy.units, organizations, groups, groupById, organizationById]
  );
  const groupEntries = useMemo(
    () => buildGroupedGroupEntries(visibleGroups, groupBy.groups, organizations),
    [visibleGroups, groupBy.groups, organizations]
  );
  const isHidden = (ancestors: string[]) => ancestors.some((key) => collapsed.has(key));
  const toggleBand = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const selectedUnit = selectedUnitKey ? mergedUnits.find((unit) => unit.key === selectedUnitKey) ?? null : null;

  /* ───────── gravações (mesma regra de antes; só a apresentação mudou) ───────── */

  async function saveOrganization(form: OrganizationForm, state: OrganizationPanelState) {
    const name = form.name.trim();
    if (!name) return;
    setSaving("organization");
    try {
      const payload = {
        name,
        description: form.description.trim() || undefined,
        ...buildResponsibilityPayload(form, directory),
      };
      if (state.mode === "edit") await updateUnitOrganization({ ...state.organization, ...payload });
      else await addUnitOrganization(payload);
      setOrganizationPanel(null);
    } finally {
      setSaving(null);
    }
  }

  async function saveGroup(form: GroupForm, state: GroupPanelState) {
    const name = form.name.trim();
    if (!name) return;
    setSaving("group");
    try {
      const payload = {
        name,
        organizationId: form.organizationId || undefined,
        suppliedGroupIds: form.suppliedGroupIds,
        ...buildResponsibilityPayload(form, directory),
      };
      if (state.mode === "edit") await updateUnitGroup({ ...state.group, ...payload });
      else await addUnitGroup(payload);
      setGroupPanel(null);
    } finally {
      setSaving(null);
    }
  }

  async function saveUnit(form: UnitForm, dialog: UnitDialogState) {
    const name = form.name.trim();
    if (!name) return;
    const cnpj = form.cnpj.trim() ? CnpjValidator.validate(form.cnpj) : null;
    if (cnpj && !cnpj.valid) return;
    if (!dpOperatingHoursSchema.safeParse(form.operatingHours).success) return;

    const selectedGroup = form.groupId ? groupById.get(form.groupId) : null;
    const organizationId = selectedGroup?.organizationId ?? form.organizationId;
    const bizneoTaxonId = form.bizneoTaxonId.trim() ? Number(form.bizneoTaxonId) : undefined;
    const selectedKiosk = form.kioskId ? kiosks.find((kiosk) => kiosk.id === form.kioskId) : null;

    setSaving("unit");
    try {
      if (dialog.mode === "edit") {
        await updateUnit({
          ...dialog.unit,
          name,
          cnpj: cnpj?.clean,
          address: form.address.trim() || undefined,
          unitType: form.unitType.trim() || undefined,
          organizationId: organizationId || undefined,
          groupId: form.groupId || undefined,
          pdvFilialId: form.pdvFilialId.trim() || undefined,
          bizneoTaxonId,
          coverageMode: form.coverageMode,
          operatingHours: form.operatingHours,
          stockRole: form.stockRole,
        });
      } else {
        await addUnit({
          name,
          cnpj: cnpj?.clean,
          address: form.address.trim() || undefined,
          unitType: form.unitType.trim() || undefined,
          organizationId: organizationId || undefined,
          groupId: form.groupId || undefined,
          externalSource: dialog.mode === "sync" ? "kiosk" : "manual",
          externalId: dialog.mode === "sync" ? selectedKiosk?.id : undefined,
          pdvFilialId: form.pdvFilialId.trim() || selectedKiosk?.pdvFilialId || undefined,
          bizneoTaxonId,
          coverageMode: form.coverageMode,
          operatingHours: form.operatingHours,
          stockRole: form.stockRole,
        });
      }
      setUnitDialog(null);
    } finally {
      setSaving(null);
    }
  }

  async function removeWith(action: () => Promise<unknown>, afterDelete: () => void) {
    setSaving("delete");
    try {
      await action();
      afterDelete();
    } finally {
      setSaving(null);
    }
  }

  async function detachUnitFromGroup(unit: DPUnit) {
    const currentGroup = unit.groupId ? groupById.get(unit.groupId) : null;
    setSaving("unit");
    try {
      await updateUnit({
        ...unit,
        organizationId: unit.organizationId ?? currentGroup?.organizationId,
        groupId: undefined,
      });
    } finally {
      setSaving(null);
    }
  }

  /* ───────── apresentação ───────── */

  if (unitsLoading && units.length === 0 && groups.length === 0 && organizations.length === 0) {
    return (
      <div className="rounded-ds-card-lg border border-ds-border bg-ds-warm" role="status" aria-label="Carregando unidades">
        <ListSkeleton rows={6} />
      </div>
    );
  }

  if (unitsError && units.length === 0) {
    return <p role="alert" className="text-sm font-semibold text-ds-danger">Erro ao carregar unidades: {unitsError}</p>;
  }

  const tabItems = [
    { id: "units", label: "Unidades", count: mergedUnits.length },
    { id: "groups", label: "Grupos", count: groups.length },
    { id: "organizations", label: "Organizações", count: organizations.length },
  ];

  const primary =
    tab === "units"
      ? { label: "Nova unidade", onClick: () => setUnitDialog({ mode: "manual" }) }
      : tab === "groups"
        ? { label: "Novo grupo", onClick: () => setGroupPanel({ mode: "create" }) }
        : { label: "Nova organização", onClick: () => setOrganizationPanel({ mode: "create" }) };

  const chips = tab === "units" ? unitChips : tab === "groups" ? groupChips : [];
  const resultCount = tab === "units" ? visibleUnits.length : tab === "groups" ? visibleGroups.length : searchedOrganizations.length;
  const totalCount = tab === "units" ? mergedUnits.length : tab === "groups" ? groups.length : organizations.length;
  const noun = tab === "units" ? "unidades" : tab === "groups" ? "grupos" : "organizações";

  function clearFilters() {
    setSearch("");
    setChipByTab((current) => ({ ...current, [tab]: "all" }));
  }

  const renderUnitRow = (unit: MergedOperationalUnit) => {
    const { group, organization } = structureOf(unit);
                const coverage = coverageSummaryFor(unit.dpUnit);
                const shiftCount = shiftsFor(unit).length;
                const meta = [unit.dpUnit?.cnpj ? CnpjValidator.format(unit.dpUnit.cnpj) : null, unit.dpUnit?.unitType || null].filter(Boolean).join(" · ");
                return (
                  <ListRow
                    key={unit.key}
                    template={UNIT_TEMPLATE}
                    isOpen={selectedUnitKey === unit.key}
                    isSelected={false}
                    isMuted={false}
                    onOpen={() => setSelectedUnitKey(unit.key)}
                    label={`Abrir ${unit.name}`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px] font-bold">{unit.name}</p>
                      {meta ? <p className="truncate text-xs text-ds-ink-muted">{meta}</p> : null}
                    </div>
                    <div className="min-w-0">
                      {group ? <p className="truncate text-[13px] font-semibold">{group.name}</p> : <SoftPill isEmpty>Sem grupo</SoftPill>}
                      {organization ? <p className="truncate text-xs text-ds-ink-muted">{organization.name}</p> : null}
                    </div>
                    <div className="min-w-0 text-xs text-ds-ink-muted">
                      <p className="truncate">{unit.pdvFilialId ? <Mono>PDV {unit.pdvFilialId}</Mono> : "Sem PDV"}</p>
                      <p className="truncate">{typeof unit.bizneoTaxonId === "number" ? <Mono>Bizneo {unit.bizneoTaxonId}</Mono> : "Sem Bizneo"}</p>
                    </div>
                    <p className={cn("min-w-0 text-xs leading-4", coverage.needsConfiguration ? "font-semibold text-ds-warn" : "text-ds-ink-muted")}>
                      {coverage.text}
                    </p>
                    <div>
                      <StatusPill variant={unit.dpUnit ? "neutral" : "warn"}>{unit.dpUnit ? unitExternalLabel(unit.dpUnit) : "Só operacional"}</StatusPill>
                    </div>
                    <span className="text-xs text-ds-ink-muted">{shiftCount > 0 ? pluralize(shiftCount, "turno", "turnos") : "Sem turnos"}</span>
                    <Chevron />
                  </ListRow>
                );
  };

  const renderGroupRow = (group: DPUnitGroup) => {
    const organization = organizationOfGroup(group);
                return (
                  <ListRow
                    key={group.id}
                    template={GROUP_TEMPLATE}
                    isOpen={groupPanel?.mode !== "create" && groupPanel?.group.id === group.id}
                    isSelected={false}
                    isMuted={false}
                    onOpen={() => setGroupPanel({ mode: "view", group })}
                    label={`Abrir ${group.name}`}
                  >
                    <p className="truncate text-[13.5px] font-bold">{group.name}</p>
                    {organization ? <p className="truncate text-[13px]">{organization.name}</p> : <SoftPill isEmpty>Sem organização</SoftPill>}
                    <span className="text-xs text-ds-ink-muted">{unitsOfGroup(group.id).length}</span>
                    {responsibilityCell(group)}
                    <Chevron />
                  </ListRow>
                );
  };

  const renderBand = (band: ListBand) => {
    if (isHidden(band.ancestors)) return null;
    const isCollapsed = collapsed.has(band.key);
    const responsibility = band.entity ? describeResponsibility(band.entity.value, directory.users) : null;
    const note = responsibility ? `Responsável: ${responsibility.person ?? responsibility.source}` : null;
    return (
      <div
        key={band.key}
        data-ui="list-band"
        className={cn(
          "flex items-center gap-2 border-b border-ds-divider pr-3",
          band.level === 0 ? "bg-ds-muted" : "bg-ds-page/60"
        )}
      >
        <button
          type="button"
          aria-expanded={!isCollapsed}
          onClick={() => toggleBand(band.key)}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2.5 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink focus-visible:ring-inset",
            band.level === 0 ? "pl-5" : "pl-10"
          )}
        >
          <span aria-hidden="true" className="w-3 text-[11px] text-ds-ink-faint">{isCollapsed ? "▸" : "▾"}</span>
          <span className={cn("truncate font-extrabold", band.level === 0 ? "text-[13.5px]" : "text-[12.5px]")}>{band.title}</span>
          {band.subtitle ? <span className="truncate text-xs text-ds-ink-muted">{band.subtitle}</span> : null}
          <span className="ml-auto shrink-0 text-xs text-ds-ink-faint">{[note, band.meta].filter(Boolean).join(" · ")}</span>
        </button>
        {band.entity ? (
          <Button
            type="button"
            variant="ds-link"
            size="xs"
            aria-label={`Ver detalhes de ${band.title}`}
            onClick={() =>
              band.entity?.kind === "group"
                ? setGroupPanel({ mode: "view", group: band.entity.value })
                : band.entity && setOrganizationPanel({ mode: "view", organization: band.entity.value })
            }
          >
            Ver
          </Button>
        ) : null}
      </div>
    );
  };

  const responsibilityCell = (entity: DPUnitOrganization | DPUnitGroup) => {
    const info = describeResponsibility(entity, directory.users);
    if (!info) return <SoftPill isEmpty>Não definido</SoftPill>;
    return (
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-[13px] font-semibold">{info.person ?? info.source}</span>
          {info.needsReplacement ? <StatusPill variant="warn">Definir novo</StatusPill> : null}
        </div>
        {info.person && info.source ? <p className="truncate text-xs text-ds-ink-muted">{info.source}</p> : null}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <CadastrosHero
        kicker="Estrutura organizacional"
        tabs={<CadastrosTabs tabs={tabItems} active={tab} onChange={(id) => setTab(id as UnitsTab)} />}
        search={{
          value: search,
          placeholder: tab === "units" ? "Buscar unidade, CNPJ, grupo ou PDV" : tab === "groups" ? "Buscar grupo, organização ou responsável" : "Buscar organização ou responsável",
          onChange: setSearch,
        }}
        manage={
          canManageUnits && tab === "units" && syncCandidates.length > 0
            ? { label: "Criar via sincronização", onClick: () => setUnitDialog({ mode: "sync" }) }
            : undefined
        }
        primary={canManageUnits ? primary : undefined}
        chips={chips}
        activeChip={chipByTab[tab]}
        onChip={(id) => setChipByTab((current) => ({ ...current, [tab]: id }))}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <span className="text-[28px] font-extrabold tracking-[-0.03em]">{resultCount}</span>
          <span className="text-[13px] text-ds-ink-faint">de {totalCount} {noun}</span>
        </div>
        {tab !== "organizations" ? (
          <div className="flex items-center gap-2.5">
            <span className="text-xs font-bold text-ds-ink-2">Agrupar por</span>
            <Segmented<GroupByMode>
              aria-label="Agrupar por"
              value={groupBy[tab]}
              onChange={(mode) => setGroupBy((current) => ({ ...current, [tab]: mode }))}
              options={
                tab === "units"
                  ? [
                      { value: "none", label: "Nenhum" },
                      { value: "organization", label: "Organização" },
                      { value: "group", label: "Grupo" },
                    ]
                  : [
                      { value: "none", label: "Nenhum" },
                      { value: "organization", label: "Organização" },
                    ]
              }
            />
          </div>
        ) : null}
      </div>

      <ListShell minWidth={tab === "units" ? 1040 : 860}>
        {tab === "units" ? (
          <>
            <ListHead template={UNIT_TEMPLATE}>
              <span>Unidade</span>
              <span>Estrutura</span>
              <span>Integrações</span>
              <span>Cobertura</span>
              <span>Origem</span>
              <span>Turnos</span>
              <span />
            </ListHead>
            {unitEntries.map((entry) =>
              entry.type === "band" ? renderBand(entry) : isHidden(entry.ancestors) ? null : renderUnitRow(entry.unit)
            )}
            {visibleUnits.length === 0 ? (
              mergedUnits.length === 0 ? (
                <p className="px-5 py-12 text-center text-sm text-ds-ink-muted">Nenhuma unidade cadastrada. Crie a primeira com “Nova unidade”.</p>
              ) : (
                <EmptyResults title="Nenhuma unidade encontrada com esses filtros." onClear={clearFilters} />
              )
            ) : null}
          </>
        ) : null}

        {tab === "groups" ? (
          <>
            <ListHead template={GROUP_TEMPLATE}>
              <span>Grupo</span>
              <span>Organização</span>
              <span>Unidades</span>
              <span>Responsável</span>
              <span />
            </ListHead>
            {groupEntries.map((entry) =>
              entry.type === "band" ? renderBand(entry) : isHidden(entry.ancestors) ? null : renderGroupRow(entry.group)
            )}
            {visibleGroups.length === 0 ? (
              groups.length === 0 ? (
                <p className="px-5 py-12 text-center text-sm text-ds-ink-muted">Nenhum grupo cadastrado. Crie o primeiro com “Novo grupo”.</p>
              ) : (
                <EmptyResults title="Nenhum grupo encontrado com esses filtros." onClear={clearFilters} />
              )
            ) : null}
          </>
        ) : null}

        {tab === "organizations" ? (
          <>
            <ListHead template={ORGANIZATION_TEMPLATE}>
              <span>Organização</span>
              <span>Grupos</span>
              <span>Unidades</span>
              <span>Responsável</span>
              <span />
            </ListHead>
            {searchedOrganizations.map((organization) => (
              <ListRow
                key={organization.id}
                template={ORGANIZATION_TEMPLATE}
                isOpen={organizationPanel?.mode !== "create" && organizationPanel?.organization.id === organization.id}
                isSelected={false}
                isMuted={false}
                onOpen={() => setOrganizationPanel({ mode: "view", organization })}
                label={`Abrir ${organization.name}`}
              >
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-bold">{organization.name}</p>
                  {organization.description ? <p className="truncate text-xs text-ds-ink-muted">{organization.description}</p> : null}
                </div>
                <span className="text-xs text-ds-ink-muted">{groups.filter((group) => group.organizationId === organization.id).length}</span>
                <span className="text-xs text-ds-ink-muted">{unitsOfOrganization(organization.id).length}</span>
                {responsibilityCell(organization)}
                <Chevron />
              </ListRow>
            ))}
            {searchedOrganizations.length === 0 ? (
              organizations.length === 0 ? (
                <p className="px-5 py-12 text-center text-sm text-ds-ink-muted">Nenhuma organização cadastrada. Crie uma para começar a estruturar os grupos.</p>
              ) : (
                <EmptyResults title="Nenhuma organização encontrada com essa busca." onClear={clearFilters} />
              )
            ) : null}
          </>
        ) : null}
      </ListShell>

      <UnitDetailPanel
        unit={selectedUnit}
        organization={selectedUnit ? structureOf(selectedUnit).organization : undefined}
        group={selectedUnit ? structureOf(selectedUnit).group : undefined}
        shifts={selectedUnit ? shiftsFor(selectedUnit) : []}
        canManage={canManageUnits}
        busy={saving === "unit" || saving === "delete"}
        onClose={() => setSelectedUnitKey(null)}
        onEdit={(unit) => { setSelectedUnitKey(null); setUnitDialog({ mode: "edit", unit }); }}
        onRegister={(kioskId) => { setSelectedUnitKey(null); setUnitDialog({ mode: "sync", kioskId }); }}
        onDetachFromGroup={(unit) => void detachUnitFromGroup(unit)}
        onDelete={(unit) => removeWith(() => deleteUnit(unit.id), () => setSelectedUnitKey(null))}
      />

      <UnitWizardModal
        dialog={unitDialog}
        organizations={organizations}
        groups={groups}
        kiosks={kiosks}
        syncCandidates={syncCandidates}
        saving={saving === "unit"}
        onClose={() => setUnitDialog(null)}
        onSubmit={saveUnit}
      />

      <GroupPanel
        state={groupPanel}
        organizations={organizations}
        groups={groups}
        units={groupPanel && groupPanel.mode !== "create" ? unitsOfGroup(groupPanel.group.id) : []}
        directory={directory}
        canManage={canManageUnits}
        saving={saving === "group" || saving === "delete"}
        onClose={() => setGroupPanel(null)}
        onMode={setGroupPanel}
        onSave={saveGroup}
        onDelete={(group) => removeWith(() => deleteUnitGroup(group.id), () => setGroupPanel(null))}
      />

      <OrganizationPanel
        state={organizationPanel}
        groups={groups}
        units={organizationPanel && organizationPanel.mode !== "create" ? unitsOfOrganization(organizationPanel.organization.id) : []}
        directory={directory}
        canManage={canManageUnits}
        saving={saving === "organization" || saving === "delete"}
        onClose={() => setOrganizationPanel(null)}
        onMode={setOrganizationPanel}
        onSave={saveOrganization}
        onDelete={(organization) => removeWith(() => deleteUnitOrganization(organization.id), () => setOrganizationPanel(null))}
      />
    </div>
  );
}
