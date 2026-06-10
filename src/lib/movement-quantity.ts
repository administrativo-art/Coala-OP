import { convertValue } from '@/lib/conversion';
import { type BaseProduct, type MovementRecord, type Product } from '@/types';

/**
 * Helpers de conversão de quantidade de movimento de estoque para a unidade-base.
 * Centralizados aqui para que a Análise de Movimentação e o modal de auditoria
 * usem exatamente o mesmo cálculo (evita divergência de números entre as telas).
 */

export const GENERIC_PACKAGE_UNITS = new Set(['un', 'unidade', 'bag', 'pacote', 'caixa']);

export function getMovementQuantityInBaseUnit(
  movement: Pick<MovementRecord, 'quantityChange'>,
  product: Product,
  baseProduct: BaseProduct,
) {
  const quantity = Number(movement.quantityChange || 0);
  if (!Number.isFinite(quantity)) return 0;

  try {
    const fromUnit = (product.unit || 'un').toLowerCase();
    if (GENERIC_PACKAGE_UNITS.has(fromUnit)) {
      return quantity * Number(product.packageSize || 1);
    }

    const valueOfOnePackage = convertValue(
      Number(product.packageSize || 1),
      product.unit,
      baseProduct.unit,
      product.category,
    );

    return quantity * valueOfOnePackage;
  } catch {
    return quantity * Number(product.packageSize || 1);
  }
}

export function getSignedAdjustmentDelta(type: string, quantityInBase: number) {
  if (!quantityInBase) return 0;
  if (type === 'ENTRADA_CORRECAO' || type === 'ENTRADA_ESTORNO' || type.includes('acréscimo')) {
    return quantityInBase;
  }

  if (
    type === 'SAIDA_CORRECAO' ||
    type === 'SAIDA_ESTORNO' ||
    type.includes('decréscimo') ||
    type.includes('Divergência')
  ) {
    return -quantityInBase;
  }

  return 0;
}
