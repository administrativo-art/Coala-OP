"use client";

import { useState, useEffect, useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ArrowLeft, RefreshCw, GitBranch } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PermissionGuard } from '@/components/permission-guard';
import { useEffectiveCosts } from '@/hooks/use-effective-costs';
import { useAuth } from '@/hooks/use-auth';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useEntities } from '@/hooks/use-entities';
import { TraceDrawer } from '@/components/purchasing/trace-drawer';
import { canViewPurchasing } from '@/lib/purchasing-permissions';
import { type EffectiveCostEntry } from '@/types';

export default function EffectiveCostsPage() {
  const router = useRouter();
  const { permissions } = useAuth();
  const { entries, loading, fetchCosts } = useEffectiveCosts();
  const { baseProducts } = useBaseProducts();
  const { entities } = useEntities();
  const canView = canViewPurchasing(permissions);

  const [filterBaseItem, setFilterBaseItem] = useState('_all');
  const [filterSupplier, setFilterSupplier] = useState('_all');
  const [traceEntry, setTraceEntry] = useState<EffectiveCostEntry | null>(null);

  useEffect(() => {
    fetchCosts({ limitCount: 200 });
  }, [fetchCosts]);

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (filterBaseItem !== '_all' && e.baseItemId !== filterBaseItem) return false;
      if (filterSupplier !== '_all' && e.supplierId !== filterSupplier) return false;
      return true;
    });
  }, [entries, filterBaseItem, filterSupplier]);

  // Last effective price per base item (first entry per baseItemId since sorted DESC)
  const lastPriceByItem = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) {
      if (!map.has(e.baseItemId)) map.set(e.baseItemId, e.unitCost);
    }
    return map;
  }, [entries]);

  return (
    <PermissionGuard allowed={canView}>
      <div className="container max-w-5xl py-8 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push('/dashboard/purchasing')} className="-ml-2">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Compras
        </Button>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Histórico de Custo Efetivo</h1>
          <p className="text-sm text-muted-foreground">
            Preços confirmados no recebimento — um registro por lote recebido.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchCosts({ limitCount: 200 })}
          disabled={loading}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <Select value={filterBaseItem} onValueChange={setFilterBaseItem}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Todos os insumos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">Todos os insumos</SelectItem>
            {baseProducts
              .filter((bp) => entries.some((e) => e.baseItemId === bp.id))
              .map((bp) => (
                <SelectItem key={bp.id} value={bp.id}>
                  {bp.name}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {lastPriceByItem.has(bp.id)
                      ? lastPriceByItem.get(bp.id)!.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) + `/${bp.unit}`
                      : ''}
                  </span>
                </SelectItem>
              ))}
          </SelectContent>
        </Select>

        <Select value={filterSupplier} onValueChange={setFilterSupplier}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Todos os fornecedores" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">Todos os fornecedores</SelectItem>
            {entities
              .filter((e) => entries.some((c) => c.supplierId === e.id))
              .map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.fantasyName ?? e.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center text-sm text-muted-foreground py-16">
          Nenhum registro de custo efetivo encontrado.
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Insumo</TableHead>
                <TableHead>Fornecedor</TableHead>
                <TableHead className="text-right">Custo unit.</TableHead>
                <TableHead className="text-right">Preço pago</TableHead>
                <TableHead className="text-right">Quantidade</TableHead>
                <TableHead>Lote</TableHead>
                <TableHead>Data</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((entry) => {
                const base = baseProducts.find((bp) => bp.id === entry.baseItemId);
                const supplier = entities.find((e) => e.id === entry.supplierId);
                return (
                  <TableRow key={entry.id}>
                    <TableCell className="font-medium">{base?.name ?? entry.baseItemId}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {supplier?.fantasyName ?? supplier?.name ?? '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {entry.unitCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/{base?.unit ?? ''}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {entry.purchasePrice != null
                        ? `${entry.purchasePrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/${entry.purchaseUnitLabel ?? 'un'}`
                        : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {entry.quantity} {base?.unit ?? ''}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {entry.purchaseReceiptLotId.slice(-8)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {format(parseISO(entry.occurredAt), "dd/MM/yyyy", { locale: ptBR })}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Rastrear origem"
                        onClick={() => setTraceEntry(entry)}
                      >
                        <GitBranch className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {filtered.length > 0 && (
        <p className="text-xs text-muted-foreground text-right">
          {filtered.length} registro{filtered.length > 1 ? 's' : ''}
        </p>
      )}

      <TraceDrawer
        open={!!traceEntry}
        onOpenChange={(v) => { if (!v) setTraceEntry(null); }}
        entry={traceEntry}
      />
      </div>
    </PermissionGuard>
  );
}
