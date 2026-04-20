"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, AlertCircle, Calendar as CalendarIcon, CheckCircle2, TrendingDown } from "lucide-react";
import { endOfMonth, format, isAfter, isBefore, startOfMonth, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { FinancialAccessGuard } from "@/features/financial/components/financial-access-guard";
import { financialCollection } from "@/features/financial/lib/repositories";
import { formatCurrency, toDate } from "@/features/financial/lib/utils";
import { useFinancialCollection } from "@/features/financial/hooks/use-financial-collection";
import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const PERIOD_OPTIONS = [
  { label: "Último mês", value: "1" },
  { label: "Últimos 3 meses", value: "3" },
  { label: "Últimos 6 meses", value: "6" },
  { label: "Últimos 12 meses", value: "12" },
];

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  pending: { label: "Pendente", className: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
  paid: { label: "Pago", className: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" },
};

export function FinancialFlowPage() {
  const { permissions } = useAuth();
  const [monthsBack, setMonthsBack] = useState("6");
  const [statusFilter, setStatusFilter] = useState("all");
  const { data: expenses, loading } = useFinancialCollection<any>(financialCollection("expenses"));
  const { data: accountPlans } = useFinancialCollection<any>(financialCollection("accountPlans"));

  if (!permissions.financial?.financialFlow) {
    return (
      <FinancialAccessGuard
        title="Fluxo financeiro"
        description="Seu perfil não possui permissão para visualizar a análise de despesas provisionadas e pagas."
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

  const { filtered, chartData, totals } = useMemo(() => {
    if (!expenses) {
      return { filtered: [], chartData: [], totals: { pending: 0, paid: 0 } };
    }

    const periodMonths = Number.parseInt(monthsBack, 10);
    const start = startOfMonth(subMonths(new Date(), periodMonths - 1));
    const end = endOfMonth(new Date());

    const inPeriod = expenses.filter((expense) => {
      const date = toDate(expense.competenceDate) || toDate(expense.dueDate);
      if (!date) return false;
      return isAfter(date, start) && isBefore(date, end);
    });

    const filteredForTable = inPeriod.filter(
      (expense) => statusFilter === "all" || expense.status === statusFilter
    );

    const monthsMap: Record<string, { month: string; rawDate: Date; expenses: number; paid: number }> = {};
    for (let index = 0; index < periodMonths; index += 1) {
      const date = subMonths(new Date(), index);
      const key = format(date, "MMM/yy", { locale: ptBR });
      monthsMap[key] = { month: key, rawDate: startOfMonth(date), expenses: 0, paid: 0 };
    }

    inPeriod.forEach((expense) => {
      const date = toDate(expense.competenceDate) || toDate(expense.dueDate);
      if (!date) return;
      const key = format(date, "MMM/yy", { locale: ptBR });
      if (!monthsMap[key]) return;
      monthsMap[key].expenses += expense.totalValue || 0;
      if (expense.status === "paid") monthsMap[key].paid += expense.totalValue || 0;
    });

    return {
      filtered: filteredForTable,
      chartData: Object.values(monthsMap).sort((a, b) => a.rawDate.getTime() - b.rawDate.getTime()),
      totals: {
        pending: inPeriod.filter((expense) => expense.status === "pending").reduce((sum, expense) => sum + (expense.totalValue || 0), 0),
        paid: inPeriod.filter((expense) => expense.status === "paid").reduce((sum, expense) => sum + (expense.totalValue || 0), 0),
      },
    };
  }, [expenses, monthsBack, statusFilter]);

  function exportCsv() {
    if (!filtered.length) return;
    const header = "Descrição,Plano de contas,Valor,Competência,Vencimento,Status\n";
    const rows = filtered
      .map((expense) => {
        const competence = toDate(expense.competenceDate);
        const due = toDate(expense.dueDate);
        return [
          `"${expense.description.replace(/"/g, '""')}"`,
          `"${(accountPlanMap[expense.accountPlan] || expense.accountPlanName || expense.accountPlan || "").replace(/"/g, '""')}"`,
          (expense.totalValue || 0).toFixed(2),
          competence ? format(competence, "dd/MM/yyyy") : "",
          due ? format(due, "dd/MM/yyyy") : "",
          STATUS_CONFIG[expense.status]?.label || expense.status,
        ].join(",");
      })
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `fluxo-financeiro-${format(new Date(), "yyyy-MM-dd")}.csv`;
    link.click();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Fluxo financeiro</h1>
          <p className="text-muted-foreground">Análise de despesas provisionadas e liquidadas por período.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={monthsBack} onValueChange={setMonthsBack}>
            <SelectTrigger className="w-[180px]">
              <CalendarIcon className="mr-2 h-4 w-4 opacity-50" />
              <SelectValue placeholder="Período" />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={exportCsv} disabled={!filtered.length}>
            <Download className="mr-2 h-4 w-4" /> Exportar
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total em aberto</CardTitle>
            <AlertCircle className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-500">{formatCurrency(totals.pending)}</div>
            <p className="mt-1 text-xs text-muted-foreground">Compromissos futuros</p>
          </CardContent>
        </Card>
        <Card className="border-emerald-500/20 bg-emerald-500/5">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total pago</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-500">{formatCurrency(totals.paid)}</div>
            <p className="mt-1 text-xs text-muted-foreground">Liquidados no período</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Volume total</CardTitle>
            <TrendingDown className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totals.pending + totals.paid)}</div>
            <p className="mt-1 text-xs text-muted-foreground">Provisionado + pago</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Provisionado vs pago</CardTitle>
            <CardDescription>Comparativo mensal de despesas lançadas e liquidadas.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[350px] w-full">
              {loading ? (
                <Skeleton className="h-full w-full" />
              ) : chartData.length === 0 ? (
                <div className="flex h-full items-center justify-center rounded-md border border-dashed text-muted-foreground">
                  Sem dados para o gráfico no período.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.1} />
                    <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={12} />
                    <YAxis tickLine={false} axisLine={false} fontSize={12} tickFormatter={(value) => `R$ ${value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value}`} />
                    <Tooltip formatter={(value: number) => formatCurrency(value)} />
                    <Bar dataKey="expenses" name="Provisionado" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="paid" name="Pago" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tabela do período</CardTitle>
            <CardDescription>Filtre para revisar apenas os itens relevantes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="pending">Pendentes</SelectItem>
                <SelectItem value="paid">Pagos</SelectItem>
              </SelectContent>
            </Select>

            <div className="max-h-[320px] overflow-x-auto overflow-y-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Despesa</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.slice(0, 12).map((expense) => (
                    <TableRow key={expense.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{expense.description}</p>
                          <p className="text-xs text-muted-foreground">
                            {accountPlanMap[expense.accountPlan] || expense.accountPlanName || expense.accountPlan || "—"}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={STATUS_CONFIG[expense.status]?.className}>
                          {STATUS_CONFIG[expense.status]?.label || expense.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(expense.totalValue || 0)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
