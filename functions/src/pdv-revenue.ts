/** Monetary contract shared by Functions, the app and maintenance scripts. */
export const PDV_REVENUE_VERSION = 2;
type RecordValue = Record<string, unknown>;

export class PdvRevenueError extends Error {
  readonly code = 'PDV_REVENUE_CONTRACT_FAILED';
  constructor() { super('Os valores do cupom PDV não conciliam; importação interrompida.'); }
}

function money(value: unknown, optional = false): number {
  if (optional && (value === undefined || value === null)) return 0;
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '') throw new PdvRevenueError();
  const n = Number(value);
  const result = Math.round(n * 100);
  if (!Number.isFinite(n) || n < 0 || !Number.isSafeInteger(result)) throw new PdvRevenueError();
  return result;
}

function cancelled(item: RecordValue): boolean {
  const value = item.iscancelado ?? item.IsCancelado;
  return value === true || value === 1 || (typeof value === 'string' && ['TRUE', '1', 'CANCELADO'].includes(value.toUpperCase()));
}

/** Allocate a coupon adjustment in cents, preserving its exact total. */
function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(sum) || (!sum && total)) throw new PdvRevenueError();
  if (!sum) return weights.map(() => 0);
  const ratios = weights.map((w, index) => {
    const numerator = BigInt(total) * BigInt(w);
    return { index, cents: Number(numerator / BigInt(sum)), remainder: numerator % BigInt(sum) };
  });
  const result = ratios.map(x => x.cents);
  let remaining = total - result.reduce((a, b) => a + b, 0);
  for (const x of [...ratios].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1)) {
    if (remaining-- <= 0) break;
    result[x.index]++;
  }
  return result;
}

export function normalizePdvCouponRevenue(coupon: RecordValue) {
  const raw = coupon.Itens ?? coupon.itens;
  if (!Array.isArray(raw) || raw.some(x => !x || typeof x !== 'object' || Array.isArray(x))) throw new PdvRevenueError();
  const items = raw as RecordValue[];
  const gross = items.map(i => cancelled(i) ? 0 : money(i.valortotal ?? i.ValorTotal));
  const discounts = items.map(i => cancelled(i) ? 0 : money(i.valordesconto ?? i.ValorDesconto, true));
  const additions = items.map(i => cancelled(i) ? 0 : money(i.valoracrescimo ?? i.ValorAcrescimo, true));
  const net = gross.map((v, i) => v - discounts[i] + additions[i]);
  if (net.some(v => v < 0)) throw new PdvRevenueError();
  const grossCents = gross.reduce((a, b) => a + b, 0);
  const itemNet = net.reduce((a, b) => a + b, 0);
  const headerDiscount = money(coupon.valordesconto ?? coupon.ValorDesconto, true);
  const headerAddition = money(coupon.valoracrescimo ?? coupon.ValorAcrescimo, true);
  const delivery = money(coupon.valorentrega ?? coupon.ValorEntrega, true);
  const headerAdjustment = headerAddition + delivery - headerDiscount;
  const reported = coupon.valortotal ?? coupon.ValorTotal;
  const source = reported === undefined || reported === null ? 'items_fallback' : 'coupon_total';
  const revenueCents = source === 'coupon_total' ? money(reported) : itemNet + headerAdjustment;
  // Accept already-net envelopes without subtracting the same discount twice.
  const candidates = [
    { total: itemNet + headerAdjustment, weights: net },
    { total: itemNet, weights: net },
    { total: grossCents + headerAdjustment, weights: gross },
    { total: grossCents, weights: gross },
  ];
  const match = candidates.find(c => c.total === revenueCents);
  if (!match || revenueCents < 0 || !Number.isSafeInteger(revenueCents)) throw new PdvRevenueError();
  const itemRevenueCents = match.total === match.weights.reduce((a, b) => a + b, 0)
    ? match.weights : allocate(revenueCents, match.weights);
  if (itemRevenueCents.reduce((a, b) => a + b, 0) !== revenueCents) throw new PdvRevenueError();
  return { revenueCents, itemRevenueCents, grossCents, adjustmentCents: revenueCents - grossCents, source };
}
