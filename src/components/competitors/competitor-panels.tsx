"use client";

import React from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { Field, fieldInputClass } from "@/components/patterns/field";
import { InlineConfirm } from "@/components/patterns/inline-confirm";
import { PanelField, PanelSection, SidePanel } from "@/components/patterns/side-panel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Competitor, CompetitorGroup, CompetitorProduct } from "@/types";
import { competitorAddress } from "./competitors-model";

function ErrorNote({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="rounded-ds-btn border border-ds-confirm-border bg-ds-confirm-bg px-3.5 py-3 text-[12.5px] font-semibold text-ds-confirm-ink">{message}</p>
  ) : null;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

/* ───────────────────────── Unidade concorrente ───────────────────────── */

const competitorSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome da unidade."),
  competitorGroupId: z.string().min(1, "Selecione o grupo."),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
});
type CompetitorFormValues = z.infer<typeof competitorSchema>;

export type CompetitorPanelState =
  | { mode: "view"; item: Competitor }
  | { mode: "edit"; item: Competitor }
  | { mode: "create"; groupId?: string };

export function CompetitorUnitPanel({
  state,
  groups,
  products,
  onClose,
  onMode,
  onSave,
  onDelete,
}: {
  state: CompetitorPanelState | null;
  groups: CompetitorGroup[];
  products: CompetitorProduct[];
  onClose: () => void;
  onMode: (state: CompetitorPanelState) => void;
  onSave: (values: CompetitorFormValues, current: Competitor | null) => Promise<void>;
  onDelete: (item: Competitor) => Promise<void>;
}) {
  const form = useForm<CompetitorFormValues>({ resolver: zodResolver(competitorSchema), defaultValues: { name: "", competitorGroupId: "", address: "", city: "", state: "" } });
  const { register, control, handleSubmit, reset, formState: { errors, isSubmitting } } = form;
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const deleteTriggerRef = React.useRef<HTMLButtonElement>(null);
  const item = state && state.mode !== "create" ? state.item : null;
  const editing = state?.mode === "edit" || state?.mode === "create";

  React.useEffect(() => {
    setSaveError(null);
    setConfirmingDelete(false);
    if (!state || state.mode === "view") return;
    reset(
      state.mode === "edit"
        ? { name: state.item.name, competitorGroupId: state.item.competitorGroupId, address: state.item.address ?? "", city: state.item.city ?? "", state: state.item.state ?? "" }
        : { name: "", competitorGroupId: state.groupId ?? "", address: "", city: "", state: "" }
    );
  }, [state, reset]);

  const groupName = item ? groups.find((group) => group.id === item.competitorGroupId)?.name ?? "Sem grupo" : "";
  const productCount = item ? products.filter((product) => product.competitorId === item.id).length : 0;

  async function confirmDelete() {
    if (!item) return;
    setDeleting(true);
    setSaveError(null);
    try {
      await onDelete(item);
      onClose();
    } catch (error) {
      setConfirmingDelete(false);
      setSaveError(errorMessage(error, "Não foi possível excluir o concorrente."));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <SidePanel
      open={!!state}
      onOpenChange={(open) => { if (!open) onClose(); }}
      kicker={state?.mode === "create" ? "Nova unidade concorrente" : state?.mode === "edit" ? "Editar unidade concorrente" : "Unidade concorrente"}
      title={state?.mode === "create" ? "Sem nome" : item?.name ?? ""}
      subtitle="Unidade específica de um grupo de concorrentes."
    >
      {state?.mode === "view" && item ? (
        <>
          <PanelSection title="Dados">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
              <PanelField label="Grupo">{groupName}</PanelField>
              <PanelField label="Mercadorias monitoradas">{productCount}</PanelField>
            </div>
            <PanelField label="Endereço">{competitorAddress(item) || "Endereço não informado"}</PanelField>
          </PanelSection>
          <ErrorNote message={saveError} />
          <div className="mt-auto flex flex-col gap-3 border-t border-ds-divider pt-4">
            {confirmingDelete ? (
              <InlineConfirm
                message={`Excluir o concorrente “${item.name}”? Todos os produtos e preços associados também serão excluídos.`}
                loading={deleting}
                returnFocusRef={deleteTriggerRef}
                onCancel={() => setConfirmingDelete(false)}
                onConfirm={() => void confirmDelete()}
              />
            ) : (
              <>
                <Button type="button" variant="primary-modal" size="md" onClick={() => onMode({ mode: "edit", item })}>Editar unidade</Button>
                <div>
                  <Button ref={deleteTriggerRef} type="button" variant="danger-link" size="xs" onClick={() => setConfirmingDelete(true)}>Excluir unidade</Button>
                </div>
              </>
            )}
          </div>
        </>
      ) : null}

      {state && editing ? (
        <form
          noValidate
          className="flex flex-1 flex-col gap-5"
          onSubmit={handleSubmit(async (values) => {
            setSaveError(null);
            try {
              await onSave(values, item);
              onClose();
            } catch (error) {
              setSaveError(errorMessage(error, "Não foi possível salvar a unidade."));
            }
          })}
        >
          <Field label="Grupo de concorrentes" htmlFor="comp-group" error={errors.competitorGroupId?.message}>
            <Controller control={control} name="competitorGroupId" render={({ field }) => (
              <Select value={field.value || undefined} onValueChange={field.onChange}>
                <SelectTrigger id="comp-group" aria-invalid={!!errors.competitorGroupId} className={fieldInputClass}>
                  <SelectValue placeholder="Selecione um grupo" />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((group) => <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )} />
          </Field>
          <Field label="Nome da unidade" htmlFor="comp-name" error={errors.name?.message}>
            <Input id="comp-name" placeholder="Ex.: Shopping São Luís" aria-invalid={!!errors.name} className={fieldInputClass} {...register("name")} />
          </Field>
          <Field label="Endereço" htmlFor="comp-address" requirement="opcional">
            <Input id="comp-address" placeholder="Rua, número, bairro" className={fieldInputClass} {...register("address")} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Cidade" htmlFor="comp-city" requirement="opcional" className="col-span-2">
              <Input id="comp-city" placeholder="São Luís" className={fieldInputClass} {...register("city")} />
            </Field>
            <Field label="UF" htmlFor="comp-state" requirement="opcional">
              <Input id="comp-state" placeholder="MA" maxLength={2} className={fieldInputClass} {...register("state")} />
            </Field>
          </div>
          <ErrorNote message={saveError} />
          <div className="mt-auto grid grid-cols-2 gap-2 border-t border-ds-divider pt-4">
            <Button type="button" variant="ds-secondary" size="md" disabled={isSubmitting} onClick={() => (item ? onMode({ mode: "view", item }) : onClose())}>Cancelar</Button>
            <Button type="submit" variant="primary-modal" size="md" loading={isSubmitting}>{state.mode === "create" ? "Criar unidade" : "Salvar unidade"}</Button>
          </div>
        </form>
      ) : null}
    </SidePanel>
  );
}

/* ───────────────────────── Grupo de concorrentes ───────────────────────── */

const groupSchema = z.object({ name: z.string().trim().min(1, "Informe o nome do grupo.") });
type GroupFormValues = z.infer<typeof groupSchema>;

export type CompetitorGroupPanelState =
  | { mode: "view"; item: CompetitorGroup }
  | { mode: "edit"; item: CompetitorGroup }
  | { mode: "create" };

export function CompetitorGroupPanel({
  state,
  competitors,
  onClose,
  onMode,
  onSave,
  onDelete,
}: {
  state: CompetitorGroupPanelState | null;
  competitors: Competitor[];
  onClose: () => void;
  onMode: (state: CompetitorGroupPanelState) => void;
  onSave: (values: GroupFormValues, current: CompetitorGroup | null) => Promise<void>;
  onDelete: (item: CompetitorGroup) => Promise<void>;
}) {
  const form = useForm<GroupFormValues>({ resolver: zodResolver(groupSchema), defaultValues: { name: "" } });
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = form;
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const deleteTriggerRef = React.useRef<HTMLButtonElement>(null);
  const item = state && state.mode !== "create" ? state.item : null;
  const editing = state?.mode === "edit" || state?.mode === "create";
  const units = item ? competitors.filter((competitor) => competitor.competitorGroupId === item.id) : [];

  React.useEffect(() => {
    setSaveError(null);
    setConfirmingDelete(false);
    if (!state || state.mode === "view") return;
    reset({ name: state.mode === "edit" ? state.item.name : "" });
  }, [state, reset]);

  async function confirmDelete() {
    if (!item) return;
    setDeleting(true);
    setSaveError(null);
    try {
      await onDelete(item);
      onClose();
    } catch (error) {
      setConfirmingDelete(false);
      setSaveError(errorMessage(error, "Não foi possível excluir o grupo."));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <SidePanel
      open={!!state}
      onOpenChange={(open) => { if (!open) onClose(); }}
      kicker={state?.mode === "create" ? "Novo grupo de concorrentes" : state?.mode === "edit" ? "Renomear grupo" : "Grupo de concorrentes"}
      title={state?.mode === "create" ? "Sem nome" : item?.name ?? ""}
      subtitle="Marca ou rede que reúne várias unidades concorrentes."
    >
      {state?.mode === "view" && item ? (
        <>
          <PanelSection title="Unidades" aside={`${units.length} ${units.length === 1 ? "unidade" : "unidades"}`}>
            {units.length > 0 ? (
              <ul className="m-0 flex list-none flex-col rounded-ds-btn border border-ds-divider p-0">
                {units.map((unit, index) => (
                  <li key={unit.id} className={index > 0 ? "border-t border-ds-divider px-3 py-2 text-[12.5px] font-semibold" : "px-3 py-2 text-[12.5px] font-semibold"}>{unit.name}</li>
                ))}
              </ul>
            ) : (
              <p className="text-[12.5px] text-ds-ink-muted">Nenhuma unidade neste grupo ainda.</p>
            )}
          </PanelSection>
          <ErrorNote message={saveError} />
          <div className="mt-auto flex flex-col gap-3 border-t border-ds-divider pt-4">
            {confirmingDelete ? (
              <InlineConfirm
                message={`Excluir o grupo “${item.name}”? Isso também exclui permanentemente as ${units.length} unidade(s) de concorrentes, seus produtos e preços. Não pode ser desfeito.`}
                loading={deleting}
                returnFocusRef={deleteTriggerRef}
                onCancel={() => setConfirmingDelete(false)}
                onConfirm={() => void confirmDelete()}
              />
            ) : (
              <>
                <Button type="button" variant="primary-modal" size="md" onClick={() => onMode({ mode: "edit", item })}>Renomear grupo</Button>
                <div>
                  <Button ref={deleteTriggerRef} type="button" variant="danger-link" size="xs" onClick={() => setConfirmingDelete(true)}>Excluir grupo</Button>
                </div>
              </>
            )}
          </div>
        </>
      ) : null}

      {state && editing ? (
        <form
          noValidate
          className="flex flex-1 flex-col gap-5"
          onSubmit={handleSubmit(async (values) => {
            setSaveError(null);
            try {
              await onSave(values, item);
              onClose();
            } catch (error) {
              setSaveError(errorMessage(error, "Não foi possível salvar o grupo."));
            }
          })}
        >
          <Field label="Nome do grupo" htmlFor="group-name" error={errors.name?.message}>
            <Input id="group-name" placeholder="Ex.: McDonald's" aria-invalid={!!errors.name} className={fieldInputClass} {...register("name")} />
          </Field>
          <ErrorNote message={saveError} />
          <div className="mt-auto grid grid-cols-2 gap-2 border-t border-ds-divider pt-4">
            <Button type="button" variant="ds-secondary" size="md" disabled={isSubmitting} onClick={() => (item ? onMode({ mode: "view", item }) : onClose())}>Cancelar</Button>
            <Button type="submit" variant="primary-modal" size="md" loading={isSubmitting}>{state.mode === "create" ? "Criar grupo" : "Salvar grupo"}</Button>
          </div>
        </form>
      ) : null}
    </SidePanel>
  );
}

/* ───────────────────────── Seleção para o comparativo ───────────────────────── */

export function CompetitorSelectionPanel({
  open,
  onClose,
  groups,
  competitors,
  selectedIds,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  groups: CompetitorGroup[];
  competitors: Competitor[];
  selectedIds: string[];
  onApply: (ids: string[]) => void;
}) {
  const [draft, setDraft] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    if (open) setDraft(new Set(selectedIds));
    // O rascunho reinicia só ao abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const grouped = React.useMemo(
    () => groups.map((group) => ({ group, units: competitors.filter((competitor) => competitor.competitorGroupId === group.id) })).filter((entry) => entry.units.length > 0),
    [groups, competitors]
  );

  const toggle = (ids: string[], checked: boolean) =>
    setDraft((current) => {
      const next = new Set(current);
      ids.forEach((id) => (checked ? next.add(id) : next.delete(id)));
      return next;
    });

  return (
    <SidePanel
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      kicker="Comparativo de preços"
      title="Selecionar concorrentes"
      subtitle="Escolha quais entram na tabela de comparação."
    >
      {grouped.length === 0 ? (
        <p className="rounded-ds-btn-lg border border-dashed border-ds-border-input px-4 py-8 text-center text-[13px] text-ds-ink-muted">
          Nenhuma unidade concorrente cadastrada ainda.
        </p>
      ) : (
        grouped.map(({ group, units }) => {
          const ids = units.map((unit) => unit.id);
          const all = ids.every((id) => draft.has(id));
          const some = ids.some((id) => draft.has(id));
          return (
            <PanelSection key={group.id} title={group.name} aside={`${ids.filter((id) => draft.has(id)).length}/${ids.length}`}>
              <label className="flex items-center gap-2.5 text-[13px] font-extrabold">
                <Checkbox checked={all || (some ? "indeterminate" : false)} aria-label={`Selecionar todo o grupo ${group.name}`} onCheckedChange={(value) => toggle(ids, value === true)} />
                Todas as unidades
              </label>
              <div className="space-y-2.5 border-t border-ds-divider pt-3">
                {units.map((unit) => (
                  <label key={unit.id} className="flex items-center gap-2.5 text-[13px] font-semibold">
                    <Checkbox checked={draft.has(unit.id)} aria-label={unit.name} onCheckedChange={(value) => toggle([unit.id], value === true)} />
                    {unit.name}
                  </label>
                ))}
              </div>
            </PanelSection>
          );
        })
      )}
      <div className="mt-auto grid grid-cols-2 gap-2 border-t border-ds-divider pt-4">
        <Button type="button" variant="ds-secondary" size="md" onClick={onClose}>Cancelar</Button>
        <Button type="button" variant="primary-modal" size="md" onClick={() => { onApply(Array.from(draft)); onClose(); }}>
          Aplicar seleção ({draft.size})
        </Button>
      </div>
    </SidePanel>
  );
}
