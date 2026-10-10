"use client";

import Link from "next/link";
import { SourceSettlementNotice } from "@/features/financial/components/expenses/source-settlement-notice";
import { useEffect, useMemo, useState } from "react";
import {
  deleteDoc,
  limit as firestoreLimit,
  orderBy,
  query as firestoreQuery,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { addMonths, format, startOfDay, addDays, endOfDay, startOfMonth, endOfMonth } from "date-fns";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  CreditCard,
  Ellipsis,
  FileUp,
  Inbox,
  Link2,
  Plus,
  RotateCcw,
  ScanSearch,
  ShieldCheck,
  X,
} from "lucide-react";
import { PayExpenseDialog } from "@/features/financial/components/pay-expense-dialog";
import {
  ExpensePeriodFilter,
  type ExpensePeriodPreset,
} from "@/features/financial/components/expenses/expense-period-filter";
import {
  ExpenseExpandedDetails,
  PurchaseOrderItemsLink,
} from "@/features/financial/components/expenses/expense-expanded-details";
import { KpiFlowStrip } from "@/features/financial/components/expenses/kpi-flow-strip";
import {
  CardStatementListRow,
  DueWeekHeader,
  EXPENSE_LIST_COLUMNS,
  ExpenseListRow,
  ExpenseStatusPill,
} from "@/features/financial/components/expenses/expense-list-rows";
import { ControlSearch } from "@/components/patterns/control-panel";
import { FilterChips } from "@/components/patterns/filter-chips";
import { HeroChip } from "@/components/patterns/hero-chip";
import { InlineConfirm } from "@/components/patterns/inline-confirm";
import { PageHero } from "@/components/patterns/page-hero";
import { PanelSection, SidePanel } from "@/components/patterns/side-panel";
import { StatusPill } from "@/components/ui/status-pill";
import { ExpenseCompetencePicker } from "@/features/financial/components/expenses/expense-competence-picker";
import { UberRecognitionStatus } from "@/features/financial/components/expenses/uber-recognition-status";
import { FinancialAccessGuard } from "@/features/financial/components/financial-access-guard";
import { FinancialImportPage } from "@/features/financial/pages/import-page";
import { FINANCIAL_ROUTES } from "@/features/financial/lib/constants";
import { bankStatementsHref } from "@/features/financial/lib/reconciliation-navigation";
import { financialCollection, financialDoc } from "@/features/financial/lib/repositories";
import { formatCurrency, toDate } from "@/features/financial/lib/utils";
import {
  expenseReferencesResultCenter,
  expenseValueForResultCenter,
  resolveResultCenterName,
  type ResultCenterNameMap,
} from "@/features/financial/lib/expense-rateio";
import { expenseReferenceCenterLabel } from "@/features/financial/lib/expense-reference-center";
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
  sumExpenseValues,
  type ExpenseDueWeekGroup,
} from "@/features/financial/lib/expense-list";
import {
  cardExpenseAuditIssues,
  cardExpenseIsActiveStatementLine,
  PLANNED_PAYMENT_METHOD_LABELS,
  type PlannedPaymentMethodType,
} from "@/features/financial/lib/card-invoices";
import {
  cardExpenseStatementOccurrences,
  groupExpensesByCardStatement,
  type ExpenseCardStatementDocument,
  type ExpenseCardStatementListEntry,
} from "@/features/financial/lib/expense-card-statement-groups";
import { useFinancialCollection } from "@/features/financial/hooks/use-financial-collection";
import { useAuth } from "@/hooks/use-auth";
import { useKiosks } from "@/hooks/use-kiosks";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

import { cn } from "@/lib/utils";
import { cardStatementDisplayAmounts, cardStatementHasOverdueBalance, expenseDisplayStatus as getExpenseStatusKey, expenseDisplayAmounts, expenseAwaitingConfirmation, expenseCashForecastAmount, expenseHasOverdueBalance, showExpenseInOperationalList } from "@/features/financial/lib/expense-display-state";
import { canViewBudgetComparison } from "@/features/financial/budgets/comparison";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";

const STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  pending_audit: "Pendente auditoria",
  paid: "Pago",
  reported_paid: "Pago informado",
  payment_found_pending_document: "Pagamento confirmado",
  partially_paid: "Parcialmente pago",
  paid_divergent: "Pagamento divergente",
  cancelled: "Cancelado",
  overdue: "Vencido",
  pending: "Em aberto",
  due_soon: "Vence hoje",
  provisioned: "Provisionado",
  reconciled: "Previsão conciliada",
};

const STATUS_FILTER_LABELS: Record<string, string> = {
  pending: "Em aberto",
  pending_audit: "Compras pendentes de auditoria",
  draft: "Rascunhos",
  overdue: "Vencidos",
  paid: "Pagos",
  payment_found_pending_document: "Pagamento confirmado · conferir despesa",
  provisioned: "Provisionados",
  reconciled: "Com previsão conciliada",
  cancelled: "Cancelados",
};

const ORIGIN_FILTER_LABELS: Record<string, string> = {
  purchasing: "Origem: Compras",
  manual: "Demais despesas",
};

const PAYMENT_FILTER_LABELS: Record<string, string> = {
  credit_card: "Cartão de crédito",
  debit_card: "Cartão de débito",
  pix: "PIX",
  transfer: "Transferência",
  cash: "Dinheiro",
  unassigned: "Não informado",
};

