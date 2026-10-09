"use client";

import { useEffect, useMemo, useState } from "react";
import { addDoc, deleteDoc, Timestamp, updateDoc } from "firebase/firestore";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/hooks/use-auth";
import { useKiosks } from "@/hooks/use-kiosks";
import { financialCollection, financialDoc } from "@/features/financial/lib/repositories";
import { useFinancialCollection } from "@/features/financial/hooks/use-financial-collection";
import { CadastrosHero, Chevron, EmptyResults, ListHead, ListRow, ListShell, ListSkeleton, Mono, SoftPill } from "@/components/cadastros/cadastros-ui";
import { Field, fieldInputClass } from "@/components/patterns/field";
import { InlineConfirm } from "@/components/patterns/inline-confirm";
import { errorMessageOf, PanelErrorNote, PanelFormFooter, PanelSelectField, PanelSwitchRow } from "@/components/patterns/panel-form";
import { PanelField, PanelSection, SidePanel } from "@/components/patterns/side-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ALIAS_MATCH_LABELS, matchesFinanceQuery } from "./settings-model";

const aliasSchema = z.object({
  pattern: z.string().trim().min(2, "O padrão deve ter pelo menos 2 caracteres."),
  matchType: z.enum(["contains", "startsWith", "endsWith", "exact"]),
  caseSensitive: z.boolean().default(false),
  accountPlanId: z.string().optional(),
  resultCenterId: z.string().optional(),
  supplier: z.string().optional(),
  descriptionOverride: z.string().optional(),
});

type AliasFormValues = z.infer<typeof aliasSchema>;

type AliasRecord = {
  id: string;
  pattern: string;
  matchType: keyof typeof ALIAS_MATCH_LABELS | string;
  caseSensitive?: boolean;
  accountPlanId?: string | null;
  accountPlanName?: string | null;
  resultCenterId?: string | null;
  resultCenterName?: string | null;
  supplier?: string | null;
  descriptionOverride?: string | null;
};

type AccountPlanRecord = { id: string; name: string; active?: boolean; order?: number };

type PanelState = { mode: "view"; item: AliasRecord } | { mode: "edit"; item: AliasRecord } | { mode: "create" };

const TEMPLATE = "minmax(200px,1.1fr) 120px minmax(180px,1fr) minmax(160px,1fr) minmax(160px,1fr) 16px";

