"use client";

import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, PackageCheck, Truck } from 'lucide-react';
import Link from 'next/link';

import { Skeleton } from '@/components/ui/skeleton';
import { PermissionGuard } from '@/components/permission-guard';
import { PurchasingItemsPreview } from '@/components/purchasing/purchasing-items-preview';
import { usePurchaseReceipts } from '@/hooks/use-purchase-receipts';
import { usePurchaseOrders } from '@/hooks/use-purchase-orders';
import { useAuth } from '@/hooks/use-auth';
import { canViewPurchasing } from '@/lib/purchasing-permissions';
import { type PurchaseReceipt } from '@/types';
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

const statusConfig: Record<PurchaseReceipt['status'], { label: string; tone: PurchasingTone; progress: number; bucket: 'waiting' | 'partial' | 'conference' | 'done' }> = {
  awaiting_delivery: { label: 'A receber', tone: 'cyan', progress: 5, bucket: 'waiting' },
  in_conference: { label: 'Em conferência', tone: 'purple', progress: 6, bucket: 'conference' },
  awaiting_stock: { label: 'Aguardando estoque', tone: 'blue', progress: 7, bucket: 'conference' },
  in_stock_entry: { label: 'Entrada em estoque', tone: 'green', progress: 7, bucket: 'conference' },
  partially_stocked: { label: 'Recebimento parcial', tone: 'amber', progress: 6, bucket: 'partial' },
  stocked: { label: 'Concluída', tone: 'green', progress: 8, bucket: 'done' },
  stocked_with_divergence: { label: 'Em processo', tone: 'purple', progress: 7, bucket: 'conference' },
  cancelled: { label: 'Cancelada', tone: 'zinc', progress: 1, bucket: 'done' },
};

const fallbackStatusConfig: { label: string; tone: PurchasingTone; progress: number; bucket: 'waiting' | 'partial' | 'conference' | 'done' } = {
  label: 'Pendente',
  tone: 'zinc',
  progress: 1,
  bucket: 'waiting',
};

function receiptCode(id: string) {
  return `CMP-${id.slice(-8).toUpperCase()}`;
}

// totalConfirmed só é > 0 após o recebimento; antes disso vem como 0 (não null),
// então não dá pra usar ?? e precisamos cair no estimado explicitamente.
function receiptDisplayTotal(receipt: PurchaseReceipt) {
  return receipt.totalConfirmed && receipt.totalConfirmed > 0
    ? receipt.totalConfirmed
    : receipt.totalEstimated;
}

