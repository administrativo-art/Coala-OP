"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Calculator, CircleHelp, Layers3, Loader2, Plus, RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { resolveUnitAccess } from "@/lib/unit-access";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { createBudgetSchema, createBudgetRuleSchema } from "@/features/financial/budgets/schemas";
import { budgetRequest as request, validateBudgetPeople } from "./budget-api";
import { BudgetCompositionEditor } from "./budget-composition-editor";
import { BudgetDetails } from "./budget-details";
import { BudgetForecastConversion } from "./budget-forecast-conversion";
import { allowedBudgetCenters, budgetScopeQuery, compositionTotal, manualComposition, ruleComposition, type BudgetCenterOption, type BudgetLineDraft } from "./budget-ui-model";
import { financialDateKey } from "@/features/financial/lib/financial-dates";
import type { FinancialBudgetRule, FinancialBudgetSummary } from "@/features/financial/budgets/types";
import { formatCurrency } from "@/features/financial/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import BudgetProjectsManagement from "./budget-projects-management";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type AccountOption = { id: string; name: string; active?: boolean; isGroup?: boolean; parentId?: string | null };
type InputOption = { id: string; name: string; unit: string };
type Mode = "manual" | "fixed" | "expense_previous" | "expense_average" | "consumption_price";
const todayMonth = () => financialDateKey(new Date())!.slice(0, 7);

