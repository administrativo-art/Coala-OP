"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { endOfMonth, format, isBefore, isSameMonth, startOfDay, startOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ArrowRight,
  BarChart3,
  CircleDollarSign,
  Landmark,
  Wallet,
} from "lucide-react";
import { useFinancialDashboardIndicators } from "@/features/financial/hooks/use-dashboard-indicators";
import { FINANCIAL_ROUTES } from "@/features/financial/lib/constants";
import { formatCurrency, toDate } from "@/features/financial/lib/utils";
import { expenseValueForResultCenter } from "@/features/financial/lib/expense-rateio";
import { financialCollection } from "@/features/financial/lib/repositories";
import { useFinancialCollection } from "@/features/financial/hooks/use-financial-collection";
import { FinancialAccessGuard } from "@/features/financial/components/financial-access-guard";
import { useAuth } from "@/hooks/use-auth";
import { useKiosks } from "@/hooks/use-kiosks";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";

type ExpenseFilters = {
  dateFrom: string;
  dateTo: string;
  competenceMonth: string;
  supplier: string;
  status: string;
  accountPlan: string;
};

const DEFAULT_FILTERS: ExpenseFilters = {
  dateFrom: "",
  dateTo: "",
  competenceMonth: format(new Date(), "yyyy-MM"),
  supplier: "all",
  status: "all",
  accountPlan: "all",
};

