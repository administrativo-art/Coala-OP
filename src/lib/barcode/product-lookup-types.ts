import type { Product, UnitCategory } from '@/types';

export type BarcodeFormat = 'ean_8' | 'ean_13' | 'upc_a' | 'gtin_14';

export type ProductDataSource = 'internal' | 'open_food_facts' | 'gs1' | 'brazilian_commercial' | 'manual' | 'cache';

export type ProductSourceKind = Exclude<ProductDataSource, 'cache' | 'manual'>;

export type NormalizedProductData = {
  codigo_barras: string;
  gtin: string;
  nome: string;
  marca?: string;
  descricao?: string;
  categoria?: string;
  categoria_id?: string;
  quantidade?: number;
  unidade_medida?: string;
  imagem_url?: string;
  ingredientes?: string;
  informacoes_nutricionais?: Record<string, unknown>;
  ncm?: string;
  cest?: string;
  origem_dados: ProductDataSource;
  confianca: number;
  data_consulta: string;
  unitCategory?: UnitCategory;
};

export type ProductLookupSourceResult = {
  fonte: ProductSourceKind | 'cache';
  status: 'found' | 'not_found' | 'skipped' | 'error';
  mensagem?: string;
  dados?: NormalizedProductData;
  dados_brutos_json?: Record<string, unknown>;
  data_consulta: string;
};

export type ProductLookupConflict = {
  campo: keyof Pick<
    NormalizedProductData,
    'nome' | 'marca' | 'descricao' | 'categoria' | 'quantidade' | 'unidade_medida' | 'imagem_url' | 'ncm' | 'cest'
  >;
  valores: Array<{ fonte: ProductLookupSourceResult['fonte']; valor: unknown }>;
};

export type ProductLookupResponse = {
  found: boolean;
  source: ProductDataSource;
  cacheHit: boolean;
  produto?: NormalizedProductData;
  internalProduct?: Product;
  sources: ProductLookupSourceResult[];
  conflitos: ProductLookupConflict[];
  fontes_consultadas: string[];
  mensagem?: string;
};

export type ProductSavePayload = {
  product?: Partial<Product>;
  lookupProduct?: NormalizedProductData;
  sources?: ProductLookupSourceResult[];
};
