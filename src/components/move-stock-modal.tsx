
"use client"

import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import { useProducts } from '@/hooks/use-products';
import { useExpiryProducts, type MoveLotParams } from '@/hooks/use-expiry-products';
import { useReposition } from '@/hooks/use-reposition';
import { type LotEntry, type Kiosk, type User } from '@/types';
import {
  CancelButton,
  LotModalShell,
  MODAL_ERROR_TEXT,
  MODAL_INPUT,
  PrimaryButton,
  ShellEyebrow,
  ShellFacts,
} from './stock/lot-modal-shell';
import { buildReservationsByLot, lotAvailableQuantity, lotReservedQuantity } from './stock/lot-presentation';

type MoveStockModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lotToMove: LotEntry;
  kiosks: Kiosk[];
  onMoveConfirm: (params: MoveLotParams[], user: User) => void;
};

const nf = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

export function MoveStockModal({ open, onOpenChange, lotToMove, kiosks, onMoveConfirm }: MoveStockModalProps) {
  const { user } = useAuth();
  const { products, getProductFullName } = useProducts();
  const { lots } = useExpiryProducts();
  const { activities } = useReposition();

  const [quantity, setQuantity] = useState('1');
  const [destinationId, setDestinationId] = useState('');
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (open) {
      setQuantity('1');
      setDestinationId('');
      setTried(false);
    }
  }, [open, lotToMove.id]);

  const availableKiosks = kiosks.filter(k => k.id !== lotToMove.kioskId);
  const product = products.find(p => p.id === lotToMove.productId);
  const productName = product ? getProductFullName(product) : lotToMove.productName;
  const packageLabel = (product?.packageType || 'unidade').toLowerCase();
  const sourceName = kiosks.find(k => k.id === lotToMove.kioskId)?.name || 'Desconhecido';

  const reservation = useMemo(() => buildReservationsByLot(activities).get(lotToMove.id), [activities, lotToMove.id]);
  const reserved = lotReservedQuantity(lotToMove, reservation);
  const available = lotAvailableQuantity(lotToMove, reservation);

  const stockAt = (kioskId: string) =>
    lots.filter(l => l.productId === lotToMove.productId && l.kioskId === kioskId && l.quantity > 0).reduce((sum, l) => sum + l.quantity, 0);

  const parsed = parseFloat(quantity.replace(',', '.'));
  const quantityError = !tried ? '' : !(parsed >= 1) ? 'A quantidade deve ser de pelo menos 1.' : parsed > available ? `A quantidade não pode ser maior que o disponível (${nf(available)}).` : '';
  const destinationError = tried && !destinationId;
  const moving = parsed > 0 ? Math.min(parsed, available) : 0;
  const destinationName = kiosks.find(k => k.id === destinationId)?.name;

  const submit = () => {
    setTried(true);
    if (!user || !(parsed >= 1) || parsed > available || !destinationId) return;

    const params: MoveLotParams = {
      lotId: lotToMove.id,
      productId: lotToMove.productId,
      toKioskId: destinationId,
      quantityToMove: parsed,
      fromKioskId: lotToMove.kioskId,
      fromKioskName: sourceName,
      toKioskName: destinationName || 'Quiosque Desconhecido',
      productName,
      lotNumber: lotToMove.lotNumber,
    };
    onMoveConfirm([params], user);
    onOpenChange(false);
  };

  return (
    <LotModalShell
      open={open}
      onOpenChange={onOpenChange}
      title="Mover estoque"
      description={`Mova unidades do item ${productName} (lote ${lotToMove.lotNumber}) de ${sourceName}.`}
      width={820}
      sidebarWidth={280}
      sidebar={
        <>
          <ShellEyebrow>Mover estoque</ShellEyebrow>
          <h2 className="m-0 text-[20px] font-extrabold leading-[1.2] tracking-[-.02em]">{productName}</h2>
          <ShellFacts
            rows={[
              { label: 'Lote', value: lotToMove.lotNumber, mono: true },
              { label: 'Origem', value: sourceName },
              { label: 'No lote', value: `${nf(lotToMove.quantity)} ${packageLabel}(s)` },
              { label: 'Reservado', value: `${nf(reserved)} ${packageLabel}(s)`, className: 'text-[#93b4ff]' },
              { label: 'Disponível', value: `${nf(available)} ${packageLabel}(s)`, className: 'font-extrabold' },
            ]}
          />
        </>
      }
      footer={
        <>
          <CancelButton onClick={() => onOpenChange(false)} />
          <PrimaryButton type="button" onClick={submit}>Confirmar movimentação</PrimaryButton>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <span className="flex justify-between text-xs font-bold text-[#4a4f57]">
          <span>Quantidade a mover ({packageLabel}s)</span>
          <button type="button" onClick={() => setQuantity(String(available))} className="text-xs font-bold text-[#5b5bd6]">Mover tudo ({nf(available)})</button>
        </span>
        <input
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          inputMode="numeric"
          placeholder="0"
          className={cn(MODAL_INPUT, 'h-[52px] text-xl font-extrabold', quantityError && 'border-[#e11d48]')}
        />
        {quantityError && <span className={MODAL_ERROR_TEXT}>{quantityError}</span>}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-bold text-[#4a4f57]">Mover para</span>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {availableKiosks.map(kiosk => {
            const on = destinationId === kiosk.id;
            return (
              <button
                key={kiosk.id}
                type="button"
                onClick={() => setDestinationId(kiosk.id)}
                className={cn(
                  'flex flex-col items-start gap-[3px] rounded-[14px] px-3.5 py-3 text-left text-[#1a1b1f]',
                  on ? 'border-2 border-[#5b5bd6] bg-[#eeeefc]' : 'border border-[#dcd9d1] bg-white hover:bg-[#f6f4ef]',
                )}
              >
                <span className="text-[13.5px] font-bold">{kiosk.name}</span>
                <span className="text-xs text-[#70757d]">{nf(stockAt(kiosk.id))} {packageLabel}(s) deste item</span>
              </button>
            );
          })}
        </div>
        {availableKiosks.length === 0 && <span className="text-[12.5px] text-[#70757d]">Nenhum outro quiosque disponível.</span>}
        {destinationError && <span className={MODAL_ERROR_TEXT}>Selecione um quiosque de destino.</span>}
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-[14px] border border-[#e3dfd6] bg-white px-4 py-3.5 text-[13px]">
        <span className="flex flex-col gap-0.5">
          <span className="text-[10.5px] font-extrabold uppercase tracking-[.08em] text-[#9a9ba1]">{sourceName}</span>
          <b>{nf(lotToMove.quantity - moving)} {packageLabel}(s)</b>
        </span>
        <span className="text-lg text-[#c4c0b8]">→</span>
        <span className="flex flex-col gap-0.5">
          <span className="text-[10.5px] font-extrabold uppercase tracking-[.08em] text-[#9a9ba1]">{destinationName ? destinationName : 'Destino'}</span>
          <b>{destinationId ? `${nf(stockAt(destinationId) + moving)} ${packageLabel}(s)` : '—'}</b>
        </span>
        <span className="ml-auto text-xs text-[#9a9ba1]">Depois da movimentação</span>
      </div>
    </LotModalShell>
  );
}
