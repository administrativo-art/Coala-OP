"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { addDoc, deleteDoc, setDoc } from "firebase/firestore";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useKiosks } from "@/hooks/use-kiosks";
import { auth } from "@/lib/firebase";
import { fetchWithTimeout } from "@/lib/fetch-utils";
import {
  resultCenterFormSchema,
  type ResultCenterFormValues,
} from "@/features/financial/lib/schemas";
import { financialCollection, financialDoc } from "@/features/financial/lib/repositories";
import { CadastrosHero, Chevron, EmptyResults, ListHead, ListRow, ListShell, ListSkeleton, SoftPill } from "@/components/cadastros/cadastros-ui";
import { Field, fieldInputClass } from "@/components/patterns/field";
import { InlineConfirm } from "@/components/patterns/inline-confirm";
import { errorMessageOf, PanelErrorNote, PanelFormFooter } from "@/components/patterns/panel-form";
import { PanelField, PanelSection, SidePanel } from "@/components/patterns/side-panel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { matchesFinanceQuery } from "./settings-model";

type ResultCenter = ResultCenterFormValues & { id: string };

type PanelState = { mode: "view"; item: ResultCenter } | { mode: "edit"; item: ResultCenter } | { mode: "create" };

const TEMPLATE = "minmax(220px,1fr) minmax(260px,1.4fr) minmax(200px,1fr) 16px";

