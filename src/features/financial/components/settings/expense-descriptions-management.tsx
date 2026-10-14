"use client";

import { useEffect, useMemo, useState } from "react";
import { addDoc, deleteDoc, Timestamp, updateDoc } from "firebase/firestore";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/hooks/use-auth";
import {
  expenseDescriptionFormSchema,
  type ExpenseDescriptionFormValues,
} from "@/features/financial/lib/schemas";
import { financialCollection, financialDoc } from "@/features/financial/lib/repositories";
import { useFinancialCollection } from "@/features/financial/hooks/use-financial-collection";
import { CadastrosHero, Chevron, EmptyResults, ListHead, ListRow, ListShell, ListSkeleton } from "@/components/cadastros/cadastros-ui";
import { Field, fieldInputClass } from "@/components/patterns/field";
import { InlineConfirm } from "@/components/patterns/inline-confirm";
import { errorMessageOf, PanelErrorNote, PanelFormFooter, PanelSwitchRow } from "@/components/patterns/panel-form";
import { PanelField, PanelSection, SidePanel } from "@/components/patterns/side-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/status-pill";
import { matchesFinanceQuery } from "./settings-model";

type ExpenseDescriptionRecord = ExpenseDescriptionFormValues & {
  id: string;
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
};

type PanelState =
  | { mode: "view"; item: ExpenseDescriptionRecord }
  | { mode: "edit"; item: ExpenseDescriptionRecord }
  | { mode: "create" };

const TEMPLATE = "minmax(280px,1fr) 110px 16px";

export default function ExpenseDescriptionsManagement({ canManage = true }: { canManage?: boolean }) {
  const { firebaseUser } = useAuth();
  const { data: descriptions, loading, refresh } = useFinancialCollection<ExpenseDescriptionRecord>(financialCollection("expenseDescriptions"));
  const [query, setQuery] = useState("");
  const [panel, setPanel] = useState<PanelState | null>(null);

  const ordered = useMemo(
    () => [...(descriptions || [])].sort((left, right) => left.label.localeCompare(right.label, "pt-BR", { sensitivity: "base" })),
    [descriptions]
  );
  const rows = useMemo(() => ordered.filter((item) => matchesFinanceQuery(query, item.label)), [ordered, query]);
  const activeCount = ordered.filter((item) => item.active !== false).length;

  async function save(values: ExpenseDescriptionFormValues, current: ExpenseDescriptionRecord | null) {
    if (!firebaseUser) throw new Error("Sessão expirada. Entre novamente.");
    const payload = {
      label: values.label.trim(),
      active: values.active,
      updatedAt: Timestamp.now(),
      updatedBy: firebaseUser.uid,
    };
    if (current) {
      await updateDoc(financialDoc("expenseDescriptions", current.id), payload);
    } else {
      await addDoc(financialCollection("expenseDescriptions"), { ...payload, createdAt: Timestamp.now(), createdBy: firebaseUser.uid });
    }
    await refresh();
  }

  async function remove(item: ExpenseDescriptionRecord) {
    await deleteDoc(financialDoc("expenseDescriptions", item.id));
    await refresh();
  }

  return (
    <div className="space-y-5">
      <CadastrosHero
        kicker="Descrições reutilizáveis"
        tabs={null}
        search={{ value: query, placeholder: "Buscar descrição", onChange: setQuery }}
        primary={canManage ? { label: "Nova descrição", onClick: () => setPanel({ mode: "create" }) } : undefined}
        chips={[]}
        activeChip="all"
        onChip={() => undefined}
      />

      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="text-[28px] font-extrabold tracking-[-0.03em]">{rows.length}</span>
        <span className="text-[13px] text-ds-ink-faint">de {ordered.length} descrições · {activeCount} ativas</span>
        <span className="text-[13px] text-ds-ink-muted">· Aparecem como sugestão no lançamento manual de despesas.</span>
      </div>

      {loading ? (
        <div className="rounded-ds-card-lg border border-ds-border bg-ds-warm" role="status" aria-label="Carregando descrições">
          <ListSkeleton rows={4} />
        </div>
      ) : (
        <ListShell minWidth={520}>
          <ListHead template={TEMPLATE}>
            <span>Descrição</span>
            <span>Situação</span>
            <span />
          </ListHead>
          {rows.map((item) => (
            <ListRow
              key={item.id}
              template={TEMPLATE}
              isOpen={panel?.mode !== "create" && panel?.item.id === item.id}
              isSelected={false}
              isMuted={item.active === false}
              onOpen={() => setPanel({ mode: "view", item })}
              label={`Abrir ${item.label}`}
            >
              <span className="truncate text-[13.5px] font-semibold">{item.label}</span>
              <StatusPill variant={item.active === false ? "neutral" : "ok"}>{item.active === false ? "Inativa" : "Ativa"}</StatusPill>
              <Chevron />
            </ListRow>
          ))}
          {rows.length === 0 ? (
            ordered.length === 0
              ? <p className="px-5 py-12 text-center text-sm text-ds-ink-muted">Nenhuma descrição cadastrada.</p>
              : <EmptyResults title="Nenhuma descrição encontrada com essa busca." onClear={() => setQuery("")} />
          ) : null}
        </ListShell>
      )}

      <DescriptionPanel state={panel} canManage={canManage} onClose={() => setPanel(null)} onMode={setPanel} onSave={save} onRemove={remove} />
    </div>
  );
}

