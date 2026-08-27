"use client";

import { useMemo, useState } from 'react';
import { CheckCircle2, Clock, Plus, ShoppingCart, Zap } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PermissionGuard } from '@/components/permission-guard';
import { usePurchaseOrders } from '@/hooks/use-purchase-orders';
import { useEntities } from '@/hooks/use-entities';
import { useAuth } from '@/hooks/use-auth';
import { CreateDirectPurchaseModal } from '@/components/purchasing/create-direct-purchase-modal';
import { PurchasingItemsPreview } from '@/components/purchasing/purchasing-items-preview';
import { canCreatePurchase, canViewPurchasing } from '@/lib/purchasing-permissions';
import { type PurchaseOrder } from '@/types';
import {
  PurchasingEmptyState,
  PurchasingFilterChip,
  PurchasingHeader,
  PurchasingKanbanCard,
  PurchasingKanbanColumn,
  PurchasingMetricCard,
  PurchasingPageFrame,
  PurchasingPeriodControl,
  PurchasingPipelineCard,
  PurchasingStatusBadge,
  PurchasingToolbar,
  createDefaultPurchasingPeriod,
  isDateInPurchasingPeriod,
  purchasingAgeLabel,
  purchasingCompactMoney,
  purchasingYearOptions,
  type PurchasingTone,
} from '@/components/purchasing/purchasing-ui';

function orderCode(id: string) {
  return `CMP-${id.slice(-8).toUpperCase()}`;
}

function supplierName(order: PurchaseOrder, fallback?: string) {
  return order.fiscal?.issuerName?.trim() || order.supplierName?.trim() || fallback || 'Fornecedor a definir';
}

function orderDisplayTotal(order: PurchaseOrder) {
  return order.totalConfirmed && order.totalConfirmed > 0 ? order.totalConfirmed : order.totalEstimated;
}

