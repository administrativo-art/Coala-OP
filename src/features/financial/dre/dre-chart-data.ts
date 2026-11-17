/** Dados dos gráficos da DRE (seletor de gráfico no Painel). Funções puras, sem leitura de fonte. */

export type DreChartMonth = {
  key: string;
  label: string;
  revBruta: number | null;
  recLiq: number | null;
  cmv: number | null;
  cmvComposition: number | null;
  cmvStock: number | null;
  totalFixos: number;
  margContr: number | null;
  lucroLiq: number | null;
};

export type DreChartUnit = {
  kioskId: string;
  name: string;
  revenue: number | null;
  cmv: number | null;
  margContr: number | null;
  fixed: number;
  lucro: number | null;
};

export type DreWaterfallInput = {
  revBruta: number;
  impostos: number;
  cmv: number;
  custVar: number;
  pessoal: number;
  ocupacao: number;
  despOp: number;
  semCategoria: number;
  cashShortage: number;
  cashSurplus: number;
  recFin: number;
  despFin: number;
  recNaoOp: number;
  despNaoOp: number;
  irCsll: number;
  lucroLiq: number;
};

export type DreWaterfallStep = {
  label: string;
  /** Valor com sinal: positivo soma, negativo subtrai; nos totais é o próprio total. */
  value: number;
  kind: "total" | "delta";
  range: [number, number];
};

export const finiteOrNull = (value: number) => (Number.isFinite(value) ? value : null);

/** Receita bruta → lucro líquido. Linhas zeradas saem para o gráfico não encher de degraus vazios. */
export function dreWaterfallSteps(input: DreWaterfallInput): DreWaterfallStep[] | null {
  const keys: Array<keyof DreWaterfallInput> = [
    "revBruta", "impostos", "cmv", "custVar", "pessoal", "ocupacao", "despOp", "semCategoria", "cashShortage",
    "cashSurplus", "recFin", "despFin", "recNaoOp", "despNaoOp", "irCsll", "lucroLiq",
  ];
  if (keys.some((key) => !Number.isFinite(input[key]))) return null;
  const others = -(input.cashShortage - input.cashSurplus + input.despFin - input.recFin + input.despNaoOp - input.recNaoOp + input.irCsll);
  const deltas: Array<[string, number]> = [
    ["Deduções", -input.impostos],
    ["CMV", -input.cmv],
    ["Insumos e fretes", -input.custVar],
    ["Pessoal", -input.pessoal],
    ["Ocupação", -input.ocupacao],
    ["Despesas operacionais", -(input.despOp + input.semCategoria)],
    ["Caixa, financeiro e IR", others],
  ];
  const steps: DreWaterfallStep[] = [{ label: "Receita bruta", value: input.revBruta, kind: "total", range: [0, input.revBruta] }];
  let running = input.revBruta;
  for (const [label, value] of deltas) {
    if (Math.abs(value) < 0.005) continue;
    const next = running + value;
    steps.push({ label, value, kind: "delta", range: [Math.min(running, next), Math.max(running, next)] });
    running = next;
  }
  steps.push({ label: "Lucro líquido", value: input.lucroLiq, kind: "total", range: [Math.min(0, input.lucroLiq), Math.max(0, input.lucroLiq)] });
  return steps;
}

export function daysInMonthKey(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Margem de contribuição acumulada no mês, distribuída pela venda de cada dia, contra o custo fixo.
 * A venda diária só dá o ritmo; o total do mês continua sendo a margem apurada na DRE.
 */
export function dreBreakEvenSeries(input: {
  monthKey: string;
  dailyRevenue: Record<string, number>;
  margContr: number;
  totalFixos: number;
}) {
  const { monthKey, dailyRevenue, margContr, totalFixos } = input;
  const total = Object.entries(dailyRevenue)
    .filter(([date, value]) => date.startsWith(`${monthKey}-`) && Number.isFinite(value) && value > 0)
    .reduce((sum, [, value]) => sum + value, 0);
  if (!(total > 0) || !Number.isFinite(margContr) || !Number.isFinite(totalFixos)) return null;
  let cumulativeRevenue = 0;
  let breakEvenDay: number | null = null;
  const days = Array.from({ length: daysInMonthKey(monthKey) }, (_, index) => {
    const day = index + 1;
    const value = dailyRevenue[`${monthKey}-${String(day).padStart(2, "0")}`];
    if (Number.isFinite(value) && value > 0) cumulativeRevenue += value;
    const margin = (margContr * cumulativeRevenue) / total;
    if (breakEvenDay === null && totalFixos > 0 && margin >= totalFixos) breakEvenDay = day;
    return { day, margin, fixed: totalFixos };
  });
  return { days, breakEvenDay };
}

export type DreComparisonRow = { label: string; current: number; previous: number; changePct: number | null; favorable: boolean | null };

/** Variação linha a linha. Para custo, subir é desfavorável. */
export function dreMonthComparison(
  current: { recLiq: number; cmv: number; margBruta: number; totalFixos: number; lucroLiq: number },
  previous: { recLiq: number; cmv: number; margBruta: number; totalFixos: number; lucroLiq: number },
): DreComparisonRow[] {
  const rows: Array<[string, keyof typeof current, 1 | -1]> = [
    ["Receita líquida", "recLiq", 1],
    ["CMV", "cmv", -1],
    ["Margem bruta", "margBruta", 1],
    ["Despesas fixas", "totalFixos", -1],
    ["Lucro líquido", "lucroLiq", 1],
  ];
  return rows.map(([label, key, sign]) => {
    const cur = current[key];
    const prev = previous[key];
    const valid = Number.isFinite(cur) && Number.isFinite(prev) && prev !== 0;
    const changePct = valid ? ((cur - prev) / Math.abs(prev)) * 100 : null;
    return {
      label,
      current: cur,
      previous: prev,
      changePct,
      favorable: changePct === null || changePct === 0 ? null : changePct * sign > 0,
    };
  });
}
