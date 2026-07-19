"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Building2,
  ChevronDown,
  Clock3,
  FolderTree,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Store,
  Trash2,
  UserRound,
} from "lucide-react";

import { useDP } from "@/components/dp-context";
import { useAuth } from "@/hooks/use-auth";
import { useDPBootstrap } from "@/hooks/use-dp-bootstrap";
import { useHrBootstrap } from "@/hooks/use-hr-bootstrap";
import { useKiosks } from "@/hooks/use-kiosks";
import { CnpjValidator } from "@/lib/company/cnpj-validator";
import { shiftDefinitionMatchesUnit } from "@/lib/dp-shift-definitions";
import { activeOperationalUnits } from "@/lib/dp-units";
import type {
  DPShiftDefinition,
  DPUnit,
  DPUnitGroup,
  DPUnitOrganization,
  DPUnitResponsibility,
  JobFunction,
  JobRole,
  Kiosk,
  User,
} from "@/types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type OrganizationDialogState =
  | { mode: "create"; organization?: null }
  | { mode: "edit"; organization: DPUnitOrganization };

type GroupDialogState =
  | { mode: "create"; organizationId?: string; group?: null }
  | { mode: "edit"; group: DPUnitGroup };

type UnitDialogState =
  | { mode: "manual"; organizationId?: string; groupId?: string; unit?: null }
  | { mode: "sync"; organizationId?: string; groupId?: string; kioskId?: string; unit?: null }
  | { mode: "edit"; unit: DPUnit };

type DeleteTarget =
  | { kind: "organization"; id: string; name: string }
  | { kind: "group"; id: string; name: string }
  | { kind: "unit"; id: string; name: string };

type ResponsibilityForm = {
  responsibleSourceType: "" | "job_role" | "job_function";
  responsibleSourceId: string;
  responsibleUserId: string;
};

type OrganizationForm = {
  name: string;
  description: string;
} & ResponsibilityForm;

type GroupForm = {
  name: string;
  organizationId: string;
} & ResponsibilityForm;

type UnitForm = {
  name: string;
  cnpj: string;
  address: string;
  unitType: string;
  organizationId: string;
  groupId: string;
  kioskId: string;
  pdvFilialId: string;
  bizneoTaxonId: string;
};

type MergedOperationalUnit = {
  key: string;
  name: string;
  dpUnit?: DPUnit;
  kiosk?: Kiosk;
  organizationId?: string;
  groupId?: string;
  pdvFilialId?: string;
  bizneoTaxonId?: number;
};

const NONE = "__none__";

function sortByName<T extends { name: string }>(items: T[]) {
  return [...items].sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
}

