"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowLeftRight, Plus, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { NewTransactionDialog } from "@/features/financial/components/cash-flow/new-transaction-dialog";
import { FinancialAccessGuard } from "@/features/financial/components/financial-access-guard";
import { financialCollection } from "@/features/financial/lib/repositories";
import { formatCurrency, toDate } from "@/features/financial/lib/utils";
import { useFinancialCollection } from "@/features/financial/hooks/use-financial-collection";
import type { Account } from "@/features/financial/types/account";
import type { Transaction } from "@/features/financial/types/transaction";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function CashFlowPage() {
  const { permissions } = useAuth();
  const [accountFilter, setAccountFilter] = useState("all");
  const [monthsBack, setMonthsBack] = useState("3");
  const [dialogOpen, setDialogOpen] = useState(false);
  const { data: accountsData } = useFinancialCollection<Account>(financialCollection("bankAccounts"));
  const { data: transactionsData, loading: loadingTransactions } = useFinancialCollection<Transaction>(
    financialCollection("transactions")
  );
  const { data: paymentsData, loading: loadingPayments } = useFinancialCollection<any>(
    financialCollection("payments")
  );

  const accounts = accountsData || [];
  const transactions = transactionsData || [];
  const payments = paymentsData || [];
  const loading = loadingTransactions || loadingPayments;

  if (!permissions.financial?.cashFlow?.view) {
    return (
      <FinancialAccessGuard
        title="Fluxo de caixa"
        description="Seu perfil não possui permissão para consultar movimentações e saldos do fluxo de caixa."
      />
    );
  }

  const months = Number.parseInt(monthsBack, 10);
  const periodStart = startOfMonth(subMonths(new Date(), months - 1));
  const periodEnd = endOfMonth(new Date());

  const allTransactions = useMemo(() => {
    const paymentTransactions: Transaction[] = payments.flatMap((payment) =>
      (payment.splits || []).map((split: any) => ({
        id: `${payment.id}-${split.accountId}`,
        type: "expense_payment",
        direction: "out",
        accountId: split.accountId,
        accountName: split.accountName,
        paymentMethodLabel: split.paymentMethodLabel,
        amount: split.amount,
        date: payment.paidAt,
        description: "Pagamento de despesa",
        createdBy: payment.createdBy,
        createdAt: payment.createdAt,
      }))
    );

    return [...transactions, ...paymentTransactions]
      .filter((transaction) => {
        const date = toDate(transaction.date);
        if (!date) return false;
        const inPeriod = date >= periodStart && date <= periodEnd;
        const inAccount = accountFilter === "all" || transaction.accountId === accountFilter;
        return inPeriod && inAccount;
      })
      .sort((a, b) => (toDate(b.date)?.getTime() || 0) - (toDate(a.date)?.getTime() || 0));
  }, [accountFilter, payments, periodEnd, periodStart, transactions]);

  const totals = useMemo(() => {
    const income = allTransactions
      .filter((transaction) => transaction.direction === "in" && transaction.type !== "transfer_in")
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    const outcome = allTransactions
      .filter((transaction) => transaction.direction === "out" && transaction.type !== "transfer_out")
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    const transfers = allTransactions
      .filter((transaction) => transaction.type === "transfer_out")
      .reduce((sum, transaction) => sum + transaction.amount, 0);

    return {
      income,
      outcome,
      transfers,
      balance: income - outcome,
    };
  }, [allTransactions]);

  const chartData = useMemo(() => {
    const map: Record<string, { month: string; income: number; outcome: number }> = {};
    for (let index = months - 1; index >= 0; index -= 1) {
      const date = subMonths(new Date(), index);
      const key = format(date, "yyyy-MM");
      map[key] = {
        month: format(date, "MMM/yy", { locale: ptBR }),
        income: 0,
        outcome: 0,
      };
    }

    allTransactions.forEach((transaction) => {
      const date = toDate(transaction.date);
      if (!date) return;
      const key = format(date, "yyyy-MM");
      if (!map[key]) return;

      if (transaction.direction === "in" && transaction.type !== "transfer_in") {
        map[key].income += transaction.amount;
      }
      if (transaction.direction === "out" && transaction.type !== "transfer_out") {
        map[key].outcome += transaction.amount;
      }
    });

    return Object.values(map);
  }, [allTransactions, months]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Fluxo de caixa</h1>
          <p className="text-muted-foreground">Movimentações financeiras por conta e período.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={accountFilter} onValueChange={setAccountFilter}>
            <SelectTrigger className="w-44">
              <Wallet className="mr-2 h-3.5 w-3.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as contas</SelectItem>
              {accounts.filter((account) => account.active).map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {account.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={monthsBack} onValueChange={setMonthsBack}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Último mês</SelectItem>
              <SelectItem value="3">Últimos 3 meses</SelectItem>
              <SelectItem value="6">Últimos 6 meses</SelectItem>
            </SelectContent>
          </Select>
          {permissions.financial?.cashFlow?.create && (
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Novo lançamento
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-emerald-500/20 bg-emerald-500/5">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium">Entradas</CardTitle>
            <TrendingUp className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-500">{formatCurrency(totals.income)}</div>
          </CardContent>
        </Card>
        <Card className="border-rose-500/20 bg-rose-500/5">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium">Saídas</CardTitle>
            <TrendingDown className="h-4 w-4 text-rose-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-rose-500">{formatCurrency(totals.outcome)}</div>
          </CardContent>
        </Card>
        <Card className="border-sky-500/20 bg-sky-500/5">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium">Transferências</CardTitle>
            <ArrowLeftRight className="h-4 w-4 text-sky-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-sky-500">{formatCurrency(totals.transfers)}</div>
          </CardContent>
        </Card>
        <Card className={cn("border-primary/20", totals.balance >= 0 ? "bg-emerald-500/5" : "bg-rose-500/5")}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium">Saldo líquido</CardTitle>
            <Wallet className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className={cn("text-2xl font-bold", totals.balance >= 0 ? "text-emerald-500" : "text-rose-500")}>
              {formatCurrency(totals.balance)}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Entradas vs saídas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.1} />
                  <XAxis dataKey="month" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis fontSize={10} tickLine={false} axisLine={false} tickFormatter={(value) => `R$${value / 1000}k`} />
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  <Legend />
                  <Bar dataKey="income" name="Entradas" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="outcome" name="Saídas" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Lançamentos recentes</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <div className="max-h-[400px] space-y-4 overflow-y-auto px-6">
              {loading ? (
                <Skeleton className="h-40 w-full" />
              ) : allTransactions.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">Nenhum lançamento encontrado.</p>
              ) : (
                allTransactions.slice(0, 10).map((transaction) => {
                  const date = toDate(transaction.date);
                  return (
                    <div key={transaction.id} className="flex items-center justify-between border-b pb-3 last:border-0 last:pb-0">
                      <div className="space-y-1">
                        <p className="text-sm font-medium leading-none">{transaction.description}</p>
                        <p className="text-xs text-muted-foreground">
                          {date ? format(date, "dd/MM/yyyy") : "—"} • {transaction.accountName}
                        </p>
                      </div>
                      <div className={cn("font-mono text-sm font-bold", transaction.direction === "in" ? "text-emerald-500" : "text-rose-500")}>
                        {transaction.direction === "in" ? "+" : "-"}
                        {formatCurrency(transaction.amount)}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {permissions.financial?.cashFlow?.create && (
        <NewTransactionDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      )}
    </div>
  );
}
