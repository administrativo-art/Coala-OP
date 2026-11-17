import assert from "node:assert/strict";
import test from "node:test";

import { dreBreakEvenSeries, dreMonthComparison, dreWaterfallSteps } from "../../src/features/financial/dre/dre-chart-data";

const base = {
  revBruta: 1000, impostos: 50, cmv: 300, custVar: 0, pessoal: 200, ocupacao: 100, despOp: 40, semCategoria: 10,
  cashShortage: 5, cashSurplus: 0, recFin: 0, despFin: 0, recNaoOp: 0, despNaoOp: 0, irCsll: 0, lucroLiq: 295,
};

test("cascata vai da receita bruta ao lucro, omite linhas zeradas e fecha no lucro", () => {
  const steps = dreWaterfallSteps({ ...base, revenueSource: { units: [] } } as typeof base)!;
  assert.deepEqual(steps.map((step) => step.label), ["Receita bruta", "Deduções", "CMV", "Pessoal", "Ocupação", "Despesas operacionais", "Caixa, financeiro e IR", "Lucro líquido"]);
  const lastDelta = steps.at(-2)!;
  assert.equal(lastDelta.range[0], 295);
  assert.deepEqual(steps.at(-1)!.range, [0, 295]);
  assert.equal(dreWaterfallSteps({ ...base, cmv: NaN }), null);
});

test("ponto de equilíbrio distribui a margem pela venda diária", () => {
  const series = dreBreakEvenSeries({
    monthKey: "2026-02",
    dailyRevenue: { "2026-02-01": 100, "2026-02-10": 100, "2026-02-20": 200, "2026-03-01": 999 },
    margContr: 800,
    totalFixos: 400,
  })!;
  assert.equal(series.days.length, 28);
  assert.equal(series.days[0].margin, 200);
  assert.equal(series.days.at(-1)!.margin, 800);
  assert.equal(series.breakEvenDay, 10);
  assert.equal(dreBreakEvenSeries({ monthKey: "2026-02", dailyRevenue: {}, margContr: 800, totalFixos: 400 }), null);
});

test("comparação marca alta de custo como desfavorável", () => {
  const rows = dreMonthComparison(
    { recLiq: 110, cmv: 40, margBruta: 70, totalFixos: 50, lucroLiq: 20 },
    { recLiq: 100, cmv: 30, margBruta: 70, totalFixos: 50, lucroLiq: 0 },
  );
  assert.equal(rows[0].favorable, true);
  assert.equal(rows[1].favorable, false);
  assert.equal(rows[2].favorable, null);
  assert.equal(rows[4].changePct, null);
});