export default function ImportAliasesManagement({ canManage = true }: { canManage?: boolean }) {
  const { firebaseUser } = useAuth();
  const { kiosks } = useKiosks();
  const { data: aliases, loading, error, refresh } = useFinancialCollection<AliasRecord>(financialCollection("importAliases"));
  const { data: accountPlans } = useFinancialCollection<AccountPlanRecord>(financialCollection("accounts"));
  const units = useMemo(() => [...kiosks].sort((left, right) => left.name.localeCompare(right.name, "pt-BR")), [kiosks]);
  const planOptions = useMemo(
    () => (accountPlans ?? []).filter((plan) => plan.active !== false).sort((left, right) => (left.order ?? 0) - (right.order ?? 0)).map((plan) => ({ id: plan.id, name: plan.name })),
    [accountPlans]
  );
  const [query, setQuery] = useState("");
  const [matchFilter, setMatchFilter] = useState("all");
  const [panel, setPanel] = useState<PanelState | null>(null);

  const all = useMemo(() => [...(aliases ?? [])].sort((left, right) => left.pattern.localeCompare(right.pattern, "pt-BR", { sensitivity: "base" })), [aliases]);
  const rows = useMemo(
    () =>
      all.filter(
        (item) =>
          (matchFilter === "all" || item.matchType === matchFilter) &&
          matchesFinanceQuery(query, item.pattern, item.supplier, item.accountPlanName, item.resultCenterName, item.descriptionOverride)
      ),
    [all, query, matchFilter]
  );
  const chips = useMemo(
    () => [
      { id: "all", label: "Todos", count: all.length },
      ...Object.entries(ALIAS_MATCH_LABELS).map(([id, label]) => ({ id, label, count: all.filter((item) => item.matchType === id).length })),
    ],
    [all]
  );

  async function save(values: AliasFormValues, current: AliasRecord | null) {
    if (!firebaseUser) throw new Error("Sessão expirada. Entre novamente.");
    const plan = planOptions.find((item) => item.id === values.accountPlanId);
    const unit = units.find((item) => item.id === values.resultCenterId);
    const payload = {
      pattern: values.pattern,
      matchType: values.matchType,
      caseSensitive: values.caseSensitive,
      accountPlanId: values.accountPlanId || null,
      accountPlanName: plan?.name || null,
      resultCenterId: values.resultCenterId || null,
      resultCenterName: unit?.name || null,
      supplier: values.supplier || null,
      descriptionOverride: values.descriptionOverride || null,
    };
    if (current) {
      await updateDoc(financialDoc("importAliases", current.id), payload);
    } else {
      await addDoc(financialCollection("importAliases"), { ...payload, createdBy: firebaseUser.uid, createdAt: Timestamp.now() });
    }
    refresh();
  }

  async function remove(item: AliasRecord) {
    await deleteDoc(financialDoc("importAliases", item.id));
    refresh();
  }

  return (
    <div className="space-y-5">
      <CadastrosHero
        kicker="Aliases de importação"
        tabs={null}
        search={{ value: query, placeholder: "Buscar padrão, fornecedor ou conta", onChange: setQuery }}
        primary={canManage ? { label: "Novo alias", onClick: () => setPanel({ mode: "create" }) } : undefined}
        chips={chips}
        activeChip={matchFilter}
        onChip={setMatchFilter}
      />

      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="text-[28px] font-extrabold tracking-[-0.03em]">{rows.length}</span>
        <span className="text-[13px] text-ds-ink-faint">de {all.length} regras</span>
        <span className="text-[13px] text-ds-ink-muted">· Pré-classificam as transações dos extratos bancários na revisão da importação.</span>
      </div>

      {error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-ds-card border border-ds-confirm-border bg-ds-confirm-bg px-5 py-4">
          <p className="text-[13px] font-semibold text-ds-confirm-ink">{error.message}</p>
          <Button type="button" variant="ds-secondary" size="md" onClick={() => refresh()}>Tentar novamente</Button>
        </div>
      ) : null}

      {loading && !aliases ? (
        <div className="rounded-ds-card-lg border border-ds-border bg-ds-warm" role="status" aria-label="Carregando aliases">
          <ListSkeleton rows={4} />
        </div>
      ) : (
        <ListShell minWidth={980}>
          <ListHead template={TEMPLATE}>
            <span>Padrão</span>
            <span>Comparação</span>
            <span>Plano de contas</span>
            <span>Unidade</span>
            <span>Fornecedor</span>
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
              label={`Abrir ${item.pattern}`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <Mono className="truncate text-[13px] font-bold">{item.pattern}</Mono>
                {item.caseSensitive ? <SoftPill>Aa</SoftPill> : null}
              </div>
              <span className="text-xs font-semibold text-ds-ink-2">{ALIAS_MATCH_LABELS[item.matchType] ?? item.matchType}</span>
              <span className="truncate text-[13px]">{item.accountPlanName || <SoftPill isEmpty>Sem plano</SoftPill>}</span>
              <span className="truncate text-[13px]">{item.resultCenterName || <SoftPill isEmpty>Sem unidade</SoftPill>}</span>
              <span className="truncate text-[13px]">{item.supplier || <SoftPill isEmpty>Sem fornecedor</SoftPill>}</span>
              <Chevron />
            </ListRow>
          ))}
          {rows.length === 0 && !error ? (
            all.length === 0
              ? <p className="px-5 py-12 text-center text-sm text-ds-ink-muted">Nenhum alias cadastrado.</p>
              : <EmptyResults title="Nenhum alias encontrado com esses filtros." onClear={() => { setQuery(""); setMatchFilter("all"); }} />
          ) : null}
        </ListShell>
      )}

      <AliasPanel
        state={panel}
        planOptions={planOptions}
        units={units}
        canManage={canManage}
        onClose={() => setPanel(null)}
        onMode={setPanel}
        onSave={save}
        onRemove={remove}
      />
    </div>
  );
}

