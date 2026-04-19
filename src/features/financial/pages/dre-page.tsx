"use client";

import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, Landmark, Receipt, TrendingDown, TrendingUp } from "lucide-react";
import { endOfMonth, format, startOfMonth, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { FinancialAccessGuard } from "@/features/financial/components/financial-access-guard";
import { financialCollection } from "@/features/financial/lib/repositories";
import { formatCurrency, toDate } from "@/features/financial/lib/utils";
import { useFinancialCollection } from "@/features/financial/hooks/use-financial-collection";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

export function DrePage() {
  const { permissions } = useAuth();
  const [monthsBack, setMonthsBack] = useState("6");
  const { data: transactions, loading: loadingTransactions } = useFinancialCollection<any>(
    financialCollection("transactions")
  );
  const { data: payments, loading: loadingPayments } = useFinancialCollection<any>(
    financialCollection("payments")
  );
  const { data: expenses } = useFinancialCollection<any>(financialCollection("expenses"));
  const { data: accountPlans } = useFinancialCollection<any>(financialCollection("accountPlans"));
  const loading = loadingTransactions || loadingPayments;

  if (!permissions.financial?.dre) {
    return (
      <FinancialAccessGuard
        title="DRE"
        description="Seu perfil não possui permissão para acessar o demonstrativo de resultado."
      />
    );
  }

  const accountPlanMap = useMemo(() => {
    const map: Record<string, string> = {};
    (accountPlans || []).forEach((plan) => {
      map[plan.id] = plan.name;
    });
    return map;
  }, [accountPlans]);

  const months = Number.parseInt(monthsBack, 10);
  const chartData = useMemo(() => {
    const map: Record<string, { month: string; revenue: number; paidExpenses: number; result: number }> = {};
    for (let index = months - 1; index >= 0; index -= 1) {
      const date = subMonths(new Date(), index);
      const key = format(date, "yyyy-MM");
      map[key] = {
        month: format(date, "MMM/yy", { locale: ptBR }),
        revenue: 0,
        paidExpenses: 0,
        result: 0,
      };
    }

    (transactions || []).forEach((transaction) => {
      const date = toDate(transaction.date);
      if (!date) return;
      const key = format(date, "yyyy-MM");
      if (!map[key]) return;
      if (transaction.direction === "in" && transaction.type !== "transfer_in") {
        map[key].revenue += transaction.amount || 0;
      }
    });

    (payments || []).forEach((payment) => {
      const date = toDate(payment.paidAt);
      if (!date) return;
      const key = format(date, "yyyy-MM");
      if (!map[key]) return;
      map[key].paidExpenses += payment.totalPaid || 0;
    });

    Object.values(map).forEach((item) => {
      item.result = item.revenue - item.paidExpenses;
    });

    return Object.values(map);
  }, [months, payments, transactions]);

  const topExpensePlans = useMemo(() => {
    const totals: Record<string, number> = {};
    (expenses || []).forEach((expense) => {
      if (expense.status === "cancelled") return;
      const name = accountPlanMap[expense.accountPlan] || expense.accountPlanName || expense.accountPlan || "Sem classificação";
      totals[name] = (totals[name] || 0) + (expense.totalValue || 0);
    });
    return Object.entries(totals)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [accountPlanMap, expenses]);

  const totals = useMemo(() => {
    const revenue = chartData.reduce((sum, item) => sum + item.revenue, 0);
    const paidExpenses = chartData.reduce((sum, item) => sum + item.paidExpenses, 0);
    return { revenue, paidExpenses, result: revenue - paidExpenses };
  }, [chartData]);

  function exportCsv() {
    const rows = [
      ["Indicador", "Valor"],
      ["Receitas", formatCurrency(totals.revenue)],
      ["Despesas pagas", formatCurrency(totals.paidExpenses)],
      ["Resultado", formatCurrency(totals.result)],
      [],
      ["Plano de contas", "Total provisionado"],
      ...topExpensePlans.map((row) => [row.name, formatCurrency(row.value)]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${cell ?? ""}"`).join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `dre-${format(new Date(), "yyyy-MM")}.csv`;
    link.click();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">DRE</h1>
          <p className="text-muted-foreground">Demonstrativo simplificado com receitas realizadas e despesas pagas por período.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={monthsBack} onValueChange={setMonthsBack}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="3">Últimos 3 meses</SelectItem>
              <SelectItem value="6">Últimos 6 meses</SelectItem>
              <SelectItem value="12">Últimos 12 meses</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={exportCsv}>
            <Download className="mr-2 h-4 w-4" /> Exportar
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-emerald-500/20 bg-emerald-500/5">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Receitas</CardTitle>
            <TrendingUp className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-500">{formatCurrency(totals.revenue)}</div>
          </CardContent>
        </Card>
        <Card className="border-rose-500/20 bg-rose-500/5">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Despesas pagas</CardTitle>
            <TrendingDown className="h-4 w-4 text-rose-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-rose-500">{formatCurrency(totals.paidExpenses)}</div>
          </CardContent>
        </Card>
        <Card className="border-primary/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Resultado</CardTitle>
            <Landmark className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totals.result)}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Evolução do resultado</CardTitle>
            <CardDescription>Receita realizada menos despesas pagas por mês.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[360px]">
              {loading ? (
                <Skeleton className="h-full w-full" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.1} />
                    <XAxis dataKey="month" tickLine={false} axisLine={false} />
                    <YAxis tickLine={false} axisLine={false} tickFormatter={(value) => `R$ ${value / 1000}k`} />
                    <Tooltip formatter={(value: number) => formatCurrency(value)} />
                    <Legend />
                    <Area type="monotone" dataKey="revenue" name="Receita" stroke="hsl(var(--chart-2))" fill="hsl(var(--chart-2))" fillOpacity={0.12} />
                    <Area type="monotone" dataKey="paidExpenses" name="Despesas pagas" stroke="hsl(var(--chart-1))" fill="hsl(var(--chart-1))" fillOpacity={0.12} />
                    <Area type="monotone" dataKey="result" name="Resultado" stroke="hsl(var(--chart-3))" fill="hsl(var(--chart-3))" fillOpacity={0.14} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-primary" />
              Top planos de despesa
            </CardTitle>
            <CardDescription>Ranking por valor provisionado.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {topExpensePlans.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum dado disponível.</p>
              ) : (
                topExpensePlans.map((row) => (
                  <div key={row.name} className="flex items-center justify-between rounded-lg border p-3">
                    <span className="max-w-[200px] truncate text-sm">{row.name}</span>
                    <span className="font-mono text-sm font-semibold">{formatCurrency(row.value)}</span>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
