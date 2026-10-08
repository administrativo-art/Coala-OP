
"use client";

import { useEffect, useMemo, useState } from 'react';
import { useKiosks } from '@/hooks/use-kiosks';
import { useProducts } from '@/hooks/use-products';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { useReposition } from '@/hooks/use-reposition';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { type LotEntry, type Product } from '@/types';
import {
  CancelButton,
  LotModalShell,
  MODAL_ERROR_TEXT,
  MODAL_INPUT,
  PrimaryButton,
  ShellEyebrow,
} from './stock/lot-modal-shell';
import { buildReservationsByLot, lotAvailableQuantity } from './stock/lot-presentation';

type DraftItem = { lotId: string; qty: string };
type DoneItem = { name: string; sub: string; qty: string };

const nf = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

const kioskButton = (on: boolean) => cn(
  'flex h-[38px] items-center rounded-xl border px-3.5 text-left text-[13px] font-bold',
  on ? 'border-[#f08bb1] bg-[#f08bb1]/15 text-white' : 'border-white/10 bg-transparent text-[#c8c7d0] hover:bg-white/5',
);

interface StockTransferProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function StockTransfer({ open, onOpenChange }: StockTransferProps) {
  const { kiosks } = useKiosks();
  const { products, getProductFullName } = useProducts();
  const { lots } = useExpiryProducts();
  const { activities, createRepositionActivity, loading: repositionLoading } = useReposition();
  const { user } = useAuth();
  const { toast } = useToast();

  const [originId, setOriginId] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [tried, setTried] = useState(false);
  const [done, setDone] = useState<{ text: string; list: DoneItem[] } | null>(null);

  useEffect(() => {
    if (!open) {
      setOriginId('');
      setDestinationId('');
      setItems([]);
      setTried(false);
      setDone(null);
    }
  }, [open]);