function DescriptionPanel({
  state,
  canManage,
  onClose,
  onMode,
  onSave,
  onRemove,
}: {
  state: PanelState | null;
  canManage: boolean;
  onClose: () => void;
  onMode: (state: PanelState) => void;
  onSave: (values: ExpenseDescriptionFormValues, current: ExpenseDescriptionRecord | null) => Promise<void>;
  onRemove: (item: ExpenseDescriptionRecord) => Promise<void>;
}) {
  const form = useForm<ExpenseDescriptionFormValues>({ resolver: zodResolver(expenseDescriptionFormSchema), defaultValues: { label: "", active: true } });
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
    reset({ label: state.mode === "edit" ? state.item.label : "", active: state.mode === "edit" ? state.item.active ?? true : true });
  }, [state, reset]);

  return (
    <SidePanel
      open={!!state}
      onOpenChange={(open) => { if (!open) onClose(); }}
      kicker={state?.mode === "create" ? "Nova descrição" : state?.mode === "edit" ? "Editar descrição" : "Descrição"}
      title={state?.mode === "create" ? "Sem texto" : item?.label ?? ""}
      subtitle="Texto sugerido no lançamento manual de despesas."
    >
      {state && !editing && item ? (
        <>
          <PanelSection title="Dados">
            <PanelField label="Situação">
              <StatusPill variant={item.active === false ? "neutral" : "ok"}>{item.active === false ? "Inativa" : "Ativa"}</StatusPill>
            </PanelField>
            <PanelField label="Texto sugerido">{item.label}</PanelField>
          </PanelSection>
          {canManage ? (
            <div className="mt-auto space-y-3 border-t border-ds-divider pt-4">
              {confirmingDelete ? (
                <>
                  <InlineConfirm
                    message={`Excluir “${item.label}”? A sugestão deixa de aparecer em novos lançamentos.`}
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
                        setSaveError(errorMessageOf(error, "Não foi possível excluir a descrição."));
                      } finally {
                        setDeleting(false);
                      }
                    }}
                  />
                </>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" variant="primary-modal" size="md" onClick={() => onMode({ mode: "edit", item })}>Editar descrição</Button>
                  <Button type="button" variant="danger-link" size="md" onClick={() => setConfirmingDelete(true)}>Excluir descrição</Button>
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
              setSaveError(errorMessageOf(error, "Não foi possível salvar a descrição."));
            }
          })}
        >
          <Field label="Descrição" htmlFor="expense-description-label" error={errors.label?.message}>
            <Input id="expense-description-label" placeholder="Ex.: Aluguel da unidade Nazaré" aria-invalid={!!errors.label} className={fieldInputClass} {...register("label")} />
          </Field>
          <Controller control={control} name="active" render={({ field }) => (
            <PanelSwitchRow id="expense-description-active" label="Descrição ativa" description="Desative para ocultar a sugestão sem perder o cadastro." checked={field.value} onChange={field.onChange} />
          )} />
          <PanelErrorNote message={saveError} />
          <PanelFormFooter submitting={isSubmitting} creating={state.mode === "create"} noun="descrição" onCancel={() => (item ? onMode({ mode: "view", item }) : onClose())} />
        </form>
      ) : null}
    </SidePanel>
  );
}
