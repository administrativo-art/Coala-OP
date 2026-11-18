"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { stoneReceiptFlowHref } from "../receipts-reconciliation/receipt-flow-navigation";
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, Download, ExternalLink, Info, RefreshCw } from "lucide-react";
import { addMonths, format, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { FinancialAccessGuard } from "@/features/financial/components/financial-access-guard";
import { FINANCIAL_DRE_START_MONTH_KEY, FINANCIAL_ROUTES } from "@/features/financial/lib/constants";
import { financialCollection } from "@/features/financial/lib/repositories";
import { formatCurrency as currency } from "@/features/financial/lib/utils";
import { expenseAccountAllocationsForResultCenter } from "@/features/financial/lib/expense-account-allocations";
import {
  financialExpenseCompetenceMonth,
  financialExpenseParticipatesInDre,
  type FinancialExpenseDreDocument,
} from "@/features/financial/lib/expense-accounting-contract";
import {
  calculateDreExpenses,
  type DreExpenseContractIssue,
} from "@/features/financial/lib/dre-expense-calculation";
import {
  dreExpenseDetailReferences,
  groupDreExpenseDetailsByAccount,
} from "@/features/financial/lib/dre-expense-details";
import { buildDrePersonAnalysis, type DrePersonAccountMeta } from "@/features/financial/lib/dre-person-analysis";
import { DreExportMenu } from "@/features/financial/components/dre/dre-export-menu";
import { DrePeopleView } from "@/features/financial/components/dre/dre-people-view";
import { CmvClosingPanel } from "@/features/financial/components/dre/cmv-closing-panel";
import type { DreCmvPeriod } from "@/features/financial/dre/cmv-closure";
import { DreCashCard, DreCmvCard } from "@/features/financial/components/dre/dre-insights";
import { DreChartExplorer } from "@/features/financial/components/dre/dre-chart-explorer";
import {
  daysInMonthKey,
  dreBreakEvenSeries,
  dreMonthComparison,
  dreWaterfallSteps,
  finiteOrNull,
  type DreChartMonth,
  type DreChartUnit,
} from "@/features/financial/dre/dre-chart-data";
import { DreSourcesPanel, DreSourcesTrigger, type DreSourceIssue } from "@/features/financial/components/dre/dre-sources-panel";
import { dreHorizontalVariation, dreRevenueComposition, dreVariationTone, previousDreMonthKey } from "@/features/financial/lib/dre-statement";
import { calculateDreMetrics } from "@/features/financial/dre/metrics";
import { PageHero } from "@/components/patterns/page-hero";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/layout/page-container";
import { useFinancialCollection } from "@/features/financial/hooks/use-financial-collection";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useKiosks } from "@/hooks/use-kiosks";
import type { DreClosureUnitMonthSummary, DreSalesUnitMonthSummary, DreSourceDataPayload } from "@/features/financial/dre/source-data";
import { aggregateDreRevenue, dreRevenueUnitIds, selectDreRevenue } from "@/features/financial/dre/revenue-selection";
import type {
  DreCmvCriterion,
  DreStockCmvPayload,
} from "@/features/financial/dre/stock-cmv";
import { selectDreStockCmv } from "@/features/financial/dre/stock-cmv";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip as HelpTooltip, TooltipContent, TooltipPortal, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// ── helpers ──────────────────────────────────────────────────────────────────

function pct(value: number, base: number) {
  if (!Number.isFinite(value) || !Number.isFinite(base) || base <= 0) return "—";
  return `${((value / base) * 100).toFixed(1)}%`;
}

// NaN propagates unavailable inputs only inside this view's arithmetic; never persisted/exported.
function formatCurrency(value: number) {
  return Number.isFinite(value) ? currency(value) : "Indisponível";
}

function NetRevenueInfo({ gross, deductions, net }: { gross: number; deductions: number; net: number }) {
  const [open, setOpen] = useState(false);
  return (
    <TooltipProvider delayDuration={100}>
      <HelpTooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Como é calculada a receita líquida"
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ds-ink-muted hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent"
            onClick={(event) => {
              // Keep the standard hover/focus behavior and allow tapping the explanation.
              event.preventDefault();
              setOpen((current) => !current);
            }}
          >
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipPortal>
          <TooltipContent side="top" align="start" collisionPadding={16} className="w-80 max-w-[calc(100vw-32px)] space-y-2 whitespace-normal p-3 text-xs leading-relaxed">
            <p className="font-semibold">Cálculo da receita líquida</p>
            {Number.isFinite(gross) && Number.isFinite(deductions) && Number.isFinite(net) ? <dl className="space-y-1">
              <div className="flex justify-between gap-3"><dt>Vendas no PDV</dt><dd className="font-ds-mono">{formatCurrency(gross)}</dd></div>
              <div className="flex justify-between gap-3"><dt>− Impostos e deduções</dt><dd className="font-ds-mono">{formatCurrency(deductions)}</dd></div>
              <div className="flex justify-between gap-3 border-t pt-1 font-semibold"><dt>= Receita líquida</dt><dd className="font-ds-mono">{formatCurrency(net)}</dd></div>
            </dl> : <p>Valores indisponíveis enquanto as fontes estão sendo conferidas.</p>}
            <p>Os impostos entram pela competência selecionada, mesmo com pagamento pendente.</p>
            <p>Faltas e sobras de caixa entram depois, no resultado operacional.</p>
          </TooltipContent>
        </TooltipPortal>
      </HelpTooltip>
    </TooltipProvider>
  );
}

function dreMonthKeysEndingAt(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const end = new Date(year, month - 1, 1);
  return Array.from({ length: 6 }, (_, index) => format(subMonths(end, 5 - index), "yyyy-MM"))
    .filter((key) => key >= FINANCIAL_DRE_START_MONTH_KEY);
}

function expenseIssueLabel(issue: DreExpenseContractIssue, showPersonnelDetails = true) {
  switch (issue.code) {
    case "missing_account":
      return "Plano de contas não informado";
    case "unknown_account":
      return "Plano de contas vinculado não foi encontrado";
    case "account_allocation_mismatch": {
      const difference = issue.differenceCents ?? 0;
      const amount = formatCurrency(Math.abs(difference) / 100);
      return difference >= 0
        ? `Rateio por plano de contas incompleto: faltam ${amount}`
        : `Rateio por plano de contas excede o total em ${amount}`;
    }
    case "invalid_person_allocations": {
      if (!showPersonnelDetails) return "Rateio por colaborador inválido";
      const accountDifferences = issue.personAccountDifferences ?? [];
      const totalDifference = issue.personDifferenceCents ?? 0;
      if (accountDifferences.length === 0 && totalDifference === 0) {
        return "Rateio por colaborador inválido: revise colaborador, centro, plano e valor";
      }
      const totalLabel = totalDifference > 0
        ? `faltam ${formatCurrency(totalDifference / 100)} no total`
        : totalDifference < 0
          ? `o total excede em ${formatCurrency(Math.abs(totalDifference) / 100)}`
          : "o total geral fecha, mas os planos divergem";
      const planLabel = accountDifferences.map((difference) => (
        difference.differenceCents > 0
          ? `${difference.accountPlanName}: faltam ${formatCurrency(difference.differenceCents / 100)}`
          : `${difference.accountPlanName}: excede em ${formatCurrency(Math.abs(difference.differenceCents) / 100)}`
      )).join("; ");
      return `Rateio por colaborador não fecha: ${totalLabel}${planLabel ? ` (${planLabel})` : ""}`;
    }
    case "missing_result_center":
      return "Centro de resultado não informado";
    case "unknown_result_center":
      return "Centro de resultado vinculado não foi encontrado";
    case "apportionment_mismatch":
      return "Rateio por centro de resultado não soma 100%";
  }
}

// ── component ─────────────────────────────────────────────────────────────────

