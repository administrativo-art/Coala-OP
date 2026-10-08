

"use client"

import { useMemo, useState, useEffect } from 'react';
import { DateRange } from 'react-day-picker';
import { format, parseISO, isValid } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { CalendarIcon, Search } from 'lucide-react';
import { Skeleton } from './ui/skeleton';
import { useProducts } from '@/hooks/use-products';
import { useKiosks } from '@/hooks/use-kiosks';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useAuth } from '@/hooks/use-auth';
import { type MovementRecord, type MovementType } from '@/types';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Calendar } from './ui/calendar';

const MOVEMENT_TYPE_CONFIG: Record<string, { label: string; color: string }> = {
    'ENTRADA': { label: 'Entrada', color: 'bg-green-100 text-green-800' },
    'SAIDA_CONSUMO': { label: 'Venda/Consumo', color: 'bg-red-100 text-red-800' },
    'SAIDA_DESCARTE_VENCIMENTO': { label: 'Descarte por Vencimento', color: 'bg-red-100 text-red-800' },
    'SAIDA_DESCARTE_AVARIA': { label: 'Descarte por Avaria', color: 'bg-red-100 text-red-800' },
    'SAIDA_DESCARTE_PERDA': { label: 'Extravio de Mercadoria', color: 'bg-red-100 text-red-800' },
    'SAIDA_DESCARTE_OUTROS': { label: 'Descarte Outros', color: 'bg-red-100 text-red-800' },
    'SAIDA_CORRECAO': { label: 'Divergência (decréscimo)', color: 'bg-red-100 text-red-800' },
    'ENTRADA_CORRECAO': { label: 'Divergência (acréscimo)', color: 'bg-green-100 text-green-800' },
    'ENTRADA_DEVOLUCAO_UNIFORME': { label: 'Devolução de uniforme', color: 'bg-emerald-100 text-emerald-800' },
    'SAIDA_ENTREGA_UNIFORME': { label: 'Entrega de uniforme', color: 'bg-amber-100 text-amber-800' },
    'MIGRACAO_ESTOQUE_UNIFORME': { label: 'Migração para estoque de uniformes', color: 'bg-violet-100 text-violet-800' },
    'TRANSFERENCIA_SAIDA': { label: 'Transferência (Saída)', color: 'bg-blue-100 text-blue-800' },
    'TRANSFERENCIA_ENTRADA': { label: 'Transferência (Entrada)', color: 'bg-blue-100 text-blue-800' },
    'ENTRADA_ESTORNO': { label: 'Estorno (Entrada)', color: 'bg-red-100 text-red-800' },
    'SAIDA_ESTORNO': { label: 'Estorno (Saída)', color: 'bg-green-100 text-green-800' },
};

const ITEMS_PER_PAGE = 50;

type SortKey = keyof MovementRecord | 'productName' | 'kioskName';
type SortDirection = 'asc' | 'desc';

interface MovementHistoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialBaseProductId?: string;
  initialType?: string;
  initialKioskId?: string;
  initialDateRange?: { from: Date; to: Date };
}

