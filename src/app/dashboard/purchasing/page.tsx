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

import { Button } from '@/components/ui/button';
import { PermissionGuard } from '@/components/permission-guard';
import { useQuotations } from '@/hooks/use-quotations';
import { usePurchaseOrders } from '@/hooks/use-purchase-orders';
import { usePurchaseReceipts } from '@/hooks/use-purchase-receipts';
import { usePurchaseFinancials } from '@/hooks/use-purchase-financials';
import { useAuth } from '@/hooks/use-auth';
import { canCreateQuotation, canViewPurchasing } from '@/lib/purchasing-permissions';

function PhasePill({ label, count, color }: { label: string; count: number; color: string }) {
  if (count === 0) return null;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium border ${color}`}>
      <span className="tabular-nums font-bold">{count}</span>
      <span>{label}</span>
    </span>
  );
}

function NavCard({
  href,
  icon: Icon,
  title,
  description,
  pills,
}: {
  href: string;
  icon: React.ElementType;
  title: string;
  description: string;
  pills?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group flex items-start gap-4 rounded-lg border bg-card p-5 hover:bg-muted/50 transition-colors"
    >
      <div className="flex-shrink-0 rounded-md bg-muted p-3 mt-0.5">
        <Icon className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        <span className="font-semibold">{title}</span>
        <p className="text-sm text-muted-foreground">{description}</p>
        {pills && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {pills}
          </div>
        )}
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0 mt-1" />
    </Link>
  );
}

export default function PurchasingHubPage() {
  const { permissions } = useAuth();
  const { quotations } = useQuotations();
  const { orders } = usePurchaseOrders();
  const { receipts } = usePurchaseReceipts();
  const { financials } = usePurchaseFinancials();
  const canView = canViewPurchasing(permissions);
  const canOpenQuotations = canCreateQuotation(permissions);

  // Quotations breakdown
  const quotationsDraft = useMemo(
    () => quotations.filter((q) => q.status === 'draft'),
    [quotations],
  );
  const quotationsQuoted = useMemo(
    () => quotations.filter((q) => q.status === 'quoted'),
    [quotations],
  );
  const quotationsPartial = useMemo(
    () => quotations.filter((q) => q.status === 'partially_converted'),
    [quotations],
  );
  const hasQuotationActivity = quotationsDraft.length > 0 || quotationsQuoted.length > 0 || quotationsPartial.length > 0;

  // Orders breakdown
  const ordersInReview = useMemo(
    () => orders.filter((o) => o.status === 'created' && !o.receivedAt),
    [orders],
  );
  const ordersConfirmed = useMemo(
    () => orders.filter((o) => o.status === 'confirmed' && !o.receivedAt),
    [orders],
  );

  // Receipts breakdown — exclude receipts from cancelled orders
  const cancelledOrderIds = useMemo(
    () => new Set(orders.filter((o) => o.status === 'cancelled').map((o) => o.id)),
    [orders],
  );

  const receiptsAwaiting = useMemo(
    () => receipts.filter((r) => r.status === 'awaiting_delivery' && !cancelledOrderIds.has(r.purchaseOrderId)),
    [receipts, cancelledOrderIds],
  );
  const receiptsConference = useMemo(
    () => receipts.filter((r) => r.status === 'in_conference' && !cancelledOrderIds.has(r.purchaseOrderId)),
    [receipts, cancelledOrderIds],
  );
  const receiptsStock = useMemo(
    () => receipts.filter(
      (r) => (r.status === 'awaiting_stock' || r.status === 'in_stock_entry' || r.status === 'partially_stocked')
        && !cancelledOrderIds.has(r.purchaseOrderId),
    ),
    [receipts, cancelledOrderIds],
  );

  // Financials awaiting payment
  const financialsAwaitingPayment = useMemo(
    () => financials.filter((f) => f.status === 'confirmed' || f.status === 'divergent'),
    [financials],
  );

  const hasOrderActivity = ordersInReview.length > 0 || ordersConfirmed.length > 0;
  const hasReceiptActivity = receiptsAwaiting.length > 0 || receiptsConference.length > 0 || receiptsStock.length > 0;

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
            pills={hasQuotationActivity ? (
              <>
                <PhasePill label="rascunho" count={quotationsDraft.length} color="border-amber-300 bg-amber-50 text-amber-700" />
                <PhasePill label="ag. resposta" count={quotationsQuoted.length} color="border-blue-300 bg-blue-50 text-blue-700" />
                <PhasePill label="conversão parcial" count={quotationsPartial.length} color="border-purple-300 bg-purple-50 text-purple-700" />
              </>
            ) : undefined}
          />

          <NavCard
            href="/dashboard/purchasing/orders"
            icon={ShoppingCart}
            title="Pedidos de compra"
            description="Acompanhe pedidos em aberto e seu status de recebimento."
            pills={hasOrderActivity ? (
              <>
                <PhasePill label="em revisão" count={ordersInReview.length} color="border-amber-300 bg-amber-50 text-amber-700" />
                <PhasePill label="confirmadas" count={ordersConfirmed.length} color="border-blue-300 bg-blue-50 text-blue-700" />
                {financialsAwaitingPayment.length > 0 && (
                  <PhasePill label="ag. pagamento" count={financialsAwaitingPayment.length} color="border-orange-300 bg-orange-50 text-orange-700" />
                )}
              </>
            ) : undefined}
          />

          <NavCard
            href="/dashboard/purchasing/receipts"
            icon={PackageCheck}
            title="Recebimentos"
            description="Confira mercadorias recebidas e registre entradas no estoque."
            pills={hasReceiptActivity ? (
              <>
                <PhasePill label="ag. recebimento" count={receiptsAwaiting.length} color="border-orange-300 bg-orange-50 text-orange-700" />
                <PhasePill label="em conferência" count={receiptsConference.length} color="border-blue-300 bg-blue-50 text-blue-700" />
                <PhasePill label="entrada no estoque" count={receiptsStock.length} color="border-purple-300 bg-purple-50 text-purple-700" />
              </>
            ) : undefined}
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
