"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { deleteDoc } from "firebase/firestore";
import { format, startOfDay, addDays, endOfDay, startOfMonth, endOfMonth, subMonths, startOfYear } from "date-fns";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CircleDollarSign,
  Download,
  FilePlus2,
  FileUp,
  Filter,
  MoreHorizontal,
  Search,
  Trash2,
} from "lucide-react";
import { PayExpenseDialog } from "@/features/financial/components/pay-expense-dialog";
import { FinancialAccessGuard } from "@/features/financial/components/financial-access-guard";
import { FINANCIAL_ROUTES } from "@/features/financial/lib/constants";
import { financialCollection, financialDoc } from "@/features/financial/lib/repositories";
import { formatCurrency, toDate } from "@/features/financial/lib/utils";
import { useFinancialCollection } from "@/features/financial/hooks/use-financial-collection";
import { useAuth } from "@/hooks/use-auth";
import { useKiosks } from "@/hooks/use-kiosks";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  pending_audit: "Pendente auditoria",
  paid: "Pago",
  cancelled: "Cancelado",
  overdue: "Vencido",
  pending: "Em aberto",
  due_soon: "Vence hoje",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "border-slate-300 bg-slate-50 text-slate-700 dark:bg-slate-950/30 dark:text-slate-400 dark:border-slate-800",
  pending_audit: "border-orange-300 bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-800",
  paid: "border-green-400 bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800",
  cancelled: "border-zinc-300 bg-zinc-50 text-zinc-500 dark:bg-zinc-900/50 dark:text-zinc-400 dark:border-zinc-800",
  overdue: "border-red-300 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800",
  pending: "border-blue-300 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800",
  due_soon: "border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800",
};

const PERIOD_PRESET_OPTIONS = [
  { value: "current_month", label: "Mês atual" },
  { value: "last_3_months", label: "Últimos 3 meses" },
  { value: "last_6_months", label: "Últimos 6 meses" },
  { value: "current_year", label: "Ano atual" },
  { value: "last_12_months", label: "Últimos 12 meses" },
  { value: "custom", label: "Personalizado" },
] as const;

type PeriodPresetValue = (typeof PERIOD_PRESET_OPTIONS)[number]["value"];

