"use client";

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import Link from 'next/link';

import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { PermissionGuard } from '@/components/permission-guard';
import { PurchasingModuleNavigation } from '@/components/purchasing/purchasing-module-navigation';
import { usePurchaseReceipts } from '@/hooks/use-purchase-receipts';
import { usePurchaseOrders } from '@/hooks/use-purchase-orders';
import { useAuth } from '@/hooks/use-auth';
import { canViewPurchasing } from '@/lib/purchasing-permissions';
import { isConfirmedOrderAwaitingReceipt } from '@/lib/purchasing-receipt-queue';
import { type PurchaseReceipt } from '@/types';
import {
  PurchasingEmptyState,
  PurchasingFilterChip,
  PurchasingPageFrame,
  PurchasingStatusBadge,
  purchasingCompactMoney,
  type PurchasingTone,
} from '@/components/purchasing/purchasing-ui';

type ReceiptBucket = 'waiting' | 'partial' | 'conference' | 'divergence' | 'done' | 'cancelled';

const statusConfig: Record<PurchaseReceipt['status'], { label: string; tone: PurchasingTone; progress: number; bucket: ReceiptBucket }> = {
  awaiting_delivery: { label: 'A receber', tone: 'cyan', progress: 0, bucket: 'waiting' },
  in_conference: { label: 'Em conferência', tone: 'purple', progress: 1, bucket: 'conference' },
  awaiting_stock: { label: 'Aguardando estoque', tone: 'blue', progress: 2, bucket: 'conference' },
  in_stock_entry: { label: 'Entrada em estoque', tone: 'green', progress: 2, bucket: 'conference' },
  partially_stocked: { label: 'Recebimento parcial', tone: 'amber', progress: 2, bucket: 'partial' },
  stocked: { label: 'Concluída', tone: 'green', progress: 3, bucket: 'done' },
  stocked_with_divergence: { label: 'Com divergência', tone: 'rose', progress: 2, bucket: 'divergence' },
  cancelled: { label: 'Cancelada', tone: 'zinc', progress: 0, bucket: 'cancelled' },
};

const fallbackStatusConfig = {
  label: 'Em processamento',
  tone: 'zinc' as PurchasingTone,
  progress: 1,
  bucket: 'conference' as ReceiptBucket,
};

function getReceiptStatusConfig(status: PurchaseReceipt['status'] | string | null | undefined) {
  return statusConfig[status as PurchaseReceipt['status']] ?? fallbackStatusConfig;
}

const segmentClasses: Record<PurchasingTone, string> = {
  blue: 'bg-blue-600',
  amber: 'bg-amber-600',
  purple: 'bg-violet-600',
  cyan: 'bg-cyan-600',
  green: 'bg-emerald-600',
  rose: 'bg-rose-600',
  zinc: 'bg-zinc-500',
};

function receiptCode(id: string) {
  return `CMP-${id.slice(-8).toUpperCase()}`;
}

function receiptDisplayTotal(receipt: PurchaseReceipt) {
  return receipt.totalConfirmed && receipt.totalConfirmed > 0
    ? receipt.totalConfirmed
    : receipt.totalEstimated;
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('pt-BR') : '—';
}

function progressLabel(status: PurchaseReceipt['status']) {
  if (status === 'awaiting_delivery') return 'Aguardando chegada';
  if (status === 'in_conference') return 'Conferência iniciada';
  if (status === 'awaiting_stock') return 'Conferido';
  if (status === 'in_stock_entry') return 'Gravando estoque';
  if (status === 'partially_stocked') return 'Saldo pendente';
  if (status === 'stocked_with_divergence') return 'Tratativa pendente';
  if (status === 'stocked') return '3 de 3 etapas';
  return 'Encerrado';
}

