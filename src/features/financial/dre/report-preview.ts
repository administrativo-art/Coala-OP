import { reconcileDreCmv } from "./cmv-reconciliation";
import { calculateProductCompositionCmv } from "@/lib/product-composition-cmv";
import type { BaseProduct } from "@/types";
import { calculateDreMetrics } from "./metrics";
import { describeReportMonth, buildDreReportAnalysis, dreReportPeriods, shiftDreMonth, type DreReport, type DreReportMode, type DreReportMonth } from "./report";
/** Deterministic fictional data; never imports production loaders or credentials. */
export function createDreReportPreview(mode: DreReportMode = "monthly"): DreReport {
  const generatedAt = "2027-08-01T15:00:00.000Z", selectedMonth = "2027-07";
  const month = (period: string, index: number): DreReportMonth => {
    const gross = 30000 + index * 700;
    const [year, monthNumber] = period.split("-").map(Number); const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    const metrics = calculateDreMetrics({ expenseCalculation: { totalsByPosition: { impostos_deducoes: 1100, pessoal: 6000, despesas_operacionais: 2500, ocupacao: 1800, despesas_financeiras: 120, impostos_resultado: 300 }, detailsByPosition: {}, issues: [] },
      revenueSource: { revenueCents: gross * 100, cashShortageCents: 2000, cashSurplusCents: 500, cashDifferenceCoverage: "complete", cashDifferenceCoveredDays: days, cashDifferenceTotalDays: days, cashDifferenceProvisional: false, pendingOperatorCount: 0, issues: [] },
      stockCmvBreakdown: { totalCmv: gross * .31, consumptionCmv: gross * .3, lossesCmv: gross * .005, adjustmentsCmv: gross * .005, movementCount: 120, unpricedMovementCount: 0, movementDays: 25, coverage: "complete" },
      compositionCmv: NaN, compositionPeriods: [], cmvCriterion: "stock_movement" });
    return { period, metrics, ...describeReportMonth(period, metrics, generatedAt), units: [{ id: "demo", name: "Quiosque demonstração", metrics }] };
  };
  const months = dreReportPeriods(selectedMonth, mode).map((p, i) => month(p, i));
  const previous = month(shiftDreMonth(selectedMonth, -1), mode === "monthly" ? -1 : 10);
  const base = { id: "demo-base", name: "Insumo A (fictício)", unit: "un", category: "Unidade", initialCostPerUnit: 10 } as BaseProduct;
  const composition = calculateProductCompositionCmv([{ id: "demo-item", simulationId: "demo-recipe", baseProductId: base.id, quantity: 1, useDefault: false, overrideCostPerUnit: 9, overrideUnit: "un" }], new Map([[base.id, base]]));
  const reconciliation = reconcileDreCmv({ period: selectedMonth, kioskIds: ["demo"], stockTotal: 9300,
    stock: { complete: true, diagnostics: [], rows: [
      { kioskId: "demo", baseProductId: base.id, name: base.name, unit: "un", category: "Unidade", quantity: 1100, value: 9130, kind: "consumption", initialCost: false, costReferenceId: "demo-effective-cost", costReferenceAt: "2027-06-01T15:00:00.000Z", appliedCost: 8.3 },
      { kioskId: "demo", baseProductId: base.id, name: base.name, unit: "un", category: "Unidade", quantity: 5, value: 50, kind: "losses", initialCost: false },
      { kioskId: "demo", baseProductId: base.id, name: base.name, unit: "un", category: "Unidade", quantity: 10, value: 100, kind: "adjustments", initialCost: false },
      { kioskId: "demo", baseProductId: "demo-material", name: "Material de apoio (fictício)", unit: "un", category: "Unidade", quantity: 2, value: 20, kind: "consumption", initialCost: true },
    ] }, composition: [{ kioskId: "demo", period: selectedMonth, status: "open", complete: true, sourceChanged: false, referenceAt: generatedAt, revision: 0, sourceFingerprint: "demo-source-fingerprint", salesFingerprint: "demo-sales-fingerprint",
      totalCmv: 9000, products: [{ simulationId: "demo-recipe", quantity: 1000, unitCmv: 9, totalCmv: 9000, composition }] }] });
  return { version: 1, mode, generatedAt, selectedMonth, criterion: "stock_movement", scope: "DADOS FICTÍCIOS · Quiosque demonstração", months, previous,
    ...(mode === "monthly" ? { cmvReconciliation: reconciliation } : {}),
    analysis: ["AMOSTRA COM DADOS FICTÍCIOS. Não representa a operação da empresa.", ...buildDreReportAnalysis(months, previous)],
    principalExpenses: [{ account: "Pessoal (demonstração)", amount: 6000 }, { account: "Despesas operacionais (demonstração)", amount: 2500 }, { account: "Ocupação (demonstração)", amount: 1800 }],
    comparisonNote: "Amostra fictícia. Competências mensais; AV sobre receita líquida e AH sobre módulo do mês anterior.", permissionsNote: null };
}