  const reservations = useMemo(() => buildReservationsByLot(activities), [activities]);
  const productMap = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);
  const availableOf = (lot: LotEntry) => lotAvailableQuantity(lot, reservations.get(lot.id));

  const originLots = useMemo(() => {
    if (!originId) return [];
    return lots
      .filter(lot => lot.kioskId === originId && lot.quantity > 0 && lotAvailableQuantity(lot, reservations.get(lot.id)) > 0)
      .map(lot => ({ lot, product: productMap.get(lot.productId) }))
      .filter((entry): entry is { lot: LotEntry; product: Product } => !!entry.product && !entry.product.isArchived && entry.product.operationalDestination !== 'uniform' && entry.product.category !== 'Vestimenta')
      .sort((a, b) => getProductFullName(a.product).localeCompare(getProductFullName(b.product), 'pt-BR'));
  }, [originId, lots, reservations, productMap, getProductFullName]);

  const errorOf = (item: DraftItem) => {
    const lot = lots.find(l => l.id === item.lotId);
    if (!lot) return 'Lote não encontrado.';
    const qty = parseFloat(item.qty.replace(',', '.'));
    if (!(qty >= 1)) return 'Informe uma quantidade de pelo menos 1.';
    if (qty > availableOf(lot)) return `Maior que o disponível (${nf(availableOf(lot))}).`;
    return '';
  };

  const originName = kiosks.find(k => k.id === originId)?.name;
  const destinationName = kiosks.find(k => k.id === destinationId)?.name;
  const n = items.length;
  const needKiosks = !originId || !destinationId;

  const addItem = (lot: LotEntry) => {
    if (items.some(item => item.lotId === lot.id)) return;
    setItems(current => [...current, { lotId: lot.id, qty: '1' }]);
  };
  const updateQty = (lotId: string, qty: string) => setItems(current => current.map(item => (item.lotId === lotId ? { ...item, qty } : item)));

  const submit = async () => {
    if (done) {
      setItems([]);
      setDone(null);
      setTried(false);
      return;
    }
    if (n === 0 || needKiosks) return;
    if (items.some(item => errorOf(item))) {
      setTried(true);
      return;
    }
    if (!user) return;

    const origin = kiosks.find(k => k.id === originId)!;
    const destination = kiosks.find(k => k.id === destinationId)!;

    // Um item de reposição por insumo, com os lotes escolhidos dentro dele.
    const byProduct = new Map<string, { product: Product; lots: { lot: LotEntry; qty: number }[] }>();
    items.forEach(item => {
      const lot = lots.find(l => l.id === item.lotId)!;
      const product = productMap.get(lot.productId)!;
      const entry = byProduct.get(product.id) ?? { product, lots: [] };
      entry.lots.push({ lot, qty: parseFloat(item.qty.replace(',', '.')) });
      byProduct.set(product.id, entry);
    });

    try {
      await createRepositionActivity({
        kioskOriginId: origin.id,
        kioskOriginName: origin.name,
        kioskDestinationId: destination.id,
        kioskDestinationName: destination.name,
        items: Array.from(byProduct.values()).map(({ product, lots: chosen }) => ({
          baseProductId: product.baseProductId || '',
          productName: product.baseName,
          quantityNeeded: 0, // Transferência manual, não baseada em necessidade
          suggestedLots: chosen.map(({ lot, qty }) => ({
            lotId: lot.id,
            productId: lot.productId,
            productName: getProductFullName(product),
            lotNumber: lot.lotNumber,
            quantityToMove: qty,
          })),
        })),
      });

      setDone({
        text: `${n} ${n === 1 ? 'lote reservado' : 'lotes reservados'} em ${origin.name} para ${destination.name}. Despacho e recebimento acontecem na Reposição.`,
        list: items.map(item => {
          const lot = lots.find(l => l.id === item.lotId)!;
          const product = productMap.get(lot.productId)!;
          return { name: getProductFullName(product), sub: `Lote ${lot.lotNumber}`, qty: item.qty };
        }),
      });
      setItems([]);
      setTried(false);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Erro ao criar atividade', description: error?.message || 'Não foi possível criar a atividade de reposição.' });
    }
  };

  const submitLabel = done ? 'Nova transferência' : repositionLoading ? 'Criando atividade…' : 'Criar atividade de transferência';

  return (
    <LotModalShell
      open={open}
      onOpenChange={onOpenChange}
      title="Realizar transferência"
      description="Reserve estoque de um quiosque para outro."
      width={1120}
      height={760}
      sidebarWidth={280}
      sidebar={
        <>
          <ShellEyebrow>Realizar transferência</ShellEyebrow>
          <h2 className="m-0 text-[22px] font-extrabold leading-[1.2] tracking-[-.02em]">Reservar estoque para outro quiosque</h2>
          <div className="flex flex-col gap-2">
            <ShellEyebrow>Origem</ShellEyebrow>
            {kiosks.map(k => (
              <button key={k.id} type="button" onClick={() => { setOriginId(k.id); if (destinationId === k.id) setDestinationId(''); setItems([]); setDone(null); setTried(false); }} className={kioskButton(originId === k.id)}>{k.name}</button>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <ShellEyebrow>Destino</ShellEyebrow>
            {kiosks.filter(k => k.id !== originId).map(k => (
              <button key={k.id} type="button" onClick={() => { setDestinationId(k.id); setDone(null); }} className={kioskButton(destinationId === k.id)}>{k.name}</button>
            ))}
          </div>
          <span className="mt-auto text-[11.5px] leading-normal text-[#77768a]">
            Confirmar cria uma atividade de reposição “Aguardando despacho” e reserva as quantidades na origem. Despacho e recebimento acontecem na Reposição.
          </span>
        </>
      }
      footer={
        <>
          <CancelButton onClick={() => onOpenChange(false)}>Fechar</CancelButton>
          <PrimaryButton type="button" onClick={submit} disabled={repositionLoading || (!done && (needKiosks || n === 0))}>{submitLabel}</PrimaryButton>
        </>
      }
    >
      <div className="-mx-[30px] -my-[26px] flex min-h-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-4 border-b border-[#e6e2da] px-7 pb-4 pt-[22px]">
          <div className="flex flex-col gap-1">
            <h3 className="m-0 text-[21px] font-extrabold tracking-[-.02em]">{done ? 'Transferência criada' : originName && destinationName ? `${originName} → ${destinationName}` : 'Itens da transferência'}</h3>
            <span className="text-[13px] text-[#70757d]">{done ? 'A atividade já aparece na Reposição.' : 'Escolha os lotes e a quantidade a reservar.'}</span>
          </div>
          <button type="button" onClick={() => onOpenChange(false)} aria-label="Fechar" className="h-[34px] w-[34px] shrink-0 rounded-full bg-[#efede7] text-lg text-[#4a4f57]">×</button>
        </div>

        {needKiosks && !done && <div className="flex flex-1 items-center justify-center p-10 text-center text-[13.5px] text-[#70757d]">Escolha origem e destino ao lado.</div>}

        {done && (
          <div className="flex flex-1 flex-col gap-3 overflow-auto px-7 py-[22px]">
            <div className="flex flex-col gap-[3px] rounded-[14px] border border-[#d7e2fb] bg-[#eef3fe] px-4 py-3.5 text-[13px] leading-normal text-[#1e3a8a]">
              <b>Aguardando despacho</b>
              <span>{done.text}</span>
            </div>
            {done.list.map((entry, index) => (
              <div key={index} className="flex items-center gap-3 rounded-xl border border-[#e3dfd6] bg-white px-3.5 py-3">
                <span className="flex flex-1 flex-col gap-0.5"><b className="text-[13px]">{entry.name}</b><span className="text-xs text-[#70757d]">{entry.sub}</span></span>
                <span className="whitespace-nowrap rounded-full bg-[#eef3fe] px-2.5 py-[3px] text-xs font-bold text-[#1d4ed8]">Reserva · {entry.qty}</span>
              </div>
            ))}
          </div>
        )}

        {!needKiosks && !done && (
          <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <div className="flex min-h-0 flex-col border-[#e6e2da] md:border-r">
              <span className="px-5 pb-2.5 pt-3.5 text-xs font-bold text-[#4a4f57]">Lotes disponíveis em {originName} ({originLots.length})</span>
              <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto px-5 pb-4">
                {originLots.map(({ lot, product }) => {
                  const added = items.some(item => item.lotId === lot.id);
                  return (
                    <div key={lot.id} className="flex items-center gap-2.5 rounded-xl border border-[#e3dfd6] bg-white px-3 py-2.5">
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-[13px] font-bold">{getProductFullName(product)}</span>
                        <span className="text-[11.5px] text-[#70757d]">Lote {lot.lotNumber} · {nf(availableOf(lot))} {(product.packageType || 'un').toLowerCase()}(s) disponíveis</span>
                      </span>
                      <button type="button" onClick={() => addItem(lot)} disabled={added} className={cn('h-8 whitespace-nowrap rounded-[9px] border px-3 text-xs font-bold', added ? 'cursor-default border-[#e3dfd6] bg-[#f0eee9] text-[#9a9ba1]' : 'border-[#dcd9d1] bg-white hover:bg-[#f6f4ef]')}>
                        {added ? 'Na lista' : 'Adicionar'}
                      </button>
                    </div>
                  );
                })}
                {originLots.length === 0 && <span className="px-1 py-5 text-[12.5px] text-[#70757d]">Nenhum lote com saldo disponível.</span>}
              </div>
            </div>
            <div className="flex min-h-0 flex-col">
              <span className="px-5 pb-2.5 pt-3.5 text-xs font-bold text-[#4a4f57]">Itens da transferência ({n})</span>
              <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto px-5 pb-4">
                {n === 0 && <div className="rounded-[14px] border border-dashed border-[#d6d2c8] px-4 py-7 text-center text-[12.5px] text-[#70757d]">Adicione lotes da lista ao lado.</div>}
                {items.map(item => {
                  const lot = lots.find(l => l.id === item.lotId);
                  if (!lot) return null;
                  const product = productMap.get(lot.productId);
                  const error = tried ? errorOf(item) : '';
                  return (
                    <div key={item.lotId} className="flex flex-col gap-2 rounded-[14px] border border-[#e3dfd6] bg-white p-3.5">
                      <div className="flex items-start gap-2.5">
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <b className="text-[13.5px]">{product ? getProductFullName(product) : lot.productName}</b>
                          <span className="text-xs text-[#70757d]">Lote {lot.lotNumber}</span>
                        </span>
                        <button type="button" onClick={() => setItems(current => current.filter(entry => entry.lotId !== item.lotId))} className="whitespace-nowrap text-xs font-bold text-[#be123c]">Remover</button>
                      </div>
                      <div className="flex items-center gap-2.5 text-xs font-bold text-[#4a4f57]">
                        <span className="whitespace-nowrap">Quantidade</span>
                        <input value={item.qty} onChange={(event) => updateQty(item.lotId, event.target.value)} inputMode="numeric" className={cn(MODAL_INPUT, 'h-10 w-28', error && 'border-[#e11d48]')} />
                        <button type="button" onClick={() => updateQty(item.lotId, String(availableOf(lot)))} className="whitespace-nowrap text-xs font-bold text-[#5b5bd6]">Tudo ({nf(availableOf(lot))})</button>
                      </div>
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
