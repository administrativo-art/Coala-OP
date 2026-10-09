import { CnpjValidator } from "@/lib/company/cnpj-validator";
import { resolveDPCoverageMode } from "@/lib/dp-coverage-demands";
import { formatOperatingHoursSummary } from "@/lib/dp-operating-hours";
import type {
  DPCoverageMode,
  DPOperatingHours,
  DPUnit,
  DPUnitGroup,
  DPUnitOrganization,
  DPUnitResponsibility,
  DPUnitStockRole,
  JobFunction,
  JobRole,
  Kiosk,
  User,
} from "@/types";

export type ResponsibilityForm = {
  responsibleSourceType: "" | "job_role" | "job_function";
  responsibleSourceId: string;
  responsibleUserId: string;
};

export type OrganizationForm = {
  name: string;
  description: string;
} & ResponsibilityForm;

export type GroupForm = {
  name: string;
  organizationId: string;
  suppliedGroupIds: string[];
} & ResponsibilityForm;

export type UnitForm = {
  name: string;
  cnpj: string;
  address: string;
  unitType: string;
  organizationId: string;
  groupId: string;
  kioskId: string;
  pdvFilialId: string;
  bizneoTaxonId: string;
  coverageMode: DPCoverageMode;
  operatingHours: DPOperatingHours;
  stockRole: DPUnitStockRole;
};

export type MergedOperationalUnit = {
  key: string;
  name: string;
  dpUnit?: DPUnit;
  kiosk?: Kiosk;
  organizationId?: string;
  groupId?: string;
  pdvFilialId?: string;
  bizneoTaxonId?: number;
};

export const NONE = "__none__";

// Documentos legados ou de integração podem chegar sem `name`; a tela não pode quebrar por isso.
export function sortByName<T extends { name?: string }>(items: T[]) {
  return [...items].sort((left, right) => (left.name ?? "").localeCompare(right.name ?? "", "pt-BR"));
}

export function normalizeName(value: string | undefined) {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/quiosque\s*/gi, "")
    .replace(/quisque\s*/gi, "")
    .replace(/centro de distribuicao\s*/gi, "")
    .replace(/[-–_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function maskCnpjInput(value: string) {
  const digits = CnpjValidator.clean(value).slice(0, 14);
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  if (digits.length <= 12) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
  return CnpjValidator.format(digits);
}

export function editDistance(a: string, b: string) {
  const rows = a.length + 1;
  const columns = b.length + 1;
  const matrix = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (_, column) => {
      if (row === 0) return column;
      if (column === 0) return row;
      return 0;
    })
  );

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      matrix[row][column] = a[row - 1] === b[column - 1]
        ? matrix[row - 1][column - 1]
        : 1 + Math.min(
            matrix[row - 1][column],
            matrix[row][column - 1],
            matrix[row - 1][column - 1]
          );
    }
  }

  return matrix[a.length][b.length];
}

export function matchUnitByName(kioskName: string | undefined, units: DPUnit[]) {
  const normalizedKioskName = normalizeName(kioskName);
  if (!normalizedKioskName) return undefined; // sem nome não há correspondência confiável
  const exact = units.find((unit) => {
    const normalizedUnitName = normalizeName(unit.name);
    return (
      normalizedKioskName === normalizedUnitName ||
      normalizedKioskName.includes(normalizedUnitName) ||
      normalizedUnitName.includes(normalizedKioskName)
    );
  });
  if (exact) return exact;

  let best: DPUnit | undefined;
  let bestDistance = Infinity;
  units.forEach((unit) => {
    const normalizedUnitName = normalizeName(unit.name);
    const distance = editDistance(normalizedKioskName, normalizedUnitName);
    const threshold = Math.max(3, Math.floor(Math.max(normalizedKioskName.length, normalizedUnitName.length) * 0.25));
    if (distance < bestDistance && distance <= threshold) {
      best = unit;
      bestDistance = distance;
    }
  });
  return best;
}

export function unitExternalLabel(unit: DPUnit) {
  if (unit.externalSource === "kiosk") return "Sincronizada";
  if (unit.externalSource === "pdvlegal") return "PDV Legal";
  if (unit.externalSource === "bizneo") return "Bizneo";
  return "Manual";
}

