"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Calculator, CircleHelp, Layers3, Loader2, Plus, RefreshCw } from "lucide-react";
import { authenticatedApiRequest } from "@/lib/authenticated-api-client";
import { auth } from "@/lib/firebase";
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

function request<T>(url: string, method = "GET", json?: unknown) {
  return authenticatedApiRequest<T>(url, {
    method,
    json,
    getIdToken: async () => auth.currentUser?.getIdToken(),
    fallbackError: "Não foi possível carregar os orçamentos.",
  });
}

export default function BudgetsManagement({ canManage }: { canManage: boolean }) {
  const { toast } = useToast();
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
  const [editingBudgetId, setEditingBudgetId] = useState<string | null>(null);
  const [revisionAmount, setRevisionAmount] = useState("");
  const [revisionReason, setRevisionReason] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [budgetResult, ruleResult, accountsResult] = await Promise.all([
        request<{ budgets: FinancialBudgetSummary[] }>(`/api/financial/budgets?month=${month}`),
        request<{ rules: FinancialBudgetRule[] }>("/api/financial/budget-rules"),
        request<{ docs: AccountOption[] }>("/api/financial/data?path=accounts"),
      ]);
      setBudgets(budgetResult.budgets);
      setRules(ruleResult.rules);
      setAccounts(accountsResult.docs);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao carregar orçamentos.");
    } finally { setLoading(false); }
  }, [month]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { setPreview(null); }, [mode, amount, averageMonths, selectedAccounts, selectedInputs, closingStockDays, month]);
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
    fixedAmountCents: mode === "fixed" ? Math.round(Number(amount) * 100) : null,
    averageMonths: Number(averageMonths), startMonth: month,
    baseProductIds: mode === "consumption_price" ? selectedInputs : [],
    stockKioskId: mode === "consumption_price" ? "matriz" : null,
    closingStockDays: Number(closingStockDays) };

  function resetForm() {
    setName(""); setSelectedAccounts([]); setSelectedInputs([]); setMode("manual"); setAmount(""); setAverageMonths("3"); setClosingStockDays("7"); setPreview(null);
    setFormOpen(false);
  }

  async function showPreview() {
    if (!name.trim() || !selectedAccounts.length) {
      toast({ variant: "destructive", title: "Informe um nome e escolha pelo menos uma conta." }); return;
    }
    if (mode === "fixed" && (!Number.isFinite(Number(amount)) || amount.trim() === "" || Number(amount) < 0)) {
      toast({ variant: "destructive", title: "Informe o valor mensal." }); return;
    }
    if (mode === "consumption_price" && selectedInputs.length === 0) {
      toast({ variant: "destructive", title: "Escolha os insumos para calcular a previsão." }); return;
    }
    setSaving(true);
    try {
      setPreview(await request<typeof preview>("/api/financial/budget-rules/preview", "POST", { rule: selectedRule, month }) as NonNullable<typeof preview>);
    } catch (cause) {
      toast({ variant: "destructive", title: cause instanceof Error ? cause.message : "Não foi possível calcular a prévia." });
    } finally { setSaving(false); }
  }

  async function save() {
    if (!name.trim() || selectedAccounts.length === 0) {
      toast({ variant: "destructive", title: "Informe um nome e escolha as contas." }); return;
    }
    if (mode === "manual" && (!Number.isFinite(Number(amount)) || Number(amount) < 0 || amount.trim() === "")) {
      toast({ variant: "destructive", title: "Informe o valor do orçamento." }); return;
    }
    if (mode !== "manual" && !preview) {
      toast({ variant: "destructive", title: "Calcule a prévia antes de salvar a regra." }); return;
    }
    setSaving(true);
    try {
      if (mode === "manual") {
        await request("/api/financial/budgets", "POST", {
          name, accountPlanIds: selectedAccounts, competenceMonth: month, budgetedAmountCents: Math.round(Number(amount) * 100),
        });
      } else {
        const created = await request<{ id: string }>("/api/financial/budget-rules", "POST", selectedRule);
        const generated = await request<{ results: Array<{ ruleId: string; created: boolean; skipped?: string }> }>(
          "/api/financial/budget-rules/generate", "POST", { month });
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
    try {
      await request(`/api/financial/budgets/${encodeURIComponent(budget.id)}`, "PATCH", { active: !budget.active });
      await refresh();
    } catch (cause) { toast({ variant: "destructive", title: cause instanceof Error ? cause.message : "Não foi possível alterar o orçamento." }); }
  }

  async function reviseBudget(budget: FinancialBudgetSummary) {
    if (!Number.isFinite(Number(revisionAmount)) || Number(revisionAmount) < 0 || revisionReason.trim().length < 5) {
      toast({ variant: "destructive", title: "Informe o novo valor e o motivo da revisão." }); return;
    }
    setSaving(true);
    try {
      await request(`/api/financial/budgets/${encodeURIComponent(budget.id)}`, "PATCH", {
        budgetedAmountCents: Math.round(Number(revisionAmount) * 100), reason: revisionReason,
      });
      toast({ title: "Valor revisado e registrado." });
      setEditingBudgetId(null); setRevisionReason(""); await refresh();
    } catch (cause) { toast({ variant: "destructive", title: cause instanceof Error ? cause.message : "Não foi possível revisar o valor." }); }
    finally { setSaving(false); }
  }

  async function toggleRule(rule: FinancialBudgetRule) {
    try {
      await request(`/api/financial/budget-rules/${encodeURIComponent(rule.id)}`, "PATCH", { active: !rule.active });
      await refresh();
    } catch (cause) { toast({ variant: "destructive", title: cause instanceof Error ? cause.message : "Não foi possível alterar a regra." }); }
  }

  return <div className="space-y-5">
    <Card className="rounded-2xl border-[#e2ded4] shadow-sm">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1"><CardTitle className="flex items-center gap-2"><Layers3 className="h-5 w-5 text-primary" /> Orçamentos por categoria</CardTitle>
          <CardDescription>Acompanhe um conjunto de compras e despesas. Cada despesa das contas escolhidas reduz o valor disponível do mês.</CardDescription></div>
        {canManage && <Button onClick={() => setFormOpen(!formOpen)}><Plus className="mr-2 h-4 w-4" />{formOpen ? "Fechar cadastro" : "Novo orçamento"}</Button>}
      </CardHeader>
      {formOpen && canManage && <CardContent className="space-y-6 border-t pt-6">
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
          </div><p className="text-xs text-muted-foreground">Uma conta só pode pertencer a um orçamento do mesmo mês. Despesas com rateio entram apenas pela parcela dessas contas.</p></div>
        <div className="space-y-3"><Label>3. Como o valor será definido?</Label>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            {([
              ["manual", "Manual", "Defina somente este mês."],
              ["fixed", "Automático fixo", "Repita o valor informado nos meses seguintes."],
              ["expense_previous", "Mês anterior", "Use os gastos do último mês fechado."],
              ["expense_average", "Média de meses", "Use a média de meses fechados."],
              ["consumption_price", "Consumo e preços", "Estime a compra pelos insumos, estoque e preços médios."],
            ] as const).map(([value, title, detail]) => <button key={value} type="button" onClick={() => setMode(value)}
              className={`rounded-xl border p-3 text-left transition-colors ${mode === value ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}>
              <span className="block text-sm font-semibold">{title}</span><span className="mt-1 block text-xs text-muted-foreground">{detail}</span>
            </button>)}
          </div>
          {(mode === "manual" || mode === "fixed") && <div className="max-w-xs space-y-2"><Label htmlFor="budget-amount">{mode === "manual" ? "Valor orçado (R$)" : "Valor mensal (R$)"}</Label>
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
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50/60 p-4 text-sm text-blue-900">
          <span className="flex items-start gap-2"><CircleHelp className="mt-0.5 h-4 w-4 shrink-0" />A criação do orçamento não lança despesas nem agenda pagamentos. Ela define um limite para acompanhar os gastos.</span>
          <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}{mode === "manual" ? "Criar orçamento" : "Salvar regra e gerar mês"}</Button>
        </div>
      </CardContent>}
    </Card>

    <Card className="rounded-2xl border-[#e2ded4] shadow-sm"><CardHeader className="gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div><CardTitle>Orçamentos do mês</CardTitle><CardDescription>O comprometido inclui despesas abertas e pagas; pagar não desconta uma segunda vez.</CardDescription></div>
      <div className="flex gap-2"><div className="relative"><CalendarDays className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input aria-label="Mês dos orçamentos" type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="w-44 pl-9" /></div>
        <Button variant="outline" size="icon" onClick={() => void refresh()} aria-label="Atualizar orçamentos"><RefreshCw className="h-4 w-4" /></Button></div>
    </CardHeader><CardContent className="space-y-3">
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {loading ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : budgets.length === 0
        ? <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Ainda não há orçamento para este mês.</p>
        : budgets.map((budget) => <div key={budget.id} className="rounded-xl border bg-background p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{budget.name}</h3>
            <Badge variant={budget.active ? "secondary" : "outline"}>{budget.active ? "Ativo" : "Inativo"}</Badge>
            <Badge variant="outline">{budget.source === "manual" ? "Manual" : "Gerado automaticamente"}</Badge></div>
            <p className="mt-1 text-xs text-muted-foreground">{budget.accountPlanIds.map((id) => accountNames.get(id) ?? id).join(" · ")}</p></div>
            {canManage && <div className="flex gap-1"><Button variant="ghost" size="sm" onClick={() => {
              setEditingBudgetId(editingBudgetId === budget.id ? null : budget.id);
              setRevisionAmount((budget.budgetedAmountCents / 100).toFixed(2)); setRevisionReason("");
            }}>Revisar valor</Button><Button variant="ghost" size="sm" onClick={() => void toggleBudget(budget)}>{budget.active ? "Inativar" : "Reativar"}</Button></div>}</div>
          {editingBudgetId === budget.id && <div className="mt-3 grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-[150px_minmax(0,1fr)_auto] sm:items-end">
            <div className="space-y-1"><Label htmlFor={`revision-amount-${budget.id}`}>Novo valor (R$)</Label><CurrencyInput id={`revision-amount-${budget.id}`} value={revisionAmount === "" ? "" : Number(revisionAmount)} onChange={(value) => setRevisionAmount(String(value))} /></div>
            <div className="space-y-1"><Label htmlFor={`revision-reason-${budget.id}`}>Por que o valor mudou?</Label><Input id={`revision-reason-${budget.id}`} value={revisionReason} onChange={(event) => setRevisionReason(event.target.value)} placeholder="Ex.: aumento previsto no preço dos insumos" /></div>
            <Button disabled={saving} onClick={() => void reviseBudget(budget)}>Salvar revisão</Button>
          </div>}
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {[["Orçado", budget.budgetedAmountCents], ["Comprometido", budget.consumedAmountCents], ["Disponível", budget.balanceAmountCents]].map(([label, cents]) =>
              <div key={label} className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="font-mono text-lg font-bold">{formatCurrency(Number(cents) / 100)}</p></div>)}
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${Math.min(Math.max(budget.usageRatio, 0) * 100, 100)}%` }} /></div>
          <p className="mt-2 text-xs text-muted-foreground">{budget.expenses.length} despesa(s) vinculada(s) automaticamente.</p>
          {budget.issues.length > 0 && <p className="mt-2 text-xs text-amber-700">{budget.issues.join(" ")}</p>}
        </div>)}
    </CardContent></Card>

    <BudgetProjectsManagement canManage={canManage} accounts={postingAccounts} />

    {rules.length > 0 && <Card className="rounded-2xl border-[#e2ded4] shadow-sm"><CardHeader><CardTitle>Regras automáticas</CardTitle>
      <CardDescription>Uma regra ativa cria um orçamento independente em cada mês, mantendo o valor original de cada geração.</CardDescription></CardHeader>
      <CardContent className="space-y-2">{rules.map((rule) => <div key={rule.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
        <div><p className="font-medium">{rule.name}</p><p className="text-xs text-muted-foreground">{rule.mode === "fixed" ? "Valor fixo" : rule.mode === "expense_previous" ? "Último mês fechado" : rule.mode === "consumption_price" ? "Consumo e preço dos insumos" : `Média de ${rule.averageMonths} meses`} · desde {rule.startMonth}</p></div>
        {canManage && <Button variant="outline" size="sm" onClick={() => void toggleRule(rule)}>{rule.active ? "Pausar" : "Reativar"}</Button>}
      </div>)}</CardContent></Card>}
  </div>;
}
