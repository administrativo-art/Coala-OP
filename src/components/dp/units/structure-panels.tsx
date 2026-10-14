"use client";

import React, { useEffect, useRef, useState } from "react";

import { Field, fieldInputClass } from "@/components/patterns/field";
import { InlineConfirm } from "@/components/patterns/inline-confirm";
import { PanelField, PanelSection, SidePanel } from "@/components/patterns/side-panel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { Textarea } from "@/components/ui/textarea";
import type { DPUnitGroup, DPUnitOrganization, User } from "@/types";
import { ResponsibilityFields, type ResponsibilityDirectory } from "./responsibility-fields";
import {
  NONE,
  describeResponsibility,
  emptyResponsibilityForm,
  patchResponsibility,
  pluralize,
  responsibilityFormFromEntity,
  type GroupForm,
  type MergedOperationalUnit,
  type OrganizationForm,
} from "./units-model";

export type GroupPanelState =
  | { mode: "view"; group: DPUnitGroup }
  | { mode: "edit"; group: DPUnitGroup }
  | { mode: "create"; organizationId?: string };

export type OrganizationPanelState =
  | { mode: "view"; organization: DPUnitOrganization }
  | { mode: "edit"; organization: DPUnitOrganization }
  | { mode: "create" };

function ResponsibilityBlock({ entity, users }: { entity: DPUnitOrganization | DPUnitGroup; users: ReadonlyArray<User> }) {
  const info = describeResponsibility(entity, users);
  if (!info) {
    return <PanelField label="Responsável">Não definido</PanelField>;
  }
  return (
    <PanelField label="Responsável">
      <span className="flex flex-wrap items-center gap-1.5">
        {info.person ? <span>{info.person}</span> : null}
        {info.needsReplacement ? <StatusPill variant="warn">Definir novo responsável</StatusPill> : null}
      </span>
      {info.source ? <span className="mt-0.5 block text-xs font-medium text-ds-ink-muted">{info.source}</span> : null}
    </PanelField>
  );
}

function PanelActions({ children }: { children: React.ReactNode }) {
  return <div className="mt-auto flex flex-col gap-3 border-t border-ds-divider pt-4">{children}</div>;
}

