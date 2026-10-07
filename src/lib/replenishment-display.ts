import type { BaseProduct, BaseProductStockLevel, Product } from '@/types';
import { physicalShortage } from '@/lib/replenishment-policy';
import { convertValue } from '@/lib/conversion';

export type OperationalMinimum = {
  minimum: number | null;
  status: 'calculated' | 'pending' | 'partial' | 'no_dependents' | 'legacy' | 'unconfigured';
  label: string;
  sourceLabel?: string;
  limitation?: string;
};

export function operationalMinimum(level: BaseProductStockLevel | undefined, enabled: boolean | null): OperationalMinimum {
  const status = level?.calculationStatus;
  if (enabled === null || status === 'pending' || status === 'partial') return {
    minimum: null,
    status: status === 'partial' ? 'partial' : 'pending',
    label: enabled === null ? 'Política indisponível; mínimo não verificado' : status === 'partial' ? 'Cálculo parcial; mínimo pendente' : 'Cálculo pendente',
    limitation: level?.sourceLimitation,
  };
  if (!enabled) return level?.min == null
    ? { minimum: null, status: 'unconfigured', label: 'Sem meta legada' }
    : { minimum: level.min, status: 'legacy', label: 'Mínimo operacional legado' };
  const sourceLabel = level?.source === 'pdv_internal' ? 'Consumo do PDV interno'
    : level?.source === 'transfer_proxy' ? 'Transferências como aproximação de abastecimento'
    : 'Sem fonte de consumo';
  if (status === 'no_dependents') return { minimum: 0, status, label: 'Sem unidades abastecidas pelo CD', sourceLabel, limitation: level?.sourceLimitation };
  if (status !== 'calculated' || level?.min == null) return {
    minimum: null,
    status: 'pending',
    label: 'Cálculo pendente',
    sourceLabel,
    limitation: level?.sourceLimitation,
  };
  return { minimum: level.min, status, label: 'Mínimo automático', sourceLabel, limitation: level.sourceLimitation };
}

export function previewMinimum(base: BaseProduct, kioskId: string, enabled: boolean) {
  return enabled ? null : operationalMinimum(base.replenishmentPreview?.[kioskId], true);
}

/** Operational alerts must use routed demand, never substitute the whole network after activation. */
export function operationalDailyAverage(level: BaseProductStockLevel | undefined,
  enabled: boolean | null, legacyAverage: number): number | null {
  const minimum = operationalMinimum(level, enabled);
  if (minimum.minimum === null) return null;
  if (minimum.status === 'no_dependents') return 0;
  const average = enabled ? level?.avgDaily : legacyAverage;
  return typeof average === 'number' && Number.isFinite(average) && average >= 0 ? average : null;
}

export function availablePackages(quantity: number, reservedQuantity?: number) {
  return Math.max(0, (Number(quantity) || 0) - (Number(reservedQuantity) || 0));
}

export const shortage = physicalShortage;

export function supplyMode(level: BaseProductStockLevel | undefined) {
  return level?.supplyMode === 'direct' ? 'direct' : 'cd';
}

export function getUnitsPerPackageForProduct(product: Product, baseProduct: BaseProduct): number {
  try {
    const packageSize = Number(product.packageSize);
    if (packageSize > 0) return convertValue(packageSize, product.unit, baseProduct.unit, product.category);
    if (product.unit?.toLowerCase() === baseProduct.unit?.toLowerCase()) return 1;
    if (['Unidade', 'Embalagem', 'Vestimenta'].includes(product.category)) return 1;
    return 0;
  } catch { return 0; }
}
