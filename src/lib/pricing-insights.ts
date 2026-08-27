export type PricingCommercialStatus = 'loss' | 'below' | 'met' | 'none';

export function calculateGrossMargin(price: number, cmv: number) {
  const value = price - cmv;
  const percentage = price > 0 ? (value / price) * 100 : 0;
  return { value, percentage };
}

export function getPricingCommercialStatus(
  price: number,
  cmv: number,
  goal?: number | null,
): PricingCommercialStatus {
  const { value, percentage } = calculateGrossMargin(price, cmv);
  if (value < 0) return 'loss';
  if (goal === null || goal === undefined) return 'none';
  return percentage >= goal ? 'met' : 'below';
}

export function getCmvPercentage(price: number, cmv: number) {
  return price > 0 ? (cmv / price) * 100 : 0;
}

export function hasAbnormalCmv(price: number, cmv: number, threshold = 60) {
  return getCmvPercentage(price, cmv) > threshold;
}

export function calculatePriceSpread(prices: Array<number | null | undefined>) {
  const validPrices = prices.filter((price): price is number => Number.isFinite(price) && Number(price) > 0);
  if (validPrices.length < 2) return 0;
  const minimum = Math.min(...validPrices);
  const maximum = Math.max(...validPrices);
  return ((maximum - minimum) / minimum) * 100;
}
