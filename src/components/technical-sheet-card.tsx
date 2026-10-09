"use client";

import { useMemo } from 'react';
import Image from 'next/image';
import { FileText, Eye, Settings } from 'lucide-react';

import { type ProductSimulation, type SimulationCategory } from '@/types';
import { Button } from '@/components/ui/button';
import { useProductSimulationCategories } from '@/hooks/use-product-simulation-categories';

interface TechnicalSheetCardProps {
  simulation: ProductSimulation;
  onViewSheet: () => void;
  onViewAssembly: () => void;
}

export function TechnicalSheetCard({ simulation, onViewSheet, onViewAssembly }: TechnicalSheetCardProps) {
  const { categories } = useProductSimulationCategories();

  const simCategory = useMemo(() => {
    const firstCatId = simulation.categoryIds?.[0];
    return firstCatId ? categories.find(c => c.id === firstCatId && c.type === 'category') : null;
  }, [simulation.categoryIds, categories]);

  const simLine = useMemo(
    () => (simulation.lineId ? categories.find(c => c.id === simulation.lineId && c.type === 'line') : null),
    [simulation.lineId, categories],
  );

  const simGroups = useMemo(
    () => (simulation.groupIds || []).map(id => categories.find(c => c.id === id && c.type === 'group')).filter(Boolean) as SimulationCategory[],
    [simulation.groupIds, categories],
  );

  const tags = [simCategory?.name, ...simGroups.map(group => group.name)].filter(Boolean) as string[];

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface font-ds transition-[transform,box-shadow] duration-[180ms] ease-ds-lift hover:-translate-y-[3px] hover:shadow-ds-lift motion-reduce:hover:translate-y-0">
      <div className="flex flex-1 items-start gap-4 p-4">
        {simulation.ppo?.referenceImageUrl ? (
          <Image src={simulation.ppo.referenceImageUrl} alt={simulation.name} width={96} height={96} className="aspect-square shrink-0 rounded-ds-md border border-ds-border object-cover" />
        ) : (
          <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-ds-md bg-ds-muted text-ds-ink-faint">
            <FileText aria-hidden="true" className="h-9 w-9" />
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-1.5">
          {simLine && <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-ink">{simLine.name}</p>}
          <h3 className="line-clamp-2 text-[15px] font-extrabold leading-tight text-ds-ink">{simulation.name}</h3>
          <p className="font-ds-mono text-[12px] font-bold text-ds-ink-muted">SKU {simulation.ppo?.sku || 'N/A'}</p>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tags.map(tag => <span key={tag} className="inline-flex h-[21px] items-center rounded-ds-pill bg-ds-neutral-bg px-[9px] text-[11.5px] font-bold text-ds-neutral">{tag}</span>)}
            </div>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 p-3 pt-0">
        <Button variant="primary-modal" size="sm" onClick={onViewSheet}><Eye aria-hidden="true" className="mr-2 h-4 w-4" />Ficha completa</Button>
        <Button variant="ds-secondary" size="sm" onClick={onViewAssembly}><Settings aria-hidden="true" className="mr-2 h-4 w-4" />Montagem</Button>
      </div>
    </article>
  );
}
