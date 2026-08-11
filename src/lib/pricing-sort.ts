export type PricingSortDirection = 'asc' | 'desc';

const AUXILIARY_SKU_PREFIX = '00000';

export function comparePricingSkus(
  firstSku: string | null | undefined,
  secondSku: string | null | undefined,
  direction: PricingSortDirection,
) {
  const first = String(firstSku ?? '').trim();
  const second = String(secondSku ?? '').trim();

  if (direction === 'desc') {
    const firstIsAuxiliary = first.startsWith(AUXILIARY_SKU_PREFIX);
    const secondIsAuxiliary = second.startsWith(AUXILIARY_SKU_PREFIX);

    if (firstIsAuxiliary !== secondIsAuxiliary) {
      return firstIsAuxiliary ? 1 : -1;
    }
  }

  const comparison = first.localeCompare(second, undefined, { numeric: true });
  return direction === 'asc' ? comparison : -comparison;
}