export function DrePage() {
  const { firebaseUser, permissions } = useAuth();
  const api = useAuthenticatedApi();
  const { kiosks } = useKiosks();

  const [selectedMonth, setSelectedMonth] = useState(() => {
    const currentMonth = format(new Date(), "yyyy-MM");
    return currentMonth < FINANCIAL_DRE_START_MONTH_KEY ? FINANCIAL_DRE_START_MONTH_KEY : currentMonth;
  });
  const [unitFilter, setUnitFilter] = useState("all");
  const [cmvCriterion, setCmvCriterion] = useState<DreCmvCriterion>("composition");
  const [viewMode, setViewMode] = useState<"classic" | "dashboard" | "people">("classic");
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [expandedDreRows, setExpandedDreRows] = useState<Record<string, boolean>>({});
  const canViewPersonnelCosts = permissions.financial?.personnelCosts?.view === true;
  const canExportPersonnelCosts = canViewPersonnelCosts && permissions.financial?.personnelCosts?.export === true;
  const canViewExpenseDetails = permissions.financial?.expenses?.view === true;
  const canEditExpenses = permissions.financial?.expenses?.create === true
    && permissions.financial?.expenses?.edit === true;

  useEffect(() => {
    if (!canViewPersonnelCosts && viewMode === "people") setViewMode("classic");
  }, [canViewPersonnelCosts, viewMode]);

  const { data: accounts, loading: loadingAccounts } = useFinancialCollection<any>(financialCollection("accounts"));
  const { data: resultCenters, loading: loadingResultCenters } = useFinancialCollection<any>(financialCollection("resultCenters"));

  const [expenses, setExpenses] = useState<FinancialExpenseDreDocument[]>([]);
  const [salesSummaries, setSalesSummaries] = useState<DreSalesUnitMonthSummary[]>([]);
  const [closureRevenueSummaries, setClosureRevenueSummaries] = useState<DreClosureUnitMonthSummary[]>([]);
  const [missingSimulationIds, setMissingSimulationIds] = useState<string[]>([]);
  const [cmvPeriods, setCmvPeriods] = useState<DreCmvPeriod[]>([]);
  const [cmvCapabilities, setCmvCapabilities] = useState({ canClose: false, canReopen: false });
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [loadingSource, setLoadingSource] = useState(true);
  const [sourceReloadToken, setSourceReloadToken] = useState(0);
  const [stockCmvPayload, setStockCmvPayload] = useState<DreStockCmvPayload | null>(null);
  const [stockCmvError, setStockCmvError] = useState<string | null>(null);
  const [loadingStockCmv, setLoadingStockCmv] = useState(false);

  useEffect(() => {
    if (!firebaseUser || kiosks.length === 0 || !permissions.financial?.dre) {
      setSalesSummaries([]);
      setClosureRevenueSummaries([]);
      setExpenses([]);
      setMissingSimulationIds([]);
      setCmvPeriods([]);
      setCmvCapabilities({ canClose: false, canReopen: false });
      setSourceError(null);
      setLoadingSource(false);
      return;
    }
    let cancelled = false;
    setLoadingSource(true);
    setSourceError(null);
    const params = new URLSearchParams();
    kiosks.slice(0, 20).forEach((kiosk) => params.append("kioskId", kiosk.id));
    dreMonthKeysEndingAt(selectedMonth).forEach((period) => params.append("period", period));
    void api<DreSourceDataPayload>(`/api/financial/dre/source-data?${params}`, {
      fallbackError: "Falha ao carregar as fontes da DRE.",
    }).then((payload) => {
      if (cancelled) return;
      setSalesSummaries(payload.salesSummaries ?? []);
      setClosureRevenueSummaries(payload.closureSummaries ?? []);
      setExpenses(payload.expenses ?? []);
      setMissingSimulationIds(payload.missingSimulationIds ?? []);
      setCmvPeriods(payload.cmvPeriods ?? []);
      setCmvCapabilities(payload.cmvCapabilities ?? { canClose: false, canReopen: false });
    }).catch((error) => {
      if (cancelled) return;
      setSalesSummaries([]);
      setClosureRevenueSummaries([]);
      setExpenses([]);
      setMissingSimulationIds([]);
      setCmvPeriods([]);
      setCmvCapabilities({ canClose: false, canReopen: false });
      setSourceError(error instanceof Error ? error.message : "Falha ao carregar as fontes da DRE.");
    }).finally(() => {
      if (!cancelled) setLoadingSource(false);
    });
    return () => { cancelled = true; };
  }, [api, firebaseUser, kiosks, permissions.financial?.dre, selectedMonth, sourceReloadToken]);

  useEffect(() => {
    if (!firebaseUser || kiosks.length === 0 || !permissions.financial?.dre) return;
    let cancelled = false;
    setLoadingStockCmv(true);
    setStockCmvError(null);
    const params = new URLSearchParams();
    kiosks.slice(0, 20).forEach((kiosk) => params.append("kioskId", kiosk.id));
    dreMonthKeysEndingAt(selectedMonth).forEach((period) => params.append("period", period));
    void api<DreStockCmvPayload>(`/api/financial/dre/stock-cmv?${params}`, {
      fallbackError: "Falha ao calcular o CMV pelas movimentações de estoque.",
    }).then((payload) => {
      if (cancelled) return;
      setStockCmvPayload(payload);
    }).catch((error) => {
      if (cancelled) return;
      setStockCmvPayload(null);
      setStockCmvError(error instanceof Error ? error.message : "Falha ao calcular o CMV pelas movimentações de estoque.");
    }).finally(() => {
      if (!cancelled) setLoadingStockCmv(false);
    });
    return () => { cancelled = true; };
  }, [api, firebaseUser, kiosks, permissions.financial?.dre, selectedMonth, sourceReloadToken]);

  const loading = loadingAccounts
    || loadingResultCenters
    || loadingSource
    || (cmvCriterion === "stock_movement" && loadingStockCmv);

  // ── derived maps ────────────────────────────────────────────────────────────

  const kioskNameById = useMemo(() => {
    const m: Record<string, string> = {};
    kiosks.forEach((k) => { m[k.id] = k.name; });
    return m;
  }, [kiosks]);

  const resultCenterNameByKioskId = useMemo(() => {
    const map: Record<string, string> = {};
    (resultCenters || []).forEach((center: any) => {
      if (typeof center?.name !== "string") return;
      (Array.isArray(center.unitIds) ? center.unitIds : []).forEach((unitId: unknown) => {
        if (typeof unitId === "string" && unitId) map[unitId] = center.name;
      });
    });
    return map;
  }, [resultCenters]);

  const resultCenterNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    (resultCenters || []).forEach((center: any) => {
      if (typeof center?.name !== "string") return;
      if (typeof center.id === "string" && center.id) map[center.id] = center.name;
      map[center.name] = center.name;
      (Array.isArray(center.unitIds) ? center.unitIds : []).forEach((unitId: unknown) => {
        if (typeof unitId === "string" && unitId) map[unitId] = center.name;
      });
    });
    return map;
  }, [resultCenters]);

  const selectedUnitName = unitFilter === "all"
    ? null
    : (resultCenterNameByKioskId[unitFilter] ?? kioskNameById[unitFilter] ?? null);
  const selectedKioskId = unitFilter === "all" ? null : unitFilter;

  // ── computation helpers ─────────────────────────────────────────────────────

  type DreScope = { kioskId: string | null; unitName: string | null };
  const selectedScope: DreScope = { kioskId: selectedKioskId, unitName: selectedUnitName };

  function getRevenue(monthKey: string, scope: DreScope = selectedScope) {
    const selectedKioskId = scope.kioskId;
    const [year, month] = monthKey.split("-").map(Number);
    const pdvUnitIds = dreRevenueUnitIds(kiosks, closureRevenueSummaries, salesSummaries);
    const unitIds = selectedKioskId
      ? [selectedKioskId]
      : pdvUnitIds;
    const units = unitIds.map(kioskId => ({ kioskId, ...selectDreRevenue({ kioskId, year, month,
      closureSummaries: closureRevenueSummaries, salesSummaries }) }));
    return { ...aggregateDreRevenue(units), units,
      costOnlyUnit: !!selectedKioskId && !pdvUnitIds.includes(selectedKioskId) };
  }

  function getCompositionPeriods(monthKey: string, scope: DreScope = selectedScope) {
    const selectedKioskId = scope.kioskId;
    const unitIds = selectedKioskId ? [selectedKioskId] : dreRevenueUnitIds(kiosks, closureRevenueSummaries, salesSummaries);
    return cmvPeriods.filter(row => row.period === monthKey && unitIds.includes(row.kioskId));
  }

  function getCompositionCmv(monthKey: string, scope: DreScope = selectedScope): number {
    const selectedKioskId = scope.kioskId;
    const periods = getCompositionPeriods(monthKey, scope);
    if (periods.length) return periods.some(row => !row.complete || row.totalCmv === null)
      ? NaN : periods.reduce((sum, row) => sum + row.totalCmv!, 0);
    const [y, m] = monthKey.split("-").map(Number);
    return salesSummaries.reduce((sum, summary) => {
      if (summary.year !== y || summary.month !== m) return sum;
      if (selectedKioskId && summary.kioskId !== selectedKioskId) return sum;
      return summary.cmvComplete === false ? NaN : sum + summary.cmv;
    }, 0);
  }

  function getStockCmvBreakdown(monthKey: string, scope: DreScope = selectedScope) {
    return selectDreStockCmv({ payload: stockCmvPayload, monthKey, sourceError: Boolean(stockCmvError), loading: loadingStockCmv,
      kioskIds: scope.kioskId ? [scope.kioskId] : kiosks.map(kiosk => kiosk.id) });
  }

  function getDreMetrics(monthKey: string, scope: DreScope = selectedScope) {
    const expenseCalculation = monthKey < FINANCIAL_DRE_START_MONTH_KEY
      ? { totalsByPosition: {}, detailsByPosition: {}, issues: [] }
      : calculateDreExpenses({
          expenses,
          accounts: Object.fromEntries((accounts || []).map((account: any) => [account.id, {
            name: account.name || account.id,
            drePosition: account.dre_position ?? null,
            isDreAccount: account.is_dre_account !== false,
          }])),
          monthKey,
          resultCenter: scope.unitName,
          resultCenterNames: resultCenterNameMap,
        });
    return calculateDreMetrics({ expenseCalculation, revenueSource: getRevenue(monthKey, scope),
      stockCmvBreakdown: getStockCmvBreakdown(monthKey, scope), compositionCmv: getCompositionCmv(monthKey, scope),
      cmvCriterion, compositionPeriods: getCompositionPeriods(monthKey, scope) });
  }

  // ── per-month data ───────────────────────────────────────────────────────────

  const chartMonthKeys = useMemo(() => {
    const [y, m] = selectedMonth.split("-").map(Number);
    const end = new Date(y, m - 1, 1);
    return Array.from({ length: 6 }, (_, i) => format(subMonths(end, 5 - i), "yyyy-MM"))
      .filter((key) => key >= FINANCIAL_DRE_START_MONTH_KEY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth]);

  const chartData = useMemo((): DreChartMonth[] => {
    return chartMonthKeys.map((key) => {
      const row = getDreMetrics(key);
      const [y, m] = key.split("-").map(Number);
      return {
        key,
        label: format(new Date(y, m - 1, 1), "MMM/yy", { locale: ptBR }),
        revBruta: finiteOrNull(row.revBruta),
        recLiq: finiteOrNull(row.recLiq),
        cmv: finiteOrNull(row.cmv),
        cmvComposition: finiteOrNull(row.compositionCmv),
        cmvStock: finiteOrNull(row.stockCmvBreakdown.totalCmv),
        totalFixos: row.totalFixos,
        margContr: finiteOrNull(row.margContr),
        lucroLiq: finiteOrNull(row.lucroLiq),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, chartMonthKeys, closureRevenueSummaries, cmvCriterion, cmvPeriods, expenses, kiosks, resultCenterNameMap, salesSummaries, selectedUnitName, selectedKioskId, loadingStockCmv, stockCmvError, stockCmvPayload]);

  const metrics = useMemo(
    () => getDreMetrics(selectedMonth),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accounts, selectedMonth, closureRevenueSummaries, cmvCriterion, cmvPeriods, expenses, kiosks, resultCenterNameMap, salesSummaries, selectedUnitName, selectedKioskId, loadingStockCmv, stockCmvError, stockCmvPayload]
  );
  const selectedStockBreakdown = metrics.stockCmvBreakdown;
  const selectedCompositionCmv = getCompositionCmv(selectedMonth);
  const stockCmvAvailableForSelectedMonth = selectedStockBreakdown.coverage === "complete";
  const selectedCmvPeriods = getCompositionPeriods(selectedMonth);
  const incompleteCmvPeriods = selectedCmvPeriods.filter(row => !row.complete);
  const changedCmvPeriods = selectedCmvPeriods.filter(row => row.sourceChanged);
  const cmvIntegrityIssue = cmvCriterion === "composition"
    ? incompleteCmvPeriods.length > 0 || changedCmvPeriods.length > 0 || (!selectedCmvPeriods.length && missingSimulationIds.length > 0)
    : selectedStockBreakdown.coverage !== "complete";
  const expenseContractIssues = metrics.expenseIssues;
  const expenseContractIssueGroups = useMemo(() => {
    const expensesById = new Map(expenses.map((expense) => [expense.id, expense]));
    const personnelAccountIds = new Set(
      (accounts || [])
        .filter((account: any) => account.dre_position === "pessoal")
        .map((account: any) => String(account.id)),
    );
    const groups = new Map<string, {
      expense: FinancialExpenseDreDocument | null;
      issues: DreExpenseContractIssue[];
    }>();
    expenseContractIssues.forEach((issue) => {
      const current = groups.get(issue.expenseId) ?? {
        expense: expensesById.get(issue.expenseId) ?? null,
        issues: [],
      };
      current.issues.push(issue);
      groups.set(issue.expenseId, current);
    });
    return [...groups.entries()].map(([expenseId, group]) => ({
      expenseId,
      ...group,
      isPersonnelExpense: group.expense
        ? expenseAccountAllocationsForResultCenter(group.expense)
            .some((allocation) => personnelAccountIds.has(allocation.accountPlanId))
        : false,
    }));
  }, [accounts, expenseContractIssues, expenses]);

  const accountNameById = useMemo(() => {
    const m: Record<string, string> = {};
    (accounts || []).forEach((a: any) => { m[a.id] = a.name; });
    return m;
  }, [accounts]);

  const accountMetaById = useMemo(() => {
    const map: Record<string, DrePersonAccountMeta> = {};
    (accounts || []).forEach((account: any) => {
      map[account.id] = {
        name: account.name || account.id,
        drePosition: account.dre_position ?? null,
        isDreAccount: account.is_dre_account !== false,
      };
    });
    return map;
  }, [accounts]);

  const personAnalysis = useMemo(() => buildDrePersonAnalysis({
    expenses: canViewPersonnelCosts ? (expenses || []) : [],
    accounts: accountMetaById,
    monthKey: selectedMonth,
    resultCenter: selectedUnitName,
    resultCenterNames: resultCenterNameMap,
  }), [canViewPersonnelCosts, expenses, accountMetaById, selectedMonth, selectedUnitName, resultCenterNameMap]);

  const topExpensePlans = useMemo(() => {
    const totals: Record<string, number> = {};
    expenses.forEach((expense) => {
      if (!financialExpenseParticipatesInDre(expense)) return;
      if (financialExpenseCompetenceMonth(expense) !== selectedMonth) return;
      expenseAccountAllocationsForResultCenter(expense, selectedUnitName, resultCenterNameMap, accountNameById).forEach((allocation) => {
        if (!accountMetaById[allocation.accountPlanId]?.isDreAccount) return;
        const name = allocation.accountPlanName || "Sem classificação";
        totals[name] = (totals[name] || 0) + allocation.amount;
      });
    });
    return Object.entries(totals).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenses, accountMetaById, accountNameById, resultCenterNameMap, selectedMonth, selectedUnitName]);

  const cmvByUnit = useMemo(() => {
    const [y, m] = selectedMonth.split("-").map(Number);
    const summaries: Array<{ kioskId: string; cmv: number }> = cmvCriterion === "stock_movement"
      ? (stockCmvPayload?.stockSummaries ?? [])
          .filter((summary) => summary.year === y && summary.month === m && summary.totalCmv > 0)
          .map((summary) => ({ kioskId: summary.kioskId, cmv: getStockCmvBreakdown(selectedMonth, { kioskId: summary.kioskId, unitName: null }).totalCmv }))
          .filter(summary => Number.isFinite(summary.cmv))
      : salesSummaries
          .filter((summary) => summary.year === y && summary.month === m && summary.cmv > 0)
          .map((summary) => ({ kioskId: summary.kioskId, cmv: summary.cmv }));
    return summaries
      .map((summary) => ({ ...summary, name: kioskNameById[summary.kioskId] || summary.kioskId }))
      .sort((left, right) => right.cmv - left.cmv);
  }, [cmvCriterion, salesSummaries, selectedMonth, kioskNameById, loadingStockCmv, stockCmvError, stockCmvPayload]);

  const chartUnits = useMemo((): DreChartUnit[] => {
    if (selectedKioskId) return [];
    return dreRevenueUnitIds(kiosks, closureRevenueSummaries, salesSummaries).map((kioskId) => {
      const row = getDreMetrics(selectedMonth, {
        kioskId,
        unitName: resultCenterNameByKioskId[kioskId] ?? kioskNameById[kioskId] ?? null,
      });
      return {
        kioskId,
        name: kioskNameById[kioskId] ?? kioskId,
        revenue: finiteOrNull(row.recLiq),
        cmv: finiteOrNull(row.cmv),
        margContr: finiteOrNull(row.margContr),
        fixed: row.totalFixos,
        lucro: finiteOrNull(row.lucroLiq),
      };
    }).filter((unit) => (unit.revenue ?? 0) > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, selectedMonth, closureRevenueSummaries, cmvCriterion, cmvPeriods, expenses, kiosks, kioskNameById, resultCenterNameByKioskId, resultCenterNameMap, salesSummaries, selectedKioskId, loadingStockCmv, stockCmvError, stockCmvPayload]);

  const dailySales = useMemo(() => {
    const [y, m] = selectedMonth.split("-").map(Number);
    const days = daysInMonthKey(selectedMonth);
    const units = salesSummaries
      .filter((summary) => summary.year === y && summary.month === m && (!selectedKioskId || summary.kioskId === selectedKioskId))
      .filter((summary) => summary.dailyRevenue && Object.keys(summary.dailyRevenue).length > 0)
      .map((summary) => ({
        kioskId: summary.kioskId,
        name: kioskNameById[summary.kioskId] ?? summary.kioskId,
        values: Array.from({ length: days }, (_, index) => summary.dailyRevenue?.[`${selectedMonth}-${String(index + 1).padStart(2, "0")}`] ?? 0),
      }))
      .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
    const total: Record<string, number> = {};
    units.forEach((unit) => unit.values.forEach((value, index) => {
      const date = `${selectedMonth}-${String(index + 1).padStart(2, "0")}`;
      total[date] = (total[date] ?? 0) + value;
    }));
    return { days, units, total };
  }, [kioskNameById, salesSummaries, selectedKioskId, selectedMonth]);

  const hasDreCategories = useMemo(
    () => (accounts || []).length > 0,
    [accounts]
  );

  // ── navigation ──────────────────────────────────────────────────────────────

  function navigateMonth(delta: number) {
    const [y, m] = selectedMonth.split("-").map(Number);
    const target = format(addMonths(new Date(y, m - 1, 1), delta), "yyyy-MM");
    setSelectedMonth(target < FINANCIAL_DRE_START_MONTH_KEY ? FINANCIAL_DRE_START_MONTH_KEY : target);
  }

  const selectedMonthLabel = useMemo(() => {
    const [y, m] = selectedMonth.split("-").map(Number);
    return format(new Date(y, m - 1, 1), "MMMM 'de' yyyy", { locale: ptBR });
  }, [selectedMonth]);

  const isFutureMonth = selectedMonth >= format(addMonths(new Date(), 1), "yyyy-MM");

  // ── export ───────────────────────────────────────────────────────────────────

  function exportCsv() {
    if (loading || sourceError || (viewMode !== "people" && !Number.isFinite(metrics.lucroLiq))) return;
    if (viewMode === "people") {
      if (!canExportPersonnelCosts) return;
      const rows = [
        ["DRE por colaborador —", selectedMonthLabel, unitFilter === "all" ? "Todas as unidades" : (kioskNameById[unitFilter] ?? unitFilter)],
        [],
        ["Colaborador", "Unidade", "Rubrica", "Natureza", "Compõe a DRE", "Valor"],
        ...personAnalysis.people.flatMap((person) => person.rubrics.map((rubric) => [
          person.employeeName,
          rubric.resultCenters.join(" · ") || person.resultCenters.join(" · "),
          rubric.accountPlanName,
          rubric.analysisType === "employer_cost"
            ? "Custo da empresa"
            : rubric.analysisType === "employee_deduction" ? "Desconto do colaborador" : "Informativo",
          rubric.countsInDre ? "Sim" : "Não",
          formatCurrency(rubric.amount),
        ])),
      ];
      const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(";")).join("\n");
      const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
      const anchor = document.createElement("a");
      anchor.href = URL.createObjectURL(blob);
      anchor.download = `dre-colaboradores-${selectedMonth}.csv`;
      anchor.click();
      URL.revokeObjectURL(anchor.href);
      return;
    }
    const { revBruta, impostos, recLiq, cmv, stockCmvBreakdown, custVar, margBruta, margContr, pessoal, despOp, ocupacao, semCategoria, resOp, recFin, despFin, recNaoOp, despNaoOp, lair, irCsll, lucroLiq, pe } = metrics;
    const cmvRows = cmvCriterion === "stock_movement"
      ? [
          ["Critério do CMV", "Movimentação de estoque (estimativa histórica)", ""],
          ["(-) Consumo movimentado", formatCurrency(stockCmvBreakdown.consumptionCmv), pct(stockCmvBreakdown.consumptionCmv, recLiq)],
          ["(-) Perdas e descartes", formatCurrency(stockCmvBreakdown.lossesCmv), pct(stockCmvBreakdown.lossesCmv, recLiq)],
          ["(-) Ajustes negativos de estoque", formatCurrency(stockCmvBreakdown.adjustmentsCmv), pct(stockCmvBreakdown.adjustmentsCmv, recLiq)],
          ["= Impacto total dos insumos", formatCurrency(cmv), pct(cmv, recLiq)],
        ]
      : [
          ["Critério do CMV", "Composição dos produtos", ""],
          ...selectedCmvPeriods.map(row => [
            `CMV · ${kioskNameById[row.kioskId] ?? row.kioskId}`,
            row.status === "closed" ? `Congelado · revisão ${row.revision} · ${row.closedAt}` : "Em aberto · custos atuais",
            "Custo vigente na consulta ou confirmação do fechamento; não é custo histórico por venda",
          ]),
          ["(-) CMV pela composição", formatCurrency(cmv), pct(cmv, recLiq)],
        ];
    const rows = [
      ["DRE —", selectedMonthLabel, unitFilter === "all" ? "Todas as unidades" : (kioskNameById[unitFilter] ?? unitFilter)],
      ["Situação do resultado", metrics.resultState.status === "provisional" ? "Provisório" : "Sem pendências de cálculo", metrics.resultState.reasons.join(" ")],
      ["Cobertura das diferenças de caixa", `${metrics.revenueSource.cashDifferenceCoveredDays}/${metrics.revenueSource.cashDifferenceTotalDays} dias`,
        metrics.revenueSource.cashDifferenceCoverage === "complete" && !metrics.revenueSource.cashDifferenceProvisional
          ? "Completa" : "Resultado provisório: somente diferenças comprovadas"],
      [],
      ["Indicador", "Valor", "% Receita Líquida"],
      ["Receita Bruta", formatCurrency(revBruta), pct(revBruta, recLiq)],
      ["(-) Impostos e deduções", formatCurrency(impostos), pct(impostos, recLiq)],
      ["= Receita Líquida", formatCurrency(recLiq), "100%"],
      ...cmvRows,
      ["= Margem Bruta", formatCurrency(margBruta), pct(margBruta, recLiq)],
      ["(-) Insumos e fretes de aquisição", formatCurrency(custVar), pct(custVar, recLiq)],
      ["= Margem de Contribuição", formatCurrency(margContr), pct(margContr, recLiq)],
      ["Ponto de Equilíbrio", formatCurrency(pe), ""],
      ["(-) Pessoal", formatCurrency(pessoal), pct(pessoal, recLiq)],
      ["(-) Despesas operacionais", formatCurrency(despOp), pct(despOp, recLiq)],
      ["(-) Ocupação", formatCurrency(ocupacao), pct(ocupacao, recLiq)],
      ["(-) Não classificado", formatCurrency(semCategoria), pct(semCategoria, recLiq)],
      ["(-) Faltas de caixa", formatCurrency(metrics.cashShortage), pct(metrics.cashShortage, recLiq)],
      ["(+) Sobras de caixa", formatCurrency(metrics.cashSurplus), pct(metrics.cashSurplus, recLiq)],
      ["= EBIT (Resultado Operacional)", formatCurrency(resOp), pct(resOp, recLiq)],
      ["(+) Receita financeira", formatCurrency(recFin), pct(recFin, recLiq)],
      ["(-) Despesas financeiras", formatCurrency(despFin), pct(despFin, recLiq)],
      ["(+) Receita não operacional", formatCurrency(recNaoOp), pct(recNaoOp, recLiq)],
      ["(-) Despesa não operacional", formatCurrency(despNaoOp), pct(despNaoOp, recLiq)],
      ["= LAIR", formatCurrency(lair), pct(lair, recLiq)],
      ["(-) IR / CSLL", formatCurrency(irCsll), pct(irCsll, recLiq)],
      ["= Lucro Líquido", formatCurrency(lucroLiq), pct(lucroLiq, recLiq)],
    ];
    const csv = rows.map((r) => r.map((c) => `"${c ?? ""}"`).join(";")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `dre-${selectedMonth}-${cmvCriterion === "stock_movement" ? "estoque" : "composicao"}.csv`;
    a.click();
  }

  // ── comparação e pendências ─────────────────────────────────────────────────

  type DreMetrics = ReturnType<typeof getDreMetrics>;
  const previousMonthKey = previousDreMonthKey(selectedMonth, FINANCIAL_DRE_START_MONTH_KEY);
  const previousMetrics = useMemo(
    () => (previousMonthKey ? getDreMetrics(previousMonthKey) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accounts, previousMonthKey, closureRevenueSummaries, cmvCriterion, cmvPeriods, expenses, kiosks, resultCenterNameMap, salesSummaries, selectedUnitName, selectedKioskId, loadingStockCmv, stockCmvError, stockCmvPayload]
  );
  const shortMonthLabel = (monthKey: string) => {
    const [y, m] = monthKey.split("-").map(Number);
    return format(new Date(y, m - 1, 1), "MMM/yy", { locale: ptBR });
  };

  const sourceIssues: DreSourceIssue[] = [];
  if (!loading && !sourceError && metrics.revenueSource.issues.length > 0) {
    sourceIssues.push({
      id: "revenue",
      tone: "warning",
      title: metrics.revenueSource.units.some((unit) => unit.revenueCents === null || unit.cashShortageCents === null)
        ? "Vendas ou caixa a conferir"
        : `Caixa comprovado em ${metrics.revenueSource.cashDifferenceCoveredDays} de ${metrics.revenueSource.cashDifferenceTotalDays} dias`,
      body: (
        <>
          <p>Faltas e sobras somam somente os dias com diferenças comprovadas. O resultado é provisório enquanto houver dias ou contagens pendentes.</p>
          <ul className="list-disc space-y-1 pl-4">
            {metrics.revenueSource.units.filter((unit) => unit.issues.length > 0).map((unit) => (
              <li key={unit.kioskId}>
                <strong>{kioskNameById[unit.kioskId] ?? unit.kioskId}</strong>: caixa {unit.cashDifferenceCoveredDays}/{unit.cashDifferenceTotalDays} dias
                {unit.revenueCents === null ? "; receita indisponível" : ""}
                {unit.cashShortageCents === null ? "; diferenças de caixa indisponíveis" : ""}
                {unit.cashDifferenceProvisional ? "; valor provisório" : ""}
                {unit.pendingOperatorCount === null ? "; cobertura a conferir" : `; ${unit.pendingOperatorCount} contagem(ns) aguardando conferência financeira`}.
              </li>
            ))}
          </ul>
          <Link className="font-bold text-ds-accent-ink underline-offset-2 hover:underline" href="/dashboard/financial/cash-closures">Abrir fechamento de caixa</Link>
        </>
      ),
    });
  }
  if (!sourceError && cmvCriterion === "composition" && incompleteCmvPeriods.length > 0) {
    sourceIssues.push({ id: "cmv-incomplete", tone: "warning", blocksExport: true, title: "CMV incompleto", body: <p>Confira os relatórios de vendas, as fichas, os ingredientes e seus custos em {incompleteCmvPeriods.map((row) => kioskNameById[row.kioskId] ?? row.kioskId).join(", ")}. Custo ausente não é zero. Fechamento e exportação ficam bloqueados até a correção.</p> });
  }
  if (!sourceError && cmvCriterion === "composition" && changedCmvPeriods.length > 0) {
    sourceIssues.push({ id: "cmv-changed", tone: "warning", blocksExport: true, title: "Vendas alteradas após o fechamento do CMV", body: <p>{changedCmvPeriods.map((row) => kioskNameById[row.kioskId] ?? row.kioskId).join(", ")}: o custo congelado foi preservado. Reabra para conferir e fechar novamente; resultado e exportação permanecem pendentes.</p> });
  }
  if (!sourceError && cmvCriterion === "stock_movement" && stockCmvError) {
    sourceIssues.push({ id: "stock-error", tone: "danger", blocksExport: true, title: "O CMV por movimentação não pôde ser calculado", body: <p>{stockCmvError}</p> });
  }
  if (!sourceError && cmvCriterion === "stock_movement" && !loadingStockCmv && !stockCmvError && selectedStockBreakdown.coverage !== "complete") {
    sourceIssues.push({ id: "stock-coverage", tone: "warning", blocksExport: true, title: "CMV por estoque indisponível no filtro atual", body: <p>{selectedStockBreakdown.unpricedMovementCount > 0 ? `${selectedStockBreakdown.unpricedMovementCount} movimentação(ões) estão sem custo. ` : "A fonte não comprova a cobertura de todas as unidades e da competência selecionada. "}CMV e resultados dependentes permanecem indisponíveis; ausência de fonte não é zero.</p> });
  }
  if (!sourceError && cmvCriterion === "composition" && selectedCmvPeriods.some(row => row.status !== "closed")) {
    sourceIssues.push({ id: "cmv-open", tone: "warning", title: "CMV por composição em aberto", body: <p>O resultado é provisório: as fichas e os custos atuais podem mudar até a confirmação do fechamento do CMV.</p> });
  }
  if (!sourceError && expenseContractIssues.length > 0) {
    sourceIssues.push({
      id: "expenses",
      tone: "warning",
      blocksExport: true,
      title: `${expenseContractIssueGroups.length} ${expenseContractIssueGroups.length === 1 ? "despesa pendente" : "despesas pendentes"} de integridade`,
      body: (
        <>
          <p>{expenseContractIssues.length === 1 ? "1 inconsistência contábil impede" : `${expenseContractIssues.length} inconsistências contábeis impedem`} considerar a DRE fechada. A exportação fica bloqueada até a correção.</p>
          <div className="divide-y divide-ds-alert-border overflow-hidden rounded-ds-sm border border-ds-alert-border bg-ds-surface">
            {expenseContractIssueGroups.map(({ expenseId, expense, issues, isPersonnelExpense }) => {
              const canIdentifyExpense = canViewExpenseDetails && (!isPersonnelExpense || canViewPersonnelCosts);
              const title = canIdentifyExpense ? expense?.description || expense?.supplier || "Despesa sem descrição" : "Despesa com inconsistência";
              const showSupplier = Boolean(canIdentifyExpense && expense?.description && expense.supplier && expense.supplier !== expense.description);
              return (
                <div key={expenseId} className="flex items-start justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ds-ink">{title}</p>
                    {showSupplier ? <p className="truncate text-xs text-ds-ink-muted">{expense?.supplier}</p> : null}
                    <p className="mt-0.5 text-xs text-ds-ink-2">{issues.map((issue) => expenseIssueLabel(issue, !isPersonnelExpense || canViewPersonnelCosts)).join(" · ")}</p>
                  </div>
                  {canIdentifyExpense && canEditExpenses ? (
                    <Button asChild variant="outline" size="sm" className="h-8 shrink-0">
                      <Link href={`${FINANCIAL_ROUTES.newExpense}?edit=${encodeURIComponent(expenseId)}`}>Corrigir <ExternalLink className="ml-1.5 h-3.5 w-3.5" /></Link>
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </>
      ),
    });
  }

  // ── render ───────────────────────────────────────────────────────────────────

  if (!permissions.financial?.dre) {
    return <FinancialAccessGuard title="DRE" description="Seu perfil não possui permissão para acessar o demonstrativo de resultado." />;
  }

  const exportDisabled = loading || Boolean(sourceError)
    || (viewMode !== "people" && !Number.isFinite(metrics.lucroLiq))
    || Boolean(stockCmvError && cmvCriterion === "stock_movement")
    || cmvIntegrityIssue
    || expenseContractIssues.length > 0;
  const isProvisional = sourceIssues.length > 0 || metrics.resultState.status !== "complete";
  const unitLabel = unitFilter !== "all" ? kioskNameById[unitFilter] ?? unitFilter : "Todas as unidades";
  const viewOptions: Array<{ value: typeof viewMode; label: string }> = [
    { value: "classic", label: "Clássica" },
    { value: "dashboard", label: "Painel" },
    ...(canViewPersonnelCosts ? [{ value: "people" as const, label: "Por colaborador" }] : []),
  ];
  const heroSelect = "h-9 w-auto min-w-44 gap-2 rounded-full border-white/10 bg-white/5 px-3.5 text-[13px] font-bold text-ds-on-dark";

  const cashCard = (
    <DreCashCard
      revenue={metrics.revBruta}
      shortage={metrics.cashShortage}
      surplus={metrics.cashSurplus}
      coveredDays={metrics.revenueSource.cashDifferenceCoveredDays}
      totalDays={metrics.revenueSource.cashDifferenceTotalDays}
      coverageComplete={metrics.revenueSource.cashDifferenceCoverage === "complete"}
      provisional={Boolean(metrics.revenueSource.cashDifferenceProvisional)}
    />
  );
  const cmvCard = (
    <DreCmvCard
      criterion={cmvCriterion}
      onCriterionChange={setCmvCriterion}
      compositionCmv={selectedCompositionCmv}
      stock={{
        loading: loadingStockCmv,
        error: stockCmvError,
        available: stockCmvAvailableForSelectedMonth,
        total: selectedStockBreakdown.totalCmv,
        consumption: selectedStockBreakdown.consumptionCmv,
        losses: selectedStockBreakdown.lossesCmv,
        adjustments: selectedStockBreakdown.adjustmentsCmv,
      }}
    >
      {cmvCriterion === "composition" && !sourceError ? (
        <CmvClosingPanel
          key={`${selectedMonth}:${unitFilter}`} entries={selectedCmvPeriods} month={selectedMonth}
          unitName={selectedKioskId ? (kioskNameById[selectedKioskId] ?? selectedKioskId) : null}
          capabilities={cmvCapabilities} disabled={loadingSource}
          onUpdated={() => setSourceReloadToken((current) => current + 1)}
        />
      ) : null}
    </DreCmvCard>
  );

  return (
    <PageContainer variant="wide" surface className="space-y-5">
      <PageHero
        kicker="Financeiro · Resultado"
        title="DRE"
        subtitle={`${unitLabel} · ${selectedMonthLabel}`}
        actions={(
          <>
            <Button variant="on-dark-icon" size="icon" aria-label="Atualizar DRE" title="Atualizar DRE" onClick={() => setSourceReloadToken((current) => current + 1)} disabled={loadingSource}>
              <RefreshCw className={cn("h-4 w-4", loadingSource && "animate-spin")} />
            </Button>
            <DreExportMenu month={selectedMonth} kioskIds={selectedKioskId ? [selectedKioskId] : kiosks.map(k => k.id)} disabled={loadingSource} />
            {(viewMode !== "people" || canExportPersonnelCosts) ? (
              <Button variant="on-dark-secondary" onClick={exportCsv} disabled={exportDisabled} title={exportDisabled ? "Exportação bloqueada enquanto houver pendências ou valores indisponíveis" : undefined}>
                <Download className="mr-2 h-4 w-4" /> CSV
              </Button>
            ) : null}
          </>
        )}
        chips={(
          <>
            <div className="inline-flex h-9 items-center gap-0.5 rounded-full bg-white/5 px-1 ring-1 ring-inset ring-white/10">
              <button type="button" aria-label="Mês anterior" className="grid h-7 w-7 place-items-center rounded-full text-ds-on-dark-2 hover:bg-white/10 disabled:opacity-40" onClick={() => navigateMonth(-1)} disabled={selectedMonth <= FINANCIAL_DRE_START_MONTH_KEY}>
                <ChevronLeft className="h-4 w-4" />
              </button>
              <input
                type="month"
                aria-label="Competência"
                min={FINANCIAL_DRE_START_MONTH_KEY}
                value={selectedMonth}
                onChange={(e) => e.target.value && setSelectedMonth(e.target.value < FINANCIAL_DRE_START_MONTH_KEY ? FINANCIAL_DRE_START_MONTH_KEY : e.target.value)}
                className="w-36 bg-transparent text-center text-[13px] font-bold text-ds-on-dark [color-scheme:dark] focus:outline-hidden"
              />
              <button type="button" aria-label="Próximo mês" className="grid h-7 w-7 place-items-center rounded-full text-ds-on-dark-2 hover:bg-white/10 disabled:opacity-40" onClick={() => navigateMonth(1)} disabled={isFutureMonth}>
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <Select value={unitFilter} onValueChange={setUnitFilter}>
              <SelectTrigger className={heroSelect} aria-label="Unidade"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as unidades</SelectItem>
                {kiosks.map((k) => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={cmvCriterion} onValueChange={(value) => setCmvCriterion(value as DreCmvCriterion)}>
              <SelectTrigger className={heroSelect} aria-label="Critério do CMV"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="composition">CMV pela composição</SelectItem>
                <SelectItem value="stock_movement">CMV pela movimentação</SelectItem>
              </SelectContent>
            </Select>
            <DreSourcesTrigger issues={sourceIssues} onOpen={() => setSourcesOpen(true)} />
            <div role="radiogroup" aria-label="Visualização" className="ml-auto inline-flex rounded-ds-md bg-white/8 p-[3px]">
              {viewOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={viewMode === option.value}
                  onClick={() => setViewMode(option.value)}
                  className={cn(
                    "h-8 whitespace-nowrap rounded-ds-sm px-3.5 text-[13px] font-bold transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-accent-kicker",
                    viewMode === option.value ? "bg-ds-on-dark text-ds-ink" : "text-ds-on-dark-2 hover:text-ds-on-dark",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </>
        )}
      />

      <DreSourcesPanel open={sourcesOpen} onOpenChange={setSourcesOpen} issues={sourceIssues} />

      {metrics.revenueSource.costOnlyUnit && <p className="rounded-ds-card border border-ds-border bg-ds-surface p-4 text-sm text-ds-ink-muted">Esta unidade não possui origem de vendas no PDV. Suas despesas continuam incluídas na DRE; receita e resultado isolado não são apurados neste filtro.</p>}
      {sourceError && <div role="alert" className="flex gap-3 rounded-ds-card border border-ds-confirm-border bg-ds-danger-bg p-4 text-sm text-ds-confirm-ink"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><span><strong>A DRE não pôde carregar todas as fontes.</strong> {sourceError} Os indicadores e a exportação não devem ser usados até a correção.</span></div>}

      {/* ── DRE CLÁSSICA ────────────────────────────────────────────────────── */}
      {!loading && !sourceError && viewMode !== "people" && metrics.resultState.status === "provisional" ? (
        <div role="status" className="rounded-ds-card border border-ds-alert-border bg-ds-warn-bg px-4 py-3 text-sm text-ds-alert-ink">
          <p className="font-semibold">Resultado provisório</p>
          <p className="mt-1">{metrics.resultState.reasons.join(" ")}</p>
          <Link href={stoneReceiptFlowHref("fees",undefined,undefined,{month:selectedMonth,kioskId:selectedKioskId})} className="mt-2 inline-block font-semibold underline">Conferir taxas pendentes e estimadas em Recebimentos → Taxas</Link>
        </div>
      ) : null}

      {viewMode === "classic" && (
        <>
          <section className="overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface" aria-labelledby="dre-statement-title">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ds-border px-5 py-4">
              <div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <h2 id="dre-statement-title" className="text-[17px] font-extrabold">Demonstrativo de resultado · {selectedMonthLabel}</h2>
                  {!loading && isProvisional ? <span className="rounded-full bg-ds-warn-bg px-2.5 py-0.5 text-[12px] font-bold text-ds-alert-ink">{metrics.resultState.status === "unavailable" ? "Indisponível" : "Provisório"}</span> : null}
                </div>
                <p className="text-[13px] text-ds-ink-muted">
                  {unitLabel} · competência · CMV {cmvCriterion === "stock_movement" ? "pela movimentação do estoque" : "pela composição"} · valores em R$
                  {!hasDreCategories && " · Mapeie os planos de contas nas configurações financeiras para categorizar automaticamente."}
                </p>
              </div>
            </div>
            {loading ? (
              <div className="space-y-2 p-6">{Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : (() => {
              type Kind = "cost" | "result";
              type Row =
                | { type: "section"; label: string }
                | { type: "line"; label: string; get: (m: DreMetrics) => number; kind: Kind; muted?: boolean; detailsKey?: string; waitingLabel?: string }
                | { type: "subtotal"; label: string; get: (m: DreMetrics) => number; final?: boolean };
              const either = (get: (m: DreMetrics) => number) => get(metrics) > 0 || (previousMetrics ? get(previousMetrics) > 0 : false);
              const rows: Row[] = [
                { type: "section", label: "Receita" },
                { type: "line", label: "Receita bruta (vendas integrais do PDV)", get: (m) => m.revBruta, kind: "result" },
                { type: "line", label: "(−) Impostos e deduções", get: (m) => m.impostos, kind: "cost", detailsKey: "impostos_deducoes" },
                { type: "subtotal", label: "= Receita líquida", get: (m) => m.recLiq },
                { type: "section", label: "Custo da mercadoria vendida" },
                ...(cmvCriterion === "stock_movement"
                  ? [
                      { type: "line" as const, label: "(−) Consumo pela movimentação de estoque", get: (m: DreMetrics) => m.stockCmvBreakdown.consumptionCmv, kind: "cost" as const },
                      ...(either((m) => m.stockCmvBreakdown.lossesCmv) ? [{ type: "line" as const, label: "(−) Perdas e descartes", get: (m: DreMetrics) => m.stockCmvBreakdown.lossesCmv, kind: "cost" as const }] : []),
                      ...(either((m) => m.stockCmvBreakdown.adjustmentsCmv) ? [{ type: "line" as const, label: "(−) Ajustes negativos de estoque", get: (m: DreMetrics) => m.stockCmvBreakdown.adjustmentsCmv, kind: "cost" as const }] : []),
                    ]
                  : [{ type: "line" as const, label: "(−) CMV pela composição (PDV + fichas)", get: (m: DreMetrics) => m.cmv, kind: "cost" as const }]),
                { type: "subtotal", label: "= Margem bruta", get: (m) => m.margBruta },
                { type: "section", label: "Custos variáveis" },
                { type: "line", label: "(−) Insumos e fretes de aquisição", get: (m) => m.custVar, kind: "cost", detailsKey: "custos_variaveis" },
                { type: "subtotal", label: "= Margem de contribuição", get: (m) => m.margContr },
                { type: "section", label: "Despesas operacionais" },
                { type: "line", label: "(−) Pessoal", get: (m) => m.pessoal, kind: "cost", detailsKey: "pessoal" },
                { type: "line", label: "(−) Despesas operacionais", get: (m) => m.despOp, kind: "cost", detailsKey: "despesas_operacionais" },
                { type: "line", label: "(−) Ocupação", get: (m) => m.ocupacao, kind: "cost", detailsKey: "ocupacao" },
                ...(either((m) => m.semCategoria) ? [{ type: "line" as const, label: "(−) Não classificado", get: (m: DreMetrics) => m.semCategoria, kind: "cost" as const, muted: true, detailsKey: "null" }] : []),
                { type: "line", label: "(−) Faltas de caixa", get: (m) => m.cashShortage, kind: "cost", waitingLabel: "Aguardando" },
                { type: "line", label: "(+) Sobras de caixa", get: (m) => m.cashSurplus, kind: "result", waitingLabel: "Aguardando" },
                { type: "subtotal", label: "= EBIT (resultado operacional)", get: (m) => m.resOp },
                { type: "section", label: "Resultado financeiro e impostos" },
                ...(either((m) => m.recFin) ? [{ type: "line" as const, label: "(+) Receita financeira", get: (m: DreMetrics) => m.recFin, kind: "result" as const, detailsKey: "receita_financeira" }] : []),
                { type: "line", label: "(−) Despesas financeiras", get: (m) => m.despFin, kind: "cost", detailsKey: "despesas_financeiras" },
                ...(either((m) => m.recNaoOp) ? [{ type: "line" as const, label: "(+) Receita não operacional", get: (m: DreMetrics) => m.recNaoOp, kind: "result" as const, detailsKey: "receita_nao_operacional" }] : []),
                ...(either((m) => m.despNaoOp) ? [{ type: "line" as const, label: "(−) Despesa não operacional", get: (m: DreMetrics) => m.despNaoOp, kind: "cost" as const, detailsKey: "despesa_nao_operacional" }] : []),
                { type: "subtotal", label: "= LAIR", get: (m) => m.lair },
                { type: "line", label: "(−) IR / CSLL", get: (m) => m.irCsll, kind: "cost", detailsKey: "impostos_resultado" },
                { type: "subtotal", label: "= Lucro líquido", get: (m) => m.lucroLiq, final: true },
              ];
              const amount = (value: number, negative: boolean) => (negative && value !== 0 ? `−${currency(Math.abs(value))}` : currency(value)).replace("R$", "").trim();
              const ah = (value: number, previous: number | null, kind: Kind) => {
                const variation = dreHorizontalVariation(value, previous);
                if (variation === null) return <span className="text-ds-ink-faint">—</span>;
                const tone = dreVariationTone(variation, kind);
                return (
                  <span className={cn(tone === "good" && "text-ds-ok", tone === "bad" && "text-ds-danger", tone === "neutral" && "text-ds-ink-muted")}>
                    {variation > 0 ? "+" : ""}{variation.toFixed(1).replace(".", ",")}
                  </span>
                );
              };
              const av = (value: number) => (Number.isFinite(value) && Number.isFinite(metrics.recLiq) && metrics.recLiq > 0 ? ((value / metrics.recLiq) * 100).toFixed(1).replace(".", ",") : "—");
              const previousLabel = previousMonthKey ? shortMonthLabel(previousMonthKey) : null;
              const cols = previousLabel ? 6 : 4;
              return (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead>
                      <tr className="border-b border-ds-border bg-ds-muted text-[11px] font-semibold uppercase tracking-wider text-ds-ink-muted">
                        <th className="w-10" aria-hidden />
                        <th className="py-2.5 pr-4 text-left">Conta</th>
                        <th className="px-4 py-2.5 text-right">{shortMonthLabel(selectedMonth)}</th>
                        <th className="px-4 py-2.5 text-right" title="Análise vertical: % da receita líquida">AV %</th>
                        {previousLabel ? <th className="px-4 py-2.5 text-right">{previousLabel}</th> : null}
                        {previousLabel ? <th className="px-4 py-2.5 pr-5 text-right" title={`Análise horizontal: variação contra ${previousLabel}`}>AH %</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) => {
                        if (row.type === "section") return (
                          <tr key={i}><td colSpan={cols} className="px-5 pb-1 pt-4 text-[10.5px] font-bold uppercase tracking-widest text-ds-ink-faint">{row.label}</td></tr>
                        );
                        const value = row.get(metrics);
                        const previous = previousMetrics ? row.get(previousMetrics) : null;
                        if (row.type === "subtotal") {
                          const finalRow = row.final;
                          const pending = !Number.isFinite(value);
                          return (
                            <tr key={i} className={cn("border-b border-ds-divider font-bold", finalRow ? "bg-ds-dark text-ds-on-dark" : "bg-ds-muted")}>
                              <td />
                              <td className="py-3 pr-4">{row.label}</td>
                              <td className={cn("px-4 py-3 text-right font-ds-mono", pending ? (finalRow ? "text-ds-warn" : "text-ds-alert-ink") : value < 0 && !finalRow ? "text-ds-danger" : "")}>{pending ? "Pendente" : amount(value, false)}</td>
                              <td className="px-4 py-3 text-right font-ds-mono text-[13px]">{av(value)}</td>
                              {previousLabel ? <td className={cn("px-4 py-3 text-right font-ds-mono text-[13px]", finalRow ? "text-ds-on-dark-sub" : "text-ds-ink-muted")}>{previous !== null && Number.isFinite(previous) ? amount(previous, false) : "—"}</td> : null}
                              {previousLabel ? <td className="px-4 py-3 pr-5 text-right font-ds-mono text-[13px]">{ah(value, previous, "result")}</td> : null}
                            </tr>
                          );
                        }
                        const negative = row.label.startsWith("(−)");
                        const waiting = !Number.isFinite(value);
                        const detailsKey = row.detailsKey;
                        const details = detailsKey ? metrics.expenseDetailsByPosition[detailsKey] ?? [] : [];
                        const accountGroups = groupDreExpenseDetailsByAccount(details);
                        const expenseCount = new Set(details.map((detail) => detail.expenseId)).size;
                        const canExpandDetails = expenseCount > 0 && canViewExpenseDetails && (detailsKey !== "pessoal" || canViewPersonnelCosts);
                        const isExpanded = Boolean(detailsKey && expandedDreRows[detailsKey] && canExpandDetails);
                        const detailRegionId = detailsKey ? `dre-expense-details-${detailsKey}` : undefined;
                        return (
                          <Fragment key={i}>
                            <tr className={cn("border-b border-ds-divider transition-colors hover:bg-ds-warm", row.muted && "opacity-60", isExpanded && "bg-ds-accent-soft")}>
                              <td className="pl-3">
                                {canExpandDetails && detailsKey ? (
                                  <button
                                    type="button"
                                    className="grid h-7 w-7 place-items-center rounded-ds-sm text-ds-ink-muted hover:bg-ds-muted hover:text-ds-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-accent-ink"
                                    aria-expanded={isExpanded}
                                    aria-controls={detailRegionId}
                                    aria-label={`${isExpanded ? "Recolher" : "Expandir"} ${row.label}`}
                                    onClick={() => setExpandedDreRows((current) => ({ ...current, [detailsKey]: !current[detailsKey] }))}
                                  >
                                    <ChevronDown className={cn("h-4 w-4 transition-transform", !isExpanded && "-rotate-90")} />
                                  </button>
                                ) : null}
                              </td>
                              <td className="py-2.5 pr-4 pl-3 text-ds-ink-2">
                                <span className={cn(isExpanded && "font-semibold text-ds-accent-ink")}>{row.label}</span>
                                {canExpandDetails ? <span className="ml-2 rounded-full bg-ds-muted px-2 py-0.5 text-[10.5px] font-medium text-ds-ink-muted">{expenseCount} {expenseCount === 1 ? "despesa" : "despesas"}</span> : null}
                              </td>
                              <td className={cn("px-4 py-2.5 text-right font-ds-mono text-[13px]", waiting && "text-ds-ink-muted")}>{waiting ? row.waitingLabel ?? "Indisponível" : amount(value, negative)}</td>
                              <td className="px-4 py-2.5 text-right font-ds-mono text-[13px] text-ds-ink-muted">{av(value)}</td>
                              {previousLabel ? <td className="px-4 py-2.5 text-right font-ds-mono text-[13px] text-ds-ink-muted">{previous !== null && Number.isFinite(previous) ? amount(previous, negative) : "—"}</td> : null}
                              {previousLabel ? <td className="px-4 py-2.5 pr-5 text-right font-ds-mono text-[13px]">{ah(value, previous, row.kind)}</td> : null}
                            </tr>
                            {isExpanded ? (
                              <tr className="border-b border-ds-divider bg-ds-warm">
                                <td colSpan={cols} className="px-5 py-4 pl-12">
                                  <div id={detailRegionId} role="region" aria-label={`Lançamentos de ${row.label}`} className="overflow-hidden rounded-ds-md border border-ds-border bg-ds-surface">
                                    <Accordion type="multiple">
                                      {accountGroups.map((group) => (
                                        <AccordionItem key={group.accountPlanId} value={`${detailsKey}:${group.accountPlanId}`} className="last:border-b-0">
                                          <AccordionTrigger className="gap-3 bg-ds-muted px-4 py-3 text-left hover:no-underline">
                                            <span className="flex min-w-0 flex-1 items-center justify-between gap-3 pr-1">
                                              <span className="min-w-0">
                                                <span className="block truncate text-sm font-semibold text-ds-ink">{group.accountPlanName}</span>
                                                <span className="mt-0.5 block text-[10.5px] font-normal text-ds-ink-muted">{group.expenses.length} {group.expenses.length === 1 ? "despesa" : "despesas"}</span>
                                              </span>
                                              <span className="whitespace-nowrap font-ds-mono text-xs font-semibold text-ds-ink">{currency(group.totalAmount)}</span>
                                            </span>
                                          </AccordionTrigger>
                                          <AccordionContent className="border-t border-ds-divider pb-0">
                                            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-ds-divider bg-ds-warm px-4 py-2 text-[10.5px] font-semibold uppercase tracking-wider text-ds-ink-muted">
                                              <span>Despesa</span>
                                              <span className="text-right">Valor nesta linha</span>
                                            </div>
                                            <div className="divide-y divide-ds-divider">
                                              {group.expenses.map((detail) => {
                                                const title = detail.description || detail.supplier || "Despesa sem descrição";
                                                const showSupplier = Boolean(detail.description && detail.supplier && detail.supplier !== detail.description);
                                                const references = dreExpenseDetailReferences(detail);
                                                return (
                                                  <div key={detail.expenseId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3">
                                                    <div className="min-w-0">
                                                      <p className="truncate font-medium text-ds-ink">{title}</p>
                                                      {showSupplier ? <p className="truncate text-xs text-ds-ink-muted">{detail.supplier}</p> : null}
                                                      {references.length > 0 ? <p className="mt-0.5 truncate text-xs text-ds-ink-muted">{references.join(" · ")}</p> : null}
                                                    </div>
                                                    <div className="flex items-center justify-end gap-2">
                                                      <span className="whitespace-nowrap font-ds-mono text-xs font-semibold">{currency(detail.amount)}</span>
                                                      {canEditExpenses ? (
                                                        <Button asChild variant="ghost" size="icon" className="h-7 w-7 shrink-0" title="Abrir despesa">
                                                          <Link href={`${FINANCIAL_ROUTES.newExpense}?edit=${encodeURIComponent(detail.expenseId)}`}>
                                                            <ExternalLink className="h-3.5 w-3.5" />
                                                            <span className="sr-only">Abrir {title}</span>
                                                          </Link>
                                                        </Button>
                                                      ) : null}
                                                    </div>
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          </AccordionContent>
                                        </AccordionItem>
                                      ))}
                                    </Accordion>
                                  </div>
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-ds-border bg-ds-warm px-5 py-3 text-[12.5px] text-ds-ink-2">
                    <span><strong>AV</strong> = % da receita líquida</span>
                    {previousLabel ? <span><strong>AH</strong> = variação contra {previousLabel}</span> : null}
                    <span>Ponto de equilíbrio: <strong className="font-ds-mono">{formatCurrency(metrics.pe)}</strong></span>
                    {!Number.isFinite(metrics.lucroLiq) ? <span>Valores aguardando conferência não são zero: os subtotais dependentes ficam pendentes e a exportação é bloqueada.</span> : null}
                  </div>
                </div>
              );
            })()}
          </section>
          {!loading && !sourceError ? <div className="grid gap-4 lg:grid-cols-2">{cashCard}{cmvCard}</div> : null}
        </>
      )}

      {/* ── PAINEL ──────────────────────────────────────────────────────────── */}
      {viewMode === "dashboard" && (() => {
        const variationText = (value: number, previous: number | null | undefined) => {
          const variation = dreHorizontalVariation(value, previous ?? null);
          return variation === null ? null : `${variation > 0 ? "+" : ""}${variation.toFixed(1).replace(".", ",")}% vs ${previousMonthKey ? shortMonthLabel(previousMonthKey) : "mês anterior"}`;
        };
        const tiles: Array<{ label: string; value: string; sub: string | null; dark?: boolean; pending?: boolean; netRevenueInfo?: boolean }> = [
          { label: "Receita líquida", value: Number.isFinite(metrics.recLiq) ? currency(metrics.recLiq) : "Indisponível", sub: variationText(metrics.recLiq, previousMetrics?.recLiq), netRevenueInfo: true },
          { label: cmvCriterion === "stock_movement" ? "CMV (movimentação)" : "CMV (composição)", value: pct(metrics.cmv, metrics.recLiq), sub: Number.isFinite(metrics.cmv) ? currency(metrics.cmv) : "Indisponível" },
          { label: "Margem bruta", value: pct(metrics.margBruta, metrics.recLiq), sub: Number.isFinite(metrics.margBruta) ? currency(metrics.margBruta) : null },
          { label: "Margem de contribuição", value: pct(metrics.margContr, metrics.recLiq), sub: Number.isFinite(metrics.margContr) ? currency(metrics.margContr) : null },
          { label: "Ponto de equilíbrio", value: formatCurrency(metrics.pe), sub: "custos fixos ÷ margem de contribuição" },
          Number.isFinite(metrics.lucroLiq)
            ? { label: "Lucro líquido", value: currency(metrics.lucroLiq), sub: `${metrics.resultState.status === "provisional" ? "Provisório · " : ""}${pct(metrics.lucroLiq, metrics.recLiq)} da receita líquida`, dark: true }
            : { label: "Lucro líquido", value: "Pendente", sub: "falta conferir as fontes", dark: true, pending: true },
        ];
        const composition = dreRevenueComposition(metrics.recLiq, [
          { key: "cmv", label: "CMV", value: metrics.cmv },
          { key: "pessoal", label: "Pessoal", value: metrics.pessoal },
          { key: "ocupacao", label: "Ocupação", value: metrics.ocupacao },
          { key: "despOp", label: "Despesas operacionais", value: metrics.despOp + metrics.semCategoria },
          { key: "custVar", label: "Insumos e fretes", value: metrics.custVar },
          { key: "outros", label: "Financeiro, caixa e IR", value: Math.max(0, metrics.despFin + metrics.despNaoOp + metrics.irCsll + metrics.cashShortage - metrics.cashSurplus - metrics.recFin - metrics.recNaoOp) },
        ]);
        const sliceClass: Record<string, string> = {
          cmv: "bg-ds-ink", pessoal: "bg-ds-accent", ocupacao: "bg-ds-accent-ink", despOp: "bg-ds-ink-faint", custVar: "bg-ds-border-input", outros: "bg-ds-seg", remainder: "bg-ds-ok",
        };
        const maxPlan = Math.max(...topExpensePlans.map((row) => row.value), 1);
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
              {loading ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-ds-card" />) : tiles.map((tile) => (
                <div key={tile.label} className={cn("rounded-ds-card border p-4", tile.dark ? "border-ds-dark bg-ds-dark text-ds-on-dark" : "border-ds-border bg-ds-surface")}>
                  <div className="flex min-h-6 items-center gap-1">
                    <p className={cn("text-[11px] font-semibold uppercase tracking-wider", tile.dark ? "text-ds-on-dark-muted" : "text-ds-ink-muted")}>{tile.label}</p>
                    {tile.netRevenueInfo ? <NetRevenueInfo gross={metrics.revBruta} deductions={metrics.impostos} net={metrics.recLiq} /> : null}
                  </div>
                  <p className={cn("mt-1.5 font-ds-mono text-[21px] font-bold", tile.pending && "text-ds-warn")}>{tile.value}</p>
                  {tile.sub ? <p className={cn("mt-0.5 text-[12px]", tile.dark ? "text-ds-on-dark-2" : "text-ds-ink-muted")}>{tile.sub}</p> : null}
                </div>
              ))}
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
              <DreChartExplorer
                loading={loading}
                unitLabel={unitLabel}
                monthLabel={shortMonthLabel(selectedMonth)}
                previousMonthLabel={previousMonthKey ? shortMonthLabel(previousMonthKey) : null}
                cmvLabel={cmvCriterion === "stock_movement" ? "CMV estoque" : "CMV composição"}
                allUnits={unitFilter === "all"}
                months={chartData}
                waterfall={dreWaterfallSteps(metrics)}
                units={chartUnits}
                expensePlans={topExpensePlans}
                breakEven={dreBreakEvenSeries({
                  monthKey: selectedMonth,
                  dailyRevenue: dailySales.total,
                  margContr: metrics.margContr,
                  totalFixos: metrics.totalFixos,
                })}
                comparison={previousMetrics ? dreMonthComparison(metrics, previousMetrics) : null}
                daily={dailySales}
              />

              <section className="flex flex-col gap-3 rounded-ds-card border border-ds-border bg-ds-surface p-5" aria-labelledby="dre-composition-title">
                <div>
                  <h2 id="dre-composition-title" className="text-[15px] font-extrabold">Para onde vai cada R$ 100 vendidos</h2>
                  <p className="text-[12.5px] text-ds-ink-muted">% da receita líquida · {selectedMonthLabel}</p>
                </div>
                {composition ? (
                  <>
                    <div className="flex h-8 overflow-hidden rounded-ds-sm" role="img" aria-label={composition.map((slice) => `${slice.label} ${slice.share.toFixed(1)}%`).join(", ")}>
                      {composition.map((slice) => <span key={slice.key} className={cn("h-full", slice.key === "remainder" && slice.value < 0 ? "bg-ds-danger" : sliceClass[slice.key])} style={{ width: `${Math.min(slice.share, 100)}%` }} />)}
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12.5px] text-ds-ink-2">
                      {composition.map((slice) => (
                        <span key={slice.key} className={cn("flex items-center gap-1.5", slice.key === "remainder" && (slice.value >= 0 ? "font-bold text-ds-ok" : "font-bold text-ds-danger"))}>
                          <span className={cn("h-2.5 w-2.5 shrink-0 rounded-[3px]", slice.key === "remainder" && slice.value < 0 ? "bg-ds-danger" : sliceClass[slice.key])} />
                          {slice.label}
                          <span className="ml-auto font-ds-mono">{slice.share.toFixed(1).replace(".", ",")}</span>
                        </span>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="rounded-ds-md border border-dashed border-ds-border-input bg-ds-input p-3 text-[13px] text-ds-ink-muted">Disponível quando todas as fontes do mês estiverem conferidas.</p>
                )}
                <div className="mt-1 border-t border-ds-divider pt-3">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ds-ink-muted">Maiores planos de despesa</p>
                  {topExpensePlans.length === 0 ? <p className="text-[13px] text-ds-ink-muted">Nenhuma despesa no mês.</p> : (
                    <div className="flex flex-col gap-2">
                      {topExpensePlans.map((row) => (
                        <div key={row.name} className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)_auto] items-center gap-2.5 text-[13px]">
                          <span className="truncate">{row.name}</span>
                          <span className="h-3 overflow-hidden rounded-[3px] bg-ds-muted"><span className="block h-full rounded-[3px] bg-ds-accent" style={{ width: `${(row.value / maxPlan) * 100}%` }} /></span>
                          <span className="font-ds-mono text-[12.5px]">{currency(row.value)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </div>

            {unitFilter === "all" && cmvByUnit.length > 0 ? (
              <section className="rounded-ds-card border border-ds-border bg-ds-surface p-5" aria-labelledby="dre-cmv-unit-title">
                <h2 id="dre-cmv-unit-title" className="text-[15px] font-extrabold">CMV por unidade</h2>
                <p className="text-[12.5px] text-ds-ink-muted">{cmvCriterion === "stock_movement" ? "Consumo, perdas e ajustes negativos valorizados na data de cada saída" : "PDV + composição dos produtos"} · {selectedMonthLabel}</p>
                <div className="mt-3 grid gap-x-6 gap-y-3 md:grid-cols-2 xl:grid-cols-3">
                  {cmvByUnit.map((row) => (
                    <div key={row.kioskId}>
                      <div className="flex items-baseline justify-between gap-2 text-[13px]">
                        <span className="truncate font-semibold">{row.name}</span>
                        <span className="font-ds-mono">{currency(row.cmv)}</span>
                      </div>
                      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ds-muted"><div className="h-full rounded-full bg-ds-ink" style={{ width: `${metrics.cmv > 0 ? (row.cmv / metrics.cmv) * 100 : 0}%` }} /></div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {!loading && !sourceError ? <div className="grid gap-4 lg:grid-cols-2">{cmvCard}{cashCard}</div> : null}
          </>
        );
      })()}

      {viewMode === "people" && canViewPersonnelCosts && (
        <DrePeopleView
          analysis={personAnalysis}
          drePersonnelTotal={metrics.pessoal}
          loading={loading}
          monthLabel={selectedMonthLabel}
          unitLabel={selectedUnitName || "Todas as unidades"}
        />
      )}
    </PageContainer>
  );
}
