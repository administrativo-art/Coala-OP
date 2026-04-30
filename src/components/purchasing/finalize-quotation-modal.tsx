"use client";

import { useMemo, useState } from 'react';
import { AlertTriangle, CheckSquare, Loader2, Square } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { type QuotationItem } from '@/types';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  items: QuotationItem[];
  getProductName: (baseItemId: string) => string;
  onConfirm: (selectedItemIds: string[]) => Promise<void>;
  onArchive?: () => Promise<void>;
}

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function FinalizeQuotationModal({ open, onOpenChange, items, getProductName, onConfirm, onArchive }: Props) {
  const normalizedItems = useMemo(() => items.filter((i) => !!i.baseItemId), [items]);
  const freeItems = useMemo(() => items.filter((i) => !i.baseItemId), [items]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(normalizedItems.map((i) => i.id)),
  );
  const [loading, setLoading] = useState(false);
  const [archiving, setArchiving] = useState(false);

  // Re-initialize when items change (e.g. modal reopened after adding items)
  const [lastItemCount, setLastItemCount] = useState(normalizedItems.length);
  if (normalizedItems.length !== lastItemCount) {
    setLastItemCount(normalizedItems.length);
    setSelectedIds(new Set(normalizedItems.map((i) => i.id)));
  }

  const toggle = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleAll = () => {
    const allIds = normalizedItems.map((i) => i.id);
    const allSelected = allIds.every((id) => selectedIds.has(id));
    setSelectedIds(allSelected ? new Set() : new Set(allIds));
  };

  const selectedTotal = useMemo(
    () => [...selectedIds].reduce((sum, id) => {
      const item = items.find((i) => i.id === id);
      return sum + (item?.totalPrice ?? 0);
    }, 0),
    [selectedIds, items],
  );

  const allSelected = normalizedItems.length > 0 && normalizedItems.every((i) => selectedIds.has(i.id));

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm([...selectedIds]);
    } finally {
      setLoading(false);
    }
  };

  const handleArchive = async () => {
    if (!onArchive) return;
    setArchiving(true);
    try {
      await onArchive();
    } finally {
      setArchiving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg flex flex-col gap-0 p-0 max-h-[85vh]">
        <DialogHeader className="p-6 pb-4 shrink-0">
          <DialogTitle>Finalizar cotação</DialogTitle>
          <DialogDescription>
            Selecione os itens que serão encaminhados para compra.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col min-h-0 px-6 gap-4">
          {/* Normalized items */}
          {normalizedItems.length > 0 && (
            <div className="flex flex-col gap-2 min-h-0">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  Itens normalizados ({normalizedItems.length})
                </span>
                <button
                  type="button"
                  onClick={toggleAll}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {allSelected
                    ? <><CheckSquare className="h-3.5 w-3.5" /> Desmarcar todos</>
                    : <><Square className="h-3.5 w-3.5" /> Selecionar todos</>
                  }
                </button>
              </div>

              <ScrollArea className="max-h-64">
                <div className="divide-y rounded-lg border overflow-hidden">
                  {normalizedItems.map((item) => {
                    const checked = selectedIds.has(item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => toggle(item.id)}
                        className={cn(
                          'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors',
                          checked ? 'bg-primary/5' : 'hover:bg-muted/50 bg-background',
                        )}
                      >
                        {checked
                          ? <CheckSquare className="h-4 w-4 shrink-0 text-primary" />
                          : <Square className="h-4 w-4 shrink-0 text-muted-foreground" />
                        }
                        <div className="flex-1 min-w-0">
                          <p className={cn('text-sm font-medium truncate', !checked && 'text-muted-foreground')}>
                            {getProductName(item.baseItemId!)}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {item.quantity} {item.unit} × {fmt(item.unitPrice)}
                          </p>
                          {(item.discount ?? 0) > 0 && (
                            <p className="text-xs text-muted-foreground">
                              Desconto: {fmt(item.discount ?? 0)}
                            </p>
                          )}
                        </div>
                        <span className={cn('text-sm font-semibold shrink-0', !checked && 'text-muted-foreground')}>
                          {fmt(item.totalPrice)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Free items warning */}
          {freeItems.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm shrink-0">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-amber-800 dark:text-amber-200">
                  {freeItems.length} item{freeItems.length > 1 ? 's livres' : ' livre'} não {freeItems.length > 1 ? 'serão incluídos' : 'será incluído'}
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                  {freeItems.map((i) => i.freeText ?? '—').join(', ')}
                </p>
              </div>
            </div>
          )}

          {/* Summary */}
          <div className="rounded-lg bg-muted/40 px-4 py-3 space-y-1.5 shrink-0">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>{selectedIds.size} ite{selectedIds.size === 1 ? 'm selecionado' : 'ns selecionados'}</span>
              <span>{fmt(selectedTotal)}</span>
            </div>
            <Separator />
            <div className="flex justify-between text-sm font-semibold">
              <span>Total para compra</span>
              <span>{fmt(selectedTotal)}</span>
            </div>
          </div>
        </div>

        <DialogFooter className="p-6 pt-4 border-t shrink-0 mt-4">
          {onArchive && (
            <Button variant="outline" onClick={handleArchive} disabled={loading || archiving}>
              {archiving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Arquivar cotação
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={loading || archiving || selectedIds.size === 0}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Finalizar cotação
            {selectedIds.size > 0 && (
              <Badge variant="secondary" className="ml-2 text-xs">
                {selectedIds.size}
              </Badge>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
