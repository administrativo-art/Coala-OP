"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, Download, ExternalLink, LayoutDashboard, RefreshCw, Table2, UsersRound } from "lucide-react";
import { addMonths, format, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { FinancialAccessGuard } from "@/features/financial/components/financial-access-guard";
import { FINANCIAL_DRE_START_MONTH_KEY, FINANCIAL_ROUTES } from "@/features/financial/lib/constants";
import { financialCollection } from "@/features/financial/lib/repositories";
import { formatCurrency } from "@/features/financial/lib/utils";
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
import { DrePeopleView } from "@/features/financial/components/dre/dre-people-view";
import { useFinancialCollection } from "@/features/financial/hooks/use-financial-collection";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useKiosks } from "@/hooks/use-kiosks";
import type { CashClosureMonthlySummary } from "@/features/financial/cash-closures/types";
import type { DreSalesUnitMonthSummary, DreSourceDataPayload } from "@/features/financial/dre/source-data";
import type {
  DreCmvCriterion,
  DreStockCmvPayload,
} from "@/features/financial/dre/stock-cmv";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

// ── helpers ──────────────────────────────────────────────────────────────────

function pct(value: number, base: number) {
  if (base <= 0) return "—";
  return `${((value / base) * 100).toFixed(1)}%`;
}

