"use client";

import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { HeroChip } from '@/components/patterns/hero-chip';
import { PageHero } from '@/components/patterns/page-hero';
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
import { LocalPurchasePanel, localPurchaseCode, localPurchaseFinancialLabel } from '@/components/purchasing/local-purchase-panel';
import type { LocalPurchaseSummary } from '@/features/purchasing/local-purchase-admin';
import { useAuthenticatedApi } from '@/hooks/use-authenticated-api';
import { canCreatePurchase, canCreateQuotation, canRevertPurchaseStage, canViewPurchasing } from '@/lib/purchasing-permissions';
import { type PurchaseFinancial, type PurchaseOrder, type PurchaseReceipt } from '@/types';
import {
  PurchasingEmptyState,
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
  const { permissions, isDefaultAdmin } = useAuth();
  const api = useAuthenticatedApi();
  const { orders, loading } = usePurchaseOrders();
  const [localPurchases, setLocalPurchases] = useState<LocalPurchaseSummary[]>([]);
  const [localPurchasesError, setLocalPurchasesError] = useState(false);
  const [openLocalPurchaseId, setOpenLocalPurchaseId] = useState<string | null>(null);
  const { receipts } = usePurchaseReceipts();
  const { financials } = usePurchaseFinancials();
  const { entities } = useEntities();
  const [directOpen, setDirectOpen] = useState(false);
  const [requestedDestination, setRequestedDestination] = useState('');
  const [filter, setFilter] = useState<'all' | OrderStage>('all');
  const period: PurchasingPeriodFilter = useMemo(() => {
    const now = new Date();
    return { mode: 'recent', month: now.getMonth(), year: now.getFullYear() };
  }, []);
  const canView = canViewPurchasing(permissions);
  const canOpenDirectPurchase = canCreatePurchase(permissions);
  const canOpenQuotation = canCreateQuotation(permissions);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get('new') === 'direct' && canOpenDirectPurchase) {
      setRequestedDestination(query.get('destinationKioskId') ?? '');
      setDirectOpen(true);
    }
  }, [canOpenDirectPurchase]);

  // Compras feitas pelo aplicativo: uma leitura limitada ao abrir a tela, sem listener nem polling.
  useEffect(() => {
    if (!canView) return;
    const controller = new AbortController();
    void api<{ purchases: LocalPurchaseSummary[] }>('/api/purchasing/local-purchases/list', { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) { setLocalPurchases(result.purchases); setLocalPurchasesError(false); } })
      .catch(() => { if (!controller.signal.aborted) setLocalPurchasesError(true); });
    return () => controller.abort();
  }, [api, canView]);
  const localRows = useMemo(
    () => localPurchases
      .filter((purchase) => isDateInPurchasingPeriod(purchase.createdAt, period))
      .map((purchase) => ({ purchase, stage: (purchase.status === 'cancelled' ? 'cancelled' : 'received') as OrderStage })),
    [localPurchases, period],
  );
  const openLocalPurchase = localPurchases.find((purchase) => purchase.id === openLocalPurchaseId) ?? null;

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
    received: rows.filter((row) => row.stage === 'received').length + localRows.filter((row) => row.stage === 'received').length,
    cancelled: rows.filter((row) => row.stage === 'cancelled').length + localRows.filter((row) => row.stage === 'cancelled').length,
  }), [localRows, rows]);
  const visibleRows = rows.filter((row) => filter === 'all' || row.stage === filter);
  const visibleLocalRows = localRows.filter((row) => filter === 'all' || row.stage === filter);
  const totalRows = rows.length + localRows.length;
  // Pedidos e compras locais na mesma lista, do mais recente para o mais antigo.
  const listRows = [
    ...visibleRows.map((row) => ({ kind: 'order' as const, at: row.order.createdAt ?? '', row })),
    ...visibleLocalRows.map((row) => ({ kind: 'local' as const, at: row.purchase.createdAt, row })),
  ].sort((left, right) => right.at.localeCompare(left.at));

  return (
    <PermissionGuard allowed={canView}>
      <PurchasingPageFrame>
        <PurchasingModuleNavigation activeTab="orders" activeStage="issued" />

        <PageHero
          className="mb-4"
          kicker="Compras"
          title="Pedidos de compra"
          subtitle="Compras diretas e compras vindas de cotação, do pedido ao custo efetivo."
          actions={(
            <>
              {canOpenQuotation ? (
                <Button variant="on-dark-secondary" size="md" asChild>
                  <Link href="/dashboard/purchasing/quotations">Nova cotação</Link>
                </Button>
              ) : null}
              {canOpenDirectPurchase ? (
                <Button type="button" variant="primary-page" size="md" onClick={() => setDirectOpen(true)}>
                  <Plus className="mr-2 h-3.5 w-3.5" />
                  Compra direta
                </Button>
              ) : null}
            </>
          )}
          chips={(
            <>
              <HeroChip value={totalRows} label="Todos" active={filter === 'all'} onClick={() => setFilter('all')} />
              <HeroChip value={counts.issued} label="Emitido" tone="info" active={filter === 'issued'} onClick={() => setFilter('issued')} />
              <HeroChip value={counts.toReceive} label="A receber" active={filter === 'to_receive'} onClick={() => setFilter('to_receive')} />
              <HeroChip value={counts.receiving} label="Em recebimento" tone="warning" active={filter === 'receiving'} onClick={() => setFilter('receiving')} />
              <HeroChip value={counts.received} label="Recebida" active={filter === 'received'} onClick={() => setFilter('received')} />
              <HeroChip value={counts.cancelled} label="Cancelada" tone="danger" active={filter === 'cancelled'} onClick={() => setFilter('cancelled')} />
              <span className="ml-auto text-xs text-ds-on-dark-sub">{listRows.length} de {totalRows} compras</span>
            </>
          )}
        />

        {loading ? (
          <div className="overflow-hidden rounded-[14px] border border-zinc-200 bg-white">
            {Array.from({ length: 7 }).map((_, index) => <Skeleton key={index} className="m-4 h-12 rounded-lg" />)}
          </div>
        ) : listRows.length === 0 ? (
          <PurchasingEmptyState label="Nenhum pedido encontrado neste filtro." />
        ) : (
          <div className="overflow-x-auto rounded-[14px] border border-zinc-200 bg-white">
            <div className="min-w-[980px]">
              <div className="grid grid-cols-[128px_minmax(260px,1.7fr)_158px_132px_120px_96px] gap-4 border-b border-zinc-200 bg-zinc-50 px-4 py-3 text-[10px] font-black uppercase tracking-[0.1em] text-zinc-500">
                <span>Código</span><span>Fornecedor e pedido</span><span>Etapa</span><span>Financeiro</span><span className="text-right">Valor</span><span className="text-right">Prev.</span>
              </div>
              <div className="divide-y divide-zinc-100">
                {listRows.map((entry) => {
                  if (entry.kind === 'local') {
                    const { purchase, stage } = entry.row;
                    const presentation = stageView[stage];
                    return (
                      <button
                        key={`local-${purchase.id}`}
                        type="button"
                        onClick={() => setOpenLocalPurchaseId(purchase.id)}
                        className="grid w-full grid-cols-[128px_minmax(260px,1.7fr)_158px_132px_120px_96px] items-center gap-4 px-4 py-3.5 text-left transition-colors hover:bg-zinc-50"
                      >
                        <div>
                          <div className="font-mono text-[11.5px] font-extrabold text-zinc-700">{localPurchaseCode(purchase.id)}</div>
                          <div className="mt-1 text-[10.5px] text-zinc-500">{formatDate(purchase.createdAt)}</div>
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-extrabold tracking-[-0.02em] text-zinc-950">{purchase.supplierName}</span>
                            <span className="shrink-0 rounded-[5px] bg-violet-50 px-1.5 py-0.5 text-[9.5px] font-black uppercase tracking-wide text-violet-700">Compra local · app</span>
                          </div>
                          <div className="mt-1 truncate text-xs text-zinc-500">{purchase.unitName} · {purchase.items.map((item) => item.description).join(', ')}</div>
                        </div>
                        <div>
                          <PurchasingStatusBadge label={presentation.label} tone={presentation.tone} />
                          <div className="mt-2 flex gap-[3px]">
                            {Array.from({ length: 8 }).map((_, index) => (
                              <span key={index} className={`h-1 w-[11px] rounded-full ${index < presentation.progress ? segmentClasses[presentation.tone] : 'bg-zinc-200'}`} />
                            ))}
                          </div>
                        </div>
                        <div className={`text-xs font-bold ${stage === 'cancelled' ? 'text-zinc-500' : 'text-emerald-700'}`}>{localPurchaseFinancialLabel(purchase)}</div>
                        <div className="text-right font-mono text-[13px] font-extrabold text-zinc-950">{purchasingCompactMoney(purchase.totalCents / 100)}</div>
                        <div className="text-right text-xs text-zinc-500">{formatDate(purchase.purchaseDate)}</div>
                      </button>
                    );
                  }
                  const { order, receipt, financial, stage, supplier } = entry.row;
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

        {localPurchasesError ? <p role="alert" className="mt-3 text-xs text-rose-700">Não foi possível carregar as compras locais do aplicativo. Recarregue a página para tentar de novo.</p> : null}
        <LocalPurchasePanel
          purchase={openLocalPurchase}
          canReverse={isDefaultAdmin || canRevertPurchaseStage(permissions)}
          onOpenChange={(open) => { if (!open) setOpenLocalPurchaseId(null); }}
          onReversed={(updated) => setLocalPurchases((current) => current.map((purchase) => purchase.id === updated.id ? updated : purchase))}
        />
        <CreateDirectPurchaseModal open={directOpen} onOpenChange={setDirectOpen} defaultDestinationKioskId={requestedDestination} />
      </PurchasingPageFrame>
    </PermissionGuard>
  );
}
