import type { Product, UnitCategory } from '@/types';
import type { NormalizedProductData, ProductDataSource } from './product-lookup-types';

type OpenFoodFactsProduct = {
  code?: string;
  product_name?: string;
  product_name_pt?: string;
  generic_name?: string;
  brands?: string;
  quantity?: string;
  product_quantity?: number;
  product_quantity_unit?: string;
  categories?: string;
  ingredients_text?: string;
  nutriments?: Record<string, unknown>;
  image_url?: string;
  countries?: string;
};

function nowIso() {
  return new Date().toISOString();
}

function cleanText(value: unknown) {
  return String(value ?? '').trim();
}

function firstText(...values: unknown[]) {
  return values.map(cleanText).find(Boolean) ?? '';
}

function inferUnitCategory(unit?: string): UnitCategory {
  const normalized = cleanText(unit).toLowerCase();
  if (['g', 'kg', 'mg'].includes(normalized)) return 'Massa';
  if (['ml', 'l'].includes(normalized)) return 'Volume';
  return 'Unidade';
}

function normalizeUnit(unit?: string) {
  const normalized = cleanText(unit).toLowerCase();
  if (['g', 'kg', 'mg', 'ml', 'l', 'un'].includes(normalized)) return normalized;
  if (['unidade', 'unidades', 'unit', 'units'].includes(normalized)) return 'un';
  return normalized || 'un';
}

function parseQuantity(rawQuantity?: string, rawValue?: number, rawUnit?: string) {
  if (Number.isFinite(rawValue) && rawValue && rawUnit) {
    return { quantidade: Number(rawValue), unidade_medida: normalizeUnit(rawUnit) };
  }

  const text = cleanText(rawQuantity).replace(',', '.');
  const match = text.match(/(\d+(?:\.\d+)?)\s*(kg|g|mg|l|ml|un|unidade|unidades)\b/i);
  if (!match) return { quantidade: undefined, unidade_medida: undefined };
  return {
    quantidade: Number(match[1]),
    unidade_medida: normalizeUnit(match[2]),
  };
}

function confidenceBySource(source: ProductDataSource) {
  if (source === 'internal') return 1;
  if (source === 'gs1') return 0.96;
  if (source === 'brazilian_commercial') return 0.88;
  if (source === 'open_food_facts') return 0.72;
  return 0.4;
}

export class ProductNormalizer {
  static fromInternalProduct(product: Product): NormalizedProductData {
    return {
      codigo_barras: product.barcode ?? product.codigo_barras ?? '',
      gtin: product.gtin ?? product.barcode ?? product.codigo_barras ?? '',
      nome: product.baseName ?? product.nome ?? '',
      marca: product.brand ?? product.marca,
      descricao: product.description ?? product.descricao ?? product.notes,
      categoria: product.externalCategory,
      categoria_id: product.operationalCategoryId ?? product.categoria_id,
      quantidade: product.packageSize ?? product.quantidade,
      unidade_medida: product.unit ?? product.unidade_medida,
      imagem_url: product.imageUrl ?? product.imagem_url,
      ingredientes: product.ingredients ?? product.ingredientes ?? product.compositionText,
      informacoes_nutricionais: product.nutritionFacts ?? product.informacoes_nutricionais,
      ncm: product.ncm,
      cest: product.cest,
      origem_dados: 'internal',
      confianca: 1,
      data_consulta: product.lastBarcodeLookupAt ?? product.data_consulta ?? nowIso(),
      unitCategory: product.category,
    };
  }

  static fromOpenFoodFacts(barcode: string, payload: Record<string, unknown>): NormalizedProductData | null {
    const product = payload.product as OpenFoodFactsProduct | undefined;
    if (!product) return null;

    const quantity = parseQuantity(product.quantity, product.product_quantity, product.product_quantity_unit);
    const unit = quantity.unidade_medida ?? 'un';
    const name = firstText(product.product_name_pt, product.product_name, product.generic_name);

    if (!name) return null;

    return {
      codigo_barras: barcode,
      gtin: product.code ?? barcode,
      nome: name,
      marca: product.brands,
      descricao: firstText(product.generic_name, product.categories, product.countries),
      categoria: product.categories,
      quantidade: quantity.quantidade,
      unidade_medida: unit,
      imagem_url: product.image_url,
      ingredientes: product.ingredients_text,
      informacoes_nutricionais: product.nutriments,
      origem_dados: 'open_food_facts',
      confianca: confidenceBySource('open_food_facts'),
      data_consulta: nowIso(),
      unitCategory: inferUnitCategory(unit),
    };
  }

  static fromGs1(barcode: string, payload: Record<string, any>): NormalizedProductData | null {
    const name = firstText(payload.productDescription, payload.description, payload.product_name, payload.name);
    if (!name) return null;

    return {
      codigo_barras: barcode,
      gtin: firstText(payload.gtin, payload.gtinKey, payload.code, barcode),
      nome: name,
      marca: firstText(payload.brandName, payload.brand, payload.brand_name),
      descricao: firstText(payload.description, payload.productDescription),
      categoria: firstText(payload.category, payload.gpcCategoryName, payload.gpc),
      quantidade: Number(payload.netContent ?? payload.quantity) || undefined,
      unidade_medida: normalizeUnit(firstText(payload.netContentUnit, payload.unit)),
      imagem_url: firstText(payload.imageUrl, payload.image_url),
      ncm: firstText(payload.ncm),
      cest: firstText(payload.cest),
      origem_dados: 'gs1',
      confianca: confidenceBySource('gs1'),
      data_consulta: nowIso(),
      unitCategory: inferUnitCategory(firstText(payload.netContentUnit, payload.unit)),
    };
  }

  static fromBrazilianProvider(barcode: string, payload: Record<string, any>): NormalizedProductData | null {
    const name = firstText(payload.description, payload.descricao, payload.nome, payload.product_name, payload.name);
    if (!name) return null;
    const quantity = parseQuantity(firstText(payload.quantity, payload.quantidade));
    const unit = quantity.unidade_medida ?? normalizeUnit(firstText(payload.unit, payload.unidade_medida));

    return {
      codigo_barras: barcode,
      gtin: firstText(payload.gtin, payload.code, payload.gtin13, barcode),
      nome: name,
      marca: firstText(payload.brand, payload.marca, payload.brand_name),
      descricao: firstText(payload.description, payload.descricao),
      categoria: firstText(payload.category, payload.categoria),
      quantidade: quantity.quantidade,
      unidade_medida: unit,
      imagem_url: firstText(payload.image_url, payload.imageUrl, payload.thumbnail),
      ncm: firstText(payload.ncm),
      cest: firstText(payload.cest),
      origem_dados: 'brazilian_commercial',
      confianca: confidenceBySource('brazilian_commercial'),
      data_consulta: nowIso(),
      unitCategory: inferUnitCategory(unit),
    };
  }
}
