import { type Product } from '@/types';

/**
 * Normaliza texto para busca: remove acentos, caixa e espaços nas pontas.
 * Mesma normalização usada nas telas de adicionar item de compra
 * (quotation-item-form, create-direct-purchase-modal, manage-order-items-modal).
 */
export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/**
 * Monta o texto pesquisável de um insumo, incluindo os aliases de compra.
 * Espelha o `searchText` da cotação (quotation-item-form.tsx).
 */
export function buildProductSearchText(product: Product, fullName?: string): string {
  return normalizeSearchText(
    [
      product.baseName,
      product.brand,
      `${product.packageSize}${product.unit}`,
      product.packageType,
      fullName,
      ...(product.aliases ?? []),
    ]
      .filter(Boolean)
      .join(' '),
  );
}

/**
 * Acha o melhor insumo para um nome livre (ex.: nome do item comprado),
 * comparando contra nome/marca/embalagem/aliases dos candidatos.
 *
 * 1) match exato de um alias/identificador normalizado;
 * 2) senão, todos os tokens do nome contidos no texto do candidato,
 *    desempatando pelo mais específico (mais tokens em comum);
 * 3) retorna `undefined` quando nada é confiável (não "chuta").
 */
export function matchProductByName(
  name: string | undefined | null,
  candidates: Product[],
  getFullName?: (product: Product) => string,
): Product | undefined {
  const normalizedName = normalizeSearchText(name ?? '');
  if (!normalizedName || candidates.length === 0) return undefined;
  const nameTokens = normalizedName.split(/\s+/).filter(Boolean);
  if (nameTokens.length === 0) return undefined;

  let exact: Product | undefined;
  let best: { product: Product; score: number } | undefined;

  for (const product of candidates) {
    const fullName = getFullName?.(product);
    const searchText = buildProductSearchText(product, fullName);

    // 1) Igualdade exata com algum identificador/alias.
    const exactCandidates = [product.baseName, fullName, ...(product.aliases ?? [])]
      .filter(Boolean)
      .map((value) => normalizeSearchText(String(value)));
    if (exactCandidates.includes(normalizedName)) {
      if (!exact) exact = product;
      continue;
    }

    // 2) Todos os tokens do nome presentes no texto do candidato.
    const allTokensMatch = nameTokens.every((token) => searchText.includes(token));
    if (allTokensMatch) {
      const score = nameTokens.length;
      if (!best || score > best.score) best = { product, score };
    }
  }

  return exact ?? best?.product;
}