export default function ReceiptsPage() {
  const { permissions } = useAuth();
  const { receipts, loading } = usePurchaseReceipts();
  const { orders } = usePurchaseOrders();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | ReceiptBucket | 'delayed'>('all');
  const canView = canViewPurchasing(permissions);

  const purchaseOrderById = useMemo(
    () => new Map(orders.map((order) => [order.id, order])),
    [orders],
  );

  const rows = useMemo(() => receipts.map((receipt) => {
    const config = getReceiptStatusConfig(receipt.status);
    const order = purchaseOrderById.get(receipt.purchaseOrderId);
    const delayed = !['stocked', 'cancelled'].includes(receipt.status)
      && Boolean(receipt.expectedDate)
      && new Date(receipt.expectedDate).getTime() < Date.now();
    const waiting = isConfirmedOrderAwaitingReceipt(order);
    return {
      receipt,
      order,
      config,
      delayed,
      waiting,
      searchText: `${receipt.id} ${receipt.purchaseOrderId} ${receipt.supplierName ?? ''} ${receipt.status}`.toLowerCase(),
    };
  }), [purchaseOrderById, receipts]);

  const counts = useMemo(() => ({
    waiting: rows.filter((row) => row.waiting).length,
    partial: rows.filter((row) => row.config.bucket === 'partial').length,
    conference: rows.filter((row) => row.config.bucket === 'conference').length,
    divergence: rows.filter((row) => row.config.bucket === 'divergence').length,
    delayed: rows.filter((row) => row.delayed).length,
    done: rows.filter((row) => row.config.bucket === 'done').length,
  }), [rows]);

  const visibleRows = rows
    .filter((row) => {
      if (filter === 'all') return true;
      if (filter === 'waiting') return row.waiting;
      if (filter === 'delayed') return row.delayed;
      return row.config.bucket === filter;
    })
    .filter((row) => !search.trim() || row.searchText.includes(search.trim().toLowerCase()));

  return (
    <PermissionGuard allowed={canView}>
      <PurchasingPageFrame>
        <PurchasingModuleNavigation activeTab="receipts" activeStage="receiving" />

        <div className="mb-4">
          <h1 className="text-[27px] font-black leading-none tracking-[-0.05em] text-zinc-950">Recebimentos</h1>
          <p className="mt-1.5 text-[13.5px] text-zinc-600">Um recebimento por pedido confirmado. Abra para conferir item por item.</p>
        </div>

        <div className="mb-3 rounded-[12px] border border-zinc-200 bg-white p-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por pedido, fornecedor ou situação..."
                className="h-9 rounded-[9px] border-zinc-200 bg-zinc-50 pl-9 text-sm shadow-none"
              />
            </div>
            <span className="text-xs text-zinc-500">{visibleRows.length} de {rows.length} recebimentos</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <PurchasingFilterChip active={filter === 'all'} label="Todos" count={rows.length} onClick={() => setFilter('all')} />
            <PurchasingFilterChip active={filter === 'waiting'} label="Aguardando" count={counts.waiting} tone="cyan" onClick={() => setFilter('waiting')} />
            <PurchasingFilterChip active={filter === 'partial'} label="Parcial" count={counts.partial} tone="amber" onClick={() => setFilter('partial')} />
            <PurchasingFilterChip active={filter === 'conference'} label="Em processo" count={counts.conference} tone="purple" onClick={() => setFilter('conference')} />
            <PurchasingFilterChip active={filter === 'divergence'} label="Divergência" count={counts.divergence} tone="rose" onClick={() => setFilter('divergence')} />
            <PurchasingFilterChip active={filter === 'delayed'} label="Atrasado" count={counts.delayed} tone="rose" onClick={() => setFilter('delayed')} />
            <PurchasingFilterChip active={filter === 'done'} label="Concluído" count={counts.done} tone="green" onClick={() => setFilter('done')} />
          </div>
        </div>

        {loading ? (
          <div className="overflow-hidden rounded-[14px] border border-zinc-200 bg-white">
            {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="m-4 h-12 rounded-lg" />)}
          </div>
        ) : visibleRows.length === 0 ? (
          <PurchasingEmptyState label="Nenhum recebimento encontrado." />
        ) : (
          <div className="overflow-x-auto rounded-[14px] border border-zinc-200 bg-white">
            <div className="min-w-[900px]">
              <div className="grid grid-cols-[132px_minmax(250px,1.7fr)_172px_164px_130px] gap-4 border-b border-zinc-200 bg-zinc-50 px-4 py-3 text-[10px] font-black uppercase tracking-[0.1em] text-zinc-500">
                <span>Pedido</span><span>Fornecedor</span><span>Situação</span><span>Conferência</span><span className="text-right">Valor</span>
              </div>
              <div className="divide-y divide-zinc-100">
                {visibleRows.map(({ receipt, order, config, delayed }) => (
                  <Link
                    key={receipt.id}
                    href={`/dashboard/purchasing/orders/${receipt.purchaseOrderId}/receipt`}
                    className="grid grid-cols-[132px_minmax(250px,1.7fr)_172px_164px_130px] items-center gap-4 px-4 py-3.5 transition-colors hover:bg-zinc-50"
                  >
                    <div>
                      <div className="font-mono text-[11.5px] font-extrabold text-zinc-700">{receiptCode(receipt.purchaseOrderId)}</div>
                      <div className={`mt-1 text-[10.5px] ${delayed ? 'font-bold text-rose-700' : 'text-zinc-500'}`}>
                        {delayed ? 'Atrasado · ' : 'Prev. '}{formatDate(receipt.expectedDate)}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-extrabold tracking-[-0.02em] text-zinc-950">{receipt.supplierName || order?.supplierName || 'Recebimento de compra'}</div>
                      <p className="mt-1 truncate text-xs text-zinc-500">{receipt.notes || (receipt.receiptMode === 'immediate_pickup' ? 'Retirada imediata' : 'Entrega futura')}</p>
                    </div>
                    <span><PurchasingStatusBadge label={config.label} tone={config.tone} /></span>
                    <div>
                      <div className="text-xs font-bold text-zinc-700">{progressLabel(receipt.status)}</div>
                      <div className="mt-2 flex gap-[3px]">
                        {Array.from({ length: 3 }).map((_, index) => (
                          <span key={index} className={`h-1 w-8 rounded-full ${index < config.progress ? segmentClasses[config.tone] : 'bg-zinc-200'}`} />
                        ))}
                      </div>
                    </div>
                    <div className="text-right font-mono text-[13px] font-extrabold text-zinc-950">{purchasingCompactMoney(receiptDisplayTotal(receipt))}</div>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        )}
      </PurchasingPageFrame>
    </PermissionGuard>
  );
}
