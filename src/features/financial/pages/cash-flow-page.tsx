"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { endOfMonth, format, startOfMonth, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarRange, CircleDollarSign, Download, Plus, RefreshCw, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { NewTransactionDialog } from "@/features/financial/components/cash-flow/new-transaction-dialog";
import { FinancialAccessGuard } from "@/features/financial/components/financial-access-guard";
import { financialCollection } from "@/features/financial/lib/repositories";
import { formatCurrency, toDate } from "@/features/financial/lib/utils";
import { buildCashFlowCsv, buildExpenseLifecycleData } from "@/features/financial/lib/cash-flow-analysis";
import { useFinancialCollection } from "@/features/financial/hooks/use-financial-collection";
import type { Account } from "@/features/financial/types/account";
import type { Transaction } from "@/features/financial/types/transaction";
import { useAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { authenticatedApiRequest } from "@/lib/authenticated-api-client";
import { financialDateKey } from "@/features/financial/lib/financial-dates";
import type { FinancialBudgetSummary } from "@/features/financial/budgets/types";
import { budgetScenarioAmount, cashForecastTotals, type BudgetCashProjectionPayload } from "@/features/financial/budgets/projection-view";
import { allowedBudgetCenters, type BudgetCenterOption } from "@/features/financial/components/settings/budget-ui-model";
import { resolveUnitAccess } from "@/lib/unit-access";
import { PageContainer } from "@/components/layout/page-container";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Movement = {
  source?: "expense" | "expense_forecast" | "budget_residual" | "budget_scenario";
  id: string;
  date: Date;
  description: string;
  accountId?: string;
  accountName?: string;
  accountPlanId?: string;
  accountPlanName?: string;
  supplier?: string;
  expenseId?: string;
  competenceDate?: Date | null;
  dueDate?: Date | null;
  direction: "in" | "out";
  status: "realized" | "forecast";
  amount: number;
};

const PERIOD_OPTIONS = [
  { value: "1", label: "Mês atual" },
  { value: "3", label: "Últimos 3 meses" },
  { value: "6", label: "Últimos 6 meses" },
  { value: "12", label: "Últimos 12 meses" },
];

function Kpi({ label, value, detail, tone, icon: Icon }: {
  label: string;
  value: number;
  detail: string;
  tone: "neutral" | "positive" | "negative" | "warning";
  icon: typeof Wallet;
}) {
  const toneClass = {
    neutral: "border-slate-200 bg-white text-slate-950",
    positive: "border-emerald-200 bg-emerald-50/60 text-emerald-700",
    negative: "border-rose-200 bg-rose-50/60 text-rose-700",
    warning: "border-amber-200 bg-amber-50/60 text-amber-700",
  }[tone];
  return (
    <Card className={cn("rounded-2xl shadow-sm", toneClass)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</CardTitle>
        <Icon className="h-4 w-4" />
      </CardHeader>
      <CardContent>
        <p className="font-mono text-xl font-bold tracking-tight">{formatCurrency(value)}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

export function CashFlowPage() {
  const { permissions, user, isDefaultAdmin } = useAuth();
  const [accountFilter, setAccountFilter] = useState("all");
  const [period, setPeriod] = useState("3");
  const [statusFilter, setStatusFilter] = useState("all");
  const [directionFilter, setDirectionFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedBudgetId, setSelectedBudgetId] = useState("");
  const [monthlyBudgets, setMonthlyBudgets] = useState<FinancialBudgetSummary[]>([]);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [budgetLoading, setBudgetLoading] = useState(false);
  const [includeBudgetScenario, setIncludeBudgetScenario] = useState(false);
  const [budgetCenters, setBudgetCenters] = useState<BudgetCenterOption[]>([]);
  const [budgetCenterId, setBudgetCenterId] = useState("");
  const [budgetProjections, setBudgetProjections] = useState<BudgetCashProjectionPayload>({ projections: [], conflictCount: 0, issueCount: 0 });
  const budgetRequestVersion = useRef(0);
  const { data: accountsData } = useFinancialCollection<Account>(financialCollection("bankAccounts"));
  const { data: transactionsData, loading: loadingTransactions } = useFinancialCollection<Transaction>(financialCollection("transactions"));
  const { data: paymentsData, loading: loadingPayments } = useFinancialCollection<any>(financialCollection("payments"));
  const { data: expensesData, loading: loadingExpenses } = useFinancialCollection<any>(financialCollection("expenses"));
  const { data: accountPlansData, loading: loadingAccountPlans } = useFinancialCollection<any>(financialCollection("accounts"));

  const canView = Boolean(permissions.financial?.cashFlow?.view || permissions.financial?.financialFlow);
  const budgetMonth = financialDateKey(new Date())!.slice(0, 7);
  const months = Number.parseInt(period, 10);
  const periodStart = startOfMonth(subMonths(new Date(), months - 1));
  const periodEnd = endOfMonth(new Date());
  const from = financialDateKey(periodStart)!;
  const to = financialDateKey(periodEnd)!;
  const allBudgetUnits = Boolean(user && resolveUnitAccess(user, { isDefaultAdmin }).allUnits);
  const visibleBudgetCenters = useMemo(() => user ? allowedBudgetCenters(budgetCenters, user, isDefaultAdmin) : [], [budgetCenters, user, isDefaultAdmin]);
  const budgetScopeReady = allBudgetUnits || visibleBudgetCenters.some((center) => center.id === budgetCenterId);
  useEffect(() => {
    if (!canView) return;
    let current = true;
    void authenticatedApiRequest<{ docs: BudgetCenterOption[] }>("/api/financial/data?path=resultCenters", { getIdToken: async () => auth.currentUser?.getIdToken() })
      .then((result) => { if (current) setBudgetCenters(result.docs); })
      .catch(() => { if (current) setBudgetError("Não foi possível carregar os centros do planejamento."); });
    return () => { current = false; };
  }, [canView]);
  const refreshBudgets = useCallback(async () => {
    const version = ++budgetRequestVersion.current;
    setMonthlyBudgets([]); setBudgetProjections({ projections: [], conflictCount: 0, issueCount: 0 });
    if (!canView || !budgetScopeReady) { setBudgetLoading(false); return; }
    setBudgetLoading(true);
    try {
      const scope = budgetCenterId ? `&resultCenterId=${encodeURIComponent(budgetCenterId)}` : "";
      const options = { getIdToken: async () => auth.currentUser?.getIdToken(), fallbackError: "Falha ao carregar o planejamento." };
      const [result, projections] = await Promise.all([
        authenticatedApiRequest<{ budgets: FinancialBudgetSummary[] }>(`/api/financial/budgets?month=${budgetMonth}${scope}`, options),
        authenticatedApiRequest<BudgetCashProjectionPayload>(`/api/financial/budgets/cash-projections?from=${from}&to=${to}${scope}`, options),
      ]);
      if (version !== budgetRequestVersion.current) return;
      setMonthlyBudgets(result.budgets.filter((budget) => budget.active));
      setBudgetProjections(projections);
      setBudgetError(null);
    } catch (cause) {
      if (version === budgetRequestVersion.current) setBudgetError(cause instanceof Error ? cause.message : "Falha ao carregar orçamentos.");
    } finally { if (version === budgetRequestVersion.current) setBudgetLoading(false); }
  }, [budgetMonth, canView, budgetScopeReady, budgetCenterId, from, to]);
  useEffect(() => {
    void refreshBudgets();
    return () => { budgetRequestVersion.current += 1; };
  }, [refreshBudgets]);
  const selectedBudget = monthlyBudgets.find((budget) => budget.id === selectedBudgetId) ?? monthlyBudgets[0];
  const accounts = accountsData || [];
  const expenseMap = useMemo(
    () => new Map((expensesData || []).map((expense) => [expense.id, expense])),
    [expensesData]
  );
  const accountPlanMap = useMemo(
    () => new Map((accountPlansData || []).map((plan) => [plan.id, plan.name])),
    [accountPlansData]
  );

  const realizedMovements = useMemo<Movement[]>(() => {
    const expensesConfirmedByTransactions = new Set(
      (transactionsData || [])
        .filter((transaction: any) => transaction.reversed !== true && transaction.auditStatus !== "reversed")
        .flatMap((transaction: any) => [
          transaction.expenseId,
          transaction.linkedExpenseId,
          ...(Array.isArray(transaction.splitExpenseIds) ? transaction.splitExpenseIds : []),
        ])
        .filter(Boolean),
    );
    const paymentTransactions = (paymentsData || []).flatMap((payment) => {
      const confirmedByBank =
        payment.status === "MATCHED" ||
        payment.reconciliationStatus === "MATCHED" ||
        Boolean(payment.bankTransactionId || payment.linkedBankTransactionId);
      if (confirmedByBank || expensesConfirmedByTransactions.has(payment.expenseId)) return [];
      return (payment.splits || []).map((split: any, splitIndex: number) => ({
        id: `payment-${payment.id}-${splitIndex}`,
        type: "expense_payment",
        direction: "out",
        accountId: split.accountId,
        accountName: split.accountName,
        paymentMethodLabel: split.paymentMethodLabel,
        amount: Number(split.amount) || 0,
        date: payment.paidAt,
        description: payment.description,
        expenseId: payment.expenseId,
        createdBy: payment.createdBy,
        createdAt: payment.createdAt,
        paymentEvidenceStatus: payment.status || "REPORTED",
      }));
    });

    return [...(transactionsData || []), ...paymentTransactions].flatMap((transaction: any) => {
      if (transaction.reversed === true || transaction.auditStatus === "reversed") return [];
      const date = toDate(transaction.date);
      if (!date || date < periodStart || date > periodEnd) return [];
      if (transaction.type === "transfer_in" || transaction.type === "transfer_out") return [];
      const direction = transaction.direction || (String(transaction.type).includes("expense") ? "out" : "in");
      const expenseId = transaction.expenseId || transaction.linkedExpenseId;
      const expense = expenseId ? expenseMap.get(expenseId) : undefined;
      const accountPlanId = transaction.accountPlanId || expense?.accountId || expense?.accountPlan;
      return [{
        id: transaction.id.startsWith?.("payment-") ? transaction.id : `realized-${transaction.id}`,
        date,
        description: transaction.description || expense?.description || "Movimentação financeira",
        accountId: transaction.accountId,
        accountName: transaction.accountName,
        accountPlanId,
        accountPlanName:
          transaction.accountPlanName ||
          expense?.accountPlanName ||
          accountPlanMap.get(accountPlanId) ||
          undefined,
        supplier: transaction.supplier || expense?.supplier || undefined,
        expenseId,
        competenceDate: toDate(transaction.competenceDate) || toDate(expense?.competenceDate),
        dueDate: toDate(expense?.dueDate),
        direction,
        status: "realized" as const,
        amount: Number(transaction.amount) || 0,
      }];
    });
  }, [accountPlanMap, expenseMap, paymentsData, periodEnd, periodStart, transactionsData]);

  const forecastMovements = useMemo<Movement[]>(() => {
    const expenseForecast = (expensesData || []).flatMap((expense): Movement[] => {
      if (["paid", "draft", "cancelled", "reconciled"].includes(expense.status)) return [];
      const date = toDate(expense.dueDate) || toDate(expense.competenceDate);
      if (!date || date < periodStart || date > periodEnd) return [];
      return [{
        id: `forecast-${expense.id}`,
        source: expense.provisionType === "forecast" ? "expense_forecast" : "expense",
        date,
        description: expense.description || "Despesa prevista",
        accountId: expense.bankAccountId || expense.paymentAccountId,
        accountName: expense.bankAccountName || expense.paymentAccountName,
        accountPlanId: expense.accountId || expense.accountPlan,
        accountPlanName:
          expense.accountPlanName ||
          accountPlanMap.get(expense.accountId || expense.accountPlan) ||
          undefined,
        supplier: expense.supplier || undefined,
        expenseId: expense.id,
        competenceDate: toDate(expense.competenceDate),
        dueDate: toDate(expense.dueDate),
        direction: "out" as const,
        status: "forecast" as const,
        amount: expense.status === "partially_paid" && expense.settlementSummary?.balanceAmountCents != null
          ? Number(expense.settlementSummary.balanceAmountCents) / 100
          : Number(expense.totalValue) || 0,
      }];
    });
    const residual: Movement[] = budgetProjections.projections.map((projection) => ({
      id: `budget-residual-${projection.id}`, source: "budget_residual", date: new Date(`${projection.date}T12:00:00`),
      description: `Compra planejada: ${projection.description} · ${projection.resultCenterName}${projection.requiresReview ? " · a conferir" : ""}`,
      accountPlanId: projection.accountPlanId, competenceDate: new Date(`${projection.competenceMonth}-01T12:00:00`),
      direction: "out", status: "forecast", amount: projection.amountCents / 100,
    }));
    if (!includeBudgetScenario) return [...expenseForecast, ...residual];
    const budgetForecast: Movement[] = monthlyBudgets.filter((budget) => budgetScenarioAmount(budget) > 0)
      .map((budget) => ({
        id: `budget-scenario-${budget.id}`,
        source: "budget_scenario",
        date: endOfMonth(new Date()),
        description: `Estimativa adicional do orçamento: ${budget.name}`,
        direction: "out" as const,
        status: "forecast" as const,
        amount: budgetScenarioAmount(budget) / 100,
      }));
    return [...expenseForecast, ...residual, ...budgetForecast];
  }, [accountPlanMap, expensesData, includeBudgetScenario, monthlyBudgets, periodEnd, periodStart, budgetProjections]);

  const allMovements = useMemo(
    () => [...realizedMovements, ...forecastMovements].sort((left, right) => right.date.getTime() - left.date.getTime()),
    [forecastMovements, realizedMovements]
  );

  const scopedRealized = useMemo(
    () => realizedMovements.filter((movement) => accountFilter === "all" || movement.accountId === accountFilter),
    [accountFilter, realizedMovements]
  );
  const scopedForecast = useMemo(
    () => forecastMovements.filter((movement) => accountFilter === "all" || movement.accountId === accountFilter),
    [accountFilter, forecastMovements]
  );

  const filteredMovements = useMemo(() => allMovements.filter((movement) => {
    const matchesAccount = accountFilter === "all" || movement.accountId === accountFilter;
    const matchesStatus = statusFilter === "all" || movement.status === statusFilter;
    const matchesDirection = directionFilter === "all" || movement.direction === directionFilter;
    return matchesAccount && matchesStatus && matchesDirection;
  }), [accountFilter, allMovements, directionFilter, statusFilter]);

  const totals = useMemo(() => {
    const realizedIncome = scopedRealized.filter((item) => item.direction === "in").reduce((sum, item) => sum + item.amount, 0);
    const realizedOutcome = scopedRealized.filter((item) => item.direction === "out").reduce((sum, item) => sum + item.amount, 0);
    const { payable: accountsPayable, planning: plannedPurchases, scenario: budgetScenarioAmount } = cashForecastTotals(scopedForecast);
    const realizedBalance = realizedIncome - realizedOutcome;
    return { realizedIncome, realizedOutcome, accountsPayable, plannedPurchases, budgetScenarioAmount, realizedBalance,
      projectedBalance: realizedBalance - accountsPayable - plannedPurchases - budgetScenarioAmount };
  }, [scopedForecast, scopedRealized]);

  const chartData = useMemo(() => {
    const map: Record<string, { key: string; month: string; income: number; outcome: number; forecast: number; balance: number }> = {};
    for (let index = months - 1; index >= 0; index -= 1) {
      const date = subMonths(new Date(), index);
      const key = format(date, "yyyy-MM");
      map[key] = { key, month: format(date, "MMM/yy", { locale: ptBR }), income: 0, outcome: 0, forecast: 0, balance: 0 };
    }
    scopedRealized.forEach((movement) => {
      const bucket = map[format(movement.date, "yyyy-MM")];
      if (!bucket) return;
      if (movement.direction === "in") bucket.income += movement.amount;
      else bucket.outcome += movement.amount;
    });
    scopedForecast.forEach((movement) => {
      const bucket = map[format(movement.date, "yyyy-MM")];
      if (bucket) bucket.forecast += movement.amount;
    });
    let balance = 0;
    return Object.values(map).map((bucket) => {
      balance += bucket.income - bucket.outcome - bucket.forecast;
      return { ...bucket, balance };
    });
  }, [months, scopedForecast, scopedRealized]);

  const expenseLifecycleData = useMemo(
    () => buildExpenseLifecycleData(expensesData || [], months),
    [expensesData, months]
  );

  function exportCsv() {
    if (filteredMovements.length === 0) return;
    const csv = buildCashFlowCsv(filteredMovements);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `fluxo-de-caixa-${format(new Date(), "yyyy-MM-dd")}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  if (!canView) {
    return <FinancialAccessGuard title="Fluxo de caixa" description="Seu perfil não possui permissão para consultar o fluxo de caixa." />;
  }

  const loading = loadingTransactions || loadingPayments || loadingExpenses || loadingAccountPlans;

  return (
    <PageContainer variant="compact" className="space-y-6 pb-10">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Fluxo de caixa</h1>
          <p className="text-muted-foreground">Visão global do realizado, das contas a pagar e do saldo projetado.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={accountFilter} onValueChange={setAccountFilter}>
            <SelectTrigger className="w-44"><Wallet className="mr-2 h-3.5 w-3.5" /><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as contas</SelectItem>
              {accounts.filter((account) => account.active).map((account) => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-44"><CalendarRange className="mr-2 h-3.5 w-3.5" /><SelectValue /></SelectTrigger>
            <SelectContent>{PERIOD_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={filteredMovements.length === 0}>
            <Download className="mr-2 h-4 w-4" /> Exportar CSV
          </Button>
          {permissions.financial?.cashFlow?.create && <Button size="sm" onClick={() => setDialogOpen(true)}><Plus className="mr-2 h-4 w-4" />Novo lançamento</Button>}
        </div>
      </div>

      {(budgetError || !budgetScopeReady || budgetLoading) && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{budgetError || (budgetLoading ? "Atualizando planejamento…" : "Selecione abaixo um centro autorizado para incluir o planejamento por orçamento.")} O saldo projetado fica incompleto até essa conferência.</p>}
      {budgetProjections.conflictCount > 0 && <p className="text-sm text-amber-700">Há {budgetProjections.conflictCount} linha(s) com provisão antiga. Mantivemos a fonte antiga e suspendemos a nova projeção para evitar duplicidade. A conversão depende de prévia e confirmação.</p>}
      {budgetProjections.issueCount > 0 && <p className="text-sm text-amber-700">Há classificações ou coberturas a conferir nos orçamentos.</p>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Kpi label="Saldo realizado" value={totals.realizedBalance} detail="Entradas menos saídas realizadas" tone="neutral" icon={Wallet} />
        <Kpi label="Entradas realizadas" value={totals.realizedIncome} detail="Recebimentos do período" tone="positive" icon={TrendingUp} />
        <Kpi label="Saídas realizadas" value={totals.realizedOutcome} detail="Pagamentos do período" tone="negative" icon={TrendingDown} />
        <Kpi label="Contas a pagar" value={totals.accountsPayable} detail="Despesas abertas no período" tone="warning" icon={CircleDollarSign} />
        <Kpi label="Compras planejadas" value={totals.plannedPurchases} detail="Provisões e expectativas; não são novas dívidas" tone="warning" icon={CalendarRange} />
        <Kpi label="Saldo projetado" value={totals.projectedBalance} detail={includeBudgetScenario ? "Inclui simulação dos orçamentos" : "Saldo realizado menos previsões"} tone={totals.projectedBalance >= 0 ? "positive" : "negative"} icon={Wallet} />
      </div>

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle>Realizado × previsto</CardTitle>
          <CardDescription>Entradas, saídas, compromissos futuros e evolução acumulada no mesmo gráfico.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[320px] w-full">
            {loading ? <Skeleton className="h-full w-full" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.12} />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis tickLine={false} axisLine={false} fontSize={10} tickFormatter={(value) => `R$${Math.round(value / 1000)}k`} />
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  <Legend />
                  <Bar dataKey="income" name="Entradas realizadas" fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="outcome" name="Saídas realizadas" fill="#f43f5e" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="forecast" name="Saídas previstas" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  <Line type="monotone" dataKey="balance" name="Saldo projetado acumulado" stroke="#6366f1" strokeWidth={3} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle>Despesas provisionadas × pagas</CardTitle>
          <CardDescription>
            Leitura por competência. O provisionado representa todas as despesas válidas; o pago mostra a parcela já liquidada.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[280px] w-full">
            {loading ? <Skeleton className="h-full w-full" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={expenseLifecycleData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.12} />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis tickLine={false} axisLine={false} fontSize={10} tickFormatter={(value) => `R$${Math.round(value / 1000)}k`} />
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  <Legend />
                  <Bar dataKey="provisioned" name="Provisionado" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="paid" name="Pago" fill="#10b981" radius={[4, 4, 0, 0]} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-[#e2ded4] shadow-sm">
        <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div><CardTitle>Orçamento da categoria</CardTitle><CardDescription>Limite do mês por competência. A linha tracejada é a referência fixa; a linha sólida mostra o disponível após as despesas.</CardDescription></div>
          <div className="flex w-full gap-2 sm:w-auto">
          {monthlyBudgets.length > 0 && <Select value={selectedBudget?.id} onValueChange={setSelectedBudgetId}>
            <SelectTrigger className="w-full sm:w-64"><SelectValue placeholder="Selecione um orçamento" /></SelectTrigger>
            <SelectContent>{monthlyBudgets.map((budget) => <SelectItem key={budget.id} value={budget.id}>{budget.name}</SelectItem>)}</SelectContent>
          </Select>}
          <Button variant="outline" size="icon" aria-label="Atualizar orçamento" disabled={budgetLoading} onClick={() => void refreshBudgets()}><RefreshCw className={cn("h-4 w-4", budgetLoading && "animate-spin")} /></Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 space-y-2"><p className="text-sm font-medium">Escopo do planejamento por orçamento</p>
            <Select value={budgetCenterId || (allBudgetUnits ? "all" : undefined)} onValueChange={(value) => setBudgetCenterId(value === "all" ? "" : value)}><SelectTrigger aria-label="Centro do planejamento"><SelectValue placeholder="Escolha um centro" /></SelectTrigger><SelectContent>
              {allBudgetUnits && <SelectItem value="all">Todos os centros</SelectItem>}{visibleBudgetCenters.map((center) => <SelectItem key={center.id} value={center.id}>{center.name}</SelectItem>)}
            </SelectContent></Select>
            <p className="text-xs text-muted-foreground">Este filtro afeta somente orçamentos. As despesas mantêm os filtros gerais. Compras planejadas sem conta bancária definida aparecem apenas em “Todas as contas”.</p>
          </div>
          <label className="mb-4 flex items-start gap-2 rounded-xl border bg-muted/20 p-3 text-sm">
            <Checkbox checked={includeBudgetScenario} onCheckedChange={(checked) => setIncludeBudgetScenario(checked === true)} disabled={accountFilter !== "all"} />
            <span><strong>Simular envelopes sem composição pessoal</strong><span className="block text-xs text-muted-foreground">Inclui o saldo livre dos demais envelopes no último dia do mês. Orçamentos por colaborador já entram pela compra ainda prevista e sua data, sem nova soma aqui. As despesas mantêm suas datas. Disponível apenas em “Todas as contas”.</span></span>
          </label>
          {budgetError ? <p className="text-sm text-amber-700">{budgetError}</p> : !selectedBudget
            ? <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhum orçamento ativo para {budgetMonth}.</p>
            : <><div className="mb-5 grid gap-3 sm:grid-cols-3">
                {[["Orçado", selectedBudget.budgetedAmountCents], ["Comprometido", selectedBudget.consumedAmountCents], ["Disponível", selectedBudget.balanceAmountCents]].map(([label, cents]) =>
                  <div key={label} className="rounded-xl border bg-muted/30 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="font-mono text-lg font-bold">{formatCurrency(Number(cents) / 100)}</p></div>)}
              </div><div className="h-[280px] w-full"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={selectedBudget.curve} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.12} />
                <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis tickLine={false} axisLine={false} fontSize={10} tickFormatter={(value) => `R$${Math.round(value / 100000)}k`} />
                <Tooltip formatter={(value: number) => formatCurrency(value / 100)} />
                <Legend />
                <Line type="linear" dataKey="plannedBalanceCents" name="Referência planejada" stroke="#94a3b8" strokeDasharray="5 5" strokeWidth={2} dot={false} />
                <Line type="stepAfter" dataKey="actualBalanceCents" name="Disponível após despesas" stroke="#2563eb" strokeWidth={3} dot={false} connectNulls={false} />
              </ComposedChart></ResponsiveContainer></div>
              <p className="mt-3 text-xs text-muted-foreground">Este saldo é do orçamento da categoria. Ele não representa o saldo bancário.</p></>}
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader className="gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <CardTitle>Movimentações</CardTitle>
            <CardDescription>Uma linha do tempo única para valores realizados e previstos.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36 shrink-0 gap-2 [&>span]:whitespace-nowrap"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">Todos</SelectItem><SelectItem value="realized">Realizados</SelectItem><SelectItem value="forecast">Previstos</SelectItem></SelectContent>
            </Select>
            <Select value={directionFilter} onValueChange={setDirectionFilter}>
              <SelectTrigger className="w-44 shrink-0 gap-2 [&>span]:whitespace-nowrap"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">Entradas e saídas</SelectItem><SelectItem value="in">Entradas</SelectItem><SelectItem value="out">Saídas</SelectItem></SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-48 w-full" /> : filteredMovements.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">Nenhuma movimentação encontrada para os filtros selecionados.</div>
          ) : (
            <div className="divide-y rounded-xl border">
              {filteredMovements.slice(0, 50).map((movement) => (
                <div key={movement.id} className="grid gap-3 px-4 py-3 sm:grid-cols-[100px_minmax(0,1fr)_120px_140px] sm:items-center">
                  <div>
                    <p className="text-xs font-medium">{format(movement.date, "dd/MM/yyyy")}</p>
                    <p className="text-[10px] text-muted-foreground">Movimentação</p>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{movement.description}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[movement.supplier, movement.accountPlanName].filter(Boolean).join(" · ") || "Sem plano de contas informado"}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {movement.accountName || (movement.status === "forecast" ? "Conta financeira a definir" : "Sem conta financeira")}
                      {movement.competenceDate ? ` · Competência ${format(movement.competenceDate, "MM/yyyy")}` : ""}
                      {movement.dueDate ? ` · Venc. ${format(movement.dueDate, "dd/MM/yyyy")}` : ""}
                    </p>
                  </div>
                  <Badge variant="outline" className={cn("w-fit", movement.status === "realized" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700")}>{movement.status === "realized" ? "Realizado" : "Previsto"}</Badge>
                  <span className={cn("text-right font-mono text-sm font-bold", movement.direction === "in" ? "text-emerald-600" : "text-rose-600")}>{movement.direction === "in" ? "+" : "-"}{formatCurrency(movement.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {permissions.financial?.cashFlow?.create && <NewTransactionDialog open={dialogOpen} onOpenChange={setDialogOpen} />}
    </PageContainer>
  );
}