export default function PurchaseOrdersPage() {
  const { permissions } = useAuth();
  const { orders, loading } = usePurchaseOrders();
  const { entities } = useEntities();
  const [directOpen, setDirectOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'review' | 'confirmed' | 'received' | 'direct' | 'quotation'>('all');
  const [view, setView] = useState<'cards' | 'table' | 'kanban'>('kanban');
  const [period, setPeriod] = useState(createDefaultPurchasingPeriod);
  const canView = canViewPurchasing(permissions);
  const canOpenDirectPurchase = canCreatePurchase(permissions);

  const periodYears = useMemo(
    () => purchasingYearOptions(orders.map((order) => order.receivedAt ?? order.createdAt)),
    [orders],
  );
  const periodOrders = useMemo(
    () => orders.filter((order) => isDateInPurchasingPeriod(order.receivedAt ?? order.createdAt, period)),
    [orders, period],
  );

  const review = periodOrders.filter((o) => o.status === 'created' && !o.receivedAt);
  const confirmed = periodOrders.filter((o) => o.status === 'confirmed' && !o.receivedAt);
  const received = periodOrders.filter((o) => !!o.receivedAt);
  const direct = periodOrders.filter((o) => o.origin === 'direct' && o.status !== 'cancelled');
  const viaQuotation = periodOrders.filter((o) => o.origin === 'quotation' && o.status !== 'cancelled');
  const activeValue = periodOrders.filter((o) => o.status !== 'cancelled' && !o.receivedAt).reduce((sum, order) => sum + (order.totalEstimated ?? 0), 0);

  const cards = useMemo(() => {
    return periodOrders
      .filter((order) => order.status !== 'cancelled')
      .map((order) => {
        const supplier = supplierName(order, entities.find((e) => e.id === order.supplierId)?.fantasyName ?? entities.find((e) => e.id === order.supplierId)?.name);
        const isReceived = !!order.receivedAt;
        const tone: PurchasingTone = isReceived ? 'green' : order.status === 'created' ? 'blue' : 'purple';
        const statusLabel = isReceived ? 'Recebida' : order.status === 'created' ? 'Pedido emitido' : 'Pedido confirmado';
        const progress = isReceived ? 8 : order.status === 'created' ? 4 : 5;
        return {
          order,
          supplier,
          tone,
          statusLabel,
          progress,
          bucket: isReceived ? 'received' : order.status === 'created' ? 'review' : 'confirmed',
          stageLabel: isReceived ? 'Recebida' : order.status === 'created' ? 'Pedido emitido' : 'Pedido confirmado',
          searchText: `${order.id} ${supplier} ${order.origin} ${order.status} ${order.receiptMode}`.toLowerCase(),
        };
      })
      .filter((entry) => filter === 'all' || entry.bucket === filter || entry.order.origin === filter)
      .filter((entry) => !search.trim() || entry.searchText.includes(search.trim().toLowerCase()));
  }, [entities, filter, periodOrders, search]);

  return (
    <PermissionGuard allowed={canView}>
      <PurchasingPageFrame>
        <PurchasingHeader
          crumb={['Coala', 'Compras', 'Pedidos']}
          title="Pedidos"
          description="Pedidos emitidos, compras diretas e compras vindas de cotação."
          actions={
            canOpenDirectPurchase ? (
              <Button onClick={() => setDirectOpen(true)} className="h-11 rounded-[10px] bg-violet-600 px-5 font-bold text-white hover:bg-violet-700">
                <Plus className="mr-2 h-4 w-4" />
                Compra direta
              </Button>
            ) : null
          }
        />

        <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-5">
          <PurchasingMetricCard active label="Pedidos ativos" value={review.length + confirmed.length} detail={purchasingCompactMoney(activeValue)} tone="purple" icon={<ShoppingCart className="h-5 w-5" />} />
          <PurchasingMetricCard label="Emitidos" value={review.length} detail="criados no módulo" tone="blue" icon={<Clock className="h-5 w-5" />} />
          <PurchasingMetricCard label="Confirmados" value={confirmed.length} detail="seguem para recebimento" tone="purple" icon={<ShoppingCart className="h-5 w-5" />} />
          <PurchasingMetricCard label="Diretas" value={direct.length} detail="sem cotação" tone="green" icon={<Zap className="h-5 w-5" />} />
          <PurchasingMetricCard label="Recebidas" value={received.length} detail="concluídas" tone="green" icon={<CheckCircle2 className="h-5 w-5" />} />
        </div>

        <PurchasingToolbar
          search={search}
          onSearchChange={setSearch}
          resultLabel={`${cards.length} de ${periodOrders.length} pedidos`}
          view={view}
          onViewChange={setView}
          periodControl={<PurchasingPeriodControl value={period} onChange={setPeriod} years={periodYears} />}
        >
          <PurchasingFilterChip active={filter === 'all'} label="Todos" count={periodOrders.length} onClick={() => setFilter('all')} />
          <PurchasingFilterChip active={filter === 'review'} label="Emitido" count={review.length} tone="blue" onClick={() => setFilter('review')} />
          <PurchasingFilterChip active={filter === 'confirmed'} label="Confirmado" count={confirmed.length} tone="purple" onClick={() => setFilter('confirmed')} />
          <PurchasingFilterChip active={filter === 'direct'} label="Compra direta" count={direct.length} tone="green" onClick={() => setFilter('direct')} />
          <PurchasingFilterChip active={filter === 'quotation'} label="Via cotação" count={viaQuotation.length} tone="purple" onClick={() => setFilter('quotation')} />
          <PurchasingFilterChip active={filter === 'received'} label="Recebida" count={received.length} tone="green" onClick={() => setFilter('received')} />
        </PurchasingToolbar>

        {loading ? (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[250px] rounded-[16px]" />)}
          </div>
        ) : cards.length === 0 ? (
          <PurchasingEmptyState label="Nenhum pedido encontrado." />
        ) : view === 'table' ? (
          <div className="overflow-hidden rounded-[14px] border border-zinc-200 bg-white">
            <div className="grid grid-cols-[120px_1.5fr_150px_120px_130px_120px_40px] gap-4 border-b border-zinc-200 bg-zinc-50 px-4 py-3 text-[11px] font-black uppercase tracking-[0.08em] text-zinc-500">
              <span>Código</span><span>Pedido</span><span>Etapa</span><span>Origem</span><span className="text-right">Valor</span><span>Entrega</span><span />
            </div>
            <div className="divide-y divide-zinc-100">
              {cards.map(({ order, supplier, tone, statusLabel }) => (
                <Link key={order.id} href={`/dashboard/purchasing/orders/${order.id}`} className="grid grid-cols-[120px_1.5fr_150px_120px_130px_120px_40px] items-center gap-4 px-4 py-3 text-sm hover:bg-zinc-50">
                  <span className="font-mono text-xs font-black text-zinc-600">{orderCode(order.id)}</span>
                  <span className="font-bold text-zinc-950">{supplier}</span>
                  <span><PurchasingStatusBadge label={statusLabel} tone={tone} /></span>
                  <span className="text-zinc-500">{order.origin === 'direct' ? 'Direta' : 'Cotação'}</span>
                  <span className="text-right font-mono font-black text-zinc-950">{purchasingCompactMoney(orderDisplayTotal(order))}</span>
                  <span className="text-zinc-500">{new Date(order.estimatedReceiptDate).toLocaleDateString('pt-BR')}</span>
                  <span className="text-right text-zinc-400">›</span>
                </Link>
              ))}
            </div>
          </div>
        ) : view === 'kanban' ? (
          <div className="overflow-x-auto pb-3">
            <div className="grid min-w-[900px] grid-cols-3 gap-3">
              {[
                { label: 'Pedido emitido', tone: 'blue' as const },
                { label: 'Pedido confirmado', tone: 'purple' as const },
                { label: 'Recebida', tone: 'green' as const },
              ].map((column) => {
                const columnCards = cards.filter((entry) => entry.stageLabel === column.label);
                return (
                  <PurchasingKanbanColumn key={column.label} label={column.label} tone={column.tone} count={columnCards.length}>
                    {columnCards.map(({ order, supplier, tone, statusLabel }) => (
                      <PurchasingKanbanCard
                        key={order.id}
                        href={`/dashboard/purchasing/orders/${order.id}`}
                        tone={tone}
                        code={orderCode(order.id)}
                        title={supplier}
                        meta={new Date(order.createdAt).toLocaleDateString('pt-BR')}
                        badges={<PurchasingStatusBadge label={statusLabel} tone={tone} />}
                        footerLeft={order.origin === 'direct' ? 'Compra direta' : 'Via cotação'}
                        amount={purchasingCompactMoney(orderDisplayTotal(order))}
                      >
                        <PurchasingItemsPreview orderId={order.id} />
                      </PurchasingKanbanCard>
                    ))}
                  </PurchasingKanbanColumn>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
            {cards.map(({ order, supplier, tone, statusLabel, progress }) => (
              <PurchasingPipelineCard
                key={order.id}
                href={`/dashboard/purchasing/orders/${order.id}`}
                tone={tone}
                code={orderCode(order.id)}
                title={supplier}
                badges={
                  <>
                    <PurchasingStatusBadge label={statusLabel} tone={tone} />
                    <PurchasingStatusBadge label={order.origin === 'direct' ? 'Direta' : 'Cotação'} tone={order.origin === 'direct' ? 'green' : 'purple'} />
                  </>
                }
                progress={progress}
                lines={[
                  { label: order.receiptMode === 'immediate_pickup' ? 'Retirada imediata' : 'Entrega futura' },
                  { label: `Prev.: ${new Date(order.estimatedReceiptDate).toLocaleDateString('pt-BR')}` },
                  { label: order.trackingInfo || order.notes || 'Sem observação' },
                ]}
                footerLeft={<span>{order.origin === 'direct' ? 'Compra direta' : 'Via cotação'}</span>}
                amount={purchasingCompactMoney(orderDisplayTotal(order))}
                age={purchasingAgeLabel(order.receivedAt ?? order.createdAt)}
              />
            ))}
          </div>
        )}

        <CreateDirectPurchaseModal open={directOpen} onOpenChange={setDirectOpen} />
      </PurchasingPageFrame>
    </PermissionGuard>
  );
}
