"use client";

import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PermissionGuard } from '@/components/permission-guard';
import { usePurchaseOrders } from '@/hooks/use-purchase-orders';
import { usePurchaseReceipts } from '@/hooks/use-purchase-receipts';
import { usePurchaseFinancials } from '@/hooks/use-purchase-financials';
import { useEntities } from '@/hooks/use-entities';
import { useAuth } from '@/hooks/use-auth';
import { CreateDirectPurchaseModal } from '@/components/purchasing/create-direct-purchase-modal';
import { PurchasingModuleNavigation } from '@/components/purchasing/purchasing-module-navigation';
import { PurchasingItemsPreview } from '@/components/purchasing/purchasing-items-preview';
import { canCreatePurchase, canCreateQuotation, canViewPurchasing } from '@/lib/purchasing-permissions';
import { type PurchaseFinancial, type PurchaseOrder, type PurchaseReceipt } from '@/types';
import {
  PurchasingEmptyState,
  PurchasingFilterChip,
  PurchasingPageFrame,
  PurchasingStatusBadge,
  isDateInPurchasingPeriod,
  purchasingCompactMoney,
  type PurchasingPeriodFilter,
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

type OrderStage = 'issued' | 'to_receive' | 'receiving' | 'received' | 'cancelled';

const receivingStatuses = new Set<PurchaseReceipt['status']>([
  'in_conference',
  'awaiting_stock',
  'in_stock_entry',
  'partially_stocked',
  'stocked_with_divergence',
]);

const financialLabels: Record<PurchaseFinancial['status'], string> = {
  forecasted: 'Previsto',
  confirmed: 'Confirmado',
  divergent: 'Divergência',
  paid: 'Pago',
  cancelled: 'Cancelado',
};

const financialClasses: Record<PurchaseFinancial['status'], string> = {
  forecasted: 'text-violet-700',
  confirmed: 'text-emerald-700',
  divergent: 'text-rose-700',
  paid: 'text-emerald-700',
  cancelled: 'text-zinc-500',
};

function stageFor(order: PurchaseOrder, receipt?: PurchaseReceipt): OrderStage {
  if (order.status === 'cancelled') return 'cancelled';
  if (order.receivedAt || receipt?.status === 'stocked') return 'received';
  if (receipt && receivingStatuses.has(receipt.status)) return 'receiving';
  if (order.status === 'confirmed') return 'to_receive';
  return 'issued';
}

const stageView: Record<OrderStage, { label: string; tone: PurchasingTone; progress: number }> = {
  issued: { label: 'Pedido emitido', tone: 'blue', progress: 2 },
  to_receive: { label: 'A receber', tone: 'purple', progress: 5 },
  receiving: { label: 'Em recebimento', tone: 'amber', progress: 6 },
  received: { label: 'Recebida', tone: 'green', progress: 8 },
  cancelled: { label: 'Cancelada', tone: 'rose', progress: 2 },
};

const segmentClasses: Record<PurchasingTone, string> = {
  blue: 'bg-blue-600',
  amber: 'bg-amber-600',
  purple: 'bg-violet-600',
  cyan: 'bg-cyan-600',
  green: 'bg-emerald-600',
  rose: 'bg-rose-600',
  zinc: 'bg-zinc-500',
};

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('pt-BR') : '—';
}

