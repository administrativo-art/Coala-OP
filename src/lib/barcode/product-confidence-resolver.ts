import type { NormalizedProductData, ProductLookupConflict, ProductLookupSourceResult } from './product-lookup-types';

const SOURCE_PRIORITY: Record<string, number> = {
  internal: 100,
  gs1: 90,
  brazilian_commercial: 80,
  open_food_facts: 60,
  cache: 50,
};

const CONFLICT_FIELDS: ProductLookupConflict['campo'][] = [
  'nome',
  'marca',
  'descricao',
  'categoria',
  'quantidade',
  'unidade_medida',
  'imagem_url',
  'ncm',
  'cest',
];

function comparable(value: unknown) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'number') return String(value);
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

export class ProductConfidenceResolver {
  static chooseBest(sources: ProductLookupSourceResult[]): NormalizedProductData | undefined {
    return sources
      .filter((source) => source.status === 'found' && source.dados)
      .sort((left, right) => {
        const priority = (SOURCE_PRIORITY[right.dados!.origem_dados] ?? 0) - (SOURCE_PRIORITY[left.dados!.origem_dados] ?? 0);
        if (priority !== 0) return priority;
        return right.dados!.confianca - left.dados!.confianca;
      })[0]?.dados;
  }

  static conflicts(sources: ProductLookupSourceResult[]): ProductLookupConflict[] {
    const found = sources.filter((source) => source.status === 'found' && source.dados);
    const conflicts: ProductLookupConflict[] = [];

    for (const campo of CONFLICT_FIELDS) {
      const values = found
        .map((source) => ({ fonte: source.fonte, valor: source.dados?.[campo] }))
        .filter((entry) => comparable(entry.valor));
      const unique = new Set(values.map((entry) => comparable(entry.valor)));
      if (unique.size > 1) conflicts.push({ campo, valores: values });
    }

    return conflicts;
  }
}
