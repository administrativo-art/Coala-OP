"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { deleteDoc, Timestamp, updateDoc } from "firebase/firestore";
import { format, startOfDay, addDays, endOfDay, startOfMonth, endOfMonth } from "date-fns";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  Landmark,
  FilePlus2,
  FileUp,
  Filter,
  Loader2,
  MoreHorizontal,
  Search,
  Trash2,
} from "lucide-react";
import { PayExpenseDialog } from "@/features/financial/components/pay-expense-dialog";
import {
  ExpensePeriodFilter,
  type ExpensePeriodPreset,
} from "@/features/financial/components/expenses/expense-period-filter";
import { KpiFlowStrip } from "@/features/financial/components/expenses/kpi-flow-strip";
import { FinancialAccessGuard } from "@/features/financial/components/financial-access-guard";
import { FinancialImportPage } from "@/features/financial/pages/import-page";
import { FINANCIAL_ROUTES } from "@/features/financial/lib/constants";
import { financialCollection, financialDoc } from "@/features/financial/lib/repositories";
import { formatCurrency, toDate } from "@/features/financial/lib/utils";
import {
  expenseReferencesResultCenter,
  expenseValueForResultCenter,
  resolveResultCenterName,
  type ResultCenterNameMap,
} from "@/features/financial/lib/expense-rateio";
import { compareExpensesByDueDate } from "@/features/financial/lib/expense-order";
import { useFinancialCollection } from "@/features/financial/hooks/use-financial-collection";
import { useAuth } from "@/hooks/use-auth";
import { useKiosks } from "@/hooks/use-kiosks";
import { useProducts } from "@/hooks/use-products";
import { usePurchaseOrders } from "@/hooks/use-purchase-orders";
import { useToast } from "@/hooks/use-toast";
import type { PurchaseOrderItem } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

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

const UNIT_COLOR_STYLES: Array<{ match: string; dot: string; active: string; soft: string }> = [
  { match: "iguatemi", dot: "bg-indigo-500", active: "border-indigo-500 bg-indigo-50 text-indigo-700", soft: "border-indigo-200 hover:border-indigo-300" },
  { match: "higien", dot: "bg-orange-400", active: "border-orange-500 bg-orange-50 text-orange-700", soft: "border-orange-200 hover:border-orange-300" },
  { match: "jk", dot: "bg-emerald-500", active: "border-emerald-500 bg-emerald-50 text-emerald-700", soft: "border-emerald-200 hover:border-emerald-300" },
  { match: "morumbi", dot: "bg-violet-500", active: "border-violet-500 bg-violet-50 text-violet-700", soft: "border-violet-200 hover:border-violet-300" },
  { match: "matriz", dot: "bg-sky-500", active: "border-sky-500 bg-sky-50 text-sky-700", soft: "border-sky-200 hover:border-sky-300" },
];

