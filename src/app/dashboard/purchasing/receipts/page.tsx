"use client";

import { useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ArrowLeft, PackageCheck, ChevronRight, Clock } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PermissionGuard } from '@/components/permission-guard';
import { usePurchaseReceipts } from '@/hooks/use-purchase-receipts';
import { useEntities } from '@/hooks/use-entities';
import { useAuth } from '@/hooks/use-auth';
import { canViewPurchasing } from '@/lib/purchasing-permissions';
import { type PurchaseReceipt } from '@/types';

const STATUS_CONFIG: Record<
  PurchaseReceipt['status'],
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  awaiting_delivery: { label: 'Aguardando recebimento', variant: 'secondary' },
  in_conference: { label: 'Em conferência', variant: 'default' },
  awaiting_stock: { label: 'Aguardando estoque', variant: 'secondary' },
  in_stock_entry: { label: 'Entrada no estoque', variant: 'default' },
  partially_stocked: { label: 'Estoque parcial', variant: 'outline' },
  stocked: { label: 'Estocado', variant: 'outline' },
  stocked_with_divergence: { label: 'Estocado c/ divergência', variant: 'destructive' },
  cancelled: { label: 'Cancelado', variant: 'destructive' },
};

function ReceiptRow({ receipt }: { receipt: PurchaseReceipt }) {
  const { entities } = useEntities();
  const supplier = entities.find((e) => e.id === receipt.supplierId);
  const status = STATUS_CONFIG[receipt.status];

  return (
    <Link
      href={`/dashboard/purchasing/orders/${receipt.purchaseOrderId}/receipt`}
      className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-muted/50 transition-colors group"
    >
      <div className="flex items-center gap-4 min-w-0">
        <div className="flex-shrink-0 p-2 rounded-md bg-muted">
          <PackageCheck className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium truncate">
              {supplier?.fantasyName ?? supplier?.name ?? '—'}
            </span>
            <Badge variant={status.variant} className="text-xs">
              {status.label}
            </Badge>
          </div>
          <div className="flex gap-3 text-xs text-muted-foreground mt-0.5 flex-wrap">
            <span>
              {receipt.receiptMode === 'immediate_pickup' ? 'Retirada imediata' : 'Entrega futura'}
            </span>
            {receipt.expectedDate && (
              <span>
                Previsto: {format(parseISO(receipt.expectedDate), 'dd/MM/yyyy', { locale: ptBR })}
              </span>
            )}
            {receipt.stockEnteredAt && (
              <span>
                Estocado: {format(parseISO(receipt.stockEnteredAt), 'dd/MM/yyyy', { locale: ptBR })}
              </span>
            )}
          </div>
        </div>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
    </Link>
  );
}

export default function ReceiptsPage() {
  const router = useRouter();
  const { permissions } = useAuth();
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
        <Button variant="ghost" size="sm" onClick={() => router.push('/dashboard/purchasing')} className="-ml-2">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Compras
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-bold">Recebimentos</h1>
        <p className="text-sm text-muted-foreground">
          Confira mercadorias e registre a entrada no estoque.
        </p>
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