export function emptyResponsibilityForm(): ResponsibilityForm {
  return {
    responsibleSourceType: "",
    responsibleSourceId: "",
    responsibleUserId: "",
  };
}

export function responsibilityFormFromEntity(entity?: DPUnitResponsibility): ResponsibilityForm {
  return {
    responsibleSourceType: entity?.responsibleSourceType ?? "",
    responsibleSourceId: entity?.responsibleSourceId ?? "",
    responsibleUserId: entity?.responsibleUserId ?? "",
  };
}

export function roleLabel(role: JobRole) {
  return role.publicTitle || role.name;
}

export function functionLabel(item: JobFunction) {
  return item.publicTitle || item.name;
}

export function userMatchesResponsibility(user: User, sourceType: ResponsibilityForm["responsibleSourceType"], sourceId: string) {
  if (!sourceType || !sourceId) return false;
  if (sourceType === "job_role") return user.jobRoleId === sourceId;
  return user.jobFunctionIds?.includes(sourceId) === true;
}

/** Une unidades cadastradas aos quiosques operacionais; quiosques sem cadastro viram "só operacionais". */
export function mergeOperationalUnits(sortedUnits: DPUnit[], kiosks: Kiosk[]): MergedOperationalUnit[] {
  const kioskById = new Map(kiosks.map((kiosk) => [kiosk.id, kiosk]));
  const linkedKioskIds = new Set<string>();

  const registered = sortedUnits.map((unit) => {
    const linkedKiosk =
      unit.externalSource === "kiosk" && unit.externalId
        ? kioskById.get(unit.externalId)
        : kiosks.find((kiosk) => normalizeName(kiosk.name) === normalizeName(unit.name)) ??
          kiosks.find((kiosk) => matchUnitByName(kiosk.name, [unit])?.id === unit.id);

    if (linkedKiosk) linkedKioskIds.add(linkedKiosk.id);

    return {
      key: `unit-${unit.id}`,
      name: unit.name,
      dpUnit: unit,
      kiosk: linkedKiosk,
      organizationId: unit.organizationId,
      groupId: unit.groupId,
      pdvFilialId: unit.pdvFilialId ?? linkedKiosk?.pdvFilialId,
      bizneoTaxonId:
        typeof unit.bizneoTaxonId === "number"
          ? unit.bizneoTaxonId
          : linkedKiosk?.bizneoId && !Number.isNaN(Number(linkedKiosk.bizneoId))
            ? Number(linkedKiosk.bizneoId)
            : undefined,
    };
  });

  const operationalOnly = kiosks
    .filter((kiosk) => !linkedKioskIds.has(kiosk.id))
    .map((kiosk) => ({
      key: `kiosk-${kiosk.id}`,
      name: kiosk.name || kiosk.id,
      kiosk,
      pdvFilialId: kiosk.pdvFilialId,
      bizneoTaxonId:
        kiosk.bizneoId && !Number.isNaN(Number(kiosk.bizneoId)) ? Number(kiosk.bizneoId) : undefined,
    }));

  return sortByName([...registered, ...operationalOnly]);
}

/** Resumo de cobertura exibido na linha e no painel. `needsConfiguration` marca atenção. */
export function coverageSummaryFor(dpUnit?: DPUnit): { text: string; needsConfiguration: boolean } {
  const coverageMode = resolveDPCoverageMode(dpUnit);
  const operatingHoursSummary = formatOperatingHoursSummary(dpUnit?.operatingHours);
  if (coverageMode === "on_demand") {
    return { text: "Sob demanda · definida por data na escala mensal", needsConfiguration: false };
  }
  if (coverageMode === "disabled") {
    return { text: "Controle de cobertura desativado", needsConfiguration: false };
  }
  if (operatingHoursSummary) {
    return { text: operatingHoursSummary, needsConfiguration: false };
  }
  return { text: "Horário de funcionamento não configurado", needsConfiguration: true };
}

export const STOCK_ROLE_LABELS: Record<DPUnitStockRole, string> = {
  commercial: "Comercial",
  mixed: "Mista",
  supply: "Abastecimento",
};

export const COVERAGE_MODE_LABELS: Record<DPCoverageMode, string> = {
  fixed_hours: "Horário fixo",
  on_demand: "Sob demanda",
  disabled: "Sem controle",
};