function KpiCard({ label, value, sub, color = "" }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl border bg-background p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`mt-1 font-mono text-xl font-bold ${color}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
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
  const [viewMode, setViewMode] = useState<"dashboard" | "classic" | "people">("dashboard");
  const [expandedDreRows, setExpandedDreRows] = useState<Record<string, boolean>>({});
  const canViewPersonnelCosts = permissions.financial?.personnelCosts?.view === true;
  const canExportPersonnelCosts = canViewPersonnelCosts && permissions.financial?.personnelCosts?.export === true;
  const canViewExpenseDetails = permissions.financial?.expenses?.view === true;
  const canEditExpenses = permissions.financial?.expenses?.create === true
    && permissions.financial?.expenses?.edit === true;

  useEffect(() => {
    if (!canViewPersonnelCosts && viewMode === "people") setViewMode("dashboard");
  }, [canViewPersonnelCosts, viewMode]);

  const { data: accounts, loading: loadingAccounts } = useFinancialCollection<any>(financialCollection("accounts"));
  const { data: resultCenters, loading: loadingResultCenters } = useFinancialCollection<any>(financialCollection("resultCenters"));

  const [expenses, setExpenses] = useState<FinancialExpenseDreDocument[]>([]);
  const [salesSummaries, setSalesSummaries] = useState<DreSalesUnitMonthSummary[]>([]);
  const [closureRevenueSummaries, setClosureRevenueSummaries] = useState<CashClosureMonthlySummary[]>([]);
  const [missingSimulationIds, setMissingSimulationIds] = useState<string[]>([]);
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
      setClosureRevenueSummaries((payload.closureSummaries ?? []) as CashClosureMonthlySummary[]);
      setExpenses(payload.expenses ?? []);
      setMissingSimulationIds(payload.missingSimulationIds ?? []);
    }).catch((error) => {
      if (cancelled) return;
      setSalesSummaries([]);
      setClosureRevenueSummaries([]);
      setExpenses([]);
      setMissingSimulationIds([]);
      setSourceError(error instanceof Error ? error.message : "Falha ao carregar as fontes da DRE.");
    }).finally(() => {
      if (!cancelled) setLoadingSource(false);
    });
    return () => { cancelled = true; };
  }, [api, firebaseUser, kiosks, permissions.financial?.dre, selectedMonth, sourceReloadToken]);

  useEffect(() => {
    if (cmvCriterion !== "stock_movement") return;
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
  }, [api, cmvCriterion, firebaseUser, kiosks, permissions.financial?.dre, selectedMonth, sourceReloadToken]);

  const loading = loadingAccounts
    || loadingResultCenters
    || loadingSource
    || (cmvCriterion === "stock_movement" && loadingStockCmv);

  if (!permissions.financial?.dre) {
    return <FinancialAccessGuard title="DRE" description="Seu perfil não possui permissão para acessar o demonstrativo de resultado." />;
  }

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
  const closureRevenueByUnitMonth = useMemo(() => new Map(closureRevenueSummaries.map((summary) => [
    `${summary.kioskId}:${summary.year}-${String(summary.month).padStart(2, "0")}`,
    (summary.dreRevenueTotalCents ?? summary.expectedTotalCents + summary.differenceTotalCents) / 100,
  ])), [closureRevenueSummaries]);
  const salesByUnitMonth = useMemo(() => new Map(salesSummaries.map((summary) => [
    `${summary.kioskId}:${summary.year}-${String(summary.month).padStart(2, "0")}`,
    summary,
  ])), [salesSummaries]);
  const stockCmvByUnitMonth = useMemo(() => new Map((stockCmvPayload?.stockSummaries ?? []).map((summary) => [
    `${summary.kioskId}:${summary.year}-${String(summary.month).padStart(2, "0")}`,
    summary,
  ])), [stockCmvPayload]);

  // ── computation helpers ─────────────────────────────────────────────────────

  function getRevenue(monthKey: string): number {
    const unitIds = selectedKioskId
      ? [selectedKioskId]
      : Array.from(new Set([...kiosks.map((kiosk) => kiosk.id), ...salesSummaries.map((summary) => summary.kioskId)]));
    return unitIds.reduce((total, kioskId) => {
      const countedRevenue = closureRevenueByUnitMonth.get(`${kioskId}:${monthKey}`);
      if (countedRevenue !== undefined) return total + countedRevenue;
      return total + (salesByUnitMonth.get(`${kioskId}:${monthKey}`)?.revenue ?? 0);
    }, 0);
  }

  function getCompositionCmv(monthKey: string): number {
    const [y, m] = monthKey.split("-").map(Number);
    return salesSummaries.reduce((sum, summary) => {
      if (summary.year !== y || summary.month !== m) return sum;
      if (selectedKioskId && summary.kioskId !== selectedKioskId) return sum;
      return sum + summary.cmv;
    }, 0);
  }

  function getStockCmvBreakdown(monthKey: string) {
    const empty = {
      consumptionCmv: 0,
      lossesCmv: 0,
      adjustmentsCmv: 0,
      totalCmv: 0,
      movementCount: 0,
      unpricedMovementCount: 0,
      movementDays: 0,
    };
    const unitIds = selectedKioskId
      ? [selectedKioskId]
      : Array.from(new Set([
          ...kiosks.map((kiosk) => kiosk.id),
          ...(stockCmvPayload?.stockSummaries ?? []).map((summary) => summary.kioskId),
        ]));
    return unitIds.reduce((total, kioskId) => {
      const summary = stockCmvByUnitMonth.get(`${kioskId}:${monthKey}`);
      if (!summary) return total;
      total.consumptionCmv += summary.consumptionCmv;
      total.lossesCmv += summary.lossesCmv;
      total.adjustmentsCmv += summary.adjustmentsCmv;
      total.totalCmv += summary.totalCmv;
      total.movementCount += summary.movementCount;
      total.unpricedMovementCount += summary.unpricedMovementCount;
      total.movementDays = Math.max(total.movementDays, summary.movementDays);
      return total;
    }, empty);
  }

  function getDreMetrics(monthKey: string) {
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
          resultCenter: selectedUnitName,
          resultCenterNames: resultCenterNameMap,
        });
    const expenseAt = (position: string | null) => expenseCalculation.totalsByPosition[position ?? "null"] ?? 0;
    const revBruta = getRevenue(monthKey);
    const impostos = expenseAt("impostos_deducoes");
    const recLiq = revBruta - impostos;

    const stockCmvBreakdown = getStockCmvBreakdown(monthKey);
    const cmv = cmvCriterion === "stock_movement"
      ? stockCmvBreakdown.totalCmv
      : getCompositionCmv(monthKey);
    const margBruta = recLiq - cmv;

    const custVar = expenseAt("custos_variaveis");
    const margContr = margBruta - custVar;

    const pessoal = expenseAt("pessoal");
    const despOp = expenseAt("despesas_operacionais");
    const ocupacao = expenseAt("ocupacao");
    const semCategoria = expenseAt(null);
    const totalFixos = pessoal + despOp + ocupacao + semCategoria;
    const resOp = margContr - totalFixos;

    const recFin = expenseAt("receita_financeira");
    const despFin = expenseAt("despesas_financeiras");
    const recNaoOp = expenseAt("receita_nao_operacional");
    const despNaoOp = expenseAt("despesa_nao_operacional");
    const lair = resOp + recFin - despFin + recNaoOp - despNaoOp;
    const irCsll = expenseAt("impostos_resultado");
    const lucroLiq = lair - irCsll;

    const margContPct = recLiq > 0 ? margContr / recLiq : 0;
    const pe = margContPct > 0 ? totalFixos / margContPct : 0;

    return {
      revBruta,
      impostos,
      recLiq,
      cmv,
      stockCmvBreakdown,
      custVar,
      margBruta,
      margContr,
      pessoal,
      despOp,
      ocupacao,
      semCategoria,
      totalFixos,
      resOp,
      recFin,
      despFin,
      recNaoOp,
      despNaoOp,
      lair,
      irCsll,
      lucroLiq,
      pe,
      margContPct,
      expenseDetailsByPosition: expenseCalculation.detailsByPosition,
      expenseIssues: expenseCalculation.issues,
    };
  }

  // ── per-month data ───────────────────────────────────────────────────────────

  const chartMonthKeys = useMemo(() => {
    const [y, m] = selectedMonth.split("-").map(Number);
    const end = new Date(y, m - 1, 1);
    return Array.from({ length: 6 }, (_, i) => format(subMonths(end, 5 - i), "yyyy-MM"))
      .filter((key) => key >= FINANCIAL_DRE_START_MONTH_KEY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth]);

  const chartData = useMemo(() => {
    return chartMonthKeys.map((key) => {
      const { revBruta, cmv, margBruta, margContr, resOp, lucroLiq, totalFixos } = getDreMetrics(key);
      const [y, m] = key.split("-").map(Number);
      return {
        month: format(new Date(y, m - 1, 1), "MMM/yy", { locale: ptBR }),
        receita: revBruta,
        cmv,
        margBruta,
        despesas: totalFixos,
        resultado: lucroLiq,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, chartMonthKeys, closureRevenueByUnitMonth, cmvCriterion, expenses, kiosks, resultCenterNameMap, salesByUnitMonth, salesSummaries, selectedUnitName, selectedKioskId, stockCmvByUnitMonth, stockCmvPayload]);

  const metrics = useMemo(
    () => getDreMetrics(selectedMonth),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accounts, selectedMonth, closureRevenueByUnitMonth, cmvCriterion, expenses, kiosks, resultCenterNameMap, salesByUnitMonth, salesSummaries, selectedUnitName, selectedKioskId, stockCmvByUnitMonth, stockCmvPayload]
  );
  const stockValuationIssueCount = (stockCmvPayload?.missingProductIds.length ?? 0)
    + (stockCmvPayload?.missingBaseProductIds.length ?? 0)
    + (stockCmvPayload?.unpricedBaseProductIds.length ?? 0);
  const stockUnpricedMovementCount = (stockCmvPayload?.stockSummaries ?? [])
    .reduce((total, summary) => total + summary.unpricedMovementCount, 0);
  const stockCmvAvailableForSelectedMonth = stockCmvPayload?.periods.includes(selectedMonth) === true;
  const selectedStockBreakdown = metrics.stockCmvBreakdown;
  const selectedCompositionCmv = getCompositionCmv(selectedMonth);
  const selectedStockCmvDifference = selectedStockBreakdown.totalCmv - selectedCompositionCmv;
  const selectedStockHasNoMovements = cmvCriterion === "stock_movement"
    && !loadingStockCmv
    && !stockCmvError
    && selectedStockBreakdown.movementCount === 0;
  const cmvIntegrityIssue = cmvCriterion === "composition"
    ? missingSimulationIds.length > 0
    : stockValuationIssueCount > 0 || selectedStockHasNoMovements;
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
          .map((summary) => ({ kioskId: summary.kioskId, cmv: summary.totalCmv }))
      : salesSummaries
          .filter((summary) => summary.year === y && summary.month === m && summary.cmv > 0)
          .map((summary) => ({ kioskId: summary.kioskId, cmv: summary.cmv }));
    return summaries
      .map((summary) => ({ ...summary, name: kioskNameById[summary.kioskId] || summary.kioskId }))
      .sort((left, right) => right.cmv - left.cmv);
  }, [cmvCriterion, salesSummaries, selectedMonth, kioskNameById, stockCmvPayload]);

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
          ["(-) CMV pela composição", formatCurrency(cmv), pct(cmv, recLiq)],
        ];
    const rows = [
      ["DRE —", selectedMonthLabel, unitFilter === "all" ? "Todas as unidades" : (kioskNameById[unitFilter] ?? unitFilter)],
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

  // ── render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">DRE</h1>
          <p className="text-muted-foreground">Demonstrativo gerencial com comparação do CMV por composição ou movimentação de estoque.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Month nav */}
          <div className="flex items-center gap-1 rounded-xl border bg-background px-1 shadow-sm">
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => navigateMonth(-1)} disabled={selectedMonth <= FINANCIAL_DRE_START_MONTH_KEY}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <input
              type="month"
              min={FINANCIAL_DRE_START_MONTH_KEY}
              value={selectedMonth}
              onChange={(e) => e.target.value && setSelectedMonth(e.target.value < FINANCIAL_DRE_START_MONTH_KEY ? FINANCIAL_DRE_START_MONTH_KEY : e.target.value)}
              className="w-36 bg-transparent py-1.5 text-center text-sm font-medium focus:outline-none"
            />
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => navigateMonth(1)} disabled={isFutureMonth}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {/* Unit filter */}
          <Select value={unitFilter} onValueChange={setUnitFilter}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as unidades</SelectItem>
              {kiosks.map((k) => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={cmvCriterion} onValueChange={(value) => setCmvCriterion(value as DreCmvCriterion)}>
            <SelectTrigger className="w-56" aria-label="Critério do CMV">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="composition">CMV pela composição</SelectItem>
              <SelectItem value="stock_movement">CMV pela movimentação</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="icon"
            aria-label="Atualizar DRE"
            title="Atualizar DRE"
            onClick={() => setSourceReloadToken((current) => current + 1)}
            disabled={loadingSource}
          >
            <RefreshCw className={`h-4 w-4 ${loadingSource ? "animate-spin" : ""}`} />
          </Button>

          {/* View toggle */}
          <div className="flex rounded-xl border bg-background p-1 shadow-sm">
            <button type="button" onClick={() => setViewMode("dashboard")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === "dashboard" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              <LayoutDashboard className="h-3.5 w-3.5" /> Resumo
            </button>
            <button type="button" onClick={() => setViewMode("classic")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === "classic" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              <Table2 className="h-3.5 w-3.5" /> DRE Clássica
            </button>
            {canViewPersonnelCosts ? (
              <button type="button" onClick={() => setViewMode("people")}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === "people" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                <UsersRound className="h-3.5 w-3.5" /> Por colaborador
              </button>
            ) : null}
          </div>

          {(viewMode !== "people" || canExportPersonnelCosts) ? (
            <Button
              variant="outline"
              onClick={exportCsv}
              disabled={Boolean(sourceError)
                || Boolean(stockCmvError && cmvCriterion === "stock_movement")
                || cmvIntegrityIssue
                || expenseContractIssues.length > 0}
            >
              <Download className="mr-2 h-4 w-4" /> Exportar
            </Button>
          ) : null}
        </div>
      </div>

      {sourceError && <div className="flex gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><span><strong>A DRE não pôde carregar todas as fontes.</strong> {sourceError} Os indicadores e a exportação não devem ser usados até a correção.</span></div>}
      {!sourceError && cmvCriterion === "composition" && missingSimulationIds.length > 0 && <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><span><strong>CMV incompleto.</strong> {missingSimulationIds.length} ficha(s) referenciada(s) pelas vendas não foram encontradas. A exportação foi bloqueada; exemplos: {missingSimulationIds.slice(0, 5).join(", ")}.</span></div>}
      {!sourceError && cmvCriterion === "stock_movement" && stockCmvError && (
        <div className="flex gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <span><strong>O CMV por movimentação não pôde ser calculado.</strong> {stockCmvError}</span>
        </div>
      )}
      {!sourceError && cmvCriterion === "stock_movement" && !stockCmvError && stockValuationIssueCount > 0 && (
        <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <span>
            <strong>Valorização do estoque incompleta.</strong>{" "}
            {stockUnpricedMovementCount} movimentação(ões) dos últimos seis meses ficaram sem custo
            {selectedStockBreakdown.unpricedMovementCount > 0
              ? `; ${selectedStockBreakdown.unpricedMovementCount} estão no filtro atual`
              : ""}.
            A exportação foi bloqueada até a correção dos cadastros.
          </span>
        </div>
      )}
      {!sourceError && selectedStockHasNoMovements && (
        <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <span><strong>Não há saídas de estoque no filtro atual.</strong> O CMV por movimentação ficou zerado e a exportação foi bloqueada.</span>
        </div>
      )}

      <div className="rounded-xl border bg-background p-4 shadow-sm">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <p className="text-sm font-semibold">Critério dos insumos na DRE</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {cmvCriterion === "composition"
                ? "A DRE usa as vendas multiplicadas pelo custo salvo nas fichas de composição."
                : "A DRE usa consumo, perdas e ajustes negativos registrados no estoque. Transferências e movimentos estornados não entram."}
            </p>
          </div>
          <div className="grid min-w-0 gap-3 sm:grid-cols-3 lg:min-w-[560px]">
            <div className="rounded-lg bg-muted/40 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Composição</p>
              <p className="mt-0.5 font-mono text-sm font-bold">{formatCurrency(selectedCompositionCmv)}</p>
            </div>
            <div className="rounded-lg bg-muted/40 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Movimentação</p>
              <p className="mt-0.5 font-mono text-sm font-bold">
                {loadingStockCmv && cmvCriterion === "stock_movement"
                  ? "Calculando…"
                  : stockCmvAvailableForSelectedMonth ? formatCurrency(selectedStockBreakdown.totalCmv) : "Selecione para calcular"}
              </p>
            </div>
            <div className="rounded-lg bg-muted/40 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Diferença</p>
              <p className={`mt-0.5 font-mono text-sm font-bold ${selectedStockCmvDifference > 0 ? "text-rose-600" : selectedStockCmvDifference < 0 ? "text-emerald-600" : ""}`}>
                {stockCmvAvailableForSelectedMonth
                  ? `${selectedStockCmvDifference > 0 ? "+" : ""}${formatCurrency(selectedStockCmvDifference)}`
                  : "—"}
              </p>
            </div>
          </div>
        </div>
        {cmvCriterion === "stock_movement" && stockCmvPayload && !loadingStockCmv ? (
          <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
            Estimativa gerencial pelo último custo efetivo disponível na data de cada saída:{" "}
            {formatCurrency(selectedStockBreakdown.consumptionCmv)} de consumo,{" "}
            {formatCurrency(selectedStockBreakdown.lossesCmv)} de perdas e{" "}
            {formatCurrency(selectedStockBreakdown.adjustmentsCmv)} de ajustes negativos.
          </p>
        ) : null}
      </div>
      {!sourceError && expenseContractIssues.length > 0 && (
        <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" role="alert">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p>
              <strong>Despesas pendentes de integridade.</strong>{" "}
              {expenseContractIssueGroups.length === 1
                ? "1 despesa tem"
                : `${expenseContractIssueGroups.length} despesas têm`}{" "}
              {expenseContractIssues.length === 1
                ? "1 inconsistência contábil"
                : `${expenseContractIssues.length} inconsistências contábeis`}{" "}
              e {expenseContractIssueGroups.length === 1 ? "impede" : "impedem"} considerar a DRE fechada.
            </p>
            <div className="mt-3 max-h-56 divide-y divide-amber-200 overflow-y-auto rounded-lg border border-amber-200 bg-white/60">
              {expenseContractIssueGroups.map(({ expenseId, expense, issues, isPersonnelExpense }) => {
                const canIdentifyExpense = canViewExpenseDetails
                  && (!isPersonnelExpense || canViewPersonnelCosts);
                const title = canIdentifyExpense
                  ? expense?.description || expense?.supplier || "Despesa sem descrição"
                  : "Despesa com inconsistência";
                const showSupplier = Boolean(
                  canIdentifyExpense
                  && expense?.description
                  && expense.supplier
                  && expense.supplier !== expense.description,
                );
                return (
                  <div key={expenseId} className="flex items-start justify-between gap-4 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-amber-950">{title}</p>
                      {showSupplier ? <p className="truncate text-xs text-amber-900/75">{expense?.supplier}</p> : null}
                      <p className="mt-0.5 text-xs text-amber-900">
                        {issues.map((issue) => expenseIssueLabel(
                          issue,
                          !isPersonnelExpense || canViewPersonnelCosts,
                        )).join(" · ")}
                      </p>
                    </div>
                    {canIdentifyExpense && canEditExpenses ? (
                      <Button asChild variant="outline" size="sm" className="h-8 shrink-0 border-amber-300 bg-white/70">
                        <Link href={`${FINANCIAL_ROUTES.newExpense}?edit=${encodeURIComponent(expenseId)}`}>
                          Corrigir <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-amber-900">
              A exportação foi bloqueada até que essas despesas sejam corrigidas.
            </p>
          </div>
        </div>
      )}

      {/* ── DASHBOARD ───────────────────────────────────────────────────────── */}
      {viewMode === "dashboard" && (
        <>
          {/* Top KPIs: monetários */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {loading ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />) : (<>
              <KpiCard label="Receita Líquida" value={formatCurrency(metrics.recLiq)} color="text-emerald-600" />
              <KpiCard label="Margem Bruta" value={formatCurrency(metrics.margBruta)} sub={pct(metrics.margBruta, metrics.recLiq)} color="text-blue-600" />
              <KpiCard label="Margem de Contribuição" value={formatCurrency(metrics.margContr)} sub={pct(metrics.margContr, metrics.recLiq)} color="text-violet-600" />
              <KpiCard label="Resultado Operacional" value={formatCurrency(metrics.resOp)} sub={pct(metrics.resOp, metrics.recLiq)} color={metrics.resOp >= 0 ? "text-primary" : "text-rose-600"} />
              <KpiCard label="Lucro Líquido" value={formatCurrency(metrics.lucroLiq)} sub={pct(metrics.lucroLiq, metrics.recLiq)} color={metrics.lucroLiq >= 0 ? "text-emerald-700" : "text-rose-600"} />
            </>)}
          </div>

          {/* Secondary KPIs: percentuais */}
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {loading ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />) : (<>
              <KpiCard label={cmvCriterion === "stock_movement" ? "CMV estoque %" : "CMV composição %"} value={pct(metrics.cmv, metrics.recLiq)} sub={formatCurrency(metrics.cmv)} color="text-amber-600" />
              <KpiCard label="Pessoal %" value={pct(metrics.pessoal, metrics.recLiq)} sub={formatCurrency(metrics.pessoal)} color="text-blue-700" />
              <KpiCard label="Operacional %" value={pct(metrics.despOp, metrics.recLiq)} sub={formatCurrency(metrics.despOp)} color="text-purple-700" />
              <KpiCard label="Ocupação %" value={pct(metrics.ocupacao, metrics.recLiq)} sub={formatCurrency(metrics.ocupacao)} color="text-slate-700" />
              <KpiCard label="Desp. Financeiras %" value={pct(metrics.despFin, metrics.recLiq)} sub={formatCurrency(metrics.despFin)} color="text-rose-700" />
              <KpiCard label="Ponto de Equilíbrio" value={formatCurrency(metrics.pe)} sub="custos fixos / margem contr. %" color="text-orange-700" />
            </>)}
          </div>

          {/* Chart + top plans */}
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Evolução — últimos 6 meses</CardTitle>
                <CardDescription>Receita, CMV, despesas fixas e resultado líquido{unitFilter !== "all" ? ` · ${kioskNameById[unitFilter] ?? unitFilter}` : ""}.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[320px]">
                  {loading ? <Skeleton className="h-full w-full" /> : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.1} />
                        <XAxis dataKey="month" tickLine={false} axisLine={false} />
                        <YAxis tickLine={false} axisLine={false} tickFormatter={(v) => `R$ ${v / 1000}k`} />
                        <Tooltip formatter={(value: number) => formatCurrency(value)} />
                        <Legend />
                        <Area type="monotone" dataKey="receita" name="Receita bruta" stroke="hsl(var(--chart-2))" fill="hsl(var(--chart-2))" fillOpacity={0.1} />
                        <Area type="monotone" dataKey="cmv" name={cmvCriterion === "stock_movement" ? "CMV estoque" : "CMV composição"} stroke="#d97706" fill="#d97706" fillOpacity={0.1} />
                        <Area type="monotone" dataKey="despesas" name="Despesas fixas" stroke="hsl(var(--chart-1))" fill="hsl(var(--chart-1))" fillOpacity={0.1} />
                        <Area type="monotone" dataKey="resultado" name="Lucro líquido" stroke="hsl(var(--chart-3))" fill="hsl(var(--chart-3))" fillOpacity={0.14} />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Top planos de despesa</CardTitle>
                <CardDescription>Provisionado em {selectedMonthLabel}.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {topExpensePlans.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhum dado disponível.</p>
                  ) : topExpensePlans.map((row) => (
                    <div key={row.name} className="flex items-center justify-between rounded-lg border p-3">
                      <span className="max-w-[180px] truncate text-sm">{row.name}</span>
                      <span className="font-mono text-sm font-semibold">{formatCurrency(row.value)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* CMV por unidade */}
          {unitFilter === "all" && cmvByUnit.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>CMV por unidade</CardTitle>
                <CardDescription>
                  {cmvCriterion === "stock_movement"
                    ? "Consumo, perdas e ajustes negativos valorizados na data de cada saída"
                    : "Calculado via PDV + composição dos produtos"}{" "}
                  — {selectedMonthLabel}.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {cmvByUnit.map((row) => {
                    const barWidth = metrics.cmv > 0 ? (row.cmv / metrics.cmv) * 100 : 0;
                    return (
                      <div key={row.kioskId} className="rounded-lg border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium">{row.name}</span>
                          <div className="flex shrink-0 items-center gap-3">
                            <span className="text-xs text-muted-foreground">{pct(row.cmv, metrics.recLiq)} receita líq.</span>
                            <span className="font-mono text-sm font-semibold text-amber-700">{formatCurrency(row.cmv)}</span>
                          </div>
                        </div>
                        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${barWidth}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* ── DRE CLÁSSICA ────────────────────────────────────────────────────── */}
      {viewMode === "classic" && (
        <Card>
          <CardHeader>
            <CardTitle>DRE — {selectedMonthLabel}</CardTitle>
            <CardDescription>
              {unitFilter !== "all" ? kioskNameById[unitFilter] ?? unitFilter : "Todas as unidades"}
              {!hasDreCategories && " · Mapeie os planos de contas nas configurações financeiras para categorizar automaticamente."}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="space-y-2 p-6">{Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : (() => {
              const { revBruta, impostos, recLiq, cmv, stockCmvBreakdown, custVar, margBruta, margContr, pessoal, despOp, ocupacao, semCategoria, resOp, recFin, despFin, recNaoOp, despNaoOp, lair, irCsll, lucroLiq, pe } = metrics;

              type Row =
                | { type: "section"; label: string }
                | { type: "line"; label: string; value: number; negative?: boolean; muted?: boolean; detailsKey?: string }
                | { type: "subtotal"; label: string; value: number; variant: "blue" | "violet" | "green" | "rose" | "slate" }
                | { type: "kpi"; label: string; value: string }
                | { type: "divider" };

              const rows: Row[] = [
                { type: "section", label: "RECEITA" },
                { type: "line", label: "Receita Bruta", value: revBruta },
                { type: "line", label: "(-) Impostos e deduções", value: impostos, negative: true, detailsKey: "impostos_deducoes" },
                { type: "subtotal", label: "= RECEITA LÍQUIDA", value: recLiq, variant: "blue" },
                { type: "divider" },
                { type: "section", label: "CUSTO DE MERCADORIA VENDIDA" },
                ...(cmvCriterion === "stock_movement"
                  ? [
                      { type: "line" as const, label: "(-) Consumo pela movimentação de estoque", value: stockCmvBreakdown.consumptionCmv, negative: true },
                      ...(stockCmvBreakdown.lossesCmv > 0
                        ? [{ type: "line" as const, label: "(-) Perdas e descartes", value: stockCmvBreakdown.lossesCmv, negative: true }]
                        : []),
                      ...(stockCmvBreakdown.adjustmentsCmv > 0
                        ? [{ type: "line" as const, label: "(-) Ajustes negativos de estoque", value: stockCmvBreakdown.adjustmentsCmv, negative: true }]
                        : []),
                    ]
                  : [{ type: "line" as const, label: "(-) CMV (PDV + composição automática)", value: cmv, negative: true }]),
                { type: "subtotal", label: "= MARGEM BRUTA", value: margBruta, variant: "blue" },
                { type: "kpi", label: "Margem Bruta %", value: pct(margBruta, recLiq) },
                { type: "divider" },
                { type: "section", label: "CUSTOS VARIÁVEIS" },
                { type: "line", label: "(-) Insumos e fretes de aquisição", value: custVar, negative: true, detailsKey: "custos_variaveis" },
                { type: "subtotal", label: "= MARGEM DE CONTRIBUIÇÃO", value: margContr, variant: "violet" },
                { type: "kpi", label: "Margem de Contribuição %", value: pct(margContr, recLiq) },
                { type: "kpi", label: "Ponto de Equilíbrio", value: formatCurrency(pe) },
                { type: "divider" },
                { type: "section", label: "DESPESAS OPERACIONAIS" },
                { type: "line", label: "(-) Pessoal", value: pessoal, negative: true, detailsKey: "pessoal" },
                { type: "line", label: "(-) Despesas operacionais", value: despOp, negative: true, detailsKey: "despesas_operacionais" },
                { type: "line", label: "(-) Ocupação", value: ocupacao, negative: true, detailsKey: "ocupacao" },
                ...(semCategoria > 0 ? [{ type: "line" as const, label: "(-) Não classificado", value: semCategoria, negative: true, muted: true, detailsKey: "null" }] : []),
                { type: "subtotal", label: "= EBIT (Resultado Operacional)", value: resOp, variant: resOp >= 0 ? "green" : "rose" },
                { type: "kpi", label: "Margem Operacional %", value: pct(resOp, recLiq) },
                { type: "divider" },
                { type: "section", label: "RESULTADO FINANCEIRO" },
                ...(recFin > 0 ? [{ type: "line" as const, label: "(+) Receita financeira", value: recFin, detailsKey: "receita_financeira" }] : []),
                { type: "line", label: "(-) Despesas financeiras", value: despFin, negative: true, detailsKey: "despesas_financeiras" },
                ...(recNaoOp > 0 ? [{ type: "line" as const, label: "(+) Receita não operacional", value: recNaoOp, detailsKey: "receita_nao_operacional" }] : []),
                ...(despNaoOp > 0 ? [{ type: "line" as const, label: "(-) Despesa não operacional", value: despNaoOp, negative: true, detailsKey: "despesa_nao_operacional" }] : []),
                { type: "subtotal", label: "= LAIR", value: lair, variant: lair >= 0 ? "slate" : "rose" },
                { type: "divider" },
                { type: "section", label: "IR / CSLL" },
                { type: "line", label: "(-) IR / CSLL", value: irCsll, negative: true, detailsKey: "impostos_resultado" },
                { type: "subtotal", label: "= LUCRO LÍQUIDO", value: lucroLiq, variant: lucroLiq >= 0 ? "green" : "rose" },
                { type: "kpi", label: "Margem Líquida %", value: pct(lucroLiq, recLiq) },
              ];

              const variantClasses = {
                blue: "bg-blue-50/70 font-semibold",
                violet: "bg-violet-50/70 font-semibold",
                green: "bg-emerald-50/70 font-semibold",
                rose: "bg-rose-50/70 font-semibold",
                slate: "bg-slate-50/70 font-semibold",
              };
              const variantTextClasses = {
                blue: "text-blue-700",
                violet: "text-violet-700",
                green: "text-emerald-700",
                rose: "text-rose-700",
                slate: "text-slate-700",
              };

              return (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Descrição</th>
                      <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">Valor</th>
                      <th className="w-24 px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">% RL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => {
                      if (row.type === "divider") return <tr key={i}><td colSpan={3} className="h-px bg-border/60" /></tr>;
                      if (row.type === "section") return (
                        <tr key={i} className="bg-muted/20">
                          <td colSpan={3} className="px-6 py-2 text-[10.5px] font-bold uppercase tracking-widest text-muted-foreground">{row.label}</td>
                        </tr>
                      );
                      if (row.type === "kpi") return (
                        <tr key={i} className="border-b border-dashed border-border/40 bg-muted/5">
                          <td className="px-6 py-2 pl-10 text-xs text-muted-foreground italic">{row.label}</td>
                          <td colSpan={2} className="px-6 py-2 text-right text-xs font-semibold text-muted-foreground">{row.value}</td>
                        </tr>
                      );
                      if (row.type === "subtotal") {
                        const isNeg = row.value < 0;
                        return (
                          <tr key={i} className={`border-b ${variantClasses[row.variant]}`}>
                            <td className={`px-6 py-3 font-semibold ${variantTextClasses[row.variant]}`}>{row.label}</td>
                            <td className={`px-6 py-3 text-right font-mono font-bold ${isNeg ? "text-rose-700" : variantTextClasses[row.variant]}`}>{formatCurrency(row.value)}</td>
                            <td className={`px-6 py-3 text-right font-medium ${variantTextClasses[row.variant]}`}>{pct(Math.abs(row.value), recLiq)}</td>
                          </tr>
                        );
                      }
                      // line
                      const detailsKey = row.detailsKey;
                      const details = detailsKey ? metrics.expenseDetailsByPosition[detailsKey] ?? [] : [];
                      const accountGroups = groupDreExpenseDetailsByAccount(details);
                      const expenseCount = new Set(details.map((detail) => detail.expenseId)).size;
                      const canExpandDetails = expenseCount > 0
                        && canViewExpenseDetails
                        && (detailsKey !== "pessoal" || canViewPersonnelCosts);
                      const isExpanded = Boolean(detailsKey && expandedDreRows[detailsKey] && canExpandDetails);
                      const detailRegionId = detailsKey ? `dre-expense-details-${detailsKey}` : undefined;
                      return (
                        <Fragment key={i}>
                          <tr className={`border-b border-border/40 transition-colors hover:bg-muted/20 ${row.muted ? "opacity-60" : ""}`}>
                            <td className="p-0 text-muted-foreground">
                              {canExpandDetails && detailsKey ? (
                                <button
                                  type="button"
                                  className="flex w-full items-center gap-2 px-6 py-2.5 pl-10 text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                                  aria-expanded={isExpanded}
                                  aria-controls={detailRegionId}
                                  onClick={() => setExpandedDreRows((current) => ({
                                    ...current,
                                    [detailsKey]: !current[detailsKey],
                                  }))}
                                >
                                  <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                                  <span>{row.label}</span>
                                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                                    {expenseCount} {expenseCount === 1 ? "despesa" : "despesas"}
                                  </span>
                                </button>
                              ) : (
                                <div className="px-6 py-2.5 pl-10">{row.label}</div>
                              )}
                            </td>
                            <td className={`px-6 py-2.5 text-right font-mono font-medium ${row.negative ? "text-rose-600" : "text-emerald-600"}`}>
                              {row.negative ? `(${formatCurrency(row.value)})` : formatCurrency(row.value)}
                            </td>
                            <td className="px-6 py-2.5 text-right text-muted-foreground">{pct(row.value, recLiq)}</td>
                          </tr>
                          {isExpanded ? (
                            <tr className="border-b border-border/40 bg-muted/10">
                              <td colSpan={3} className="px-6 py-4 pl-10">
                                <div
                                  id={detailRegionId}
                                  role="region"
                                  aria-label={`Lançamentos de ${row.label}`}
                                  className="overflow-hidden rounded-lg border bg-background"
                                >
                                  <Accordion type="multiple">
                                    {accountGroups.map((group) => (
                                      <AccordionItem
                                        key={group.accountPlanId}
                                        value={`${detailsKey}:${group.accountPlanId}`}
                                        className="last:border-b-0"
                                      >
                                        <AccordionTrigger className="gap-3 bg-muted/20 px-4 py-3 text-left hover:no-underline">
                                          <span className="flex min-w-0 flex-1 items-center justify-between gap-3 pr-1">
                                            <span className="min-w-0">
                                              <span className="block truncate text-sm font-semibold text-foreground">{group.accountPlanName}</span>
                                              <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">
                                                {group.expenses.length} {group.expenses.length === 1 ? "despesa" : "despesas"}
                                              </span>
                                            </span>
                                            <span className="whitespace-nowrap font-mono text-xs font-semibold text-foreground">
                                              {formatCurrency(group.totalAmount)}
                                            </span>
                                          </span>
                                        </AccordionTrigger>
                                        <AccordionContent className="border-t pb-0">
                                          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b bg-muted/10 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                            <span>Despesa</span>
                                            <span className="text-right">Valor nesta linha</span>
                                          </div>
                                          <div className="divide-y divide-border/60">
                                            {group.expenses.map((detail) => {
                                              const title = detail.description || detail.supplier || "Despesa sem descrição";
                                              const showSupplier = Boolean(detail.description && detail.supplier && detail.supplier !== detail.description);
                                              const references = dreExpenseDetailReferences(detail);
                                              return (
                                                <div
                                                  key={detail.expenseId}
                                                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3"
                                                >
                                                  <div className="min-w-0">
                                                    <p className="truncate font-medium text-foreground">{title}</p>
                                                    {showSupplier ? (
                                                      <p className="truncate text-xs text-muted-foreground">{detail.supplier}</p>
                                                    ) : null}
                                                    {references.length > 0 ? (
                                                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{references.join(" · ")}</p>
                                                    ) : null}
                                                  </div>
                                                  <div className="flex items-center justify-end gap-2">
                                                    <span className="whitespace-nowrap font-mono text-xs font-semibold">{formatCurrency(detail.amount)}</span>
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
              );
            })()}
          </CardContent>
        </Card>
      )}

      {viewMode === "people" && canViewPersonnelCosts && (
        <DrePeopleView
          analysis={personAnalysis}
          drePersonnelTotal={metrics.pessoal}
          loading={loading}
          monthLabel={selectedMonthLabel}
          unitLabel={selectedUnitName || "Todas as unidades"}
        />
      )}
    </div>
  );
}
