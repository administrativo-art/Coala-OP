import { normalizeSearchText } from '@/lib/product-search';

export type AccountPlanOption = {
  id: string;
  name: string;
  parentId?: string | null;
  /** Palavras-chave cadastradas para direcionar buscas (ex.: "uniforme" → conta de uniformes). */
  searchTerms?: string[];
  /** Conceito da conta: o que entra e o que não entra (exibido nos seletores). */
  description?: string;
};

/**
 * Monta o texto pesquisável de um plano de contas: caminho na árvore + palavras-chave.
 * Espelha o padrão de aliases de produto (buildProductSearchText).
 */
export function buildAccountPlanSearchText(
  option: Pick<AccountPlanOption, 'name' | 'searchTerms'>,
  path?: string[],
) {
  return normalizeSearchText([...(path ?? [option.name]), ...(option.searchTerms ?? [])].join(' '));
}

export type ResultCenterOption = {
  id: string;
  name: string;
};

type AccountPlanNode = AccountPlanOption & { children: AccountPlanNode[] };

export type FlattenedAccountPlanOption = AccountPlanOption & { level: number };
export type AccountPlanTreeNode = AccountPlanOption & { children: AccountPlanTreeNode[]; order?: number };

export function buildAccountPlanTree(items: Array<AccountPlanOption & { order?: number }>, parentId: string | null = null): AccountPlanTreeNode[] {
  return items
    .filter((item) => (item.parentId ?? null) === parentId)
    .sort((left, right) => {
      const leftOrder = left.order ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = right.order ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return left.name.localeCompare(right.name, 'pt-BR');
    })
    .map((item) => ({
      ...item,
      children: buildAccountPlanTree(items, item.id),
    }));
}

function flattenAccountPlanTree(nodes: AccountPlanNode[], level = 0): FlattenedAccountPlanOption[] {
  return nodes.flatMap((node) => [
    { id: node.id, name: node.name, parentId: node.parentId ?? null, level },
    ...flattenAccountPlanTree(node.children, level + 1),
  ]);
}

export function getFlattenedAccountPlanOptions(items: AccountPlanOption[]) {
  return flattenAccountPlanTree(buildAccountPlanTree(items));
}
