"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';

import { BaseProductManagement } from '@/components/base-product-management';
import { EntityManagement } from '@/components/entity-management';
import { ItemManagement } from '@/components/item-management';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useEntities } from '@/hooks/use-entities';
import { useProducts } from '@/hooks/use-products';

import { CadastrosTabs } from './cadastros-ui';
import { CADASTROS_VIEW_STORAGE_KEY, parseStoredView, type CadastrosView } from './cadastros-utils';

export type CadastrosTabId = 'base' | 'derived' | 'entities';

// A visualização é preferência do usuário: vale entre abas e visitas. Sem armazenamento local
// (modo privado, bloqueio), o valor fica só em memória nesta visita.
const viewListeners = new Set<() => void>();
let memoryView: CadastrosView | null = null;

function subscribeToView(listener: () => void) {
  viewListeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    viewListeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

function readView(): CadastrosView {
  if (memoryView) return memoryView;
  try {
    return parseStoredView(window.localStorage.getItem(CADASTROS_VIEW_STORAGE_KEY));
  } catch {
    return 'list';
  }
}

function writeView(next: CadastrosView) {
  memoryView = next;
  try {
    window.localStorage.setItem(CADASTROS_VIEW_STORAGE_KEY, next);
  } catch {
    // A preferência só vale para esta visita.
  }
  viewListeners.forEach((listener) => listener());
}

/**
 * Cadastros operacionais: insumo base, insumo derivado e pessoas e empresas.
 * Compartilhado pela página de Configurações e pela página de Cadastros, para que as duas
 * telas nunca divirjam. Cada aba guarda a própria busca, filtros, seleção e painel aberto;
 * trocar de aba descarta esse estado. Só a visualização (lista ou grade) acompanha o usuário.
 */
export function CadastrosWorkspace({ defaultTab = 'base' }: { defaultTab?: CadastrosTabId }) {
  const { baseProducts } = useBaseProducts();
  const { products } = useProducts();
  const { entities } = useEntities();
  const [tab, setTab] = useState<CadastrosTabId>(defaultTab);
  const view = useSyncExternalStore(subscribeToView, readView, () => 'list' as CadastrosView);
  const handleViewChange = useCallback((next: CadastrosView) => writeView(next), []);

  const tabItems = useMemo(
    () => [
      { id: 'base', label: 'Insumo base', count: baseProducts.filter((product) => !product.isArchived).length },
      { id: 'derived', label: 'Insumo derivado', count: products.filter((product) => !product.isArchived).length },
      { id: 'entities', label: 'Pessoas e empresas', count: entities.filter((entity) => entity.status !== 'inactive').length },
    ],
    [baseProducts, products, entities],
  );

  const tabs = <CadastrosTabs tabs={tabItems} active={tab} onChange={(id) => setTab(id as CadastrosTabId)} />;

  return (
    <div className="text-ds-ink">
      {tab === 'base' ? <BaseProductManagement tabs={tabs} view={view} onViewChange={handleViewChange} /> : null}
      {tab === 'derived' ? <ItemManagement tabs={tabs} view={view} onViewChange={handleViewChange} /> : null}
      {tab === 'entities' ? <EntityManagement tabs={tabs} view={view} onViewChange={handleViewChange} /> : null}
    </div>
  );
}
