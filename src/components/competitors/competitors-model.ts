import type { Competitor, CompetitorGroup, CompetitorPrice, CompetitorProduct } from "@/types";

export const STALE_DAYS = 30;
/** Diferença percentual a partir da qual o preço conta como acima ou abaixo do concorrente. */
export const GAP_THRESHOLD = 5;

export type LatestPrice = { price: number; date: string };

export type SimulationLike = {
  id: string;
  name: string;
  salePrice: number;
  totalCmv: number;
  profitPercentage?: number;
};

export function daysSince(iso: string, now = Date.now()) {
  return Math.floor((now - new Date(iso).getTime()) / 86_400_000);
}

/** competitorProductId → preço coletado mais recente. */
export function latestPriceByProduct(prices: CompetitorPrice[]) {
  const map = new Map<string, LatestPrice>();
  for (const price of prices) {
    const current = map.get(price.competitorProductId);
    if (!current || new Date(price.data_coleta) > new Date(current.date)) {
      map.set(price.competitorProductId, { price: price.price, date: price.data_coleta });
    }
  }
  return map;
}

export function productsByCompetitor(products: CompetitorProduct[]) {
  const map = new Map<string, CompetitorProduct[]>();
  for (const product of products) {
    map.set(product.competitorId, [...(map.get(product.competitorId) ?? []), product]);
  }
  return map;
}

/** Quanto o seu preço está acima (+) ou abaixo (−) do concorrente, em %. */
export function priceGapPercent(salePrice: number, competitorPrice: number): number | null {
  if (!(salePrice > 0) || !(competitorPrice > 0)) return null;
  return (salePrice / competitorPrice - 1) * 100;
}

export type GapKind = "above" | "below" | "neutral";

export function classifyGap(gap: number): GapKind {
  if (gap > GAP_THRESHOLD) return "above";
  if (gap < -GAP_THRESHOLD) return "below";
  return "neutral";
}

/** Margem (%) se o seu preço fosse o do concorrente, dado o seu CMV. */
export function marginAtPrice(competitorPrice: number, totalCmv: number): number | null {
  return competitorPrice > 0 ? ((competitorPrice - totalCmv) / competitorPrice) * 100 : null;
}

/** Só as simulações vinculadas a produtos dos concorrentes escolhidos. */
export function correlatedSimulations<T extends SimulationLike>(
  simulations: T[],
  selectedCompetitorIds: string[],
  productMap: Map<string, CompetitorProduct[]>
): T[] {
  if (selectedCompetitorIds.length === 0) return [];
  const ids = new Set<string>();
  for (const competitorId of selectedCompetitorIds) {
    for (const product of productMap.get(competitorId) ?? []) {
      if (product.ksProductId) ids.add(product.ksProductId);
    }
  }
  return simulations.filter((simulation) => ids.has(simulation.id));
}

export function summarizeComparison(
  rows: SimulationLike[],
  selectedCompetitorIds: string[],
  productMap: Map<string, CompetitorProduct[]>,
  priceMap: Map<string, LatestPrice>,
  now = Date.now()
) {
  let above = 0;
  let below = 0;
  let neutral = 0;
  let stale = 0;
  const gaps: number[] = [];
  for (const simulation of rows) {
    for (const competitorId of selectedCompetitorIds) {
      const product = (productMap.get(competitorId) ?? []).find((entry) => entry.ksProductId === simulation.id);
      const latest = product ? priceMap.get(product.id) : undefined;
      if (!latest) continue;
      const gap = priceGapPercent(simulation.salePrice, latest.price);
      if (gap === null) continue;
      gaps.push(gap);
      const kind = classifyGap(gap);
      if (kind === "above") above++;
      else if (kind === "below") below++;
      else neutral++;
      if (daysSince(latest.date, now) > STALE_DAYS) stale++;
    }
  }
  const avgGap = gaps.length ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length : 0;
  return { above, below, neutral, stale, avgGap, total: gaps.length };
}

/** CSV (separador ;, BOM) do estudo de preço, no formato usado pelo Excel em pt-BR. */
export function buildComparisonCsv(
  rows: SimulationLike[],
  selectedCompetitorIds: string[],
  competitors: Competitor[],
  productMap: Map<string, CompetitorProduct[]>,
  priceMap: Map<string, LatestPrice>
) {
  const header = ["Mercadoria", "Seu preço", "Sua margem %", ...selectedCompetitorIds.map((id) => competitors.find((c) => c.id === id)?.name ?? id)];
  const body = rows.map((simulation) => {
    const cols = [simulation.name, simulation.salePrice.toFixed(2).replace(".", ","), simulation.profitPercentage?.toFixed(1).replace(".", ",") ?? ""];
    for (const competitorId of selectedCompetitorIds) {
      const product = (productMap.get(competitorId) ?? []).find((entry) => entry.ksProductId === simulation.id);
      const latest = product ? priceMap.get(product.id) : undefined;
      cols.push(latest ? latest.price.toFixed(2).replace(".", ",") : "");
    }
    return cols;
  });
  const csv = [header, ...body].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";")).join("\n");
  return `﻿${csv}`;
}

export function groupNameMap(groups: CompetitorGroup[]) {
  return new Map(groups.map((group) => [group.id, group.name]));
}

export function competitorAddress(competitor: Competitor) {
  const parts = [competitor.address, [competitor.city, competitor.state].filter(Boolean).join(" - ")].filter(Boolean);
  return parts.join(", ");
}
