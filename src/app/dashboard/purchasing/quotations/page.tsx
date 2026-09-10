"use client";

import { useMemo, useState } from 'react';
import { BarChart3, Plus, Search } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { PermissionGuard } from '@/components/permission-guard';
import { CreateQuotationModal } from '@/components/purchasing/create-quotation-modal';
import { PurchasingModuleNavigation } from '@/components/purchasing/purchasing-module-navigation';
import { useQuotations } from '@/hooks/use-quotations';
import { useEntities } from '@/hooks/use-entities';
import { useAuth } from '@/hooks/use-auth';
import { canCreateQuotation, canViewPurchasing } from '@/lib/purchasing-permissions';
import { type Quotation } from '@/types';
import {
  PurchasingEmptyState,
  PurchasingFilterChip,
  PurchasingPageFrame,
  PurchasingStatusBadge,
  type PurchasingTone,
} from '@/components/purchasing/purchasing-ui';

type QuotationBucket = 'open' | 'active' | 'done' | 'attention';

const statusConfig: Record<Quotation['status'], { label: string; tone: PurchasingTone; bucket: QuotationBucket }> = {
  draft: { label: 'Aberta', tone: 'blue', bucket: 'open' },
  quoted: { label: 'Finalizada', tone: 'purple', bucket: 'active' },
  partially_converted: { label: 'Em conversão', tone: 'purple', bucket: 'active' },
  converted: { label: 'Convertida', tone: 'green', bucket: 'done' },
  archived: { label: 'Arquivada', tone: 'zinc', bucket: 'done' },
  expired: { label: 'Expirada', tone: 'rose', bucket: 'attention' },
  cancelled: { label: 'Cancelada', tone: 'rose', bucket: 'attention' },
};

function quotationCode(id: string) {
  return `COT-${id.slice(-8).toUpperCase()}`;
}

function formatDate(value?: string | null) {
  if (!value) return 'Sem data';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('pt-BR') : 'Sem data';
}

