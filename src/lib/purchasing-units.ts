import { convertValue } from '@/lib/conversion';
import { type BaseProduct, type Product, type PurchaseUnitType } from '@/types';

export type PurchaseUnitOption = {
  type: PurchaseUnitType;
  label: string;
};

type ConversionResult = {
  ok: true;
  baseUnitsPerPurchaseUnit: number;
};

type ConversionFailure = {
  ok: false;
  error: string;
};

export function hasValidLogisticPurchaseUnit(product: Pick<Product, 'multiplo_caixa' | 'rotulo_caixa'>) {
  return !!product.rotulo_caixa && !!product.multiplo_caixa && product.multiplo_caixa > 0;
}

export function getContentPurchaseUnitLabel(product: Pick<Product, 'packageType' | 'unit'>) {
  return product.packageType || product.unit || 'un';
}

export function getDefaultPurchaseUnitType(product: Pick<Product, 'multiplo_caixa' | 'rotulo_caixa'>): PurchaseUnitType {
  return hasValidLogisticPurchaseUnit(product) ? 'content' : 'content';
}

export function getPurchaseUnitLabel(
  product: Pick<Product, 'packageType' | 'unit' | 'multiplo_caixa' | 'rotulo_caixa'>,
  purchaseUnitType: PurchaseUnitType | undefined,
) {
  if (purchaseUnitType === 'logistic' && hasValidLogisticPurchaseUnit(product)) {
    return product.rotulo_caixa!;
  }
  return getContentPurchaseUnitLabel(product);
}

export function getPurchaseUnitOptions(
  product: Pick<Product, 'packageType' | 'unit' | 'multiplo_caixa' | 'rotulo_caixa'>,
): PurchaseUnitOption[] {
  const options: PurchaseUnitOption[] = [
    { type: 'content', label: getContentPurchaseUnitLabel(product) },
  ];
  if (hasValidLogisticPurchaseUnit(product)) {
    options.push({ type: 'logistic', label: product.rotulo_caixa! });
  }
  return options;
}

export function getBaseUnitsPerPurchaseUnit(
  product: Pick<Product, 'packageSize' | 'unit' | 'category' | 'multiplo_caixa' | 'rotulo_caixa'>,
  baseProduct: Pick<BaseProduct, 'unit'>,
  purchaseUnitType: PurchaseUnitType | undefined,
): ConversionResult | ConversionFailure {
  if (!product.packageSize || product.packageSize <= 0) {
    return { ok: false, error: 'Produto derivado sem conteúdo válido cadastrado.' };
  }

  let contentUnitsPerPackage: number;
  try {
    contentUnitsPerPackage = convertValue(
      product.packageSize,
      product.unit,
      baseProduct.unit,
      product.category,
    );
  } catch {
    return { ok: false, error: 'Falha ao converter a unidade do derivado para a unidade base.' };
  }

  if (!contentUnitsPerPackage || contentUnitsPerPackage <= 0) {
    return { ok: false, error: 'Conversão inválida entre derivado e unidade base.' };
  }

  if (purchaseUnitType === 'logistic') {
    if (!hasValidLogisticPurchaseUnit(product)) {
      return { ok: false, error: 'A unidade logística foi escolhida sem logística válida cadastrada.' };
    }
    return {
      ok: true,
      baseUnitsPerPurchaseUnit: contentUnitsPerPackage * product.multiplo_caixa!,
    };
  }

  return { ok: true, baseUnitsPerPurchaseUnit: contentUnitsPerPackage };
}

export function calculatePricePerBaseUnit(
  unitPriceConfirmed: number,
  product: Pick<Product, 'packageSize' | 'unit' | 'category' | 'multiplo_caixa' | 'rotulo_caixa'>,
  baseProduct: Pick<BaseProduct, 'unit'>,
  purchaseUnitType: PurchaseUnitType | undefined,
): ConversionResult & { pricePerBaseUnit: number } | ConversionFailure {
  const conversion = getBaseUnitsPerPurchaseUnit(product, baseProduct, purchaseUnitType);
  if (!conversion.ok) return conversion;

  return {
    ...conversion,
    pricePerBaseUnit: unitPriceConfirmed / conversion.baseUnitsPerPurchaseUnit,
  };
}

export function calculateStockQuantityFromPurchase(
  purchaseQuantity: number,
  purchaseProduct: Pick<Product, 'packageSize' | 'unit' | 'category' | 'multiplo_caixa' | 'rotulo_caixa'>,
  stockProduct: Pick<Product, 'packageSize' | 'unit' | 'category'>,
  baseProduct: Pick<BaseProduct, 'unit'>,
  purchaseUnitType: PurchaseUnitType | undefined,
): { ok: true; stockQuantity: number; baseQuantity: number } | ConversionFailure {
  const purchaseConversion = getBaseUnitsPerPurchaseUnit(
    purchaseProduct,
    baseProduct,
    purchaseUnitType,
  );
  if (!purchaseConversion.ok) return purchaseConversion;

  if (!stockProduct.packageSize || stockProduct.packageSize <= 0) {
    return { ok: false, error: 'A unidade de estoque escolhida não possui conteúdo válido cadastrado.' };
  }

  let baseUnitsPerStockUnit: number;
  try {
    baseUnitsPerStockUnit = convertValue(
      stockProduct.packageSize,
      stockProduct.unit,
      baseProduct.unit,
      stockProduct.category,
    );
  } catch {
    return { ok: false, error: 'Falha ao converter a unidade de estoque escolhida para a unidade base.' };
  }

  if (!baseUnitsPerStockUnit || baseUnitsPerStockUnit <= 0) {
    return { ok: false, error: 'Conversão inválida para a unidade de estoque escolhida.' };
  }

  const baseQuantity = purchaseQuantity * purchaseConversion.baseUnitsPerPurchaseUnit;
  return {
    ok: true,
    stockQuantity: baseQuantity / baseUnitsPerStockUnit,
    baseQuantity,
  };
}
