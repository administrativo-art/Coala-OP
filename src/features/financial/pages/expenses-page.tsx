"use client";

import Link from "next/link";
import { type ComponentType, Fragment, useEffect, useMemo, useState } from "react";
import { deleteDoc } from "firebase/firestore";
import { format, startOfDay, addDays, endOfDay, startOfMonth, endOfMonth, subMonths, startOfYear } from "date-fns";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  Clock3,
  Landmark,
  FilePlus2,
  FileUp,
  Filter,
  MoreHorizontal,
  SearchCheck,
  Search,
  Trash2,
} from "lucide-react";
import { PayExpenseDialog } from "@/features/financial/components/pay-expense-dialog";
import { FinancialAccessGuard } from "@/features/financial/components/financial-access-guard";
import { FinancialImportPage } from "@/features/financial/pages/import-page";
import { FINANCIAL_ROUTES } from "@/features/financial/lib/constants";
import { financialCollection, financialDoc } from "@/features/financial/lib/repositories";
import { formatCurrency, toDate } from "@/features/financial/lib/utils";
import { useFinancialCollection } from "@/features/financial/hooks/use-financial-collection";
import { useAuth } from "@/hooks/use-auth";
import { useKiosks } from "@/hooks/use-kiosks";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
  pending_audit: "border-violet-200 bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300 dark:border-violet-800",
  paid: "border-green-400 bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800",
  cancelled: "border-zinc-300 bg-zinc-50 text-zinc-500 dark:bg-zinc-900/50 dark:text-zinc-400 dark:border-zinc-800",
  overdue: "border-rose-300 bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-800",
  pending: "border-blue-300 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800",
  due_soon: "border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800",
};

const STATUS_ACCENT_COLORS: Record<string, string> = {
  draft: "bg-slate-400",
  pending_audit: "bg-violet-500",
  paid: "bg-emerald-500",
  cancelled: "bg-zinc-300",
  overdue: "bg-rose-500",
  pending: "bg-blue-500",
  due_soon: "bg-amber-500",
};

const KPI_TONES = {
  pending: {
    iconWrap: "bg-blue-50 text-blue-700",
    bars: "bg-blue-400/80",
  },
  overdue: {
    iconWrap: "bg-rose-50 text-rose-700",
    bars: "bg-rose-400/80",
  },
  dueSoon: {
    iconWrap: "bg-amber-50 text-amber-700",
    bars: "bg-amber-400/80",
  },
  paid: {
    iconWrap: "bg-emerald-50 text-emerald-700",
    bars: "bg-emerald-400/80",
  },
  pendingAudit: {
    iconWrap: "bg-violet-50 text-violet-700",
    bars: "bg-violet-400/80",
  },
} as const;

