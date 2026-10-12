"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { resolveUnitAccess } from "@/lib/unit-access";
import { createBudgetSchema, createBudgetRuleSchema } from "@/features/financial/budgets/schemas";
import { budgetRequest as request, validateBudgetPeople } from "./budget-api";
import { BudgetCompositionEditor } from "./budget-composition-editor";
import { BudgetDetails } from "./budget-details";
import { BudgetForecastConversion } from "./budget-forecast-conversion";
import { allowedBudgetCenters, budgetScopeQuery, compositionTotal, manualComposition, ruleComposition, type BudgetCenterOption, type BudgetLineDraft } from "./budget-ui-model";
import { financialDateKey } from "@/features/financial/lib/financial-dates";
import type { FinancialBudgetRule, FinancialBudgetSummary } from "@/features/financial/budgets/types";
import { formatCurrency } from "@/features/financial/lib/utils";
import { ControlPanel } from "@/components/patterns/control-panel";
import { Field, fieldInputClass } from "@/components/patterns/field";
import { StatTile } from "@/components/patterns/stat-tile";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { StatusPill } from "@/components/ui/status-pill";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import BudgetProjectsManagement from "./budget-projects-management";
import { budgetRuleModeLabel, summarizeBudgets, usagePercent } from "./settings-model";

type AccountOption = { id: string; name: string; active?: boolean; isGroup?: boolean; parentId?: string | null };
type InputOption = { id: string; name: string; unit: string };
type Mode = "manual" | "fixed" | "expense_previous" | "expense_average" | "consumption_price";
const todayMonth = () => financialDateKey(new Date())!.slice(0, 7);

