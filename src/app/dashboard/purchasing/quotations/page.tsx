"use client";

import { useMemo, useState } from 'react';
import { BarChart3, CheckCircle2, FileText, Plus, Send } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PermissionGuard } from '@/components/permission-guard';
import { CreateQuotationModal } from '@/components/purchasing/create-quotation-modal';
import { PurchasingItemsPreview } from '@/components/purchasing/purchasing-items-preview';
import { useQuotations } from '@/hooks/use-quotations';
import { useEntities } from '@/hooks/use-entities';
import { useAuth } from '@/hooks/use-auth';
import { canCreateQuotation, canViewPurchasing } from '@/lib/purchasing-permissions';
import { type Quotation } from '@/types';
import {
  PurchasingEmptyState,
  PurchasingFilterChip,
  PurchasingHeader,
  PurchasingMetricCard,
  PurchasingPageFrame,
  PurchasingPeriodControl,
  PurchasingPipelineCard,
  PurchasingStatusBadge,
  PurchasingToolbar,
  createDefaultPurchasingPeriod,
  isDateInPurchasingPeriod,
  purchasingAgeLabel,
  purchasingYearOptions,
  type PurchasingTone,
} from '@/components/purchasing/purchasing-ui';

const statusConfig: Record<Quotation['status'], { label: string; tone: PurchasingTone; progress: number; bucket: 'open' | 'approval' | 'quote' | 'done' }> = {
  draft: { label: 'Solicit.', tone: 'blue', progress: 1, bucket: 'open' },
  quoted: { label: 'Finalizada', tone: 'green', progress: 3, bucket: 'done' },
  partially_converted: { label: 'Cotação', tone: 'purple', progress: 3, bucket: 'quote' },
  converted: { label: 'Convertida', tone: 'green', progress: 4, bucket: 'done' },
  archived: { label: 'Arquivada', tone: 'zinc', progress: 8, bucket: 'done' },
  expired: { label: 'Expirada', tone: 'rose', progress: 2, bucket: 'approval' },
  cancelled: { label: 'Cancelada', tone: 'rose', progress: 1, bucket: 'done' },
};

const fallbackStatusConfig: { label: string; tone: PurchasingTone; progress: number; bucket: 'open' | 'approval' | 'quote' | 'done' } = {
  label: 'Cotação',
  tone: 'zinc',
  progress: 1,
  bucket: 'open',
};

function quotationCode(id: string) {
  return `CMP-${id.slice(-8).toUpperCase()}`;
}

