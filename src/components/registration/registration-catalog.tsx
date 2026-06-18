"use client";

import { useState } from 'react';
import { Box, Package, UsersRound } from 'lucide-react';

import { BaseProductManagement } from '@/components/base-product-management';
import { EntityManagement } from '@/components/entity-management';
import { ItemManagement } from '@/components/item-management';
import { BackButton } from '@/components/navigation/back-button';
import { PermissionGuard } from '@/components/permission-guard';
import { useAuth } from '@/hooks/use-auth';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useEntities } from '@/hooks/use-entities';
import { useProducts } from '@/hooks/use-products';
import { cn } from '@/lib/utils';

export type RegistrationCatalogTab = 'base' | 'derived' | 'entities';

const tabs = [
  { id: 'base' as const, label: 'Insumo base', icon: Box },
  { id: 'derived' as const, label: 'Insumo derivado', icon: Package },
  { id: 'entities' as const, label: 'Pessoas e empresas', icon: UsersRound },
];

export function RegistrationCatalog({ defaultTab = 'base' }: { defaultTab?: RegistrationCatalogTab }) {
  const { permissions } = useAuth();
  const { baseProducts } = useBaseProducts();
  const { products } = useProducts();
  const { entities } = useEntities();
  const [activeTab, setActiveTab] = useState<RegistrationCatalogTab>(defaultTab);

  const counts: Record<RegistrationCatalogTab, number> = {
    base: baseProducts.filter((product) => !product.isArchived).length,
    derived: products.filter((product) => !product.isArchived).length,
    entities: entities.length,
  };

  return (
    <PermissionGuard allowed={permissions.registration.view}>
      <div className="-m-4 min-h-[calc(100vh-4rem)] bg-[#f5f0e8] text-[#281f1a] sm:-m-6">
        <div className="mx-auto w-full max-w-[1540px] px-5 pb-16 pt-8 sm:px-8 lg:px-12 lg:pt-12">
          <div className="flex items-center gap-2 text-sm font-medium uppercase tracking-[0.12em] text-[#a49990]">
            <BackButton
              fallbackHref="/dashboard/settings?department=operacional&tab=cadastros"
              variant="ghost"
              iconOnly
              className="h-8 w-8 rounded-full text-[#a49990] hover:bg-[#ebe2d7] hover:text-[#a6325b]"
              ariaLabel="Voltar para configurações"
            />
            <span>Operacional</span>
            <span>/</span>
            <span className="text-[#a6325b]">Cadastros</span>
          </div>

          <div className="mt-5">
            <h1 className="text-5xl font-black tracking-[-0.055em] text-[#211814] sm:text-6xl">
              Cadastros
            </h1>
            <p className="mt-3 max-w-4xl text-lg leading-relaxed text-[#746961] sm:text-xl">
              Catálogo de insumos e diretório de pessoas — a base de compras, ficha técnica e contagem de estoque.
            </p>
          </div>

          <div className="mt-10 grid border-b border-[#ded3c5] sm:grid-cols-3">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const selected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'relative flex min-h-24 items-center justify-center gap-4 px-4 py-5 text-left text-lg font-bold text-[#746961] transition-colors',
                    selected && 'text-[#211814]',
                  )}
                >
                  <Icon className={cn('h-6 w-6 text-[#a79c93]', selected && 'text-[#a6325b]')} />
                  <span className="max-w-40 leading-tight">{tab.label}</span>
                  <span
                    className={cn(
                      'rounded-full bg-[#e6e0d8] px-3 py-1 text-sm font-bold text-[#746961]',
                      selected && 'bg-[#a6325b] text-white',
                    )}
                  >
                    {counts[tab.id]}
                  </span>
                  {selected && <span className="absolute inset-x-4 -bottom-px h-1 rounded-full bg-[#a6325b]" />}
                </button>
              );
            })}
          </div>

          <div className="mt-10">
            {activeTab === 'base' && <BaseProductManagement />}
            {activeTab === 'derived' && <ItemManagement />}
            {activeTab === 'entities' && <EntityManagement />}
          </div>
        </div>
      </div>
    </PermissionGuard>
  );
}
