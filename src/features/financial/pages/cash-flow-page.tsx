"use client";

import { useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { endOfMonth, format, startOfMonth, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarRange, CircleDollarSign, Download, Plus, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { NewTransactionDialog } from "@/features/financial/components/cash-flow/new-transaction-dialog";
import { FinancialAccessGuard } from "@/features/financial/components/financial-access-guard";
import { financialCollection } from "@/features/financial/lib/repositories";
import { formatCurrency, toDate } from "@/features/financial/lib/utils";
import { buildCashFlowCsv, buildExpenseLifecycleData } from "@/features/financial/lib/cash-flow-analysis";
import { useFinancialCollection } from "@/features/financial/hooks/use-financial-collection";
import type { Account } from "@/features/financial/types/account";
import type { Transaction } from "@/features/financial/types/transaction";
import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Movement = {
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
  const { permissions } = useAuth();
  const [accountFilter, setAccountFilter] = useState("all");
  const [period, setPeriod] = useState("3");
  const [statusFilter, setStatusFilter] = useState("all");
  const [directionFilter, setDirectionFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const { data: accountsData } = useFinancialCollection<Account>(financialCollection("bankAccounts"));
  const { data: transactionsData, loading: loadingTransactions } = useFinancialCollection<Transaction>(financialCollection("transactions"));
  const { data: paymentsData, loading: loadingPayments } = useFinancialCollection<any>(financialCollection("payments"));
  const { data: expensesData, loading: loadingExpenses } = useFinancialCollection<any>(financialCollection("expenses"));
  const { data: accountPlansData, loading: loadingAccountPlans } = useFinancialCollection<any>(financialCollection("accounts"));

  const canView = Boolean(permissions.financial?.cashFlow?.view || permissions.financial?.financialFlow);
  const months = Number.parseInt(period, 10);
  const periodStart = startOfMonth(subMonths(new Date(), months - 1));
  const periodEnd = endOfMonth(new Date());
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
    const paymentTransactions = (paymentsData || []).flatMap((payment) =>
      (payment.splits || []).map((split: any, splitIndex: number) => ({
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
      }))
    );

    return [...(transactionsData || []), ...paymentTransactions].flatMap((transaction: any) => {
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

  const forecastMovements = useMemo<Movement[]>(() =>
    (expensesData || []).flatMap((expense) => {
      if (["paid", "draft", "cancelled"].includes(expense.status)) return [];
      const date = toDate(expense.dueDate) || toDate(expense.competenceDate);
      if (!date || date < periodStart || date > periodEnd) return [];
      return [{
        id: `forecast-${expense.id}`,
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
        amount: Number(expense.totalValue) || 0,
      }];
    }), [accountPlanMap, expensesData, periodEnd, periodStart]);

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
    const accountsPayable = scopedForecast.reduce((sum, item) => sum + item.amount, 0);
    const realizedBalance = realizedIncome - realizedOutcome;
    return { realizedIncome, realizedOutcome, accountsPayable, realizedBalance, projectedBalance: realizedBalance - accountsPayable };
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
    <div className="mx-auto w-full max-w-[1220px] space-y-6 pb-10">
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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label="Saldo realizado" value={totals.realizedBalance} detail="Entradas menos saídas realizadas" tone="neutral" icon={Wallet} />
        <Kpi label="Entradas realizadas" value={totals.realizedIncome} detail="Recebimentos do período" tone="positive" icon={TrendingUp} />
        <Kpi label="Saídas realizadas" value={totals.realizedOutcome} detail="Pagamentos do período" tone="negative" icon={TrendingDown} />
        <Kpi label="Contas a pagar" value={totals.accountsPayable} detail="Despesas abertas no período" tone="warning" icon={CircleDollarSign} />
        <Kpi label="Saldo projetado" value={totals.projectedBalance} detail="Saldo realizado menos previsões" tone={totals.projectedBalance >= 0 ? "positive" : "negative"} icon={Wallet} />
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
    </div>
  );
}