export function MovementHistoryModal({ 
  open, 
  onOpenChange, 
  initialBaseProductId, 
  initialType, 
  initialKioskId, 
  initialDateRange 
}: MovementHistoryModalProps) {
  const { products, getProductFullName, loading: loadingProducts } = useProducts();
  const { kiosks, loading: loadingKiosks } = useKiosks();
  const { baseProducts } = useBaseProducts();
  const { firebaseUser } = useAuth();

  // Quando o modal é aberto para um insumo específico (a partir da Análise de
  // Movimentação), convertemos as quantidades para a unidade-base, de modo que
  // os KPIs batam exatamente com os números clicados na tela de análise.
  const baseProductForTotals = useMemo(
    () => (initialBaseProductId ? baseProducts.find(b => b.id === initialBaseProductId) : undefined),
    [initialBaseProductId, baseProducts],
  );
  const [dateRange, setDateRange] = useState<DateRange | undefined>(initialDateRange);
  const [typeFilter, setTypeFilter] = useState(initialType || 'all');
  const [kioskFilter, setKioskFilter] = useState(initialKioskId || 'all');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('timestamp');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [records, setRecords] = useState<MovementRecord[]>([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [movementTotals, setMovementTotals] = useState({ entries: 0, exits: 0, transfers: 0 });
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    setCurrentPage(1);
  }, [dateRange, typeFilter, kioskFilter, searchTerm, sortKey, sortDirection, initialBaseProductId]);

  // Sync state when props change (specifically when opening from dashboard)
  useEffect(() => {
    if (open) {
      if (initialDateRange) setDateRange(initialDateRange);
      if (initialType) setTypeFilter(initialType);
      if (initialKioskId) setKioskFilter(initialKioskId);
      setSearchTerm('');
      setCurrentPage(1);
    }
  }, [open, initialDateRange, initialType, initialKioskId, initialBaseProductId]);

  useEffect(() => {
    if (!open || !firebaseUser) return;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setLoadingHistory(true);
      try {
        const token = await firebaseUser.getIdToken();
        const params = new URLSearchParams({
          page: String(currentPage),
          pageSize: String(ITEMS_PER_PAGE),
          type: typeFilter,
          kioskId: kioskFilter,
          search: searchTerm,
          sortKey,
          sortDirection,
        });
        if (dateRange?.from) params.set("from", dateRange.from.toISOString());
        if (dateRange?.to) {
          const endDate = new Date(dateRange.to);
          endDate.setHours(23, 59, 59, 999);
          params.set("to", endDate.toISOString());
        }
        if (initialBaseProductId) params.set("baseProductId", initialBaseProductId);

        const response = await fetch(`/api/stock/movement-history?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error || "Falha ao consultar movimentações.");
        setRecords(payload.records ?? []);
        setTotalRecords(Number(payload.total ?? 0));
        setMovementTotals(payload.totals ?? { entries: 0, exits: 0, transfers: 0 });
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          console.error("Error fetching movement history:", error);
          setRecords([]);
          setTotalRecords(0);
        }
      } finally {
        if (!controller.signal.aborted) setLoadingHistory(false);
      }
    }, searchTerm ? 300 : 0);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [
    open,
    firebaseUser,
    currentPage,
    dateRange,
    typeFilter,
    kioskFilter,
    searchTerm,
    sortKey,
    sortDirection,
    initialBaseProductId,
  ]);
  
  const loading = loadingHistory || loadingProducts || loadingKiosks;

  const enrichedHistory = useMemo(() => {
    if (loading) return [];
    const kioskMap = new Map(kiosks.map(k => [k.id, k.name]));
    return records.map(record => {
      let mainKioskName = 'N/A';
      if(record.type?.startsWith('TRANSFERENCIA')) {
        mainKioskName = kioskMap.get(record.fromKioskId!) || 'N/A';
      } else {
        mainKioskName = kioskMap.get(record.fromKioskId! || record.toKioskId!) || 'N/A';
      }

      return {
        ...record,
        productName: products.find(p => p.id === record.productId)?.baseName || record.productName,
        kioskName: mainKioskName
      };
    });
  }, [records, products, kiosks, loading]);

  const totalPages = Math.max(1, Math.ceil(totalRecords / ITEMS_PER_PAGE));

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  const totalEntradas = movementTotals.entries;
  const totalSaidas = movementTotals.exits;
  const totalTransferencias = movementTotals.transfers;

  // Sufixo de unidade nos KPIs quando os totais estão na unidade-base do insumo.
  const unitSuffix = baseProductForTotals ? ` ${baseProductForTotals.unit}` : '';


  const tonePill = (type: string) => {
    if (type.includes('ESTORNO')) return 'bg-[#eeeefc] text-[#3f3fb0]';
    if (type.includes('TRANSFERENCIA')) return 'bg-[#eef3fe] text-[#1d4ed8]';
    if (type.startsWith('ENTRADA')) return 'bg-[#e8f5ee] text-[#15803d]';
    return 'bg-[#ffe4e8] text-[#be123c]';
  };
  const GRID = 'grid grid-cols-[120px_minmax(0,1.6fr)_190px_170px_90px_110px] gap-3';
  const SORTABLE: { key: SortKey; label: string; className?: string }[] = [
    { key: 'timestamp', label: 'Data' },
    { key: 'productName', label: 'Produto / lote' },
    { key: 'type', label: 'Tipo' },
    { key: 'fromKioskId', label: 'Quiosque' },
    { key: 'quantityChange', label: 'Qtd.', className: 'text-right' },
    { key: 'username', label: 'Usuário' },
  ];
  const DARK_SELECT = 'h-[42px] rounded-xl border border-white/10 bg-white/[.07] px-3 text-[13px] font-semibold text-white outline-none focus:border-[#f08bb1] [&>option]:text-[#1a1b1f]';
  const totals = [
    { label: 'Total de entradas', hint: 'Compras + divergência acréscimo + estorno (devolve)', value: totalEntradas, color: '#4ade80' },
    { label: 'Total em transferências', hint: 'Movido entre unidades', value: totalTransferencias, color: '#93b4ff' },
    { label: 'Total de saídas', hint: 'Consumo + descarte + divergência decréscimo + estorno (retira)', value: totalSaidas, color: '#fb7185' },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        flush
        className="flex h-[min(760px,calc(100dvh-1rem))] max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden rounded-[26px] border-0 bg-[#faf9f6] shadow-[0_30px_80px_rgba(21,21,28,.3)] sm:w-[calc(100vw-2rem)] sm:max-w-[1120px] sm:rounded-[26px]"
      >
        <DialogTitle className="sr-only">Auditoria de movimentações</DialogTitle>
        <DialogDescription className="sr-only">Consulte o histórico completo de entradas, saídas, ajustes e transferências de estoque.</DialogDescription>

        <div className="flex flex-col gap-4 bg-[#15151c] px-7 py-[22px] text-[#f3f2ee]">
          <div className="flex items-start justify-between gap-3">
            <span className="flex flex-col gap-1.5">
              <span className="text-[10.5px] font-extrabold uppercase tracking-[.16em] text-[#8e8d99]">Consultar histórico</span>
              <span className="text-[22px] font-extrabold tracking-[-.02em]">Auditoria de movimentações</span>
            </span>
            <button type="button" onClick={() => onOpenChange(false)} aria-label="Fechar" className="h-[34px] w-[34px] rounded-[10px] border border-white/15 text-base text-[#c8c7d0] hover:bg-white/10">×</button>
          </div>
          <div className="grid grid-cols-1 overflow-hidden rounded-[14px] border border-white/10 bg-white/5 md:grid-cols-3">
            {totals.map((total, index) => (
              <div key={total.label} className={cn('flex flex-col gap-[3px] px-4 py-3.5', index > 0 && 'md:border-l md:border-white/10')}>
                <span className="text-xs font-bold text-[#c8c7d0]">{total.label}</span>
                <span className="text-[11px] leading-[1.4] text-[#8e8d99]">{total.hint}</span>
                <span className="mt-1 text-[26px] font-extrabold tracking-[-.03em]" style={{ color: total.color }}>{total.value.toLocaleString('pt-BR')}{unitSuffix}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="flex h-[42px] min-w-[240px] flex-1 items-center gap-2.5 rounded-xl border border-white/10 bg-white/[.07] px-3.5">
              <Search className="h-4 w-4 shrink-0 text-[#8e8d99]" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Buscar produto, lote, usuário, observação…"
                className="min-w-0 flex-1 border-none bg-transparent text-[13.5px] text-white outline-none placeholder:text-[#8e8d99]"
              />
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" className={cn(DARK_SELECT, 'flex items-center gap-2 whitespace-nowrap')}>
                  <CalendarIcon className="h-4 w-4 text-[#8e8d99]" />
                  {dateRange?.from ? (dateRange.to ? `${format(dateRange.from, 'dd/MM/yy')} – ${format(dateRange.to, 'dd/MM/yy')}` : format(dateRange.from, 'dd/MM/yy')) : 'Todo o período'}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar initialFocus mode="range" defaultMonth={dateRange?.from} selected={dateRange} onSelect={setDateRange} numberOfMonths={2} locale={ptBR} />
              </PopoverContent>
            </Popover>
            <select aria-label="Tipo de movimentação" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className={DARK_SELECT}>
              <option value="all">Todos os tipos</option>
              {Object.entries(MOVEMENT_TYPE_CONFIG).map(([key, { label }]) => <option key={key} value={key}>{label}</option>)}
            </select>
            <select aria-label="Quiosque" value={kioskFilter} onChange={(event) => setKioskFilter(event.target.value)} className={DARK_SELECT}>
              <option value="all">Todos os quiosques</option>
              {kiosks.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-7">
          {loading ? (
            <div className="py-4"><Skeleton className="h-64 w-full" /></div>
          ) : (
            <div className="min-w-[860px]">
              <div className={cn(GRID, 'sticky top-0 z-10 border-b border-[#e3dfd6] bg-[#faf9f6] py-3 text-[10.5px] font-extrabold uppercase tracking-[.1em] text-[#9a9ba1]')}>
                {SORTABLE.map(column => (
                  <button key={column.key} type="button" onClick={() => handleSort(column.key)} className={cn('flex items-center gap-1 text-left uppercase', column.className === 'text-right' && 'justify-end')}>
                    {column.label}
                    {sortKey === column.key && <span aria-hidden>{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                  </button>
                ))}
              </div>
              {enrichedHistory.map((item) => {
                const timestampDate = item.timestamp ? parseISO(item.timestamp) : null;
                const isTransfer = item.type?.includes('TRANSFERENCIA');
                const kioskDisplay = isTransfer ? `${item.fromKioskName || ''} → ${item.toKioskName || ''}` : item.kioskName || 'N/A';
                const config = item.type ? MOVEMENT_TYPE_CONFIG[item.type] : undefined;
                let label = config?.label ?? item.type ?? 'N/A';
                if (isTransfer && kioskFilter !== 'all') {
                  if (item.toKioskId === kioskFilter) label = 'Transferência (Entrada)';
                  else if (item.fromKioskId === kioskFilter) label = 'Transferência (Saída)';
                }
                const quantity = Number(item.quantityChange) || 0;
                const positive = String(item.type).startsWith('ENTRADA') || item.type === 'SAIDA_ESTORNO';
                return (
                  <div key={item.id} className={cn(GRID, 'items-center border-b border-[#f1eee8] py-[11px] text-[12.5px]')}>
                    <span className="font-mono text-[11.5px] text-[#70757d]">{timestampDate && isValid(timestampDate) ? format(timestampDate, 'dd/MM/yy HH:mm', { locale: ptBR }) : 'N/A'}</span>
                    <span className="flex min-w-0 flex-col gap-px">
                      <b className="truncate text-[13px]" title={item.productName}>{item.productName}</b>
                      <span className="flex gap-1.5 font-mono text-[11px] text-[#9a9ba1]">Lote {item.lotNumber || '—'}{item.notes ? <span className="truncate font-sans italic">· {item.notes}</span> : null}</span>
                    </span>
                    <span className={cn('inline-flex min-h-[22px] w-max max-w-full items-center rounded-full px-[9px] py-0.5 text-[11.5px] font-bold leading-[1.3]', item.type ? tonePill(item.type) : 'bg-[#eceae5] text-[#70757d]')}>{label}</span>
                    <span className="text-[#4a4f57]">{kioskDisplay}</span>
                    <span className={cn('text-right font-mono text-[13px] font-bold', positive ? 'text-[#15803d]' : 'text-[#be123c]')}>{quantity.toLocaleString('pt-BR')}</span>
                    <span className="truncate text-[#4a4f57]">{item.username}</span>
                  </div>
                );
              })}
              {enrichedHistory.length === 0 && <div className="p-10 text-center text-[13px] text-[#70757d]">Nenhum registro encontrado com os filtros atuais.</div>}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[#e6e2da] bg-[#faf9f6] px-7 py-4">
          <button type="button" onClick={() => onOpenChange(false)} className="h-11 rounded-xl px-3.5 text-[13.5px] font-bold text-[#70757d] hover:bg-[#f0eee9] hover:text-[#1a1b1f]">Fechar</button>
          <div className="flex items-center gap-2.5">
            <span className="text-[12.5px] text-[#70757d]">Página {currentPage} de {totalPages} · {totalRecords.toLocaleString('pt-BR')} registros</span>
            <button type="button" onClick={() => setCurrentPage(p => p - 1)} disabled={currentPage === 1} className="h-10 rounded-xl border border-[#dcd9d1] bg-white px-3.5 text-[13px] font-bold disabled:opacity-50">Anterior</button>
            <button type="button" onClick={() => setCurrentPage(p => p + 1)} disabled={currentPage >= totalPages} className="h-10 rounded-xl border border-[#dcd9d1] bg-white px-3.5 text-[13px] font-bold disabled:opacity-50">Próxima</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