export default function BudgetsManagement({ canManage }: { canManage: boolean }) {
  /* Resultado e falha aparecem em texto fixo na tela, não em toast (docs/design/feedback.md). */
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; title: string; description?: string } | null>(null);
  const toast = ({ variant, title, description }: { variant?: "destructive"; title: string; description?: string }) =>
    setNotice({ kind: variant === "destructive" ? "error" : "ok", title, description });
  const { user, permissions, isDefaultAdmin } = useAuth();
  const canViewPersonnel = isDefaultAdmin || Boolean(permissions.financial?.view && permissions.financial.personnelCosts?.view);
  const canEditPersonnel = canManage && (isDefaultAdmin || Boolean(canViewPersonnel && permissions.financial?.settings?.view && permissions.financial?.personnelCosts?.edit));
  const allUnits = Boolean(user && resolveUnitAccess(user, { isDefaultAdmin }).allUnits);
  const [centers, setCenters] = useState<BudgetCenterOption[]>([]);
  const [resultCenterId, setResultCenterId] = useState("");
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const visibleCenters = useMemo(() => user ? allowedBudgetCenters(centers, user, isDefaultAdmin) : [], [centers, user, isDefaultAdmin]);
  const scopeAllowed = Boolean(user && (resultCenterId ? visibleCenters.some((center) => center.id === resultCenterId) : allUnits));
  const scopeQuery = budgetScopeQuery(resultCenterId);
  const [showInactiveRules, setShowInactiveRules] = useState(false);
  const [composed, setComposed] = useState(false);
  const [composition, setComposition] = useState<BudgetLineDraft[]>([]);
  const [endMonth, setEndMonth] = useState("");
  const [generationLeadMonths, setGenerationLeadMonths] = useState<0 | 1>(0);
  const requestVersion = useRef(0);
  const [month, setMonth] = useState(todayMonth);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [inputs, setInputs] = useState<InputOption[]>([]);
  const [selectedInputs, setSelectedInputs] = useState<string[]>([]);
  const [closingStockDays, setClosingStockDays] = useState("7");
  const [budgets, setBudgets] = useState<FinancialBudgetSummary[]>([]);
  const [rules, setRules] = useState<FinancialBudgetRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>("manual");
  const [amount, setAmount] = useState("");
  const [averageMonths, setAverageMonths] = useState("3");
  const [preview, setPreview] = useState<{ amountCents: number; snapshot: { referenceMonths: string[]; referenceAmountsCents: number[];
    committedAmountCents?: number; inputEstimates?: Array<{ baseProductId: string; name: string; unit: string; forecastQuantity: number;
      openingStockQuantity: number; inboundQuantity: number; additionalPurchaseQuantity: number; averagePriceCentsPerUnit: number;
      additionalPurchaseAmountCents: number }> } } | null>(null);
  const [loadedScope, setLoadedScope] = useState("");
  const currentScope = `${month}:${resultCenterId}:${showInactiveRules}:${canViewPersonnel}`;

  useEffect(() => {
    let active = true;
    void Promise.all([
      request<{ docs: AccountOption[] }>("/api/financial/data?path=accounts"),
      request<{ docs: BudgetCenterOption[] }>("/api/financial/data?path=resultCenters"),
    ]).then(([accountResult, centerResult]) => {
      if (active) { setAccounts(accountResult.docs); setCenters(centerResult.docs); setCatalogError(null); }
    }).catch((cause) => { if (active) setCatalogError(cause instanceof Error ? cause.message : "Falha ao carregar os cadastros."); });
    return () => { active = false; };
  }, []);

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    if (!scopeAllowed || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) { setBudgets([]); setRules([]); setLoading(false); return; }
    setLoading(true);
    try {
      const [budgetResult, ruleResult] = await Promise.all([
        request<{ budgets: FinancialBudgetSummary[] }>(`/api/financial/budgets?month=${month}${scopeQuery}`),
        request<{ rules: FinancialBudgetRule[] }>(`/api/financial/budget-rules?active=${!showInactiveRules}${scopeQuery}`),
      ]);
      if (version !== requestVersion.current) return;
      setBudgets(budgetResult.budgets);
      setRules(ruleResult.rules);
      setLoadedScope(currentScope);
      setError(null);
    } catch (cause) {
      if (version === requestVersion.current) { setBudgets([]); setRules([]); setError(cause instanceof Error ? cause.message : "Falha ao carregar orçamentos."); }
    } finally { if (version === requestVersion.current) setLoading(false); }
  }, [month, scopeQuery, scopeAllowed, showInactiveRules, currentScope]);

  useEffect(() => { void refresh(); return () => { requestVersion.current += 1; }; }, [refresh]);
  useEffect(() => { setPreview(null); }, [mode, amount, averageMonths, selectedAccounts, selectedInputs, closingStockDays, month, resultCenterId, composed, composition, endMonth, generationLeadMonths]);
  useEffect(() => {
    if (mode !== "consumption_price" || inputs.length) return;
    void request<{ inputs: InputOption[] }>("/api/financial/budget-inputs")
      .then((result) => setInputs(result.inputs))
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Não foi possível carregar os insumos."));
  }, [mode, inputs.length]);

  const postingAccounts = useMemo(() => {
    const parentIds = new Set(accounts.map((account) => account.parentId).filter(Boolean));
    return accounts.filter((account) => account.active !== false && !account.isGroup && !parentIds.has(account.id))
      .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
  }, [accounts]);
  const accountNames = useMemo(() => new Map(accounts.map((account) => [account.id, account.name])), [accounts]);
  const selectedRule = { name, accountPlanIds: selectedAccounts, mode: mode === "manual" ? "fixed" : mode,
    fixedAmountCents: mode === "fixed" ? (composed ? compositionTotal(composition) : Math.round(Number(amount) * 100)) : null,
    averageMonths: Number(averageMonths), startMonth: month,
    resultCenterId: resultCenterId || null, endMonth: endMonth || null, generationLeadMonths,
    ...(composed ? { composition: ruleComposition(composition) } : {}),
    baseProductIds: mode === "consumption_price" ? selectedInputs : [],
    stockKioskId: mode === "consumption_price" ? "matriz" : null,
    closingStockDays: Number(closingStockDays) };

  function resetForm() {
    setName(""); setSelectedAccounts([]); setSelectedInputs([]); setMode("manual"); setAmount(""); setAverageMonths("3"); setClosingStockDays("7"); setPreview(null);
    setComposition([]); setComposed(false); setEndMonth(""); setGenerationLeadMonths(0);
    setFormOpen(false);
  }

  async function showPreview() {
    if (!name.trim() || !selectedAccounts.length) {
      toast({ variant: "destructive", title: "Informe um nome e escolha pelo menos uma conta." }); return;
    }
    if (mode === "fixed" && !composed && (!Number.isFinite(Number(amount)) || amount.trim() === "" || Number(amount) < 0)) {
      toast({ variant: "destructive", title: "Informe o valor mensal." }); return;
    }
    if (mode === "consumption_price" && selectedInputs.length === 0) {
      toast({ variant: "destructive", title: "Escolha os insumos para calcular a previsão." }); return;
    }
    setSaving(true);
    try {
      const parsed = createBudgetRuleSchema.safeParse(selectedRule);
      if (!scopeAllowed || (composed && !canEditPersonnel) || !parsed.success) throw new Error("Confira o centro, as contas, a composição e o período da regra.");
      if (composed) await validateBudgetPeople(composition.map((line) => line.employeeId), month, resultCenterId);
      setPreview(await request<typeof preview>("/api/financial/budget-rules/preview", "POST", { rule: parsed.data, month }) as NonNullable<typeof preview>);
    } catch (cause) {
      toast({ variant: "destructive", title: cause instanceof Error ? cause.message : "Não foi possível calcular a prévia." });
    } finally { setSaving(false); }
  }

  async function save() {
    if (!name.trim() || selectedAccounts.length === 0) {
      toast({ variant: "destructive", title: "Informe um nome e escolha as contas." }); return;
    }
    if (mode === "manual" && !composed && (!Number.isFinite(Number(amount)) || Number(amount) < 0 || amount.trim() === "")) {
      toast({ variant: "destructive", title: "Informe o valor do orçamento." }); return;
    }
    if (mode !== "manual" && !preview) {
      toast({ variant: "destructive", title: "Calcule a prévia antes de salvar a regra." }); return;
    }
    setSaving(true);
    try {
      if (!scopeAllowed || (composed && !canEditPersonnel)) throw new Error("Selecione um centro autorizado e confira sua permissão de edição.");
      if (mode === "manual") {
        const parsed = createBudgetSchema.safeParse({
          name, accountPlanIds: selectedAccounts, competenceMonth: month, resultCenterId: resultCenterId || null,
          budgetedAmountCents: composed ? compositionTotal(composition) : Math.round(Number(amount) * 100),
          ...(composed ? { composition: manualComposition(composition) } : {}),
        });
        if (!parsed.success) throw new Error("Confira o nome, as contas, as pessoas, os valores e as datas da composição.");
        if (composed) await validateBudgetPeople(composition.map((line) => line.employeeId), month, resultCenterId);
        await request("/api/financial/budgets", "POST", parsed.data);
      } else {
        const parsed = createBudgetRuleSchema.safeParse(selectedRule);
        if (!parsed.success) throw new Error("Confira a regra antes de salvar.");
        const created = await request<{ id: string }>("/api/financial/budget-rules", "POST", parsed.data);
        resetForm();
        const generated = await request<{ results: Array<{ ruleId: string; created: boolean; skipped?: string }> }>(
          `/api/financial/budget-rules/generate${resultCenterId ? `?resultCenterId=${encodeURIComponent(resultCenterId)}` : ""}`, "POST", { month });
        const initial = generated.results.find((result) => result.ruleId === created.id);
        if (!initial?.created) {
          toast({ variant: "destructive", title: "Regra salva, mas o orçamento inicial não foi criado.",
            description: initial?.skipped ?? "Confira o mês inicial e tente gerar novamente." });
          await refresh();
          return;
        }
      }
      toast({ title: mode === "manual" ? "Orçamento criado." : "Regra salva e mês inicial gerado." });
      resetForm();
      await refresh();
    } catch (cause) {
      toast({ variant: "destructive", title: cause instanceof Error ? cause.message : "Não foi possível salvar." });
    } finally { setSaving(false); }
  }

  async function toggleBudget(budget: FinancialBudgetSummary) {
    if (saving || !canManage || ((budget.hasComposition || budget.composition?.length) && !canEditPersonnel)) return;
    setSaving(true);
    try {
      await request(`/api/financial/budgets/${encodeURIComponent(budget.id)}`, "PATCH", { active: !budget.active });
      await refresh();
    } catch (cause) { toast({ variant: "destructive", title: cause instanceof Error ? cause.message : "Não foi possível alterar o orçamento." }); }
    finally { setSaving(false); }
  }

  async function toggleRule(rule: FinancialBudgetRule) {
    if (saving || !canManage || ((rule.hasComposition || rule.composition?.length) && !canEditPersonnel)) return;
    setSaving(true);
    try {
      await request(`/api/financial/budget-rules/${encodeURIComponent(rule.id)}`, "PATCH", { active: !rule.active });
      await refresh();
    } catch (cause) { toast({ variant: "destructive", title: cause instanceof Error ? cause.message : "Não foi possível alterar a regra." }); }
    finally { setSaving(false); }
  }

  async function generateMonth() {
    if (!scopeAllowed || saving || !canManage) return;
    setSaving(true);
    try {
      const generated = await request<{ results: Array<{ created: boolean; skipped?: string }> }>(
        `/api/financial/budget-rules/generate${resultCenterId ? `?resultCenterId=${encodeURIComponent(resultCenterId)}` : ""}`, "POST", { month });
      toast({ title: `${generated.results.filter((result) => result.created).length} orçamento(s) gerado(s).`,
        description: generated.results.map((result) => result.skipped).filter(Boolean).join(" ") || "Snapshots já existentes foram preservados." });
      await refresh();
    } catch (cause) { toast({ variant: "destructive", title: cause instanceof Error ? cause.message : "Não foi possível gerar a competência." }); }
    finally { setSaving(false); }
  }

  const totals = summarizeBudgets(budgets);
  const visibleBudgets = !loading && budgets.length > 0 && loadedScope === currentScope && scopeAllowed;
  const MODE_OPTIONS = [
    ["manual", "Manual", "Defina somente este mês."],
    ["fixed", "Automático fixo", "Repita o valor informado nos meses seguintes."],
    ["expense_previous", "Mês anterior", "Use os gastos do último mês fechado."],
    ["expense_average", "Média de meses", "Use a média de meses fechados."],
    ["consumption_price", "Consumo e preços", "Estime a compra pelos insumos, estoque e preços médios."],
  ] as const;
  const darkField = "h-12 rounded-ds-btn-lg border border-white/10 bg-white/[0.07] px-4 text-[14px] font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-kicker";
  const checkItem = "flex cursor-pointer items-start gap-2.5 rounded-ds-btn bg-white px-2.5 py-2 text-[13px] font-semibold";

  return <div className="space-y-5">
    <ControlPanel className="flex flex-col gap-[18px] px-[26px] pb-5 pt-[22px]">
      <span className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-kicker">Orçamentos</span>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[260px] flex-1 space-y-1.5">
          <label htmlFor="budget-center" className="block text-xs font-bold text-ds-on-dark-sub">Escopo do cadastro e da consulta</label>
          <Select disabled={saving} value={resultCenterId || (allUnits ? "global" : "")} onValueChange={(value) => { setResultCenterId(value === "global" ? "" : value); resetForm(); }}>
            <SelectTrigger id="budget-center" className={cn(darkField, "w-full")}><SelectValue placeholder="Selecione um centro de custo autorizado" /></SelectTrigger>
            <SelectContent>
              {allUnits && <SelectItem value="global">Global · todas as unidades</SelectItem>}
              {visibleCenters.map((center) => <SelectItem key={center.id} value={center.id}>{center.name}{center.active === false ? " · inativo" : ""}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="budget-list-month" className="block text-xs font-bold text-ds-on-dark-sub">Competência</label>
          <input id="budget-list-month" disabled={saving} aria-label="Mês dos orçamentos" type="month" value={month} onChange={(event) => setMonth(event.target.value)} className={cn(darkField, "w-44 [color-scheme:dark]")} />
        </div>
        <Button type="button" variant="on-dark-secondary" size="xl" disabled={saving || loading || !scopeAllowed} onClick={() => void refresh()}>Atualizar</Button>
        {canManage && <Button type="button" variant="primary-page" size="xl" disabled={saving || !scopeAllowed} onClick={() => setFormOpen(!formOpen)} className="whitespace-nowrap">{formOpen ? "Fechar cadastro" : "+ Novo orçamento"}</Button>}
      </div>
      <p className="text-xs text-ds-on-dark-muted">O centro usa o cadastro de centros de resultado e suas unidades. No escopo global, a consulta reúne todos os centros e novos envelopes são globais. Trocar o escopo reinicia o cadastro.</p>
    </ControlPanel>

    {!scopeAllowed && <p role="status" className="text-sm text-ds-ink-muted">Selecione um centro permitido para consultar ou cadastrar orçamentos.</p>}
    {catalogError && <p role="alert" className="rounded-ds-btn border border-ds-confirm-border bg-ds-confirm-bg px-3.5 py-3 text-[12.5px] font-semibold text-ds-confirm-ink">{catalogError}</p>}
    {notice && <div role={notice.kind === "error" ? "alert" : "status"} className={cn("flex items-start justify-between gap-3 rounded-ds-btn border px-3.5 py-3 text-[12.5px] font-semibold",
      notice.kind === "error" ? "border-ds-confirm-border bg-ds-confirm-bg text-ds-confirm-ink" : "border-ds-border bg-ds-surface text-ds-ink-2")}>
      <span>{notice.title}{notice.description ? <span className="block font-normal">{notice.description}</span> : null}</span>
      <button type="button" onClick={() => setNotice(null)} className="shrink-0 font-bold underline-offset-2 hover:underline">Dispensar</button>
    </div>}

    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatTile label="Previsto" value={<span className="font-ds-mono text-[24px]">{formatCurrency(totals.budgetedCents / 100)}</span>} hint={`${totals.activeCount} de ${totals.count} orçamentos ativos`} />
      <StatTile label="Comprometido" value={<span className="font-ds-mono text-[24px]">{formatCurrency(totals.consumedCents / 100)}</span>} hint="Despesas abertas e pagas" />
      <StatTile label="Saldo orçamentário" value={<span className={cn("font-ds-mono text-[24px]", totals.balanceCents < 0 && "text-ds-danger")}>{formatCurrency(totals.balanceCents / 100)}</span>} hint="Previsto menos comprometido" />
      <StatTile label="Regras automáticas" value={rules.length} hint={showInactiveRules ? "Incluindo inativas" : "Ativas neste escopo"} />
    </div>

    {formOpen && canManage && scopeAllowed && <section className="rounded-ds-card-lg border border-ds-border bg-ds-surface p-6" aria-label="Novo orçamento"><fieldset disabled={saving} className="space-y-6">
      <header><h2 className="text-lg font-extrabold">Novo orçamento por categoria</h2>
        <p className="text-[13px] text-ds-ink-muted">Acompanhe um conjunto de compras e despesas. Cada despesa das contas escolhidas reduz o valor disponível do mês.</p></header>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="1. Qual grupo de gastos deseja acompanhar?" htmlFor="budget-name" hint="Use um nome que ajude a reconhecer a finalidade do orçamento.">
          <Input id="budget-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Insumos da sorveteria" className={fieldInputClass} /></Field>
        <Field label="Competência inicial" htmlFor="budget-month" hint="As despesas serão comparadas pela competência contábil deste mês.">
          <Input id="budget-month" type="month" value={month} onChange={(event) => setMonth(event.target.value)} className={fieldInputClass} /></Field>
      </div>
      <Field label="2. Quais contas entram nesse orçamento?" hint="Uma conta pode ter orçamentos em centros distintos no mesmo mês. Um envelope global não pode se sobrepor aos locais. Despesas com rateio entram apenas pela parcela elegível.">
        <div className="grid max-h-48 gap-2 overflow-y-auto rounded-ds-btn-lg border border-ds-border bg-ds-warm p-3 sm:grid-cols-2 lg:grid-cols-3">
          {postingAccounts.map((account) => <label key={account.id} className={checkItem}>
            <Checkbox checked={selectedAccounts.includes(account.id)} onCheckedChange={(checked) => setSelectedAccounts(checked
              ? [...selectedAccounts, account.id] : selectedAccounts.filter((id) => id !== account.id))} />
            <span>{account.name}</span></label>)}
        </div>
      </Field>
      {canEditPersonnel && <label className="flex items-start gap-2.5 text-[13px] font-semibold"><Checkbox disabled={saving || !resultCenterId} checked={composed} onCheckedChange={(value) => { setComposed(value === true); if (value === true && mode !== "manual" && mode !== "fixed") setMode("manual"); }} />
        <span>Detalhar por colaborador (opcional; selecione um centro de custo). O total será a soma da composição.</span></label>}
      <div className="space-y-3"><p className="text-xs font-bold text-ds-ink-2">3. Como o valor será definido?</p>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {MODE_OPTIONS.map(([value, title, detail]) => <button key={value} type="button" disabled={saving || (composed && value !== "manual" && value !== "fixed") || (Boolean(resultCenterId) && value === "consumption_price")} onClick={() => setMode(value)}
            aria-pressed={mode === value}
            className={cn("rounded-ds-btn-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink disabled:opacity-50",
              mode === value ? "border-ds-modal bg-ds-modal-soft" : "border-ds-border bg-white hover:bg-ds-warm")}>
            <span className="block text-[13px] font-bold">{title}</span><span className="mt-1 block text-xs text-ds-ink-muted">{detail}</span>
          </button>)}
        </div>
        {(mode === "manual" || mode === "fixed") && !composed && <div className="max-w-xs"><Field label={mode === "manual" ? "Valor orçado (R$)" : "Valor mensal (R$)"} htmlFor="budget-amount">
          <CurrencyInput id="budget-amount" value={amount === "" ? "" : Number(amount)} onChange={(value) => setAmount(String(value))} className={fieldInputClass} /></Field></div>}
        {(mode === "expense_average" || mode === "consumption_price") && <div className="max-w-xs"><Field label="Média dos últimos meses fechados" htmlFor="budget-average">
          <Select value={averageMonths} onValueChange={setAverageMonths}><SelectTrigger id="budget-average" className={fieldInputClass}><SelectValue /></SelectTrigger><SelectContent>
            {[2, 3, 4, 6, 12].map((count) => <SelectItem key={count} value={String(count)}>{count} meses</SelectItem>)}
          </SelectContent></Select></Field></div>}
        {mode === "consumption_price" && <div className="space-y-3 rounded-ds-btn-lg border border-ds-border bg-ds-warm p-4">
          <p className="text-[13px] font-bold">Quais insumos compõem o grupo?</p>
          <p className="text-xs text-ds-ink-muted">O cálculo usa o consumo registrado nas unidades, o estoque da matriz e os preços efetivos das compras. Se faltar informação, a prévia aponta o que revisar.</p>
          <div className="grid max-h-48 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
            {inputs.map((item) => <label key={item.id} className={checkItem}>
              <Checkbox checked={selectedInputs.includes(item.id)} onCheckedChange={(checked) => setSelectedInputs(checked
                ? [...selectedInputs, item.id] : selectedInputs.filter((id) => id !== item.id))} />
              <span>{item.name} <span className="text-xs font-normal text-ds-ink-muted">({item.unit})</span></span>
            </label>)}
          </div>
          <div className="max-w-xs"><Field label="Estoque desejado após o mês (dias de consumo)" htmlFor="budget-stock-days" hint="Ex.: 7 significa terminar o mês com estoque para aproximadamente sete dias.">
            <Input id="budget-stock-days" type="number" min="0" max="60" step="1" value={closingStockDays} onChange={(event) => setClosingStockDays(event.target.value)} className={fieldInputClass} /></Field></div>
        </div>}
        {composed && canEditPersonnel && resultCenterId && <BudgetCompositionEditor key={resultCenterId} lines={composition} onChange={setComposition} resultCenterId={resultCenterId}
          accounts={postingAccounts.filter((account) => selectedAccounts.includes(account.id))} month={month} centerName={visibleCenters.find((center) => center.id === resultCenterId)?.name ?? "Centro selecionado"} repeating={mode === "fixed"} disabled={saving} />}
        {mode !== "manual" && <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Última competência (opcional)" htmlFor="budget-end-month" hint="Sem fim definido, a regra se repete até ser pausada.">
            <Input id="budget-end-month" type="month" min={month} value={endMonth} onChange={(event) => setEndMonth(event.target.value)} className={fieldInputClass} /></Field>
          <Field label="Antecedência da geração automática" htmlFor="budget-lead" hint="A antecedência gera o planejamento; a data da compra continua definida nas linhas.">
            <Select disabled={saving} value={String(generationLeadMonths)} onValueChange={(value) => setGenerationLeadMonths(value === "1" ? 1 : 0)}><SelectTrigger id="budget-lead" className={fieldInputClass}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="0">0 · somente competência corrente</SelectItem><SelectItem value="1">1 · incluir competência seguinte</SelectItem></SelectContent></Select></Field>
        </div>}
        {mode !== "manual" && <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="ds-secondary" size="md" onClick={showPreview} disabled={saving}>Calcular prévia</Button>
          {preview && <p className="text-[13px]">Valor sugerido para {month}: <strong className="font-ds-mono">{formatCurrency(preview.amountCents / 100)}</strong>
            {preview.snapshot.referenceMonths.length > 0 && <span className="ml-1 text-ds-ink-muted">com base em {preview.snapshot.referenceMonths.join(", ")}</span>}</p>}
        </div>}
        {mode === "consumption_price" && preview?.snapshot.inputEstimates && <div className="space-y-2 rounded-ds-btn-lg border border-ds-border bg-ds-warm p-4 text-[13px]">
          <p className="font-bold">Como chegamos ao valor</p>
          {preview.snapshot.inputEstimates.map((item) => <div key={item.baseProductId} className="grid gap-1 border-t border-ds-divider pt-2 sm:grid-cols-[minmax(0,1fr)_110px_120px]">
            <span>{item.name} <span className="text-ds-ink-muted">({item.unit})</span></span>
            <span>{item.additionalPurchaseQuantity.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} a comprar</span>
            <strong className="font-ds-mono">{formatCurrency(item.additionalPurchaseAmountCents / 100)}</strong>
            <span className="text-xs text-ds-ink-muted sm:col-span-3">Consumo previsto {item.forecastQuantity.toFixed(2)} · estoque projetado {item.openingStockQuantity.toFixed(2)} · pedidos confirmados {item.inboundQuantity.toFixed(2)} · preço médio {formatCurrency(item.averagePriceCentsPerUnit / 100)}/{item.unit}</span>
          </div>)}
          <p className="border-t border-ds-divider pt-2 text-xs text-ds-ink-muted">Compras já lançadas neste mês: {formatCurrency((preview.snapshot.committedAmountCents ?? 0) / 100)}. Elas fazem parte do total e não são descontadas novamente.</p>
        </div>}
      </div>
      <div className="rounded-ds-btn-lg border border-ds-border bg-ds-warm p-4 text-[13px]" aria-live="polite"><p className="font-bold">Conferência antes de salvar</p>
        <p>{name || "Informe a finalidade"} · {visibleCenters.find((center) => center.id === resultCenterId)?.name ?? "Global"} · competência {month}</p>
        <p>{selectedAccounts.map((id) => accountNames.get(id)).filter(Boolean).join(" · ") || "Selecione as contas"}</p>
        <p>{composed ? `${composition.length} linhas · ` : ""}Total: <span className="font-ds-mono">{formatCurrency((composed ? compositionTotal(composition) : mode === "manual" ? Math.round(Number(amount) * 100) : preview?.amountCents ?? 0) / 100)}</span></p>
        <p>{mode === "manual" ? "Somente este mês, com estimativa manual." : `Repetir desde ${month}${endMonth ? ` até ${endMonth}` : ", até pausar"}. Geração com ${generationLeadMonths} mês de antecedência.`}</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-ds-btn-lg border border-ds-border bg-ds-info-bg px-4 py-3 text-[13px] text-ds-info">
        <span>A criação do orçamento não lança despesas nem agenda pagamentos. Ela define um limite para acompanhar os gastos.</span>
        <Button type="button" variant="primary-modal" size="md" loading={saving} onClick={save} disabled={composed && (!composition.length || !canEditPersonnel) || (mode !== "manual" && !preview)}>{mode === "manual" ? "Criar orçamento" : "Salvar regra e gerar mês"}</Button>
      </div>
    </fieldset></section>}

    <section aria-label="Orçamentos do mês" className="space-y-3">
      <header><h2 className="text-lg font-extrabold">Orçamentos do mês</h2>
        <p className="text-[13px] text-ds-ink-muted">O comprometido inclui despesas abertas e pagas; pagar não desconta uma segunda vez.</p></header>
      {error && <p role="alert" className="rounded-ds-btn border border-ds-confirm-border bg-ds-confirm-bg px-3.5 py-3 text-[12.5px] font-semibold text-ds-confirm-ink">{error}</p>}
      {loading ? <div role="status" aria-label="Carregando orçamentos" className="space-y-2">{[0, 1, 2].map((row) => <div key={row} className="h-24 animate-pulse rounded-ds-card bg-ds-muted" />)}</div>
        : !visibleBudgets
          ? <p className="rounded-ds-card-lg border border-dashed border-ds-border-input p-8 text-center text-sm text-ds-ink-muted">Ainda não há orçamento para este mês.</p>
          : budgets.map((budget) => <article key={budget.id} className={cn("rounded-ds-card-lg border border-ds-border bg-ds-surface p-5", !budget.active && "opacity-70")}>
            <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><h3 className="text-[15px] font-extrabold">{budget.name}</h3>
                <StatusPill variant={budget.active ? "ok" : "neutral"}>{budget.active ? "Ativo" : "Inativo"}</StatusPill>
                <StatusPill variant="info">{budget.source === "manual" ? "Manual" : "Gerado automaticamente"}</StatusPill></div>
              <p className="mt-1 text-[13px] font-semibold">{budget.resultCenterName ?? "Global · todas as unidades"}</p>
              <p className="mt-0.5 text-xs text-ds-ink-muted">{budget.accountPlanIds.map((id) => accountNames.get(id) ?? id).join(" · ")}</p></div>
              {canManage && (!(budget.hasComposition || budget.composition?.length) || canEditPersonnel) && <Button type="button" disabled={saving} variant="ds-secondary" size="md" onClick={() => void toggleBudget(budget)}>{budget.active ? "Inativar" : "Reativar"}</Button>}</div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {[["Previsto", budget.budgetedAmountCents], ["Comprometido", budget.consumedAmountCents], ["Saldo orçamentário", budget.balanceAmountCents]].map(([label, cents]) =>
                <div key={label} className="rounded-ds-btn bg-ds-warm p-3"><p className="text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-ds-ink-faint">{label}</p>
                  <p className={cn("mt-0.5 font-ds-mono text-lg font-bold", label === "Saldo orçamentário" && Number(cents) < 0 && "text-ds-danger")}>{formatCurrency(Number(cents) / 100)}</p></div>)}
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-ds-muted" role="progressbar" aria-label={`Consumo de ${budget.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(usagePercent(budget.usageRatio))}>
              <div className={cn("h-full", budget.usageRatio > 1 ? "bg-ds-danger" : "bg-ds-accent")} style={{ width: `${usagePercent(budget.usageRatio)}%` }} /></div>
            <p className="mt-2 text-xs text-ds-ink-muted">{budget.expenses.length} despesa(s) vinculada(s) automaticamente.</p>
            {budget.issues.length > 0 && <p className="mt-2 text-xs font-semibold text-ds-warn">{budget.issues.join(" ")}</p>}
            <BudgetDetails budget={budget} accounts={accounts} canManage={canManage} canViewPersonnel={canViewPersonnel} canEditPersonnel={canEditPersonnel} canViewExpenses={isDefaultAdmin || permissions.financial?.expenses?.view === true} onSaved={refresh} />
          </article>)}
    </section>

    {isDefaultAdmin && canManage && <BudgetForecastConversion key={`${month}:${resultCenterId}`} month={month} resultCenterId={resultCenterId} onSaved={refresh} onImport={(rows) => {
      setName(`Vale-transporte — ${month}`); setMode("manual"); setComposed(true); setFormOpen(true); setPreview(null);
      setSelectedAccounts([...new Set(rows.map((row) => row.accountPlanId))]);
      setComposition(rows.map((row) => ({ id: crypto.randomUUID(), employeeId: row.employeeId, employeeName: row.description,
        accountPlanId: row.accountPlanId, amountCents: row.amountCents, expectedPurchaseDate: row.expectedPurchaseDate,
        estimateSource: "manual", purchaseDay: Number(row.expectedPurchaseDate.slice(8, 10)), purchaseMonthOffset: row.expectedPurchaseDate.slice(0, 7) < month ? -1 : 0 })));
    }} />}
    {allUnits && <BudgetProjectsManagement canManage={canManage} accounts={postingAccounts} />}

    <section aria-label="Regras automáticas" className="space-y-3">
      <header className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-extrabold">Regras automáticas</h2>
        <p className="text-[13px] text-ds-ink-muted">Uma regra ativa cria um orçamento independente em cada mês, mantendo o valor original de cada geração.</p></div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[13px] font-semibold"><Checkbox disabled={saving} checked={showInactiveRules} onCheckedChange={(value) => setShowInactiveRules(value === true)} />Consultar regras inativas</label>
          {canManage && <Button type="button" variant="ds-secondary" size="md" disabled={saving || !scopeAllowed} onClick={() => void generateMonth()}>Gerar competência {month}</Button>}</div></header>
      <div className="overflow-hidden rounded-ds-card-lg border border-ds-border bg-ds-warm">
        {!loading && loadedScope === currentScope && scopeAllowed && rules.map((rule) => <div key={rule.id} className={cn("flex flex-wrap items-center justify-between gap-3 border-b border-ds-divider px-5 py-3 last:border-b-0", rule.active === false && "opacity-60")}>
          <div className="min-w-0"><p className="text-[13.5px] font-bold">{rule.name} · {rule.resultCenterName ?? "Global"}</p>
            <p className="text-xs text-ds-ink-muted">{budgetRuleModeLabel(rule)} · desde {rule.startMonth}{rule.endMonth ? ` até ${rule.endMonth}` : " · sem fim definido"} · antecedência {rule.generationLeadMonths ?? 0}</p></div>
          {canManage && (!(rule.hasComposition || rule.composition?.length) || canEditPersonnel) && <Button type="button" disabled={saving} variant="ds-secondary" size="md" onClick={() => void toggleRule(rule)}>{rule.active ? "Pausar" : "Reativar"}</Button>}
        </div>)}
        {!loading && !rules.length && <p className="px-5 py-8 text-center text-sm text-ds-ink-muted">Nenhuma regra {showInactiveRules ? "inativa" : "ativa"} neste escopo.</p>}
      </div>
    </section>
  </div>;
}
