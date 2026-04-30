"use client";

import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Plus, ShoppingCart, ChevronRight, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PermissionGuard } from '@/components/permission-guard';
import { usePurchaseOrders } from '@/hooks/use-purchase-orders';
import { useEntities } from '@/hooks/use-entities';
import { useAuth } from '@/hooks/use-auth';
import { CreateDirectPurchaseModal } from '@/components/purchasing/create-direct-purchase-modal';
import { canCreatePurchase, canViewPurchasing } from '@/lib/purchasing-permissions';
import { type PurchaseOrder } from '@/types';

const STATUS_LABELS: Record<PurchaseOrder['status'], { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  created: { label: 'Em revisão', variant: 'secondary' },
  confirmed: { label: 'Confirmada', variant: 'default' },
  cancelled: { label: 'Cancelada', variant: 'destructive' },
};

const RECEIPT_LABELS: Record<PurchaseOrder['receiptMode'], string> = {
  future_delivery: 'Entrega futura',
  immediate_pickup: 'Retirada imediata',
};

function OrderRow({ order }: { order: PurchaseOrder }) {
  const { entities } = useEntities();
  const supplier = entities.find((e) => e.id === order.supplierId);
  const status = STATUS_LABELS[order.status];
  const isReceived = !!order.receivedAt;

  return (
    <Link
      href={`/dashboard/purchasing/orders/${order.id}`}
      className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-muted/50 transition-colors group"
    >
      <div className="flex items-center gap-4 min-w-0">
        <div className="flex-shrink-0 p-2 rounded-md bg-muted">
          <ShoppingCart className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium truncate">
              {supplier?.fantasyName ?? supplier?.name ?? '—'}
            </span>
            {isReceived ? (
              <Badge variant="outline" className="text-xs border-green-400 text-green-700 bg-green-50">✓ Recebida</Badge>
            ) : (
              <Badge variant={status.variant} className="text-xs">{status.label}</Badge>
            )}
            <Badge variant="outline" className="text-xs">
              {order.receiptMode === 'immediate_pickup' ? '⚡ Retirada' : '🚚 Entrega futura'}
            </Badge>
            <Badge variant="outline" className="text-xs text-muted-foreground">
              {order.origin === 'direct' ? 'Compra direta' : 'Via cotação'}
            </Badge>
          </div>
          <div className="flex gap-3 text-xs text-muted-foreground flex-wrap">
            <span>{format(parseISO(order.createdAt), "dd 'de' MMM 'de' yyyy", { locale: ptBR })}</span>
            <span className="font-medium text-foreground">
              {order.totalEstimated.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </span>
            {order.receiptMode === 'future_delivery' && (
              <span>Entrega: {format(parseISO(order.estimatedReceiptDate), 'dd/MM/yyyy')}</span>
            )}
            {order.receivedAt && (
              <span>Recebida em: {format(parseISO(order.receivedAt), 'dd/MM/yyyy')}</span>
            )}
          </div>
        </div>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
    </Link>
  );
}

export default function PurchaseOrdersPage() {
  const router = useRouter();
  const { permissions } = useAuth();
  const { orders, loading } = usePurchaseOrders();
  const [directOpen, setDirectOpen] = useState(false);
  const canView = canViewPurchasing(permissions);
  const canOpenDirectPurchase = canCreatePurchase(permissions);

  const active = useMemo(
    () => orders.filter((o) => (o.status === 'created' || o.status === 'confirmed') && !o.receivedAt),
    [orders],
  );

  const history = useMemo(
    () => orders.filter((o) => o.receivedAt || o.status === 'cancelled'),
    [orders],
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

      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Compras</h1>
          <p className="text-sm text-muted-foreground">Pedidos em revisão, confirmados e histórico.</p>
        </div>
        {canOpenDirectPurchase && (
          <Button onClick={() => setDirectOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Compra direta
          </Button>
        )}
      </div>

      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger value="active">
            Em andamento
            {active.length > 0 && (
              <span className="ml-1 rounded-full bg-primary/20 px-1.5 text-xs font-medium">
                {active.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="history">Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-4 space-y-2">
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
          ) : active.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-16">
              Nenhuma compra em andamento.
            </div>
          ) : (
            active.map((o) => <OrderRow key={o.id} order={o} />)
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-4 space-y-2">
          {loading ? (
            <Skeleton className="h-16 w-full" />
          ) : history.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-16">
              Nenhuma compra no histórico.
            </div>
          ) : (
            history.map((o) => <OrderRow key={o.id} order={o} />)
          )}
        </TabsContent>
      </Tabs>

        <CreateDirectPurchaseModal open={directOpen} onOpenChange={setDirectOpen} />
      </div>
    </PermissionGuard>
  );
}