function PurchaseOrderItemsLink({ orderId, href, label }: { orderId: string; href: string; label?: string }) {
  const { fetchOrderItems } = usePurchaseOrders();
  const { products, getProductFullName } = useProducts();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<PurchaseOrderItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!open || items !== null || loadError) return;
    let cancelled = false;

    void fetchOrderItems(orderId)
      .then((data) => {
        if (!cancelled) setItems(data);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [fetchOrderItems, items, loadError, open, orderId]);

  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <Link href={href} className="mt-1 inline-block text-sm font-medium text-primary underline underline-offset-2">
            {label || `Abrir pedido ${orderId}`}
          </Link>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          align="start"
          sideOffset={8}
          className="w-[380px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl p-0"
        >
          <div className="border-b bg-muted/40 px-3 py-2.5">
            <p className="font-semibold">Itens do pedido</p>
            <p className="text-xs text-muted-foreground">Clique no link para abrir todos os detalhes.</p>
          </div>
          <div className="max-h-72 overflow-y-auto p-2">
            {items === null && !loadError ? (
              <div className="flex items-center justify-center gap-2 px-3 py-5 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando itens...
              </div>
            ) : loadError ? (
              <p className="px-3 py-4 text-xs text-muted-foreground">Não foi possível carregar a prévia.</p>
            ) : items?.length ? (
              <div className="divide-y">
                {items.map((item) => {
                  const product = item.productId ? products.find((entry) => entry.id === item.productId) : null;
                  const itemName =
                    (product ? getProductFullName(product) : "") ||
                    item.itemName ||
                    item.baseItemId ||
                    "Item da compra";
                  const quantity = Number(item.quantityOrdered || 0);
                  const total = Number(item.totalOrdered ?? quantity * Number(item.unitPriceOrdered || 0));

                  return (
                    <div key={item.id} className="flex items-start justify-between gap-3 px-2 py-2.5">
                      <div className="min-w-0">
                        <p className="line-clamp-2 text-xs font-medium leading-4">{itemName}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {quantity.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} {item.purchaseUnitLabel || item.unit || "un."}
                        </p>
                      </div>
                      <p className="shrink-0 font-mono text-xs font-semibold">{formatCurrency(total)}</p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="px-3 py-4 text-xs text-muted-foreground">Nenhum item cadastrado neste pedido.</p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function InstallmentScheduleTooltip({
  installments,
  label,
  totalInstallments,
}: {
  installments: any[];
  label: string;
  totalInstallments?: number;
}) {
  if (!Array.isArray(installments) || installments.length <= 1) return <span>{label}</span>;
  const scheduleTotal = Number(totalInstallments) > 0
    ? Number(totalInstallments)
    : Math.max(installments.length, ...installments.map((installment) => Number(installment?.number) || 0));

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="cursor-help border-b border-dotted border-current" aria-label="Ver datas das parcelas">
            {label}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" align="start" sideOffset={8} className="w-72 rounded-xl p-3">
          <p className="mb-2 text-xs font-semibold">Cronograma das parcelas</p>
          <div className="space-y-1.5">
            {installments.map((installment, index) => {
              const dueDate = toDate(installment?.dueDate);
              const status = installment?.status === "paid"
                ? "Paga"
                : installment?.status === "cancelled"
                ? "Cancelada"
                : installment?.status === "pending"
                ? "Pendente"
                : null;
              return (
                <div key={`${installment?.number || index + 1}-${dueDate?.getTime() || index}`} className="grid grid-cols-[40px_1fr_auto] gap-2 text-xs">
                  <span className="text-muted-foreground">{installment?.number || index + 1}/{scheduleTotal}</span>
                  <span>{dueDate ? format(dueDate, "dd/MM/yyyy") : "Sem data"}</span>
                  <span className="text-right">
                    {formatCurrency(Number(installment?.value) || 0)}
                    {status ? <span className="ml-1 text-[10px] text-muted-foreground">· {status}</span> : null}
                  </span>
                </div>
              );
            })}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
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

function getExpenseUnitLabel(expense: any, resultCenterNameById: ResultCenterNameMap) {
  if (!expense.isApportioned) {
    return resolveResultCenterName(expense.resultCenter, resultCenterNameById) || "—";
  }

  const participants = Array.from(
    new Set<string>(
      (expense.apportionments || [])
        .map((item: any) => resolveResultCenterName(item?.resultCenter, resultCenterNameById))
        .filter(Boolean)
    )
  );

  if (participants.length === 1) return participants[0];
  if (participants.length > 1) return `Rateado · ${participants.length} unidades`;
  return "Rateado";
}

function matchesBaseFilters(
  expense: any,
  {
    accountPlanMap,
    resultCenterNameById,
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
    resultCenterNameById: ResultCenterNameMap;
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
    unitFilter === "all" || expenseReferencesResultCenter(expense, unitFilter, resultCenterNameById);
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
  const { firebaseUser, permissions } = useAuth();
  const { kiosks } = useKiosks();
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: expensesData, loading, refresh: refreshExpenses } = useFinancialCollection<any>(financialCollection("expenses"));
  const { data: transactionsData } = useFinancialCollection<any>(financialCollection("transactions"));
  const { data: accountPlans } = useFinancialCollection<any>(financialCollection("accounts"));
  const { data: resultCenters, loading: resultCentersLoading } = useFinancialCollection<any>(financialCollection("resultCenters"));
  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") ?? "all");
  const [originFilter, setOriginFilter] = useState(searchParams.get("origin") ?? "all");
  const [periodPreset, setPeriodPreset] = useState<ExpensePeriodPreset>("current_month");
  const [dateFrom, setDateFrom] = useState(searchParams.get("date_from") ?? "");
  const [dateTo, setDateTo] = useState(searchParams.get("date_to") ?? "");
  const [competenceMonth, setCompetenceMonth] = useState(searchParams.get("competence") ?? format(new Date(), "yyyy-MM"));
  const [supplierFilter, setSupplierFilter] = useState(searchParams.get("supplier") ?? "all");
  const [accountPlanFilter, setAccountPlanFilter] = useState(searchParams.get("account_plan") ?? "all");
  const [unitFilter, setUnitFilter] = useState(searchParams.get("unit") ?? "all");
  const [payTarget, setPayTarget] = useState<any | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [finalizingAuditId, setFinalizingAuditId] = useState<string | null>(null);
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
  const resultCenterNameById = useMemo(() => {
    const map: ResultCenterNameMap = {};
    (resultCenters || []).forEach((center) => {
      if (typeof center.id === "string" && typeof center.name === "string" && center.name.trim()) {
        map[center.id] = center.name.trim();
      }
    });
    return map;
  }, [resultCenters]);

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
            resultCenterNameById,
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
      .sort(compareExpensesByDueDate);
  }, [accountPlanFilter, accountPlanMap, competenceMonth, dateFrom, dateTo, expenses, originFilter, resultCenterNameById, search, statusFilter, supplierFilter, unitFilter]);

  const scopedExpenses = useMemo(() => {
    const now = startOfDay(new Date());
    return expenses.filter((expense) =>
      matchesBaseFilters(expense, {
        accountPlanMap,
        resultCenterNameById,
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
  }, [accountPlanFilter, accountPlanMap, competenceMonth, dateFrom, dateTo, expenses, originFilter, resultCenterNameById, search, supplierFilter, unitFilter]);
  const unitCounts = useMemo(() => {
    const counts = new Map<string, number>();
    scopedExpenses.forEach((expense) => {
      units.forEach((unit) => {
        if (expenseReferencesResultCenter(expense, unit.name, resultCenterNameById)) {
          counts.set(unit.name, (counts.get(unit.name) || 0) + 1);
        }
      });
    });
    return counts;
  }, [resultCenterNameById, scopedExpenses, units]);

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
      const scopedValue = expenseValueForResultCenter(
        expense,
        unitFilter === "all" ? undefined : unitFilter,
        resultCenterNameById
      );
      if (expense.status === "pending") {
        open += scopedValue;
        if (due && due < now) overdue += scopedValue;
        if (due && due >= now && due <= in7Days) dueSoon += scopedValue;
      }
      if (expense.status === "paid") {
        paid += scopedValue;
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
  }, [expenses, resultCenterNameById, scopedExpenses, transactions, unitFilter]);

  const pendingAuditCount = useMemo(() => {
    const now = startOfDay(new Date());
    const expenseCount = expenses.filter((expense) => getExpenseStatusKey(expense, now) === "pending_audit").length;
    const transactionCount = transactions.filter(
      (transaction) =>
        transaction.importedFrom === "bank_statement" &&
        transaction.direction === "out" &&
        transaction.auditStatus === "pending"
    ).length;

    return expenseCount + transactionCount;
  }, [expenses, transactions]);

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
      refreshExpenses();
      toast({ title: "Despesa excluída." });
    } catch (error: any) {
      console.error("Erro ao excluir despesa:", error);
      toast({ variant: "destructive", title: "Erro ao excluir a despesa.", description: error.message || "Tente novamente mais tarde." });
    } finally {
      setDeleteTarget(null);
    }
  }

  async function handleFinalizeAudit(expense: any) {
    if (!firebaseUser || expense.originModule !== "purchasing" || expense.originStatus !== "pending_audit") return;

    setFinalizingAuditId(expense.id);
    try {
      const normalizedResultCenter = resolveResultCenterName(expense.resultCenter, resultCenterNameById);
      const normalizedApportionments = Array.isArray(expense.apportionments)
        ? expense.apportionments.map((item: any) => ({
            ...item,
            resultCenter: resolveResultCenterName(item?.resultCenter, resultCenterNameById),
          }))
        : expense.apportionments;
      await updateDoc(financialDoc("expenses", expense.id), {
        originStatus: "audited",
        auditStatus: "resolved",
        auditFinalizedAt: Timestamp.now(),
        auditFinalizedBy: firebaseUser.uid,
        ...(normalizedResultCenter && normalizedResultCenter !== expense.resultCenter
          ? { resultCenterId: expense.resultCenter, resultCenter: normalizedResultCenter }
          : {}),
        ...(Array.isArray(normalizedApportionments) ? { apportionments: normalizedApportionments } : {}),
        updatedAt: Timestamp.now(),
      });
      refreshExpenses();
      toast({
        title: "Auditoria finalizada.",
        description: expense.linkedBankTransactionId
          ? "O pagamento identificado no extrato foi preservado e a pendência foi encerrada."
          : "A classificação foi aprovada; a despesa permanece em aberto até o pagamento.",
      });
    } catch (error) {
      console.error(error);
      toast({ variant: "destructive", title: "Não foi possível finalizar a auditoria." });
    } finally {
      setFinalizingAuditId(null);
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
    <div className="mx-auto w-full max-w-[1220px] space-y-6 pb-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Despesas</h1>
          <p className="text-muted-foreground">Painel consolidado de despesas, contas a pagar e histórico de liquidações.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {permissions.financial?.paymentRequests?.view && (
            <Button variant="outline" size="sm" asChild>
              <Link href={FINANCIAL_ROUTES.paymentRequests}>
                <Landmark className="mr-2 h-4 w-4" /> Autorizações bancárias
              </Link>
            </Button>
          )}
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
      <KpiFlowStrip
        kpis={kpis}
        openCount={scopedExpenses.filter((expense) => expense.status === "pending").length}
        auditCount={pendingAuditCount}
        auditHref={FINANCIAL_ROUTES.pendingAuditExpenses}
      />

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
            <ExpensePeriodFilter
              preset={periodPreset}
              dateFrom={dateFrom}
              dateTo={dateTo}
              onApply={(period) => {
                setPeriodPreset(period.preset);
                setDateFrom(period.dateFrom);
                setDateTo(period.dateTo);
                setCompetenceMonth(period.preset === "current_month" ? period.dateFrom.slice(0, 7) : "");
              }}
            />
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
                {loading || resultCentersLoading ? (
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
                    const primaryUnit = getExpenseUnitLabel(expense, resultCenterNameById);
                    const installmentSchedule = Array.isArray(expense.installmentSchedule) && expense.installmentSchedule.length > 0
                      ? expense.installmentSchedule
                      : expense.installments || [];
                    const installmentNumber = Number(expense.installmentNumber) || Number(expense.installments?.[0]?.number) || 1;
                    const installmentTotal = Number(expense.installmentTotal) || Math.max(
                      installmentSchedule.length || 1,
                      ...installmentSchedule.map((installment: any) => Number(installment?.number) || 0)
                    );
                    const installmentLabel = `${installmentNumber}/${installmentTotal}`;

                    return (
                      <Fragment key={expense.id}>
                        <tr
                          className={cn("border-b cursor-pointer transition-colors hover:bg-muted/20", isExpanded && "bg-muted/20")}
                          onClick={() => setExpandedExpenseId((current) => (current === expense.id ? null : expense.id))}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-start gap-3">
                              <span className={cn("mt-1 h-7 w-1 shrink-0 rounded-full", STATUS_ACCENT_COLORS[statusKey] || "bg-border")} />
                              <div className="min-w-0 space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="line-clamp-2 min-w-0 font-medium leading-5">{expense.description}</p>
                                  {installmentSchedule.length > 1 && (
                                    <div className="inline-flex rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                      <InstallmentScheduleTooltip
                                        installments={installmentSchedule}
                                        label={installmentLabel}
                                        totalInstallments={installmentTotal}
                                      />
                                    </div>
                                  )}
                                  {expense.originModule === "purchasing" && (
                                    <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700">
                                      Compras
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="space-y-1">
                              <p>{expense.supplier || "—"}</p>
                              <p className="text-xs text-muted-foreground">{planName}</p>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <p className="line-clamp-2 break-words leading-5">{primaryUnit}</p>
                          </td>
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
                                    <div className="mt-1 text-sm font-medium">
                                      <InstallmentScheduleTooltip
                                        installments={installmentSchedule}
                                        label={installmentLabel}
                                        totalInstallments={installmentTotal}
                                      />
                                    </div>
                                  </div>
                                  {expense.purchaseOrderId && (
                                    <div className="sm:col-span-3">
                                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Pedido vinculado</p>
                                      <PurchaseOrderItemsLink
                                        orderId={expense.purchaseOrderId}
                                        href={`/dashboard/purchasing/orders/${expense.purchaseOrderId}?returnTo=${encodeURIComponent(FINANCIAL_ROUTES.pendingAuditExpenses)}`}
                                      />
                                    </div>
                                  )}
                                  {expense.notes && (
                                    <div className="sm:col-span-3 rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground">
                                      <span className="font-medium text-foreground">Observações:</span> {expense.notes}
                                    </div>
                                  )}
                                </div>
                                <div className="text-right">
                                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Valor total</p>
                                  <p className="mt-1 font-mono text-xl font-bold">{formatCurrency(expense.totalValue || 0)}</p>
                                </div>
                                <div className="flex flex-wrap justify-end gap-2 border-t border-border/70 pt-4 md:col-span-2 md:flex-nowrap">
                                  {permissions.financial?.expenses?.edit &&
                                    expense.originModule === "purchasing" &&
                                    expense.originStatus === "pending_audit" && (
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="border-rose-200 bg-rose-50 text-rose-600 hover:border-rose-300 hover:bg-rose-100 hover:text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300 dark:hover:bg-rose-950/50"
                                        disabled={finalizingAuditId === expense.id}
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          void handleFinalizeAudit(expense);
                                        }}
                                      >
                                        {finalizingAuditId === expense.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                        Finalizar auditoria
                                      </Button>
                                    )}
                                  {permissions.financial?.expenses?.pay && expense.status === "pending" && (
                                    <Button
                                      type="button"
                                      size="sm"
                                      className="bg-emerald-600 text-white hover:bg-emerald-700"
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
            {loading || resultCentersLoading ? (
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
                  const primaryUnit = getExpenseUnitLabel(expense, resultCenterNameById);

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
                        <span>{primaryUnit}</span>
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
                            <PurchaseOrderItemsLink
                              orderId={expense.purchaseOrderId}
                              href={`/dashboard/purchasing/orders/${expense.purchaseOrderId}?returnTo=${encodeURIComponent(FINANCIAL_ROUTES.pendingAuditExpenses)}`}
                              label="Abrir pedido"
                            />
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
                            {permissions.financial?.expenses?.edit &&
                              expense.originModule === "purchasing" &&
                              expense.originStatus === "pending_audit" && (
                                <DropdownMenuItem
                                  disabled={finalizingAuditId === expense.id}
                                  onClick={() => void handleFinalizeAudit(expense)}
                                >
                                  Finalizar auditoria
                                </DropdownMenuItem>
                              )}
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