function KpiCard({
  label,
  value,
  description,
  icon: Icon,
}: {
  label: string;
  value: string;
  description: string;
  icon: React.ElementType;
}) {
  return (
    <Card className="rounded-[18px] border-[#e3e1dc] bg-white shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] font-bold text-muted-foreground">{label}</p>
          <Icon className="h-4 w-4 text-[#db2777]" />
        </div>
        <div className="mt-3 font-mono text-xl font-semibold">{value}</div>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function getComputedStatus(expense: any, now: Date) {
  const due = toDate(expense.dueDate);
  if (["pending", "partially_paid"].includes(expense.status)) {
    if (expense.originModule === "purchasing" && expense.originStatus === "pending_audit") {
      return "pending_audit";
    }
    if (due && isBefore(due, now)) {
      return "overdue";
    }
  }
  return expense.status;
}

function expenseBelongsToUnit(expense: any, unitName: string) {
  if (expense.resultCenter === unitName) return true;
  if (Array.isArray(expense.apportionments)) {
    return expense.apportionments.some((item: any) => item?.resultCenter === unitName);
  }
  return false;
}

function matchesFilters(
  expense: any,
  filters: ExpenseFilters,
  accountPlanMap: Record<string, string>,
  now: Date
) {
  const due = toDate(expense.dueDate);
  const competence = toDate(expense.competenceDate);
  const supplier = expense.supplier || "";
  const accountPlanName = accountPlanMap[expense.accountId ?? expense.accountPlan] || expense.accountPlanName || expense.accountId || expense.accountPlan || "";
  const computedStatus = getComputedStatus(expense, now);

  if (filters.dateFrom && (!due || due < new Date(`${filters.dateFrom}T00:00:00`))) {
    return false;
  }
  if (filters.dateTo && (!due || due > new Date(`${filters.dateTo}T23:59:59`))) {
    return false;
  }
  if (filters.competenceMonth) {
    const [year, month] = filters.competenceMonth.split("-").map(Number);
    const monthDate = new Date(year, (month || 1) - 1, 1);
    if (!competence || !isSameMonth(competence, monthDate)) {
      return false;
    }
  }
  if (filters.supplier !== "all" && supplier !== filters.supplier) {
    return false;
  }
  if (filters.status !== "all" && computedStatus !== filters.status) {
    return false;
  }
  if (filters.accountPlan !== "all" && accountPlanName !== filters.accountPlan) {
    return false;
  }

  return true;
}

function ExpenseFiltersBar({
  filters,
  onChange,
  suppliers,
  accountPlans,
}: {
  filters: ExpenseFilters;
  onChange: (next: ExpenseFilters) => void;
  suppliers: string[];
  accountPlans: string[];
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
      <div>
        <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Data inicial</p>
        <Input className="h-9 rounded-[11px] text-[13px]" type="date" value={filters.dateFrom} onChange={(event) => onChange({ ...filters, dateFrom: event.target.value })} />
      </div>
      <div>
        <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Data final</p>
        <Input className="h-9 rounded-[11px] text-[13px]" type="date" value={filters.dateTo} onChange={(event) => onChange({ ...filters, dateTo: event.target.value })} />
      </div>
      <div>
        <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Competência</p>
        <Input className="h-9 rounded-[11px] text-[13px]" type="month" value={filters.competenceMonth} onChange={(event) => onChange({ ...filters, competenceMonth: event.target.value })} />
      </div>
      <div>
        <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Fornecedor</p>
        <Select value={filters.supplier} onValueChange={(value) => onChange({ ...filters, supplier: value })}>
          <SelectTrigger className="h-9 rounded-[11px] text-[13px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {suppliers.map((supplier) => (
              <SelectItem key={supplier} value={supplier}>{supplier}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Status</p>
        <Select value={filters.status} onValueChange={(value) => onChange({ ...filters, status: value })}>
          <SelectTrigger className="h-9 rounded-[11px] text-[13px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="pending">Em aberto</SelectItem>
            <SelectItem value="partially_paid">Parcialmente pago</SelectItem>
            <SelectItem value="overdue">Vencido</SelectItem>
            <SelectItem value="pending_audit">Pendente auditoria</SelectItem>
            <SelectItem value="paid">Pago</SelectItem>
            <SelectItem value="cancelled">Cancelado</SelectItem>
            <SelectItem value="draft">Rascunho</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Plano de contas</p>
        <Select value={filters.accountPlan} onValueChange={(value) => onChange({ ...filters, accountPlan: value })}>
          <SelectTrigger className="h-9 rounded-[11px] text-[13px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {accountPlans.map((accountPlan) => (
              <SelectItem key={accountPlan} value={accountPlan}>{accountPlan}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function ExpenseList({
  expenses,
  emptyMessage,
  resultCenter,
}: {
  expenses: any[];
  emptyMessage: string;
  resultCenter?: string;
}) {
  return expenses.length === 0 ? (
    <p className="rounded-[14px] border border-[#e3e1dc] bg-[#faf9f6] p-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>
  ) : (
    <div className="space-y-2">
      {expenses.map((expense) => (
        <div key={expense.id} className="flex items-center justify-between gap-4 rounded-[12px] border border-[#e3e1dc] bg-white p-3">
          <div className="min-w-0">
            <p className="truncate font-medium">{expense.description}</p>
            <p className="truncate text-xs text-muted-foreground">
              {expense.supplier || "—"} • {expense.accountPlanName || expense.accountId || expense.accountPlan || "—"} • Venc.{" "}
              {toDate(expense.dueDate) ? format(toDate(expense.dueDate)!, "dd/MM/yyyy") : "—"}
            </p>
          </div>
          <span className="shrink-0 font-mono text-sm font-semibold">
            {formatCurrency(expenseValueForResultCenter(expense, resultCenter))}
          </span>
        </div>
      ))}
    </div>
  );
}

function ExpenseSection({
  title,
  description,
  expenses,
  emptyMessage,
  filters,
  onFiltersChange,
  suppliers,
  accountPlans,
}: {
  title: string;
  description: string;
  expenses: any[];
  emptyMessage: string;
  filters: ExpenseFilters;
  onFiltersChange: (next: ExpenseFilters) => void;
  suppliers: string[];
  accountPlans: string[];
}) {
  return (
    <Card className="rounded-[18px] border-[#e3e1dc] bg-white shadow-sm">
      <CardHeader className="border-b border-[#ebe9e4] px-4 py-4">
        <CardTitle className="text-base font-bold">{title}</CardTitle>
        <CardDescription className="mt-1 text-sm">{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        <ExpenseFiltersBar
          filters={filters}
          onChange={onFiltersChange}
          suppliers={suppliers}
          accountPlans={accountPlans}
        />
        <ExpenseList expenses={expenses} emptyMessage={emptyMessage} />
      </CardContent>
    </Card>
  );
}

export function FinancialDashboardPage() {
  const { user, permissions } = useAuth();
  const { kiosks } = useKiosks();
  const expenseCollection = useFinancialCollection<any>(financialCollection("expenses"));
  const { indicators, loading } = useFinancialDashboardIndicators(expenseCollection);
  const { data: expenses } = expenseCollection;
  const { data: accountPlansData } = useFinancialCollection<any>(financialCollection("accounts"));
  const [monthFilters, setMonthFilters] = useState<ExpenseFilters>(DEFAULT_FILTERS);
  const [overdueFilters, setOverdueFilters] = useState<ExpenseFilters>(DEFAULT_FILTERS);
  const [auditFilters, setAuditFilters] = useState<ExpenseFilters>(DEFAULT_FILTERS);
  const [unitFilters, setUnitFilters] = useState<Record<string, ExpenseFilters>>({});

  if (!permissions.financial?.dashboard) {
    return (
      <PageContainer variant="wide" surface>
        <FinancialAccessGuard
          title="Painel financeiro"
          description="Seu perfil não possui permissão para visualizar o painel consolidado do financeiro."
        />
      </PageContainer>
    );
  }

  const expensesList = expenses || [];
  const now = startOfDay(new Date());
  const currentMonthStart = startOfMonth(now);
  const currentMonthEnd = endOfMonth(now);

  const accountPlanMap = useMemo(() => {
    const map: Record<string, string> = {};
    (accountPlansData || []).forEach((plan) => {
      map[plan.id] = plan.name;
    });
    return map;
  }, [accountPlansData]);

  const suppliers = useMemo(
    () =>
      Array.from(new Set(expensesList.map((expense) => expense.supplier).filter(Boolean))).sort((a, b) =>
        String(a).localeCompare(String(b), "pt-BR")
      ) as string[],
    [expensesList]
  );

  const accountPlans = useMemo(
    () =>
      Array.from(
        new Set(
          expensesList
            .map((expense) => accountPlanMap[expense.accountId ?? expense.accountPlan] || expense.accountPlanName || expense.accountId || expense.accountPlan)
            .filter(Boolean)
        )
      ).sort((a, b) => String(a).localeCompare(String(b), "pt-BR")) as string[],
    [accountPlanMap, expensesList]
  );

  const currentCompetenceExpenses = useMemo(
    () =>
      expensesList.filter((expense) => {
        const competence = toDate(expense.competenceDate);
        return competence && competence >= currentMonthStart && competence <= currentMonthEnd && matchesFilters(expense, monthFilters, accountPlanMap, now);
      }),
    [accountPlanMap, currentMonthEnd, currentMonthStart, expensesList, monthFilters, now]
  );

  const overdueExpenses = useMemo(
    () =>
      expensesList.filter((expense) => getComputedStatus(expense, now) === "overdue" && matchesFilters(expense, overdueFilters, accountPlanMap, now)),
    [accountPlanMap, expensesList, now, overdueFilters]
  );

  const pendingAuditExpenses = useMemo(
    () =>
      expensesList.filter((expense) => getComputedStatus(expense, now) === "pending_audit" && matchesFilters(expense, auditFilters, accountPlanMap, now)),
    [accountPlanMap, auditFilters, expensesList, now]
  );

  return (
    <PageContainer variant="wide" surface className="space-y-6 pb-10">
      <PageHeader
        title="Painel financeiro"
        description={`Visão consolidada do módulo financeiro para ${user?.username ?? "o usuário atual"}.`}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-28 w-full rounded-[18px]" />)
        ) : (
          <>
            <KpiCard
              label="Despesas em aberto"
              value={formatCurrency(indicators.openExpenses)}
              description="Compromissos ainda pendentes de liquidação."
              icon={CircleDollarSign}
            />
            <KpiCard
              label="Vencimentos em 30 dias"
              value={formatCurrency(indicators.upcomingDue)}
              description="Monitoramento do curto prazo."
              icon={BarChart3}
            />
            <KpiCard
              label="Caixa consolidado"
              value={formatCurrency(indicators.cash)}
              description="Entradas menos pagamentos e ajustes de saída."
              icon={Wallet}
            />
            <KpiCard
              label="Resultado DRE"
              value={formatCurrency(indicators.dre)}
              description="Receitas realizadas menos despesas pagas."
              icon={Landmark}
            />
          </>
        )}
      </div>

      <ExpenseSection
        title={`Despesas da Competência Atual · ${format(now, "MMMM/yyyy", { locale: ptBR })}`}
        description="Todas as despesas provisionadas para a competência do mês atual."
        expenses={currentCompetenceExpenses}
        emptyMessage="Nenhuma despesa encontrada para a competência atual."
        filters={monthFilters}
        onFiltersChange={setMonthFilters}
        suppliers={suppliers}
        accountPlans={accountPlans}
      />

      <ExpenseSection
        title="Vencidos"
        description="Despesas pendentes cujo vencimento já passou."
        expenses={overdueExpenses}
        emptyMessage="Nenhuma despesa vencida encontrada."
        filters={overdueFilters}
        onFiltersChange={setOverdueFilters}
        suppliers={suppliers}
        accountPlans={accountPlans}
      />

      <ExpenseSection
        title="Pendentes de Auditoria"
        description="Despesas de compras que ainda exigem revisão financeira."
        expenses={pendingAuditExpenses}
        emptyMessage="Nenhuma despesa pendente de auditoria encontrada."
        filters={auditFilters}
        onFiltersChange={setAuditFilters}
        suppliers={suppliers}
        accountPlans={accountPlans}
      />

      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Unidades</h2>
          <p className="text-sm text-muted-foreground">Cada card abaixo permite acessar e filtrar as despesas de uma unidade específica.</p>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          {kiosks.map((kiosk) => {
            const filters = unitFilters[kiosk.id] || DEFAULT_FILTERS;
            const unitExpenses = expensesList.filter(
              (expense) =>
                expenseBelongsToUnit(expense, kiosk.name) &&
                matchesFilters(expense, filters, accountPlanMap, now)
            );

            return (
              <Card key={kiosk.id} className="rounded-[18px] border-[#e3e1dc] bg-white shadow-sm">
                <CardHeader className="flex flex-row items-start justify-between gap-4 border-b border-[#ebe9e4] px-4 py-4">
                  <div>
                    <CardTitle className="text-base font-bold">{kiosk.name}</CardTitle>
                    <CardDescription>{unitExpenses.length} despesa(s) após os filtros.</CardDescription>
                  </div>
                  <Button asChild variant="outline" size="sm" className="h-9 rounded-[11px] bg-white px-[14px] text-[13px] font-extrabold">
                    <Link href={`${FINANCIAL_ROUTES.expenses}?search=${encodeURIComponent(kiosk.name)}`}>
                      Abrir despesas
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </CardHeader>
                <CardContent className="space-y-4 p-4">
                  <ExpenseFiltersBar
                    filters={filters}
                    onChange={(next) => setUnitFilters((current) => ({ ...current, [kiosk.id]: next }))}
                    suppliers={suppliers}
                    accountPlans={accountPlans}
                  />
                  <ExpenseList
                    expenses={unitExpenses.slice(0, 8)}
                    emptyMessage="Nenhuma despesa encontrada para esta unidade."
                    resultCenter={kiosk.name}
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </PageContainer>
  );
}
