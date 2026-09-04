export const RECENT_RECONCILIATION_DAYS = 7;
export const MONTHLY_RECONCILIATION_DAYS = new Set([2, 7]);

export type PdvSnapshotMetrics = {
  couponCount: number;
  itemQuantity: number;
  revenueCents: number;
  fingerprint: string;
};

export type PendingDecrease = {
  fingerprint: string;
  confirmations: number;
};

export type PdvSnapshotDecision =
  | { action: 'apply'; reason: 'first_snapshot' | 'changed' | 'confirmed_decrease' }
  | { action: 'unchanged'; clearPending: boolean }
  | { action: 'hold'; reason: 'empty_after_data' | 'unconfirmed_decrease'; confirmations: number };

function isoDateAtNoon(date: string): Date {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Data ISO inválida: ${date}`);
  return parsed;
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function shiftIsoDate(date: string, days: number): string {
  const shifted = isoDateAtNoon(date);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return formatIsoDate(shifted);
}

export function previousMonthDates(businessDate: string): string[] {
  const current = isoDateAtNoon(businessDate);
  const firstCurrentMonth = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1, 12));
  const cursor = new Date(firstCurrentMonth);
  cursor.setUTCMonth(cursor.getUTCMonth() - 1);

  const dates: string[] = [];
  while (cursor < firstCurrentMonth) {
    dates.push(formatIsoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function reconciliationDates(businessDate: string): string[] {
  const dates = new Set<string>();
  for (let offset = 1; offset <= RECENT_RECONCILIATION_DAYS; offset += 1) {
    dates.add(shiftIsoDate(businessDate, -offset));
  }

  const dayOfMonth = Number(businessDate.slice(8, 10));
  if (MONTHLY_RECONCILIATION_DAYS.has(dayOfMonth)) {
    for (const date of previousMonthDates(businessDate)) dates.add(date);
  }

  return [...dates].sort();
}

export function decidePdvSnapshot(params: {
  existing: PdvSnapshotMetrics | null;
  incoming: PdvSnapshotMetrics;
  pendingDecrease: PendingDecrease | null;
}): PdvSnapshotDecision {
  const { existing, incoming, pendingDecrease } = params;
  if (!existing) return { action: 'apply', reason: 'first_snapshot' };

  if (existing.fingerprint === incoming.fingerprint) {
    return { action: 'unchanged', clearPending: pendingDecrease !== null };
  }

  const isDecrease = incoming.couponCount < existing.couponCount
    || incoming.itemQuantity < existing.itemQuantity
    || incoming.revenueCents < existing.revenueCents;
  if (!isDecrease) return { action: 'apply', reason: 'changed' };

  if (incoming.couponCount === 0 && existing.couponCount > 0) {
    return { action: 'hold', reason: 'empty_after_data', confirmations: 0 };
  }

  const confirmations = pendingDecrease?.fingerprint === incoming.fingerprint
    ? pendingDecrease.confirmations + 1
    : 1;
  if (confirmations >= 2) {
    return { action: 'apply', reason: 'confirmed_decrease' };
  }

  return { action: 'hold', reason: 'unconfirmed_decrease', confirmations };
}