function unmatchedCardStatementRecordLabel(expense: any) {
  if (expense.status === "cancelled") return "Cancelado";
  if (expense.provisionType === "forecast" && (expense.status === "reconciled" || expense.replacedByExpenseId)) {
    return "Previsão conciliada";
  }
  if (expense.cardStatementRevisionStatus === "removed") return "Removido da versão ativa";
  return "Requer conciliação";
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

function getExpenseUnitLabel(expense: any, resultCenterNameById: ResultCenterNameMap) {
  const referenceCenter = expenseReferenceCenterLabel(expense, resultCenterNameById);
  if (!expense.isApportioned) return referenceCenter;

  const participants = Array.from(
    new Set<string>(
      (expense.apportionments || [])
        .map((item: any) => resolveResultCenterName(item?.resultCenter, resultCenterNameById))
        .filter(Boolean)
    )
  );

  if (participants.length > 0) return `${referenceCenter} · Rateada em ${participants.length} centro${participants.length === 1 ? "" : "s"}`;
  return `${referenceCenter} · Rateada`;
}

function matchesBaseFilters(
  expense: any,
  {
    accountPlanMap,
    cardStatements,
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
    cardStatements: ExpenseCardStatementDocument[];
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
  const statementOccurrences = cardExpenseStatementOccurrences(expense, cardStatements);
  const periodDueDates = statementOccurrences
    .map((occurrence) => occurrence.dueDate)
    .filter((date): date is Date => date !== null);
  const dueDateCandidates = periodDueDates.length > 0 ? periodDueDates : due ? [due] : [];
  const competence = toDate(expense.competenceDate);
  const belongsToUnit =
    unitFilter === "all" || expenseReferencesResultCenter(expense, unitFilter, resultCenterNameById);
  const normalizedSearch = search.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const includesSearch = (value: unknown) => String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .includes(normalizedSearch);
  const searchableAliases = Array.isArray(expense.aliases) ? expense.aliases : [];
  const billingIdentity = expense.billingIdentity && typeof expense.billingIdentity === "object" ? expense.billingIdentity : {};
  const documentIdentity = expense.documentIdentity && typeof expense.documentIdentity === "object" ? expense.documentIdentity : {};
  const documentReferences = Array.isArray(documentIdentity.documentReferences) ? documentIdentity.documentReferences : [];
  const matchesSearch =
    !search ||
    includesSearch(expense.description) ||
    accountingPlanNames.some(includesSearch) ||
    includesSearch(expense.supplier) ||
    searchableAliases.some(includesSearch) ||
    [billingIdentity.supplierTaxId, billingIdentity.customerAccount, billingIdentity.contractNumber]
      .some(includesSearch) ||
    (Array.isArray(billingIdentity.serviceNumbers) ? billingIdentity.serviceNumbers : [])
      .some(includesSearch) ||
    documentReferences.some(includesSearch);

  const matchesOrigin =
    originFilter === "all" ||
    (originFilter === "purchasing" && expense.originModule === "purchasing") ||
    (originFilter === "manual" && expense.originModule !== "purchasing");

  const dateFromValue = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null;
  const dateToValue = dateTo ? new Date(`${dateTo}T23:59:59`) : null;
  const matchesDateRange = (!dateFromValue && !dateToValue) || dueDateCandidates.some((candidate) => (
    (!dateFromValue || candidate >= dateFromValue) && (!dateToValue || candidate <= dateToValue)
  ));
  const matchesCompetence =
    !competenceMonth
    || competenceMonth === "all"
    || (statementOccurrences.length > 0
      ? statementOccurrences.some((occurrence) => occurrence.monthKey === competenceMonth)
      : competence && format(competence, "yyyy-MM") === competenceMonth);
  const matchesSupplier = supplierFilter === "all" || (expense.supplier || "") === supplierFilter;
  const matchesAccountPlan = accountPlanFilter === "all" || accountingPlanNames.includes(accountPlanFilter);
  const matchesPaymentType =
    paymentTypeFilter === "all" ||
    (paymentTypeFilter === "unassigned" && !expense.plannedPaymentMethodType) ||
    expense.plannedPaymentMethodType === paymentTypeFilter;

  return (
    matchesSearch &&
    matchesOrigin &&
    matchesDateRange &&
    matchesCompetence &&
    matchesSupplier &&
    matchesAccountPlan &&
    matchesPaymentType &&
    belongsToUnit
  );
}

type ExpenseDisplayEntry = ExpenseCardStatementListEntry<any>;
type GroupedExpenseDisplayEntry = ExpenseDisplayEntry & { dueWeekKey?: string };

type ExpenseListRow =
  | { kind: "week"; group: ExpenseDueWeekGroup<ExpenseDisplayEntry> }
  | GroupedExpenseDisplayEntry;

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

function expensePeriodLabel(dateFrom: string, dateTo: string, competenceMonth: string) {
  const displayDate = (value: string) => {
    const [year, month, day] = value.split("-");
    return year && month && day ? `${day}/${month}/${year}` : value;
  };

  if (dateFrom && dateTo) return `${displayDate(dateFrom)} a ${displayDate(dateTo)}`;
  if (dateFrom) return `Desde ${displayDate(dateFrom)}`;
  if (dateTo) return `Até ${displayDate(dateTo)}`;
  if (competenceMonth !== "all") return `Competência ${competenceMonth.slice(5, 7)}/${competenceMonth.slice(0, 4)}`;
  return "Todo o histórico";
}

export function ExpensesPage() {
  const { firebaseUser, permissions, isDefaultAdmin } = useAuth();
  const { kiosks } = useKiosks();
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const canViewCardStatements = permissions.financial?.cardStatements?.view === true;
  const recentCardStatementsQuery = useMemo(
    () => canViewCardStatements
      ? firestoreQuery(
          financialCollection<ExpenseCardStatementDocument>("cardStatements"),
          orderBy("monthKey", "desc"),
          firestoreLimit(120),
        )
      : null,
    [canViewCardStatements],
  );
  const { data: expensesData, loading: expensesLoading, refresh: refreshExpenses } = useFinancialCollection<any>(financialCollection("expenses"));
  const { data: cardStatementsData, loading: cardStatementsLoading } = useFinancialCollection<ExpenseCardStatementDocument>(recentCardStatementsQuery);
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
  const [deleting, setDeleting] = useState(false);
  const [finalizingAuditId, setFinalizingAuditId] = useState<string | null>(null);
  const [expandedExpenseId, setExpandedExpenseId] = useState<string | null>(searchParams.get("expense"));
  const [expandedCardStatementKey, setExpandedCardStatementKey] = useState<string | null>(null);
  const [collapsedDueWeeks, setCollapsedDueWeeks] = useState<Set<string>>(() => new Set());
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const canAccessAudits = permissions.financial?.audits?.view === true;
  const canImportAudits = canAccessAudits && permissions.financial?.audits?.import === true;
  const canViewPersonnelCosts = permissions.financial?.personnelCosts?.view === true;
  const canViewExpenses = permissions.financial?.expenses?.view === true;
  const canViewInbox = permissions.financial?.inbox?.view === true;
  const canViewPaymentRequests = permissions.financial?.paymentRequests?.view === true;
  const loading = expensesLoading || (canViewCardStatements && cardStatementsLoading);
  const searchParamsKey = searchParams.toString();

  if (!canViewExpenses && !canViewInbox && !canViewPaymentRequests) {
    return (
      <FinancialAccessGuard
        title="Despesas"
        description="Seu perfil não possui permissão para consultar despesas, contas a pagar e histórico de liquidações."
      />
    );
  }

  if (!canViewExpenses && (canViewInbox || canViewPaymentRequests)) {
    return (
      <PageContainer variant="default" surface className="space-y-6 pb-10">
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
    setExpandedExpenseId(params.get("expense"));
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
    if (params.get("date_from") || params.get("date_to") || params.get("competence") || params.get("expense")) {
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
            ...consolidatedExpenses.flatMap((expense) => {
              const statementMonths = cardExpenseStatementOccurrences(
                expense,
                cardStatementsData || [],
              ).map((occurrence) => occurrence.monthKey);
              if (statementMonths.length > 0) return statementMonths;
              const date = toDate(expense.competenceDate);
              return date ? [format(date, "yyyy-MM")] : [];
            }),
          ]
        )
      ).sort(compareExpenseCompetenceMonths);
    },
    [cardStatementsData, competenceMonth, consolidatedExpenses]
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
        if (!showExpenseInOperationalList(expense, statusFilter)) return false;
        const target = searchParams.get("expense");
        if (target && expense.id !== target) return false;
        if (
          !matchesBaseFilters(expense, {
            accountPlanMap,
            cardStatements: cardStatementsData || [],
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

        const cardStatementOverdueCandidate = statusFilter === "overdue"
          && expense.plannedPaymentMethodType === "credit_card";
        const matchesStatus =
          statusFilter === "all" ||
          (statusFilter === "reconciled" && Boolean(expense.reconciledProvisionId)) ||
          (statusFilter === "pending" && ["pending", "due_soon", "overdue"].includes(computedStatus)) ||
          cardStatementOverdueCandidate ||
          (statusFilter === "overdue" && expenseHasOverdueBalance(expense, now)) ||
          computedStatus === "pending_audit" && statusFilter === "pending_audit" ||
          (statusFilter !== "overdue" && computedStatus === statusFilter);

        return matchesStatus;
      })
      .sort((left, right) => expenseSort.key === "value"
        ? compareExpensesByValue(left, right, expenseSort.direction)
        : compareExpensesByDueDateDirection(left, right, expenseSort.direction));
  }, [accountPlanFilter, accountPlanMap, cardStatementsData, competenceMonth, consolidatedExpenses, dateFrom, dateTo, expenseSort, financialUnitFilter, originFilter, paymentTypeFilter, resultCenterNameById, search, searchParams, statusFilter, supplierFilter]);

  const scopedExpenses = useMemo(() => {
    const now = startOfDay(new Date());
    return consolidatedExpenses.filter((expense) =>
      showExpenseInOperationalList(expense, statusFilter) &&
      matchesBaseFilters(expense, {
        accountPlanMap,
        cardStatements: cardStatementsData || [],
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
  }, [accountPlanFilter, accountPlanMap, cardStatementsData, competenceMonth, consolidatedExpenses, dateFrom, dateTo, financialUnitFilter, originFilter, paymentTypeFilter, resultCenterNameById, search, statusFilter, supplierFilter]);
  const scopedDisplayEntries = useMemo(
    () => groupExpensesByCardStatement(scopedExpenses, {
      statements: cardStatementsData || [],
      allExpenses: expenses,
      statementMonthKey: competenceMonth !== "all" ? competenceMonth : null,
      statementDateFrom: dateFrom ? new Date(`${dateFrom}T00:00:00`) : null,
      statementDateTo: dateTo ? new Date(`${dateTo}T23:59:59`) : null,
    }),
    [cardStatementsData, competenceMonth, dateFrom, dateTo, expenses, scopedExpenses]
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
    const entries = groupExpensesByCardStatement(filtered, {
      statements: cardStatementsData || [],
      allExpenses: expenses,
      statementMonthKey: competenceMonth !== "all" ? competenceMonth : null,
      statementDateFrom: dateFrom ? new Date(`${dateFrom}T00:00:00`) : null,
      statementDateTo: dateTo ? new Date(`${dateTo}T23:59:59`) : null,
    });
    return entries.filter((entry) => {
      if (statusFilter !== "overdue") return true;
      return entry.kind === "card_statement"
        ? cardStatementHasOverdueBalance(entry.statement, startOfDay(new Date()))
        : expenseHasOverdueBalance(entry.expense, startOfDay(new Date()));
    }).sort((left, right) => {
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
  }, [cardStatementsData, competenceMonth, dateFrom, dateTo, expenseSort, expenses, filtered, statusFilter]);
  const scopedDisplayEntryCount = scopedDisplayEntries.length;
  const filteredTotalValue = sumExpenseValues(filteredDisplayEntries,
    (entry) => entry.kind === "expense" ? Number(entry.expense.totalValue) || 0 : entry.statement.totalValue);
  const activeCompetenceLabel = competenceMonth !== "all"
    ? `${competenceMonth.slice(5, 7)}/${competenceMonth.slice(0, 4)}`
    : null;
  const activePeriodLabel = expensePeriodLabel(dateFrom, dateTo, competenceMonth);
  const shouldGroupByDueWeek = Boolean(dateFrom || dateTo || activeCompetenceLabel);
  const expenseListRows = useMemo<ExpenseListRow[]>(() => {
    if (!shouldGroupByDueWeek) {
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
      ...group.expenses.map((entry) => ({ ...entry, dueWeekKey: group.key })),
    ]);
  }, [expenseSort, filteredDisplayEntries, shouldGroupByDueWeek]);

  function toggleDueWeek(weekKey: string) {
    setCollapsedDueWeeks((current) => {
      const next = new Set(current);
      if (next.has(weekKey)) next.delete(weekKey);
      else next.add(weekKey);
      return next;
    });
  }

  function toggleExpenseSort(key: ExpenseSortKey) {
    setExpenseSort((current) => current.key === key
      ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
      : { key, direction: "asc" });
  }

  function clearExpenseFilters() {
    const now = new Date();
    setSearch("");
    setStatusFilter("all");
    setOriginFilter("all");
    setPeriodPreset("current_month");
    setDateFrom(format(startOfMonth(now), "yyyy-MM-dd"));
    setDateTo(format(endOfMonth(now), "yyyy-MM-dd"));
    setCompetenceMonth("all");
    setSupplierFilter("all");
    setAccountPlanFilter("all");
    setUnitFilter("all");
    setPaymentTypeFilter("all");
    setExpandedExpenseId(null);
    setCollapsedDueWeeks(new Set());
    router.replace(FINANCIAL_ROUTES.expenses, { scroll: false });
  }

  const pendingAuditScope = useMemo(() => {
    const now = startOfDay(new Date());
    return consolidatedExpenses.filter((expense) => {
      if (!showExpenseInOperationalList(expense, "all")) return false;
      if (getExpenseStatusKey(expense, now) !== "pending_audit") return false;
      const target = searchParams.get("expense");
      if (target && expense.id !== target) return false;
      return matchesBaseFilters(expense, {
        accountPlanMap,
        cardStatements: cardStatementsData || [],
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
      });
    });
  }, [accountPlanFilter, accountPlanMap, cardStatementsData, competenceMonth, consolidatedExpenses, dateFrom, dateTo, financialUnitFilter, originFilter, paymentTypeFilter, resultCenterNameById, search, searchParams, supplierFilter]);
  const pendingAuditCount = pendingAuditScope.length;
  const pendingAuditValue = pendingAuditScope.reduce((sum, expense) => sum + expenseValueForResultCenter(
    expense,
    financialUnitFilter === "all" ? undefined : financialUnitFilter,
    resultCenterNameById,
  ), 0);

  const kpis = useMemo(() => {
    const now = startOfDay(new Date());
    const in7Days = endOfDay(addDays(now, 7));

    let open = 0;
    let overdue = 0;
    let paid = 0;
    let dueSoon = 0;
    let launchedOpen = 0;
    let reconciledProvisionOpen = 0;
    let auditOpen = 0;

    const scopedExpenseIds = new Set(scopedExpenses.map((expense) => String(expense.id)));

    scopedDisplayEntries.forEach((entry) => {
      if (entry.kind === "expense") {
        const expense = entry.expense;
        const due = toDate(expense.dueDate);
        const scopedValue = expenseValueForResultCenter(
          expense,
          financialUnitFilter === "all" ? undefined : financialUnitFilter,
          resultCenterNameById
        );
        const amounts = expenseDisplayAmounts(expense);
        const totalValue = Number(expense.totalValue) || 0;
        const ratio = totalValue > 0 ? scopedValue / totalValue : 1;
        const balance = amounts.open * ratio;
        open += balance;
        paid += amounts.paid * ratio;
        if (balance > 0) {
          if (getExpenseStatusKey(expense, now) === "pending_audit") auditOpen += balance;
          else if (expense.reconciledProvisionId) reconciledProvisionOpen += balance;
          else launchedOpen += balance;
        }
        if (expenseHasOverdueBalance(expense, now)) overdue += balance;
        if (due && due >= now && due <= in7Days) dueSoon += balance;
        return;
      }

      const statement = entry.statement;
      const allLineTotal = statement.lines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
      const netScale = allLineTotal > 0 ? statement.totalValue / allLineTotal : 0;
      const scopedLines = statement.lines.flatMap((line) => {
        const expense = line.expense;
        if (!scopedExpenseIds.has(String(expense.id))) return [];
        const expenseTotal = Number(expense.totalValue) || 0;
        const unitValue = expenseValueForResultCenter(
          expense,
          financialUnitFilter === "all" ? undefined : financialUnitFilter,
          resultCenterNameById,
        );
        const unitRatio = expenseTotal > 0 ? unitValue / expenseTotal : 1;
        return [{ expense, value: Number(line.amount || 0) * netScale * unitRatio }];
      });
      const scopedStatementValue = scopedLines.reduce((sum, line) => sum + line.value, 0);
      const amounts = cardStatementDisplayAmounts({ ...statement, totalValue: scopedStatementValue });
      open += amounts.open;
      paid += amounts.paid;
      if (amounts.open > 0) {
        scopedLines.forEach(({ expense, value }) => {
          if (getExpenseStatusKey(expense, now) === "pending_audit") auditOpen += value;
          else if (expense.reconciledProvisionId) reconciledProvisionOpen += value;
          else launchedOpen += value;
        });
      }
      if (cardStatementHasOverdueBalance({ ...statement, totalValue: scopedStatementValue }, now)) {
        overdue += amounts.open;
      }
      if (statement.dueDate && statement.dueDate >= now && statement.dueDate <= in7Days) {
        dueSoon += amounts.open;
      }
    });

    return { open, launchedOpen, reconciledProvisionOpen, auditOpen, overdue, paid, dueSoon, pendingAudit: pendingAuditValue };
  }, [financialUnitFilter, pendingAuditValue, resultCenterNameById, scopedDisplayEntries, scopedExpenses]);

  const openDisplayEntryCount = useMemo(() => scopedDisplayEntries.filter((entry) => (
    entry.kind === "card_statement"
      ? cardStatementDisplayAmounts(entry.statement).open > 0
      : expenseDisplayAmounts(entry.expense).open > 0
  )).length, [scopedDisplayEntries]);

  useEffect(() => {
    if (loading || !expandedExpenseId) return;
    if (!filtered.some((expense) => expense.id === expandedExpenseId)) {
      setExpandedExpenseId(null);
    }
  }, [expandedExpenseId, filtered, loading]);

  async function handleDelete() {
    if (!deleteTarget) return;

    if (deleteTarget.originModule === "purchasing") {
      toast({ variant: "destructive", title: "Ação não permitida.", description: "Esta despesa foi gerada pelo módulo de compras. Cancele o pedido de compra correspondente para remover esta despesa." });
      setDeleteTarget(null);
      return;
    }

    setDeleting(true);
    try {
      await deleteDoc(financialDoc("expenses", deleteTarget.id));
      refreshExpenses();
      setExpandedExpenseId(null);
      toast({ title: "Despesa excluída." });
    } catch (error: any) {
      console.error("Erro ao excluir despesa:", error);
      toast({ variant: "destructive", title: "Erro ao excluir a despesa.", description: error.message || "Tente novamente mais tarde." });
    } finally {
      setDeleting(false);
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

  // Filters may have changed locally without changing the URL yet.
  const expenseContextQuery = new URLSearchParams({
    search, status: statusFilter, origin: originFilter, date_from: dateFrom, date_to: dateTo,
    competence: competenceMonth, supplier: supplierFilter, account_plan: accountPlanFilter,
    unit: unitFilter, payment_type: paymentTypeFilter,
  }).toString();
  const auditReturnParams = new URLSearchParams(expenseContextQuery);
  auditReturnParams.set("status", "pending_audit");
  const expensesAuditReturnHref = `${FINANCIAL_ROUTES.expenses}?${auditReturnParams}`;

  const activeFilterPills: Array<{ key: string; label: string; onClear: () => void }> = [];
  if (search.trim()) activeFilterPills.push({ key: "search", label: `Busca: ${search.trim()}`, onClear: () => setSearch("") });
  if (statusFilter !== "all") activeFilterPills.push({ key: "status", label: STATUS_FILTER_LABELS[statusFilter] ?? statusFilter, onClear: () => setStatusFilter("all") });
  if (originFilter !== "all") activeFilterPills.push({ key: "origin", label: ORIGIN_FILTER_LABELS[originFilter] ?? originFilter, onClear: () => setOriginFilter("all") });
  if (paymentTypeFilter !== "all") activeFilterPills.push({ key: "payment", label: PAYMENT_FILTER_LABELS[paymentTypeFilter] ?? paymentTypeFilter, onClear: () => setPaymentTypeFilter("all") });
  if (activeCompetenceLabel) activeFilterPills.push({ key: "competence", label: `Competência ${activeCompetenceLabel}`, onClear: () => setCompetenceMonth("all") });
  else if (dateFrom || dateTo) activeFilterPills.push({ key: "period", label: `Vencimento: ${activePeriodLabel}`, onClear: () => { setPeriodPreset("custom"); setDateFrom(""); setDateTo(""); } });
  if (accountPlanFilter !== "all") activeFilterPills.push({ key: "plan", label: accountPlanOptions.find((option) => option.value === accountPlanFilter)?.label ?? accountPlanFilter, onClear: () => setAccountPlanFilter("all") });
  if (unitFilter !== "all") activeFilterPills.push({ key: "unit", label: unitFilter, onClear: () => setUnitFilter("all") });
  const hasActiveFilters = activeFilterPills.length > 0;
  const selectedExpense = expandedExpenseId ? filtered.find((expense) => expense.id === expandedExpenseId) ?? null : null;
  const selectedStatement = expandedCardStatementKey
    ? filteredDisplayEntries.find((entry) => entry.kind === "card_statement" && entry.statement.key === expandedCardStatementKey)
    : null;
  const darkControl = "h-10 rounded-ds-btn border-white/10 bg-white/[0.07] px-3 text-[13px] font-semibold text-white shadow-none hover:bg-white/10 hover:text-white focus:ring-ds-accent-kicker";

  function renderExpensePanel(expense: any) {
    const statusKey = getExpenseStatusKey(expense, startOfDay(new Date()));
    const planName = accountPlanMap[expense.accountId ?? expense.accountPlan] || expense.accountPlanName || expense.accountId || expense.accountPlan || "—";
    const primaryUnit = getExpenseUnitLabel(expense, resultCenterNameById);
    const relatedPurchaseExpense = expense.relatedPurchaseExpenseId
      ? expenseById.get(String(expense.relatedPurchaseExpenseId))
      : null;
    const statusLabel = expense.budgetMigration ? "Transferida para orçamento" : STATUS_LABELS[statusKey] || statusKey;
    return (
      <SidePanel
        open
        onOpenChange={(open) => {
          if (!open) {
            setExpandedExpenseId(null);
            setDeleteTarget(null);
          }
        }}
        kicker={expense.originModule === "purchasing" ? "Despesa · Compras" : "Despesa"}
        title={expense.description || "Despesa sem descrição"}
        subtitle={expense.supplier || "Favorecido não informado"}
      >
        <div className="flex flex-wrap items-center gap-2">
          <ExpenseStatusPill statusKey={statusKey} label={statusLabel} />
          {expense.originModule === "purchasing" && expense.purchaseOrderId ? (
            <PurchaseOrderItemsLink
              orderId={expense.purchaseOrderId}
              href={`/dashboard/purchasing/orders/${expense.purchaseOrderId}?returnTo=${encodeURIComponent(expensesAuditReturnHref)}`}
              label="Abrir pedido"
            />
          ) : null}
          {relatedPurchaseExpense ? (
            <Button variant="ds-secondary" size="xs" asChild>
              <Link href={`${FINANCIAL_ROUTES.newExpense}?edit=${relatedPurchaseExpense.id}`}>
                {expense.purchaseExpenseRole === "freight" ? "Ver mercadoria" : "Ver frete separado"}
              </Link>
            </Button>
          ) : null}
        </div>
        {expenseAwaitingConfirmation(expense) ? (
          <p className="rounded-ds-btn bg-ds-ok-bg p-3 text-[13px] font-semibold text-ds-ok">
            Pagamento confirmado no extrato. A despesa ainda precisa de conferência; esse valor já pago não é uma cobrança vencida.
          </p>
        ) : null}
        {expense.sourceSettlement ? <SourceSettlementNotice source={expense.sourceSettlement} cancelled={expense.status === "cancelled"} /> : null}
        {deleteTarget?.id === expense.id ? (
          <InlineConfirm
            message={`Excluir a despesa “${expense.description}”? Esta ação não pode ser desfeita.`}
            loading={deleting}
            onConfirm={() => void handleDelete()}
            onCancel={() => setDeleteTarget(null)}
          />
        ) : null}
        <ExpenseExpandedDetails
          stacked
          expense={expense}
          relatedPurchaseExpense={relatedPurchaseExpense}
          accountPlanMap={accountPlanMap}
          resultCenterNameById={resultCenterNameById}
          canViewPersonnelCosts={canViewPersonnelCosts}
          canViewExpenses={canViewExpenses}
          canEdit={permissions.financial?.expenses?.edit === true && !expense.budgetMigration && !expense.sourceSettlement}
          canPay={permissions.financial?.expenses?.pay === true && !expense.budgetMigration && !expense.sourceSettlement && expenseCashForecastAmount(expense) > 0}
          canDelete={permissions.financial?.expenses?.delete === true && !expense.budgetMigration && !expense.sourceSettlement}
          finalizingAudit={finalizingAuditId === expense.id}
          onFinalizeAudit={() => void handleFinalizeAudit(expense)}
          onPay={() => setPayTarget({ ...expense, accountPlanName: planName, resultCenter: primaryUnit })}
          onDelete={() => setDeleteTarget(expense)}
        />
      </SidePanel>
    );
  }

  function renderStatementPanel(statement: any) {
    const unmatchedActiveCount = statement.unmatchedExpenses.filter(cardExpenseIsActiveStatementLine).length;
    const statementHref = `${FINANCIAL_ROUTES.cardStatements}?month=${encodeURIComponent(statement.monthKey)}&accountId=${encodeURIComponent(statement.accountId)}&paymentMethodId=${encodeURIComponent(statement.paymentMethodId)}`;
    const AUDIT_VARIANT: Record<string, { label: string; variant: "ok" | "neutral" | "info" | "warn" }> = {
      reconciled: { label: "Conferida", variant: "ok" },
      historical: { label: "Histórico", variant: "neutral" },
      audited: { label: "Auditada", variant: "info" },
      pending: { label: "Pendente", variant: "warn" },
    };
    return (
      <SidePanel
        open
        onOpenChange={(open) => { if (!open) setExpandedCardStatementKey(null); }}
        kicker="Fatura de cartão"
        title={statement.title}
        subtitle={`${statement.lineCount} ${statement.lineCount === 1 ? "lançamento" : "lançamentos"} · ${statement.dueDate ? `vence ${format(statement.dueDate, "dd/MM/yyyy")}` : "sem vencimento"}`}
        highlights={<span className="font-mono">{formatCurrency(statement.totalValue)}</span>}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ExpenseStatusPill statusKey={statement.status} label={STATUS_LABELS[statement.status] ?? statement.status} />
          {canAccessAudits ? (
            <Button variant="ds-secondary" size="xs" asChild>
              <Link href={statementHref}>
                <ScanSearch aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" /> Abrir auditoria do cartão
              </Link>
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-ds-ink-muted">
          A fatura é a obrigação de pagamento; cada compra permanece como despesa individual na DRE.
        </p>
        <PanelSection title="Lançamentos oficiais" aside={`${statement.lines.length}`}>
          <ul className="-my-1 divide-y divide-ds-divider">
            {statement.lines.map((line: any) => {
              const expense = line.expense;
              const issues = cardExpenseAuditIssues(expense);
              const audit = AUDIT_VARIANT[line.auditStatus] ?? AUDIT_VARIANT.pending;
              const planName = accountPlanMap[expense.accountId ?? expense.accountPlan]
                || expense.accountPlanName || expense.accountId || expense.accountPlan || "Pendente";
              const matchedExisting = Boolean(expense.reconciledProvisionId || expense.cardStatementRegisteredValue != null);
              const chargeDate = toDate(expense.cardChargeDate);
              return (
                <li key={line.lineId} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-bold leading-5 text-ds-ink">{expense.description || "Compra sem descrição"}</p>
                      <p className="text-xs text-ds-ink-faint">{expense.supplier || "Favorecido pendente"}</p>
                    </div>
                    <p className="shrink-0 font-mono text-[13px] font-extrabold text-ds-ink">{formatCurrency(line.amount)}</p>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ds-ink-muted">
                    <span className="font-mono">{chargeDate ? format(chargeDate, "dd/MM/yyyy") : "—"}</span>
                    <span className={cn(planName === "Pendente" && "font-bold text-ds-warn")}>{planName}</span>
                    <span>{getExpenseUnitLabel(expense, resultCenterNameById)}</span>
                    {line.installmentNumber ? <span>Parcela {line.installmentNumber}</span> : null}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <StatusPill variant={audit.variant} title={issues.length ? `Revisar: ${issues.join(", ")}` : undefined}>{audit.label}</StatusPill>
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-ds-info">
                      <Link2 aria-hidden="true" className="h-3 w-3" />
                      {matchedExisting ? "Correspondência encontrada" : "Importada da fatura"}
                    </span>
                  </div>
                  <UberRecognitionStatus record={expense} compact />
                </li>
              );
            })}
          </ul>
          {statement.creditTotal > 0 ? (
            <div className="flex items-center justify-between gap-3 rounded-ds-btn bg-ds-ok-bg px-3 py-2 text-xs font-bold text-ds-ok">
              <span>Créditos e estornos</span>
              <span className="font-mono">− {formatCurrency(statement.creditTotal)}</span>
            </div>
          ) : null}
        </PanelSection>
        {statement.unmatchedExpenses.length > 0 ? (
          <PanelSection title="Fora da composição oficial" aside={`${statement.unmatchedExpenses.length}`}>
            <p className="text-xs text-ds-ink-muted">
              {unmatchedActiveCount > 0
                ? `${unmatchedActiveCount} registro${unmatchedActiveCount === 1 ? " precisa" : "s precisam"} de conciliação. Nenhum deles altera o total oficial.`
                : "São cancelamentos ou previsões já conciliadas. Permanecem visíveis para rastreabilidade, sem alterar o total oficial."}
            </p>
            <ul className="space-y-1.5">
              {statement.unmatchedExpenses.map((expense: any) => (
                <li key={`unmatched-${expense.id}`} className="flex items-start justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate">
                    {expense.description || "Registro sem descrição"} · {unmatchedCardStatementRecordLabel(expense)}
                  </span>
                  <span className="shrink-0 font-mono">{formatCurrency(Number(expense.totalValue) || 0)}</span>
                </li>
              ))}
            </ul>
          </PanelSection>
        ) : null}
      </SidePanel>
    );
  }

  return (
    <PageContainer variant="wide" className="space-y-5 pb-10">
      <PageHero
        kicker="Financeiro"
        title="Despesas"
        subtitle={activePeriodLabel}
        actions={<>
          {(canViewInbox || permissions.financial?.paymentRequests?.view || canViewBudgetComparison(permissions, isDefaultAdmin) || canImportAudits) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="on-dark-secondary" size="md">
                  <Ellipsis aria-hidden="true" className="mr-2 h-4 w-4" /> Ações
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                {canViewInbox && (
                  <DropdownMenuItem asChild>
                    <Link href={FINANCIAL_ROUTES.inbox}>
                      <Inbox className="mr-2 h-4 w-4" /> Cobranças recebidas
                    </Link>
                  </DropdownMenuItem>
                )}
                {permissions.financial?.paymentRequests?.view && (
                  <DropdownMenuItem asChild>
                    <Link href={FINANCIAL_ROUTES.paymentRequests}>
                      <ShieldCheck className="mr-2 h-4 w-4" /> Autorizações bancárias
                    </Link>
                  </DropdownMenuItem>
                )}
                {canViewBudgetComparison(permissions, isDefaultAdmin) && (
                  <DropdownMenuItem asChild>
                    <Link href={`${FINANCIAL_ROUTES.budgetComparison}${competenceMonth !== "all" ? `?month=${competenceMonth}` : ""}`}>
                      <BarChart3 className="mr-2 h-4 w-4" /> Orçamento × despesas
                    </Link>
                  </DropdownMenuItem>
                )}
                {canImportAudits && (
                  <DropdownMenuItem onSelect={() => setIsImportDialogOpen(true)}>
                    <FileUp className="mr-2 h-4 w-4" /> Importar extrato
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {permissions.financial?.expenses?.create && (
            <Button variant="primary-page" size="md" asChild>
              <Link href={FINANCIAL_ROUTES.newExpense}>
                <Plus aria-hidden="true" className="mr-2 h-4 w-4" /> Novo lançamento
              </Link>
            </Button>
          )}
        </>}
        chips={<>
          <HeroChip value={scopedDisplayEntryCount} label="Todas" active={statusFilter === "all"} onClick={() => setStatusFilter("all")} />
          <HeroChip value={formatCurrency(kpis.overdue)} label="Vencido" tone="danger" active={statusFilter === "overdue"} onClick={() => setStatusFilter("overdue")} />
          <HeroChip value={formatCurrency(kpis.dueSoon)} label="Vence em 7 dias" tone="warning" />
          <HeroChip value={formatCurrency(kpis.open)} label={`Em aberto · ${openDisplayEntryCount}`} tone="info" active={statusFilter === "pending"} onClick={() => setStatusFilter("pending")} />
          <HeroChip value={pendingAuditCount} label="Pendentes de auditoria" tone="warning" active={statusFilter === "pending_audit"} onClick={() => setStatusFilter("pending_audit")} />
          <HeroChip value={formatCurrency(kpis.paid)} label="Pago" active={statusFilter === "paid"} onClick={() => setStatusFilter("paid")} />
        </>}
      >
        <div data-testid="expense-filter-bar" className="flex flex-wrap items-center gap-2">
          <ControlSearch
            value={search}
            onChange={setSearch}
            placeholder="Buscar descrição, fornecedor, alias ou identificador..."
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger aria-label="Status" className={cn(darkControl, "w-[170px]")}>
              <SelectValue placeholder="Filtrar por status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              {Object.entries(STATUS_FILTER_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={originFilter} onValueChange={setOriginFilter}>
            <SelectTrigger aria-label="Origem" className={cn(darkControl, "w-[150px]")}>
              <SelectValue placeholder="Filtrar por origem" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as origens</SelectItem>
              {Object.entries(ORIGIN_FILTER_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={paymentTypeFilter} onValueChange={setPaymentTypeFilter}>
            <SelectTrigger aria-label="Forma de pagamento" className={cn(darkControl, "w-[170px]")}>
              <SelectValue placeholder="Forma de pagamento" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os pagamentos</SelectItem>
              {Object.entries(PAYMENT_FILTER_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
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
            className={cn(darkControl, "w-[210px] [&_svg]:text-ds-on-dark-muted", activeCompetenceLabel && "border-ds-accent bg-white/10")}
          />
          <ExpensePeriodFilter
            className={cn(darkControl, "w-[220px] [&_svg]:text-ds-on-dark-muted")}
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
            <SelectTrigger aria-label="Plano de contas" data-testid="expense-account-plan-filter" className={cn(darkControl, "w-[190px]")}>
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
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-on-dark-muted">Apropriação na DRE</span>
          <FilterChips
            value={unitFilter === "all" ? null : unitFilter}
            onChange={(value) => setUnitFilter(value ?? "all")}
            allCount={scopedDisplayEntryCount}
            chips={units.map((unit) => ({ value: unit.name, label: unit.name, count: unitCounts.get(unit.name) || 0 }))}
          />
        </div>
      </PageHero>

      <KpiFlowStrip
        kpis={kpis}
        openCount={openDisplayEntryCount}
        auditCount={pendingAuditCount}
        auditActive={statusFilter === "pending_audit"}
        onAuditClick={() => setStatusFilter("pending_audit")}
        periodLabel={activePeriodLabel}
      />

      {searchParams.get("expense") && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-ds-btn border border-ds-border bg-ds-surface p-3 text-sm">
          <span>Despesa selecionada na comparação de orçamento.</span>
          <Button variant="ds-secondary" size="xs" asChild>
            <Link href={`${FINANCIAL_ROUTES.budgetComparison}?month=${competenceMonth}`}>Voltar à comparação</Link>
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2" aria-live="polite">
        <span className="text-[13px] font-bold text-ds-ink">
          {filteredDisplayEntries.length} {filteredDisplayEntries.length === 1 ? "obrigação" : "obrigações"}
        </span>
        <span data-testid="expense-competence-total" className="font-mono text-[13px] font-extrabold text-ds-accent-ink">
          Total: {formatCurrency(filteredTotalValue)}
        </span>
        {activeFilterPills.map((pill) => (
          <span
            key={pill.key}
            data-testid={pill.key === "competence" ? "active-expense-competence" : undefined}
            className="inline-flex h-[26px] items-center gap-1.5 rounded-full border border-ds-border bg-ds-surface pl-3 pr-1.5 text-xs font-bold text-ds-ink"
          >
            {pill.label}
            <button
              type="button"
              onClick={pill.onClear}
              aria-label={`Remover filtro ${pill.label}`}
              className="grid h-4 w-4 place-items-center rounded-full text-ds-ink-faint hover:bg-ds-neutral-bg hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink"
            >
              <X aria-hidden="true" className="h-3 w-3" />
            </button>
          </span>
        ))}
        {hasActiveFilters ? (
          <button
            type="button"
            onClick={clearExpenseFilters}
            className="inline-flex h-[26px] items-center gap-1 rounded-full px-2 text-xs font-bold text-ds-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink"
          >
            <RotateCcw aria-hidden="true" className="h-3 w-3" /> Limpar filtros
          </button>
        ) : null}
      </div>

      <div className="rounded-[18px] border border-ds-border bg-ds-surface">
        <div
          className={cn("hidden items-center gap-x-4 border-b border-ds-divider px-[18px] py-3 md:grid", EXPENSE_LIST_COLUMNS)}
        >
          <span className={LIST_KICKER}>Descrição</span>
          <span className={LIST_KICKER}>Fornecedor e plano</span>
          <span className={LIST_KICKER}>Centro de referência</span>
          <SortHeader label="Vencimento" active={expenseSort.key === "dueDate"} direction={expenseSort.direction} onClick={() => toggleExpenseSort("dueDate")} />
          <SortHeader label="Valor" align="right" active={expenseSort.key === "value"} direction={expenseSort.direction} onClick={() => toggleExpenseSort("value")} />
          <span className={cn(LIST_KICKER, "text-center")}>Status</span>
          <span />
        </div>
        <div className="flex items-center gap-4 border-b border-ds-divider px-[18px] py-2.5 md:hidden">
          <span className={LIST_KICKER}>Ordenar</span>
          <SortHeader label="Vencimento" active={expenseSort.key === "dueDate"} direction={expenseSort.direction} onClick={() => toggleExpenseSort("dueDate")} />
          <SortHeader label="Valor" active={expenseSort.key === "value"} direction={expenseSort.direction} onClick={() => toggleExpenseSort("value")} />
        </div>

        {loading || resultCentersLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : filteredDisplayEntries.length === 0 ? (
          <div className="m-4 rounded-[18px] border border-dashed border-ds-border px-6 py-14 text-center text-sm text-ds-ink-muted">
            {hasActiveFilters ? "Nenhuma despesa encontrada para estes filtros." : "Nenhuma despesa encontrada."}
          </div>
        ) : (
          expenseListRows.map((row) => {
            if (row.kind === "week") {
              return (
                <DueWeekHeader
                  key={`week-${row.group.key}`}
                  collapsed={collapsedDueWeeks.has(row.group.key)}
                  weekNumber={row.group.weekNumber}
                  label={row.group.label}
                  count={row.group.expenses.length}
                  total={row.group.totalValue}
                  onToggle={() => toggleDueWeek(row.group.key)}
                />
              );
            }
            if (row.dueWeekKey && collapsedDueWeeks.has(row.dueWeekKey)) return null;
            const today = startOfDay(new Date());

            if (row.kind === "card_statement") {
              const statement = row.statement;
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
                : statement.auditCounts.historical > 0
                  ? `${statement.auditCounts.historical} histórica${statement.auditCounts.historical === 1 ? "" : "s"} · fora do início da DRE`
                  : statement.auditCounts.reconciled === statement.lineCount
                    ? `${statement.lineCount} conferida${statement.lineCount === 1 ? "" : "s"}`
                    : `${statement.auditCounts.audited} auditada${statement.auditCounts.audited === 1 ? "" : "s"} · ${statement.auditCounts.reconciled} conferida${statement.auditCounts.reconciled === 1 ? "" : "s"}`;
              const unmatchedActiveCount = statement.unmatchedExpenses.filter(cardExpenseIsActiveStatementLine).length;
              return (
                <CardStatementListRow
                  key={`card-statement-${statement.key}`}
                  title={statement.title}
                  selected={expandedCardStatementKey === statement.key}
                  onOpen={() => setExpandedCardStatementKey(statement.key)}
                  lineCount={statement.lineCount}
                  auditSummary={auditSummary}
                  auditPending={statement.auditCounts.pending > 0}
                  unmatchedSummary={statement.unmatchedExpenses.length > 0 ? `${statement.unmatchedExpenses.length} fora da composição oficial` : null}
                  unmatchedActive={unmatchedActiveCount > 0}
                  unitLabel={unitLabel}
                  due={statement.dueDate}
                  showDueHint={Boolean(statement.dueDate) && statement.status !== "paid"}
                  totalValue={statement.totalValue}
                  statusKey={statement.status}
                  statusLabel={STATUS_LABELS[statement.status] ?? statement.status}
                />
              );
            }

            const expense = row.expense;
            const due = toDate(expense.dueDate);
            const statusKey = getExpenseStatusKey(expense, today);
            const planName = accountPlanMap[expense.accountId ?? expense.accountPlan] || expense.accountPlanName || expense.accountId || expense.accountPlan || "—";
            const installmentSchedule = Array.isArray(expense.installmentSchedule) && expense.installmentSchedule.length > 0
              ? expense.installmentSchedule
              : expense.installments || [];
            const installmentNumber = Number(expense.installmentNumber) || Number(expense.installments?.[0]?.number) || 1;
            const installmentTotal = Number(expense.installmentTotal) || Math.max(
              installmentSchedule.length || 1,
              ...installmentSchedule.map((installment: any) => Number(installment?.number) || 0)
            );
            return (
              <ExpenseListRow
                key={expense.id}
                expense={expense}
                statusKey={statusKey}
                statusLabel={expense.budgetMigration ? "Transferida para orçamento" : STATUS_LABELS[statusKey] || statusKey}
                selected={expandedExpenseId === expense.id}
                onOpen={() => setExpandedExpenseId(expense.id)}
                due={due}
                showDueHint={Boolean(due) && !expenseAwaitingConfirmation(expense) && !["paid", "reconciled", "cancelled"].includes(expense.status)}
                planName={planName}
                unitLabel={getExpenseUnitLabel(expense, resultCenterNameById)}
                installmentNode={installmentSchedule.length > 1 ? (
                  <div className="inline-flex rounded-full bg-ds-neutral-bg px-2 py-0.5 text-[11px] font-bold text-ds-neutral">
                    <InstallmentScheduleTooltip
                      installments={installmentSchedule}
                      label={`${installmentNumber}/${installmentTotal}`}
                      totalInstallments={installmentTotal}
                    />
                  </div>
                ) : null}
                paymentMethodLabel={expense.plannedPaymentMethodType
                  ? expense.plannedPaymentMethodLabel ||
                    PLANNED_PAYMENT_METHOD_LABELS[expense.plannedPaymentMethodType as PlannedPaymentMethodType]
                  : null}
                uberNode={<UberRecognitionStatus record={expense} compact />}
              />
            );
          })
        )}
      </div>

      {selectedExpense ? renderExpensePanel(selectedExpense) : null}
      {selectedStatement && selectedStatement.kind === "card_statement" ? renderStatementPanel(selectedStatement.statement) : null}

      <Dialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen}>
        <DialogContent className="max-w-4xl overflow-hidden rounded-3xl p-0">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>Importar extrato</DialogTitle>
            <DialogDescription>Selecione a conta do extrato e importe um arquivo OFX ou CSV para abrir uma nova sessão de auditoria.</DialogDescription>
          </DialogHeader>
          <div className="px-6 pb-6">
            <FinancialImportPage
              embedded
              uploadOnly
              onImportComplete={(sessionId) => {
                setIsImportDialogOpen(false);
                router.push(bankStatementsHref(expenseContextQuery, { sessionId, fromExpenses: true }));
              }}
            />
          </div>
        </DialogContent>
      </Dialog>

      <PayExpenseDialog expense={payTarget} open={!!payTarget} onOpenChange={(open) => !open && setPayTarget(null)} />
    </PageContainer>
  );
}

const LIST_KICKER = "text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint";

function SortHeader({
  label,
  active,
  direction,
  align,
  onClick,
}: {
  label: string;
  active: boolean;
  direction: ExpenseSortDirection;
  align?: "right";
  onClick: () => void;
}) {
  const Arrow = direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <span
      className={cn(align === "right" && "text-right")}
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={onClick}
        className={cn(
          LIST_KICKER,
          "inline-flex items-center gap-1.5 rounded-md transition-colors hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink",
          active && "text-ds-accent-ink",
        )}
      >
        {label}
        {active ? <Arrow aria-hidden="true" className="h-3 w-3" /> : null}
      </button>
    </span>
  );
}
