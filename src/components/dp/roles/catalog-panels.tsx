"use client";

import React from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Field, fieldInputClass } from "@/components/patterns/field";
import { InlineConfirm } from "@/components/patterns/inline-confirm";
import { PanelField, PanelSection, SidePanel } from "@/components/patterns/side-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Profile } from "@/types";
import type { JobDepartment, JobFunction, JobRole } from "@/types";
import {
  NONE,
  departmentSchema,
  functionSchema,
  normalizedSearch,
  roleSchema,
  type DepartmentFormValues,
  type FunctionFormValues,
  type LinkedRolePerson,
  type RoleFormValues,
} from "./roles-model";

/* ───────────────────────── Peças comuns ───────────────────────── */

function SelectField({
  id,
  label,
  value,
  onChange,
  options,
  noneLabel,
  hint,
}: {
  id: string;
  label: string;
  value: string | undefined;
  onChange: (value: string) => void;
  options: Array<{ id: string; name: string }>;
  noneLabel: string;
  hint?: string;
}) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <Select value={value || NONE} onValueChange={(next) => onChange(next === NONE ? "" : next)}>
        <SelectTrigger id={id} className={fieldInputClass}>
          <SelectValue placeholder={noneLabel} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{noneLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function SwitchRow({ id, label, description, checked, onChange }: { id: string; label: string; description?: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-ds-btn-lg border border-ds-border bg-white px-4 py-3">
      <div className="min-w-0">
        <label htmlFor={id} className="text-[13px] font-bold">{label}</label>
        {description ? <p className="mt-0.5 text-xs text-ds-ink-muted">{description}</p> : null}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function ErrorNote({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="rounded-ds-btn border border-ds-confirm-border bg-ds-confirm-bg px-3.5 py-3 text-[12.5px] font-semibold text-ds-confirm-ink">{message}</p>
  ) : null;
}

function FormFooter({ submitting, creating, noun, onCancel }: { submitting: boolean; creating: boolean; noun: string; onCancel: () => void }) {
  return (
    <div className="mt-auto grid grid-cols-2 gap-2 border-t border-ds-divider pt-4">
      <Button type="button" variant="ds-secondary" size="md" disabled={submitting} onClick={onCancel}>Cancelar</Button>
      <Button type="submit" variant="primary-modal" size="md" loading={submitting}>{creating ? `Criar ${noun}` : `Salvar ${noun}`}</Button>
    </div>
  );
}

function ActivePill({ active }: { active: boolean }) {
  return <StatusPill variant={active ? "ok" : "neutral"}>{active ? "Ativo" : "Inativo"}</StatusPill>;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

/* ───────────────────────── Departamento ───────────────────────── */

export type DepartmentPanelState =
  | { mode: "view"; item: JobDepartment }
  | { mode: "edit"; item: JobDepartment }
  | { mode: "create"; parentId?: string | null };

export function DepartmentPanel({
  state,
  departments,
  canManage,
  onClose,
  onMode,
  onSubmit,
}: {
  state: DepartmentPanelState | null;
  departments: JobDepartment[];
  canManage: boolean;
  onClose: () => void;
  onMode: (state: DepartmentPanelState) => void;
  onSubmit: (values: DepartmentFormValues, current: JobDepartment | null) => Promise<void>;
}) {
  const form = useForm<DepartmentFormValues>({ resolver: zodResolver(departmentSchema), defaultValues: { name: "", parentId: "", description: "", isActive: true } });
  const { register, control, handleSubmit, reset, formState: { errors, isSubmitting } } = form;
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const item = state && state.mode !== "create" ? state.item : null;
  const editing = state?.mode === "edit" || state?.mode === "create";

  React.useEffect(() => {
    setSaveError(null);
    if (!state || state.mode === "view") return;
    reset({
      name: state.mode === "edit" ? state.item.name : "",
      parentId: state.mode === "edit" ? state.item.parentId ?? "" : state.parentId ?? "",
      description: state.mode === "edit" ? state.item.description ?? "" : "",
      isActive: state.mode === "edit" ? state.item.isActive ?? true : true,
    });
  }, [state, reset]);

  const parentName = item?.parentId ? departments.find((entry) => entry.id === item.parentId)?.name : undefined;

  return (
    <SidePanel
      open={!!state}
      onOpenChange={(open) => { if (!open) onClose(); }}
      kicker={state?.mode === "create" ? "Novo departamento" : state?.mode === "edit" ? "Editar departamento" : "Departamento"}
      title={state?.mode === "create" ? "Sem nome" : item?.name ?? ""}
      subtitle="Níveis livres para organizar áreas, subáreas e times."
    >
      {state && !editing && item ? (
        <>
          <PanelSection title="Dados">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
              <PanelField label="Situação"><ActivePill active={item.isActive !== false} /></PanelField>
              <PanelField label="Departamento pai">{parentName ?? "Raiz"}</PanelField>
            </div>
            <PanelField label="Descrição">{item.description || "Sem descrição."}</PanelField>
          </PanelSection>
          {canManage ? (
            <div className="mt-auto grid grid-cols-2 gap-2 border-t border-ds-divider pt-4">
              <Button type="button" variant="primary-modal" size="md" onClick={() => onMode({ mode: "edit", item })}>Editar departamento</Button>
              <Button type="button" variant="ds-secondary" size="md" onClick={() => onMode({ mode: "create", parentId: item.id })}>Adicionar subdepartamento</Button>
            </div>
          ) : null}
        </>
      ) : null}

      {state && editing ? (
        <form
          noValidate
          className="flex flex-1 flex-col gap-5"
          onSubmit={handleSubmit(async (values) => {
            setSaveError(null);
            try {
              await onSubmit(values, item);
              onClose();
            } catch (error) {
              setSaveError(errorMessage(error, "Não foi possível salvar o departamento."));
            }
          })}
        >
          <Field label="Nome" htmlFor="dept-name" error={errors.name?.message}>
            <Input id="dept-name" placeholder="Ex.: Operacional" aria-invalid={!!errors.name} className={fieldInputClass} {...register("name")} />
          </Field>
          <Controller control={control} name="parentId" render={({ field }) => (
            <SelectField id="dept-parent" label="Departamento pai" value={field.value} onChange={field.onChange} noneLabel="Sem pai" options={departments.filter((entry) => entry.id !== item?.id)} />
          )} />
          <Field label="Descrição" htmlFor="dept-description" requirement="opcional">
            <Textarea id="dept-description" rows={3} placeholder="Descrição interna." className={cn(fieldInputClass, "h-auto py-2.5")} {...register("description")} />
          </Field>
          <Controller control={control} name="isActive" render={({ field }) => (
            <SwitchRow id="dept-active" label="Departamento ativo" checked={field.value} onChange={field.onChange} />
          )} />
          <ErrorNote message={saveError} />
          <FormFooter submitting={isSubmitting} creating={state.mode === "create"} noun="departamento" onCancel={() => (item ? onMode({ mode: "view", item }) : onClose())} />
        </form>
      ) : null}
    </SidePanel>
  );
}

/* ───────────────────────── Colaboradores vinculados ───────────────────────── */

function LinkedPeople({ role, people, onBack }: { role: JobRole; people: LinkedRolePerson[]; onBack: () => void }) {
  const [search, setSearch] = React.useState("");
  const [functionFilter, setFunctionFilter] = React.useState("__all__");
  const [unitFilter, setUnitFilter] = React.useState("__all__");

  React.useEffect(() => {
    setSearch("");
    setFunctionFilter("__all__");
    setUnitFilter("__all__");
  }, [role.id]);

  const functionOptions = React.useMemo(() => {
    const options = new Map<string, { id: string; name: string; hierarchyRank: number }>();
    people.flatMap((person) => person.functions).forEach((entry) => {
      const current = options.get(entry.id);
      if (!current || entry.hierarchyRank < current.hierarchyRank) options.set(entry.id, entry);
    });
    return Array.from(options.values()).sort((left, right) => left.hierarchyRank - right.hierarchyRank || left.name.localeCompare(right.name, "pt-BR"));
  }, [people]);
  const ordinalById = React.useMemo(() => new Map(functionOptions.map((entry, index) => [entry.id, index + 1])), [functionOptions]);
  const unitOptions = React.useMemo(
    () => Array.from(new Set(people.flatMap((person) => person.unitNames))).sort((left, right) => left.localeCompare(right, "pt-BR")),
    [people]
  );
  const filtered = React.useMemo(() => {
    const query = normalizedSearch(search);
    return people.filter((person) =>
      (!query || normalizedSearch(person.name).includes(query))
      && (functionFilter === "__all__" || person.functions.some((entry) => entry.id === functionFilter))
      && (unitFilter === "__all__" || person.unitNames.includes(unitFilter))
    );
  }, [functionFilter, people, search, unitFilter]);

  return (
    <>
      <Button type="button" variant="ds-link" size="xs" className="self-start px-0" onClick={onBack}>← Voltar ao cargo</Button>
      <PanelSection title="Colaboradores vinculados" aside={`${filtered.length} de ${people.length} ativos`}>
        <Field label="Buscar" htmlFor="linked-search">
          <Input id="linked-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome" className={fieldInputClass} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Função" htmlFor="linked-function">
            <Select value={functionFilter} onValueChange={setFunctionFilter}>
              <SelectTrigger id="linked-function" className={fieldInputClass}><SelectValue placeholder="Todas as funções" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todas as funções</SelectItem>
                {functionOptions.map((entry, index) => <SelectItem key={entry.id} value={entry.id}>{index + 1}ª · {entry.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Unidade" htmlFor="linked-unit">
            <Select value={unitFilter} onValueChange={setUnitFilter}>
              <SelectTrigger id="linked-unit" className={fieldInputClass}><SelectValue placeholder="Todas as unidades" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todas as unidades</SelectItem>
                {unitOptions.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </div>
        {filtered.length > 0 ? (
          <ul className="m-0 flex max-h-[46vh] list-none flex-col overflow-y-auto rounded-ds-btn border border-ds-divider p-0">
            {filtered.map((person, index) => (
              <li key={person.id} className={cn("space-y-1 px-3.5 py-3", index > 0 && "border-t border-ds-divider")}>
                <p className="text-[13px] font-bold">{person.name}</p>
                <div className="flex flex-wrap gap-1.5">
                  {person.functions.length > 0
                    ? person.functions.map((entry) => <StatusPill key={entry.id} variant="neutral">{ordinalById.get(entry.id)}ª · {entry.name}</StatusPill>)
                    : <span className="text-xs text-ds-ink-muted">Sem função vinculada</span>}
                </div>
                <p className="text-xs text-ds-ink-muted">{person.unitNames.length > 0 ? person.unitNames.join(", ") : "Sem unidade vinculada"}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-ds-btn-lg border border-dashed border-ds-border-input px-4 py-8 text-center text-[13px] text-ds-ink-muted">
            {people.length > 0 ? "Nenhum colaborador encontrado com esses filtros." : "Nenhum colaborador ativo vinculado."}
          </p>
        )}
      </PanelSection>
    </>
  );
}

/* ───────────────────────── Cargo ───────────────────────── */

export type RolePanelState =
  | { mode: "view"; item: JobRole }
  | { mode: "edit"; item: JobRole }
  | { mode: "people"; item: JobRole }
  | { mode: "create"; parentId?: string | null };

export function RolePanel({
  state,
  roles,
  departments,
  profiles,
  departmentNameById,
  profileNameById,
  summary,
  people,
  canManage,
  syncing,
  onClose,
  onMode,
  onSubmit,
  onSyncProfile,
}: {
  state: RolePanelState | null;
  roles: JobRole[];
  departments: JobDepartment[];
  profiles: Profile[];
  departmentNameById: Map<string, string>;
  profileNameById: Map<string, string>;
  summary: { assigned: number; mismatched: number };
  people: LinkedRolePerson[];
  canManage: boolean;
  syncing: boolean;
  onClose: () => void;
  onMode: (state: RolePanelState) => void;
  onSubmit: (values: RoleFormValues, current: JobRole | null) => Promise<void>;
  onSyncProfile: (role: JobRole) => Promise<void>;
}) {
  const form = useForm<RoleFormValues>({
    resolver: zodResolver(roleSchema),
    defaultValues: { name: "", cbo: "", departmentId: "", parentId: "", reportsTo: "", defaultProfileId: "", loginRestricted: false, isActive: true, description: "" },
  });
  const { register, control, handleSubmit, reset, formState: { errors, isSubmitting } } = form;
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [confirmingSync, setConfirmingSync] = React.useState(false);
  const syncTriggerRef = React.useRef<HTMLButtonElement>(null);
  const item = state && state.mode !== "create" ? state.item : null;
  const editing = state?.mode === "edit" || state?.mode === "create";

  React.useEffect(() => {
    setSaveError(null);
    setConfirmingSync(false);
    if (!state || state.mode === "view" || state.mode === "people") return;
    const current = state.mode === "edit" ? state.item : null;
    const parentId = current?.parentId ?? current?.reportsTo ?? (state.mode === "create" ? state.parentId : null) ?? "";
    reset({
      name: current?.name ?? "",
      cbo: current?.cbo ?? "",
      departmentId: current?.departmentId ?? "",
      parentId,
      reportsTo: parentId,
      defaultProfileId: current?.defaultProfileId ?? "",
      loginRestricted: current?.loginRestricted ?? false,
      isActive: current?.isActive ?? true,
      description: current?.description ?? "",
    });
  }, [state, reset]);

  const canSync = canManage && !!item?.defaultProfileId && summary.mismatched > 0;

  return (
    <SidePanel
      open={!!state}
      onOpenChange={(open) => { if (!open) onClose(); }}
      kicker={state?.mode === "create" ? "Novo cargo" : state?.mode === "edit" ? "Editar cargo" : "Cargo"}
      title={state?.mode === "create" ? "Sem nome" : item?.name ?? ""}
      subtitle="Organiza a hierarquia do RH e pode apontar para um perfil padrão, sem substituir as permissões atuais."
    >
      {state?.mode === "view" && item ? (
        <>
          <PanelSection title="Dados">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
              <PanelField label="Situação"><ActivePill active={item.isActive} /></PanelField>
              <PanelField label="CBO">{item.cbo ? <span className="font-ds-mono">{item.cbo}</span> : "Não informado"}</PanelField>
              <PanelField label="Departamento">{item.departmentId ? departmentNameById.get(item.departmentId) ?? item.departmentName ?? "Departamento removido" : "Sem departamento"}</PanelField>
              <PanelField label="Cargo pai">{(item.parentId ?? item.reportsTo) ? roles.find((entry) => entry.id === (item.parentId ?? item.reportsTo))?.name ?? "Cargo removido" : "Raiz"}</PanelField>
              <PanelField label="Perfil padrão">{item.defaultProfileId ? profileNameById.get(item.defaultProfileId) ?? item.defaultProfileId : "Sem perfil padrão"}</PanelField>
              <PanelField label="Login por escala">{item.loginRestricted ? "Restrito por escala" : "Sem restrição"}</PanelField>
            </div>
            <PanelField label="Descrição">{item.description || "Sem descrição."}</PanelField>
          </PanelSection>
          <PanelSection title="Colaboradores" aside={`${summary.assigned} ativos`}>
            <p className="text-[13px] text-ds-ink-2">
              {summary.mismatched > 0 && item.defaultProfileId
                ? `${summary.mismatched} com perfil diferente do padrão do cargo.`
                : "Todos com o perfil esperado pelo cargo."}
            </p>
            <Button type="button" variant="ds-secondary" size="xs" onClick={() => onMode({ mode: "people", item })}>Ver colaboradores vinculados</Button>
          </PanelSection>
          {confirmingSync ? (
            <InlineConfirm
              message={`Aplicar o perfil “${profileNameById.get(item.defaultProfileId ?? "") ?? item.defaultProfileId}” a ${summary.mismatched} colaborador(es) do cargo ${item.name}? Os demais permanecem como estão.`}
              confirmLabel="Aplicar perfil"
              loadingLabel="Aplicando…"
              loading={syncing}
              returnFocusRef={syncTriggerRef}
              onCancel={() => setConfirmingSync(false)}
              onConfirm={() => void onSyncProfile(item).then(() => setConfirmingSync(false))}
            />
          ) : null}
          {canManage && !confirmingSync ? (
            <div className="mt-auto flex flex-col gap-2 border-t border-ds-divider pt-4">
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="primary-modal" size="md" onClick={() => onMode({ mode: "edit", item })}>Editar cargo</Button>
                <Button type="button" variant="ds-secondary" size="md" onClick={() => onMode({ mode: "create", parentId: item.id })}>Adicionar subcargo</Button>
              </div>
              {canSync ? (
                <Button ref={syncTriggerRef} type="button" variant="ds-secondary" size="md" onClick={() => setConfirmingSync(true)}>Aplicar perfil padrão aos colaboradores</Button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      {state?.mode === "people" && item ? <LinkedPeople role={item} people={people} onBack={() => onMode({ mode: "view", item })} /> : null}

      {state && editing ? (
        <form
          noValidate
          className="flex flex-1 flex-col gap-5"
          onSubmit={handleSubmit(async (values) => {
            setSaveError(null);
            try {
              await onSubmit(values, item);
              onClose();
            } catch (error) {
              setSaveError(errorMessage(error, "Não foi possível salvar o cargo."));
            }
          })}
        >
          <Field label="Nome interno" htmlFor="role-name" error={errors.name?.message}>
            <Input id="role-name" placeholder="Ex.: Líder de unidade" aria-invalid={!!errors.name} className={fieldInputClass} {...register("name")} />
          </Field>
          <Controller control={control} name="cbo" render={({ field }) => (
            <Field label="CBO do cargo" htmlFor="role-cbo" requirement="opcional" error={errors.cbo?.message} hint="Usado automaticamente em contratos e integrações trabalhistas.">
              <Input
                id="role-cbo"
                inputMode="numeric"
                placeholder="Ex.: 5134-15"
                maxLength={7}
                aria-invalid={!!errors.cbo}
                className={cn(fieldInputClass, "font-ds-mono")}
                value={field.value ?? ""}
                onBlur={field.onBlur}
                onChange={(event) => {
                  const digits = event.target.value.replace(/\D/g, "").slice(0, 6);
                  field.onChange(digits.length > 4 ? `${digits.slice(0, 4)}-${digits.slice(4)}` : digits);
                }}
              />
            </Field>
          )} />
          <Controller control={control} name="departmentId" render={({ field }) => (
            <SelectField id="role-department" label="Departamento" value={field.value} onChange={field.onChange} noneLabel="Sem departamento" options={departments.filter((entry) => entry.isActive !== false)} />
          )} />
          <Controller control={control} name="parentId" render={({ field }) => (
            <SelectField id="role-parent" label="Cargo pai" value={field.value} onChange={field.onChange} noneLabel="Sem cargo pai" options={roles.filter((entry) => entry.id !== item?.id)} />
          )} />
          <Controller control={control} name="defaultProfileId" render={({ field }) => (
            <SelectField id="role-profile" label="Perfil padrão" value={field.value} onChange={field.onChange} noneLabel="Sem perfil padrão" options={profiles} />
          )} />
          <Field label="Descrição interna" htmlFor="role-description" requirement="opcional">
            <Textarea id="role-description" rows={4} placeholder="Escopo e responsabilidades internas do cargo." className={cn(fieldInputClass, "h-auto py-2.5")} {...register("description")} />
          </Field>
          <Controller control={control} name="loginRestricted" render={({ field }) => (
            <SwitchRow id="role-login" label="Login restrito por escala" description="Marca o cargo para futura validação de acesso por horário." checked={field.value} onChange={field.onChange} />
          )} />
          <Controller control={control} name="isActive" render={({ field }) => (
            <SwitchRow id="role-active" label="Cargo ativo" description="Cargos inativos ficam preservados para histórico." checked={field.value} onChange={field.onChange} />
          )} />
          <ErrorNote message={saveError} />
          <FormFooter submitting={isSubmitting} creating={state.mode === "create"} noun="cargo" onCancel={() => (item ? onMode({ mode: "view", item }) : onClose())} />
        </form>
      ) : null}
    </SidePanel>
  );
}

/* ───────────────────────── Função ───────────────────────── */

export type FunctionPanelState =
  | { mode: "view"; item: JobFunction }
  | { mode: "edit"; item: JobFunction }
  | { mode: "create"; parentId?: string | null };

export function FunctionPanel({
  state,
  functions,
  roles,
  departments,
  profiles,
  departmentNameById,
  roleNameById,
  profileNameById,
  canManage,
  onClose,
  onMode,
  onSubmit,
}: {
  state: FunctionPanelState | null;
  functions: JobFunction[];
  roles: JobRole[];
  departments: JobDepartment[];
  profiles: Profile[];
  departmentNameById: Map<string, string>;
  roleNameById: Map<string, string>;
  profileNameById: Map<string, string>;
  canManage: boolean;
  onClose: () => void;
  onMode: (state: FunctionPanelState) => void;
  onSubmit: (values: FunctionFormValues, current: JobFunction | null) => Promise<void>;
}) {
  const form = useForm<FunctionFormValues>({
    resolver: zodResolver(functionSchema),
    defaultValues: { name: "", departmentId: "", parentId: "", compatibleRoleIds: [], defaultProfileId: "", monthlySalary: undefined, isActive: true, description: "" },
  });
  const { register, control, handleSubmit, reset, formState: { errors, isSubmitting } } = form;
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const item = state && state.mode !== "create" ? state.item : null;
  const editing = state?.mode === "edit" || state?.mode === "create";

  React.useEffect(() => {
    setSaveError(null);
    if (!state || state.mode === "view") return;
    const current = state.mode === "edit" ? state.item : null;
    reset({
      name: current?.name ?? "",
      departmentId: current?.departmentId ?? "",
      parentId: current?.parentId ?? (state.mode === "create" ? state.parentId : null) ?? "",
      compatibleRoleIds: current?.compatibleRoleIds ?? [],
      defaultProfileId: current?.defaultProfileId ?? "",
      monthlySalary: current?.salaryRange?.min ?? undefined,
      isActive: current?.isActive ?? true,
      description: current?.description ?? "",
    });
  }, [state, reset]);

  return (
    <SidePanel
      open={!!state}
      onOpenChange={(open) => { if (!open) onClose(); }}
      kicker={state?.mode === "create" ? "Nova função" : state?.mode === "edit" ? "Editar função" : "Função"}
      title={state?.mode === "create" ? "Sem nome" : item?.name ?? ""}
      subtitle="Refina a atuação do colaborador sem trocar a estrutura atual de acesso."
    >
      {state?.mode === "view" && item ? (
        <>
          <PanelSection title="Dados">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
              <PanelField label="Situação"><ActivePill active={item.isActive} /></PanelField>
              <PanelField label="Departamento">{item.departmentId ? departmentNameById.get(item.departmentId) ?? item.departmentName ?? "Departamento removido" : "Sem departamento"}</PanelField>
              <PanelField label="Função pai">{item.parentId ? functions.find((entry) => entry.id === item.parentId)?.name ?? "Função removida" : "Raiz"}</PanelField>
              <PanelField label="Perfil padrão">{item.defaultProfileId ? profileNameById.get(item.defaultProfileId) ?? item.defaultProfileId : "Sem perfil padrão"}</PanelField>
              <PanelField label="Salário mensal">{item.salaryRange?.min != null ? item.salaryRange.min.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "Não informado"}</PanelField>
            </div>
            <PanelField label="Cargos compatíveis">
              {(item.compatibleRoleIds ?? []).length > 0
                ? <span className="mt-1 flex flex-wrap gap-1.5">{item.compatibleRoleIds?.map((roleId) => <StatusPill key={roleId} variant="neutral">{roleNameById.get(roleId) ?? roleId}</StatusPill>)}</span>
                : "Sem restrição de cargo"}
            </PanelField>
            <PanelField label="Descrição">{item.description || "Sem descrição."}</PanelField>
          </PanelSection>
          {canManage ? (
            <div className="mt-auto grid grid-cols-2 gap-2 border-t border-ds-divider pt-4">
              <Button type="button" variant="primary-modal" size="md" onClick={() => onMode({ mode: "edit", item })}>Editar função</Button>
              <Button type="button" variant="ds-secondary" size="md" onClick={() => onMode({ mode: "create", parentId: item.id })}>Adicionar subfunção</Button>
            </div>
          ) : null}
        </>
      ) : null}

      {state && editing ? (
        <form
          noValidate
          className="flex flex-1 flex-col gap-5"
          onSubmit={handleSubmit(async (values) => {
            setSaveError(null);
            try {
              await onSubmit(values, item);
              onClose();
            } catch (error) {
              setSaveError(errorMessage(error, "Não foi possível salvar a função."));
            }
          })}
        >
          <Field label="Nome interno" htmlFor="fn-name" error={errors.name?.message}>
            <Input id="fn-name" placeholder="Ex.: Caixa" aria-invalid={!!errors.name} className={fieldInputClass} {...register("name")} />
          </Field>
          <Controller control={control} name="departmentId" render={({ field }) => (
            <SelectField id="fn-department" label="Departamento" value={field.value} onChange={field.onChange} noneLabel="Sem departamento" options={departments.filter((entry) => entry.isActive !== false)} />
          )} />
          <Controller control={control} name="parentId" render={({ field }) => (
            <SelectField id="fn-parent" label="Função pai" value={field.value} onChange={field.onChange} noneLabel="Sem função pai" options={functions.filter((entry) => entry.id !== item?.id)} />
          )} />
          <Field label="Cargos compatíveis" requirement="opcional">
            <Controller control={control} name="compatibleRoleIds" render={({ field }) => (
              <MultiSelect options={roles.map((role) => ({ value: role.id, label: role.name }))} selected={field.value ?? []} onChange={field.onChange} placeholder="Selecione os cargos que podem usar essa função" />
            )} />
          </Field>
          <Controller control={control} name="defaultProfileId" render={({ field }) => (
            <SelectField id="fn-profile" label="Perfil padrão da função" value={field.value} onChange={field.onChange} noneLabel="Sem perfil padrão" options={profiles} />
          )} />
          <Field
            label="Salário mensal (R$)"
            htmlFor="fn-salary"
            requirement="opcional"
            error={errors.monthlySalary?.message}
            hint="Base salarial da função, usada para preencher a integração do colaborador ao contratar. Gratificações ou adicionais são tratados à parte."
          >
            <Input id="fn-salary" type="number" min={0} step="0.01" placeholder="Ex.: 1800" aria-invalid={!!errors.monthlySalary} className={cn(fieldInputClass, "font-ds-mono")} {...register("monthlySalary")} />
          </Field>
          <Field label="Descrição interna" htmlFor="fn-description" requirement="opcional">
            <Textarea id="fn-description" rows={4} placeholder="Escopo interno da função." className={cn(fieldInputClass, "h-auto py-2.5")} {...register("description")} />
          </Field>
          <Controller control={control} name="isActive" render={({ field }) => (
            <SwitchRow id="fn-active" label="Função ativa" description="Funções inativas saem da operação mas permanecem no histórico." checked={field.value} onChange={field.onChange} />
          )} />
          <ErrorNote message={saveError} />
          <FormFooter submitting={isSubmitting} creating={state.mode === "create"} noun="função" onCancel={() => (item ? onMode({ mode: "view", item }) : onClose())} />
        </form>
      ) : null}
    </SidePanel>
  );
}