export default function ResultCentersManagement({ canManage = true }: { canManage?: boolean }) {
  const { kiosks, loading: kiosksLoading } = useKiosks();
  const [resultCenters, setResultCenters] = useState<ResultCenter[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [panel, setPanel] = useState<PanelState | null>(null);

  const refresh = useCallback(async () => {
    if (!auth.currentUser) {
      setLoadError("Usuário não autenticado.");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const token = await auth.currentUser.getIdToken();
      const response = await fetchWithTimeout("/api/financial/data?path=resultCenters", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Falha ao carregar os centros de resultado.");
      setResultCenters((payload.docs ?? []) as ResultCenter[]);
      setLoadError(null);
    } catch (error) {
      setLoadError(errorMessageOf(error, "Falha ao carregar os centros de resultado."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const units = useMemo(() => [...kiosks].sort((left, right) => left.name.localeCompare(right.name, "pt-BR")), [kiosks]);
  const unitNameById = useMemo(() => new Map(units.map((unit) => [unit.id, unit.name])), [units]);

  const all = useMemo(
    () => [...(resultCenters ?? [])].sort((left, right) => left.name.localeCompare(right.name, "pt-BR")),
    [resultCenters]
  );
  const rows = useMemo(
    () =>
      all.filter((item) =>
        matchesFinanceQuery(query, item.name, item.description, ...(item.unitIds ?? []).map((id) => unitNameById.get(id) ?? id))
      ),
    [all, query, unitNameById]
  );

  async function save(values: ResultCenterFormValues, current: ResultCenter | null) {
    const payload = { ...values, unitIds: Array.from(new Set(values.unitIds ?? [])) };
    if (current) await setDoc(financialDoc("resultCenters", current.id), payload);
    else await addDoc(financialCollection("resultCenters"), payload);
    await refresh();
  }

  async function remove(item: ResultCenter) {
    await deleteDoc(financialDoc("resultCenters", item.id));
    await refresh();
  }

  return (
    <div className="space-y-5">
      <CadastrosHero
        kicker="Centros de resultado"
        tabs={null}
        search={{ value: query, placeholder: "Buscar centro ou unidade", onChange: setQuery }}
        primary={canManage ? { label: "Novo centro", onClick: () => setPanel({ mode: "create" }) } : undefined}
        chips={[]}
        activeChip="all"
        onChip={() => undefined}
      />

      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="text-[28px] font-extrabold tracking-[-0.03em]">{rows.length}</span>
        <span className="text-[13px] text-ds-ink-faint">de {all.length} centros</span>
        <span className="text-[13px] text-ds-ink-muted">· Usados no rateio e na análise por unidade de resultado.</span>
      </div>

      {loadError ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-ds-card border border-ds-confirm-border bg-ds-confirm-bg px-5 py-4">
          <p className="text-[13px] font-semibold text-ds-confirm-ink">{loadError}</p>
          <Button type="button" variant="ds-secondary" size="md" onClick={() => void refresh()}>Tentar novamente</Button>
        </div>
      ) : null}

      {loading && !resultCenters ? (
        <div className="rounded-ds-card-lg border border-ds-border bg-ds-warm" role="status" aria-label="Carregando centros de resultado">
          <ListSkeleton rows={4} />
        </div>
      ) : (
        <ListShell minWidth={760}>
          <ListHead template={TEMPLATE}>
            <span>Centro</span>
            <span>Unidades vinculadas</span>
            <span>Descrição</span>
            <span />
          </ListHead>
          {rows.map((item) => (
            <ListRow
              key={item.id}
              template={TEMPLATE}
              isOpen={panel?.mode !== "create" && panel?.item.id === item.id}
              isSelected={false}
              isMuted={false}
              onOpen={() => setPanel({ mode: "view", item })}
              label={`Abrir ${item.name}`}
            >
              <span className="truncate text-[13.5px] font-bold">{item.name}</span>
              <div className="flex min-w-0 flex-wrap gap-1.5">
                {item.unitIds?.length ? (
                  item.unitIds.slice(0, 3).map((unitId) => <SoftPill key={unitId}>{unitNameById.get(unitId) ?? unitId}</SoftPill>)
                ) : (
                  <SoftPill isEmpty>Sem vínculo</SoftPill>
                )}
                {(item.unitIds?.length ?? 0) > 3 ? <SoftPill>+{(item.unitIds?.length ?? 0) - 3}</SoftPill> : null}
              </div>
              <span className="truncate text-xs text-ds-ink-muted">{item.description || "—"}</span>
              <Chevron />
            </ListRow>
          ))}
          {rows.length === 0 && !loadError ? (
            all.length === 0
              ? <p className="px-5 py-12 text-center text-sm text-ds-ink-muted">Nenhum centro de resultado cadastrado.</p>
              : <EmptyResults title="Nenhum centro encontrado com essa busca." onClear={() => setQuery("")} />
          ) : null}
        </ListShell>
      )}

      <CenterPanel
        state={panel}
        units={units}
        unitsLoading={kiosksLoading}
        unitNameById={unitNameById}
        canManage={canManage}
        onClose={() => setPanel(null)}
        onMode={setPanel}
        onSave={save}
        onRemove={remove}
      />
    </div>
  );
}

function CenterPanel({
  state,
  units,
  unitsLoading,
  unitNameById,
  canManage,
  onClose,
  onMode,
  onSave,
  onRemove,
}: {
  state: PanelState | null;
  units: Array<{ id: string; name: string }>;
  unitsLoading: boolean;
  unitNameById: Map<string, string>;
  canManage: boolean;
  onClose: () => void;
  onMode: (state: PanelState) => void;
  onSave: (values: ResultCenterFormValues, current: ResultCenter | null) => Promise<void>;
  onRemove: (item: ResultCenter) => Promise<void>;
}) {
  const form = useForm<ResultCenterFormValues>({ resolver: zodResolver(resultCenterFormSchema), defaultValues: { name: "", description: "", unitIds: [] } });
  const { register, control, handleSubmit, reset, formState: { errors, isSubmitting } } = form;
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const item = state && state.mode !== "create" ? state.item : null;
  const editing = state?.mode === "edit" || state?.mode === "create";

  useEffect(() => {
    setSaveError(null);
    setConfirmingDelete(false);
    if (!state || state.mode === "view") return;
    reset(
      state.mode === "edit"
        ? { name: state.item.name, description: state.item.description ?? "", unitIds: state.item.unitIds ?? [] }
        : { name: "", description: "", unitIds: [] }
    );
  }, [state, reset]);

  return (
    <SidePanel
      open={!!state}
      onOpenChange={(open) => { if (!open) onClose(); }}
      kicker={state?.mode === "create" ? "Novo centro" : state?.mode === "edit" ? "Editar centro" : "Centro de resultado"}
      title={state?.mode === "create" ? "Sem nome" : item?.name ?? ""}
      subtitle="Distribui despesas e analisa o desempenho por unidade."
    >
      {state && !editing && item ? (
        <>
          <PanelSection title="Dados">
            <PanelField label="Descrição">{item.description || "Sem descrição."}</PanelField>
          </PanelSection>
          <PanelSection title="Unidades vinculadas" aside={item.unitIds?.length ?? 0}>
            {item.unitIds?.length ? (
              <ul className="space-y-1.5">
                {item.unitIds.map((unitId) => <li key={unitId} className="text-[13px] font-semibold">{unitNameById.get(unitId) ?? unitId}</li>)}
              </ul>
            ) : (
              <p className="text-[13px] text-ds-ink-muted">Sem vínculo com unidade específica.</p>
            )}
          </PanelSection>
          {canManage ? (
            <div className="mt-auto space-y-3 border-t border-ds-divider pt-4">
              {confirmingDelete ? (
                <InlineConfirm
                  message={`Excluir “${item.name}”? Confirme que ele não está em uso em despesas ativas.`}
                  loading={deleting}
                  onCancel={() => setConfirmingDelete(false)}
                  onConfirm={async () => {
                    setDeleting(true);
                    setSaveError(null);
                    try {
                      await onRemove(item);
                      onClose();
                    } catch (error) {
                      setConfirmingDelete(false);
                      setSaveError(errorMessageOf(error, "Não foi possível excluir o centro de resultado."));
                    } finally {
                      setDeleting(false);
                    }
                  }}
                />
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" variant="primary-modal" size="md" onClick={() => onMode({ mode: "edit", item })}>Editar centro</Button>
                  <Button type="button" variant="danger-link" size="md" onClick={() => setConfirmingDelete(true)}>Excluir centro</Button>
                </div>
              )}
              <PanelErrorNote message={saveError} />
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
              await onSave(values, item);
              onClose();
            } catch (error) {
              setSaveError(errorMessageOf(error, "Não foi possível salvar o centro de resultado."));
            }
          })}
        >
          <Field label="Nome" htmlFor="center-name" error={errors.name?.message}>
            <Input id="center-name" placeholder="Ex.: Operação São Luís" aria-invalid={!!errors.name} className={fieldInputClass} {...register("name")} />
          </Field>
          <Field label="Descrição" htmlFor="center-description" requirement="opcional" error={errors.description?.message}>
            <Textarea id="center-description" rows={3} placeholder="Contexto opcional" className={cn(fieldInputClass, "h-auto py-2.5")} {...register("description")} />
          </Field>
          <Controller
            control={control}
            name="unitIds"
            render={({ field }) => {
              const selected = field.value ?? [];
              return (
                <Field label="Unidades vinculadas" requirement="opcional" hint="Deixe sem marcar para usar o centro sem vínculo com unidade específica." error={errors.unitIds?.message as string | undefined}>
                  {unitsLoading ? (
                    <p className="text-[13px] text-ds-ink-muted">Carregando unidades…</p>
                  ) : units.length === 0 ? (
                    <p className="text-[13px] text-ds-ink-muted">Nenhuma unidade cadastrada no OP.</p>
                  ) : (
                    <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-ds-btn-lg border border-ds-border bg-white p-2">
                      {units.map((unit) => {
                        const checked = selected.includes(unit.id);
                        return (
                          <label key={unit.id} className="flex cursor-pointer items-center gap-3 rounded-ds-btn px-2.5 py-2 hover:bg-ds-muted">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(next) => field.onChange(next ? [...selected, unit.id] : selected.filter((id) => id !== unit.id))}
                            />
                            <span className="text-[13px] font-semibold">{unit.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </Field>
              );
            }}
          />
          <PanelErrorNote message={saveError} />
          <PanelFormFooter submitting={isSubmitting} creating={state.mode === "create"} noun="centro" onCancel={() => (item ? onMode({ mode: "view", item }) : onClose())} />
        </form>
      ) : null}
    </SidePanel>
  );
}
