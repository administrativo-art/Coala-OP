"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { deleteDoc, Timestamp, updateDoc } from "firebase/firestore";
import { addMonths, format, startOfDay, addDays, endOfDay, startOfMonth, endOfMonth } from "date-fns";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  CreditCard,
  FileCheck2,
  FilePlus2,
  FileUp,
  Inbox,
  Loader2,
  MoreHorizontal,
  Pencil,
  ReceiptText,
  Search,
  Trash2,
  ShieldCheck,
} from "lucide-react";
import { PayExpenseDialog } from "@/features/financial/components/pay-expense-dialog";
import {
  ExpensePeriodFilter,
  type ExpensePeriodPreset,
} from "@/features/financial/components/expenses/expense-period-filter";
import { KpiFlowStrip } from "@/features/financial/components/expenses/kpi-flow-strip";
import { ExpenseFinancialSummary } from "@/features/financial/components/expenses/expense-financial-summary";
import { ExpenseCompetencePicker } from "@/features/financial/components/expenses/expense-competence-picker";
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
import {
  expenseAccountAllocations,
  expenseAccountPlanLabels,
} from "@/features/financial/lib/expense-account-allocations";
import {
  expensePersonAllocations,
  personAllocationDistinctPeopleCount,
  personAllocationsAreValid,
} from "@/features/financial/lib/expense-person-allocations";
import {
  compareExpensesByDueDateDirection,
  compareExpensesByValue,
  type ExpenseSortDirection,
} from "@/features/financial/lib/expense-order";
import {
  compareExpenseCompetenceMonths,
  consolidateExpenseObligations,
  groupExpensesByDueWeek,
  type ExpenseDueWeekGroup,
} from "@/features/financial/lib/expense-list";
import {
  cardExpenseAuditIssues,
  PLANNED_PAYMENT_METHOD_LABELS,
  type PlannedPaymentMethodType,
} from "@/features/financial/lib/card-invoices";
import {
  groupExpensesByCardStatement,
  type ExpenseCardStatementListEntry,
} from "@/features/financial/lib/expense-card-statement-groups";
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
import { PageContainer } from "@/components/layout/page-container";

const STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  pending_audit: "Pendente auditoria",
  paid: "Pago",
  reported_paid: "Pago informado",
  partially_paid: "Parcialmente pago",
  paid_divergent: "Pagamento divergente",
  cancelled: "Cancelado",
  overdue: "Vencido",
  pending: "Em aberto",
  due_soon: "Vence hoje",
  provisioned: "Provisionado",
  reconciled: "Previsão conciliada",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "border-slate-300 bg-slate-50 text-slate-700 dark:bg-slate-950/30 dark:text-slate-400 dark:border-slate-800",
  pending_audit: "border-violet-200 bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300 dark:border-violet-800",
  paid: "border-green-400 bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800",
  reported_paid: "border-sky-300 bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300 dark:border-sky-800",
  partially_paid: "border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800",
  paid_divergent: "border-rose-300 bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-800",
  cancelled: "border-zinc-300 bg-zinc-50 text-zinc-500 dark:bg-zinc-900/50 dark:text-zinc-400 dark:border-zinc-800",
  overdue: "border-rose-300 bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-800",
  pending: "border-blue-300 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800",
  due_soon: "border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800",
  provisioned: "border-cyan-300 bg-cyan-50 text-cyan-700 dark:bg-cyan-950/30 dark:text-cyan-300 dark:border-cyan-800",
  reconciled: "border-slate-300 bg-slate-50 text-slate-500 dark:bg-slate-950/30 dark:text-slate-400 dark:border-slate-800",
};

const STATUS_ACCENT_COLORS: Record<string, string> = {
  draft: "bg-slate-400",
  pending_audit: "bg-violet-500",
  paid: "bg-emerald-500",
  reported_paid: "bg-sky-500",
  partially_paid: "bg-amber-500",
  paid_divergent: "bg-rose-500",
  cancelled: "bg-zinc-300",
  overdue: "bg-rose-500",
  pending: "bg-blue-500",
  due_soon: "bg-amber-500",
  provisioned: "bg-cyan-500",
  reconciled: "bg-slate-400",
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
    paymentTypeFilter,
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
    paymentTypeFilter: string;
    now: Date;
  }
) {
  const planName = accountPlanMap[expense.accountId ?? expense.accountPlan] || expense.accountPlanName || expense.accountId || expense.accountPlan || "";
  const accountingPlanNames = Array.from(new Set([planName, ...expenseAccountPlanLabels(expense, accountPlanMap)].filter(Boolean)));
  const due = toDate(expense.dueDate);
  const competence = toDate(expense.competenceDate);
  const belongsToUnit =
    unitFilter === "all" || expenseReferencesResultCenter(expense, unitFilter, resultCenterNameById);
  const normalizedSearch = search.toLowerCase();
  const matchesSearch =
    !search ||
    expense.description.toLowerCase().includes(normalizedSearch) ||
    accountingPlanNames.some((name) => name.toLowerCase().includes(normalizedSearch)) ||
    (expense.supplier || "").toLowerCase().includes(normalizedSearch);

  const matchesOrigin =
    originFilter === "all" ||
    (originFilter === "purchasing" && expense.originModule === "purchasing") ||
    (originFilter === "manual" && expense.originModule !== "purchasing");

  const matchesDateFrom = !dateFrom || (due && due >= new Date(`${dateFrom}T00:00:00`));
  const matchesDateTo = !dateTo || (due && due <= new Date(`${dateTo}T23:59:59`));
  const matchesCompetence =
    !competenceMonth
    || competenceMonth === "all"
    || (competence && format(competence, "yyyy-MM") === competenceMonth);
  const matchesSupplier = supplierFilter === "all" || (expense.supplier || "") === supplierFilter;
  const matchesAccountPlan = accountPlanFilter === "all" || accountingPlanNames.includes(accountPlanFilter);
  const matchesPaymentType =
    paymentTypeFilter === "all" ||
    (paymentTypeFilter === "unassigned" && !expense.plannedPaymentMethodType) ||
    expense.plannedPaymentMethodType === paymentTypeFilter;

  return (
    matchesSearch &&
    matchesOrigin &&
    matchesDateFrom &&
    matchesDateTo &&
    matchesCompetence &&
    matchesSupplier &&
    matchesAccountPlan &&
    matchesPaymentType &&
    belongsToUnit
  );
}

type ExpenseDisplayEntry = ExpenseCardStatementListEntry<any>;

type ExpenseListRow =
  | { kind: "week"; group: ExpenseDueWeekGroup<ExpenseDisplayEntry> }
  | ExpenseDisplayEntry;

type ExpenseSortKey = "dueDate" | "value";