function AliasPanel({
  state,
  planOptions,
  units,
  canManage,
  onClose,
  onMode,
  onSave,
  onRemove,
}: {
  state: PanelState | null;
  planOptions: Array<{ id: string; name: string }>;
  units: Array<{ id: string; name: string }>;
  canManage: boolean;
  onClose: () => void;
  onMode: (state: PanelState) => void;
  onSave: (values: AliasFormValues, current: AliasRecord | null) => Promise<void>;
  onRemove: (item: AliasRecord) => Promise<void>;
}) {
  const empty: AliasFormValues = { pattern: "", matchType: "contains", caseSensitive: false, accountPlanId: "", resultCenterId: "", supplier: "", descriptionOverride: "" };
  const form = useForm<AliasFormValues>({ resolver: zodResolver(aliasSchema), defaultValues: empty });
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
        ? {
            pattern: state.item.pattern,
            matchType: (state.item.matchType as AliasFormValues["matchType"]) ?? "contains",
            caseSensitive: state.item.caseSensitive ?? false,
            accountPlanId: state.item.accountPlanId || "",
            resultCenterId: state.item.resultCenterId || "",
            supplier: state.item.supplier || "",
            descriptionOverride: state.item.descriptionOverride || "",
          }
        : empty
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, reset]);

  return (
    <SidePanel
      open={!!state}
      onOpenChange={(open) => { if (!open) onClose(); }}
      kicker={state?.mode === "create" ? "Novo alias" : state?.mode === "edit" ? "Editar alias" : "Alias de importação"}
      title={state?.mode === "create" ? "Sem padrão" : item?.pattern ?? ""}
      subtitle="Aplicado automaticamente na revisão de importação."
    >
      {state && !editing && item ? (
        <>
          <PanelSection title="Regra">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
              <PanelField label="Comparação">{ALIAS_MATCH_LABELS[item.matchType] ?? item.matchType}</PanelField>
              <PanelField label="Maiúsculas">{item.caseSensitive ? "Diferencia" : "Ignora"}</PanelField>
            </div>
          </PanelSection>
          <PanelSection title="Sugestão aplicada">
            <PanelField label="Plano de contas">{item.accountPlanName || "Não define"}</PanelField>
            <PanelField label="Unidade">{item.resultCenterName || "Não define"}</PanelField>
            <PanelField label="Fornecedor">{item.supplier || "Não define"}</PanelField>
            <PanelField label="Descrição">{item.descriptionOverride || "Mantém a original"}</PanelField>
          </PanelSection>
          {canManage ? (
            <div className="mt-auto space-y-3 border-t border-ds-divider pt-4">
              {confirmingDelete ? (
                <InlineConfirm
                  message={`Excluir a regra “${item.pattern}”? Ela deixa de ser aplicada em futuras importações.`}
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
                      setSaveError(errorMessageOf(error, "Não foi possível excluir o alias."));
                    } finally {
                      setDeleting(false);
                    }
                  }}
                />
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" variant="primary-modal" size="md" onClick={() => onMode({ mode: "edit", item })}>Editar alias</Button>
                  <Button type="button" variant="danger-link" size="md" onClick={() => setConfirmingDelete(true)}>Excluir alias</Button>
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
              setSaveError(errorMessageOf(error, "Não foi possível salvar o alias."));
            }
          })}
        >
          <Field label="Padrão" htmlFor="alias-pattern" error={errors.pattern?.message}>
            <Input id="alias-pattern" placeholder="Ex.: UBER, GOOGLE, IFOOD" aria-invalid={!!errors.pattern} className={fieldInputClass} {...register("pattern")} />
          </Field>
          <Controller control={control} name="matchType" render={({ field }) => (
            <PanelSelectField id="alias-match" label="Tipo de comparação" value={field.value} onChange={field.onChange} options={Object.entries(ALIAS_MATCH_LABELS).map(([id, name]) => ({ id, name }))} />
          )} />
          <Controller control={control} name="caseSensitive" render={({ field }) => (
            <PanelSwitchRow id="alias-case" label="Diferenciar maiúsculas" description="Desative para comparar sem distinguir maiúsculas e minúsculas." checked={field.value} onChange={field.onChange} />
          )} />
          <Controller control={control} name="accountPlanId" render={({ field }) => (
            <PanelSelectField id="alias-plan" label="Plano de contas" requirement="opcional" value={field.value} onChange={field.onChange} noneLabel="Nenhum" options={planOptions} />
          )} />
          <Controller control={control} name="resultCenterId" render={({ field }) => (
            <PanelSelectField id="alias-unit" label="Unidade" requirement="opcional" value={field.value} onChange={field.onChange} noneLabel="Nenhuma" options={units} />
          )} />
          <Field label="Fornecedor" htmlFor="alias-supplier" requirement="opcional">
            <Input id="alias-supplier" placeholder="Fornecedor sugerido" className={fieldInputClass} {...register("supplier")} />
          </Field>
          <Field label="Descrição sugerida" htmlFor="alias-description" requirement="opcional">
            <Textarea id="alias-description" rows={3} placeholder="Texto que substituirá a descrição original" className={cn(fieldInputClass, "h-auto py-2.5")} {...register("descriptionOverride")} />
          </Field>
          <PanelErrorNote message={saveError} />
          <PanelFormFooter submitting={isSubmitting} creating={state.mode === "create"} noun="alias" onCancel={() => (item ? onMode({ mode: "view", item }) : onClose())} />
        </form>
      ) : null}
    </SidePanel>
  );
}
