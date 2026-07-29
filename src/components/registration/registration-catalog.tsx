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
      <div className="space-y-3 text-[#281f1a]">
          <section className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2.5">
            <BackButton
              fallbackHref="/dashboard/settings?department=operacional&tab=cadastros"
              variant="outline"
              iconOnly
              className="h-9 w-9 shrink-0 rounded-lg bg-white text-[#777784]"
              ariaLabel="Voltar para configurações"
            />
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#fde5f0] text-[#a6325b]">
                <Box className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[9px] font-extrabold uppercase tracking-[.12em] text-[#a6325b]">Configurações</p>
                <h1 className="text-lg font-black tracking-[-.02em] text-[#181820]">Cadastros</h1>
                <p className="text-[11px] font-medium text-[#777784]">Insumos e diretório de pessoas e empresas.</p>
              </div>
            </div>
          </section>

          <div className="grid gap-1 rounded-xl border border-[#e2e0da] bg-white p-1.5 shadow-[0_2px_8px_rgba(15,23,42,.05)] sm:grid-cols-3">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const selected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'flex h-10 items-center justify-center gap-2 rounded-lg px-3 text-left text-xs font-extrabold text-[#777784] transition-colors hover:bg-[#f7f6f3]',
                    selected && 'bg-[#fdeaf2] text-[#a6325b] hover:bg-[#fdeaf2]',
                  )}
                >
                  <Icon className={cn('h-4 w-4 text-[#9d9da9]', selected && 'text-[#a6325b]')} />
                  <span className="truncate">{tab.label}</span>
                  <span
                    className={cn(
                      'rounded-full bg-[#efefef] px-2 py-0.5 text-[10px] font-black text-[#777784]',
                      selected && 'bg-white text-[#a6325b]',
                    )}
                  >
                    {counts[tab.id]}
                  </span>
                </button>
              );
            })}
          </div>

          <div>
            {activeTab === 'base' && <BaseProductManagement />}
            {activeTab === 'derived' && <ItemManagement />}
            {activeTab === 'entities' && <EntityManagement />}
          </div>
      </div>
    </PermissionGuard>
  );
}