export default function QuotationsPage() {
  const { permissions } = useAuth();
  const { quotations, loading } = useQuotations();
  const { entities } = useEntities();
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | QuotationBucket>('all');
  const canView = canViewPurchasing(permissions);
  const canCreate = canCreateQuotation(permissions);

  const entityNames = useMemo(
    () => new Map(entities.map((entity) => [entity.id, entity.fantasyName ?? entity.name])),
    [entities],
  );

  const rows = useMemo(() => quotations.map((quotation) => {
    const supplier = entityNames.get(quotation.supplierId) ?? 'Fornecedor a definir';
    const config = statusConfig[quotation.status];
    return {
      quotation,
      supplier,
      config,
      searchText: `${quotation.id} ${supplier} ${quotation.status} ${quotation.mode}`.toLowerCase(),
    };
  }), [entityNames, quotations]);

  const counts = useMemo(() => ({
    open: rows.filter((row) => row.config.bucket === 'open').length,
    active: rows.filter((row) => row.config.bucket === 'active').length,
    done: rows.filter((row) => row.config.bucket === 'done').length,
    attention: rows.filter((row) => row.config.bucket === 'attention').length,
  }), [rows]);

  const visibleRows = rows
    .filter((row) => filter === 'all' || row.config.bucket === filter)
    .filter((row) => !search.trim() || row.searchText.includes(search.trim().toLowerCase()));

  return (
    <PermissionGuard allowed={canView}>
      <PurchasingPageFrame>
        <PurchasingModuleNavigation activeTab="quotations" activeStage="quotations" />

        <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-[27px] font-black leading-none tracking-[-0.05em] text-zinc-950">Cotações</h1>
            <p className="mt-1.5 text-[13.5px] text-zinc-600">Preços informados por fornecedor. Nada aqui movimenta estoque ou financeiro.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild className="h-[38px] rounded-[9px] border-zinc-200 bg-white px-4 text-[13px] font-bold shadow-none">
              <Link href="/dashboard/purchasing/quotations/compare">
                <BarChart3 className="mr-2 h-3.5 w-3.5" />
                Comparativo
              </Link>
            </Button>
            {canCreate ? (
              <Button onClick={() => setCreateOpen(true)} className="h-[38px] rounded-[9px] bg-violet-600 px-4 text-[13px] font-extrabold text-white hover:bg-violet-700">
                <Plus className="mr-2 h-3.5 w-3.5" />
                Nova cotação
              </Button>
            ) : null}
          </div>
        </div>

        <div className="mb-3 rounded-[12px] border border-zinc-200 bg-white p-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por código, fornecedor ou modo..."
                className="h-9 rounded-[9px] border-zinc-200 bg-zinc-50 pl-9 text-sm shadow-none"
              />
            </div>
            <span className="text-xs text-zinc-500">{visibleRows.length} de {rows.length} cotações</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <PurchasingFilterChip active={filter === 'all'} label="Todas" count={rows.length} onClick={() => setFilter('all')} />
            <PurchasingFilterChip active={filter === 'open'} label="Abertas" count={counts.open} tone="blue" onClick={() => setFilter('open')} />
            <PurchasingFilterChip active={filter === 'active'} label="Em cotação" count={counts.active} tone="purple" onClick={() => setFilter('active')} />
            <PurchasingFilterChip active={filter === 'done'} label="Convertidas" count={counts.done} tone="green" onClick={() => setFilter('done')} />
            <PurchasingFilterChip active={filter === 'attention'} label="Atenção" count={counts.attention} tone="rose" onClick={() => setFilter('attention')} />
          </div>
        </div>

        {loading ? (
          <div className="overflow-hidden rounded-[14px] border border-zinc-200 bg-white">
            {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="m-4 h-12 rounded-lg" />)}
          </div>
        ) : visibleRows.length === 0 ? (
          <PurchasingEmptyState label="Nenhuma cotação encontrada." />
        ) : (
          <div className="overflow-x-auto rounded-[14px] border border-zinc-200 bg-white">
            <div className="min-w-[820px]">
              <div className="grid grid-cols-[132px_minmax(250px,1.6fr)_150px_120px_150px_32px] gap-4 border-b border-zinc-200 bg-zinc-50 px-4 py-3 text-[10px] font-black uppercase tracking-[0.1em] text-zinc-500">
                <span>Código</span><span>Fornecedor</span><span>Situação</span><span>Modo</span><span>Validade</span><span />
              </div>
              <div className="divide-y divide-zinc-100">
                {visibleRows.map(({ quotation, supplier, config }) => (
                  <Link
                    key={quotation.id}
                    href={`/dashboard/purchasing/quotations/${quotation.id}`}
                    className="grid grid-cols-[132px_minmax(250px,1.6fr)_150px_120px_150px_32px] items-center gap-4 px-4 py-3.5 transition-colors hover:bg-zinc-50"
                  >
                    <div>
                      <div className="font-mono text-[11.5px] font-extrabold text-zinc-700">{quotationCode(quotation.id)}</div>
                      <div className="mt-1 text-[10.5px] text-zinc-500">{formatDate(quotation.createdAt)}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-extrabold tracking-[-0.02em] text-zinc-950">{supplier}</div>
                      <p className="mt-1 truncate text-xs text-zinc-500">{quotation.notes || 'Sem observações registradas'}</p>
                    </div>
                    <span><PurchasingStatusBadge label={config.label} tone={config.tone} /></span>
                    <span className="text-xs font-semibold text-zinc-600">{quotation.mode === 'remote' ? 'Remota' : 'In loco'}</span>
                    <span className="text-xs text-zinc-500">{formatDate(quotation.validUntil)}</span>
                    <span className="text-right text-lg text-zinc-300">›</span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="mt-3 flex flex-col gap-3 rounded-[14px] border border-zinc-200 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-black tracking-[-0.02em] text-zinc-950">Comparação por item</h2>
            <p className="mt-1 text-xs text-zinc-500">Compare os preços normalizados das cotações finalizadas e monte a compra.</p>
          </div>
          <Button asChild className="h-9 rounded-[9px] bg-zinc-950 px-4 text-xs font-extrabold text-white hover:bg-zinc-800">
            <Link href="/dashboard/purchasing/quotations/compare">Abrir comparativo</Link>
          </Button>
        </div>
      </PurchasingPageFrame>

      <CreateQuotationModal open={createOpen} onOpenChange={setCreateOpen} />
    </PermissionGuard>
  );
}
