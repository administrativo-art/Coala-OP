import { reconcileDreCmv, type StockReconciliationInput } from "./cmv-reconciliation";
import { AppError } from "@/lib/observability/app-error";
import type { ServerUserContext } from "@/lib/auth-server";
import { FINANCIAL_DRE_START_MONTH_KEY } from "../lib/constants";
import { type DreExpenseAccountMeta } from "../lib/dre-expense-calculation";
import { calculateDreReportExpenses } from "./report-expenses";
import type { getDreSourceData } from "./source-data.server";
import type { getDreStockCmv } from "./stock-cmv.server";
import { DreStockCmvLimitError, selectDreStockCmv, type DreStockCmvPayload } from "./stock-cmv";
import { aggregateDreRevenue, dreRevenueUnitIds, selectDreRevenue } from "./revenue-selection";
import { calculateDreMetrics } from "./metrics";
import { buildDreReportAnalysis, comparableDreMonths, describeReportMonth, restrictDreReportCoverage, dreReportPeriods, shiftDreMonth, type DreReport, type DreReportMonth } from "./report";
import { assertDreReportAccess, type DreReportInput } from "./report-access";
import { canAccessUnit } from "@/lib/unit-access";
import { resolveDreReportScope, withoutSharedCenterUnitExpenses, type ReportKiosk, type ReportCenter } from "./report-scope";
import type { DreSourceDataPayload } from "./source-data";

