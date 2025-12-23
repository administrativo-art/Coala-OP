

import {
  type ConsumptionReport,
  type ConsumptionAnalysisItem as ConsumptionItem,
  type BaseProduct,
} from '@/types';


/**
 * Valida e normaliza um item de consumo
 */
export function validateConsumptionItem(item: any): ConsumptionItem | null {
  if (!item || typeof item !== 'object') {
    console.warn('Item de consumo inválido: não é um objeto', item);
    return null;
  }

  const { baseProductId, consumedQuantity, productName, productId } = item;

  // Validar baseProductId
  if (!baseProductId || typeof baseProductId !== 'string' || baseProductId.trim() === '') {
    // Tenta usar o productName como fallback se baseProductId não existir
    if (!productName || typeof productName !== 'string' || productName.trim() === '') {
      console.warn('Item sem baseProductId ou productName válido:', item);
      return null;
    }
  }

  // Validar consumedQuantity
  const quantity = Number(consumedQuantity);
  if (isNaN(quantity) || quantity < 0) {
    console.warn('Item com consumedQuantity inválido:', item);
    return null;
  }

  // Validar productName
  if (!productName || typeof productName !== 'string') {
    console.warn('Item sem productName válido:', item);
    return null;
  }

  return {
    ...item,
    productId: (productId || '').trim(), // Ensure productId is always a string
    baseProductId: (baseProductId || '').trim(), // Pode ser vazio aqui, será preenchido depois
    consumedQuantity: quantity,
    productName: productName.trim()
  };
}

/**
 * Valida e normaliza um relatório de consumo
 */
export function validateConsumptionReport(report: any): ConsumptionReport | null {
  if (!report || typeof report !== 'object') {
    console.warn('Relatório de consumo inválido: não é um objeto', report);
    return null;
  }

  const { id, results, kioskId, month, year } = report;

  // Validar ID
  if (!id || typeof id !== 'string') {
    console.warn('Relatório sem ID válido:', report);
    return null;
  }

  // Validar kioskId, month, year
  if (!kioskId || typeof kioskId !== 'string' || !month || !year) {
    console.warn('Relatório com informações de período ou quiosque inválidas:', report);
    return null;
  }

  // Validar results
  if (!Array.isArray(results)) {
    console.warn('Relatório sem results válido:', report);
    return null;
  }

  // Validar e filtrar itens
  const validItems = results
    .map(validateConsumptionItem)
    .filter((item): item is ConsumptionItem => item !== null);

  if (validItems.length === 0) {
    console.warn('Relatório sem itens válidos:', report);
    return null;
  }

  return {
    ...report,
    id: id.trim(),
    results: validItems
  };
}

/**
 * Valida e normaliza um produto base
 */
export function validateBaseProduct(product: any): BaseProduct | null {
  if (!product || typeof product !== 'object') {
    console.warn('Produto base inválido: não é um objeto', product);
    return null;
  }

  const { id, name, unit } = product;

  // Validar ID
  if (!id || typeof id !== 'string' || id.trim() === '') {
    console.warn('Produto base sem ID válido:', product);
    return null;
  }

  // Validar name
  if (!name || typeof name !== 'string' || name.trim() === '') {
    console.warn('Produto base sem nome válido:', product);
    return null;
  }

  // Validar unit
  if (!unit || typeof unit !== 'string' || unit.trim() === '') {
    console.warn('Produto base sem unidade válida:', product);
    return null;
  }

  return {
    ...product,
    id: id.trim(),
    name: name.trim(),
    unit: unit.trim()
  };
}

/**
 * Valida uma lista de relatórios de consumo
 */
export function validateConsumptionReports(reports: any[]): ConsumptionReport[] {
  if (!Array.isArray(reports)) {
    console.error('Lista de relatórios inválida: não é um array');
    return [];
  }

  const validReports = reports
    .map(validateConsumptionReport)
    .filter((report): report is ConsumptionReport => report !== null);

  const invalidCount = reports.length - validReports.length;
  if (invalidCount > 0) {
    console.warn(`${invalidCount} relatório(s) inválido(s) foram descartados`);
  }

  return validReports;
}

/**
 * Valida uma lista de produtos base
 */
export function validateBaseProducts(products: any[]): BaseProduct[] {
  if (!Array.isArray(products)) {
    console.error('Lista de produtos base inválida: não é um array');
    return [];
  }

  const validProducts = products
    .map(validateBaseProduct)
    .filter((product): product is BaseProduct => product !== null);

  const invalidCount = products.length - validProducts.length;
  if (invalidCount > 0) {
    console.warn(`${invalidCount} produto(s) base inválido(s) foram descartados`);
  }

  return validProducts;
}

/**
 * Detecta itens órfãos (sem baseProduct correspondente)
 */
export function detectOrphanItems(
  reports: ConsumptionReport[], 
  baseProducts: BaseProduct[]
): ConsumptionItem[] {
  const baseProductIds = new Set(baseProducts.map(bp => bp.id));
  const orphanItems: ConsumptionItem[] = [];

  reports.forEach(report => {
    report.results.forEach(item => {
      if (!baseProductIds.has(item.baseProductId)) {
        orphanItems.push(item);
      }
    });
  });

  return orphanItems;
}

/**
 * Gera relatório de integridade dos dados
 */
export function generateDataIntegrityReport(
  reports: ConsumptionReport[], 
  baseProducts: BaseProduct[]
) {
  const orphanItems = detectOrphanItems(reports, baseProducts);
  const totalItems = reports.reduce((sum, report) => sum + report.results.length, 0);
  
  // Estatísticas de produtos base
  const baseProductsUsed = new Set(
    reports.flatMap(report => 
      report.results.map(item => item.baseProductId)
    )
  );

  const unusedBaseProducts = baseProducts.filter(bp => 
    !baseProductsUsed.has(bp.id)
  );

  return {
    totalReports: reports.length,
    totalItems: totalItems,
    totalBaseProducts: baseProducts.length,
    baseProductsUsed: baseProductsUsed.size,
    unusedBaseProducts: unusedBaseProducts.length,
    orphanItems: orphanItems.length,
    dataIntegrityScore: totalItems > 0 ? ((totalItems - orphanItems.length) / totalItems) * 100 : 100,
    issues: {
      orphanItems: orphanItems.map(item => ({
        productName: item.productName,
        baseProductId: item.baseProductId,
        quantity: item.consumedQuantity
      })),
      unusedBaseProducts: unusedBaseProducts.map(bp => ({
        id: bp.id,
        name: bp.name,
        unit: bp.unit
      }))
    }
  };
}
