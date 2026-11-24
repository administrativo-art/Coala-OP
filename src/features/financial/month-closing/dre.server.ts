import "server-only";

import { FINANCIAL_ROUTES } from "@/features/financial/lib/constants";
import { calculateDreExpenses } from "@/features/financial/lib/dre-expense-calculation";
import { dreRevenueUnitIds, selectDreRevenue } from "@/features/financial/dre/revenue-selection";
import { getDreSourceData } from "@/features/financial/dre/source-data.server";
import { dbAdmin } from "@/lib/firebase-admin";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { resolvePdvFilialId } from "@/lib/kiosk-identifiers";
import { reportSystemError } from "@/lib/observability";

import { dreFlowUnavailable, evaluateDreFlow, type DreFlowUnitInput } from "./dre-flow";
import { monthBounds } from "./sales-fees.server";
import { todayKey } from "./month";
import type { ClosingFlow } from "./types";

type Input = { workspaceId: string; month: string; canViewItems: boolean; now?: Date };

const KIOSKS_LIMIT = 200;
const ACCOUNTS_LIMIT = 1000;
const RESULT_CENTERS_LIMIT = 200;

const query = (entries: Record<string, string>) => new URLSearchParams(entries).toString();

/** Mesmo mapa da página da DRE: id, nome e unidades do centro de resultado apontam para o nome do centro. */
function resultCenterNames(centers: Array<Record<string, unknown>>) {
  const map: Record<string, string> = {};
  for (const center of centers) {
    if (typeof center.name !== "string") continue;
    if (typeof center.id === "string" && center.id) map[center.id] = center.name;
    map[center.name] = center.name;
    for (const unitId of Array.isArray(center.unitIds) ? center.unitIds : []) if (typeof unitId === "string" && unitId) map[unitId] = center.name;
  }
  return map;
}

/**
 * DRE do mês, só leitura, com o mesmo critério do “Conferir fontes” da página: CMV por composição congelado, receita e
 * diferenças de caixa comprovadas e despesas sem inconsistência contábil. Custo por chamada, sem polling: até 200 quiosques,
 * 1.000 contas e 200 centros de resultado (coleções pequenas, com limite), mais a leitura da própria DRE de um mês
 * (relatórios de venda e despesas do mês, até 5.000 cada, e 1 fechamento de CMV por unidade). Fonte ilegível deixa só
 * este fluxo indisponível, com evento de erro.
 */
export async function readDreFlow(input: Input): Promise<ClosingFlow> {
  const originHref = `${FINANCIAL_ROUTES.dre}?${query({ month: input.month })}`;
  try {
    const now = input.now ?? new Date();
    const bounds = monthBounds(input.month);
    const [kioskSnapshot, accountSnapshot, centerSnapshot] = await Promise.all([
      dbAdmin.collection("kiosks").limit(KIOSKS_LIMIT + 1).get(),
      financialDbAdmin.collection("accounts").limit(ACCOUNTS_LIMIT + 1).get(),
      financialDbAdmin.collection("resultCenters").limit(RESULT_CENTERS_LIMIT + 1).get(),
    ]);
    if (kioskSnapshot.size > KIOSKS_LIMIT || accountSnapshot.size > ACCOUNTS_LIMIT || centerSnapshot.size > RESULT_CENTERS_LIMIT) {
      throw new Error("Cadastros da DRE acima do limite de leitura do fechamento.");
    }
    const kiosks = kioskSnapshot.docs.map((document) => ({ id: document.id, name: String(document.data().name ?? document.id), pdvFilialId: document.data().pdvFilialId as string | undefined }));
    const pdvKiosks = kiosks.filter((kiosk) => resolvePdvFilialId(kiosk));
    const payload = pdvKiosks.length === 0 ? null : await getDreSourceData({
      workspaceId: input.workspaceId, kioskIds: pdvKiosks.map((kiosk) => kiosk.id), periods: [input.month],
      canViewExpenseDetails: false, includeCompositionCmv: true, tolerateCompositionFailure: true,
      includeReconciliation: false, includeBudgetPlanning: false,
    });
    const [year, monthNumber] = input.month.split("-").map(Number);
    const nameOf = new Map(kiosks.map((kiosk) => [kiosk.id, kiosk.name]));
    const units: DreFlowUnitInput[] = payload ? dreRevenueUnitIds(pdvKiosks, payload.closureSummaries, payload.salesSummaries).map((kioskId) => {
      const revenue = selectDreRevenue({ kioskId, year, month: monthNumber, closureSummaries: payload.closureSummaries, salesSummaries: payload.salesSummaries });
      const cmv = payload.cmvPeriods?.find((row) => row.kioskId === kioskId && row.period === input.month) ?? null;
      return {
        key: kioskId, label: nameOf.get(kioskId) ?? kioskId,
        cmv: cmv ? { status: cmv.status, complete: cmv.complete, sourceChanged: cmv.sourceChanged } : null,
        revenueProven: revenue.revenueCents !== null,
        cashProven: revenue.cashDifferenceCoverage === "complete" && revenue.cashDifferenceProvisional === false,
        cashCoveredDays: revenue.cashDifferenceCoveredDays, cashTotalDays: revenue.cashDifferenceTotalDays,
      };
    }) : [];
    const accounts = Object.fromEntries(accountSnapshot.docs.map((document) => {
      const data = document.data();
      return [document.id, { name: data.name || document.id, drePosition: data.dre_position ?? null, isDreAccount: data.is_dre_account !== false }];
    }));
    const expenseIssueCount = payload ? new Set(calculateDreExpenses({
      expenses: payload.expenses, accounts, monthKey: input.month,
      resultCenterNames: resultCenterNames(centerSnapshot.docs.map((document) => ({ ...document.data(), id: document.id }))),
    }).issues.map((issue) => issue.expenseId)).size : 0;
    return evaluateDreFlow({ dre: { monthOver: todayKey(now) > bounds.through, units, expenseIssueCount }, canViewItems: input.canViewItems, originHref });
  } catch (error) {
    reportSystemError({ error, source: "api-financial", operation: "month-closing-dre", routeOrJob: "/api/financial/month-closing" });
    return dreFlowUnavailable(originHref);
  }
}