function KpiCard({
  label,
  value,
  description,
  href,
  onClick,
}: {
  label: string;
  value: string;
  description: string;
  href?: string;
  onClick?: () => void;
}) {
  return (
    <Card
      className={cn((href || onClick) && "cursor-pointer transition-colors hover:border-primary/40")}
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function expenseMatchesUnit(expense: any, unitName: string) {
  return (
    expense.resultCenter === unitName ||
    (Array.isArray(expense.apportionments) &&
      expense.apportionments.some((item: any) => item?.resultCenter === unitName))
  );
}

function matchesBaseFilters(
  expense: any,
  {
    accountPlanMap,
    search,
    originFilter,
    dateFrom,
    dateTo,
    competenceMonth,
    supplierFilter,
    accountPlanFilter,
    unitFilter,
    now,
  }: {
    accountPlanMap: Record<string, string>;
    search: string;
    originFilter: string;
    dateFrom: string;
    dateTo: string;
    competenceMonth: string;
    supplierFilter: string;
    accountPlanFilter: string;
    unitFilter: string;
    now: Date;
  }
) {
  const planName = accountPlanMap[expense.accountPlan] || expense.accountPlanName || expense.accountPlan || "";
  const due = toDate(expense.dueDate);
  const competence = toDate(expense.competenceDate);
  const belongsToUnit =
    unitFilter === "all" || expenseMatchesUnit(expense, unitFilter);
  const normalizedSearch = search.toLowerCase();
  const matchesSearch =
    !search ||
    expense.description.toLowerCase().includes(normalizedSearch) ||
    planName.toLowerCase().includes(normalizedSearch) ||
    (expense.supplier || "").toLowerCase().includes(normalizedSearch);

  const matchesOrigin =
    originFilter === "all" ||
    (originFilter === "purchasing" && expense.originModule === "purchasing") ||
    (originFilter === "manual" && expense.originModule !== "purchasing");

  const matchesDateFrom = !dateFrom || (due && due >= new Date(`${dateFrom}T00:00:00`));
  const matchesDateTo = !dateTo || (due && due <= new Date(`${dateTo}T23:59:59`));
  const matchesCompetence =
    !competenceMonth || (competence && format(competence, "yyyy-MM") === competenceMonth);
  const matchesSupplier = supplierFilter === "all" || (expense.supplier || "") === supplierFilter;
  const matchesAccountPlan = accountPlanFilter === "all" || planName === accountPlanFilter;

  return (
    matchesSearch &&
    matchesOrigin &&
    matchesDateFrom &&
    matchesDateTo &&
    matchesCompetence &&
    matchesSupplier &&
    matchesAccountPlan &&
    belongsToUnit
  );
}

function getExpenseStatusKey(expense: any, now: Date) {
  const due = toDate(expense.dueDate);
  let statusKey = expense.status;

  if (expense.status === "pending") {
    if (expense.originModule === "purchasing" && expense.originStatus === "pending_audit") {
      statusKey = "pending_audit";
    } else if (due) {
      if (due < now) statusKey = "overdue";
      else if (format(due, "yyyy-MM-dd") === format(now, "yyyy-MM-dd")) statusKey = "due_soon";
    }
  }

  return statusKey;
}

export function ExpensesPage() {
  const { permissions } = useAuth();
  const { kiosks } = useKiosks();
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: expensesData, loading } = useFinancialCollection<any>(financialCollection("expenses"));
  const { data: transactionsData } = useFinancialCollection<any>(financialCollection("transactions"));
  const { data: accountPlans } = useFinancialCollection<any>(financialCollection("accountPlans"));
  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") ?? "all");
  const [originFilter, setOriginFilter] = useState(searchParams.get("origin") ?? "all");
  const [periodPreset, setPeriodPreset] = useState<PeriodPresetValue>("current_month");
  const [dateFrom, setDateFrom] = useState(searchParams.get("date_from") ?? "");
  const [dateTo, setDateTo] = useState(searchParams.get("date_to") ?? "");
  const [competenceMonth, setCompetenceMonth] = useState(searchParams.get("competence") ?? format(new Date(), "yyyy-MM"));
  const [supplierFilter, setSupplierFilter] = useState(searchParams.get("supplier") ?? "all");
  const [accountPlanFilter, setAccountPlanFilter] = useState(searchParams.get("account_plan") ?? "all");
  const [unitFilter, setUnitFilter] = useState(searchParams.get("unit") ?? "all");
  const [payTarget, setPayTarget] = useState<any | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);

  if (!permissions.financial?.expenses?.view) {
    return (
      <FinancialAccessGuard
        title="Despesas"
        description="Seu perfil não possui permissão para consultar despesas, contas a pagar e histórico de liquidações."
      />
    );
  }

  const expenses = expensesData || [];
  const transactions = transactionsData || [];
  const accountPlanMap = useMemo(() => {
    const map: Record<string, string> = {};
    (accountPlans || []).forEach((plan) => {
      map[plan.id] = plan.name;
    });
    return map;
  }, [accountPlans]);

  useEffect(() => {
    setSearch(searchParams.get("search") ?? "");
    setStatusFilter(searchParams.get("status") ?? "all");
    setOriginFilter(searchParams.get("origin") ?? "all");
    setPeriodPreset("custom");
    setDateFrom(searchParams.get("date_from") ?? "");
    setDateTo(searchParams.get("date_to") ?? "");
    setCompetenceMonth(searchParams.get("competence") ?? format(new Date(), "yyyy-MM"));
    setSupplierFilter(searchParams.get("supplier") ?? "all");
    setAccountPlanFilter(searchParams.get("account_plan") ?? "all");
    setUnitFilter(searchParams.get("unit") ?? "all");
  }, [searchParams]);

  useEffect(() => {
    if (searchParams.get("date_from") || searchParams.get("date_to") || searchParams.get("competence")) {
      return;
    }

    const now = new Date();
    setPeriodPreset("current_month");
    setDateFrom(format(startOfMonth(now), "yyyy-MM-dd"));
    setDateTo(format(endOfMonth(now), "yyyy-MM-dd"));
    setCompetenceMonth(format(now, "yyyy-MM"));
  }, [searchParams]);

  function applyPeriodPreset(value: PeriodPresetValue) {
    const now = new Date();
    setPeriodPreset(value);

    if (value === "custom") {
      return;
    }

    if (value === "current_month") {
      setDateFrom(format(startOfMonth(now), "yyyy-MM-dd"));
      setDateTo(format(endOfMonth(now), "yyyy-MM-dd"));
      setCompetenceMonth(format(now, "yyyy-MM"));
      return;
    }

    if (value === "current_year") {
      setDateFrom(format(startOfYear(now), "yyyy-MM-dd"));
      setDateTo(format(endOfMonth(now), "yyyy-MM-dd"));
      setCompetenceMonth("");
      return;
    }

    const monthsBack = value === "last_3_months" ? 2 : value === "last_6_months" ? 5 : 11;
    setDateFrom(format(startOfMonth(subMonths(now, monthsBack)), "yyyy-MM-dd"));
    setDateTo(format(endOfMonth(now), "yyyy-MM-dd"));
    setCompetenceMonth("");
  }

  const suppliers = useMemo(
    () =>
      Array.from(new Set(expenses.map((expense) => expense.supplier).filter(Boolean))).sort((a, b) =>
        String(a).localeCompare(String(b), "pt-BR")
      ) as string[],
    [expenses]
  );

  const accountPlanNames = useMemo(
    () =>
      Array.from(
        new Set(
          expenses
            .map((expense) => accountPlanMap[expense.accountPlan] || expense.accountPlanName || expense.accountPlan)
            .filter(Boolean)
        )
      ).sort((a, b) => String(a).localeCompare(String(b), "pt-BR")) as string[],
    [accountPlanMap, expenses]
  );

  const units = useMemo(
    () => [...kiosks].sort((left, right) => left.name.localeCompare(right.name, "pt-BR")),
    [kiosks]
  );

  const filtered = useMemo(() => {
    const now = startOfDay(new Date());
    return expenses
      .filter((expense) => {
        if (
          !matchesBaseFilters(expense, {
            accountPlanMap,
            search,
            originFilter,
            dateFrom,
            dateTo,
            competenceMonth,
            supplierFilter,
            accountPlanFilter,
            unitFilter,
            now,
          })
        ) {
          return false;
        }
        const computedStatus = getExpenseStatusKey(expense, now);

        const matchesStatus =
          statusFilter === "all" ||
          (statusFilter === "pending" && ["pending", "due_soon", "overdue"].includes(computedStatus)) ||
          computedStatus === "pending_audit" && statusFilter === "pending_audit" ||
          computedStatus === statusFilter;

        return matchesStatus;
      })
      .sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));
  }, [accountPlanFilter, accountPlanMap, competenceMonth, dateFrom, dateTo, expenses, originFilter, search, statusFilter, supplierFilter, unitFilter]);

  const scopedExpenses = useMemo(() => {
    const now = startOfDay(new Date());
    return expenses.filter((expense) =>
      matchesBaseFilters(expense, {
        accountPlanMap,
        search,
        originFilter,
        dateFrom,
        dateTo,
        competenceMonth,
        supplierFilter,
        accountPlanFilter,
        unitFilter,
        now,
      })
    );
  }, [accountPlanFilter, accountPlanMap, competenceMonth, dateFrom, dateTo, expenses, originFilter, search, supplierFilter, unitFilter]);

  const kpis = useMemo(() => {
    const now = startOfDay(new Date());
    const in7Days = endOfDay(addDays(now, 7));

    let open = 0;
    let overdue = 0;
    let paid = 0;
    let dueSoon = 0;
    let pendingAudit = 0;

    scopedExpenses.forEach((expense) => {
      const due = toDate(expense.dueDate);
      const computedStatus = getExpenseStatusKey(expense, now);
      if (expense.status === "pending") {
        open += expense.totalValue || 0;
        if (due && due < now) overdue += expense.totalValue || 0;
        if (due && due >= now && due <= in7Days) dueSoon += expense.totalValue || 0;
      }
      if (expense.status === "paid") {
        paid += expense.totalValue || 0;
      }
    });

    expenses.forEach((expense) => {
      const computedStatus = getExpenseStatusKey(expense, now);
      if (computedStatus === "pending_audit") {
        pendingAudit += expense.totalValue || 0;
      }
    });

    transactions.forEach((transaction) => {
      if (
        transaction.importedFrom === "bank_statement" &&
        transaction.direction === "out" &&
        transaction.auditStatus === "pending"
      ) {
        pendingAudit += Number(transaction.amount) || 0;
      }
    });

    return { open, overdue, paid, dueSoon, pendingAudit };
  }, [expenses, scopedExpenses, transactions]);

  async function handleDelete() {
    if (!deleteTarget) return;

    if (deleteTarget.originModule === "purchasing") {
      toast({ variant: "destructive", title: "Ação não permitida.", description: "Esta despesa foi gerada pelo módulo de compras. Cancele o pedido de compra correspondente para remover esta despesa." });
      setDeleteTarget(null);
      return;
    }

    try {
      await deleteDoc(financialDoc("expenses", deleteTarget.id));
      toast({ title: "Despesa excluída." });
    } catch (error: any) {
      console.error("Erro ao excluir despesa:", error);
      toast({ variant: "destructive", title: "Erro ao excluir a despesa.", description: error.message || "Tente novamente mais tarde." });
    } finally {
      setDeleteTarget(null);
    }
  }

  function exportCsv() {
    const header = "Descrição,Fornecedor,Plano de contas,Valor,Vencimento,Status\n";
    const rows = filtered
      .map((expense) =>
        [
          `"${expense.description}"`,
          `"${expense.supplier || ""}"`,
          `"${accountPlanMap[expense.accountPlan] || expense.accountPlanName || expense.accountPlan || ""}"`,
          (expense.totalValue || 0).toFixed(2),
          toDate(expense.dueDate) ? format(toDate(expense.dueDate)!, "dd/MM/yyyy") : "",
          expense.status,
        ].join(",")
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `despesas-${format(new Date(), "yyyy-MM-dd")}.csv`;
    link.click();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Despesas</h1>
          <p className="text-muted-foreground">Painel consolidado de despesas, contas a pagar e histórico de liquidações.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {permissions.financial?.expenses?.import && (
            <Button variant="outline" size="sm" asChild>
              <Link href={FINANCIAL_ROUTES.importExpenses}>
                <FileUp className="mr-2 h-4 w-4" /> Importar extrato
              </Link>
            </Button>
          )}
          {permissions.financial?.expenses?.create && (
            <Button size="sm" asChild>
              <Link href={FINANCIAL_ROUTES.newExpense}>
                <FilePlus2 className="mr-2 h-4 w-4" /> Novo lançamento
              </Link>
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Em aberto" value={formatCurrency(kpis.open)} description="Total de compromissos pendentes." />
        <KpiCard label="Vencido" value={formatCurrency(kpis.overdue)} description="Despesas que já passaram do vencimento." />
        <KpiCard label="Vence em 7 dias" value={formatCurrency(kpis.dueSoon)} description="Monitoramento do curto prazo." />
        <KpiCard label="Pago" value={formatCurrency(kpis.paid)} description="Histórico já liquidado." />
        <KpiCard
          label="Pendente auditoria"
          value={formatCurrency(kpis.pendingAudit)}
          description="Compras e extratos reconhecidos aguardando tratamento."
          href={FINANCIAL_ROUTES.pendingAuditExpenses}
          onClick={() => router.push(FINANCIAL_ROUTES.pendingAuditExpenses)}
        />
      </div>

      <Card className="overflow-hidden rounded-2xl border-border/70 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Unidades</CardTitle>
          <CardDescription>Cards de acesso rápido para ver as despesas de cada unidade.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <button
              type="button"
              className={cn(
                "rounded-xl border px-4 py-4 text-left transition-colors hover:border-primary/40",
                unitFilter === "all" && "border-primary bg-primary/5"
              )}
              onClick={() => setUnitFilter("all")}
            >
              <p className="text-sm font-semibold">Todas as unidades</p>
            </button>
            {units.map((unit) => {
              return (
                <button
                  key={unit.id}
                  type="button"
                  className={cn(
                    "rounded-xl border px-4 py-4 text-left transition-colors hover:border-primary/40",
                    unitFilter === unit.name && "border-primary bg-primary/5"
                  )}
                  onClick={() => setUnitFilter(unit.name)}
                >
                  <p className="text-sm font-semibold">{unit.name}</p>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden rounded-2xl border-border/70 shadow-sm">
        <CardHeader className="border-b bg-muted/20 px-4 py-3">
          <div className="flex flex-nowrap items-center gap-2 overflow-x-auto pb-1">
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar despesa..."
                className="h-8 rounded-lg border-border/70 bg-background pl-9 text-xs"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-[150px] rounded-lg border-border/70 bg-background text-xs">
                <Filter className="mr-2 h-3.5 w-3.5 opacity-50" />
                <SelectValue placeholder="Filtrar por status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                <SelectItem value="pending">Em aberto</SelectItem>
                <SelectItem value="pending_audit">Compras pendentes de auditoria</SelectItem>
                <SelectItem value="draft">Rascunhos</SelectItem>
                <SelectItem value="overdue">Vencidos</SelectItem>
                <SelectItem value="paid">Pagos</SelectItem>
                <SelectItem value="cancelled">Cancelados</SelectItem>
              </SelectContent>
            </Select>
            <Select value={originFilter} onValueChange={setOriginFilter}>
              <SelectTrigger className="h-8 w-[170px] rounded-lg border-border/70 bg-background text-xs">
                <CircleDollarSign className="mr-2 h-3.5 w-3.5 opacity-50" />
                <SelectValue placeholder="Filtrar por origem" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as origens</SelectItem>
                <SelectItem value="purchasing">Origem: Compras</SelectItem>
                <SelectItem value="manual">Demais despesas</SelectItem>
              </SelectContent>
            </Select>
            <Select value={periodPreset} onValueChange={(value) => applyPeriodPreset(value as PeriodPresetValue)}>
              <SelectTrigger className="h-8 w-[160px] rounded-lg border-border/70 bg-background text-xs">
                <SelectValue placeholder="Período" />
              </SelectTrigger>
              <SelectContent>
                {PERIOD_PRESET_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="month"
              value={competenceMonth}
              className="h-8 w-[140px] rounded-lg border-border/70 bg-background text-xs"
              onChange={(event) => {
                setPeriodPreset("custom");
                setCompetenceMonth(event.target.value);
              }}
            />
            <Select value={supplierFilter} onValueChange={setSupplierFilter}>
              <SelectTrigger className="h-8 w-[170px] rounded-lg border-border/70 bg-background text-xs">
                <SelectValue placeholder="Fornecedor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os fornecedores</SelectItem>
                {suppliers.map((supplier) => (
                  <SelectItem key={supplier} value={supplier}>{supplier}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={accountPlanFilter} onValueChange={setAccountPlanFilter}>
              <SelectTrigger className="h-8 w-[170px] rounded-lg border-border/70 bg-background text-xs">
                <SelectValue placeholder="Plano de contas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os planos</SelectItem>
                {accountPlanNames.map((accountPlan) => (
                  <SelectItem key={accountPlan} value={accountPlan}>{accountPlan}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-8 shrink-0 rounded-lg border-border/70 bg-background text-xs" onClick={exportCsv} disabled={!filtered.length}>
              <Download className="mr-2 h-3.5 w-3.5" /> Exportar
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Descrição</th>
                  <th className="px-4 py-3 font-medium">Fornecedor</th>
                  <th className="px-4 py-3 font-medium">Plano de contas</th>
                  <th className="px-4 py-3 font-medium">Vencimento</th>
                  <th className="px-4 py-3 text-right font-medium">Valor</th>
                  <th className="w-[160px] px-4 py-3 text-center font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, index) => (
                    <tr key={index} className="border-b">
                      <td colSpan={7} className="p-4">
                        <Skeleton className="h-10 w-full" />
                      </td>
                    </tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-16 text-center text-muted-foreground">
                      Nenhuma despesa encontrada.
                    </td>
                  </tr>
                ) : (
                  filtered.map((expense) => {
                    const due = toDate(expense.dueDate);
                    const statusKey = getExpenseStatusKey(expense, startOfDay(new Date()));

                    return (
                      <tr key={expense.id} className="border-b">
                        <td className="px-4 py-3">
                          <div>
                            <p className="font-medium">{expense.description}</p>
                            {expense.originModule === "purchasing" && (
                              <div className="mt-2 space-y-1.5">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700">
                                    Compras
                                  </span>
                                  {expense.purchaseOrderId && (
                                    <Link
                                      href={`/dashboard/purchasing/orders/${expense.purchaseOrderId}?returnTo=${encodeURIComponent(FINANCIAL_ROUTES.pendingAuditExpenses)}`}
                                      className="text-[11px] text-primary underline underline-offset-2"
                                    >
                                      Abrir pedido
                                    </Link>
                                  )}
                                  <span className="text-[11px] text-amber-700">Revise parcelamento, conta e liquidação.</span>
                                </div>
                              </div>
                            )}
                            {expense.notes && expense.originModule !== "purchasing" && <p className="text-xs text-muted-foreground">{expense.notes}</p>}
                          </div>
                        </td>
                        <td className="px-4 py-3">{expense.supplier || "—"}</td>
                        <td className="px-4 py-3">
                          {accountPlanMap[expense.accountPlan] || expense.accountPlanName || expense.accountPlan || "—"}
                        </td>
                        <td className="px-4 py-3">{due ? format(due, "dd/MM/yyyy") : "—"}</td>
                        <td className="px-4 py-3 text-right font-mono">{formatCurrency(expense.totalValue || 0)}</td>
                        <td className="w-[160px] px-4 py-3 text-center">
                          <span className={cn("inline-flex whitespace-nowrap rounded-full border px-2 py-1 text-[11px]", STATUS_COLORS[statusKey] || "border-border text-foreground")}>
                            {STATUS_LABELS[statusKey] || statusKey}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreHorizontal className="h-4 w-4" />
                                <span className="sr-only">Ações</span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()}>
                              {permissions.financial?.expenses?.pay && expense.status === "pending" && (
                                <DropdownMenuItem onClick={() => setPayTarget(expense)}>Registrar pagamento</DropdownMenuItem>
                              )}
                              {permissions.financial?.expenses?.edit && (
                                <DropdownMenuItem asChild>
                                  <Link href={`${FINANCIAL_ROUTES.newExpense}?edit=${expense.id}`}>
                                    {expense.status === "draft" ? "Continuar rascunho" : "Editar"}
                                  </Link>
                                </DropdownMenuItem>
                              )}
                              {permissions.financial?.expenses?.delete && expense.originModule !== "purchasing" && (
                                <DropdownMenuItem onClick={() => setDeleteTarget(expense)}>
                                  <Trash2 className="mr-2 h-4 w-4" /> Excluir
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="md:hidden">
            <div className="grid grid-cols-[1fr_auto_auto] gap-2 border-b bg-muted/20 px-4 py-2">
              <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Descrição</span>
              <span className="text-right text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Valor</span>
              <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Status</span>
            </div>
            {loading ? (
              <div className="space-y-3 p-4">
                {Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={index} className="h-24 w-full rounded-xl" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">Nenhuma despesa encontrada.</div>
            ) : (
              <div className="flex flex-col">
                {filtered.map((expense) => {
                  const due = toDate(expense.dueDate);
                  const statusKey = getExpenseStatusKey(expense, startOfDay(new Date()));
                  const planName = accountPlanMap[expense.accountPlan] || expense.accountPlanName || expense.accountPlan || "—";

                  return (
                    <div key={expense.id} className="border-b border-border/50 px-4 py-3 last:border-b-0 hover:bg-muted/10">
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 flex-1 text-sm font-medium leading-5">{expense.description}</p>
                        <p className={cn("shrink-0 text-sm font-medium", statusKey === "cancelled" && "text-red-700")}>
                          {formatCurrency(expense.totalValue || 0)}
                        </p>
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{expense.supplier || "—"}</span>
                        <span className="text-border">·</span>
                        <span>{planName}</span>
                        <span className="text-border">·</span>
                        <span>{due ? `Venc. ${format(due, "dd/MM/yyyy")}` : "Sem vencimento"}</span>
                      </div>

                      {expense.originModule === "purchasing" && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700">
                            Compras
                          </span>
                          {expense.purchaseOrderId && (
                            <Link
                              href={`/dashboard/purchasing/orders/${expense.purchaseOrderId}?returnTo=${encodeURIComponent(FINANCIAL_ROUTES.pendingAuditExpenses)}`}
                              className="text-[11px] text-primary underline"
                            >
                              Abrir pedido
                            </Link>
                          )}
                          <span className={cn("text-[11px]", statusKey === "pending_audit" ? "text-amber-700" : "text-muted-foreground")}>
                            {statusKey === "cancelled"
                              ? "Cancelado junto com o pedido."
                              : "Revise parcelamento, conta e liquidação."}
                          </span>
                        </div>
                      )}

                      {expense.notes && expense.originModule !== "purchasing" && (
                        <p className="mt-2 text-[11px] text-muted-foreground">{expense.notes}</p>
                      )}

                      <div className="mt-3 flex items-center justify-end gap-2">
                        <span className={cn("rounded-full border px-2 py-1 text-[11px]", STATUS_COLORS[statusKey] || "border-border text-foreground")}>
                          {STATUS_LABELS[statusKey] || statusKey}
                        </span>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="icon" className="h-7 w-7 rounded-lg border-border/70">
                              <MoreHorizontal className="h-3.5 w-3.5" />
                              <span className="sr-only">Ações</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()}>
                            {permissions.financial?.expenses?.pay && expense.status === "pending" && (
                              <DropdownMenuItem onClick={() => setPayTarget(expense)}>Registrar pagamento</DropdownMenuItem>
                            )}
                            {permissions.financial?.expenses?.edit && (
                              <DropdownMenuItem asChild>
                                <Link href={`${FINANCIAL_ROUTES.newExpense}?edit=${expense.id}`}>
                                  {expense.status === "draft" ? "Continuar rascunho" : "Editar"}
                                </Link>
                              </DropdownMenuItem>
                            )}
                            {permissions.financial?.expenses?.delete && expense.originModule !== "purchasing" && (
                              <DropdownMenuItem onClick={() => setDeleteTarget(expense)}>
                                <Trash2 className="mr-2 h-4 w-4" /> Excluir
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <PayExpenseDialog expense={payTarget} open={!!payTarget} onOpenChange={(open) => !open && setPayTarget(null)} />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir despesa?</AlertDialogTitle>
            <AlertDialogDescription>
              Essa ação remove a despesa <strong>{deleteTarget?.description}</strong> do banco financeiro.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
