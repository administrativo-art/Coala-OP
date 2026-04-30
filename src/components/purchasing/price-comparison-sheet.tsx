"use client";

import { useState, useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Search, X, Trophy, Minus } from 'lucide-react';

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { type PriceHistoryEntry } from '@/types';

type Entity = { id: string; name: string; fantasyName?: string };

export type ComparisonProductOption = {
  id: string;          // productId
  label: string;       // full product name
  baseItemId: string;  // baseProductId
  unit: string;
  searchText: string;
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  products: ComparisonProductOption[];
  priceHistory: PriceHistoryEntry[];
  entities: Entity[];
  initialProductId?: string;
}

function fmt(v?: number | null) {
  if (typeof v !== 'number' || Number.isNaN(v)) {
    return '—';
  }

  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function normalizeSearch(v: string) {
  return v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export function PriceComparisonSheet({
  open,
  onOpenChange,
  products,
  priceHistory,
  entities,
  initialProductId,
}: Props) {
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    initialProductId ? [initialProductId] : [],
  );

  // Keep selectedIds in sync when the initial product changes
  const [lastInitial, setLastInitial] = useState(initialProductId);
  if (initialProductId !== lastInitial) {
    setLastInitial(initialProductId);
    setSelectedIds(initialProductId ? [initialProductId] : []);
  }

  const toggle = (id: string) =>
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const filteredProducts = useMemo(() => {
    const tokens = normalizeSearch(search).split(/\s+/).filter(Boolean);
    if (!tokens.length) return products;
    return products.filter((p) => tokens.every((t) => p.searchText.includes(t)));
  }, [products, search]);

  // Build comparison rows: for each selected product, get its latest price entry
  type ComparisonRow = {
    product: ComparisonProductOption;
    entry: PriceHistoryEntry | null;
    entityName: string;
  };

  const rows = useMemo<ComparisonRow[]>(() => {
    return selectedIds.map((id) => {
      const product = products.find((p) => p.id === id);
      if (!product) return null;

      const entries = priceHistory
        .filter((e) => e.productId === id)
        .sort((a, b) => new Date(b.confirmedAt).getTime() - new Date(a.confirmedAt).getTime());

      const entry = entries[0] ?? null;
      const entity = entry ? entities.find((e) => e.id === entry.entityId) : null;
      const hasValidPrices =
        entry !== null &&
        typeof entry.price === 'number' &&
        !Number.isNaN(entry.price) &&
        typeof entry.pricePerUnit === 'number' &&
        !Number.isNaN(entry.pricePerUnit);

      return {
        product,
        entry: hasValidPrices ? entry : null,
        entityName: entity?.fantasyName ?? entity?.name ?? '—',
      };
    }).filter(Boolean) as ComparisonRow[];
  }, [selectedIds, products, priceHistory, entities]);

  // Find best price (lowest pricePerUnit among rows with history)
  const bestPricePerUnit = useMemo(() => {
    const withHistory = rows.filter((r) => r.entry !== null);
    if (!withHistory.length) return null;
    return Math.min(...withHistory.map((r) => r.entry!.pricePerUnit));
  }, [rows]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl flex flex-col p-0 gap-0">
        <SheetHeader className="p-5 pb-4 border-b shrink-0">
          <SheetTitle>Comparar preços</SheetTitle>
          <SheetDescription>
            Selecione produtos para comparar o último preço efetivado normalizado por unidade base.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {/* Search + product list */}
          <div className="p-4 border-b space-y-3 shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Buscar produto..."
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className="max-h-48 overflow-y-auto rounded-md border divide-y">
              {filteredProducts.length === 0 ? (
                <p className="px-3 py-4 text-sm text-muted-foreground text-center">
                  Nenhum produto encontrado.
                </p>
              ) : (
                filteredProducts.map((p) => {
                  const selected = selectedIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggle(p.id)}
                      className={cn(
                        'flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors',
                        selected ? 'bg-primary/8 text-primary font-medium' : 'hover:bg-muted/50',
                      )}
                    >
                      <div
                        className={cn(
                          'h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center transition-colors',
                          selected ? 'bg-primary border-primary' : 'border-muted-foreground/40',
                        )}
                      >
                        {selected && (
                          <svg viewBox="0 0 10 8" className="h-2.5 w-2.5 fill-white">
                            <path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                      <span className="flex-1 truncate">{p.label}</span>
                      <span className="text-xs text-muted-foreground shrink-0">{p.unit}</span>
                    </button>
                  );
                })
              )}
            </div>

            {selectedIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selectedIds.map((id) => {
                  const p = products.find((x) => x.id === id);
                  if (!p) return null;
                  return (
                    <Badge key={id} variant="secondary" className="gap-1 pr-1 text-xs max-w-[200px]">
                      <span className="truncate">{p.label}</span>
                      <button type="button" onClick={() => toggle(id)} className="shrink-0 rounded hover:text-destructive">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  );
                })}
              </div>
            )}
          </div>

          {/* Comparison table */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-sm text-muted-foreground gap-2">
                <Search className="h-8 w-8 opacity-30" />
                Selecione produtos acima para comparar.
              </div>
            ) : (
              <>
                {/* Header labels */}
                <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-3 text-xs text-muted-foreground font-medium uppercase tracking-wide">
                  <span>Produto</span>
                  <span className="text-right">Preço pago</span>
                  <span className="text-right">Por unid. base</span>
                </div>
                <Separator />

                {rows
                  .slice()
                  .sort((a, b) => {
                    if (!a.entry && !b.entry) return 0;
                    if (!a.entry) return 1;
                    if (!b.entry) return -1;
                    return a.entry.pricePerUnit - b.entry.pricePerUnit;
                  })
                  .map((row, idx) => {
                    const isBest = row.entry !== null && row.entry.pricePerUnit === bestPricePerUnit;
                    const pctAboveBest =
                      row.entry && bestPricePerUnit
                        ? ((row.entry.pricePerUnit - bestPricePerUnit) / bestPricePerUnit) * 100
                        : null;

                    return (
                      <div
                        key={row.product.id}
                        className={cn(
                          'rounded-xl border p-4 space-y-2 transition-colors',
                          isBest ? 'border-emerald-400/60 bg-emerald-50/60 dark:bg-emerald-950/20' : 'bg-card',
                          !row.entry && 'opacity-60',
                        )}
                      >
                        {/* Product name + best badge */}
                        <div className="flex items-center gap-2 flex-wrap">
                          {isBest && (
                            <Trophy className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                          )}
                          <span className="font-medium text-sm leading-tight">
                            {row.product.label}
                          </span>
                          {isBest && (
                            <Badge className="text-xs bg-emerald-600 hover:bg-emerald-600 shrink-0">
                              Melhor preço
                            </Badge>
                          )}
                          {pctAboveBest !== null && pctAboveBest > 0 && (
                            <Badge variant="outline" className="text-xs text-muted-foreground shrink-0">
                              +{pctAboveBest.toFixed(1)}% acima
                            </Badge>
                          )}
                        </div>

                        {row.entry ? (
                          <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 items-end">
                            {/* Supplier + date */}
                            <div className="min-w-0">
                              <p className="text-sm text-muted-foreground truncate">{row.entityName}</p>
                              <p className="text-xs text-muted-foreground">
                                {format(parseISO(row.entry.confirmedAt), "dd/MM/yyyy", { locale: ptBR })}
                              </p>
                            </div>
                            {/* Price paid */}
                            <div className="text-right">
                              <p className="text-sm font-medium">{fmt(row.entry.price)}</p>
                              <p className="text-xs text-muted-foreground">{row.product.unit}</p>
                            </div>
                            {/* Price per base unit */}
                            <div className="text-right">
                              <p className={cn('text-sm font-bold', isBest ? 'text-emerald-700 dark:text-emerald-400' : '')}>
                                {fmt(row.entry.pricePerUnit)}
                              </p>
                              <p className="text-xs text-muted-foreground">unid. base</p>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <Minus className="h-3.5 w-3.5" />
                            Sem histórico efetivado
                          </div>
                        )}
                      </div>
                    );
                  })}
              </>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
