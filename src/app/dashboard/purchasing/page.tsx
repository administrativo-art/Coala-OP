"use client";

import { useMemo } from 'react';
import {
  FileText,
  ShoppingCart,
  PackageCheck,
  TrendingDown,
  ChevronRight,
  Clock,
} from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PermissionGuard } from '@/components/permission-guard';
import { useQuotations } from '@/hooks/use-quotations';
import { usePurchaseOrders } from '@/hooks/use-purchase-orders';
import { usePurchaseReceipts } from '@/hooks/use-purchase-receipts';
import { useAuth } from '@/hooks/use-auth';
import { canCreateQuotation, canViewPurchasing } from '@/lib/purchasing-permissions';

function NavCard({
  href,
  icon: Icon,
  title,
  description,
  badge,
  badgeVariant = 'secondary',
}: {
  href: string;
  icon: React.ElementType;
  title: string;
  description: string;
  badge?: React.ReactNode;
  badgeVariant?: 'default' | 'secondary' | 'destructive' | 'outline';
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-4 rounded-lg border bg-card p-5 hover:bg-muted/50 transition-colors"
    >
      <div className="flex-shrink-0 rounded-md bg-muted p-3">
        <Icon className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{title}</span>
          {badge !== undefined && (
            <Badge variant={badgeVariant} className="text-xs">
              {badge}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
    </Link>
  );
}

export default function PurchasingHubPage() {
  const { permissions } = useAuth();
  const { quotations } = useQuotations();
  const { orders } = usePurchaseOrders();
  const { receipts } = usePurchaseReceipts();
  const canView = canViewPurchasing(permissions);
  const canOpenQuotations = canCreateQuotation(permissions);

  const activeQuotations = useMemo(
    () => quotations.filter((q) => q.status === 'draft' || q.status === 'partially_converted'),
    [quotations],
  );

  const activeOrders = useMemo(
    () => orders.filter((o) => (o.status === 'created' || o.status === 'confirmed') && !o.receivedAt),
    [orders],
  );

  const cancelledOrderIds = useMemo(
    () => new Set(orders.filter((o) => o.status === 'cancelled').map((o) => o.id)),
    [orders],
  );

  // Recebimentos - Quebras por fase
  const receiptsInitial = useMemo(
    () => receipts.filter(
      (r) => r.status === 'awaiting_delivery' && !cancelledOrderIds.has(r.purchaseOrderId)
    ),
    [receipts, cancelledOrderIds]
  );

  const receiptsPhase1 = useMemo(
    () => receipts.filter(
      (r) => r.status === 'in_conference' && !cancelledOrderIds.has(r.purchaseOrderId)
    ),
    [receipts, cancelledOrderIds]
  );

  const receiptsPhase2 = useMemo(
    () => receipts.filter(
      (r) =>
        (r.status === 'awaiting_stock' ||
          r.status === 'in_stock_entry' ||
          r.status === 'partially_stocked') &&
        !cancelledOrderIds.has(r.purchaseOrderId),
    ),
    [receipts, cancelledOrderIds],
  );

  const totalReceipts = receiptsInitial.length + receiptsPhase1.length + receiptsPhase2.length;

  return (
    <PermissionGuard allowed={canView}>
      <div className="container max-w-2xl py-8 space-y-8">
        <div>
          <h1 className="text-2xl font-bold">Compras</h1>
          <p className="text-sm text-muted-foreground">
            Gerencie cotações, pedidos, recebimentos e financeiro.
          </p>
        </div>

        <div className="space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Operacional</p>

          <NavCard
            href="/dashboard/purchasing/quotations"
            icon={FileText}
            title="Cotações"
            description="Pesquise preços por fornecedor antes de fechar uma compra."
            badge={activeQuotations.length > 0 ? activeQuotations.length : undefined}
            badgeVariant="secondary"
          />

          <NavCard
            href="/dashboard/purchasing/orders"
            icon={ShoppingCart}
            title="Pedidos de compra"
            description="Acompanhe pedidos em aberto e seu status de recebimento."
            badge={activeOrders.length > 0 ? activeOrders.length : undefined}
            badgeVariant="default"
          />

          <NavCard
            href="/dashboard/purchasing/receipts"
            icon={PackageCheck}
            title="Recebimentos"
            description="Confira mercadorias recebidas e registre entradas no estoque."
            badge={
              totalReceipts > 0 ? (
                <span className="flex items-center gap-1.5 font-medium">
                  <span title="Aguardando recebimento">{receiptsInitial.length}</span>
                  <span className="opacity-40">|</span>
                  <span title="Em conferência" className="text-primary-foreground">{receiptsPhase1.length}</span>
                  <span className="opacity-40">|</span>
                  <span title="Entrada no estoque">{receiptsPhase2.length}</span>
                </span>
              ) : undefined
            }
            badgeVariant="outline"
          />
        </div>

        <div className="space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Histórico</p>
          <NavCard
            href="/dashboard/purchasing/costs"
            icon={TrendingDown}
            title="Histórico de custo efetivo"
            description="Preços confirmados no recebimento com rastreabilidade completa."
          />
        </div>

        {canOpenQuotations && (
          <div className="pt-2">
            <Button asChild className="w-full sm:w-auto">
              <Link href="/dashboard/purchasing/quotations">
                <Clock className="mr-2 h-4 w-4" />
                Ir para cotações
              </Link>
            </Button>
          </div>
        )}
      </div>
    </PermissionGuard>
  );
}
