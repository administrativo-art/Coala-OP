"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDoc, deleteDoc, Timestamp, updateDoc } from "firebase/firestore";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/hooks/use-auth";
import { useKiosks } from "@/hooks/use-kiosks";
import { auth } from "@/lib/firebase";
import { WORKSPACE_ID } from "@/lib/workspace";
import { fetchWithTimeout } from "@/lib/fetch-utils";
import { bankAccountSchema, type BankAccountFormValues } from "@/features/financial/lib/schemas";
import { financialCollection, financialDoc } from "@/features/financial/lib/repositories";
import { CadastrosHero, Chevron, EmptyResults, ListHead, ListRow, ListShell, ListSkeleton, Mono, SoftPill } from "@/components/cadastros/cadastros-ui";
import { Field, fieldInputClass } from "@/components/patterns/field";
import { InlineConfirm } from "@/components/patterns/inline-confirm";
import { errorMessageOf, PanelErrorNote, PanelFormFooter, PanelSelectField, PanelSwitchRow } from "@/components/patterns/panel-form";
import { PanelField, PanelSection, SidePanel } from "@/components/patterns/side-panel";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/status-pill";
import { bankAccountSummary, describeCardCycle, matchesFinanceQuery, PAYMENT_TYPE_LABELS } from "./settings-model";

type BrazilianBank = { ispb: string; name: string; code: number | null };

type PaymentMethodRecord = {
  id: string;
  type: string;
  label: string;
  lastDigits?: string;
  pixKey?: string;
  closingDay?: number;
  dueDay?: number;
  limit?: number;
};

type BankAccountRecord = {
  id: string;
  name: string;
  agency?: string;
  accountNumber?: string;
  active?: boolean;
  resultCenterId?: string;
  unitId?: string;
  workspaceId?: string;
  paymentMethods?: PaymentMethodRecord[];
};

type ResultCenterRecord = { id: string; name: string };

type PanelState = { mode: "view"; item: BankAccountRecord } | { mode: "edit"; item: BankAccountRecord } | { mode: "create" };

const TEMPLATE = "minmax(220px,1.2fr) minmax(170px,1fr) minmax(220px,1.4fr) 110px 16px";