export default function PurchaseOrdersPage() {
  const { permissions } = useAuth();
  const { orders, loading } = usePurchaseOrders();
  const { receipts } = usePurchaseReceipts();
  const { financials } = usePurchaseFinancials();
  const { entities } = useEntities();
  const [directOpen, setDirectOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | OrderStage>('all');
  const period: PurchasingPeriodFilter = useMemo(() => {
    const now = new Date();
    return { mode: 'recent', month: now.getMonth(), year: now.getFullYear() };
  }, []);
  const canView = canViewPurchasing(permissions);
  const canOpenDirectPurchase = canCreatePurchase(permissions);
  const canOpenQuotation = canCreateQuotation(permissions);

  const receiptsByOrder = useMemo(
    () => new Map(receipts.map((receipt) => [receipt.purchaseOrderId, receipt])),
    [receipts],
  );
  const financialsByOrder = useMemo(
    () => new Map(financials.filter((entry) => entry.status !== 'cancelled').map((entry) => [entry.purchaseOrderId, entry])),
    [financials],
  );
  const entityNames = useMemo(
    () => new Map(entities.map((entity) => [entity.id, entity.fantasyName ?? entity.name])),
    [entities],
  );

  const periodOrders = useMemo(
    () => orders.filter((order) => isDateInPurchasingPeriod(order.receivedAt ?? order.createdAt, period)),
    [orders, period],
  );
  const rows = useMemo(
    () => periodOrders.map((order) => {
      const receipt = receiptsByOrder.get(order.id);
      const stage = stageFor(order, receipt);
      return {
        order,
        receipt,
        financial: financialsByOrder.get(order.id),
        stage,
        supplier: supplierName(order, entityNames.get(order.supplierId)),
      };
    }),
    [entityNames, financialsByOrder, periodOrders, receiptsByOrder],
  );
  const counts = useMemo(() => ({
    issued: rows.filter((row) => row.stage === 'issued').length,
    toReceive: rows.filter((row) => row.stage === 'to_receive').length,
    receiving: rows.filter((row) => row.stage === 'receiving').length,
    received: rows.filter((row) => row.stage === 'received').length,
    cancelled: rows.filter((row) => row.stage === 'cancelled').length,
  }), [rows]);
  const visibleRows = rows.filter((row) => filter === 'all' || row.stage === filter);

  return (
    <PermissionGuard allowed={canView}>
      <PurchasingPageFrame>
        <PurchasingModuleNavigation activeTab="orders" activeStage="issued" />

        <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-[27px] font-black leading-none tracking-[-0.05em] text-zinc-950">Pedidos de compra</h1>
            <p className="mt-1.5 text-[13.5px] text-zinc-600">Compras diretas e compras vindas de cotação, do pedido ao custo efetivo.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canOpenQuotation ? (
              <Button variant="outline" asChild className="h-[38px] rounded-[9px] border-zinc-200 bg-white px-4 text-[13px] font-bold shadow-none">
                <Link href="/dashboard/purchasing/quotations">Nova cotação</Link>
              </Button>
            ) : null}
            {canOpenDirectPurchase ? (
              <Button onClick={() => setDirectOpen(true)} className="h-[38px] rounded-[9px] bg-violet-600 px-4 text-[13px] font-extrabold text-white hover:bg-violet-700">
                <Plus className="mr-2 h-3.5 w-3.5" />
                Compra direta
              </Button>
            ) : null}
          </div>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[12px] border border-zinc-200 bg-white px-3 py-2.5">
          <PurchasingFilterChip active={filter === 'all'} label="Todos" count={rows.length} onClick={() => setFilter('all')} />
          <PurchasingFilterChip active={filter === 'issued'} label="Emitido" count={counts.issued} tone="blue" onClick={() => setFilter('issued')} />
          <PurchasingFilterChip active={filter === 'to_receive'} label="A receber" count={counts.toReceive} tone="purple" onClick={() => setFilter('to_receive')} />
          <PurchasingFilterChip active={filter === 'receiving'} label="Em recebimento" count={counts.receiving} tone="amber" onClick={() => setFilter('receiving')} />
          <PurchasingFilterChip active={filter === 'received'} label="Recebida" count={counts.received} tone="green" onClick={() => setFilter('received')} />
          <PurchasingFilterChip active={filter === 'cancelled'} label="Cancelada" count={counts.cancelled} tone="rose" onClick={() => setFilter('cancelled')} />
          <span className="ml-auto text-xs text-zinc-500">{visibleRows.length} de {rows.length} pedidos</span>
        </div>

        {loading ? (
          <div className="overflow-hidden rounded-[14px] border border-zinc-200 bg-white">
            {Array.from({ length: 7 }).map((_, index) => <Skeleton key={index} className="m-4 h-12 rounded-lg" />)}
          </div>
        ) : visibleRows.length === 0 ? (
          <PurchasingEmptyState label="Nenhum pedido encontrado neste filtro." />
        ) : (
          <div className="overflow-x-auto rounded-[14px] border border-zinc-200 bg-white">
            <div className="min-w-[980px]">
              <div className="grid grid-cols-[128px_minmax(260px,1.7fr)_158px_132px_120px_96px] gap-4 border-b border-zinc-200 bg-zinc-50 px-4 py-3 text-[10px] font-black uppercase tracking-[0.1em] text-zinc-500">
                <span>Código</span><span>Fornecedor e pedido</span><span>Etapa</span><span>Financeiro</span><span className="text-right">Valor</span><span className="text-right">Prev.</span>
              </div>
              <div className="divide-y divide-zinc-100">
                {visibleRows.map(({ order, receipt, financial, stage, supplier }) => {
                  const presentation = stageView[stage];
                  const delayed = stage !== 'received' && stage !== 'cancelled' && order.estimatedReceiptDate && new Date(order.estimatedReceiptDate).getTime() < Date.now();
                  return (
                    <Link
                      key={order.id}
                      href={`/dashboard/purchasing/orders/${order.id}`}
                      className="grid grid-cols-[128px_minmax(260px,1.7fr)_158px_132px_120px_96px] items-center gap-4 px-4 py-3.5 transition-colors hover:bg-zinc-50"
                    >
                      <div>
                        <div className="font-mono text-[11.5px] font-extrabold text-zinc-700">{orderCode(order.id)}</div>
                        <div className="mt-1 text-[10.5px] text-zinc-500">{formatDate(order.createdAt)}</div>
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-extrabold tracking-[-0.02em] text-zinc-950">{supplier}</span>
                          {delayed ? <span className="shrink-0 rounded-[5px] bg-rose-50 px-1.5 py-0.5 text-[9.5px] font-black uppercase tracking-wide text-rose-700">Atrasada</span> : null}
                        </div>
                        <PurchasingItemsPreview orderId={order.id} variant="inline" />
                      </div>
                      <div>
                        <PurchasingStatusBadge label={presentation.label} tone={presentation.tone} />
                        <div className="mt-2 flex gap-[3px]">
                          {Array.from({ length: 8 }).map((_, index) => (
                            <span key={index} className={`h-1 w-[11px] rounded-full ${index < presentation.progress ? segmentClasses[presentation.tone] : 'bg-zinc-200'}`} />
                          ))}
                        </div>
                      </div>
                      <div className={`text-xs font-bold ${financial ? financialClasses[financial.status] : 'text-zinc-500'}`}>
                        {financial ? financialLabels[financial.status] : stage === 'issued' ? 'A lançar' : '—'}
                      </div>
                      <div className="text-right font-mono text-[13px] font-extrabold text-zinc-950">{purchasingCompactMoney(orderDisplayTotal(order))}</div>
                      <div className={`text-right text-xs ${delayed ? 'font-extrabold text-rose-700' : 'text-zinc-500'}`}>{formatDate(receipt?.expectedDate ?? order.estimatedReceiptDate)}</div>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <CreateDirectPurchaseModal open={directOpen} onOpenChange={setDirectOpen} />
      </PurchasingPageFrame>
    </PermissionGuard>
  );
}
