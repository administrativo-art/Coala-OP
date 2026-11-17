import { format, subMonths } from "date-fns";

/** Competência anterior no formato `yyyy-MM`, ou `null` quando antecede o início da DRE. */
export function previousDreMonthKey(monthKey: string, startMonthKey: string): string | null {
  const [year, month] = monthKey.split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month)) return null;
  const previous = format(subMonths(new Date(year, month - 1, 1), 1), "yyyy-MM");
  return previous < startMonthKey ? null : previous;
}

/**
 * Análise horizontal em pontos percentuais da base anterior.
 * Indisponível (NaN) e base zero não viram 0%: retornam `null` para a interface mostrar "—".
 */
export function dreHorizontalVariation(current: number, previous: number | null | undefined): number | null {
  if (previous === null || previous === undefined) return null;
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/**
 * Para linhas de custo, crescer é desfavorável; para receitas e resultados, favorável.
 * `null` quando a variação não pode ser classificada.
 */
export function dreVariationTone(variation: number | null, kind: "cost" | "result"): "good" | "bad" | "neutral" | null {
  if (variation === null) return null;
  if (Math.abs(variation) < 0.05) return "neutral";
  const grew = variation > 0;
  return (kind === "cost" ? !grew : grew) ? "good" : "bad";
}

export type DreCompositionSlice = { key: string; label: string; value: number; share: number };

/**
 * Distribui a receita líquida entre as linhas de custo e a sobra ("para onde vai cada R$ 100").
 * Só é calculada quando todos os valores estão disponíveis e a receita é positiva.
 */
export function dreRevenueComposition(
  netRevenue: number,
  costs: Array<{ key: string; label: string; value: number }>,
): DreCompositionSlice[] | null {
  if (!Number.isFinite(netRevenue) || netRevenue <= 0) return null;
  if (costs.some((cost) => !Number.isFinite(cost.value))) return null;
  const slices = costs
    .filter((cost) => cost.value > 0)
    .map((cost) => ({ ...cost, share: (cost.value / netRevenue) * 100 }));
  const remainder = netRevenue - costs.reduce((total, cost) => total + cost.value, 0);
  slices.push({ key: "remainder", label: remainder >= 0 ? "Sobra" : "Falta", value: remainder, share: (Math.abs(remainder) / netRevenue) * 100 });
  return slices;
}
