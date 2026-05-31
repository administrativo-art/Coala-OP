"use client";

import { useMemo, useState } from 'react';
import { BarChart3, CheckCircle2, Plus, Send, ShoppingCart, AlertTriangle } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { PermissionGuard } from '@/components/permission-guard';
import { CreateQuotationModal } from '@/components/purchasing/create-quotation-modal';
import { useQuotations } from '@/hooks/use-quotations';
import { usePurchaseOrders } from '@/hooks/use-purchase-orders';
import { useAuth } from '@/hooks/use-auth';
import { canCreateQuotation, canViewPurchasing } from '@/lib/purchasing-permissions';
import { PurchasingItemsPreview } from '@/components/purchasing/purchasing-items-preview';
import {
  PurchasingEmptyState,
  PurchasingFilterChip,
  PurchasingHeader,
  PurchasingMetricCard,
  PurchasingPageFrame,
  PurchasingPipelineCard,
  PurchasingStatusBadge,
  PurchasingToolbar,
  purchasingAgeLabel,
  purchasingCompactMoney,
  type PurchasingTone,
} from '@/components/purchasing/purchasing-ui';

function codeFromId(id: string) {
  return `CMP-${id.slice(-8).toUpperCase()}`;
}

export default function PurchasingHubPage() {
  const { permissions } = useAuth();
  const { quotations } = useQuotations();
  const { orders } = usePurchaseOrders();
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'progress' | 'quotation' | 'order' | 'done'>('all');
  const [view, setView] = useState<'cards' | 'table' | 'kanban'>('kanban');
  const canView = canViewPurchasing(permissions);
  const canCreate = canCreateQuotation(permissions);

  const awaitingApproval = orders.filter((o) => o.status === 'created' && !o.receivedAt);
  const quotationActive = quotations.filter((q) => q.status === 'draft' || q.status === 'partially_converted');
  const ordersOpen = orders.filter((o) => o.status === 'confirmed' && !o.receivedAt);
  const completed = orders.filter((o) => !!o.receivedAt);
  const openValue = orders
    .filter((o) => !o.receivedAt && o.status !== 'cancelled')
    .reduce((sum, order) => sum + (order.totalEstimated ?? 0), 0);

  const cards = useMemo(() => {
    const quotationCards = quotationActive.map((q) => ({
      kind: 'quotation' as const,
      id: q.id,
      quotationId: q.id,
      href: `/dashboard/purchasing/quotations/${q.id}`,
      code: codeFromId(q.id),
      title: `Cotação ${q.mode === 'remote' ? 'remota' : 'in loco'}`,
      tone: (q.status === 'partially_converted' ? 'purple' : 'blue') as PurchasingTone,
      status: q.status === 'partially_converted' ? 'Cotação parcial' : 'Solicit.',
      stageLabel: q.status === 'partially_converted' ? 'Em cotação' : 'Solicitação aberta',
      progress: q.status === 'partially_converted' ? 3 : 1,
      amount: undefined,
      age: purchasingAgeLabel(q.createdAt),
      lines: [
        { label: q.mode === 'remote' ? 'Comparativo remoto' : 'Cotação em loja' },
        { label: q.validUntil ? `Data: ${new Date(q.validUntil).toLocaleDateString('pt-BR')}` : 'Sem data definida' },
      ],
      searchText: `${q.id} cotacao ${q.mode} ${q.status}`.toLowerCase(),
    }));

    const orderCards = orders
      .filter((o) => o.status !== 'cancelled' && !o.receivedAt)
      .map((o) => {
        const isReview = o.status === 'created';
        const tone: PurchasingTone = isReview ? 'amber' : 'blue';
        return {
          kind: isReview ? 'progress' as const : 'order' as const,
          id: o.id,
          orderId: o.id,
          href: `/dashboard/purchasing/orders/${o.id}`,
          code: codeFromId(o.id),
          title: o.supplierName || (o.origin === 'direct' ? 'Compra direta' : 'Pedido via cotação'),
          tone,
          status: isReview ? 'Aprov.' : 'Pedido',
          stageLabel: isReview ? 'Em aprovação' : 'Pedido emitido',
          progress: isReview ? 2 : 4,
          amount: purchasingCompactMoney(o.totalEstimated),
          age: purchasingAgeLabel(o.createdAt),
          lines: [
            { label: o.origin === 'direct' ? 'Compra direta' : 'Via cotação' },
            { label: o.receiptMode === 'immediate_pickup' ? 'Retirada imediata' : 'Entrega futura' },
            { label: `Prev.: ${new Date(o.estimatedReceiptDate).toLocaleDateString('pt-BR')}` },
          ],
          searchText: `${o.id} ${o.supplierName ?? ''} ${o.origin} ${o.status}`.toLowerCase(),
        };
      });

    const doneCards = completed.slice(0, 6).map((o) => ({
      kind: 'done' as const,
      id: o.id,
      orderId: o.id,
      href: `/dashboard/purchasing/orders/${o.id}`,
      code: codeFromId(o.id),
      title: o.supplierName || 'Compra concluída',
      tone: 'green' as PurchasingTone,
      status: 'Concluída',
      stageLabel: 'Concluída',
      progress: 8,
      amount: purchasingCompactMoney(o.totalConfirmed ?? o.totalEstimated),
      age: purchasingAgeLabel(o.receivedAt ?? o.createdAt),
      lines: [
        { label: o.origin === 'direct' ? 'Compra direta' : 'Via cotação' },
        { label: o.receivedAt ? `Recebida: ${new Date(o.receivedAt).toLocaleDateString('pt-BR')}` : 'Recebida' },
      ],
      searchText: `${o.id} ${o.supplierName ?? ''} concluida recebida`.toLowerCase(),
    }));

    return [...quotationCards, ...orderCards, ...doneCards]
      .filter((card) => filter === 'all' || card.kind === filter)
      .filter((card) => !search.trim() || card.searchText.includes(search.trim().toLowerCase()));
  }, [completed, filter, orders, quotationActive, search]);

  return (
    <PermissionGuard allowed={canView}>
      <PurchasingPageFrame>
        <PurchasingHeader
          crumb={['Coala', 'Compras']}
          title="Compras"
          description="Pipeline completo, da cotação ao lançamento financeiro."
          actions={
            <>
              <Button variant="outline" asChild className="h-11 rounded-[10px] border-zinc-200 bg-white shadow-none">
                <Link href="/dashboard/purchasing/quotations/compare">
                  <BarChart3 className="mr-2 h-4 w-4" />
                  Comparativo
                </Link>
              </Button>
              {canCreate && (
                <Button onClick={() => setCreateOpen(true)} className="h-11 rounded-[10px] bg-violet-600 px-5 font-bold text-white hover:bg-violet-700">
                  <Plus className="mr-2 h-4 w-4" />
                  Nova cotação
                </Button>
              )}
            </>
          }
        />

        <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <PurchasingMetricCard label="Em andamento" value={quotationActive.length + awaitingApproval.length + ordersOpen.length} detail={purchasingCompactMoney(openValue)} tone="purple" icon={<Send className="h-5 w-5" />} />
          <PurchasingMetricCard label="Aguardando aprov." value={awaitingApproval.length} detail="precisa decidir" tone="amber" icon={<AlertTriangle className="h-5 w-5" />} />
          <PurchasingMetricCard label="Em cotação" value={quotationActive.length} detail="comparativos abertos" tone="purple" icon={<BarChart3 className="h-5 w-5" />} />
          <PurchasingMetricCard label="Pedido emitido" value={ordersOpen.length} detail="aguarda recebimento" tone="blue" icon={<ShoppingCart className="h-5 w-5" />} />
          <PurchasingMetricCard label="Concluídas" value={completed.length} detail="recebidas" tone="green" icon={<CheckCircle2 className="h-5 w-5" />} />
        </div>

        <PurchasingToolbar search={search} onSearchChange={setSearch} resultLabel={`${cards.length} compras`} view={view} onViewChange={setView}>
          <PurchasingFilterChip active={filter === 'all'} label="Todos" count={quotationActive.length + awaitingApproval.length + ordersOpen.length + completed.length} onClick={() => setFilter('all')} />
          <PurchasingFilterChip active={filter === 'progress'} label="Aprov." count={awaitingApproval.length} tone="amber" onClick={() => setFilter('progress')} />
          <PurchasingFilterChip active={filter === 'quotation'} label="Cotação" count={quotationActive.length} tone="purple" onClick={() => setFilter('quotation')} />
          <PurchasingFilterChip active={filter === 'order'} label="Pedido" count={ordersOpen.length} tone="blue" onClick={() => setFilter('order')} />
          <PurchasingFilterChip active={filter === 'done'} label="Concluída" count={completed.length} tone="green" onClick={() => setFilter('done')} />
        </PurchasingToolbar>

        {cards.length === 0 ? (
          <PurchasingEmptyState label="Nenhuma compra encontrada para os filtros atuais." />
        ) : view === 'table' ? (
          <div className="overflow-hidden rounded-[14px] border border-zinc-200 bg-white">
            <div className="grid grid-cols-[110px_1.5fr_150px_120px_1fr_130px_120px_40px] gap-4 border-b border-zinc-200 bg-zinc-50 px-4 py-3 text-[11px] font-black uppercase tracking-[0.08em] text-zinc-500">
              <span>Código</span>
              <span>Solicitação</span>
              <span>Etapa</span>
              <span>Origem</span>
              <span>Fornecedor</span>
              <span className="text-right">Valor</span>
              <span>Entrega prev.</span>
              <span />
            </div>
            <div className="divide-y divide-zinc-100">
              {cards.map((card) => (
                <Link
                  key={`${card.kind}-${card.id}`}
                  href={card.href}
                  className="grid grid-cols-[110px_1.5fr_150px_120px_1fr_130px_120px_40px] items-center gap-4 px-4 py-3 text-sm hover:bg-zinc-50"
                >
                  <span className="font-mono text-xs font-black text-zinc-600">{card.code}</span>
                  <span className="font-bold text-zinc-950">{card.title}</span>
                  <span><PurchasingStatusBadge label={card.stageLabel} tone={card.tone} /></span>
                  <span className="text-zinc-500">{card.kind === 'quotation' ? 'Solicit.' : card.kind === 'done' ? 'Finalizada' : 'Compra'}</span>
                  <span className="truncate text-zinc-500">{card.lines?.[0]?.label ?? '-'}</span>
                  <span className="text-right font-mono font-black text-zinc-950">{card.amount ?? '-'}</span>
                  <span className="text-zinc-500">{card.lines?.find((line) => line.label.startsWith('Prev.'))?.label.replace('Prev.: ', '') ?? '-'}</span>
                  <span className="text-right text-zinc-400">›</span>
                </Link>
              ))}
            </div>
          </div>
        ) : view === 'kanban' ? (
          <div className="overflow-x-auto pb-3">
            <div className="grid min-w-[980px] grid-cols-5 gap-3">
              {[
                { label: 'Solicitação aberta', tone: 'blue' as const },
                { label: 'Em aprovação', tone: 'amber' as const },
                { label: 'Em cotação', tone: 'purple' as const },
                { label: 'Pedido emitido', tone: 'blue' as const },
                { label: 'Concluída', tone: 'green' as const },
              ].map((column) => {
                const columnCards = cards.filter((card) => card.stageLabel === column.label);
                return (
                  <div key={column.label} className="flex h-[calc(100vh-360px)] min-h-[380px] flex-col rounded-[14px] border border-zinc-200 bg-white/70 p-3">
                    <div className="mb-3 flex items-center justify-between">
                      <PurchasingStatusBadge label={column.label} tone={column.tone} />
                      <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold text-zinc-500">{columnCards.length}</span>
                    </div>
                    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                      {columnCards.map((card) => (
                        <Link key={`${card.kind}-${card.id}`} href={card.href} className="block rounded-[10px] border border-zinc-200 bg-white p-3 shadow-sm hover:bg-zinc-50">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-[11px] font-black text-zinc-500">{card.code}</span>
                            <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                          </div>
                          <p className="mt-2 line-clamp-2 text-sm font-black leading-tight text-zinc-950">{card.title}</p>
                          <PurchasingItemsPreview orderId={'orderId' in card ? card.orderId : undefined} quotationId={'quotationId' in card ? card.quotationId : undefined} />
                          <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
                            <span>{card.lines?.[0]?.label ?? '-'}</span>
                            <span className="font-mono font-black text-zinc-900">{card.amount ?? '-'}</span>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
            {cards.map((card) => (
              <PurchasingPipelineCard
                key={`${card.kind}-${card.id}`}
                href={card.href}
                tone={card.tone}
                code={card.code}
                title={card.title}
                badges={<PurchasingStatusBadge label={card.status} tone={card.tone} />}
                progress={card.progress}
                lines={card.lines}
                footerLeft={<span>{card.kind === 'done' ? 'Finalizada' : 'Em andamento'}</span>}
                amount={card.amount}
                age={card.age}
              />
            ))}
          </div>
        )}
      </PurchasingPageFrame>

      <CreateQuotationModal open={createOpen} onOpenChange={setCreateOpen} />
    </PermissionGuard>
  );
}