export function pluralize(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export type ResponsibilityDirectoryLike = {
  roles: JobRole[];
  functions: JobFunction[];
  users: Array<User & { name: string }>;
};

/** Texto de responsável para listas e painéis; `null` quando a entidade não tem vínculo. */
export function describeResponsibility(entity: DPUnitResponsibility, users: ReadonlyArray<User>) {
  if (!entity.responsibleSourceName && !entity.responsibleUserName) return null;
  const sourceTypeLabel = entity.responsibleSourceType === "job_function" ? "Função" : "Cargo";
  const activeResponsible = entity.responsibleUserId ? users.find((user) => user.id === entity.responsibleUserId) : null;
  const needsReplacement =
    entity.responsibilityStatus === "replacement_required" || (!!entity.responsibleUserId && !activeResponsible);
  return {
    person: activeResponsible?.username ?? null,
    source: entity.responsibleSourceName ? `${sourceTypeLabel}: ${entity.responsibleSourceName}` : null,
    needsReplacement,
  };
}

/** Payload de responsabilidade gravado em organização e grupo; vínculo incompleto limpa os cinco campos. */
export function buildResponsibilityPayload(form: ResponsibilityForm, directory: ResponsibilityDirectoryLike) {
  const sourceName =
    form.responsibleSourceType === "job_role"
      ? (() => {
          const role = directory.roles.find((item) => item.id === form.responsibleSourceId);
          return role ? roleLabel(role) : undefined;
        })()
      : form.responsibleSourceType === "job_function"
        ? (() => {
            const item = directory.functions.find((entry) => entry.id === form.responsibleSourceId);
            return item ? functionLabel(item) : undefined;
          })()
        : undefined;
  const responsibleUser = directory.users.find((user) => user.id === form.responsibleUserId);

  if (!form.responsibleSourceType || !form.responsibleSourceId || !sourceName) {
    return {
      responsibleSourceType: undefined,
      responsibleSourceId: undefined,
      responsibleSourceName: undefined,
      responsibleUserId: undefined,
      responsibleUserName: undefined,
    };
  }

  return {
    responsibleSourceType: form.responsibleSourceType,
    responsibleSourceId: form.responsibleSourceId,
    responsibleSourceName: sourceName,
    responsibleUserId: responsibleUser?.id,
    responsibleUserName: responsibleUser?.username,
  };
}

/** Aplica uma mudança de vínculo limpando os níveis que dependem dele. */
export function patchResponsibility<T extends ResponsibilityForm>(current: T, change: Partial<ResponsibilityForm>): T {
  return {
    ...current,
    ...change,
    ...(change.responsibleSourceType !== undefined
      ? { responsibleSourceId: "", responsibleUserId: "" }
      : change.responsibleSourceId !== undefined
        ? { responsibleUserId: "" }
        : {}),
  };
}

export type GroupByMode = "none" | "organization" | "group";

export type ListBand = {
  type: "band";
  key: string;
  level: 0 | 1;
  title: string;
  subtitle?: string;
  meta: string;
  /** Organização ou grupo da faixa; ausente nas faixas "Sem ...". */
  entity?: { kind: "organization"; value: DPUnitOrganization } | { kind: "group"; value: DPUnitGroup };
  ancestors: string[];
};
export type UnitEntry = ListBand | { type: "unit"; unit: MergedOperationalUnit; ancestors: string[] };
export type GroupEntry = ListBand | { type: "group"; group: DPUnitGroup; ancestors: string[] };

export const NO_ORGANIZATION_KEY = "__no_organization__";
export const NO_GROUP_KEY = "__no_group__";

type UnitStructure = { group?: DPUnitGroup; organization?: DPUnitOrganization };

/**
 * Entradas da lista de unidades com faixas de título. `none` devolve só as unidades.
 * `organization` aninha grupos dentro da organização; `group` usa uma faixa por grupo.
 * Faixas sem unidades visíveis não aparecem; "Sem ..." vem sempre por último.
 */
export function buildGroupedUnitEntries(
  units: MergedOperationalUnit[],
  mode: GroupByMode,
  organizations: DPUnitOrganization[],
  groups: DPUnitGroup[],
  structureOf: (unit: MergedOperationalUnit) => UnitStructure,
): UnitEntry[] {
  if (mode === "none") return units.map((unit) => ({ type: "unit", unit, ancestors: [] }));

  const entries: UnitEntry[] = [];
  const withStructure = units.map((unit) => ({ unit, ...structureOf(unit) }));

  if (mode === "group") {
    const sections: Array<{ group?: DPUnitGroup; items: typeof withStructure }> = [
      ...groups.map((group) => ({ group, items: withStructure.filter((item) => item.group?.id === group.id) })),
      { group: undefined, items: withStructure.filter((item) => !item.group) },
    ];
    for (const section of sections) {
      if (section.items.length === 0) continue;
      const key = `group:${section.group?.id ?? NO_GROUP_KEY}`;
      entries.push({
        type: "band",
        key,
        level: 0,
        title: section.group?.name ?? "Sem grupo",
        subtitle: section.group
          ? organizations.find((organization) => organization.id === section.group?.organizationId)?.name
          : undefined,
        meta: pluralize(section.items.length, "unidade", "unidades"),
        entity: section.group ? { kind: "group", value: section.group } : undefined,
        ancestors: [],
      });
      for (const item of section.items) entries.push({ type: "unit", unit: item.unit, ancestors: [key] });
    }
    return entries;
  }

  const organizationSections: Array<{ organization?: DPUnitOrganization; items: typeof withStructure }> = [
    ...organizations.map((organization) => ({
      organization,
      items: withStructure.filter((item) => item.organization?.id === organization.id),
    })),
    { organization: undefined, items: withStructure.filter((item) => !item.organization) },
  ];
  for (const section of organizationSections) {
    if (section.items.length === 0) continue;
    const orgKey = `organization:${section.organization?.id ?? NO_ORGANIZATION_KEY}`;
    const groupSections = [
      ...groups
        .filter((group) => section.items.some((item) => item.group?.id === group.id))
        .map((group) => ({ group, items: section.items.filter((item) => item.group?.id === group.id) })),
      { group: undefined as DPUnitGroup | undefined, items: section.items.filter((item) => !item.group) },
    ].filter((groupSection) => groupSection.items.length > 0);
    entries.push({
      type: "band",
      key: orgKey,
      level: 0,
      title: section.organization?.name ?? "Sem organização",
      meta: `${pluralize(groupSections.filter((item) => item.group).length, "grupo", "grupos")} · ${pluralize(section.items.length, "unidade", "unidades")}`,
      entity: section.organization ? { kind: "organization", value: section.organization } : undefined,
      ancestors: [],
    });
    for (const groupSection of groupSections) {
      const groupKey = `${orgKey}/group:${groupSection.group?.id ?? NO_GROUP_KEY}`;
      entries.push({
        type: "band",
        key: groupKey,
        level: 1,
        title: groupSection.group?.name ?? "Sem grupo",
        meta: pluralize(groupSection.items.length, "unidade", "unidades"),
        entity: groupSection.group ? { kind: "group", value: groupSection.group } : undefined,
        ancestors: [orgKey],
      });
      for (const item of groupSection.items) entries.push({ type: "unit", unit: item.unit, ancestors: [orgKey, groupKey] });
    }
  }
  return entries;
}

/** Faixas por organização para a aba de grupos. `none` e `group` devolvem a lista plana. */
export function buildGroupedGroupEntries(
  groups: DPUnitGroup[],
  mode: GroupByMode,
  organizations: DPUnitOrganization[],
): GroupEntry[] {
  if (mode !== "organization") return groups.map((group) => ({ type: "group", group, ancestors: [] }));

  const entries: GroupEntry[] = [];
  const sections = [
    ...organizations.map((organization) => ({ organization, items: groups.filter((group) => group.organizationId === organization.id) })),
    {
      organization: undefined as DPUnitOrganization | undefined,
      items: groups.filter((group) => !organizations.some((organization) => organization.id === group.organizationId)),
    },
  ];
  for (const section of sections) {
    if (section.items.length === 0) continue;
    const key = `organization:${section.organization?.id ?? NO_ORGANIZATION_KEY}`;
    entries.push({
      type: "band",
      key,
      level: 0,
      title: section.organization?.name ?? "Sem organização",
      meta: pluralize(section.items.length, "grupo", "grupos"),
      entity: section.organization ? { kind: "organization", value: section.organization } : undefined,
      ancestors: [],
    });
    for (const group of section.items) entries.push({ type: "group", group, ancestors: [key] });
  }
  return entries;
}
