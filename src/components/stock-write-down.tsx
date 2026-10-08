"use client";

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useKiosks } from '@/hooks/use-kiosks';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { useProducts } from '@/hooks/use-products';
import { useReposition } from '@/hooks/use-reposition';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { type LotEntry, type MovementType, type Product } from '@/types';
import {
  CancelButton,
  LotModalShell,
  MODAL_ERROR_TEXT,
  MODAL_INPUT,
  PrimaryButton,
  ShellEyebrow,
  ShellFacts,
} from './stock/lot-modal-shell';
import {
  WRITE_DOWN_REASONS,
  buildReservationsByLot,
  lotAvailableQuantity,
  lotStatusOf,
  parseWriteDownQuantity,
  validateWriteDown,
} from './stock/lot-presentation';

type DraftItem = { lotId: string; qty: string; type: MovementType; obs: string };
type DoneItem = { name: string; sub: string; qty: string };

const nf = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

const kioskButton = (on: boolean) => cn(
  'flex h-[38px] items-center rounded-xl border px-3.5 text-left text-[13px] font-bold',
  on ? 'border-[#f08bb1] bg-[#f08bb1]/15 text-white' : 'border-white/10 bg-transparent text-[#c8c7d0] hover:bg-white/5',
);

interface StockWriteDownProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function StockWriteDown({ open, onOpenChange }: StockWriteDownProps) {
  const { user } = useAuth();
  const { kiosks } = useKiosks();
  const { lots, loading: lotsLoading, consumeFromLot } = useExpiryProducts();
  const { products, getProductFullName, loading: productsLoading } = useProducts();
  const { activities } = useReposition();
  const { toast } = useToast();

  const [kioskId, setKioskId] = useState('');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<DoneItem[] | null>(null);

  useEffect(() => {
    if (!open) {
      setKioskId('');
      setQuery('');
      setItems([]);
      setTried(false);
      setDone(null);
    }
  }, [open]);