function accountPlanBreadcrumb(plan: any, plansById: Map<string, any>) {
  const labels: string[] = [];
  const visited = new Set<string>();
  let current = plan;

  while (current && !visited.has(String(current.id))) {
    visited.add(String(current.id));
    if (typeof current.name === "string" && current.name.trim()) labels.unshift(current.name.trim());
    current = current.parentId ? plansById.get(String(current.parentId)) : null;
  }

  return labels.join(" › ");
}

function getExpenseStatusKey(expense: any, now: Date) {
  const due = toDate(expense.dueDate);
  let statusKey = expense.status;

  if (expense.paymentState === "reported_paid") return "reported_paid";
  if (expense.paymentState === "paid_divergent") return "paid_divergent";
  if (expense.status === "partially_paid") return "partially_paid";

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
  const [competenceMonth, setCompetenceMonth] = useState(searchParams.get("competence") || "all");
  const [supplierFilter, setSupplierFilter] = useState(searchParams.get("supplier") ?? "all");
  const [accountPlanFilter, setAccountPlanFilter] = useState(searchParams.get("account_plan") ?? "all");
  const [unitFilter, setUnitFilter] = useState(searchParams.get("unit") ?? "all");
  const [paymentTypeFilter, setPaymentTypeFilter] = useState(searchParams.get("payment_type") ?? "all");
  const [expenseSort, setExpenseSort] = useState<{ key: ExpenseSortKey; direction: ExpenseSortDirection }>({
    key: "dueDate",
    direction: "asc",
  });
  const [payTarget, setPayTarget] = useState<any | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [finalizingAuditId, setFinalizingAuditId] = useState<string | null>(null);
  const [expandedExpenseId, setExpandedExpenseId] = useState<string | null>(null);
  const [expandedCardStatementKey, setExpandedCardStatementKey] = useState<string | null>(null);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const canAccessAudits = permissions.financial?.audits?.view === true;
  const canImportAudits = canAccessAudits && permissions.financial?.audits?.import === true;
  const canViewPersonnelCosts = permissions.financial?.personnelCosts?.view === true;
  const canViewExpenses = permissions.financial?.expenses?.view === true;
  const canViewInbox = permissions.financial?.inbox?.view === true;
  const canViewPaymentRequests = permissions.financial?.paymentRequests?.view === true;
  const currentView = canAccessAudits && (!canViewExpenses || searchParams.get("view") === "audits") ? "audits" : "expenses";
  const searchParamsKey = searchParams.toString();

  if (!canViewExpenses && !canAccessAudits && !canViewInbox && !canViewPaymentRequests) {
    return (
      <FinancialAccessGuard
        title="Despesas"
        description="Seu perfil não possui permissão para consultar despesas, contas a pagar e histórico de liquidações."
      />
    );
  }

  if (!canViewExpenses && !canAccessAudits && (canViewInbox || canViewPaymentRequests)) {
    return (
      <PageContainer variant="default" className="space-y-6 pb-10">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Despesas</h1>
          <p className="text-muted-foreground">Seu perfil possui acesso aos fluxos operacionais liberados dentro de contas a pagar.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {canViewInbox ? <Card><CardContent className="flex flex-col items-start gap-3 p-6">
            <p className="font-semibold">Cobranças recebidas</p>
            <p className="text-sm text-muted-foreground">Analise os documentos recebidos e acompanhe seus vínculos com despesas.</p>
            <Button asChild><Link href={FINANCIAL_ROUTES.inbox}><Inbox className="mr-2 h-4 w-4" />Abrir caixa de cobranças</Link></Button>
          </CardContent></Card> : null}
          {canViewPaymentRequests ? <Card><CardContent className="flex flex-col items-start gap-3 p-6">
            <p className="font-semibold">Autorizações bancárias</p>
            <p className="text-sm text-muted-foreground">Consulte solicitações, autorize o envio e acompanhe a situação no Banco Inter.</p>
            <Button asChild><Link href={FINANCIAL_ROUTES.paymentRequests}><ShieldCheck className="mr-2 h-4 w-4" />Abrir autorizações bancárias</Link></Button>
          </CardContent></Card> : null}
        </div>
      </PageContainer>
    );
  }

  const expenses = expensesData || [];
  const expenseById = useMemo(
    () => new Map(expenses.map((expense) => [String(expense.id), expense])),
    [expenses]
  );
  const consolidatedExpenses = useMemo(
    () => consolidateExpenseObligations(expenses),
    [expenses]
  );
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
    const params = new URLSearchParams(searchParamsKey);
    setSearch(params.get("search") ?? "");
    setStatusFilter(params.get("status") ?? "all");
    setOriginFilter(params.get("origin") ?? "all");
    setPeriodPreset("custom");
    setDateFrom(params.get("date_from") ?? "");
    setDateTo(params.get("date_to") ?? "");
    setCompetenceMonth(params.get("competence") || "all");
    setSupplierFilter(params.get("supplier") ?? "all");
    setAccountPlanFilter(params.get("account_plan") ?? "all");
    setUnitFilter(params.get("unit") ?? "all");
    setPaymentTypeFilter(params.get("payment_type") ?? "all");
  }, [searchParamsKey]);

  useEffect(() => {
    const params = new URLSearchParams(searchParamsKey);
    if (params.get("date_from") || params.get("date_to") || params.get("competence")) {
      return;
    }

    const now = new Date();
    setPeriodPreset("current_month");
    setDateFrom(format(startOfMonth(now), "yyyy-MM-dd"));
    setDateTo(format(endOfMonth(now), "yyyy-MM-dd"));
  }, [searchParamsKey]);

  const accountPlanOptions = useMemo(() => {
    const plansById = new Map((accountPlans || []).map((plan) => [String(plan.id), plan]));
    const breadcrumbByName = new Map<string, string>();
    (accountPlans || []).forEach((plan) => {
      if (typeof plan?.name !== "string" || !plan.name.trim()) return;
      breadcrumbByName.set(plan.name.trim(), accountPlanBreadcrumb(plan, plansById) || plan.name.trim());
    });

    const names = Array.from(
      new Set(
        consolidatedExpenses
          .flatMap((expense) => {
            const planName = accountPlanMap[expense.accountId ?? expense.accountPlan]
              || expense.accountPlanName
              || expense.accountId
              || expense.accountPlan;
            return [planName, ...expenseAccountPlanLabels(expense, accountPlanMap)];
          })
          .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
      )
    );

    return names
      .map((value) => ({ value, label: breadcrumbByName.get(value) || value }))
      .sort((left, right) => left.label.localeCompare(right.label, "pt-BR"));
  }, [accountPlanMap, accountPlans, consolidatedExpenses]);
  const competenceOptions = useMemo(
    () => {
      const rollingPastMonths = Array.from({ length: 13 }, (_, offset) =>
        format(addMonths(startOfMonth(new Date()), -offset), "yyyy-MM")
      );
      return Array.from(
        new Set(
          [
            ...rollingPastMonths,
            ...(competenceMonth !== "all" ? [competenceMonth] : []),
            ...consolidatedExpenses
            .map((expense) => toDate(expense.competenceDate))
            .filter((date): date is Date => Boolean(date))
            .map((date) => format(date, "yyyy-MM")),
          ]
        )
      ).sort(compareExpenseCompetenceMonths);
    },
    [competenceMonth, consolidatedExpenses]
  );

  const units = useMemo(
    () => [...kiosks].sort((left, right) => left.name.localeCompare(right.name, "pt-BR")),
    [kiosks]
  );
  const resultCenterNameByUnitName = useMemo(() => {
    const kioskNameById = new Map(kiosks.map((kiosk) => [kiosk.id, kiosk.name]));
    const map: Record<string, string> = {};
    (resultCenters || []).forEach((center) => {
      if (typeof center?.name !== "string") return;
      (Array.isArray(center.unitIds) ? center.unitIds : []).forEach((unitId: unknown) => {
        const unitName = typeof unitId === "string" ? kioskNameById.get(unitId) : undefined;
        if (unitName) map[unitName] = center.name;
      });
    });
    return map;
  }, [kiosks, resultCenters]);
  const financialUnitFilter = unitFilter === "all"
    ? "all"
    : (resultCenterNameByUnitName[unitFilter] || unitFilter);

  const filtered = useMemo(() => {
    const now = startOfDay(new Date());
    return consolidatedExpenses
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
            unitFilter: financialUnitFilter,
            paymentTypeFilter,
            now,
          })
        ) {
          return false;
        }
        const computedStatus = getExpenseStatusKey(expense, now);

        const matchesStatus =
          statusFilter === "all" ||
          (statusFilter === "reconciled" && Boolean(expense.reconciledProvisionId)) ||
          (statusFilter === "pending" && ["pending", "due_soon", "overdue"].includes(computedStatus)) ||
          computedStatus === "pending_audit" && statusFilter === "pending_audit" ||
          computedStatus === statusFilter;

        return matchesStatus;
      })
      .sort((left, right) => expenseSort.key === "value"
        ? compareExpensesByValue(left, right, expenseSort.direction)
        : compareExpensesByDueDateDirection(left, right, expenseSort.direction));
  }, [accountPlanFilter, accountPlanMap, competenceMonth, consolidatedExpenses, dateFrom, dateTo, expenseSort, financialUnitFilter, originFilter, paymentTypeFilter, resultCenterNameById, search, statusFilter, supplierFilter]);

  const scopedExpenses = useMemo(() => {
    const now = startOfDay(new Date());
    return consolidatedExpenses.filter((expense) =>
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
        unitFilter: financialUnitFilter,
        paymentTypeFilter,
        now,
      })
    );
  }, [accountPlanFilter, accountPlanMap, competenceMonth, consolidatedExpenses, dateFrom, dateTo, financialUnitFilter, originFilter, paymentTypeFilter, resultCenterNameById, search, supplierFilter]);
  const scopedDisplayEntries = useMemo(
    () => groupExpensesByCardStatement(scopedExpenses),
    [scopedExpenses]
  );
  const unitCounts = useMemo(() => {
    const counts = new Map<string, number>();
    scopedDisplayEntries.forEach((entry) => {
      const expensesInEntry = entry.kind === "expense" ? [entry.expense] : entry.statement.expenses;
      units.forEach((unit) => {
        const financialCenterName = resultCenterNameByUnitName[unit.name] || unit.name;
        if (expensesInEntry.some((expense) => expenseReferencesResultCenter(expense, financialCenterName, resultCenterNameById))) {
          counts.set(unit.name, (counts.get(unit.name) || 0) + 1);
        }
      });
    });
    return counts;
  }, [resultCenterNameById, resultCenterNameByUnitName, scopedDisplayEntries, units]);

  const filteredDisplayEntries = useMemo(() => {
    const entries = groupExpensesByCardStatement(filtered);
    return entries.sort((left, right) => {
      const leftComparable = left.kind === "expense"
        ? left.expense
        : {
            id: left.statement.id,
            description: left.statement.title,
            dueDate: left.statement.dueDate,
            totalValue: left.statement.totalValue,
          };
      const rightComparable = right.kind === "expense"
        ? right.expense
        : {
            id: right.statement.id,
            description: right.statement.title,
            dueDate: right.statement.dueDate,
            totalValue: right.statement.totalValue,
          };
      return expenseSort.key === "value"
        ? compareExpensesByValue(leftComparable, rightComparable, expenseSort.direction)
        : compareExpensesByDueDateDirection(leftComparable, rightComparable, expenseSort.direction);
    });
  }, [expenseSort, filtered]);
  const scopedDisplayEntryCount = scopedDisplayEntries.length;
  const filteredCountLabel = `${filteredDisplayEntries.length} de ${scopedDisplayEntryCount}`;
  const activeCompetenceLabel = competenceMonth !== "all"
    ? `${competenceMonth.slice(5, 7)}/${competenceMonth.slice(0, 4)}`
    : null;
  const expenseListRows = useMemo<ExpenseListRow[]>(() => {
    if (!activeCompetenceLabel) {
      return filteredDisplayEntries;
    }

    const groups = groupExpensesByDueWeek(
      filteredDisplayEntries,
      (entry) => entry.kind === "expense" ? toDate(entry.expense.dueDate) : entry.statement.dueDate,
      (entry) => entry.kind === "expense" ? Number(entry.expense.totalValue) || 0 : entry.statement.totalValue,
    );
    if (expenseSort.key === "dueDate" && expenseSort.direction === "desc") groups.reverse();

    return groups.flatMap((group) => [
      { kind: "week" as const, group },
      ...group.expenses,
    ]);
  }, [activeCompetenceLabel, expenseSort, filteredDisplayEntries]);

  function toggleExpenseSort(key: ExpenseSortKey) {
    setExpenseSort((current) => current.key === key
      ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
      : { key, direction: "asc" });
  }

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
        financialUnitFilter === "all" ? undefined : financialUnitFilter,
        resultCenterNameById
      );
      if (expense.status === "pending") {
        open += scopedValue;
        if (due && due < now) overdue += scopedValue;
        if (due && due >= now && due <= in7Days) dueSoon += scopedValue;
      }
      if (expense.status === "partially_paid") {
        const totalValue = Number(expense.totalValue) || 0;
        const scopedRatio = totalValue > 0 ? scopedValue / totalValue : 1;
        const balance = expense.settlementSummary?.balanceAmountCents != null
          ? Number(expense.settlementSummary.balanceAmountCents) / 100 * scopedRatio
          : scopedValue;
        const settled = expense.settlementSummary?.principalSettledAmountCents != null
          ? Number(expense.settlementSummary.principalSettledAmountCents) / 100 * scopedRatio
          : Math.max(0, scopedValue - balance);
        open += balance;
        paid += settled;
        if (due && due < now) overdue += balance;
        if (due && due >= now && due <= in7Days) dueSoon += balance;
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
  }, [expenses, financialUnitFilter, resultCenterNameById, scopedExpenses, transactions]);

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

    if (expense.hasPersonAllocations === true && !personAllocationsAreValid(expense)) {
      toast({
        variant: "destructive",
        title: "Individualização incompleta.",
        description: "Revise os colaboradores, centros e valores antes de finalizar a auditoria.",
      });
      return;
    }

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
    <PageContainer variant="default" className="space-y-6 pb-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Despesas</h1>
          <p className="text-muted-foreground">Painel consolidado de despesas, contas a pagar e histórico de liquidações.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canViewInbox && (
            <Button variant="outline" size="sm" asChild>
              <Link href={FINANCIAL_ROUTES.inbox}>
                <Inbox className="mr-2 h-4 w-4" /> Cobranças recebidas
              </Link>
            </Button>
          )}
          {permissions.financial?.paymentRequests?.view && (
            <Button variant="outline" size="sm" asChild>
              <Link href={FINANCIAL_ROUTES.paymentRequests}>
                <ShieldCheck className="mr-2 h-4 w-4" /> Autorizações bancárias
              </Link>
            </Button>
          )}
          {canImportAudits && (
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
          <TabsList className={cn("grid h-auto w-full max-w-[360px] rounded-xl border bg-card p-1 shadow-sm", canViewExpenses ? "grid-cols-2" : "grid-cols-1")}>
            {canViewExpenses ? <TabsTrigger
              value="expenses"
              className="group rounded-lg px-4 py-2.5 text-sm font-semibold"
            >
              <span className="flex items-center justify-center gap-2">
                <ReceiptText className="h-4 w-4 group-data-[state=active]:text-primary" />
                <span>Despesas</span>
              </span>
            </TabsTrigger> : null}
            <TabsTrigger
              value="audits"
              className="group rounded-lg px-4 py-2.5 text-sm font-semibold"
            >
              <span className="flex items-center justify-center gap-2">
                <FileCheck2 className="h-4 w-4 group-data-[state=active]:text-primary" />
                <span>Auditorias</span>
              </span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="expenses" className="space-y-6">
      <KpiFlowStrip
        kpis={kpis}
        openCount={scopedExpenses.filter((expense) => ["pending", "partially_paid"].includes(expense.status)).length}
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
              {scopedDisplayEntryCount}
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
          <div data-testid="expense-filter-bar" className="grid grid-cols-2 items-center gap-2 md:grid-cols-[minmax(170px,1.7fr)_minmax(0,.8fr)_minmax(0,.85fr)_minmax(0,.95fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,.85fr)_auto]">
            <div className="relative col-span-2 min-w-0 md:col-span-1">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por descrição, fornecedor..."
                className="h-8 rounded-lg border-border/70 bg-background pl-9 text-xs"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-full min-w-0 rounded-lg border-border/70 bg-background px-2.5 text-[10.5px] sm:text-xs [&>span]:truncate [&>span]:whitespace-nowrap">
                <SelectValue placeholder="Filtrar por status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                <SelectItem value="pending">Em aberto</SelectItem>
                <SelectItem value="pending_audit">Compras pendentes de auditoria</SelectItem>
                <SelectItem value="draft">Rascunhos</SelectItem>
                <SelectItem value="overdue">Vencidos</SelectItem>
                <SelectItem value="paid">Pagos</SelectItem>
                <SelectItem value="provisioned">Provisionados</SelectItem>
                <SelectItem value="reconciled">Com previsão conciliada</SelectItem>
                <SelectItem value="cancelled">Cancelados</SelectItem>
              </SelectContent>
            </Select>
            <Select value={originFilter} onValueChange={setOriginFilter}>
              <SelectTrigger className="h-8 w-full min-w-0 rounded-lg border-border/70 bg-background px-2.5 text-[10.5px] sm:text-xs [&>span]:truncate [&>span]:whitespace-nowrap">
                <SelectValue placeholder="Filtrar por origem" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as origens</SelectItem>
                <SelectItem value="purchasing">Origem: Compras</SelectItem>
                <SelectItem value="manual">Demais despesas</SelectItem>
              </SelectContent>
            </Select>
            <Select value={paymentTypeFilter} onValueChange={setPaymentTypeFilter}>
              <SelectTrigger className="h-8 w-full min-w-0 rounded-lg border-border/70 bg-background px-2.5 text-[10.5px] sm:text-xs [&>span]:truncate [&>span]:whitespace-nowrap">
                <SelectValue placeholder="Forma de pagamento" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os pagamentos</SelectItem>
                <SelectItem value="credit_card">Cartão de crédito</SelectItem>
                <SelectItem value="debit_card">Cartão de débito</SelectItem>
                <SelectItem value="pix">PIX</SelectItem>
                <SelectItem value="transfer">Transferência</SelectItem>
                <SelectItem value="cash">Dinheiro</SelectItem>
                <SelectItem value="unassigned">Não informado</SelectItem>
              </SelectContent>
            </Select>
            <ExpenseCompetencePicker
              value={competenceMonth}
              options={competenceOptions}
              onValueChange={(value) => {
                setCompetenceMonth(value);
                if (value !== "all") {
                  setPeriodPreset("custom");
                  setDateFrom("");
                  setDateTo("");
                }
              }}
              className={cn(
                activeCompetenceLabel && "border-primary/60 bg-primary/[0.06] text-primary ring-1 ring-primary/15"
              )}
            />
            <ExpensePeriodFilter
              preset={periodPreset}
              dateFrom={dateFrom}
              dateTo={dateTo}
              onApply={(period) => {
                setPeriodPreset(period.preset);
                setDateFrom(period.dateFrom);
                setDateTo(period.dateTo);
                if (period.dateFrom || period.dateTo) setCompetenceMonth("all");
              }}
            />
            <Select value={accountPlanFilter} onValueChange={setAccountPlanFilter}>
              <SelectTrigger data-testid="expense-account-plan-filter" className="h-8 w-full min-w-0 rounded-lg border-border/70 bg-background px-2.5 text-[10.5px] sm:text-xs [&>span]:truncate [&>span]:whitespace-nowrap">
                <SelectValue placeholder="Plano de contas" />
              </SelectTrigger>
              <SelectContent className="max-h-[360px]">
                <SelectItem value="all">Todos os planos</SelectItem>
                {accountPlanOptions.map((accountPlan) => (
                  <SelectItem key={accountPlan.value} value={accountPlan.value} title={accountPlan.label}>
                    {accountPlan.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="col-span-2 justify-self-end whitespace-nowrap text-xs text-muted-foreground md:col-span-1">{filteredCountLabel}</span>
          </div>
          {activeCompetenceLabel ? (
            <div
              data-testid="active-expense-competence"
              className="mt-3 inline-flex max-w-full flex-wrap items-center gap-2 rounded-lg border border-primary/20 bg-primary/[0.045] px-2.5 py-1.5"
            >
              <CalendarDays className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-primary/75">
                Competência
              </span>
              <span className="text-xs font-semibold text-foreground">{activeCompetenceLabel}</span>
              <span className="h-3.5 w-px bg-primary/15" />
              <span className="text-[10.5px] text-muted-foreground">
                {filteredDisplayEntries.length} {filteredDisplayEntries.length === 1 ? "obrigação" : "obrigações"}
              </span>
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="p-0">
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Descrição</th>
                  <th className="px-4 py-3 font-medium">Fornecedor</th>
                  <th className="px-4 py-3 font-medium">Unidade</th>
                  <th
                    className="px-4 py-3 font-medium"
                    aria-sort={expenseSort.key === "dueDate" ? (expenseSort.direction === "asc" ? "ascending" : "descending") : "none"}
                  >
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-md transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => toggleExpenseSort("dueDate")}
                    >
                      Vencimento
                      {expenseSort.key === "dueDate"
                        ? expenseSort.direction === "asc"
                          ? <ArrowUp className="h-3.5 w-3.5" />
                          : <ArrowDown className="h-3.5 w-3.5" />
                        : null}
                    </button>
                  </th>
                  <th
                    className="px-4 py-3 text-right font-medium"
                    aria-sort={expenseSort.key === "value" ? (expenseSort.direction === "asc" ? "ascending" : "descending") : "none"}
                  >
                    <button
                      type="button"
                      className="ml-auto inline-flex items-center gap-1.5 rounded-md transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => toggleExpenseSort("value")}
                    >
                      Valor
                      {expenseSort.key === "value"
                        ? expenseSort.direction === "asc"
                          ? <ArrowUp className="h-3.5 w-3.5" />
                          : <ArrowDown className="h-3.5 w-3.5" />
                        : null}
                    </button>
                  </th>
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
                ) : filteredDisplayEntries.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-16 text-center text-muted-foreground">
                      Nenhuma despesa encontrada.
                    </td>
                  </tr>
                ) : (
                  expenseListRows.map((row) => {
                    if (row.kind === "week") {
                      return (
                        <tr key={`week-${row.group.key}`} className="border-b border-primary/10 bg-primary/[0.035]">
                          <td colSpan={7} className="px-4 py-2.5">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="flex items-center gap-2">
                                <CalendarDays className="h-3.5 w-3.5 text-primary" />
                                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary/75">
                                  Semana de vencimento
                                </span>
                                <span className="text-xs font-semibold text-foreground">{row.group.label}</span>
                                <span className="text-[10.5px] text-muted-foreground">
                                  {row.group.expenses.length} {row.group.expenses.length === 1 ? "obrigação" : "obrigações"}
                                </span>
                              </div>
                              <span className="font-mono text-xs font-semibold text-foreground">
                                {formatCurrency(row.group.totalValue)}
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    }
                    if (row.kind === "card_statement") {
                      const statement = row.statement;
                      const due = statement.dueDate;
                      const isExpanded = expandedCardStatementKey === statement.key;
                      const statementUnits = Array.from(new Set(
                        statement.expenses
                          .map((expense) => getExpenseUnitLabel(expense, resultCenterNameById))
                          .filter((unit) => unit && unit !== "—")
                      ));
                      const unitLabel = statementUnits.length === 0
                        ? "Classificação pendente"
                        : statementUnits.length === 1
                          ? statementUnits[0]
                          : `${statementUnits.length} unidades`;
                      const auditSummary = statement.auditCounts.pending > 0
                        ? `${statement.auditCounts.pending} pendente${statement.auditCounts.pending === 1 ? "" : "s"} de auditoria`
                        : statement.auditCounts.reconciled === statement.expenses.length
                          ? `${statement.expenses.length} conferida${statement.expenses.length === 1 ? "" : "s"}`
                          : `${statement.auditCounts.audited} auditada${statement.auditCounts.audited === 1 ? "" : "s"} · ${statement.auditCounts.reconciled} conferida${statement.auditCounts.reconciled === 1 ? "" : "s"}`;
                      const firstExpense = statement.expenses[0];
                      const statementHref = `${FINANCIAL_ROUTES.cardStatements}?month=${encodeURIComponent(statement.monthKey)}&accountId=${encodeURIComponent(String(firstExpense?.plannedBankAccountId || ""))}&paymentMethodId=${encodeURIComponent(String(firstExpense?.plannedPaymentMethodId || ""))}`;

                      return (
                        <Fragment key={`card-statement-${statement.key}`}>
                          <tr
                            className={cn("border-b cursor-pointer bg-sky-50/25 transition-colors hover:bg-sky-50/50", isExpanded && "bg-sky-50/50")}
                            onClick={() => setExpandedCardStatementKey((current) => current === statement.key ? null : statement.key)}
                          >
                            <td className="px-4 py-3">
                              <div className="flex items-start gap-3">
                                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-sky-100 text-sky-700">
                                  <CreditCard className="h-4 w-4" />
                                </span>
                                <div className="min-w-0 space-y-1">
                                  <p className="line-clamp-2 font-semibold leading-5">{statement.title}</p>
                                  <span className="inline-flex rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-700">
                                    Fatura de cartão
                                  </span>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <p>{statement.expenses.length} {statement.expenses.length === 1 ? "compra" : "compras"}</p>
                              <p className={cn("mt-1 text-xs", statement.auditCounts.pending > 0 ? "text-amber-700" : "text-muted-foreground")}>
                                {auditSummary}
                              </p>
                            </td>
                            <td className="px-4 py-3">
                              <p className="line-clamp-2 leading-5">{unitLabel}</p>
                            </td>
                            <td className="px-4 py-3">
                              <p>{due ? format(due, "dd/MM/yyyy") : "—"}</p>
                              {due && statement.status !== "paid" ? (
                                <p className={cn("mt-1 text-xs", due < startOfDay(new Date()) ? "text-rose-600" : "text-muted-foreground")}>
                                  {due < startOfDay(new Date())
                                    ? `${Math.abs(Math.round((startOfDay(new Date()).getTime() - due.getTime()) / 86400000))}d atraso`
                                    : `em ${Math.round((due.getTime() - startOfDay(new Date()).getTime()) / 86400000)}d`}
                                </p>
                              ) : null}
                            </td>
                            <td className="px-4 py-3 text-right font-mono font-semibold">{formatCurrency(statement.totalValue)}</td>
                            <td className="w-[160px] px-4 py-3 text-center">
                              <span className={cn("inline-flex whitespace-nowrap rounded-full border px-2 py-1 text-[11px]", STATUS_COLORS[statement.status])}>
                                {STATUS_LABELS[statement.status]}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              {isExpanded ? <ChevronUp className="ml-auto h-4 w-4 text-muted-foreground" /> : <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground" />}
                            </td>
                          </tr>
                          {isExpanded ? (
                            <tr className="border-b bg-sky-50/15">
                              <td colSpan={7} className="px-4 pb-4 pt-2">
                                <div className="overflow-hidden rounded-xl border bg-background">
                                  <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/25 px-4 py-3">
                                    <div>
                                      <p className="text-sm font-semibold">Compras desta fatura</p>
                                      <p className="mt-0.5 text-xs text-muted-foreground">
                                        A fatura é a obrigação de pagamento; cada compra permanece como despesa individual na DRE.
                                      </p>
                                    </div>
                                    {canAccessAudits ? (
                                      <Button asChild variant="outline" size="sm" className="h-8 rounded-lg text-xs">
                                        <Link href={statementHref} onClick={(event) => event.stopPropagation()}>
                                          Abrir auditoria do cartão
                                        </Link>
                                      </Button>
                                    ) : null}
                                  </div>
                                  <div className="overflow-x-auto">
                                    <table className="min-w-[920px] w-full text-left text-xs">
                                      <thead className="border-b bg-muted/10 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                        <tr>
                                          <th className="px-3 py-2.5 font-semibold">Compra</th>
                                          <th className="px-3 py-2.5 font-semibold">Data</th>
                                          <th className="px-3 py-2.5 font-semibold">Plano de contas</th>
                                          <th className="px-3 py-2.5 font-semibold">Unidade</th>
                                          <th className="px-3 py-2.5 text-right font-semibold">Valor</th>
                                          <th className="px-3 py-2.5 text-center font-semibold">Auditoria</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y">
                                        {statement.expenses.map((expense) => {
                                          const issues = cardExpenseAuditIssues(expense);
                                          const auditStatus = expense.cardReconciliationStatus === "reconciled"
                                            ? "reconciled"
                                            : issues.length === 0 ? "audited" : "pending";
                                          const auditMeta = auditStatus === "reconciled"
                                            ? { label: "Conferida", className: "border-emerald-200 bg-emerald-50 text-emerald-700" }
                                            : auditStatus === "audited"
                                              ? { label: "Auditada", className: "border-sky-200 bg-sky-50 text-sky-700" }
                                              : { label: "Pendente", className: "border-amber-200 bg-amber-50 text-amber-700" };
                                          const planName = accountPlanMap[expense.accountId ?? expense.accountPlan]
                                            || expense.accountPlanName || expense.accountId || expense.accountPlan || "Pendente";
                                          const matchedExisting = Boolean(expense.reconciledProvisionId || expense.cardStatementRegisteredValue != null);
                                          const chargeDate = toDate(expense.cardChargeDate);
                                          return (
                                            <tr key={expense.id} className="align-top hover:bg-muted/15">
                                              <td className="px-3 py-3">
                                                <p className="max-w-[300px] font-medium">{expense.description || "Compra sem descrição"}</p>
                                                <p className="mt-0.5 text-[10.5px] text-muted-foreground">{expense.supplier || "Favorecido pendente"}</p>
                                                <p className="mt-1 text-[9.5px] font-medium text-sky-700">
                                                  {matchedExisting ? "Correspondência encontrada" : "Importada da fatura"}
                                                </p>
                                              </td>
                                              <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">
                                                {chargeDate ? format(chargeDate, "dd/MM/yyyy") : "—"}
                                              </td>
                                              <td className={cn("px-3 py-3", planName === "Pendente" && "text-amber-700")}>{planName}</td>
                                              <td className="px-3 py-3">{getExpenseUnitLabel(expense, resultCenterNameById)}</td>
                                              <td className="whitespace-nowrap px-3 py-3 text-right font-mono font-semibold">{formatCurrency(Number(expense.totalValue) || 0)}</td>
                                              <td className="px-3 py-3 text-center">
                                                <span className={cn("inline-flex rounded-full border px-2 py-1 text-[10px] font-medium", auditMeta.className)} title={issues.length ? `Revisar: ${issues.join(", ")}` : undefined}>
                                                  {auditMeta.label}
                                                </span>
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    }
                    const expense = row.expense;
                    const due = toDate(expense.dueDate);
                    const statusKey = getExpenseStatusKey(expense, startOfDay(new Date()));
                    const isExpanded = expandedExpenseId === expense.id;
                    const planName = accountPlanMap[expense.accountId ?? expense.accountPlan] || expense.accountPlanName || expense.accountId || expense.accountPlan || "—";
                    const accountingAllocations = expenseAccountAllocations(expense, accountPlanMap);
                    const personAllocations = canViewPersonnelCosts
                      ? expensePersonAllocations(expense, accountPlanMap)
                      : [];
                    const personAllocationPeopleCount = personAllocationDistinctPeopleCount(personAllocations);
                    const showPersonIndividualization = personAllocationPeopleCount > 1;
                    const personAllocationGroups = Array.from(
                      personAllocations.reduce((groups, allocation) => {
                        const key = allocation.accountPlanId;
                        const current = groups.get(key) || {
                          accountPlanId: key,
                          accountPlanName: allocation.accountPlanName || key,
                          allocations: [] as typeof personAllocations,
                        };
                        current.allocations.push(allocation);
                        groups.set(key, current);
                        return groups;
                      }, new Map<string, {
                        accountPlanId: string;
                        accountPlanName: string;
                        allocations: typeof personAllocations;
                      }>()).values()
                    ).sort((left, right) => left.accountPlanName.localeCompare(right.accountPlanName, "pt-BR"));
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
                    const relatedPurchaseExpense = expense.relatedPurchaseExpenseId
                      ? expenseById.get(String(expense.relatedPurchaseExpenseId))
                      : null;

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
                                  {expense.plannedPaymentMethodType && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700">
                                      {expense.plannedPaymentMethodType === "credit_card" && <CreditCard className="h-3 w-3" />}
                                      {expense.plannedPaymentMethodLabel ||
                                        PLANNED_PAYMENT_METHOD_LABELS[expense.plannedPaymentMethodType as PlannedPaymentMethodType]}
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
                              {due && expense.status !== "paid" && expense.status !== "reconciled" ? (
                                <p className={cn("text-xs", due < startOfDay(new Date()) ? "text-rose-600" : "text-muted-foreground")}>
                                  {due < startOfDay(new Date())
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
                            <div className="flex items-center justify-end gap-1">
                              {permissions.financial?.expenses?.edit && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  asChild
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <Link href={`${FINANCIAL_ROUTES.newExpense}?edit=${expense.id}`} title="Editar despesa">
                                    <Pencil className="h-3.5 w-3.5" />
                                    <span className="sr-only">Editar despesa</span>
                                  </Link>
                                </Button>
                              )}
                              {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="border-b bg-muted/10">
                            <td colSpan={7} className="px-4 pb-4 pt-1">
                              <div className="grid gap-4 rounded-2xl border border-border/70 bg-background p-4 md:grid-cols-[minmax(0,1fr)_auto]">
                                <div className="grid gap-4 sm:grid-cols-3">
                                  <ExpenseFinancialSummary expense={expense} />
                                  <div>
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Fornecedor</p>
                                    <p className="mt-1 text-sm font-medium">{expense.supplier || "—"}</p>
                                  </div>
                                  <div>
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Plano de contas</p>
                                    <p className="mt-1 text-sm font-medium">{planName}</p>
                                  </div>
                                  {accountingAllocations.length > 1 && (
                                    <div className="sm:col-span-3 rounded-xl border bg-muted/20 p-3">
                                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                                        Apropriações do título
                                      </p>
                                      <div className="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                                        {accountingAllocations.map((allocation) => (
                                          <div key={allocation.accountPlanId} className="flex items-center justify-between gap-3 text-sm">
                                            <span>{allocation.accountPlanName || allocation.accountPlanId}</span>
                                            <span className="font-mono font-semibold">{formatCurrency(allocation.amount)}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {showPersonIndividualization && (
                                    <div className="sm:col-span-3 rounded-xl border bg-muted/20 p-3">
                                      <div className="flex items-center justify-between gap-3">
                                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                                          Individualização auditável
                                        </p>
                                        <span className="text-xs text-muted-foreground">
                                          {personAllocationPeopleCount} pessoas · {personAllocations.length} vínculos
                                        </span>
                                      </div>
                                      <div className="mt-3 space-y-3">
                                        {personAllocationGroups.map((group) => {
                                          const groupTotal = group.allocations.reduce((total, allocation) => total + allocation.amount, 0);
                                          const people = Array.from(
                                            group.allocations.reduce((peopleMap, allocation) => {
                                              const key = allocation.employeeId || allocation.employeeName;
                                              const current = peopleMap.get(key) || {
                                                employeeId: allocation.employeeId,
                                                employeeName: allocation.employeeName,
                                                allocations: [] as typeof group.allocations,
                                              };
                                              current.allocations.push(allocation);
                                              peopleMap.set(key, current);
                                              return peopleMap;
                                            }, new Map<string, {
                                              employeeId: string;
                                              employeeName: string;
                                              allocations: typeof group.allocations;
                                            }>()).values()
                                          ).sort((left, right) => left.employeeName.localeCompare(right.employeeName, "pt-BR"));
                                          return (
                                            <div key={group.accountPlanId} className="overflow-hidden rounded-xl border bg-background">
                                              <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/35 px-3 py-2.5">
                                                <div>
                                                  <p className="text-sm font-semibold">{group.accountPlanName}</p>
                                                  <p className="text-[10.5px] text-muted-foreground">
                                                    {group.allocations.length} vínculo{group.allocations.length === 1 ? "" : "s"}
                                                  </p>
                                                </div>
                                                <p className="font-mono text-sm font-semibold">{formatCurrency(groupTotal)}</p>
                                              </div>
                                              <div className="divide-y">
                                                {people.map((person) => {
                                                  const personTotal = person.allocations.reduce((total, allocation) => total + allocation.amount, 0);
                                                  return (
                                                    <details key={person.employeeId || person.employeeName} className="group/person">
                                                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 transition-colors hover:bg-muted/20 [&::-webkit-details-marker]:hidden">
                                                        <div className="min-w-0">
                                                          <p className="truncate text-sm font-medium">{person.employeeName}</p>
                                                          <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                                                            {person.allocations.length} lançamento{person.allocations.length === 1 ? "" : "s"}
                                                          </p>
                                                        </div>
                                                        <div className="flex shrink-0 items-center gap-2">
                                                          <p className="font-mono text-sm font-semibold">{formatCurrency(personTotal)}</p>
                                                          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open/person:rotate-180" />
                                                        </div>
                                                      </summary>
                                                      <div className="overflow-x-auto border-t bg-muted/10">
                                                        <table className="min-w-[700px] w-full text-left text-xs">
                                                          <thead className="border-b text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                                            <tr>
                                                              <th className="px-3 py-2 font-semibold">Classificação</th>
                                                              <th className="px-3 py-2 font-semibold">Unidade</th>
                                                              <th className="px-3 py-2 font-semibold">Referência</th>
                                                              <th className="px-3 py-2 font-semibold">Documento</th>
                                                              <th className="px-3 py-2 text-right font-semibold">Valor</th>
                                                            </tr>
                                                          </thead>
                                                          <tbody className="divide-y">
                                                            {person.allocations.map((allocation, index) => (
                                                              <tr key={allocation.id || `${allocation.employeeId}-${index}`} className="align-top">
                                                                <td className="px-3 py-2.5 text-muted-foreground">
                                                                  {allocation.analysisType === "employer_cost"
                                                                    ? "Custo da empresa"
                                                                    : allocation.analysisType === "employee_deduction"
                                                                      ? "Desconto do colaborador"
                                                                      : "Informativo"}
                                                                </td>
                                                                <td className="px-3 py-2.5 text-muted-foreground">{allocation.resultCenter || "Centro pendente"}</td>
                                                                <td className="px-3 py-2.5 text-muted-foreground">
                                                                  {allocation.contractReference || allocation.creditorName || "—"}
                                                                  {allocation.contractReference && allocation.creditorName ? (
                                                                    <span className="mt-0.5 block text-[10.5px]">{allocation.creditorName}</span>
                                                                  ) : null}
                                                                </td>
                                                                <td className="max-w-[180px] break-all px-3 py-2.5 font-mono text-[10.5px] text-muted-foreground">
                                                                  {allocation.payrollDocumentId ? `RH ${allocation.payrollDocumentId}` : "—"}
                                                                </td>
                                                                <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-semibold">
                                                                  {formatCurrency(allocation.amount)}
                                                                </td>
                                                              </tr>
                                                            ))}
                                                          </tbody>
                                                        </table>
                                                      </div>
                                                    </details>
                                                  );
                                                })}
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}
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
                                  <div>
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Pagamento previsto</p>
                                    <p className="mt-1 text-sm font-medium">
                                      {expense.plannedPaymentMethodType
                                        ? `${expense.plannedBankAccountName ? `${expense.plannedBankAccountName} · ` : ""}${
                                            expense.plannedPaymentMethodLabel ||
                                            PLANNED_PAYMENT_METHOD_LABELS[expense.plannedPaymentMethodType as PlannedPaymentMethodType]
                                          }`
                                        : "Não informado"}
                                    </p>
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
                                  {relatedPurchaseExpense && (
                                    <div className="sm:col-span-3 rounded-xl border bg-muted/20 p-3">
                                      <div className="flex flex-wrap items-center justify-between gap-3">
                                        <div className="min-w-0">
                                          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                                            {expense.purchaseExpenseRole === "freight"
                                              ? "Mercadoria relacionada"
                                              : "Frete pago separadamente"}
                                          </p>
                                          <p className="mt-1 truncate text-sm font-medium">
                                            {relatedPurchaseExpense.description || "Despesa vinculada à compra"}
                                          </p>
                                          <p className="mt-0.5 text-xs text-muted-foreground">
                                            {relatedPurchaseExpense.supplier || "Favorecido não informado"}
                                          </p>
                                        </div>
                                        <div className="flex shrink-0 items-center gap-3">
                                          <p className="font-mono text-sm font-semibold">
                                            {formatCurrency(Number(relatedPurchaseExpense.totalValue) || 0)}
                                          </p>
                                          {permissions.financial?.expenses?.view && (
                                            <Button type="button" variant="outline" size="sm" asChild onClick={(event) => event.stopPropagation()}>
                                              <Link href={`${FINANCIAL_ROUTES.newExpense}?edit=${relatedPurchaseExpense.id}`}>
                                                Abrir despesa
                                              </Link>
                                            </Button>
                                          )}
                                        </div>
                                      </div>
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
                                  {permissions.financial?.expenses?.pay && ["pending", "partially_paid"].includes(expense.status) && (
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
            ) : filteredDisplayEntries.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">Nenhuma despesa encontrada.</div>
            ) : (
              <div className="flex flex-col">
                {expenseListRows.map((row) => {
                  if (row.kind === "week") {
                    return (
                      <div key={`mobile-week-${row.group.key}`} className="border-b border-primary/10 bg-primary/[0.04] px-4 py-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-primary/75">
                              <CalendarDays className="h-3.5 w-3.5" />
                              Semana de vencimento
                            </p>
                            <p className="mt-1 text-xs font-semibold text-foreground">{row.group.label}</p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="font-mono text-xs font-semibold">{formatCurrency(row.group.totalValue)}</p>
                            <p className="mt-0.5 text-[10px] text-muted-foreground">
                              {row.group.expenses.length} {row.group.expenses.length === 1 ? "obrigação" : "obrigações"}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  }
                  if (row.kind === "card_statement") {
                    const statement = row.statement;
                    const isExpanded = expandedCardStatementKey === statement.key;
                    const pendingAudit = statement.auditCounts.pending;
                    return (
                      <div key={`mobile-card-statement-${statement.key}`} className="border-b border-sky-100 bg-sky-50/20">
                        <button
                          type="button"
                          className="w-full px-4 py-3 text-left"
                          onClick={() => setExpandedCardStatementKey((current) => current === statement.key ? null : statement.key)}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 items-start gap-2.5">
                              <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-sky-100 text-sky-700">
                                <CreditCard className="h-3.5 w-3.5" />
                              </span>
                              <div className="min-w-0">
                                <p className="text-sm font-semibold leading-5">{statement.title}</p>
                                <p className={cn("mt-1 text-[10.5px]", pendingAudit > 0 ? "text-amber-700" : "text-muted-foreground")}>
                                  {statement.expenses.length} {statement.expenses.length === 1 ? "compra" : "compras"}
                                  {pendingAudit > 0 ? ` · ${pendingAudit} pendente${pendingAudit === 1 ? "" : "s"} de auditoria` : " · auditoria concluída"}
                                </p>
                              </div>
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="font-mono text-sm font-semibold">{formatCurrency(statement.totalValue)}</p>
                              <span className={cn("mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px]", STATUS_COLORS[statement.status])}>
                                {STATUS_LABELS[statement.status]}
                              </span>
                            </div>
                          </div>
                          <div className="mt-2 flex items-center justify-between text-[10.5px] text-muted-foreground">
                            <span>{statement.dueDate ? `Venc. ${format(statement.dueDate, "dd/MM/yyyy")}` : "Sem vencimento"}</span>
                            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </div>
                        </button>
                        {isExpanded ? (
                          <div className="border-t bg-background px-3 py-2">
                            <div className="divide-y rounded-lg border">
                              {statement.expenses.map((expense) => {
                                const issues = cardExpenseAuditIssues(expense);
                                const auditLabel = expense.cardReconciliationStatus === "reconciled"
                                  ? "Conferida"
                                  : issues.length === 0 ? "Auditada" : "Pendente";
                                return (
                                  <div key={expense.id} className="px-3 py-2.5">
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0">
                                        <p className="text-xs font-medium leading-4">{expense.description || "Compra sem descrição"}</p>
                                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                                          {toDate(expense.cardChargeDate) ? format(toDate(expense.cardChargeDate)!, "dd/MM/yyyy") : "Data pendente"}
                                          {` · ${auditLabel}`}
                                        </p>
                                      </div>
                                      <p className="shrink-0 font-mono text-xs font-semibold">{formatCurrency(Number(expense.totalValue) || 0)}</p>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  }
                  const expense = row.expense;
                  const due = toDate(expense.dueDate);
                  const statusKey = getExpenseStatusKey(expense, startOfDay(new Date()));
                  const planName = accountPlanMap[expense.accountId ?? expense.accountPlan] || expense.accountPlanName || expense.accountId || expense.accountPlan || "—";
                  const accountingAllocations = expenseAccountAllocations(expense, accountPlanMap);
                  const personAllocations = canViewPersonnelCosts
                    ? expensePersonAllocations(expense, accountPlanMap)
                    : [];
                  const personAllocationPeopleCount = personAllocationDistinctPeopleCount(personAllocations);
                  const primaryUnit = getExpenseUnitLabel(expense, resultCenterNameById);
                  const relatedPurchaseExpense = expense.relatedPurchaseExpenseId
                    ? expenseById.get(String(expense.relatedPurchaseExpenseId))
                    : null;

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
                        {accountingAllocations.length > 1 && <span>· {accountingAllocations.length} apropriações</span>}
                        {personAllocationPeopleCount > 1 && <span>· {personAllocationPeopleCount} pessoas</span>}
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
                          {relatedPurchaseExpense && (
                            <Button variant="outline" size="sm" className="h-7 text-[10px]" asChild>
                              <Link href={`${FINANCIAL_ROUTES.newExpense}?edit=${relatedPurchaseExpense.id}`}>
                                {expense.purchaseExpenseRole === "freight" ? "Ver mercadoria" : "Ver frete separado"}
                              </Link>
                            </Button>
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
                            {permissions.financial?.expenses?.pay && ["pending", "partially_paid"].includes(expense.status) && (
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
    </PageContainer>
  );
}