export default function ReceiptsPage() {
  const { permissions } = useAuth();
  const { receipts, loading } = usePurchaseReceipts();
  const { orders } = usePurchaseOrders();
  const purchaseDateById = useMemo(
    () => new Map(orders.map((order) => [order.id, order.createdAt])),
    [orders],
  );
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'waiting' | 'partial' | 'conference' | 'delayed' | 'done'>('all');
  const [view, setView] = useState<'cards' | 'table' | 'kanban'>('kanban');
  const [period, setPeriod] = useState(createDefaultPurchasingPeriod);
  const canView = canViewPurchasing(permissions);

  const receiptPeriodDate = (receipt: PurchaseReceipt) => receipt.stockEnteredAt ?? receipt.receivedAt ?? receipt.expectedDate ?? receipt.createdAt;
  const periodYears = useMemo(
    () => purchasingYearOptions(receipts.map(receiptPeriodDate)),
    [receipts],
  );
  const periodReceipts = useMemo(
    () => receipts.filter((receipt) => isDateInPurchasingPeriod(receiptPeriodDate(receipt), period)),
    [period, receipts],
  );

  const waiting = periodReceipts.filter((r) => r.status === 'awaiting_delivery');
  const partial = periodReceipts.filter((r) => r.status === 'partially_stocked');
  const conference = periodReceipts.filter((r) => ['in_conference', 'awaiting_stock', 'in_stock_entry', 'stocked_with_divergence'].includes(r.status));
  const done = periodReceipts.filter((r) => r.status === 'stocked');
  const delayed = periodReceipts.filter((r) => ['awaiting_delivery', 'in_conference', 'awaiting_stock', 'in_stock_entry', 'partially_stocked', 'stocked_with_divergence'].includes(r.status) && r.expectedDate && new Date(r.expectedDate).getTime() < Date.now());

  const cards = useMemo(() => {
    return periodReceipts
      .map((receipt) => {
        const cfg = statusConfig[receipt.status] ?? fallbackStatusConfig;
        const isDelayed = ['awaiting_delivery', 'in_conference', 'awaiting_stock', 'in_stock_entry', 'partially_stocked', 'stocked_with_divergence'].includes(receipt.status) && receipt.expectedDate && new Date(receipt.expectedDate).getTime() < Date.now();
        return {
          receipt,
          cfg,
          isDelayed,
          searchText: `${receipt.id} ${receipt.purchaseOrderId} ${receipt.supplierName ?? ''} ${receipt.status}`.toLowerCase(),
        };
      })
      .filter((entry) => filter === 'all' || entry.cfg.bucket === filter || (filter === 'delayed' && entry.isDelayed))
      .filter((entry) => !search.trim() || entry.searchText.includes(search.trim().toLowerCase()));
  }, [filter, periodReceipts, search]);

  return (
    <PermissionGuard allowed={canView}>
      <PurchasingPageFrame>
        <PurchasingHeader
          crumb={['Coala', 'Compras', 'Recebimentos']}
          title="Recebimentos"
          description="Conferência da mercadoria recebida, divergências, NF-e e lançamento financeiro."
        />

        <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-5">
          <PurchasingMetricCard label="A receber" value={waiting.length} detail="aguardando chegada" tone="cyan" icon={<Truck className="h-5 w-5" />} />
          <PurchasingMetricCard label="Parciais" value={partial.length} detail="com saldo aberto" tone="amber" icon={<AlertTriangle className="h-5 w-5" />} />
          <PurchasingMetricCard label="Em processo" value={conference.length} detail="conferência/estoque" tone="purple" icon={<PackageCheck className="h-5 w-5" />} />
          <PurchasingMetricCard label="Atrasados" value={delayed.length} detail="previsão vencida" tone="rose" icon={<AlertTriangle className="h-5 w-5" />} />
          <PurchasingMetricCard label="Concluídos" value={done.length} detail="despesa lançada" tone="green" icon={<CheckCircle2 className="h-5 w-5" />} />
        </div>

        <PurchasingToolbar
          search={search}
          onSearchChange={setSearch}
          resultLabel={`${cards.length} de ${periodReceipts.length} recebimentos`}
          view={view}
          onViewChange={setView}
          periodControl={<PurchasingPeriodControl value={period} onChange={setPeriod} years={periodYears} />}
        >
          <PurchasingFilterChip active={filter === 'all'} label="Todos" count={periodReceipts.length} onClick={() => setFilter('all')} />
          <PurchasingFilterChip active={filter === 'waiting'} label="Aguardando" count={waiting.length} tone="cyan" onClick={() => setFilter('waiting')} />
          <PurchasingFilterChip active={filter === 'partial'} label="Parcial" count={partial.length} tone="amber" onClick={() => setFilter('partial')} />
          <PurchasingFilterChip active={filter === 'conference'} label="Em processo" count={conference.length} tone="purple" onClick={() => setFilter('conference')} />
          <PurchasingFilterChip active={filter === 'delayed'} label="Atrasado" count={delayed.length} tone="rose" onClick={() => setFilter('delayed')} />
          <PurchasingFilterChip active={filter === 'done'} label="Concluída" count={done.length} tone="green" onClick={() => setFilter('done')} />
        </PurchasingToolbar>

        {loading ? (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[250px] rounded-[16px]" />)}
          </div>
        ) : cards.length === 0 ? (
          <PurchasingEmptyState label="Nenhum recebimento encontrado." />
        ) : view === 'table' ? (
          <div className="overflow-hidden rounded-[14px] border border-zinc-200 bg-white">
            <div className="grid grid-cols-[120px_1.5fr_150px_130px_120px_40px] gap-4 border-b border-zinc-200 bg-zinc-50 px-4 py-3 text-[11px] font-black uppercase tracking-[0.08em] text-zinc-500">
              <span>Código</span><span>Recebimento</span><span>Status</span><span className="text-right">Valor</span><span>Previsão</span><span />
            </div>
            <div className="divide-y divide-zinc-100">
              {cards.map(({ receipt, cfg }) => (
                <Link key={receipt.id} href={`/dashboard/purchasing/orders/${receipt.purchaseOrderId}/receipt`} className="grid grid-cols-[120px_1.5fr_150px_130px_120px_40px] items-center gap-4 px-4 py-3 text-sm hover:bg-zinc-50">
                  <span className="font-mono text-xs font-black text-zinc-600">{receiptCode(receipt.purchaseOrderId)}</span>
                  <span className="font-bold text-zinc-950">{receipt.supplierName || 'Recebimento de compra'}</span>
                  <span><PurchasingStatusBadge label={cfg.label} tone={cfg.tone} /></span>
                  <span className="text-right font-mono font-black text-zinc-950">{purchasingCompactMoney(receiptDisplayTotal(receipt))}</span>
                  <span className="text-zinc-500">{new Date(receipt.expectedDate).toLocaleDateString('pt-BR')}</span>
                  <span className="text-right text-zinc-400">›</span>
                </Link>
              ))}
            </div>
          </div>
        ) : view === 'kanban' ? (
          <div className="overflow-x-auto pb-3">
            <div className="grid min-w-[1280px] grid-cols-6 gap-3">
              {[
                { label: 'A receber', tone: 'cyan' as const },
                { label: 'Em conferência', tone: 'purple' as const },
                { label: 'Aguardando estoque', tone: 'blue' as const },
                { label: 'Entrada em estoque', tone: 'green' as const },
                { label: 'Recebimento parcial', tone: 'amber' as const },
                { label: 'Concluída', tone: 'green' as const },
              ].map((column) => {
                const columnCards = cards.filter((entry) => entry.cfg.label === column.label || (column.label === 'Em conferência' && entry.receipt.status === 'stocked_with_divergence'));
                return (
                  <PurchasingKanbanColumn key={column.label} label={column.label} tone={column.tone} count={columnCards.length}>
                    {columnCards.map(({ receipt, cfg }) => (
                      <PurchasingKanbanCard
                        key={receipt.id}
                        href={`/dashboard/purchasing/orders/${receipt.purchaseOrderId}/receipt`}
                        tone={cfg.tone}
                        code={receiptCode(receipt.purchaseOrderId)}
                        title={receipt.supplierName || 'Recebimento de compra'}
                        meta={
                          <span className="flex items-center justify-between gap-2">
                            <span>Compra {new Date(purchaseDateById.get(receipt.purchaseOrderId) ?? receipt.createdAt).toLocaleDateString('pt-BR')}</span>
                            {receipt.expectedDate ? <span>Prev. {new Date(receipt.expectedDate).toLocaleDateString('pt-BR')}</span> : null}
                          </span>
                        }
                        badges={<PurchasingStatusBadge label={cfg.label} tone={cfg.tone} />}
                        footerLeft={receipt.receiptMode === 'immediate_pickup' ? 'Retirada' : 'Entrega'}
                        amount={purchasingCompactMoney(receiptDisplayTotal(receipt))}
                      >
                        <PurchasingItemsPreview receiptId={receipt.id} />
                      </PurchasingKanbanCard>
                    ))}
                  </PurchasingKanbanColumn>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
            {cards.map(({ receipt, cfg }) => (
              <PurchasingPipelineCard
                key={receipt.id}
                href={`/dashboard/purchasing/orders/${receipt.purchaseOrderId}/receipt`}
                tone={cfg.tone}
                code={receiptCode(receipt.purchaseOrderId)}
                title={receipt.supplierName || 'Recebimento de compra'}
                badges={<PurchasingStatusBadge label={cfg.label} tone={cfg.tone} />}
                progress={cfg.progress}
                lines={[
                  { label: receipt.receiptMode === 'immediate_pickup' ? 'Retirada imediata' : 'Entrega futura' },
                  { label: `Prev.: ${new Date(receipt.expectedDate).toLocaleDateString('pt-BR')}` },
                  { label: receipt.notes || 'Sem observação' },
                ]}
                footerLeft={<span>{receipt.status === 'awaiting_delivery' ? 'Aguardando chegada' : 'Recebimento'}</span>}
                amount={purchasingCompactMoney(receiptDisplayTotal(receipt))}
                age={purchasingAgeLabel(receipt.stockEnteredAt ?? receipt.createdAt)}
              />
            ))}
          </div>
        )}
      </PurchasingPageFrame>
    </PermissionGuard>
  );
}
