import type { Product } from '@/types';

export type StockRegistrationMode = 'individual' | 'package';

export function suggestedUnitsPerPackage(name: string): number | null {
  const match = name.match(/(?:^|[\s(])(?:kit|pacote|caixa|cx|c\/)\s*(?:com\s+|de\s+)?(\d{1,5})(?=\b|\/)/i);
  const count = Number(match?.[1] ?? 0);
  return Number.isInteger(count) && count > 1 ? count : null;
}

export function purchasePackIssue(
  product: Pick<Product, 'packageSize' | 'unit' | 'multiplo_caixa' | 'rotulo_caixa'>,
  unitsPerPackage: number,
  stockMode: StockRegistrationMode,
): string | null {
  if (!Number.isInteger(unitsPerPackage) || unitsPerPackage < 2) return 'Informe quantas unidades existem em cada embalagem.';
  if (stockMode === 'individual') {
    if (product.packageSize !== 1 || product.unit !== 'un') return 'Selecione o cadastro da unidade avulsa para estocar cada item separadamente.';
    return null;
  }
  if (product.packageSize !== unitsPerPackage || product.unit !== 'un') {
    return 'Selecione um cadastro de embalagem com essa quantidade de unidades para estocar o volume fechado.';
  }
  return null;
}

export function purchaseProductForPack<T extends Pick<Product, 'multiplo_caixa' | 'rotulo_caixa'>>(
  product: T,
  isMultipack: boolean,
  unitsPerPackage: number,
  stockMode: StockRegistrationMode | null | undefined,
): T {
  if (!isMultipack || stockMode !== 'individual') return product;
  return { ...product, multiplo_caixa: unitsPerPackage, rotulo_caixa: 'Embalagem' };
}

export function purchasePackPreview(quantity: number, unitPrice: number, discount: number, unitsPerPackage: number, stockMode: StockRegistrationMode) {
  const total = Math.max(quantity * unitPrice - discount, 0);
  const stockQuantity = stockMode === 'individual' ? quantity * unitsPerPackage : quantity;
  return { total, stockQuantity, stockUnitCost: stockQuantity > 0 ? total / stockQuantity : 0 };
}