const UNIT_COLOR_STYLES: Array<{ match: string; dot: string; active: string; soft: string }> = [
  { match: "iguatemi", dot: "bg-indigo-500", active: "border-indigo-500 bg-indigo-50 text-indigo-700", soft: "border-indigo-200 hover:border-indigo-300" },
  { match: "higien", dot: "bg-orange-400", active: "border-orange-500 bg-orange-50 text-orange-700", soft: "border-orange-200 hover:border-orange-300" },
  { match: "jk", dot: "bg-emerald-500", active: "border-emerald-500 bg-emerald-50 text-emerald-700", soft: "border-emerald-200 hover:border-emerald-300" },
  { match: "morumbi", dot: "bg-violet-500", active: "border-violet-500 bg-violet-50 text-violet-700", soft: "border-violet-200 hover:border-violet-300" },
  { match: "matriz", dot: "bg-sky-500", active: "border-sky-500 bg-sky-50 text-sky-700", soft: "border-sky-200 hover:border-sky-300" },
];

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
  count,
  icon: Icon,
  iconWrapClass,
  barsClass,
}: {
  label: string;
  value: string;
  description: string;
  href?: string;
  onClick?: () => void;
  count?: number;
  icon: ComponentType<{ className?: string }>;
  iconWrapClass: string;
  barsClass: string;
}) {
  return (
    <Card
      className={cn(
        "overflow-hidden rounded-2xl border-border/70 shadow-sm",
        (href || onClick) && "cursor-pointer transition-colors hover:border-primary/40"
      )}
      onClick={onClick}
    >
      <CardHeader className="space-y-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className={cn("flex h-7 w-7 items-center justify-center rounded-xl", iconWrapClass)}>
              <Icon className="h-3.5 w-3.5" />
            </span>
            <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</CardTitle>
          </div>
          {count !== undefined ? (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">{count}</span>
          ) : null}
        </div>
        <div className="grid h-8 grid-cols-8 items-end gap-1">
          {Array.from({ length: 8 }).map((_, index) => (
            <div
              key={index}
              className={cn("block w-full rounded-sm", barsClass)}
              style={{ height: `${10 + ((index * 7) % 18)}px` }}
            />
          ))}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="font-mono text-[28px] font-bold leading-none tracking-tight">{value}</div>
        <p className="mt-2 text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function getUnitColorStyle(unitName: string) {
  const normalized = unitName.toLowerCase();
  return UNIT_COLOR_STYLES.find((style) => normalized.includes(style.match)) ?? {
    dot: "bg-primary/70",
    active: "border-primary bg-primary/10 text-primary",
    soft: "border-border/70 hover:border-primary/40",
  };
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
  const planName = accountPlanMap[expense.accountId ?? expense.accountPlan] || expense.accountPlanName || expense.accountId || expense.accountPlan || "";
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
  const { data: accountPlans } = useFinancialCollection<any>(financialCollection("accounts"));
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
  const [expandedExpenseId, setExpandedExpenseId] = useState<string | null>(null);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const canAccessAudits = !!permissions.financial?.expenses?.import;
  const currentView = canAccessAudits && searchParams.get("view") === "audits" ? "audits" : "expenses";

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

  const accountPlanNames = useMemo(
    () =>
      Array.from(
        new Set(
          expenses
            .map((expense) => accountPlanMap[expense.accountId ?? expense.accountPlan] || expense.accountPlanName || expense.accountId || expense.accountPlan)
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
  const unitCounts = useMemo(() => {
    const counts = new Map<string, number>();
    scopedExpenses.forEach((expense) => {
      units.forEach((unit) => {
        if (expenseMatchesUnit(expense, unit.name)) {
          counts.set(unit.name, (counts.get(unit.name) || 0) + 1);
        }
      });
    });
    return counts;
  }, [scopedExpenses, units]);

  const filteredCountLabel = `${filtered.length} de ${scopedExpenses.length}`;

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

  useEffect(() => {
    if (!expandedExpenseId) return;
    if (!filtered.some((expense) => expense.id === expandedExpenseId)) {
      setExpandedExpenseId(null);
    }
  }, [expandedExpenseId, filtered]);

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

  function setExpensesView(view: "expenses" | "audits") {
    const params = new URLSearchParams(searchParams.toString());
    if (view === "audits") {
      params.set("view", "audits");
    } else {
      params.delete("view");
    }
    const nextQuery = params.toString();
    router.replace(`${FINANCIAL_ROUTES.expenses}${nextQuery ? `?${nextQuery}` : ""}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Despesas</h1>
          <p className="text-muted-foreground">Painel consolidado de despesas, contas a pagar e histórico de liquidações.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {permissions.financial?.expenses?.import && (
            <Button variant="outline" size="sm" onClick={() => setIsImportDialogOpen(true)}>
              <FileUp className="mr-2 h-4 w-4" /> Importar extrato
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

      {canAccessAudits ? (
        <Tabs value={currentView} onValueChange={(value) => setExpensesView(value as "expenses" | "audits")} className="space-y-6">
          <TabsList className="grid h-auto w-full max-w-[420px] grid-cols-2 rounded-2xl border bg-background p-1 shadow-sm">
            <TabsTrigger value="expenses" className="rounded-xl px-4 py-2 text-sm font-medium">
              Despesas
            </TabsTrigger>
            <TabsTrigger value="audits" className="rounded-xl px-4 py-2 text-sm font-medium">
              Auditorias
            </TabsTrigger>
          </TabsList>

          <TabsContent value="expenses" className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          label="Em aberto"
          value={formatCurrency(kpis.open)}
          description="Total de compromissos pendentes."
          icon={Landmark}
          iconWrapClass={KPI_TONES.pending.iconWrap}
          barsClass={KPI_TONES.pending.bars}
        />
        <KpiCard
          label="Vencido"
          value={formatCurrency(kpis.overdue)}
          description="Despesas que já passaram do vencimento."
          icon={AlertTriangle}
          iconWrapClass={KPI_TONES.overdue.iconWrap}
          barsClass={KPI_TONES.overdue.bars}
        />
        <KpiCard
          label="Vence em 7 dias"
          value={formatCurrency(kpis.dueSoon)}
          description="Monitoramento do curto prazo."
          icon={Clock3}
          iconWrapClass={KPI_TONES.dueSoon.iconWrap}
          barsClass={KPI_TONES.dueSoon.bars}
        />
        <KpiCard
          label="Pago"
          value={formatCurrency(kpis.paid)}
          description="Histórico já liquidado."
          icon={CheckCheck}
          iconWrapClass={KPI_TONES.paid.iconWrap}
          barsClass={KPI_TONES.paid.bars}
        />
        <KpiCard
          label="Pendente auditoria"
          value={formatCurrency(kpis.pendingAudit)}
          description="Compras e extratos reconhecidos aguardando tratamento."
          icon={SearchCheck}
          iconWrapClass={KPI_TONES.pendingAudit.iconWrap}
          barsClass={KPI_TONES.pendingAudit.bars}
          href={FINANCIAL_ROUTES.pendingAuditExpenses}
          onClick={() => router.push(FINANCIAL_ROUTES.pendingAuditExpenses)}
        />
      </div>

      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Unidade</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              unitFilter === "all"
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border/70 bg-background hover:border-primary/40"
            )}
            onClick={() => setUnitFilter("all")}
          >
            Todas
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[10px]",
                unitFilter === "all" ? "bg-white/20 text-primary-foreground" : "bg-muted text-muted-foreground"
              )}
            >
              {scopedExpenses.length}
            </span>
          </button>
          {units.map((unit) => {
            const unitStyle = getUnitColorStyle(unit.name);
            return (
              <button
                key={unit.id}
                type="button"
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  unitFilter === unit.name
                    ? unitStyle.active
                    : cn("bg-background", unitStyle.soft)
                )}
                onClick={() => setUnitFilter(unit.name)}
              >
                <span className={cn("h-2 w-2 rounded-full", unitStyle.dot)} />
                {unit.name}
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {unitCounts.get(unit.name) || 0}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <Card className="overflow-hidden rounded-2xl border-border/70 shadow-sm">
        <CardHeader className="border-b bg-muted/20 px-4 py-3">
          <div className="flex flex-nowrap items-center gap-2 overflow-x-auto pb-1">
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por descrição, fornecedor..."
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
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">{filteredCountLabel}</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Descrição</th>
                  <th className="px-4 py-3 font-medium">Fornecedor</th>
                  <th className="px-4 py-3 font-medium">Unidade</th>
                  <th className="px-4 py-3 font-medium">Vencimento</th>
                  <th className="px-4 py-3 text-right font-medium">Valor</th>
                  <th className="w-[160px] px-4 py-3 text-center font-medium">Status</th>
                  <th className="w-[52px] px-4 py-3 text-right font-medium" />
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
                    const isExpanded = expandedExpenseId === expense.id;
                    const planName = accountPlanMap[expense.accountId ?? expense.accountPlan] || expense.accountPlanName || expense.accountId || expense.accountPlan || "—";
                    const primaryUnit = expense.isApportioned
                      ? expense.apportionments?.[0]?.resultCenter || "Rateado"
                      : expense.resultCenter || "—";
                    const installmentLabel = expense.installments?.length
                      ? `${expense.installments[0]?.number || 1}/${expense.installments.length}`
                      : "1/1";

                    return (
                      <Fragment key={expense.id}>
                        <tr
                          className={cn("border-b cursor-pointer transition-colors hover:bg-muted/20", isExpanded && "bg-muted/20")}
                          onClick={() => setExpandedExpenseId((current) => (current === expense.id ? null : expense.id))}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-start gap-3">
                              <span className={cn("mt-1 h-7 w-1 shrink-0 rounded-full", STATUS_ACCENT_COLORS[statusKey] || "bg-border")} />
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <p className="font-medium">{expense.description}</p>
                                  {expense.installments?.length > 1 && (
                                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                      {installmentLabel}
                                    </span>
                                  )}
                                  {expense.originModule === "purchasing" && (
                                    <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700">
                                      Compras
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  {primaryUnit !== "—" ? `${primaryUnit} · ` : ""}
                                  {expense.supplier || "Sem fornecedor"}
                                  {expense.notes ? ` · ${expense.notes}` : ""}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="space-y-1">
                              <p>{expense.supplier || "—"}</p>
                              <p className="text-xs text-muted-foreground">{planName}</p>
                            </div>
                          </td>
                          <td className="px-4 py-3">{primaryUnit}</td>
                          <td className="px-4 py-3">
                            <div className="space-y-1 text-center md:text-left">
                              <p>{due ? format(due, "dd/MM/yyyy") : "—"}</p>
                              {due ? (
                                <p className={cn("text-xs", due < startOfDay(new Date()) ? "text-rose-600" : "text-muted-foreground")}>
                                  {expense.status === "paid"
                                    ? "Pago"
                                    : due < startOfDay(new Date())
                                    ? `${Math.abs(Math.round((startOfDay(new Date()).getTime() - due.getTime()) / 86400000))}d atraso`
                                    : `em ${Math.round((due.getTime() - startOfDay(new Date()).getTime()) / 86400000)}d`}
                                </p>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-mono">{formatCurrency(expense.totalValue || 0)}</td>
                          <td className="w-[160px] px-4 py-3 text-center">
                            <span className={cn("inline-flex whitespace-nowrap rounded-full border px-2 py-1 text-[11px]", STATUS_COLORS[statusKey] || "border-border text-foreground")}>
                              {STATUS_LABELS[statusKey] || statusKey}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            {isExpanded ? <ChevronUp className="ml-auto h-4 w-4 text-muted-foreground" /> : <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground" />}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="border-b bg-muted/10">
                            <td colSpan={7} className="px-4 pb-4 pt-1">
                              <div className="grid gap-4 rounded-2xl border border-border/70 bg-background p-4 md:grid-cols-[2fr_1fr]">
                                <div className="grid gap-4 sm:grid-cols-3">
                                  <div>
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Fornecedor</p>
                                    <p className="mt-1 text-sm font-medium">{expense.supplier || "—"}</p>
                                  </div>
                                  <div>
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Plano de contas</p>
                                    <p className="mt-1 text-sm font-medium">{planName}</p>
                                  </div>
                                  <div>
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Centro de resultado</p>
                                    <p className="mt-1 text-sm font-medium">{expense.isApportioned ? "Rateado" : primaryUnit}</p>
                                  </div>
                                  <div>
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Competência</p>
                                    <p className="mt-1 text-sm font-medium">
                                      {toDate(expense.competenceDate) ? format(toDate(expense.competenceDate)!, "MM/yyyy") : "—"}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Vencimento</p>
                                    <p className="mt-1 text-sm font-medium">{due ? format(due, "dd/MM/yyyy") : "—"}</p>
                                  </div>
                                  <div>
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Parcela</p>
                                    <p className="mt-1 text-sm font-medium">{installmentLabel}</p>
                                  </div>
                                  {expense.purchaseOrderId && (
                                    <div className="sm:col-span-3">
                                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Pedido vinculado</p>
                                      <Link
                                        href={`/dashboard/purchasing/orders/${expense.purchaseOrderId}?returnTo=${encodeURIComponent(FINANCIAL_ROUTES.pendingAuditExpenses)}`}
                                        className="mt-1 inline-block text-sm font-medium text-primary underline underline-offset-2"
                                      >
                                        Abrir pedido {expense.purchaseOrderId}
                                      </Link>
                                    </div>
                                  )}
                                  {expense.notes && (
                                    <div className="sm:col-span-3 rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground">
                                      <span className="font-medium text-foreground">Observações:</span> {expense.notes}
                                    </div>
                                  )}
                                </div>
                                <div className="flex flex-col justify-between gap-4">
                                  <div className="text-right">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Valor total</p>
                                    <p className="mt-1 font-mono text-xl font-bold">{formatCurrency(expense.totalValue || 0)}</p>
                                  </div>
                                  <div className="flex flex-wrap justify-end gap-2">
                                    {permissions.financial?.expenses?.pay && expense.status === "pending" && (
                                      <Button
                                        type="button"
                                        size="sm"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setPayTarget({
                                            ...expense,
                                            accountPlanName: planName,
                                            resultCenter: primaryUnit,
                                          });
                                        }}
                                      >
                                        Registrar pagamento
                                      </Button>
                                    )}
                                    {permissions.financial?.expenses?.edit && (
                                      <Button type="button" variant="outline" size="sm" asChild onClick={(event) => event.stopPropagation()}>
                                        <Link href={`${FINANCIAL_ROUTES.newExpense}?edit=${expense.id}`}>
                                          {expense.status === "draft" ? "Continuar" : "Editar"}
                                        </Link>
                                      </Button>
                                    )}
                                    {permissions.financial?.expenses?.delete && expense.originModule !== "purchasing" && (
                                      <Button type="button" variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); setDeleteTarget(expense); }}>
                                        Excluir
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
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
                  const planName = accountPlanMap[expense.accountId ?? expense.accountPlan] || expense.accountPlanName || expense.accountId || expense.accountPlan || "—";
                  const primaryUnit = expense.isApportioned
                    ? expense.apportionments?.[0]?.resultCenter || "Rateado"
                    : expense.resultCenter || "—";

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
                              <DropdownMenuItem
                                onClick={() =>
                                  setPayTarget({
                                    ...expense,
                                    accountPlanName: planName,
                                    resultCenter: primaryUnit,
                                  })
                                }
                              >
                                Registrar pagamento
                              </DropdownMenuItem>
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
          </TabsContent>

          <TabsContent value="audits" className="space-y-6">
            <FinancialImportPage embedded showImportControls={false} />
          </TabsContent>
        </Tabs>
      ) : null}

      <Dialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen}>
        <DialogContent className="max-w-4xl rounded-3xl p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>Importar extrato</DialogTitle>
            <DialogDescription>Selecione a conta do extrato e importe um arquivo OFX ou CSV para abrir uma nova sessão de auditoria.</DialogDescription>
          </DialogHeader>
          <div className="px-6 pb-6">
            <FinancialImportPage
              embedded
              uploadOnly
              onImportComplete={() => {
                setIsImportDialogOpen(false);
                setExpensesView("audits");
              }}
            />
          </div>
        </DialogContent>
      </Dialog>

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
