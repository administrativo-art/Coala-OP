"use client";

import { useEffect, useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { PackageCheck, ChevronRight, Clock, Package, CheckCircle2, Boxes } from 'lucide-react';
import Link from 'next/link';

import { BackButton } from '@/components/navigation/back-button';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { PermissionGuard } from '@/components/permission-guard';
import { usePurchaseReceipts } from '@/hooks/use-purchase-receipts';
import { useEntities } from '@/hooks/use-entities';
import { useAuth } from '@/hooks/use-auth';
import { canViewPurchasing } from '@/lib/purchasing-permissions';
import { type PurchaseReceipt, type PurchaseReceiptItem } from '@/types';

type PhaseConfig = {
  label: string;
  icon: React.ElementType;
  className: string;
};

const PHASE_CONFIG: Record<PurchaseReceipt['status'], PhaseConfig> = {
  awaiting_delivery: { label: 'Aguardando recebimento', icon: Clock, className: 'border-orange-300 bg-orange-50 text-orange-700' },
  in_conference: { label: 'Em conferência', icon: PackageCheck, className: 'border-blue-300 bg-blue-50 text-blue-700' },
  awaiting_stock: { label: 'Aguardando estoque', icon: Package, className: 'border-amber-300 bg-amber-50 text-amber-700' },
  in_stock_entry: { label: 'Entrada no estoque', icon: Boxes, className: 'border-purple-300 bg-purple-50 text-purple-700' },
  partially_stocked: { label: 'Estoque parcial', icon: Boxes, className: 'border-amber-300 bg-amber-50 text-amber-700' },
  stocked: { label: 'Estocado', icon: CheckCircle2, className: 'border-green-400 bg-green-50 text-green-700' },
  stocked_with_divergence: { label: 'Estocado c/ divergência', icon: CheckCircle2, className: 'border-red-300 bg-red-50 text-red-700' },
  cancelled: { label: 'Cancelado', icon: CheckCircle2, className: 'border-zinc-300 bg-zinc-50 text-zinc-500' },
};

function ReceiptRow({ receipt }: { receipt: PurchaseReceipt }) {
  const { entities } = useEntities();
  const { fetchReceiptItems } = usePurchaseReceipts();
  const [open, setOpen] = useState('');
  const [items, setItems] = useState<PurchaseReceiptItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const supplier = entities.find((e) => e.id === receipt.supplierId);
  const phase = PHASE_CONFIG[receipt.status];
  const PhaseIcon = phase.icon;
  const receivedByOtherMeans = Boolean((receipt as PurchaseReceipt & { receivedByOtherMeans?: boolean }).receivedByOtherMeans);

  useEffect(() => {
    if (!open || items.length > 0 || itemsLoading) return;
    let cancelled = false;
    setItemsLoading(true);
    fetchReceiptItems(receipt.id)
      .then((data) => {
        if (!cancelled) setItems(data);
      })
      .finally(() => {
        if (!cancelled) setItemsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchReceiptItems, items.length, itemsLoading, open, receipt.id]);

  return (
    <Accordion type="single" collapsible value={open} onValueChange={setOpen}>
      <AccordionItem value={receipt.id} className="rounded-lg border bg-card px-0">
        <AccordionTrigger className="px-4 py-4 hover:no-underline">
          <div className="flex items-center gap-4 min-w-0 text-left">
            <div className="flex-shrink-0 p-2 rounded-md bg-muted">
              <PhaseIcon className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium truncate">
                  {supplier?.fantasyName ?? supplier?.name ?? '—'}
                </span>
                <Badge variant="outline" className={`text-xs ${phase.className}`}>
                  {phase.label}
                </Badge>
                {receivedByOtherMeans && (
                  <Badge variant="outline" className="text-xs border-sky-300 bg-sky-50 text-sky-700">
                    Baixado por outro meio
                  </Badge>
                )}
                <Badge variant="outline" className="text-xs">
                  {receipt.receiptMode === 'immediate_pickup' ? 'Retirada' : 'Entrega futura'}
                </Badge>
              </div>
              <div className="flex gap-3 text-xs text-muted-foreground flex-wrap">
                {receipt.totalEstimated != null && (
                  <span className="font-medium text-foreground">
                    {receipt.totalEstimated.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </span>
                )}
                {receipt.expectedDate && (
                  <span>Previsto: {format(parseISO(receipt.expectedDate), 'dd/MM/yyyy', { locale: ptBR })}</span>
                )}
                {receivedByOtherMeans && receipt.receivedAt && (
                  <span>Baixado: {format(parseISO(receipt.receivedAt), 'dd/MM/yyyy', { locale: ptBR })}</span>
                )}
                {!receivedByOtherMeans && receipt.stockEnteredAt && (
                  <span>Estocado: {format(parseISO(receipt.stockEnteredAt), 'dd/MM/yyyy', { locale: ptBR })}</span>
                )}
              </div>
            </div>
          </div>
        </AccordionTrigger>
        <AccordionContent className="px-4 pb-4">
          <div className="space-y-3 border-t pt-3">
            {itemsLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : items.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum item encontrado.</p>
            ) : (
              <div className="space-y-2">
                {items.map((item) => (
                  <div key={item.id} className="grid grid-cols-[1fr_auto] gap-3 rounded-md bg-muted/40 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{item.itemName || item.baseItemId || 'Item sem nome'}</p>
                      <p className="text-xs text-muted-foreground">
                        Pedido: {Number(item.quantityOrdered ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} {item.purchaseUnitLabel || item.unit}
                        {item.quantityReceived ? ` · Recebido: ${Number(item.quantityReceived).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}` : ''}
                      </p>
                    </div>
                    <span className="text-right font-medium">
                      {Number(
                        item.totalConfirmed ??
                          Number(item.quantityOrdered ?? 0) * Number(item.unitPriceOrdered ?? 0),
                      ).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end">
              <Button asChild variant="outline" size="sm">
                <Link href={`/dashboard/purchasing/orders/${receipt.purchaseOrderId}/receipt`}>
                  Abrir recebimento
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

export default function ReceiptsPage() {
  const { permissions, firebaseUser } = useAuth();
  const { receipts, loading } = usePurchaseReceipts();
  const canView = canViewPurchasing(permissions);

  const pending = useMemo(
    () => receipts.filter((r) => r.status === 'awaiting_delivery' || r.status === 'in_conference' || r.status === 'awaiting_stock' || r.status === 'in_stock_entry' || r.status === 'partially_stocked'),
    [receipts],
  );

  const done = useMemo(
    () => receipts.filter((r) => r.status === 'stocked' || r.status === 'stocked_with_divergence' || r.status === 'cancelled'),
    [receipts],
  );

  return (
    <PermissionGuard allowed={canView}>
      <div className="container max-w-3xl py-8 space-y-6">
      <div className="flex items-center gap-3">
        <BackButton fallbackHref="/dashboard/purchasing" label="Compras" variant="ghost" size="sm" className="-ml-2" />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Recebimentos</h1>
          <p className="text-sm text-muted-foreground">
            Confira mercadorias e registre a entrada no estoque.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            const token = await firebaseUser?.getIdToken(true);
            if (!token) return;
            try {
              const res = await fetch('/api/admin/fix-receipts', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: '{}'
              });
              const data = await res.json();
              if (data.ok) {
                alert(`${data.recovered?.length || 0} recebimento(s) sincronizado(s).`);
                window.location.reload();
              }
            } catch (err) {
              console.error(err);
            }
          }}
        >
          <Boxes className="mr-2 h-4 w-4" />
          Sincronizar
        </Button>
      </div>

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending" className="gap-2">
            <Clock className="h-4 w-4" />
            Pendentes
            {pending.length > 0 && (
              <span className="ml-1 rounded-full bg-primary/20 px-1.5 text-xs font-medium">
                {pending.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="done" className="gap-2">
            <PackageCheck className="h-4 w-4" />
            Concluídos
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-4 space-y-2">
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
          ) : pending.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-16">
              Nenhum recebimento pendente.
            </div>
          ) : (
            pending.map((r) => <ReceiptRow key={r.id} receipt={r} />)
          )}
        </TabsContent>

        <TabsContent value="done" className="mt-4 space-y-2">
          {loading ? (
            <Skeleton className="h-16 w-full" />
          ) : done.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-16">
              Nenhum recebimento concluído.
            </div>
          ) : (
            done.map((r) => <ReceiptRow key={r.id} receipt={r} />)
          )}
        </TabsContent>
      </Tabs>
      </div>
    </PermissionGuard>
  );
}
