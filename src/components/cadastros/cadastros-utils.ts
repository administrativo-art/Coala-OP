export type CadastrosView = 'list' | 'grid';
export type CadastrosStatus = 'active' | 'inactive';

export const CADASTROS_VIEW_STORAGE_KEY = 'coala:cadastros:view';

/** Custo sem arredondamento excessivo: 3 casas, ou 4 quando o valor é menor que R$ 0,10. */
export function formatCost(value?: number | null): string {
  if (!value || Number.isNaN(value)) return 'R$ 0,000';
  return `R$ ${value.toLocaleString('pt-BR', {
    minimumFractionDigits: 3,
    maximumFractionDigits: value < 0.1 ? 4 : 3,
  })}`;
}

const UNIT_SIGNATURES: Record<string, string> = { pacote: 'pct', caixa: 'cx', peça: 'pç', peca: 'pç' };

/** Sigla curta da unidade para o selo do insumo base. */
export function unitSignature(unit?: string | null): string {
  const normalized = (unit ?? '').trim().toLowerCase();
  return UNIT_SIGNATURES[normalized] ?? (normalized || '—');
}

export function initialsOf(label: string): string {
  return (
    label
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || '?'
  );
}

export function parseStoredView(raw: string | null | undefined): CadastrosView {
  return raw === 'grid' ? 'grid' : 'list';
}

export function toggleInSet(current: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Marca ou desmarca todos os ids visíveis, preservando seleções fora do filtro. */
export function toggleAllInSet(current: ReadonlySet<string>, visibleIds: readonly string[], select: boolean): Set<string> {
  const next = new Set(current);
  for (const id of visibleIds) {
    if (select) next.add(id);
    else next.delete(id);
  }
  return next;
}

export function selectionSummary(count: number): string {
  return `${count} selecionado${count === 1 ? '' : 's'}`;
}

export function countByKey<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export type CadastrosChip = { id: string; label: string; count: number };

/** "Todas" primeiro; filtros sem itens ficam de fora, exceto o que está selecionado. */
export function buildChips(
  total: number,
  entries: ReadonlyArray<{ id: string; label: string; count: number }>,
  activeId: string,
  allLabel = 'Todas',
): CadastrosChip[] {
  return [
    { id: 'all', label: allLabel, count: total },
    ...entries.filter((entry) => entry.count > 0 || entry.id === activeId),
  ];
}

export function baseProductDeactivateBlock(name: string, hasStock: boolean): string | null {
  return hasStock ? `Não é possível desativar “${name}”: há lotes com estoque vinculados. Zere o estoque antes de desativar.` : null;
}

export function baseProductDeleteBlock(name: string, derivedCount: number): string | null {
  return derivedCount > 0
    ? `Não é possível excluir “${name}”: está vinculado a ${derivedCount} insumo(s) derivado(s).`
    : null;
}

export function derivedItemDeleteBlock(lotCount: number, listNames: readonly string[]): string | null {
  const reasons = [
    lotCount > 0 && `está sendo usado em ${lotCount} lote(s)`,
    listNames.length > 0 && `está nas listas predefinidas: ${listNames.map((name) => `“${name}”`).join(', ')}`,
  ].filter(Boolean);
  return reasons.length > 0 ? `Não é possível excluir: este insumo ${reasons.join(' e ')}. Arquive para tirar de uso.` : null;
}

export function bulkDeleteBlockedNames(names: readonly string[]): string | null {
  return names.length > 0 ? `Não podem ser excluídos por terem derivados: ${names.join(', ')}.` : null;
}