function normalizeName(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/quiosque\s*/gi, "")
    .replace(/quisque\s*/gi, "")
    .replace(/centro de distribuicao\s*/gi, "")
    .replace(/[-–_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function maskCnpjInput(value: string) {
  const digits = CnpjValidator.clean(value).slice(0, 14);
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  if (digits.length <= 12) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
  return CnpjValidator.format(digits);
}

function editDistance(a: string, b: string) {
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

function matchUnitByName(kioskName: string, units: DPUnit[]) {
  const normalizedKioskName = normalizeName(kioskName);
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

function unitExternalLabel(unit: DPUnit) {
  if (unit.externalSource === "kiosk") return "Sincronizada";
  if (unit.externalSource === "pdvlegal") return "PDV Legal";
  if (unit.externalSource === "bizneo") return "Bizneo";
  return "Manual";
}

function emptyResponsibilityForm(): ResponsibilityForm {
  return {
    responsibleSourceType: "",
    responsibleSourceId: "",
    responsibleUserId: "",
  };
}

function responsibilityFormFromEntity(entity?: DPUnitResponsibility): ResponsibilityForm {
  return {
    responsibleSourceType: entity?.responsibleSourceType ?? "",
    responsibleSourceId: entity?.responsibleSourceId ?? "",
    responsibleUserId: entity?.responsibleUserId ?? "",
  };
}

function roleLabel(role: JobRole) {
  return role.publicTitle || role.name;
}

function functionLabel(item: JobFunction) {
  return item.publicTitle || item.name;
}

function userMatchesResponsibility(user: User, sourceType: ResponsibilityForm["responsibleSourceType"], sourceId: string) {
  if (!sourceType || !sourceId) return false;
  if (sourceType === "job_role") return user.jobRoleId === sourceId;
  return user.jobFunctionIds?.includes(sourceId) === true;
}

function UnitCreateMenu({
  organizationId,
  groupId,
  onManual,
  onSync,
}: {
  organizationId?: string;
  groupId?: string;
  onManual: (context: { organizationId?: string; groupId?: string }) => void;
  onSync: (context: { organizationId?: string; groupId?: string }) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className="h-9 rounded-xl">
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Nova unidade
          <ChevronDown className="ml-1.5 h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onManual({ organizationId, groupId })}>
          <Plus className="mr-2 h-3.5 w-3.5" />
          Criar manualmente
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onSync({ organizationId, groupId })}>
          <RefreshCw className="mr-2 h-3.5 w-3.5" />
          Criar via sincronização
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
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
  const {
    units,
    unitGroups,
    unitOrganizations,
    shiftDefinitions,
    unitsLoading,
    unitsError,
  } = useDPBootstrap();
  const { kiosks } = useKiosks();
  const canManageUnits = !!(
    permissions.settings.manageUsers ||
    permissions.settings.manageKiosks ||
    permissions.dp?.settings?.manageUnits
  );

  const [organizationDialog, setOrganizationDialog] = useState<OrganizationDialogState | null>(null);
  const [groupDialog, setGroupDialog] = useState<GroupDialogState | null>(null);
  const [unitDialog, setUnitDialog] = useState<UnitDialogState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [saving, setSaving] = useState<"organization" | "group" | "unit" | "delete" | null>(null);

  const [organizationForm, setOrganizationForm] = useState<OrganizationForm>({
    name: "",
    description: "",
    ...emptyResponsibilityForm(),
  });
  const [groupForm, setGroupForm] = useState<GroupForm>({
    name: "",
    organizationId: "",
    ...emptyResponsibilityForm(),
  });
  const [unitForm, setUnitForm] = useState<UnitForm>({
    name: "",
    cnpj: "",
    address: "",
    unitType: "",
    organizationId: "",
    groupId: "",
    kioskId: "",
    pdvFilialId: "",
    bizneoTaxonId: "",
  });
  const unitCnpjValidation = unitForm.cnpj.trim()
    ? CnpjValidator.validate(unitForm.cnpj)
    : null;

  const organizations = useMemo(
    () => sortByName(activeOperationalUnits(unitOrganizations)),
    [unitOrganizations]
  );
  const groups = useMemo(() => sortByName(unitGroups), [unitGroups]);
  const sortedUnits = useMemo(() => sortByName(activeOperationalUnits(units)), [units]);
  const activeRoles = useMemo(() => sortByName(roles.filter((role) => role.isActive !== false)), [roles]);
  const activeFunctions = useMemo(
    () => sortByName(functions.filter((item) => item.isActive !== false)),
    [functions]
  );
  const responsibilityUsers = useMemo(
    () => sortByName(activeUsers.filter((user) => user.isActive !== false).map((user) => ({ ...user, name: user.username }))),
    [activeUsers]
  );

  const organizationById = useMemo(
    () => new Map(organizations.map((organization) => [organization.id, organization])),
    [organizations]
  );
  const groupById = useMemo(
    () => new Map(groups.map((group) => [group.id, group])),
    [groups]
  );
  const kioskById = useMemo(
    () => new Map(kiosks.map((kiosk) => [kiosk.id, kiosk])),
    [kiosks]
  );

  const mergedUnits = useMemo<MergedOperationalUnit[]>(() => {
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
        name: kiosk.name,
        kiosk,
        pdvFilialId: kiosk.pdvFilialId,
        bizneoTaxonId:
          kiosk.bizneoId && !Number.isNaN(Number(kiosk.bizneoId))
            ? Number(kiosk.bizneoId)
            : undefined,
      }));

    return sortByName([...registered, ...operationalOnly]);
  }, [kioskById, kiosks, sortedUnits]);

  const registeredKioskIds = useMemo(() => {
    return new Set(
      mergedUnits
        .filter((unit) => unit.dpUnit)
        .map((unit) => unit.kiosk?.id)
        .filter(Boolean) as string[]
    );
  }, [mergedUnits]);

  const syncCandidates = useMemo(() => {
    return sortByName(kiosks.filter((kiosk) => !registeredKioskIds.has(kiosk.id)));
  }, [kiosks, registeredKioskIds]);

  const availableGroupsForUnitForm = useMemo(() => {
    if (!unitForm.organizationId) return groups;
    return groups.filter((group) => group.organizationId === unitForm.organizationId);
  }, [groups, unitForm.organizationId]);

  useEffect(() => {
    if (!organizationDialog) return;
    if (organizationDialog.mode === "edit") {
      setOrganizationForm({
        name: organizationDialog.organization.name,
        description: organizationDialog.organization.description ?? "",
        ...responsibilityFormFromEntity(organizationDialog.organization),
      });
      return;
    }
    setOrganizationForm({ name: "", description: "", ...emptyResponsibilityForm() });
  }, [organizationDialog]);

  useEffect(() => {
    if (!groupDialog) return;
    if (groupDialog.mode === "edit") {
      setGroupForm({
        name: groupDialog.group.name,
        organizationId: groupDialog.group.organizationId ?? "",
        ...responsibilityFormFromEntity(groupDialog.group),
      });
      return;
    }
    setGroupForm({
      name: "",
      organizationId: groupDialog.organizationId ?? "",
      ...emptyResponsibilityForm(),
    });
  }, [groupDialog]);

  useEffect(() => {
    if (!unitDialog) return;

    if (unitDialog.mode === "edit") {
      const group = unitDialog.unit.groupId ? groupById.get(unitDialog.unit.groupId) : null;
      setUnitForm({
        name: unitDialog.unit.name,
        cnpj: unitDialog.unit.cnpj ? CnpjValidator.format(unitDialog.unit.cnpj) : "",
        address: unitDialog.unit.address ?? "",
        unitType: unitDialog.unit.unitType ?? "",
        organizationId: unitDialog.unit.organizationId ?? group?.organizationId ?? "",
        groupId: unitDialog.unit.groupId ?? "",
        kioskId: "",
        pdvFilialId: unitDialog.unit.pdvFilialId ?? "",
        bizneoTaxonId:
          typeof unitDialog.unit.bizneoTaxonId === "number"
            ? String(unitDialog.unit.bizneoTaxonId)
            : "",
      });
      return;
    }

    const firstCandidate = unitDialog.mode === "sync"
      ? unitDialog.kioskId
        ? kiosks.find((kiosk) => kiosk.id === unitDialog.kioskId) ?? syncCandidates[0]
        : syncCandidates[0]
      : null;
    setUnitForm({
      name: firstCandidate?.name ?? "",
      cnpj: "",
      address: "",
      unitType: "",
      organizationId: unitDialog.organizationId ?? "",
      groupId: unitDialog.groupId ?? "",
      kioskId: firstCandidate?.id ?? "",
      pdvFilialId: firstCandidate?.pdvFilialId ?? "",
      bizneoTaxonId:
        firstCandidate?.bizneoId && !Number.isNaN(Number(firstCandidate.bizneoId))
          ? String(Number(firstCandidate.bizneoId))
          : "",
    });
  }, [groupById, kiosks, syncCandidates, unitDialog]);

  function unitsForGroup(groupId: string) {
    return mergedUnits.filter((unit) => unit.groupId === groupId);
  }

  function organizationGroups(organizationId: string) {
    return groups.filter((group) => group.organizationId === organizationId);
  }

  const unorganizedGroups = useMemo(() => {
    return groups.filter((group) => !group.organizationId || !organizationById.has(group.organizationId));
  }, [groups, organizationById]);

  const ungroupedUnits = useMemo(() => {
    return mergedUnits.filter((unit) => {
      const hasValidGroup = unit.groupId ? groupById.has(unit.groupId) : false;
      const hasValidOrganization = unit.organizationId ? organizationById.has(unit.organizationId) : false;
      return !hasValidGroup && !hasValidOrganization;
    });
  }, [groupById, mergedUnits, organizationById]);

  function ungroupedUnitsForOrganization(organizationId: string) {
    return mergedUnits.filter((unit) => {
      const hasValidGroup = unit.groupId ? groupById.has(unit.groupId) : false;
      return !hasValidGroup && unit.organizationId === organizationId;
    });
  }

  function responsibilitySourceName(form: ResponsibilityForm) {
    if (form.responsibleSourceType === "job_role") {
      const role = activeRoles.find((item) => item.id === form.responsibleSourceId);
      return role ? roleLabel(role) : undefined;
    }

    if (form.responsibleSourceType === "job_function") {
      const item = activeFunctions.find((entry) => entry.id === form.responsibleSourceId);
      return item ? functionLabel(item) : undefined;
    }

    return undefined;
  }

  function responsibilityCandidates(form: ResponsibilityForm) {
    return responsibilityUsers.filter((user) =>
      userMatchesResponsibility(user, form.responsibleSourceType, form.responsibleSourceId)
    );
  }

  function buildResponsibilityPayload(form: ResponsibilityForm) {
    const sourceName = responsibilitySourceName(form);
    const responsibleUser = responsibilityUsers.find((user) => user.id === form.responsibleUserId);

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

  function updateOrganizationResponsibility(patch: Partial<ResponsibilityForm>) {
    setOrganizationForm((current) => ({
      ...current,
      ...patch,
      ...(patch.responsibleSourceType !== undefined
        ? { responsibleSourceId: "", responsibleUserId: "" }
        : patch.responsibleSourceId !== undefined
          ? { responsibleUserId: "" }
          : {}),
    }));
  }

  function updateGroupResponsibility(patch: Partial<ResponsibilityForm>) {
    setGroupForm((current) => ({
      ...current,
      ...patch,
      ...(patch.responsibleSourceType !== undefined
        ? { responsibleSourceId: "", responsibleUserId: "" }
        : patch.responsibleSourceId !== undefined
          ? { responsibleUserId: "" }
          : {}),
    }));
  }

  async function handleSaveOrganization() {
    const name = organizationForm.name.trim();
    if (!name) return;

    setSaving("organization");
    try {
      if (organizationDialog?.mode === "edit") {
        await updateUnitOrganization({
          ...organizationDialog.organization,
          name,
          description: organizationForm.description.trim() || undefined,
          ...buildResponsibilityPayload(organizationForm),
        });
      } else {
        await addUnitOrganization({
          name,
          description: organizationForm.description.trim() || undefined,
          ...buildResponsibilityPayload(organizationForm),
        });
      }
      setOrganizationDialog(null);
    } finally {
      setSaving(null);
    }
  }

  async function handleSaveGroup() {
    const name = groupForm.name.trim();
    if (!name) return;

    setSaving("group");
    try {
      if (groupDialog?.mode === "edit") {
        await updateUnitGroup({
          ...groupDialog.group,
          name,
          organizationId: groupForm.organizationId || undefined,
          ...buildResponsibilityPayload(groupForm),
        });
      } else {
        await addUnitGroup({
          name,
          organizationId: groupForm.organizationId || undefined,
          ...buildResponsibilityPayload(groupForm),
        });
      }
      setGroupDialog(null);
    } finally {
      setSaving(null);
    }
  }

  async function handleSaveUnit() {
    const name = unitForm.name.trim();
    if (!name) return;
    if (unitCnpjValidation && !unitCnpjValidation.valid) return;

    const selectedGroup = unitForm.groupId ? groupById.get(unitForm.groupId) : null;
    const organizationId = selectedGroup?.organizationId ?? unitForm.organizationId;
    const bizneoTaxonId = unitForm.bizneoTaxonId.trim()
      ? Number(unitForm.bizneoTaxonId)
      : undefined;
    const selectedKiosk = unitForm.kioskId
      ? kiosks.find((kiosk) => kiosk.id === unitForm.kioskId)
      : null;

    setSaving("unit");
    try {
      if (unitDialog?.mode === "edit") {
        await updateUnit({
          ...unitDialog.unit,
          name,
          cnpj: unitCnpjValidation?.clean,
          address: unitForm.address.trim() || undefined,
          unitType: unitForm.unitType.trim() || undefined,
          organizationId: organizationId || undefined,
          groupId: unitForm.groupId || undefined,
          pdvFilialId: unitForm.pdvFilialId.trim() || undefined,
          bizneoTaxonId,
        });
      } else {
        await addUnit({
          name,
          cnpj: unitCnpjValidation?.clean,
          address: unitForm.address.trim() || undefined,
          unitType: unitForm.unitType.trim() || undefined,
          organizationId: organizationId || undefined,
          groupId: unitForm.groupId || undefined,
          externalSource: unitDialog?.mode === "sync" ? "kiosk" : "manual",
          externalId: unitDialog?.mode === "sync" ? selectedKiosk?.id : undefined,
          pdvFilialId: unitForm.pdvFilialId.trim() || selectedKiosk?.pdvFilialId || undefined,
          bizneoTaxonId,
        });
      }
      setUnitDialog(null);
    } finally {
      setSaving(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;

    setSaving("delete");
    try {
      if (deleteTarget.kind === "organization") {
        await deleteUnitOrganization(deleteTarget.id);
      }
      if (deleteTarget.kind === "group") {
        await deleteUnitGroup(deleteTarget.id);
      }
      if (deleteTarget.kind === "unit") {
        await deleteUnit(deleteTarget.id);
      }
      setDeleteTarget(null);
    } finally {
      setSaving(null);
    }
  }

  async function handleDetachUnitFromGroup(unit: DPUnit) {
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

  function openManualUnit(context: { organizationId?: string; groupId?: string }) {
    setUnitDialog({ mode: "manual", ...context });
  }

  function openSyncUnit(context: { organizationId?: string; groupId?: string; kioskId?: string }) {
    setUnitDialog({ mode: "sync", ...context });
  }

  function handleSelectUnitOrganization(value: string) {
    const organizationId = value === NONE ? "" : value;
    setUnitForm((current) => {
      const currentGroup = current.groupId ? groupById.get(current.groupId) : null;
      return {
        ...current,
        organizationId,
        groupId:
          currentGroup && currentGroup.organizationId === organizationId
            ? current.groupId
            : "",
      };
    });
  }

  function handleSelectUnitGroup(value: string) {
    const groupId = value === NONE ? "" : value;
    const group = groupId ? groupById.get(groupId) : null;
    setUnitForm((current) => ({
      ...current,
      groupId,
      organizationId: group?.organizationId ?? current.organizationId,
    }));
  }

  function handleSelectSyncCandidate(kioskId: string) {
    if (kioskId === "__empty__") return;

    const kiosk = kiosks.find((entry) => entry.id === kioskId);
    setUnitForm((current) => ({
      ...current,
      kioskId,
      name: kiosk?.name ?? current.name,
      pdvFilialId: kiosk?.pdvFilialId ?? "",
      bizneoTaxonId:
        kiosk?.bizneoId && !Number.isNaN(Number(kiosk.bizneoId))
          ? String(Number(kiosk.bizneoId))
        : "",
    }));
  }

  function renderResponsibilitySummary(entity: DPUnitResponsibility) {
    if (!entity.responsibleSourceName && !entity.responsibleUserName) return null;

    const sourceTypeLabel = entity.responsibleSourceType === "job_function" ? "Função" : "Cargo";

    return (
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <UserRound className="h-3.5 w-3.5" />
        {entity.responsibleUserName ? (
          <Badge variant="outline" className="rounded-full">
            Responsável: {entity.responsibleUserName}
          </Badge>
        ) : null}
        {entity.responsibleSourceName ? (
          <span>
            {sourceTypeLabel}: {entity.responsibleSourceName}
          </span>
        ) : null}
      </div>
    );
  }

  function renderResponsibilityFields(
    form: ResponsibilityForm,
    onPatch: (patch: Partial<ResponsibilityForm>) => void
  ) {
    const sourceOptions =
      form.responsibleSourceType === "job_role"
        ? activeRoles.map((role) => ({ id: role.id, label: roleLabel(role) }))
        : form.responsibleSourceType === "job_function"
          ? activeFunctions.map((item) => ({ id: item.id, label: functionLabel(item) }))
          : [];
    const candidates = responsibilityCandidates(form);

    return (
      <div className="space-y-3 rounded-2xl border bg-muted/10 p-3">
        <div>
          <p className="text-sm font-medium">Responsabilidade</p>
          <p className="text-xs text-muted-foreground">
            Vincule primeiro a um cargo ou função. Depois selecione a pessoa responsável entre os nomes compatíveis.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Tipo de vínculo</Label>
            <Select
              value={form.responsibleSourceType || NONE}
              onValueChange={(value) =>
                onPatch({
                  responsibleSourceType:
                    value === NONE ? "" : (value as ResponsibilityForm["responsibleSourceType"]),
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Sem responsavel</SelectItem>
                <SelectItem value="job_role">Cargo</SelectItem>
                <SelectItem value="job_function">Função</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{form.responsibleSourceType === "job_function" ? "Função" : "Cargo"}</Label>
            <Select
              value={form.responsibleSourceId || NONE}
              onValueChange={(value) =>
                onPatch({ responsibleSourceId: value === NONE ? "" : value })
              }
              disabled={!form.responsibleSourceType}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>
                  {form.responsibleSourceType ? "Selecione" : "Escolha o tipo primeiro"}
                </SelectItem>
                {sourceOptions.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.label}
                  </SelectItem>
                ))}
                {form.responsibleSourceType && sourceOptions.length === 0 ? (
                  <SelectItem value="__empty_source__" disabled>
                    Nenhuma opção disponível
                  </SelectItem>
                ) : null}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Pessoa responsável</Label>
          <Select
            value={form.responsibleUserId || NONE}
            onValueChange={(value) =>
              onPatch({ responsibleUserId: value === NONE ? "" : value })
            }
            disabled={!form.responsibleSourceId}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>
                {form.responsibleSourceId ? "Sem responsável definido" : "Escolha cargo/função primeiro"}
              </SelectItem>
              {candidates.map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {user.username}
                </SelectItem>
              ))}
              {form.responsibleSourceId && candidates.length === 0 ? (
                <SelectItem value="__empty_users__" disabled>
                  Nenhum colaborador encontrado para este vínculo
                </SelectItem>
              ) : null}
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  }

  function renderActionsForOrganization(organization: DPUnitOrganization) {
    if (!canManageUnits) return null;

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setOrganizationDialog({ mode: "edit", organization })}>
            <Pencil className="mr-2 h-3.5 w-3.5" />
            Editar organização
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => setDeleteTarget({ kind: "organization", id: organization.id, name: organization.name })}
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" />
            Excluir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  function renderActionsForGroup(group: DPUnitGroup) {
    if (!canManageUnits) return null;

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setGroupDialog({ mode: "edit", group })}>
            <Pencil className="mr-2 h-3.5 w-3.5" />
            Editar grupo
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => setDeleteTarget({ kind: "group", id: group.id, name: group.name })}
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" />
            Excluir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  function renderActionsForUnit(unit: DPUnit) {
    if (!canManageUnits) return null;

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setUnitDialog({ mode: "edit", unit })}>
            <Pencil className="mr-2 h-3.5 w-3.5" />
            Editar unidade
          </DropdownMenuItem>
          {unit.groupId ? (
            <DropdownMenuItem onClick={() => void handleDetachUnitFromGroup(unit)}>
              <Link2 className="mr-2 h-3.5 w-3.5" />
              Remover do grupo
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => setDeleteTarget({ kind: "unit", id: unit.id, name: unit.name })}
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" />
            Excluir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  function shiftsForMergedUnit(unit: MergedOperationalUnit) {
    const dpUnit = unit.dpUnit ?? (unit.kiosk ? matchUnitByName(unit.kiosk.name, units) : undefined);
    if (!dpUnit) return [];
    return shiftDefinitions.filter((shift) => shiftDefinitionMatchesUnit(shift, dpUnit.id));
  }

  function renderActionsForMergedUnit(unit: MergedOperationalUnit) {
    if (unit.dpUnit) return renderActionsForUnit(unit.dpUnit);
    if (!canManageUnits) return null;

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => openSyncUnit({ kioskId: unit.kiosk?.id })}
          >
            <RefreshCw className="mr-2 h-3.5 w-3.5" />
            Cadastrar na estrutura
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  function renderUnitRow(unit: MergedOperationalUnit) {
    const shifts = shiftsForMergedUnit(unit);
    const isOperationalOnly = !unit.dpUnit;
    // Metadados de integração viram uma linha calma separada por "·" em vez de
    // uma enxurrada de pills; só a origem fica como marcador visível.
    const metaParts = [
      unit.dpUnit?.cnpj ? CnpjValidator.format(unit.dpUnit.cnpj) : null,
      unit.dpUnit?.unitType || null,
      unit.pdvFilialId ? `PDV ${unit.pdvFilialId}` : null,
      typeof unit.bizneoTaxonId === "number"
        ? `Bizneo ${unit.bizneoTaxonId}`
        : "Sem Bizneo",
    ].filter(Boolean) as string[];

    return (
      <div
        key={unit.key}
        className="group/unit flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/50"
      >
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border",
            isOperationalOnly
              ? "border-dashed border-border bg-transparent text-muted-foreground"
              : "border-transparent bg-muted text-foreground"
          )}
        >
          <Store className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium">{unit.name}</p>
            <span
              className={cn(
                "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
                isOperationalOnly
                  ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {unit.dpUnit ? unitExternalLabel(unit.dpUnit) : "Só operacional"}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>{metaParts.join(" · ")}</span>
            {shifts.length > 0 ? (
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="text-border">·</span>
                {shifts.map((shift) => (
                  <span
                    key={shift.id}
                    className="inline-flex items-center gap-1 rounded bg-muted/70 px-1.5 py-0.5 tabular-nums"
                  >
                    <Clock3 className="h-3 w-3" />
                    {shift.name} {shift.startTime}–{shift.endTime}
                  </span>
                ))}
              </span>
            ) : (
              <span className="italic">Sem turno vinculado</span>
            )}
          </div>
          {unit.dpUnit?.address ? (
            <p className="mt-1 truncate text-xs text-muted-foreground" title={unit.dpUnit.address}>
              {unit.dpUnit.address}
            </p>
          ) : null}
        </div>
        <div className="opacity-60 transition-opacity group-hover/unit:opacity-100">
          {renderActionsForMergedUnit(unit)}
        </div>
      </div>
    );
  }

  function renderGroupBlock(group: DPUnitGroup) {
    const groupUnits = unitsForGroup(group.id);
    const unitLabel = `${groupUnits.length} ${groupUnits.length === 1 ? "unidade" : "unidades"}`;

    return (
      <div key={group.id} className="px-4 py-3 first:pt-4 last:pb-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <FolderTree className="h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="truncate text-sm font-semibold">{group.name}</p>
              <span className="shrink-0 text-xs font-normal text-muted-foreground">
                {unitLabel}
              </span>
            </div>
            {renderResponsibilitySummary(group)}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {renderActionsForGroup(group)}
          </div>
        </div>

        {/* Trilho que costura as unidades sob o grupo. */}
        <div className="ml-2 mt-2 border-l border-border/70 pl-3">
          {groupUnits.length > 0 ? (
            <div className="space-y-0.5">{groupUnits.map(renderUnitRow)}</div>
          ) : (
            <p className="px-3 py-3 text-sm text-muted-foreground">
              Nenhuma unidade neste grupo ainda.
            </p>
          )}
        </div>
      </div>
    );
  }

  function renderOrganizationCard(organization: DPUnitOrganization) {
    const orgGroups = organizationGroups(organization.id);
    const orgUngroupedUnits = ungroupedUnitsForOrganization(organization.id);
    const groupedUnitCount = orgGroups.reduce((total, group) => total + unitsForGroup(group.id).length, 0);
    const unitCount = groupedUnitCount + orgUngroupedUnits.length;

    const groupsLabel = `${orgGroups.length} ${orgGroups.length === 1 ? "grupo" : "grupos"}`;
    const unitsLabel = `${unitCount} ${unitCount === 1 ? "unidade" : "unidades"}`;

    return (
      <section
        key={organization.id}
        className="overflow-hidden rounded-2xl border bg-card shadow-sm"
      >
        <div className="flex flex-col gap-3 border-b bg-primary/[0.04] px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Building2 className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0">
                <h3 className="truncate text-base font-semibold leading-tight">
                  {organization.name}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {groupsLabel} · {unitsLabel}
                </p>
              </div>
            </div>
            {organization.description ? (
              <p className="mt-2 text-sm text-muted-foreground">{organization.description}</p>
            ) : null}
            {renderResponsibilitySummary(organization)}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {canManageUnits ? (
              <Button
                size="sm"
                variant="outline"
                className="h-9 rounded-xl bg-background"
                onClick={() => setGroupDialog({ mode: "create", organizationId: organization.id })}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Novo grupo
              </Button>
            ) : null}
            {renderActionsForOrganization(organization)}
          </div>
        </div>

        {orgGroups.length > 0 || orgUngroupedUnits.length > 0 ? (
          <div className="divide-y">
            {orgGroups.map((group) => renderGroupBlock(group))}
            {orgUngroupedUnits.length > 0 ? (
              <div>
                <div className="px-4 pt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Unidades sem grupo
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Vinculadas a esta organização, mas ainda sem grupo.
                  </p>
                </div>
                <div className="px-4 pb-4 pt-2">
                  <div className="space-y-0.5">{orgUngroupedUnits.map(renderUnitRow)}</div>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            Nenhum grupo nesta organização ainda.
          </div>
        )}
      </section>
    );
  }

  if (unitsLoading && units.length === 0 && groups.length === 0 && organizations.length === 0) {
    return <p className="text-sm text-muted-foreground">Carregando...</p>;
  }

  if (unitsError && units.length === 0) {
    return <p className="text-sm text-destructive">Erro ao carregar unidades: {unitsError}</p>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold">Estrutura organizacional</h3>
          <p className="text-sm text-muted-foreground">
            Organizações reúnem grupos; grupos reúnem unidades.
          </p>
        </div>
        {canManageUnits ? (
          <div className="flex flex-wrap items-center gap-2">
            <UnitCreateMenu onManual={openManualUnit} onSync={openSyncUnit} />
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => setOrganizationDialog({ mode: "create" })}
            >
              <Plus className="mr-2 h-4 w-4" />
              Nova organização
            </Button>
          </div>
        ) : null}
      </div>

      <div className="space-y-4">
        {organizations.length > 0 ? (
          organizations.map(renderOrganizationCard)
        ) : (
          <div className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            Nenhuma organização cadastrada. Crie uma organização para começar a estruturar os grupos.
          </div>
        )}

        <section className="overflow-hidden rounded-2xl border border-dashed bg-muted/20">
          <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-dashed border-border bg-background text-muted-foreground">
                  <Link2 className="h-[18px] w-[18px]" />
                </span>
                <div className="min-w-0">
                  <h3 className="truncate text-base font-semibold leading-tight">Sem organização</h3>
                  <p className="text-xs text-muted-foreground">
                    {unorganizedGroups.length}{" "}
                    {unorganizedGroups.length === 1 ? "grupo" : "grupos"} ·{" "}
                    {ungroupedUnits.length} sem grupo
                  </p>
                </div>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Itens ainda não vinculados a uma organização aparecem aqui.
              </p>
            </div>
          </div>

          {unorganizedGroups.length > 0 ? (
            <div className="divide-y border-t border-dashed bg-background/60">
              {unorganizedGroups.map((group) => renderGroupBlock(group))}
            </div>
          ) : null}

          {ungroupedUnits.length > 0 ? (
            <div className="border-t border-dashed bg-background/60">
              <div className="px-4 pt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Unidades sem grupo
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Inclui unidades cadastradas sem grupo e unidades só operacionais ainda não cadastradas na estrutura.
                </p>
              </div>
              <div className="px-4 pb-4 pt-2">
                <div className="space-y-0.5">{ungroupedUnits.map(renderUnitRow)}</div>
              </div>
            </div>
          ) : unorganizedGroups.length === 0 ? (
            <div className="border-t border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              Nenhuma unidade sem organização.
            </div>
          ) : null}
        </section>
      </div>

      <Dialog open={!!organizationDialog} onOpenChange={(open) => !open && setOrganizationDialog(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {organizationDialog?.mode === "edit" ? "Editar organização" : "Nova organização"}
            </DialogTitle>
            <DialogDescription>
              Uma organização agrupa os grupos de unidades da operação.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input
                value={organizationForm.name}
                onChange={(event) => setOrganizationForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Ex.: Grupo Elo"
              />
            </div>
            <div className="space-y-2">
              <Label>Descrição</Label>
              <Textarea
                value={organizationForm.description}
                onChange={(event) => setOrganizationForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="Uso interno para contexto da organização."
                className="min-h-24"
              />
            </div>
            {renderResponsibilityFields(organizationForm, updateOrganizationResponsibility)}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOrganizationDialog(null)}>Cancelar</Button>
            <Button
              onClick={() => void handleSaveOrganization()}
              disabled={saving === "organization" || !organizationForm.name.trim()}
            >
              {saving === "organization" ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!groupDialog} onOpenChange={(open) => !open && setGroupDialog(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{groupDialog?.mode === "edit" ? "Editar grupo" : "Novo grupo"}</DialogTitle>
            <DialogDescription>
              O grupo fica dentro de uma organização e recebe as unidades vinculadas.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input
                value={groupForm.name}
                onChange={(event) => setGroupForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Ex.: Grupo Elo"
              />
            </div>
            <div className="space-y-2">
              <Label>Organização</Label>
              <Select
                value={groupForm.organizationId || NONE}
                onValueChange={(value) =>
                  setGroupForm((current) => ({
                    ...current,
                    organizationId: value === NONE ? "" : value,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione uma organização" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sem organização</SelectItem>
                  {organizations.map((organization) => (
                    <SelectItem key={organization.id} value={organization.id}>
                      {organization.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {renderResponsibilityFields(groupForm, updateGroupResponsibility)}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setGroupDialog(null)}>Cancelar</Button>
            <Button
              onClick={() => void handleSaveGroup()}
              disabled={saving === "group" || !groupForm.name.trim()}
            >
              {saving === "group" ? "Salvando..." : "Salvar grupo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!unitDialog} onOpenChange={(open) => !open && setUnitDialog(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {unitDialog?.mode === "edit"
                ? "Editar unidade"
                : unitDialog?.mode === "sync"
                  ? "Criar via sincronização"
                  : "Criar unidade manualmente"}
            </DialogTitle>
            <DialogDescription>
              {unitDialog?.mode === "sync"
                ? "Selecione uma unidade operacional existente e revise o nome antes de salvar."
                : "Defina os dados cadastrais, a organização, o grupo e as integrações da unidade."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {unitDialog?.mode === "sync" ? (
              <div className="space-y-2">
                <Label>Origem</Label>
                <Select value={unitForm.kioskId} onValueChange={handleSelectSyncCandidate}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione uma unidade operacional" />
                  </SelectTrigger>
                  <SelectContent>
                    {syncCandidates.length > 0 ? (
                      syncCandidates.map((kiosk) => (
                        <SelectItem key={kiosk.id} value={kiosk.id}>
                          {kiosk.name}
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value="__empty__" disabled>
                        Nenhuma unidade disponível para sincronizar
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  A cópia traz o vínculo da unidade operacional. O nome continua editável antes de salvar.
                </p>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label>Nome da unidade</Label>
              <Input
                value={unitForm.name}
                onChange={(event) => setUnitForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Ex.: Quiosque João Paulo"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>CNPJ</Label>
                <Input
                  value={unitForm.cnpj}
                  onChange={(event) => setUnitForm((current) => ({
                    ...current,
                    cnpj: maskCnpjInput(event.target.value),
                  }))}
                  placeholder="00.000.000/0000-00"
                  inputMode="numeric"
                  aria-invalid={unitCnpjValidation ? !unitCnpjValidation.valid : undefined}
                />
                {unitCnpjValidation && !unitCnpjValidation.valid ? (
                  <p className="text-xs text-destructive">
                    {unitCnpjValidation.clean.length < 14
                      ? "Informe os 14 dígitos do CNPJ."
                      : unitCnpjValidation.message}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label>Tipo de unidade</Label>
                <Input
                  value={unitForm.unitType}
                  onChange={(event) => setUnitForm((current) => ({ ...current, unitType: event.target.value }))}
                  placeholder="Ex.: Quiosque pequeno"
                />
                <p className="text-xs text-muted-foreground">
                  Campo livre; as opções serão configuradas depois.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Endereço</Label>
              <Textarea
                value={unitForm.address}
                onChange={(event) => setUnitForm((current) => ({ ...current, address: event.target.value }))}
                placeholder="Rua, número, complemento, bairro, cidade e UF"
                rows={2}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Organização</Label>
                <Select value={unitForm.organizationId || NONE} onValueChange={handleSelectUnitOrganization}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione uma organização" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Sem organização</SelectItem>
                    {organizations.map((organization) => (
                      <SelectItem key={organization.id} value={organization.id}>
                        {organization.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Grupo</Label>
                <Select value={unitForm.groupId || NONE} onValueChange={handleSelectUnitGroup}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um grupo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Sem grupo</SelectItem>
                    {availableGroupsForUnitForm.map((group) => (
                      <SelectItem key={group.id} value={group.id}>
                        {group.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>ID PDV</Label>
                <Input
                  value={unitForm.pdvFilialId}
                  onChange={(event) => setUnitForm((current) => ({ ...current, pdvFilialId: event.target.value }))}
                  placeholder="Opcional"
                />
              </div>
              <div className="space-y-2">
                <Label>ID Bizneo</Label>
                <Input
                  value={unitForm.bizneoTaxonId}
                  onChange={(event) => setUnitForm((current) => ({ ...current, bizneoTaxonId: event.target.value }))}
                  placeholder="Opcional"
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setUnitDialog(null)}>Cancelar</Button>
            <Button
              onClick={() => void handleSaveUnit()}
              disabled={
                saving === "unit" ||
                !unitForm.name.trim() ||
                (unitCnpjValidation !== null && !unitCnpjValidation.valid) ||
                (unitDialog?.mode === "sync" && !unitForm.kioskId)
              }
            >
              {saving === "unit" ? "Salvando..." : "Salvar unidade"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir cadastro?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.kind === "organization"
                ? "A organização será removida. Grupos e unidades vinculados serão preservados e aparecerão em Sem organização."
                : deleteTarget?.kind === "group"
                  ? "O grupo será removido. As unidades vinculadas serão preservadas e aparecerão em Sem organização."
                  : "A unidade será removida do cadastro administrativo."}
              <br />
              <strong>{deleteTarget?.name}</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving === "delete"}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              disabled={saving === "delete"}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {saving === "delete" ? "Excluindo..." : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