function UnitsList({ units, emptyText }: { units: MergedOperationalUnit[]; emptyText: string }) {
  return (
    <PanelSection title="Unidades" aside={pluralize(units.length, "unidade", "unidades")}>
      {units.length > 0 ? (
        <ul className="m-0 flex max-h-64 list-none flex-col overflow-y-auto rounded-ds-btn border border-ds-divider p-0">
          {units.map((unit, index) => (
            <li key={unit.key} className={index > 0 ? "border-t border-ds-divider px-3 py-2 text-[12.5px] font-semibold" : "px-3 py-2 text-[12.5px] font-semibold"}>
              {unit.name}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12.5px] text-ds-ink-muted">{emptyText}</p>
      )}
    </PanelSection>
  );
}

export function GroupPanel({
  state,
  organizations,
  groups,
  units,
  directory,
  canManage,
  saving,
  onClose,
  onMode,
  onSave,
  onDelete,
}: {
  state: GroupPanelState | null;
  organizations: DPUnitOrganization[];
  groups: DPUnitGroup[];
  /** Unidades do grupo exibido (vazio no modo de criação). */
  units: MergedOperationalUnit[];
  directory: ResponsibilityDirectory;
  canManage: boolean;
  saving: boolean;
  onClose: () => void;
  onMode: (state: GroupPanelState) => void;
  onSave: (form: GroupForm, state: GroupPanelState) => Promise<void>;
  onDelete: (group: DPUnitGroup) => Promise<void>;
}) {
  const [form, setForm] = useState<GroupForm>({ name: "", organizationId: "", suppliedGroupIds: [], ...emptyResponsibilityForm() });
  const [nameError, setNameError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const group = state && state.mode !== "create" ? state.group : null;
  const editing = state?.mode === "edit" || state?.mode === "create";

  useEffect(() => {
    setConfirmingDelete(false);
    setNameError(null);
    if (!state) return;
    if (state.mode === "create") {
      setForm({ name: "", organizationId: state.organizationId ?? "", suppliedGroupIds: [], ...emptyResponsibilityForm() });
    } else {
      setForm({
        name: state.group.name,
        organizationId: state.group.organizationId ?? "",
        suppliedGroupIds: state.group.suppliedGroupIds ?? [],
        ...responsibilityFormFromEntity(state.group),
      });
    }
  }, [state]);

  const organization = group?.organizationId ? organizations.find((item) => item.id === group.organizationId) : undefined;
  const suppliedNames = (group?.suppliedGroupIds ?? [])
    .map((id) => groups.find((item) => item.id === id)?.name)
    .filter(Boolean) as string[];
  const supplyCandidates = groups.filter((item) => item.id !== group?.id);

  async function save() {
    if (!state) return;
    if (!form.name.trim()) {
      setNameError("Informe o nome do grupo.");
      return;
    }
    await onSave(form, state);
  }

  return (
    <SidePanel
      open={!!state}
      onOpenChange={(open) => { if (!open) onClose(); }}
      kicker={state?.mode === "create" ? "Novo grupo" : state?.mode === "edit" ? "Editar grupo" : "Grupo"}
      title={state?.mode === "create" ? (form.name.trim() || "Sem nome") : (group?.name ?? "")}
      subtitle={state ? "O grupo fica dentro de uma organização e recebe as unidades vinculadas." : undefined}
    >
      {state && !editing && group ? (
        <>
          <PanelSection title="Estrutura">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
              <PanelField label="Organização">{organization?.name ?? "Sem organização"}</PanelField>
              <PanelField label="Abastece">{suppliedNames.length > 0 ? suppliedNames.join(", ") : "Nenhum grupo"}</PanelField>
            </div>
          </PanelSection>
          <PanelSection title="Responsabilidade">
            <ResponsibilityBlock entity={group} users={directory.users} />
          </PanelSection>
          <UnitsList units={units} emptyText="Nenhuma unidade neste grupo ainda." />
          {canManage ? (
            <PanelActions>
              {confirmingDelete ? (
                <InlineConfirm
                  message={`Excluir o grupo “${group.name}”? As unidades vinculadas serão preservadas e aparecerão em Sem organização.`}
                  loading={saving}
                  returnFocusRef={deleteTriggerRef}
                  onCancel={() => setConfirmingDelete(false)}
                  onConfirm={() => void onDelete(group)}
                />
              ) : (
                <>
                  <Button type="button" variant="primary-modal" size="md" onClick={() => onMode({ mode: "edit", group })}>Editar grupo</Button>
                  <div>
                    <Button ref={deleteTriggerRef} type="button" variant="danger-link" size="xs" onClick={() => setConfirmingDelete(true)}>Excluir grupo</Button>
                  </div>
                </>
              )}
            </PanelActions>
          ) : null}
        </>
      ) : null}

      {state && editing ? (
        <>
          <Field label="Nome" htmlFor="group-name" error={nameError}>
            <Input
              id="group-name"
              value={form.name}
              onChange={(event) => { setForm((current) => ({ ...current, name: event.target.value })); setNameError(null); }}
              placeholder="Ex.: Grupo Elo"
              aria-invalid={!!nameError}
              className={fieldInputClass}
            />
          </Field>
          <Field label="Organização" htmlFor="group-organization">
            <Select
              value={form.organizationId || NONE}
              onValueChange={(value) => setForm((current) => ({ ...current, organizationId: value === NONE ? "" : value }))}
            >
              <SelectTrigger id="group-organization" className={fieldInputClass}>
                <SelectValue placeholder="Selecione uma organização" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Sem organização</SelectItem>
                {organizations.map((item) => (
                  <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <ResponsibilityFields
            idPrefix="group"
            form={form}
            directory={directory}
            onPatch={(change) => setForm((current) => patchResponsibility(current, change))}
          />
          {supplyCandidates.length > 0 ? (
            <fieldset className="space-y-3 rounded-ds-btn-lg border border-ds-border bg-white p-4" data-testid="group-supplied-groups">
              <legend className="px-1 text-xs font-extrabold uppercase tracking-[0.12em] text-ds-ink-faint">Grupos que este grupo abastece</legend>
              <p className="text-xs text-ds-ink-muted">
                Usado no estoque: o mínimo das unidades de abastecimento deste grupo (como o CD) soma o consumo das unidades
                comerciais dos grupos marcados. Deixe vazio se este grupo não abastece outros.
              </p>
              <div className="space-y-2">
                {supplyCandidates.map((candidate) => (
                  <label key={candidate.id} className="flex items-center gap-2 text-[13px] font-semibold">
                    <Checkbox
                      checked={form.suppliedGroupIds.includes(candidate.id)}
                      aria-label={`Abastece ${candidate.name}`}
                      onCheckedChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          suppliedGroupIds:
                            value === true
                              ? [...current.suppliedGroupIds.filter((id) => id !== candidate.id), candidate.id]
                              : current.suppliedGroupIds.filter((id) => id !== candidate.id),
                        }))
                      }
                    />
                    {candidate.name}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          <PanelActions>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="ds-secondary" size="md" disabled={saving} onClick={() => (group ? onMode({ mode: "view", group }) : onClose())}>
                Cancelar
              </Button>
              <Button type="button" variant="primary-modal" size="md" loading={saving} onClick={() => void save()}>
                {state.mode === "create" ? "Criar grupo" : "Salvar grupo"}
              </Button>
            </div>
          </PanelActions>
        </>
      ) : null}
    </SidePanel>
  );
}

export function OrganizationPanel({
  state,
  groups,
  units,
  directory,
  canManage,
  saving,
  onClose,
  onMode,
  onSave,
  onDelete,
}: {
  state: OrganizationPanelState | null;
  groups: DPUnitGroup[];
  units: MergedOperationalUnit[];
  directory: ResponsibilityDirectory;
  canManage: boolean;
  saving: boolean;
  onClose: () => void;
  onMode: (state: OrganizationPanelState) => void;
  onSave: (form: OrganizationForm, state: OrganizationPanelState) => Promise<void>;
  onDelete: (organization: DPUnitOrganization) => Promise<void>;
}) {
  const [form, setForm] = useState<OrganizationForm>({ name: "", description: "", ...emptyResponsibilityForm() });
  const [nameError, setNameError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const organization = state && state.mode !== "create" ? state.organization : null;
  const editing = state?.mode === "edit" || state?.mode === "create";

  useEffect(() => {
    setConfirmingDelete(false);
    setNameError(null);
    if (!state) return;
    if (state.mode === "create") {
      setForm({ name: "", description: "", ...emptyResponsibilityForm() });
    } else {
      setForm({
        name: state.organization.name,
        description: state.organization.description ?? "",
        ...responsibilityFormFromEntity(state.organization),
      });
    }
  }, [state]);

  async function save() {
    if (!state) return;
    if (!form.name.trim()) {
      setNameError("Informe o nome da organização.");
      return;
    }
    await onSave(form, state);
  }

  return (
    <SidePanel
      open={!!state}
      onOpenChange={(open) => { if (!open) onClose(); }}
      kicker={state?.mode === "create" ? "Nova organização" : state?.mode === "edit" ? "Editar organização" : "Organização"}
      title={state?.mode === "create" ? (form.name.trim() || "Sem nome") : (organization?.name ?? "")}
      subtitle={state ? "Uma organização agrupa os grupos de unidades da operação." : undefined}
    >
      {state && !editing && organization ? (
        <>
          {organization.description ? <p className="text-[13px] leading-5 text-ds-ink-2">{organization.description}</p> : null}
          <PanelSection title="Estrutura">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
              <PanelField label="Grupos">{groups.length}</PanelField>
              <PanelField label="Unidades">{units.length}</PanelField>
            </div>
          </PanelSection>
          <PanelSection title="Responsabilidade">
            <ResponsibilityBlock entity={organization} users={directory.users} />
          </PanelSection>
          <UnitsList units={units} emptyText="Nenhuma unidade nesta organização ainda." />
          {canManage ? (
            <PanelActions>
              {confirmingDelete ? (
                <InlineConfirm
                  message={`Excluir a organização “${organization.name}”? Grupos e unidades vinculados serão preservados e aparecerão em Sem organização.`}
                  loading={saving}
                  returnFocusRef={deleteTriggerRef}
                  onCancel={() => setConfirmingDelete(false)}
                  onConfirm={() => void onDelete(organization)}
                />
              ) : (
                <>
                  <Button type="button" variant="primary-modal" size="md" onClick={() => onMode({ mode: "edit", organization })}>Editar organização</Button>
                  <div>
                    <Button ref={deleteTriggerRef} type="button" variant="danger-link" size="xs" onClick={() => setConfirmingDelete(true)}>Excluir organização</Button>
                  </div>
                </>
              )}
            </PanelActions>
          ) : null}
        </>
      ) : null}

      {state && editing ? (
        <>
          <Field label="Nome" htmlFor="organization-name" error={nameError}>
            <Input
              id="organization-name"
              value={form.name}
              onChange={(event) => { setForm((current) => ({ ...current, name: event.target.value })); setNameError(null); }}
              placeholder="Ex.: Grupo Elo"
              aria-invalid={!!nameError}
              className={fieldInputClass}
            />
          </Field>
          <Field label="Descrição" htmlFor="organization-description" requirement="opcional">
            <Textarea
              id="organization-description"
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="Uso interno para contexto da organização."
              rows={3}
              className={`${fieldInputClass} h-auto py-2.5`}
            />
          </Field>
          <ResponsibilityFields
            idPrefix="organization"
            form={form}
            directory={directory}
            onPatch={(change) => setForm((current) => patchResponsibility(current, change))}
          />
          <PanelActions>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="ds-secondary" size="md" disabled={saving} onClick={() => (organization ? onMode({ mode: "view", organization }) : onClose())}>
                Cancelar
              </Button>
              <Button type="button" variant="primary-modal" size="md" loading={saving} onClick={() => void save()}>
                {state.mode === "create" ? "Criar organização" : "Salvar organização"}
              </Button>
            </div>
          </PanelActions>
        </>
      ) : null}
    </SidePanel>
  );
}