export default function QuotationsPage() {
  const { permissions } = useAuth();
  const { quotations, loading } = useQuotations();
  const { entities } = useEntities();
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'open' | 'approval' | 'quote' | 'done'>('all');
  const [view, setView] = useState<'cards' | 'table' | 'kanban'>('kanban');
  const [period, setPeriod] = useState(createDefaultPurchasingPeriod);
  const canView = canViewPurchasing(permissions);
  const canCreate = canCreateQuotation(permissions);

  const supplierName = (supplierId: string) => {
    const supplier = entities.find((e) => e.id === supplierId);
    return supplier?.fantasyName ?? supplier?.name ?? 'Fornecedor a definir';
  };

  const periodYears = useMemo(
    () => purchasingYearOptions(quotations.map((quotation) => quotation.createdAt)),
    [quotations],
  );

  const periodQuotations = useMemo(
    () => quotations.filter((quotation) => isDateInPurchasingPeriod(quotation.createdAt, period)),
    [period, quotations],
  );

  const counts = useMemo(() => {
    const open = periodQuotations.filter((q) => q.status === 'draft').length;
    const quote = periodQuotations.filter((q) => q.status === 'partially_converted').length;
    const quoted = periodQuotations.filter((q) => q.status === 'quoted').length;
    const converted = periodQuotations.filter((q) => q.status === 'converted').length;
    const archived = periodQuotations.filter((q) => q.status === 'archived').length;
    const expired = periodQuotations.filter((q) => q.status === 'expired').length;
    const cancelled = periodQuotations.filter((q) => q.status === 'cancelled').length;
    const done = quoted + converted + archived + expired + cancelled;
    const attention = expired + cancelled;
    return { open, quote, done, attention, quoted, converted, archived, expired, cancelled };
  }, [periodQuotations]);

  const cards = useMemo(() => {
    return periodQuotations
      .map((quotation) => {
        const cfg = statusConfig[quotation.status] ?? fallbackStatusConfig;
        const supplier = supplierName(quotation.supplierId);
        return {
          quotation,
          cfg,
          supplier,
          searchText: `${quotation.id} ${supplier} ${quotation.status} ${quotation.mode}`.toLowerCase(),
        };
      })
      .filter((entry) => filter === 'all' || entry.cfg.bucket === filter)
      .filter((entry) => !search.trim() || entry.searchText.includes(search.trim().toLowerCase()));
  }, [filter, periodQuotations, search, entities]);

  return (
    <PermissionGuard allowed={canView}>
      <PurchasingPageFrame>
        <PurchasingHeader
          crumb={['Coala', 'Compras', 'Solicitações de cotação']}
          title="Solicitações de cotação"
          description="Cotações em andamento e comparativos por fornecedor antes de virar pedido."
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

        <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-4">
          <PurchasingMetricCard active label="Total de cotações" value={periodQuotations.length} detail={`${counts.open + counts.quote} ativas`} tone="purple" icon={<Send className="h-5 w-5" />} />
          <PurchasingMetricCard label="Abertas" value={counts.open} detail="aguardando itens" tone="blue" icon={<FileText className="h-5 w-5" />} />
          <PurchasingMetricCard label="Em cotação" value={counts.quote} detail="comparativos abertos" tone="purple" icon={<BarChart3 className="h-5 w-5" />} />
          <PurchasingMetricCard
            label="Concluídas"
            value={counts.done}
            detail="encerradas no período"
            tone="green"
            icon={<CheckCircle2 className="h-5 w-5" />}
            foot={
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                <span>Convertidas {counts.converted}</span>
                <span>Finalizadas {counts.quoted}</span>
                <span>Arquivadas {counts.archived}</span>
                <span>Canceladas {counts.cancelled}</span>
                <span>Expiradas {counts.expired}</span>
              </div>
            }
          />
        </div>

        <PurchasingToolbar
          search={search}
          onSearchChange={setSearch}
          resultLabel={`${cards.length} de ${periodQuotations.length} cotações`}
          view={view}
          onViewChange={setView}
          periodControl={<PurchasingPeriodControl value={period} onChange={setPeriod} years={periodYears} />}
        >
          <PurchasingFilterChip active={filter === 'all'} label="Todos" count={periodQuotations.length} onClick={() => setFilter('all')} />
          <PurchasingFilterChip active={filter === 'open'} label="Aberta" count={counts.open} tone="blue" onClick={() => setFilter('open')} />
          <PurchasingFilterChip active={filter === 'quote'} label="Em cotação" count={counts.quote} tone="purple" onClick={() => setFilter('quote')} />
          <PurchasingFilterChip active={filter === 'done'} label="Concluída" count={counts.done} tone="green" onClick={() => setFilter('done')} />
          <PurchasingFilterChip active={filter === 'approval'} label="Atenção" count={counts.attention} tone="rose" onClick={() => setFilter('approval')} />
        </PurchasingToolbar>

        {loading ? (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[250px] rounded-[16px]" />)}
          </div>
        ) : cards.length === 0 ? (
          <PurchasingEmptyState label="Nenhuma cotação encontrada." />
        ) : view === 'table' ? (
          <div className="overflow-hidden rounded-[14px] border border-zinc-200 bg-white">
            <div className="grid grid-cols-[120px_1.5fr_150px_130px_130px_40px] gap-4 border-b border-zinc-200 bg-zinc-50 px-4 py-3 text-[11px] font-black uppercase tracking-[0.08em] text-zinc-500">
              <span>Código</span><span>Fornecedor</span><span>Status</span><span>Modo</span><span>Data</span><span />
            </div>
            <div className="divide-y divide-zinc-100">
              {cards.map(({ quotation, cfg, supplier }) => (
                <Link key={quotation.id} href={`/dashboard/purchasing/quotations/${quotation.id}`} className="grid grid-cols-[120px_1.5fr_150px_130px_130px_40px] items-center gap-4 px-4 py-3 text-sm hover:bg-zinc-50">
                  <span className="font-mono text-xs font-black text-zinc-600">{quotationCode(quotation.id)}</span>
                  <span className="font-bold text-zinc-950">{supplier}</span>
                  <span><PurchasingStatusBadge label={cfg.label} tone={cfg.tone} /></span>
                  <span className="text-zinc-500">{quotation.mode === 'remote' ? 'Remota' : 'In loco'}</span>
                  <span className="text-zinc-500">{quotation.validUntil ? new Date(quotation.validUntil).toLocaleDateString('pt-BR') : '-'}</span>
                  <span className="text-right text-zinc-400">›</span>
                </Link>
              ))}
            </div>
          </div>
        ) : view === 'kanban' ? (
          <div className="overflow-x-auto pb-3">
            <div className="grid min-w-[980px] grid-cols-4 gap-3">
              {[
                { label: 'Solicitação aberta', bucket: 'open' as const, tone: 'blue' as const },
                { label: 'Em cotação', bucket: 'quote' as const, tone: 'purple' as const },
                { label: 'Atenção', bucket: 'approval' as const, tone: 'rose' as const },
                { label: 'Concluída', bucket: 'done' as const, tone: 'green' as const },
              ].map((column) => {
                const columnCards = cards.filter((entry) => entry.cfg.bucket === column.bucket);
                return (
                  <div key={column.label} className="flex h-[calc(100vh-360px)] min-h-[380px] flex-col rounded-[14px] border border-zinc-200 bg-white/70 p-3">
                    <div className="mb-3 flex items-center justify-between">
                      <PurchasingStatusBadge label={column.label} tone={column.tone} />
                      <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold text-zinc-500">{columnCards.length}</span>
                    </div>
                    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                      {columnCards.map(({ quotation, cfg, supplier }) => (
                        <Link key={quotation.id} href={`/dashboard/purchasing/quotations/${quotation.id}`} className="block rounded-[10px] border border-zinc-200 bg-white p-3 shadow-sm hover:bg-zinc-50">
                          <span className="block text-[10px] font-bold uppercase tracking-wide text-zinc-400">{new Date(quotation.createdAt).toLocaleDateString('pt-BR')}</span>
                          <div className="mt-0.5 flex items-center justify-between gap-2">
                            <span className="font-mono text-[11px] font-black text-zinc-500">{quotationCode(quotation.id)}</span>
                            <PurchasingStatusBadge label={cfg.label} tone={cfg.tone} />
                          </div>
                          <p className="mt-2 line-clamp-2 text-sm font-black leading-tight text-zinc-950">{supplier}</p>
                          <PurchasingItemsPreview quotationId={quotation.id} />
                          <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
                            <span>{quotation.mode === 'remote' ? 'Remota' : 'In loco'}</span>
                            <span>{quotation.validUntil ? new Date(quotation.validUntil).toLocaleDateString('pt-BR') : 'Sem data'}</span>
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
            {cards.map(({ quotation, cfg, supplier }) => (
              <PurchasingPipelineCard
                key={quotation.id}
                href={`/dashboard/purchasing/quotations/${quotation.id}`}
                tone={cfg.tone}
                code={quotationCode(quotation.id)}
                title={supplier}
                badges={
                  <>
                    <PurchasingStatusBadge label={cfg.label} tone={cfg.tone} />
                    <PurchasingStatusBadge label={quotation.mode === 'remote' ? 'Remota' : 'In loco'} tone="zinc" />
                  </>
                }
                progress={cfg.progress}
                lines={[
                  { label: quotation.mode === 'remote' ? 'Compra remota' : 'Cotação em loja' },
                  { label: quotation.validUntil ? `Cotada em ${new Date(quotation.validUntil).toLocaleDateString('pt-BR')}` : 'Sem data da cotação' },
                  { label: quotation.notes || 'Sem observação' },
                ]}
                footerLeft={<span>{supplier}</span>}
                age={purchasingAgeLabel(quotation.createdAt)}
              />
            ))}
          </div>
        )}
      </PurchasingPageFrame>

      <CreateQuotationModal open={createOpen} onOpenChange={setCreateOpen} />
    </PermissionGuard>
  );
}