export default function BudgetsManagement({ canManage }: { canManage: boolean }) {
  const { toast } = useToast();
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

  return <PageContainer variant="wide" className="space-y-5">
    <PageHeader title="Orçamentos" description="Planeje por categoria e centro de custo; confira o comprometido e a compra ainda esperada."
      actions={canManage && <Button disabled={saving || !scopeAllowed} onClick={() => setFormOpen(!formOpen)}><Plus className="mr-2 h-4 w-4" />{formOpen ? "Fechar cadastro" : "Novo orçamento"}</Button>} />
    <div className="space-y-2"><Label htmlFor="budget-center">Escopo do cadastro e filtro da consulta</Label>
      <Select disabled={saving} value={resultCenterId || (allUnits ? "global" : "")} onValueChange={(value) => { setResultCenterId(value === "global" ? "" : value); resetForm(); }}>
        <SelectTrigger id="budget-center"><SelectValue placeholder="Selecione um centro de custo autorizado" /></SelectTrigger><SelectContent>
          {allUnits && <SelectItem value="global">Global · todas as unidades</SelectItem>}
          {visibleCenters.map((center) => <SelectItem key={center.id} value={center.id}>{center.name}{center.active === false ? " · inativo" : ""}</SelectItem>)}
        </SelectContent></Select>
      <p className="text-xs text-muted-foreground">O centro de custo usa o cadastro de centros de resultado e suas unidades vinculadas. No escopo global, a consulta reúne todos os centros; novos envelopes são globais. Trocar o escopo reinicia o cadastro.</p>
      {!scopeAllowed && <p role="status" className="text-sm text-muted-foreground">Selecione um centro permitido para consultar ou cadastrar orçamentos.</p>}
      {catalogError && <p role="alert" className="text-sm text-destructive">{catalogError}</p>}
    </div>
    <Card className="rounded-2xl border-[#e2ded4] shadow-sm">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1"><CardTitle className="flex items-center gap-2"><Layers3 className="h-5 w-5 text-primary" /> Orçamentos por categoria</CardTitle>
          <CardDescription>Acompanhe um conjunto de compras e despesas. Cada despesa das contas escolhidas reduz o valor disponível do mês.</CardDescription></div>
      </CardHeader>
      {formOpen && canManage && scopeAllowed && <CardContent className="border-t pt-6"><fieldset disabled={saving} className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="budget-name">1. Qual grupo de gastos deseja acompanhar?</Label>
            <Input id="budget-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Insumos da sorveteria" />
            <p className="text-xs text-muted-foreground">Use um nome que ajude a reconhecer a finalidade do orçamento.</p></div>
          <div className="space-y-2"><Label htmlFor="budget-month">Competência inicial</Label>
            <Input id="budget-month" type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
            <p className="text-xs text-muted-foreground">As despesas serão comparadas pela competência contábil deste mês.</p></div>
        </div>
        <div className="space-y-2"><Label>2. Quais contas entram nesse orçamento?</Label>
          <div className="grid max-h-48 gap-2 overflow-y-auto rounded-xl border bg-muted/20 p-3 sm:grid-cols-2 lg:grid-cols-3">
            {postingAccounts.map((account) => <label key={account.id} className="flex cursor-pointer items-start gap-2 rounded-lg bg-background p-2 text-sm">
              <Checkbox checked={selectedAccounts.includes(account.id)} onCheckedChange={(checked) => setSelectedAccounts(checked
                ? [...selectedAccounts, account.id] : selectedAccounts.filter((id) => id !== account.id))} />
              <span>{account.name}</span></label>)}
          </div><p className="text-xs text-muted-foreground">Uma conta pode ter orçamentos em centros distintos no mesmo mês. Um envelope global não pode se sobrepor aos locais. Despesas com rateio entram apenas pela parcela elegível.</p></div>
        {canEditPersonnel && <label className="flex items-start gap-2 text-sm"><Checkbox disabled={saving || !resultCenterId} checked={composed} onCheckedChange={(value) => { setComposed(value === true); if (value === true && mode !== "manual" && mode !== "fixed") setMode("manual"); }} />
          <span>Detalhar por colaborador (opcional; selecione um centro de custo). O total será a soma da composição.</span></label>}
        <div className="space-y-3"><Label>3. Como o valor será definido?</Label>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            {([
              ["manual", "Manual", "Defina somente este mês."],
              ["fixed", "Automático fixo", "Repita o valor informado nos meses seguintes."],
              ["expense_previous", "Mês anterior", "Use os gastos do último mês fechado."],
              ["expense_average", "Média de meses", "Use a média de meses fechados."],
              ["consumption_price", "Consumo e preços", "Estime a compra pelos insumos, estoque e preços médios."],
            ] as const).map(([value, title, detail]) => <button key={value} type="button" disabled={saving || (composed && value !== "manual" && value !== "fixed") || (Boolean(resultCenterId) && value === "consumption_price")} onClick={() => setMode(value)}
              aria-pressed={mode === value}
              className={`rounded-xl border p-3 text-left transition-colors ${mode === value ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}>
              <span className="block text-sm font-semibold">{title}</span><span className="mt-1 block text-xs text-muted-foreground">{detail}</span>
            </button>)}
          </div>
          {(mode === "manual" || mode === "fixed") && !composed && <div className="max-w-xs space-y-2"><Label htmlFor="budget-amount">{mode === "manual" ? "Valor orçado (R$)" : "Valor mensal (R$)"}</Label>
            <CurrencyInput id="budget-amount" value={amount === "" ? "" : Number(amount)} onChange={(value) => setAmount(String(value))} /></div>}
          {(mode === "expense_average" || mode === "consumption_price") && <div className="max-w-xs space-y-2"><Label>Média dos últimos meses fechados</Label>
            <Select value={averageMonths} onValueChange={setAverageMonths}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
              {[2, 3, 4, 6, 12].map((count) => <SelectItem key={count} value={String(count)}>{count} meses</SelectItem>)}
            </SelectContent></Select></div>}
          {mode === "consumption_price" && <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
            <p className="text-sm font-semibold">Quais insumos compõem o grupo?</p>
            <p className="text-xs text-muted-foreground">O cálculo usa o consumo registrado nas unidades, o estoque da matriz e os preços efetivos das compras. Se faltar informação, a prévia aponta o que revisar.</p>
            <div className="grid max-h-48 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
              {inputs.map((item) => <label key={item.id} className="flex cursor-pointer items-start gap-2 rounded-lg bg-background p-2 text-sm">
                <Checkbox checked={selectedInputs.includes(item.id)} onCheckedChange={(checked) => setSelectedInputs(checked
                  ? [...selectedInputs, item.id] : selectedInputs.filter((id) => id !== item.id))} />
                <span>{item.name} <span className="text-xs text-muted-foreground">({item.unit})</span></span>
              </label>)}
            </div>
            <div className="max-w-xs space-y-2"><Label htmlFor="budget-stock-days">Estoque desejado após o mês (dias de consumo)</Label>
              <Input id="budget-stock-days" type="number" min="0" max="60" step="1" value={closingStockDays} onChange={(event) => setClosingStockDays(event.target.value)} />
              <p className="text-xs text-muted-foreground">Ex.: 7 significa terminar o mês com estoque para aproximadamente sete dias.</p></div>
          </div>}
          {composed && canEditPersonnel && resultCenterId && <BudgetCompositionEditor key={resultCenterId} lines={composition} onChange={setComposition} resultCenterId={resultCenterId}
            accounts={postingAccounts.filter((account) => selectedAccounts.includes(account.id))} month={month} centerName={visibleCenters.find((center) => center.id === resultCenterId)?.name ?? "Centro selecionado"} repeating={mode === "fixed"} disabled={saving} />}
          {mode !== "manual" && <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label htmlFor="budget-end-month">Última competência (opcional)</Label><Input id="budget-end-month" type="month" min={month} value={endMonth} onChange={(event) => setEndMonth(event.target.value)} /><p className="text-xs text-muted-foreground">Sem fim definido, a regra se repete até ser pausada.</p></div>
            <div className="space-y-1"><Label htmlFor="budget-lead">Antecedência da geração automática</Label><Select disabled={saving} value={String(generationLeadMonths)} onValueChange={(value) => setGenerationLeadMonths(value === "1" ? 1 : 0)}><SelectTrigger id="budget-lead"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="0">0 · somente competência corrente</SelectItem><SelectItem value="1">1 · incluir competência seguinte</SelectItem></SelectContent></Select><p className="text-xs text-muted-foreground">A antecedência gera o planejamento; a data da compra continua definida nas linhas.</p></div>
          </div>}
          {mode !== "manual" && <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={showPreview} disabled={saving}><Calculator className="mr-2 h-4 w-4" />Calcular prévia</Button>
            {preview && <p className="text-sm">Valor sugerido para {month}: <strong>{formatCurrency(preview.amountCents / 100)}</strong>
              {preview.snapshot.referenceMonths.length > 0 && <span className="ml-1 text-muted-foreground">com base em {preview.snapshot.referenceMonths.join(", ")}</span>}</p>}
          </div>}
          {mode === "consumption_price" && preview?.snapshot.inputEstimates && <div className="space-y-2 rounded-xl border bg-muted/20 p-4 text-sm">
            <p className="font-semibold">Como chegamos ao valor</p>
            {preview.snapshot.inputEstimates.map((item) => <div key={item.baseProductId} className="grid gap-1 border-t pt-2 sm:grid-cols-[minmax(0,1fr)_110px_120px]">
              <span>{item.name} <span className="text-muted-foreground">({item.unit})</span></span>
              <span>{item.additionalPurchaseQuantity.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} a comprar</span>
              <strong>{formatCurrency(item.additionalPurchaseAmountCents / 100)}</strong>
              <span className="text-xs text-muted-foreground sm:col-span-3">Consumo previsto {item.forecastQuantity.toFixed(2)} · estoque projetado {item.openingStockQuantity.toFixed(2)} · pedidos confirmados {item.inboundQuantity.toFixed(2)} · preço médio {formatCurrency(item.averagePriceCentsPerUnit / 100)}/{item.unit}</span>
            </div>)}
            <p className="border-t pt-2 text-xs text-muted-foreground">Compras já lançadas neste mês: {formatCurrency((preview.snapshot.committedAmountCents ?? 0) / 100)}. Elas fazem parte do total e não são descontadas novamente.</p>
          </div>}
        </div>
        <div className="rounded-xl border bg-muted/20 p-4 text-sm" aria-live="polite"><p className="font-semibold">Conferência antes de salvar</p>
          <p>{name || "Informe a finalidade"} · {visibleCenters.find((center) => center.id === resultCenterId)?.name ?? "Global"} · competência {month}</p>
          <p>{selectedAccounts.map((id) => accountNames.get(id)).filter(Boolean).join(" · ") || "Selecione as contas"}</p>
          <p>{composed ? `${composition.length} linhas · ` : ""}Total: {formatCurrency((composed ? compositionTotal(composition) : mode === "manual" ? Math.round(Number(amount) * 100) : preview?.amountCents ?? 0) / 100)}</p>
          <p>{mode === "manual" ? "Somente este mês, com estimativa manual." : `Repetir desde ${month}${endMonth ? ` até ${endMonth}` : ", até pausar"}. Geração com ${generationLeadMonths} mês de antecedência.`}</p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50/60 p-4 text-sm text-blue-900">
          <span className="flex items-start gap-2"><CircleHelp className="mt-0.5 h-4 w-4 shrink-0" />A criação do orçamento não lança despesas nem agenda pagamentos. Ela define um limite para acompanhar os gastos.</span>
          <Button onClick={save} disabled={saving || (composed && (!composition.length || !canEditPersonnel)) || (mode !== "manual" && !preview)}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}{mode === "manual" ? "Criar orçamento" : "Salvar regra e gerar mês"}</Button>
        </div>
      </fieldset></CardContent>}
    </Card>

    <Card className="rounded-2xl border-[#e2ded4] shadow-sm"><CardHeader className="gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div><CardTitle>Orçamentos do mês</CardTitle><CardDescription>O comprometido inclui despesas abertas e pagas; pagar não desconta uma segunda vez.</CardDescription></div>
      <div className="flex gap-2"><div className="relative"><CalendarDays className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input disabled={saving} aria-label="Mês dos orçamentos" type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="w-44 pl-9" /></div>
        <Button disabled={saving || loading || !scopeAllowed} variant="outline" size="icon" onClick={() => void refresh()} aria-label="Atualizar orçamentos"><RefreshCw className="h-4 w-4" /></Button></div>
    </CardHeader><CardContent className="space-y-3">
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {loading ? <div role="status" aria-label="Carregando orçamentos" className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : budgets.length === 0 || loadedScope !== currentScope || !scopeAllowed
        ? <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Ainda não há orçamento para este mês.</p>
        : budgets.map((budget) => <div key={budget.id} className="rounded-xl border bg-background p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{budget.name}</h3>
            <Badge variant={budget.active ? "secondary" : "outline"}>{budget.active ? "Ativo" : "Inativo"}</Badge>
            <Badge variant="outline">{budget.source === "manual" ? "Manual" : "Gerado automaticamente"}</Badge></div>
            <p className="mt-1 text-sm">{budget.resultCenterName ?? "Global · todas as unidades"}</p>
            <p className="mt-1 text-xs text-muted-foreground">{budget.accountPlanIds.map((id) => accountNames.get(id) ?? id).join(" · ")}</p></div>
            {canManage && (!(budget.hasComposition || budget.composition?.length) || canEditPersonnel) && <Button disabled={saving} variant="ghost" size="sm" onClick={() => void toggleBudget(budget)}>{budget.active ? "Inativar" : "Reativar"}</Button>}</div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {[["Previsto", budget.budgetedAmountCents], ["Comprometido", budget.consumedAmountCents], ["Saldo orçamentário", budget.balanceAmountCents]].map(([label, cents]) =>
              <div key={label} className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="font-mono text-lg font-bold">{formatCurrency(Number(cents) / 100)}</p></div>)}
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${Math.min(Math.max(budget.usageRatio, 0) * 100, 100)}%` }} /></div>
          <p className="mt-2 text-xs text-muted-foreground">{budget.expenses.length} despesa(s) vinculada(s) automaticamente.</p>
          {budget.issues.length > 0 && <p className="mt-2 text-xs text-amber-700">{budget.issues.join(" ")}</p>}
          <BudgetDetails budget={budget} accounts={accounts} canManage={canManage} canViewPersonnel={canViewPersonnel} canEditPersonnel={canEditPersonnel} onSaved={refresh} />
        </div>)}
    </CardContent></Card>

    {isDefaultAdmin && canManage && <BudgetForecastConversion key={`${month}:${resultCenterId}`} month={month} resultCenterId={resultCenterId} onSaved={refresh} onImport={(rows) => {
      setName(`Vale-transporte — ${month}`); setMode("manual"); setComposed(true); setFormOpen(true); setPreview(null);
      setSelectedAccounts([...new Set(rows.map((row) => row.accountPlanId))]);
      setComposition(rows.map((row) => ({ id: crypto.randomUUID(), employeeId: row.employeeId, employeeName: row.description,
        accountPlanId: row.accountPlanId, amountCents: row.amountCents, expectedPurchaseDate: row.expectedPurchaseDate,
        estimateSource: "manual", purchaseDay: Number(row.expectedPurchaseDate.slice(8, 10)), purchaseMonthOffset: row.expectedPurchaseDate.slice(0, 7) < month ? -1 : 0 })));
    }} />}
    {allUnits && <BudgetProjectsManagement canManage={canManage} accounts={postingAccounts} />}

    <Card className="rounded-2xl border-[#e2ded4] shadow-sm"><CardHeader><CardTitle>Regras automáticas</CardTitle>
      <CardDescription>Uma regra ativa cria um orçamento independente em cada mês, mantendo o valor original de cada geração.</CardDescription></CardHeader>
      <CardContent className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm"><Checkbox disabled={saving} checked={showInactiveRules} onCheckedChange={(value) => setShowInactiveRules(value === true)} />Consultar regras inativas</label>
        {canManage && <Button variant="outline" disabled={saving || !scopeAllowed} onClick={() => void generateMonth()}>Gerar competência {month}</Button>}</div>
        {!loading && loadedScope === currentScope && scopeAllowed && rules.map((rule) => <div key={rule.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
        <div><p className="font-medium">{rule.name} · {rule.resultCenterName ?? "Global"}</p><p className="text-xs text-muted-foreground">{rule.mode === "fixed" ? "Valor fixo" : rule.mode === "expense_previous" ? "Último mês fechado" : rule.mode === "consumption_price" ? "Consumo e preço dos insumos" : `Média de ${rule.averageMonths} meses`} · desde {rule.startMonth}{rule.endMonth ? ` até ${rule.endMonth}` : " · sem fim definido"} · antecedência {rule.generationLeadMonths ?? 0}</p></div>
        {canManage && (!(rule.hasComposition || rule.composition?.length) || canEditPersonnel) && <Button disabled={saving} variant="outline" size="sm" onClick={() => void toggleRule(rule)}>{rule.active ? "Pausar" : "Reativar"}</Button>}
      </div>)}{!loading && !rules.length && <p className="text-sm text-muted-foreground">Nenhuma regra {showInactiveRules ? "inativa" : "ativa"} neste escopo.</p>}</CardContent></Card>
  </PageContainer>;
}
