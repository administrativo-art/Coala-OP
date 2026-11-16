/** Pure contract shared with the app. No Firebase imports: both summary writers use this projection. */
export const CASH_CLOSURE_DRE_VERSION = 2 as const;

/** PDV payments, net of change, before supply/withdrawal or human expected adjustments. */
export type PdvSalesSource = { version: 1; amountCents: number | null };
export type CashDifferences = { version: 1; shortageCents: number | null; surplusCents: number | null };
export type CashClosureDreSource = {
  date: string;
  pdvSales?: PdvSalesSource;
  finalizedCashDifferences?: CashDifferences;
  dreSelectedCashDifferences?: CashDifferences | null;
  drePdvFallbackOperatorCount?: number | null;
  status?: string;
  syncError?: string | null;
  pdvChangedAfterApproval?: boolean;
  operatorCount?: number;
  finalizedOperatorCount?: number;
};
export type CashClosureDreSummary = {
  dreVersion: 2;
  dreRevenueTotalCents: number | null;
  dreCashShortageTotalCents: number | null;
  dreCashSurplusTotalCents: number | null;
  dreCoverage: {
    closureCount: number;
    revenueClosureCount: number;
    cashDifferenceClosureCount: number;
    dates: string[];
    revenueDates: string[];
    cashDifferenceDates: string[];
    pendingOperatorCount?: number | null;
    staleCashDifferenceClosureCount?: number;
    pdvFallbackOperatorCount?: number | null;
  };
};

export function isCents(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

export function pdvSalesCents(source: PdvSalesSource | undefined): number | null {
  return source?.version === 1 && isCents(source.amountCents)
    ? source.amountCents : null;
}

export function sumPdvSales(sources: Array<PdvSalesSource | undefined>): PdvSalesSource {
  const values = sources.map(pdvSalesCents);
  const total = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  return { version: 1,
    amountCents: values.every(value => value !== null) && isCents(total) ? total : null };
}

export function completeCashDifferences(value: CashDifferences | null | undefined): value is CashDifferences & {
  shortageCents: number; surplusCents: number;
} {
  return value?.version === 1
    && isCents(value.shortageCents) && value.shortageCents >= 0
    && isCents(value.surplusCents) && value.surplusCents >= 0;
}

export function sumCashDifferences(values: Array<CashDifferences | null | undefined>): CashDifferences {
  if (!values.every(completeCashDifferences)) {
    return { version: 1, shortageCents: null, surplusCents: null };
  }
  const shortageCents = values.reduce((sum, value) => sum + value.shortageCents, 0);
  const surplusCents = values.reduce((sum, value) => sum + value.surplusCents, 0);
  return { version: 1,
    shortageCents: isCents(shortageCents) ? shortageCents : null,
    surplusCents: isCents(surplusCents) ? surplusCents : null };
}

export function summarizeCashClosureDre(closures: CashClosureDreSource[]): CashClosureDreSummary {
  const dates = closures.map(item => item.date).sort();
  // Duplicate days must never masquerade as complete coverage.
  const validDates = dates.every(date => /^\d{4}-\d{2}-\d{2}$/.test(date))
    && new Set(dates).size === dates.length;
  const revenueRows = closures.filter(item => pdvSalesCents(item.pdvSales) !== null
    && item.status !== 'sync_error' && !item.syncError);
  const cashRows = closures.filter(item => completeCashDifferences(item.dreSelectedCashDifferences)
    && !item.pdvChangedAfterApproval);
  const fallbackCounts = closures.map(item => isCents(item.drePdvFallbackOperatorCount)
    && item.drePdvFallbackOperatorCount! >= 0 && isCents(item.operatorCount)
    && item.drePdvFallbackOperatorCount! <= item.operatorCount!
    ? item.drePdvFallbackOperatorCount! : null);
  const pendingCounts = closures.map(item => {
    const finalized = item.finalizedOperatorCount ?? (item.status === 'approved' ? item.operatorCount : 0);
    return isCents(item.operatorCount) && isCents(finalized) && finalized >= 0 && finalized <= item.operatorCount
      ? item.operatorCount - finalized : null;
  });
  const revenue = sumPdvSales(revenueRows.map(item => item.pdvSales));
  const cash = sumCashDifferences(cashRows.map(item => item.dreSelectedCashDifferences));
  const hasRows = closures.length > 0 && validDates;
  return {
    dreVersion: CASH_CLOSURE_DRE_VERSION,
    dreRevenueTotalCents: hasRows && revenueRows.length === closures.length ? revenue.amountCents : null,
    dreCashShortageTotalCents: hasRows && cashRows.length === closures.length ? cash.shortageCents : null,
    dreCashSurplusTotalCents: hasRows && cashRows.length === closures.length ? cash.surplusCents : null,
    dreCoverage: {
      closureCount: closures.length,
      revenueClosureCount: revenueRows.length,
      cashDifferenceClosureCount: cashRows.length,
      dates,
      revenueDates: revenueRows.map(item => item.date).sort(),
      cashDifferenceDates: cashRows.map(item => item.date).sort(),
      pendingOperatorCount: pendingCounts.every(value => value !== null)
        ? pendingCounts.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null,
      staleCashDifferenceClosureCount: closures.filter(item => item.pdvChangedAfterApproval).length,
      pdvFallbackOperatorCount: fallbackCounts.every(value => value !== null)
        ? fallbackCounts.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null,
    },
  };
}
