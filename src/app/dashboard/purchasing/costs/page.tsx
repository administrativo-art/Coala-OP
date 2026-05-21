"use client";

import { useState, useEffect, useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { RefreshCw, GitBranch, Search } from 'lucide-react';

import { BackButton } from '@/components/navigation/back-button';
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

const normalizeSearch = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

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
    () => new Map(baseProducts.map((bp) => [bp.id, bp])),
    [baseProducts],
  );

  const suppliersById = useMemo(
    () => new Map(entities.map((entity) => [entity.id, entity])),
    [entities],
  );

  const lastNegotiationsByItem = useMemo(() => {
    const map = new Map<string, EffectiveCostEntry[]>();

    for (const entry of entries) {
      const itemEntries = map.get(entry.baseItemId) ?? [];
      if (itemEntries.length < 3) {
        itemEntries.push(entry);
        map.set(entry.baseItemId, itemEntries);
      }
    }

    return map;
  }, [entries]);

  const filtered = useMemo(() => {
    const tokens = normalizeSearch(searchTerm).split(/\s+/).filter(Boolean);

    return entries.filter((e) => {
      if (filterBaseItem !== '_all' && e.baseItemId !== filterBaseItem) return false;
      if (filterSupplier !== '_all' && e.supplierId !== filterSupplier) return false;
      if (tokens.length === 0) return true;

      const base = baseProductsById.get(e.baseItemId);
      const supplier = suppliersById.get(e.supplierId);
      const occurredAt = e.occurredAt ? format(parseISO(e.occurredAt), 'dd/MM/yyyy', { locale: ptBR }) : '';
      const searchable = normalizeSearch([
        base?.name,
        e.baseItemId,
        supplier?.fantasyName,
        supplier?.name,
        e.supplierId,
        e.unitCost?.toString(),
        e.purchasePrice?.toString(),
        e.quantity?.toString(),
        e.purchaseUnitLabel,
        e.purchaseReceiptLotId,
        e.purchaseReceiptLotId?.slice(-8),
        occurredAt,
      ].filter(Boolean).join(' '));

      if (!tokens.every((token) => searchable.includes(token))) return false;
      return true;
    });
  }, [entries, filterBaseItem, filterSupplier, searchTerm, baseProductsById, suppliersById]);

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
        <BackButton fallbackHref="/dashboard/purchasing" label="Compras" variant="ghost" size="sm" className="-ml-2" />
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
          onClick={() => fetchCosts({ limitCount: 500 })}
          disabled={loading}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative min-w-72 flex-1 sm:flex-none">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Buscar por insumo, fornecedor, lote, data..."
            className="pl-9"
          />
        </div>

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
                const base = baseProductsById.get(entry.baseItemId);
                const supplier = suppliersById.get(entry.supplierId);
                const negotiations = lastNegotiationsByItem.get(entry.baseItemId) ?? [];
                return (
                  <TableRow key={entry.id}>
                    <TableCell className="min-w-56 align-top">
                      <Accordion type="single" collapsible>
                        <AccordionItem value={entry.id} className="border-0">
                          <AccordionTrigger className="py-0 text-left font-medium hover:no-underline">
                            <span>{base?.name ?? entry.baseItemId}</span>
                          </AccordionTrigger>
                          <AccordionContent className="pt-3 pb-0">
                            {negotiations.length > 0 ? (
                              <div className="space-y-2">
                                {negotiations.map((negotiation) => {
                                  const negotiationSupplier = suppliersById.get(negotiation.supplierId);
                                  return (
                                    <div
                                      key={negotiation.id}
                                      className="rounded-md border bg-muted/30 px-3 py-2"
                                    >
                                      <div className="flex items-center justify-between gap-3">
                                        <span className="font-mono text-xs font-semibold">
                                          {negotiation.unitCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/{base?.unit ?? ''}
                                        </span>
                                        <span className="text-xs text-muted-foreground">
                                          {format(parseISO(negotiation.occurredAt), "dd/MM/yyyy", { locale: ptBR })}
                                        </span>
                                      </div>
                                      <p className="mt-1 truncate text-xs text-muted-foreground">
                                        {negotiationSupplier?.fantasyName ?? negotiationSupplier?.name ?? 'Fornecedor não identificado'}
                                      </p>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground">Sem negociações anteriores.</p>
                            )}
                          </AccordionContent>
                        </AccordionItem>
                      </Accordion>
                    </TableCell>
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
