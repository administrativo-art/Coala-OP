"use client";

import { useEffect, useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { GitBranch, RefreshCw, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PermissionGuard } from '@/components/permission-guard';
import { PurchasingModuleNavigation } from '@/components/purchasing/purchasing-module-navigation';
import { useEffectiveCosts } from '@/hooks/use-effective-costs';
import { useAuth } from '@/hooks/use-auth';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useEntities } from '@/hooks/use-entities';
import { TraceDrawer } from '@/components/purchasing/trace-drawer';
import { canViewPurchasing } from '@/lib/purchasing-permissions';
import { type EffectiveCostEntry } from '@/types';
import { PurchasingEmptyState, PurchasingPageFrame } from '@/components/purchasing/purchasing-ui';

const normalizeSearch = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

function money(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function EffectiveCostsPage() {
  const { permissions } = useAuth();
  const { entries, loading, fetchCosts } = useEffectiveCosts();
  const { baseProducts } = useBaseProducts();
  const { entities } = useEntities();
  const canView = canViewPurchasing(permissions);

  const [filterBaseItem, setFilterBaseItem] = useState('_all');
  const [filterSupplier, setFilterSupplier] = useState('_all');
  const [searchTerm, setSearchTerm] = useState('');
  const [traceEntry, setTraceEntry] = useState<EffectiveCostEntry | null>(null);

  useEffect(() => {
    fetchCosts({ limitCount: 500 });
  }, [fetchCosts]);

  const baseProductsById = useMemo(
    () => new Map(baseProducts.map((baseProduct) => [baseProduct.id, baseProduct])),
    [baseProducts],
  );
  const suppliersById = useMemo(
    () => new Map(entities.map((entity) => [entity.id, entity])),
    [entities],
  );

  const filteredEntries = useMemo(() => {
    const tokens = normalizeSearch(searchTerm).split(/\s+/).filter(Boolean);

    return entries.filter((entry) => {
      if (filterBaseItem !== '_all' && entry.baseItemId !== filterBaseItem) return false;
      if (filterSupplier !== '_all' && entry.supplierId !== filterSupplier) return false;
      if (tokens.length === 0) return true;

      const base = baseProductsById.get(entry.baseItemId);
      const supplier = suppliersById.get(entry.supplierId);
      const searchable = normalizeSearch([
        base?.name,
        entry.baseItemId,
        supplier?.fantasyName,
        supplier?.name,
        entry.purchaseReceiptLotId,
        entry.purchaseUnitLabel,
      ].filter(Boolean).join(' '));

      return tokens.every((token) => searchable.includes(token));
    });
  }, [baseProductsById, entries, filterBaseItem, filterSupplier, searchTerm, suppliersById]);

  const groups = useMemo(() => {
    const grouped = new Map<string, EffectiveCostEntry[]>();
    filteredEntries.forEach((entry) => {
      const current = grouped.get(entry.baseItemId) ?? [];
      current.push(entry);
      grouped.set(entry.baseItemId, current);
    });

    return Array.from(grouped.entries()).map(([baseItemId, itemEntries]) => {
      const sorted = [...itemEntries].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
      const latest = sorted[0];
      const history = sorted.slice(0, 8).reverse();
      const oldest = history[0] ?? latest;
      const variation = oldest?.unitCost > 0 ? ((latest.unitCost - oldest.unitCost) / oldest.unitCost) * 100 : 0;
      const values = history.map((entry) => entry.unitCost);
      const maxValue = Math.max(...values, 1);

      return {
        baseItemId,
        base: baseProductsById.get(baseItemId),
        latest,
        sorted,
        history,
        variation,
        maxValue,
      };
    }).sort((a, b) => (a.base?.name ?? a.baseItemId).localeCompare(b.base?.name ?? b.baseItemId, 'pt-BR'));
  }, [baseProductsById, filteredEntries]);

  return (
    <PermissionGuard allowed={canView}>
      <PurchasingPageFrame>
        <PurchasingModuleNavigation activeTab="costs" activeStage="costs" />

        <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-[27px] font-black leading-none tracking-[-0.05em] text-zinc-950">Custo efetivo</h1>
            <p className="mt-1.5 text-[13.5px] text-zinc-600">Preço realmente pago por lote recebido. Base de custo da ficha técnica e da precificação.</p>
          </div>
          <Button
            variant="outline"
            onClick={() => fetchCosts({ limitCount: 500 })}
            disabled={loading}
            className="h-[38px] rounded-[9px] border-zinc-200 bg-white px-4 text-[13px] font-bold shadow-none"
          >
            <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>

        <div className="mb-3 grid gap-2 rounded-[12px] border border-zinc-200 bg-white p-3 lg:grid-cols-[minmax(260px,1fr)_230px_220px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <Input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Buscar por insumo, fornecedor ou lote..."
              className="h-9 rounded-[9px] border-zinc-200 bg-zinc-50 pl-9 text-sm shadow-none"
            />
          </div>
          <Select value={filterBaseItem} onValueChange={setFilterBaseItem}>
            <SelectTrigger className="h-9 rounded-[9px] border-zinc-200 bg-white text-xs shadow-none">
              <SelectValue placeholder="Todos os insumos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">Todos os insumos</SelectItem>
              {baseProducts
                .filter((baseProduct) => entries.some((entry) => entry.baseItemId === baseProduct.id))
                .map((baseProduct) => <SelectItem key={baseProduct.id} value={baseProduct.id}>{baseProduct.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterSupplier} onValueChange={setFilterSupplier}>
            <SelectTrigger className="h-9 rounded-[9px] border-zinc-200 bg-white text-xs shadow-none">
              <SelectValue placeholder="Todos os fornecedores" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">Todos os fornecedores</SelectItem>
              {entities
                .filter((entity) => entries.some((entry) => entry.supplierId === entity.id))
                .map((entity) => <SelectItem key={entity.id} value={entity.id}>{entity.fantasyName ?? entity.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-24 w-full rounded-[14px]" />)}
          </div>
        ) : groups.length === 0 ? (
          <PurchasingEmptyState label="Nenhum registro de custo efetivo encontrado." />
        ) : (
          <Accordion type="multiple" className="space-y-2.5">
            {groups.map(({ baseItemId, base, latest, sorted, history, variation, maxValue }) => (
              <AccordionItem key={baseItemId} value={baseItemId} className="overflow-hidden rounded-[14px] border border-zinc-200 bg-white px-0">
                <AccordionTrigger className="px-[18px] py-4 text-left hover:no-underline [&>svg]:text-zinc-400">
                  <div className="grid min-w-0 flex-1 grid-cols-1 items-center gap-4 pr-4 sm:grid-cols-[minmax(220px,1.4fr)_140px_130px_minmax(180px,1fr)]">
                    <div className="min-w-0">
                      <div className="truncate text-[14.5px] font-extrabold tracking-[-0.02em] text-zinc-950">{base?.name ?? baseItemId}</div>
                      <div className="mt-1 truncate text-xs font-normal text-zinc-500">
                        Último lote {latest.purchaseReceiptLotId.slice(-8)} · {format(parseISO(latest.occurredAt), 'dd/MM/yyyy', { locale: ptBR })}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-[0.1em] text-zinc-500">Custo atual</div>
                      <div className="mt-1 font-mono text-base font-black text-zinc-950">{money(latest.unitCost)}/{base?.unit ?? ''}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-[0.1em] text-zinc-500">Variação</div>
                      <div className={`mt-1 text-[15px] font-black ${variation > 0 ? 'text-rose-600' : variation < 0 ? 'text-emerald-600' : 'text-zinc-600'}`}>
                        {variation > 0 ? '+' : ''}{variation.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
                      </div>
                    </div>
                    <div className="flex h-12 items-end gap-1.5" aria-label="Histórico visual de custos">
                      {history.map((entry) => (
                        <span
                          key={entry.id}
                          title={`${format(parseISO(entry.occurredAt), 'dd/MM/yyyy', { locale: ptBR })}: ${money(entry.unitCost)}`}
                          className="min-h-2 flex-1 rounded-t-[4px] bg-violet-500/75"
                          style={{ height: `${Math.max((entry.unitCost / maxValue) * 100, 16)}%` }}
                        />
                      ))}
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="border-t border-zinc-100 px-[18px] pb-4 pt-3">
                  <div className="grid gap-2 md:grid-cols-3">
                    {sorted.slice(0, 3).map((entry) => {
                      const supplier = suppliersById.get(entry.supplierId);
                      return (
                        <div key={entry.id} className="rounded-[10px] border border-zinc-200 bg-zinc-50 px-3 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-mono text-xs font-extrabold text-zinc-900">{money(entry.unitCost)}/{base?.unit ?? ''}</div>
                              <div className="mt-1 text-[11px] text-zinc-500">{supplier?.fantasyName ?? supplier?.name ?? 'Fornecedor não identificado'}</div>
                            </div>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-500" title="Rastrear origem" onClick={() => setTraceEntry(entry)}>
                              <GitBranch className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                          <div className="mt-2 text-[11px] text-zinc-500">{entry.quantity} {base?.unit ?? ''} · lote {entry.purchaseReceiptLotId.slice(-8)}</div>
                        </div>
                      );
                    })}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}

        {groups.length > 0 ? <p className="mt-3 text-right text-xs text-zinc-500">{groups.length} insumo{groups.length === 1 ? '' : 's'} · {filteredEntries.length} registro{filteredEntries.length === 1 ? '' : 's'}</p> : null}

        <TraceDrawer
          open={Boolean(traceEntry)}
          onOpenChange={(open) => { if (!open) setTraceEntry(null); }}
          entry={traceEntry}
        />
      </PurchasingPageFrame>
    </PermissionGuard>
  );
}