function BankCombobox({ id, value, onChange, invalid }: { id: string; value: string; onChange: (value: string) => void; invalid: boolean }) {
  const [banks, setBanks] = useState<BrazilianBank[]>([]);
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("https://brasilapi.com.br/api/banks/v1")
      .then((response) => response.json())
      .then((data: BrazilianBank[]) => setBanks(data.filter((bank) => bank.name).sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => {});
  }, []);

  useEffect(() => setQuery(value), [value]);

  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, []);

  const filtered = useMemo(() => {
    if (!query) return banks.slice(0, 40);
    const normalized = query.toLowerCase();
    return banks.filter((bank) => bank.name.toLowerCase().includes(normalized) || String(bank.code ?? "").includes(normalized)).slice(0, 40);
  }, [banks, query]);

  return (
    <div ref={ref} className="relative">
      <Input
        id={id}
        value={query}
        placeholder="Buscar banco ou instituição"
        aria-invalid={invalid}
        autoComplete="off"
        className={fieldInputClass}
        onChange={(event) => {
          setQuery(event.target.value);
          onChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && filtered.length > 0 ? (
        <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-ds-btn border border-ds-border bg-white shadow-ds-side">
          {filtered.map((bank) => (
            <button
              key={bank.ispb}
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-ds-muted"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(bank.name);
                setQuery(bank.name);
                setOpen(false);
              }}
            >
              {bank.code ? <span className="w-8 shrink-0 font-ds-mono text-xs text-ds-ink-faint">{bank.code}</span> : null}
              <span className="truncate font-semibold">{bank.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function BankAccountsManagement({ canManage = true }: { canManage?: boolean }) {
  const { firebaseUser } = useAuth();
  const { kiosks, loading: kiosksLoading } = useKiosks();
  const [accounts, setAccounts] = useState<BankAccountRecord[] | null>(null);
  const [resultCenters, setResultCenters] = useState<ResultCenterRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [panel, setPanel] = useState<PanelState | null>(null);

  const units = useMemo(() => [...kiosks].sort((left, right) => left.name.localeCompare(right.name, "pt-BR")), [kiosks]);
  const linkOptions = useMemo(
    () => (resultCenters.length > 0 ? resultCenters.map((center) => ({ id: center.id, name: center.name })) : units.map((unit) => ({ id: unit.id, name: unit.name }))),
    [resultCenters, units]
  );
  const linkLabel = resultCenters.length > 0 ? "Centro de resultado padrão" : "Unidade vinculada";

  const refresh = useCallback(async () => {
    if (!auth.currentUser) {
      setLoadError("Usuário não autenticado.");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const token = await auth.currentUser.getIdToken();
      const [accountsResponse, centersResponse] = await Promise.all([
        fetchWithTimeout("/api/financial/data?path=bankAccounts", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }),
        fetchWithTimeout("/api/financial/data?path=resultCenters", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }),
      ]);
      const accountsPayload = await accountsResponse.json().catch(() => ({}));
      const centersPayload = await centersResponse.json().catch(() => ({}));
      if (!accountsResponse.ok) throw new Error(accountsPayload?.error || "Falha ao carregar as contas bancárias.");
      if (!centersResponse.ok) throw new Error(centersPayload?.error || "Falha ao carregar os centros de resultado.");
      setAccounts((accountsPayload.docs ?? []) as BankAccountRecord[]);
      setResultCenters((centersPayload.docs ?? []) as ResultCenterRecord[]);
      setLoadError(null);
    } catch (error) {
      setLoadError(errorMessageOf(error, "Falha ao carregar as contas bancárias."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const all = useMemo(() => [...(accounts ?? [])].sort((left, right) => left.name.localeCompare(right.name, "pt-BR")), [accounts]);
  const summary = useMemo(() => bankAccountSummary(all), [all]);
  const linkNameOf = useCallback(
    (account: BankAccountRecord) => {
      const center = resultCenters.find((entry) => entry.id === account.resultCenterId);
      if (center) return center.name;
      return units.find((unit) => unit.id === (account.unitId || account.resultCenterId))?.name ?? null;
    },
    [resultCenters, units]
  );
  const rows = useMemo(
    () =>
      all.filter((account) => {
        if (statusFilter === "active" && account.active === false) return false;
        if (statusFilter === "inactive" && account.active !== false) return false;
        return matchesFinanceQuery(query, account.name, account.agency, account.accountNumber, linkNameOf(account), ...(account.paymentMethods ?? []).map((method) => method.label));
      }),
    [all, query, statusFilter, linkNameOf]
  );

  async function save(values: BankAccountFormValues, current: BankAccountRecord | null) {
    if (!firebaseUser) throw new Error("Sessão expirada. Entre novamente.");
    if (current?.workspaceId && current.workspaceId !== WORKSPACE_ID) {
      throw new Error("A conta pertence a outro workspace e não pode ser reassociada.");
    }
    const clean = (entry: Record<string, unknown>) => Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined));
    const payload = {
      ...clean(values as unknown as Record<string, unknown>),
      // Salvar manualmente regulariza a propriedade legada; nunca reatribui outro workspace.
      workspaceId: WORKSPACE_ID,
      paymentMethods: values.paymentMethods.map((method) => clean(method as unknown as Record<string, unknown>)),
    };
    if (current) {
      await updateDoc(financialDoc("bankAccounts", current.id), payload);
    } else {
      await addDoc(financialCollection("bankAccounts"), { ...payload, createdBy: firebaseUser.uid, createdAt: Timestamp.now() });
    }
    await refresh();
  }

  async function remove(item: BankAccountRecord) {
    await deleteDoc(financialDoc("bankAccounts", item.id));
    await refresh();
  }

  const chips = [
    { id: "all", label: "Todas", count: summary.total },
    { id: "active", label: "Ativas", count: summary.active },
    { id: "inactive", label: "Inativas", count: summary.inactive },
  ];

  return (
    <div className="space-y-5">
      <CadastrosHero
        kicker="Contas bancárias"
        tabs={null}
        search={{ value: query, placeholder: "Buscar instituição, agência ou método", onChange: setQuery }}
        primary={canManage ? { label: "Nova conta", onClick: () => setPanel({ mode: "create" }) } : undefined}
        chips={chips}
        activeChip={statusFilter}
        onChip={setStatusFilter}
      />

      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="text-[28px] font-extrabold tracking-[-0.03em]">{rows.length}</span>
        <span className="text-[13px] text-ds-ink-faint">de {summary.total} contas · {summary.methods} formas de pagamento</span>
        <span className="text-[13px] text-ds-ink-muted">· Instituições, carteiras e métodos vinculados.</span>
      </div>

      {loadError ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-ds-card border border-ds-confirm-border bg-ds-confirm-bg px-5 py-4">
          <p className="text-[13px] font-semibold text-ds-confirm-ink">{loadError}</p>
          <Button type="button" variant="ds-secondary" size="md" onClick={() => void refresh()}>Tentar novamente</Button>
        </div>
      ) : null}

      {loading && !accounts ? (
        <div className="rounded-ds-card-lg border border-ds-border bg-ds-warm" role="status" aria-label="Carregando contas bancárias">
          <ListSkeleton rows={4} />
        </div>
      ) : (
        <ListShell minWidth={860}>
          <ListHead template={TEMPLATE}>
            <span>Instituição</span>
            <span>Vínculo padrão</span>
            <span>Formas de pagamento</span>
            <span>Situação</span>
            <span />
          </ListHead>
          {rows.map((account) => {
            const link = linkNameOf(account);
            const methods = account.paymentMethods ?? [];
            return (
              <ListRow
                key={account.id}
                template={TEMPLATE}
                isOpen={panel?.mode !== "create" && panel?.item.id === account.id}
                isSelected={false}
                isMuted={account.active === false}
                onOpen={() => setPanel({ mode: "view", item: account })}
                label={`Abrir ${account.name}`}
              >
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-bold">{account.name}</p>
                  <Mono className="text-[11px] text-ds-ink-faint">Ag. {account.agency || "—"} · Conta {account.accountNumber || "—"}</Mono>
                </div>
                <span className="truncate text-[13px]">{link ?? <SoftPill isEmpty>Compartilhada</SoftPill>}</span>
                <div className="flex min-w-0 flex-wrap gap-1.5">
                  {methods.slice(0, 3).map((method) => <SoftPill key={method.id}>{method.label}</SoftPill>)}
                  {methods.length > 3 ? <SoftPill>+{methods.length - 3}</SoftPill> : null}
                  {methods.length === 0 ? <SoftPill isEmpty>Sem métodos</SoftPill> : null}
                </div>
                <StatusPill variant={account.active === false ? "neutral" : "ok"}>{account.active === false ? "Inativa" : "Ativa"}</StatusPill>
                <Chevron />
              </ListRow>
            );
          })}
          {rows.length === 0 && !loadError ? (
            all.length === 0
              ? <p className="px-5 py-12 text-center text-sm text-ds-ink-muted">Nenhuma conta cadastrada.</p>
              : <EmptyResults title="Nenhuma conta encontrada com esses filtros." onClear={() => { setQuery(""); setStatusFilter("all"); }} />
          ) : null}
        </ListShell>
      )}

      <BankAccountPanel
        state={panel}
        linkOptions={linkOptions}
        linkLabel={linkLabel}
        linkLoading={kiosksLoading}
        linkNameOf={linkNameOf}
        canManage={canManage}
        onClose={() => setPanel(null)}
        onMode={setPanel}
        onSave={save}
        onRemove={remove}
      />
    </div>
  );
}

const NEW_METHOD = () => ({ id: crypto.randomUUID(), type: "pix" as const, label: "Novo método" });

function BankAccountPanel({
  state,
  linkOptions,
  linkLabel,
  linkLoading,
  linkNameOf,
  canManage,
  onClose,
  onMode,
  onSave,
  onRemove,
}: {
  state: PanelState | null;
  linkOptions: Array<{ id: string; name: string }>;
  linkLabel: string;
  linkLoading: boolean;
  linkNameOf: (account: BankAccountRecord) => string | null;
  canManage: boolean;
  onClose: () => void;
  onMode: (state: PanelState) => void;
  onSave: (values: BankAccountFormValues, current: BankAccountRecord | null) => Promise<void>;
  onRemove: (item: BankAccountRecord) => Promise<void>;
}) {
  const form = useForm<BankAccountFormValues>({
    resolver: zodResolver(bankAccountSchema),
    defaultValues: { name: "", agency: "", accountNumber: "", active: true, resultCenterId: undefined, paymentMethods: [] },
  });
  const { register, control, handleSubmit, reset, watch, formState: { errors, isSubmitting } } = form;
  const { fields, append, remove } = useFieldArray({ control, name: "paymentMethods" });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const item = state && state.mode !== "create" ? state.item : null;
  const editing = state?.mode === "edit" || state?.mode === "create";

  useEffect(() => {
    setSaveError(null);
    setConfirmingDelete(false);
    if (!state || state.mode === "view") return;
    if (state.mode === "edit") {
      reset({
        name: state.item.name,
        agency: state.item.agency || "",
        accountNumber: state.item.accountNumber || "",
        active: state.item.active ?? true,
        resultCenterId: state.item.resultCenterId || state.item.unitId || undefined,
        paymentMethods: (state.item.paymentMethods ?? []) as BankAccountFormValues["paymentMethods"],
      });
    } else {
      reset({ name: "", agency: "", accountNumber: "", active: true, resultCenterId: undefined, paymentMethods: [{ id: crypto.randomUUID(), type: "pix", label: "PIX principal" }] });
    }
  }, [state, reset]);

  const paymentMethodsError = (errors.paymentMethods as { message?: string; root?: { message?: string } } | undefined);

  return (
    <SidePanel
      open={!!state}
      onOpenChange={(open) => { if (!open) onClose(); }}
      kicker={state?.mode === "create" ? "Nova conta" : state?.mode === "edit" ? "Editar conta" : "Conta bancária"}
      title={state?.mode === "create" ? "Sem instituição" : item?.name ?? ""}
      subtitle="Instituição, vínculo padrão e formas de pagamento aceitas."
      className="w-[520px]"
    >
      {state && !editing && item ? (
        <>
          <PanelSection title="Dados">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
              <PanelField label="Situação"><StatusPill variant={item.active === false ? "neutral" : "ok"}>{item.active === false ? "Inativa" : "Ativa"}</StatusPill></PanelField>
              <PanelField label={linkLabel}>{linkNameOf(item) ?? "Conta compartilhada"}</PanelField>
              <PanelField label="Agência"><Mono>{item.agency || "—"}</Mono></PanelField>
              <PanelField label="Conta"><Mono>{item.accountNumber || "—"}</Mono></PanelField>
            </div>
          </PanelSection>
          <PanelSection title="Formas de pagamento" aside={item.paymentMethods?.length ?? 0}>
            {item.paymentMethods?.length ? (
              <ul className="space-y-2.5">
                {item.paymentMethods.map((method) => {
                  const cycle = describeCardCycle(method);
                  return (
                    <li key={method.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="text-[13px] font-bold">{method.label}</span>
                      <span className="text-xs text-ds-ink-muted">
                        {PAYMENT_TYPE_LABELS[method.type] ?? method.type}
                        {method.lastDigits ? ` · final ${method.lastDigits}` : ""}
                        {cycle ? ` · ${cycle}` : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[13px] text-ds-ink-muted">Nenhuma forma de pagamento cadastrada.</p>
            )}
          </PanelSection>
          {canManage ? (
            <div className="mt-auto space-y-3 border-t border-ds-divider pt-4">
              {confirmingDelete ? (
                <InlineConfirm
                  message={`Excluir a conta “${item.name}” do módulo financeiro?`}
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
                      setSaveError(errorMessageOf(error, "Não foi possível excluir a conta."));
                    } finally {
                      setDeleting(false);
                    }
                  }}
                />
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" variant="primary-modal" size="md" onClick={() => onMode({ mode: "edit", item })}>Editar conta</Button>
                  <Button type="button" variant="danger-link" size="md" onClick={() => setConfirmingDelete(true)}>Excluir conta</Button>
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
              setSaveError(errorMessageOf(error, "Não foi possível salvar a conta."));
            }
          })}
        >
          <Field label="Instituição" htmlFor="bank-name" error={errors.name?.message}>
            <Controller control={control} name="name" render={({ field }) => (
              <BankCombobox id="bank-name" value={field.value} onChange={field.onChange} invalid={!!errors.name} />
            )} />
          </Field>
          <Controller control={control} name="resultCenterId" render={({ field }) => (
            <PanelSelectField
              id="bank-link"
              label={linkLabel}
              requirement="opcional"
              value={field.value}
              onChange={(value) => field.onChange(value || undefined)}
              noneLabel="Nenhuma (conta compartilhada)"
              options={linkOptions}
              hint={linkLoading ? "Carregando vínculos…" : "Deixe sem vínculo para contas compartilhadas ou sem centro padrão."}
            />
          )} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Agência" htmlFor="bank-agency" requirement="opcional">
              <Input id="bank-agency" placeholder="0001" className={fieldInputClass} {...register("agency")} />
            </Field>
            <Field label="Número da conta" htmlFor="bank-number" requirement="opcional">
              <Input id="bank-number" placeholder="12345-6" className={fieldInputClass} {...register("accountNumber")} />
            </Field>
          </div>
          <Controller control={control} name="active" render={({ field }) => (
            <PanelSwitchRow id="bank-active" label="Conta ativa" description="Contas inativas não aparecem para novos lançamentos." checked={field.value} onChange={field.onChange} />
          )} />

          <PanelSection
            title="Formas de pagamento"
            aside={
              <button type="button" onClick={() => append(NEW_METHOD())} className="font-bold text-ds-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink">
                + Adicionar
              </button>
            }
          >
            {fields.length === 0 ? <p className="text-[13px] text-ds-ink-muted">Adicione pelo menos uma forma de pagamento.</p> : null}
            {fields.map((field, index) => {
              const type = watch(`paymentMethods.${index}.type`);
              const itemErrors = errors.paymentMethods?.[index];
              return (
                <div key={field.id} className="space-y-3.5 rounded-ds-btn border border-dashed border-ds-border-input p-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Rótulo" htmlFor={`pm-label-${index}`} error={itemErrors?.label?.message}>
                      <Input id={`pm-label-${index}`} placeholder="Ex.: PIX principal" aria-invalid={!!itemErrors?.label} className={fieldInputClass} {...register(`paymentMethods.${index}.label`)} />
                    </Field>
                    <Controller control={control} name={`paymentMethods.${index}.type`} render={({ field: typeField }) => (
                      <PanelSelectField id={`pm-type-${index}`} label="Tipo" value={typeField.value} onChange={typeField.onChange} options={Object.entries(PAYMENT_TYPE_LABELS).map(([id, name]) => ({ id, name }))} />
                    )} />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="Últimos dígitos" htmlFor={`pm-digits-${index}`} error={itemErrors?.lastDigits?.message}>
                      <Input id={`pm-digits-${index}`} placeholder="1234" maxLength={4} className={fieldInputClass} {...register(`paymentMethods.${index}.lastDigits`)} />
                    </Field>
                    <Field label="Chave PIX" htmlFor={`pm-pix-${index}`}>
                      <Input id={`pm-pix-${index}`} placeholder="Chave PIX" className={fieldInputClass} {...register(`paymentMethods.${index}.pixKey`)} />
                    </Field>
                    <Field label="Limite" htmlFor={`pm-limit-${index}`}>
                      <Controller control={control} name={`paymentMethods.${index}.limit`} render={({ field: limitField }) => (
                        <CurrencyInput id={`pm-limit-${index}`} value={limitField.value ?? 0} onChange={limitField.onChange} className={fieldInputClass} />
                      )} />
                    </Field>
                  </div>
                  {type === "credit_card" ? (
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Dia de fechamento" htmlFor={`pm-closing-${index}`} hint="Compras até este dia entram na fatura do mês." error={itemErrors?.closingDay?.message as string | undefined}>
                        <Input id={`pm-closing-${index}`} type="number" min="1" max="31" placeholder="Ex.: 20" className={fieldInputClass} {...register(`paymentMethods.${index}.closingDay`)} />
                      </Field>
                      <Field label="Dia de vencimento" htmlFor={`pm-due-${index}`} hint="Usado para prever o pagamento da fatura." error={itemErrors?.dueDay?.message as string | undefined}>
                        <Input id={`pm-due-${index}`} type="number" min="1" max="31" placeholder="Ex.: 10" className={fieldInputClass} {...register(`paymentMethods.${index}.dueDay`)} />
                      </Field>
                    </div>
                  ) : null}
                  <div className="flex justify-end">
                    <Button type="button" variant="danger-link" size="xs" onClick={() => remove(index)}>Remover método</Button>
                  </div>
                </div>
              );
            })}
            {paymentMethodsError?.message || paymentMethodsError?.root?.message ? (
              <p role="alert" className="text-xs font-semibold text-ds-danger">{paymentMethodsError.message ?? paymentMethodsError.root?.message}</p>
            ) : null}
          </PanelSection>

          <PanelErrorNote message={saveError} />
          <PanelFormFooter submitting={isSubmitting} creating={state.mode === "create"} noun="conta" onCancel={() => (item ? onMode({ mode: "view", item }) : onClose())} />
        </form>
      ) : null}
    </SidePanel>
  );
}