export type DreReportServices = {
  now(): Date;
  readKiosks(): Promise<ReportKiosk[]>;
  readCenters(): Promise<ReportCenter[]>;
  readAccounts(ids: string[]): Promise<Record<string, DreExpenseAccountMeta>>;
  readSources: typeof getDreSourceData;
  readStock: typeof getDreStockCmv;
};
const failLimit = () => { throw new AppError({ code: "DRE_REPORT_LIMIT", kind: "CONFLICT", safeMessage: "Volume acima do limite do relatório. Exporte uma unidade ou um período menor." }); };
export async function loadDreReportWithServices(input: DreReportInput, actor: ServerUserContext, services: DreReportServices): Promise<DreReport> {
  assertDreReportAccess(actor, input, services.now());
  const generatedAt = services.now().toISOString();
  const periods = dreReportPeriods(input.month, input.mode);
  const readPeriods = [...new Set([shiftDreMonth(periods[0], -1), ...periods])].filter(p => p >= FINANCIAL_DRE_START_MONTH_KEY);
  const canDetails = actor.isDefaultAdmin || actor.permissions.financial?.expenses?.view === true;
  const canPersonnel = actor.isDefaultAdmin || actor.permissions.financial?.personnelCosts?.view === true;
  const allKiosks = await services.readKiosks(); if (allKiosks.length > 200) failLimit();
  const kiosks = input.kioskIds.map(id => { const kiosk = allKiosks.find(k => k.id === id); if (!kiosk) throw new AppError({ code: "DRE_REPORT_UNIT_MISSING", kind: "VALIDATION" }); return kiosk; });
  const wholeWorkspace = allKiosks.length === input.kioskIds.length;
  const centers = await services.readCenters(); if (centers.length > 200) failLimit();
  const { names, unitCenters, sharedUnits } = resolveDreReportScope(allKiosks, centers, input.kioskIds,
    id => canAccessUnit(actor.userDoc, id, { isDefaultAdmin: actor.isDefaultAdmin }));
  const sources: DreSourceDataPayload[] = [];
  for (let i = 0; i < readPeriods.length; i += 4) sources.push(await services.readSources({ workspaceId: actor.workspace_id,
    kioskIds: input.kioskIds, periods: readPeriods.slice(i, i + 4), canViewExpenseDetails: canDetails, canViewPersonnel: canPersonnel, includeCompositionCmv: input.mode === "monthly", includeReconciliation: input.mode === "monthly", compositionPeriods: [input.month], tolerateCompositionFailure: true, includeBudgetPlanning: false }));
  const expenses = [...new Map(sources.flatMap(s => s.expenses).map(e => [e.id, e])).values()];
  const sales = sources.flatMap(s => s.salesSummaries), closures = sources.flatMap(s => s.closureSummaries), compositions = sources.flatMap(s => s.cmvPeriods ?? []);
  const accountIds = [...new Set(expenses.flatMap(e => [e.accountPlan, e.accountId, ...(e.accountAllocations || []).map(a => a.accountPlanId), ...(e.personAllocations || []).map(a => a.accountPlanId)]).filter((id): id is string => !!id))];
  if (accountIds.length > 500) failLimit();
  const accounts = await services.readAccounts(accountIds);
  let stock: (DreStockCmvPayload & { reconciliationInput?: StockReconciliationInput }) | null = null; let stockError = false;
  try { stock = await services.readStock({ workspaceId: actor.workspace_id, kioskIds: input.kioskIds, periods: readPeriods, ...(input.mode === "monthly" ? { reconciliationPeriod: input.month } : {}) }); }
  catch (cause) { if (cause instanceof DreStockCmvLimitError) failLimit(); stockError = true; } // Unknown stays unavailable; no numeric replacement.
  const pdvIds = dreRevenueUnitIds(kiosks, closures, sales);
  const metrics = (period: string, kioskId: string | null) => {
    const [year, month] = period.split("-").map(Number); const ids = kioskId ? [kioskId] : pdvIds;
    const revenueSource = aggregateDreRevenue(ids.map(id => selectDreRevenue({ kioskId: id, year, month, closureSummaries: closures, salesSummaries: sales })));
    const compositionPeriods = compositions.filter(p => p.period === period && ids.includes(p.kioskId));
    const compositionCmv = compositionPeriods.length === ids.length && ids.length > 0 && compositionPeriods.every(p => p.complete && p.totalCmv !== null)
      ? compositionPeriods.reduce((sum, p) => sum + p.totalCmv!, 0) : NaN;
    const centerName = (id: string) => unitCenters[id] ?? kiosks.find(k => k.id === id)!.name;
    const selectedCenters = kioskId ? [centerName(kioskId)] : wholeWorkspace ? [null] : [...new Set(kiosks.map(k => centerName(k.id)))];
    const expenseCalculation = calculateDreReportExpenses({ expenses, accounts, monthKey: period, centers: selectedCenters, resultCenterNames: names });
    const calculated = restrictDreReportCoverage(period, calculateDreMetrics({ expenseCalculation, revenueSource, compositionPeriods, compositionCmv, cmvCriterion: "stock_movement",
      stockCmvBreakdown: selectDreStockCmv({ payload: stock, monthKey: period, kioskIds: kioskId ? [kioskId] : input.kioskIds, sourceError: stockError }) }));
    return kioskId && sharedUnits.has(kioskId) ? withoutSharedCenterUnitExpenses(calculated) : calculated;
  };
  const month = (period: string): DreReportMonth => { const m = metrics(period, null); return { period, metrics: m, ...describeReportMonth(period, m, generatedAt),
    units: kiosks.map(k => ({ id: k.id, name: k.name, metrics: metrics(period, k.id) })) }; };
  const months = periods.map(month), previous = month(shiftDreMonth(periods.at(-1)!, -1));
  const latest = months.at(-1)!;
  const expenseTotals = new Map<string, number>();
  if (canDetails) for (const [position, rows] of Object.entries(latest.metrics.expenseDetailsByPosition)) {
    if (position === "pessoal" && !canPersonnel) continue;
    for (const row of rows) expenseTotals.set(row.accountPlanName, (expenseTotals.get(row.accountPlanName) ?? 0) + row.amount);
  }
  return { version: 1, generatedAt, mode: input.mode, criterion: "stock_movement", selectedMonth: input.month,
    scope: kiosks.map(k => k.name).join("; "), months, previous,
    analysis: buildDreReportAnalysis(months, previous),
    ...(input.mode === "monthly" ? { cmvReconciliation: reconcileDreCmv({ period: input.month, stock: stock?.reconciliationInput ?? null,
      composition: sources.flatMap(s => s.cmvReconciliation ?? []), kioskIds: pdvIds, stockTotal: latest.metrics.cmv }) } : {}),
    principalExpenses: [...expenseTotals].map(([account, amount]) => ({ account, amount })).sort((a, b) => b.amount - a.amount).slice(0, 10),
    comparisonNote: comparableDreMonths(latest, previous) ? "Comparação de competências mensais completas; resultados provisórios continuam identificados. AV sobre receita líquida; AH sobre módulo do mês anterior."
      : "Não comparável ao mês anterior em intervalo homogêneo: fontes de despesas e CMV são mensais; corte pelos mesmos dias não comprovado. Sem pró-rata.",
    permissionsNote: [sharedUnits.size ? "Comparação por unidade: despesas do centro compartilhado sem atribuição aprovada estão indisponíveis; o consolidado inclui o centro uma vez." : null, canDetails && canPersonnel ? null : "Detalhes de despesas/pessoal limitados às permissões da sessão; os totais agregados seguem a autorização de DRE."].filter(Boolean).join(" ") || null };
}