  const reservations = useMemo(() => buildReservationsByLot(activities), [activities]);
  const productMap = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);

  const kioskLots = useMemo(() => {
    if (!kioskId) return [];
    return lots
      .filter(lot => lot.kioskId === kioskId && lot.quantity > 0)
      .map(lot => ({ lot, product: productMap.get(lot.productId) }))
      .filter((entry): entry is { lot: LotEntry; product: Product } => !!entry.product && entry.product.operationalDestination !== 'uniform' && entry.product.category !== 'Vestimenta')
      .sort((a, b) => getProductFullName(a.product).localeCompare(getProductFullName(b.product), 'pt-BR'));
  }, [kioskId, lots, productMap, getProductFullName]);

  const visibleLots = useMemo(() => {
    const term = query.trim().toLowerCase();
    return kioskLots.filter(({ lot, product }) => !term || `${getProductFullName(product)} ${lot.lotNumber}`.toLowerCase().includes(term));
  }, [kioskLots, query, getProductFullName]);

  const availableOf = (lot: LotEntry) => lotAvailableQuantity(lot, reservations.get(lot.id));
  const errorOf = (item: DraftItem) => {
    const lot = lots.find(l => l.id === item.lotId);
    return lot ? validateWriteDown({ quantity: item.qty, type: item.type, notes: item.obs, available: availableOf(lot) }) : 'Lote não encontrado.';
  };

  const addItem = (lot: LotEntry, product: Product) => {
    if (items.some(item => item.lotId === lot.id)) return;
    const expired = lotStatusOf(lot, product).key === 'expired';
    setItems(current => [...current, { lotId: lot.id, qty: '1', type: expired ? 'SAIDA_DESCARTE_VENCIMENTO' : 'SAIDA_CONSUMO', obs: '' }]);
  };
  const updateItem = (lotId: string, patch: Partial<DraftItem>) => setItems(current => current.map(item => (item.lotId === lotId ? { ...item, ...patch } : item)));

  const submit = async () => {
    if (done) {
      setItems([]);
      setTried(false);
      setDone(null);
      return;
    }
    if (items.length === 0) return;
    if (items.some(item => errorOf(item))) {
      setTried(true);
      return;
    }
    if (!user) {
      toast({ variant: 'destructive', title: 'Erro', description: 'Usuário não autenticado.' });
      return;
    }

    setSaving(true);
    const recorded: DoneItem[] = [];
    try {
      // Gravadas uma a uma: se uma falhar, as anteriores continuam registradas.
      for (const item of items) {
        await consumeFromLot({ lotId: item.lotId, quantityToConsume: parseWriteDownQuantity(item.qty), type: item.type, notes: item.obs.trim() || undefined }, user);
        const lot = lots.find(l => l.id === item.lotId)!;
        const product = productMap.get(lot.productId);
        recorded.push({
          name: product ? getProductFullName(product) : lot.productName,
          sub: `Lote ${lot.lotNumber} · ${WRITE_DOWN_REASONS.find(r => r.value === item.type)?.label}`,
          qty: `−${nf(parseWriteDownQuantity(item.qty))}`,
        });
      }
      setDone(recorded);
      setItems([]);
      setTried(false);
    } catch (error: any) {
      if (recorded.length > 0) setDone(recorded);
      toast({ variant: 'destructive', title: 'Erro ao dar baixa', description: `${recorded.length} baixa(s) gravada(s) antes da falha. ${error?.message || 'Não foi possível processar a solicitação.'}` });
      setItems(current => current.filter(item => !recorded.some((_, index) => items[index]?.lotId === item.lotId)));
    } finally {
      setSaving(false);
    }
  };

  const loading = lotsLoading || productsLoading;
  const kioskName = kiosks.find(k => k.id === kioskId)?.name;
  const n = items.length;
  const submitLabel = done ? 'Nova baixa em lote' : saving ? 'Processando…' : n ? `Registrar ${n} ${n === 1 ? 'baixa' : 'baixas'}` : 'Registrar baixas';

  return (
    <LotModalShell
      open={open}
      onOpenChange={onOpenChange}
      title="Realizar baixa"
      description="Registre várias baixas de estoque de uma vez."
      width={1120}
      height={760}
      sidebarWidth={280}
      sidebar={
        <>
          <ShellEyebrow>Realizar baixa</ShellEyebrow>
          <h2 className="m-0 text-[22px] font-extrabold leading-[1.2] tracking-[-.02em]">Registrar várias baixas de uma vez</h2>
          <div className="flex flex-col gap-2">
            <ShellEyebrow>Quiosque</ShellEyebrow>
            {kiosks.map(k => (
              <button key={k.id} type="button" onClick={() => { setKioskId(k.id); setItems([]); setTried(false); setDone(null); }} className={kioskButton(kioskId === k.id)}>{k.name}</button>
            ))}
          </div>
          <ShellFacts rows={[{ label: 'Itens na baixa', value: n }, { label: 'Lotes no quiosque', value: kioskLots.length }]} />
          <span className="mt-auto text-[11.5px] leading-normal text-[#77768a]">
            Uniformes não entram aqui; use o fluxo de uniformes. As baixas são gravadas uma a uma: se uma falhar, as anteriores continuam registradas.
          </span>
        </>
      }
      footer={
        <>
          <CancelButton onClick={() => onOpenChange(false)}>{done ? 'Fechar' : 'Cancelar'}</CancelButton>
          <PrimaryButton type="button" onClick={submit} disabled={saving || (!done && n === 0)}>{submitLabel}</PrimaryButton>
        </>
      }
    >
      <div className="-mx-[30px] -my-[26px] flex min-h-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-4 border-b border-[#e6e2da] px-7 pb-4 pt-[22px]">
          <div className="flex flex-col gap-1">
            <h3 className="m-0 text-[21px] font-extrabold tracking-[-.02em]">{done ? 'Baixas registradas' : 'Itens para baixa'}</h3>
            <span className="text-[13px] text-[#70757d]">{done ? `${done.length} baixa(s) gravada(s) em ${kioskName}.` : 'Escolha os lotes, a quantidade e o motivo de cada baixa.'}</span>
          </div>
          <button type="button" onClick={() => onOpenChange(false)} aria-label="Fechar" className="h-[34px] w-[34px] shrink-0 rounded-full bg-[#efede7] text-lg text-[#4a4f57]">×</button>
        </div>

        {!kioskId && !done && <div className="flex flex-1 items-center justify-center p-10 text-center text-[13.5px] text-[#70757d]">Escolha o quiosque ao lado para ver os lotes em estoque.</div>}

        {done && (
          <div className="flex flex-1 flex-col gap-2 overflow-auto px-7 py-[22px]">
            {done.map((entry, index) => (
              <div key={index} className="flex items-center gap-3 rounded-xl border border-[#e3dfd6] bg-white px-3.5 py-3">
                <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[#e8f5ee] text-xs font-extrabold text-[#15803d]">✓</span>
                <span className="flex flex-1 flex-col gap-0.5"><b className="text-[13px]">{entry.name}</b><span className="text-xs text-[#70757d]">{entry.sub}</span></span>
                <span className="font-mono text-[13px] font-bold">{entry.qty}</span>
              </div>
            ))}
          </div>
        )}

        {kioskId && !done && (
          <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
            <div className="flex min-h-0 flex-col border-[#e6e2da] md:border-r">
              <div className="flex flex-col gap-2.5 px-5 py-3.5">
                <span className="text-xs font-bold text-[#4a4f57]">Itens em estoque ({kioskLots.length})</span>
                <div className="flex h-[38px] items-center gap-2 rounded-[11px] border border-[#dcd9d1] bg-white px-3 focus-within:border-[#5b5bd6]">
                  <span className="text-[#9a9ba1]">⌕</span>
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filtrar por nome ou lote" className="min-w-0 flex-1 border-none bg-transparent text-[13px] outline-none" />
                </div>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto px-5 pb-4">
                {loading && <span className="py-5 text-[12.5px] text-[#70757d]">Carregando…</span>}
                {visibleLots.map(({ lot, product }) => {
                  const added = items.some(item => item.lotId === lot.id);
                  const reserved = lot.quantity - availableOf(lot);
                  return (
                    <div key={lot.id} className="flex items-center gap-2.5 rounded-xl border border-[#e3dfd6] bg-white px-3 py-2.5">
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-[13px] font-bold">{getProductFullName(product)}</span>
                        {(product.apparelSize || product.apparelColor || product.apparelType) && (
                          <span className="text-xs font-medium text-[#b45309]">{[product.apparelType, product.apparelColor, product.apparelSize && `Tam. ${product.apparelSize}`].filter(Boolean).join(' · ')}</span>
                        )}
                        <span className="text-[11.5px] text-[#70757d]">Lote {lot.lotNumber} · {nf(lot.quantity)} {(product.packageType || 'un').toLowerCase()}(s){reserved > 0 ? ` · ${nf(reserved)} reservado(s)` : ''}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => addItem(lot, product)}
                        disabled={added}
                        className={cn('h-8 whitespace-nowrap rounded-[9px] border px-3 text-xs font-bold', added ? 'cursor-default border-[#e3dfd6] bg-[#f0eee9] text-[#9a9ba1]' : 'border-[#dcd9d1] bg-white hover:bg-[#f6f4ef]')}
                      >
                        {added ? 'Na lista' : 'Adicionar'}
                      </button>
                    </div>
                  );
                })}
                {!loading && visibleLots.length === 0 && <span className="px-1 py-5 text-[12.5px] text-[#70757d]">Nenhum lote em estoque.</span>}
              </div>
            </div>

            <div className="flex min-h-0 flex-col">
              <span className="px-5 pb-2.5 pt-3.5 text-xs font-bold text-[#4a4f57]">Itens para baixa ({n})</span>
              <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto px-5 pb-4">
                {n === 0 && <div className="rounded-[14px] border border-dashed border-[#d6d2c8] px-4 py-7 text-center text-[12.5px] text-[#70757d]">Adicione lotes da lista ao lado.</div>}
                {items.map(item => {
                  const lot = lots.find(l => l.id === item.lotId);
                  if (!lot) return null;
                  const product = productMap.get(lot.productId);
                  const error = tried ? errorOf(item) : null;
                  return (
                    <div key={item.lotId} className="flex flex-col gap-2.5 rounded-[14px] border border-[#e3dfd6] bg-white p-3.5">
                      <div className="flex items-start gap-2.5">
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <b className="text-[13.5px]">{product ? getProductFullName(product) : lot.productName}</b>
                          <span className="text-xs text-[#70757d]">Lote {lot.lotNumber} · disponível {nf(availableOf(lot))} {(product?.packageType || 'un').toLowerCase()}(s)</span>
                        </span>
                        <button type="button" onClick={() => setItems(current => current.filter(entry => entry.lotId !== item.lotId))} aria-label="Remover item" className="whitespace-nowrap text-xs font-bold text-[#be123c]">Remover</button>
                      </div>
                      <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-2.5">
                        <label className="flex flex-col gap-[5px] text-xs font-bold text-[#4a4f57]">
                          Quantidade
                          <input value={item.qty} onChange={(event) => updateItem(item.lotId, { qty: event.target.value })} inputMode="decimal" className={cn(MODAL_INPUT, 'h-10', error && /quantidade|disponível/i.test(error) && 'border-[#e11d48]')} />
                        </label>
                        <label className="flex flex-col gap-[5px] text-xs font-bold text-[#4a4f57]">
                          Motivo
                          <select value={item.type} onChange={(event) => updateItem(item.lotId, { type: event.target.value as MovementType })} className={cn(MODAL_INPUT, 'h-10 px-2.5 text-[13px]')}>
                            {WRITE_DOWN_REASONS.map(reason => <option key={reason.value} value={reason.value}>{reason.label}</option>)}
                          </select>
                        </label>
                      </div>
                      <input
                        value={item.obs}
                        onChange={(event) => updateItem(item.lotId, { obs: event.target.value })}
                        placeholder={item.type === 'SAIDA_DESCARTE_OUTROS' ? 'Observação (obrigatória)' : 'Observação (opcional)'}
                        className={cn(MODAL_INPUT, 'h-[38px] text-[13px]', error && /observação/i.test(error) && 'border-[#e11d48]')}
                      />
                      {error && <span className={MODAL_ERROR_TEXT}>{error}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </LotModalShell>
  );
}
