"use client";

import { useEffect, useMemo, useState } from 'react';
import { format, isValid, parseISO } from 'date-fns';

import { useAuth } from '@/hooks/use-auth';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { useMovementHistory } from '@/hooks/use-movement-history';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { type LotEntry, type MovementRecord, type MovementType, type Product } from '@/types';
import {
  WRITE_DOWN_REASONS,
  type LotReservation,
  lotAvailableQuantity,
  lotQuantityParts,
  lotReservedQuantity,
  lotStatusOf,
  movementLabel,
  movementTone,
  parseWriteDownQuantity,
  productInitials,
  productSpecLine,
  validateWriteDown,
} from './lot-presentation';

const nf = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

const HISTORY_DOT: Record<ReturnType<typeof movementTone>, string> = {
  in: 'bg-[#15803d]',
  out: 'bg-[#be123c]',
  transfer: 'bg-[#1d4ed8]',
  reversal: 'bg-[#5b5bd6]',
};

const SECONDARY_BUTTON =
  'h-[42px] rounded-xl border border-[#e3dfd6] bg-white text-[13px] font-bold text-[#1a1b1f] hover:bg-[#f6f4ef] disabled:cursor-not-allowed disabled:opacity-50';

interface LotDetailPanelProps {
  lot: LotEntry;
  product: Product;
  fullName: string;
  kioskName: string;
  locationName?: string | null;
  reservation?: LotReservation;
  onClose: () => void;
  onEdit: (lotId: string) => void;
  onMove: (lotId: string) => void;
  onDelete: (lotId: string) => Promise<boolean>;
}

export function LotDetailPanel({
  lot,
  product,
  fullName,
  kioskName,
  locationName,
  reservation,
  onClose,
  onEdit,
  onMove,
  onDelete,
}: LotDetailPanelProps) {
  const { user, permissions } = useAuth();
  const { toast } = useToast();
  const { consumeFromLot, revertMovement } = useExpiryProducts();
  const { history, loaded, loadHistory } = useMovementHistory();

  const [baixaOpen, setBaixaOpen] = useState(false);
  const [baixaType, setBaixaType] = useState<MovementType>('SAIDA_CONSUMO');
  const [baixaQty, setBaixaQty] = useState('');
  const [baixaObs, setBaixaObs] = useState('');
  const [baixaError, setBaixaError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmRevertId, setConfirmRevertId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const stockPerms = permissions.stock.inventoryControl;
  const isTiago = user?.username === 'Tiago Brasil';

  useEffect(() => {
    if (!loaded) loadHistory();
  }, [loaded, loadHistory]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Trocar de lote reinicia o que estava em edição no painel.
  useEffect(() => {
    setBaixaOpen(false);
    setBaixaQty('');
    setBaixaObs('');
    setBaixaError('');
    setConfirmRevertId(null);
    setConfirmDelete(false);
  }, [lot.id]);

  const status = lotStatusOf(lot, product);
  const reserved = lotReservedQuantity(lot, reservation);
  const available = lotAvailableQuantity(lot, reservation);
  const parts = lotQuantityParts(lot, product);
  const packageLabel = (product.packageType || 'pacote').toLowerCase();
  const specA = productSpecLine({ ...product, multiplo_caixa: undefined, rotulo_caixa: undefined });
  const specB = [
    product.multiplo_caixa && product.rotulo_caixa
      ? `1 ${product.rotulo_caixa} = ${product.multiplo_caixa} ${product.packageType ? `${product.packageType}(s)` : 'unidades'}`
      : null,
    product.barcode ? `EAN ${product.barcode}` : null,
  ].filter(Boolean).join('  ·  ');

  const lotHistory = useMemo(() => history.filter((record) => record.lotId === lot.id).slice(0, 12), [history, lot.id]);

  const destinations = reservation ? Object.entries(reservation.destinations) : [];
  const reservedLine = reserved > 0
    ? `${nf(reserved)} ${packageLabel}(s)${destinations.length ? ` · ${destinations.map(([name]) => name).join(', ')}` : ' · Em processamento'}`
    : 'Sem reserva';

  const confirmBaixa = async () => {
    const error = validateWriteDown({ quantity: baixaQty, type: baixaType, notes: baixaObs, available });
    if (error) return setBaixaError(error);
    if (!user) return setBaixaError('Usuário não autenticado para registrar a baixa.');

    setSaving(true);
    try {
      await consumeFromLot(
        { lotId: lot.id, quantityToConsume: parseWriteDownQuantity(baixaQty), type: baixaType, notes: baixaObs.trim() || undefined },
        user,
      );
      toast({ title: 'Baixa registrada' });
      setBaixaOpen(false);
      setBaixaQty('');
      setBaixaObs('');
      setBaixaError('');
    } catch (err: any) {
      setBaixaError(err?.message || 'Não foi possível registrar a baixa.');
    } finally {
      setSaving(false);
    }
  };

  const confirmRevert = async (record: MovementRecord) => {
    try {
      await revertMovement(record);
      toast({ title: 'Movimentação revertida com sucesso!' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Erro ao reverter.', description: err?.message });
    } finally {
      setConfirmRevertId(null);
    }
  };

  const confirmDeleteLot = async () => {
    setDeleting(true);
    const ok = await onDelete(lot.id);
    setDeleting(false);
    if (ok) onClose();
    else toast({ variant: 'destructive', title: 'Não foi possível excluir o lote.' });
  };

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(lot.id);
      toast({ title: 'ID do lote copiado!' });
    } catch {
      toast({ variant: 'destructive', title: 'Não foi possível copiar o ID.' });
    }
  };

  const expiryLabel = lot.expiryDate && isValid(parseISO(lot.expiryDate)) ? format(parseISO(lot.expiryDate), 'dd/MM/yyyy') : 'Indefinida';
  const baixaDisabled = available <= 0;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-[#15151c]/30" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-label={`Lote ${lot.lotNumber}`}
        className="fixed bottom-0 right-0 top-0 z-[51] flex w-[460px] max-w-full flex-col bg-[#fffdf9] shadow-[-24px_0_60px_rgba(0,0,0,.18)]"
      >
        <div className="flex flex-col gap-3.5 bg-[#15151c] px-6 pb-[22px] pt-5 text-[#f3f2ee]">
          <div className="flex items-center gap-2">
            <span className="text-[10.5px] font-extrabold uppercase tracking-[.16em] text-[#f08bb1]">Lote</span>
            <span className="font-mono text-[12.5px] font-bold">{lot.lotNumber}</span>
            <span className={status.pillClass}>{status.text}</span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar painel"
              className="h-8 w-8 shrink-0 rounded-[10px] border border-white/15 text-[15px] text-[#c8c7d0] hover:bg-white/10"
            >
              ×
            </button>
          </div>
          <div className="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-3.5">
            <div className="flex h-[72px] w-[72px] items-center justify-center overflow-hidden rounded-2xl bg-[#24242e] font-mono text-base font-bold text-[#a9a8b3]">
              {product.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={product.imageUrl} alt={`Foto de ${product.baseName}`} className="h-full w-full object-cover" />
              ) : (
                productInitials(product)
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="text-pretty text-[19px] font-extrabold leading-[1.25] tracking-[-.02em]">{fullName}</span>
              <span className="text-xs leading-normal text-[#a9a8b3]">{specA}</span>
              {specB && <span className="-mt-1 text-xs leading-normal text-[#8e8d99]">{specB}</span>}
            </div>
          </div>
          <div
            className="grid overflow-hidden rounded-[14px] border border-white/10 bg-white/[.06]"
            style={{ gridTemplateColumns: `repeat(${parts.length}, minmax(0, 1fr))` }}
          >
            {parts.map((part, index) => (
              <div key={`${part.unit}-${index}`} className={cn('flex flex-col gap-2 px-3.5 py-3', index > 0 && 'border-l border-white/10')}>
                <span className="text-[10px] font-extrabold uppercase tracking-[.12em] text-[#8e8d99]">{part.unit}</span>
                <span className="text-2xl font-extrabold leading-none tracking-[-.03em] tabular-nums">{part.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-5 overflow-auto px-6 py-5">
          <div className="grid grid-cols-2 gap-x-[18px] gap-y-3.5">
            <Fact label="Status"><span className={status.pillClass}>{status.text}</span></Fact>
            <Fact label="Validade"><span className="font-mono text-[13px] font-semibold">{expiryLabel}</span></Fact>
            <Fact label="Quiosque"><span className="text-[13px] font-semibold">{kioskName}</span></Fact>
            <Fact label="Local"><span className="text-[13px] font-semibold">{locationName || '—'}</span></Fact>
            <Fact label="Disponível"><span className="text-[13px] font-bold">{nf(available)} {packageLabel}(s)</span></Fact>
            <Fact label="Reservado"><span className="text-[13px] font-bold text-[#1d4ed8]">{reservedLine}</span></Fact>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={SECONDARY_BUTTON} onClick={() => onEdit(lot.id)} disabled={!stockPerms.editLot}>
              Editar lote
            </button>
            <button
              type="button"
              className={SECONDARY_BUTTON}
              onClick={() => toast({ title: 'Função de etiqueta em manutenção.' })}
            >
              Imprimir etiqueta
            </button>
            <button
              type="button"
              onClick={() => setBaixaOpen((open) => !open)}
              disabled={!stockPerms.writeDown || baixaDisabled}
              title={baixaDisabled ? 'Sem saldo disponível: todo o lote está reservado.' : undefined}
              className={cn(
                'h-[42px] rounded-xl border text-[13px] font-bold disabled:cursor-not-allowed disabled:opacity-50',
                baixaOpen ? 'border-[#e0457f] bg-[#fdeaf1] text-[#a6325b]' : 'border-[#e3dfd6] bg-white text-[#1a1b1f] hover:bg-[#f6f4ef]',
              )}
            >
              Registrar baixa
            </button>
            <button type="button" className={SECONDARY_BUTTON} onClick={() => onMove(lot.id)} disabled={!stockPerms.transfer}>
              Mover para outro quiosque
            </button>
          </div>

          {baixaOpen && (
            <div className="flex flex-col gap-3.5 rounded-2xl border border-[#f3c7d5] bg-white p-4">
              <span className="text-[13.5px] font-extrabold">Registrar baixa</span>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-[#4a4f57]">Motivo</span>
                <div className="grid grid-cols-2 gap-1.5">
                  {WRITE_DOWN_REASONS.map((reason) => {
                    const on = baixaType === reason.value;
                    return (
                      <button
                        key={reason.value}
                        type="button"
                        onClick={() => { setBaixaType(reason.value); setBaixaError(''); }}
                        className={cn(
                          'flex min-h-10 items-center gap-2 rounded-[11px] px-3 py-2 text-left text-[12.5px] font-bold leading-[1.3]',
                          on ? 'border-2 border-[#5b5bd6] bg-[#eeeefc] text-[#3f3fb0]' : 'border border-[#dcd9d1] bg-white text-[#4a4f57]',
                        )}
                      >
                        <span className={cn('box-border h-3 w-3 shrink-0 rounded-full bg-white', on ? 'border-4 border-[#5b5bd6]' : 'border-[1.5px] border-[#b9b8c2]')} />
                        <span>{reason.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <label className="flex flex-col gap-1.5 text-xs font-bold text-[#4a4f57]">
                <span className="flex flex-wrap justify-between gap-2">
                  <span>Quantidade em {packageLabel}s</span>
                  <span className="font-semibold text-[#70757d]">Disponível: {nf(available)}</span>
                </span>
                <input
                  value={baixaQty}
                  onChange={(event) => { setBaixaQty(event.target.value); setBaixaError(''); }}
                  inputMode="decimal"
                  placeholder="0"
                  className="h-[42px] rounded-[11px] border border-[#e3dfd6] px-3 text-[15px] font-bold outline-none focus:border-[#5b5bd6]"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-bold text-[#4a4f57]">
                {baixaType === 'SAIDA_DESCARTE_OUTROS' ? 'Observações (obrigatório)' : 'Observações (opcional)'}
                <textarea
                  value={baixaObs}
                  onChange={(event) => { setBaixaObs(event.target.value); setBaixaError(''); }}
                  rows={2}
                  className="resize-y rounded-[11px] border border-[#e3dfd6] px-3 py-2.5 text-[13px] outline-none focus:border-[#5b5bd6]"
                />
              </label>
              {baixaError && <span className="text-xs font-semibold text-[#be123c]">{baixaError}</span>}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setBaixaOpen(false)} className="h-[38px] rounded-[11px] border border-[#e3dfd6] bg-white px-3.5 text-[13px] font-bold">
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmBaixa}
                  disabled={saving}
                  className="h-[38px] rounded-[11px] bg-[#e0457f] px-4 text-[13px] font-extrabold text-white hover:bg-[#c93a6f] disabled:opacity-60"
                >
                  {saving ? 'Gravando…' : 'Confirmar baixa'}
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <span className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-[#9a9ba1]">Histórico de movimentações</span>
            <div className="flex flex-col overflow-hidden rounded-[14px] border border-[#e3dfd6] bg-white">
              {!loaded && <span className="px-3.5 py-3 text-xs text-[#70757d]">Carregando histórico…</span>}
              {loaded && lotHistory.length === 0 && <span className="px-3.5 py-3 text-xs text-[#70757d]">Este lote ainda não foi movimentado.</span>}
              {lotHistory.map((record) => {
                const tone = movementTone(record.type);
                const when = record.timestamp ? parseISO(record.timestamp) : null;
                const canRevert = stockPerms.editLot && !record.reverted && !String(record.type).includes('ESTORNO');
                return (
                  <div key={record.id} className="flex flex-col border-b border-[#f1eee8] last:border-b-0">
                    <div className="flex items-center gap-3 px-3.5 py-[11px]">
                      <span className={cn('h-2 w-2 shrink-0 rounded-full', HISTORY_DOT[tone], record.reverted && 'opacity-40')} />
                      <span className="flex flex-1 flex-col gap-px">
                        <span className={cn('text-[13px] font-bold', record.reverted && 'text-[#9a9ba1] line-through')}>{movementLabel(record.type)}</span>
                        <span className="text-[11.5px] text-[#9a9ba1]">
                          {when && isValid(when) ? format(when, 'dd/MM/yyyy HH:mm') : 'N/A'} · {record.username}
                        </span>
                      </span>
                      {record.reverted && <span className="rounded-full bg-[#eceae5] px-2 py-0.5 text-[11px] font-bold text-[#70757d]">Revertido</span>}
                      <span className="font-mono text-[13px] font-bold">{record.quantityChange > 0 && tone === 'in' ? '+' : ''}{nf(record.quantityChange)}</span>
                      {canRevert && (
                        <button type="button" onClick={() => setConfirmRevertId(record.id)} title="Reverter movimentação" className="text-xs font-bold text-[#5b5bd6] hover:text-[#4646b8]">
                          Reverter
                        </button>
                      )}
                    </div>
                    {confirmRevertId === record.id && (
                      <div className="mx-2.5 mb-2.5 flex flex-col gap-2 rounded-xl border border-[#fecdd6] bg-[#fff1f3] p-3">
                        <span className="text-[12.5px] font-semibold leading-[1.45] text-[#881337]">
                          Reverter “{movementLabel(record.type)}” ({nf(record.quantityChange)})? Um movimento de estorno será criado e o saldo do lote ajustado. Esta ação não pode ser desfeita.
                        </span>
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => setConfirmRevertId(null)} className="h-8 rounded-[9px] border border-[#fecdd6] bg-white px-3 text-[12.5px] font-bold">
                            Cancelar
                          </button>
                          <button type="button" onClick={() => confirmRevert(record)} className="h-8 whitespace-nowrap rounded-[9px] bg-[#be123c] px-3 text-[12.5px] font-extrabold text-white">
                            Sim, reverter
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-auto border-t border-[#ebe7df] pt-2">
            {!confirmDelete ? (
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                {stockPerms.writeDown ? (
                  <button type="button" onClick={() => setConfirmDelete(true)} className="py-1.5 text-[13px] font-bold text-[#be123c] hover:text-[#9f1239]">
                    Excluir lote
                  </button>
                ) : <span />}
                {isTiago && (
                  <span className="flex items-center gap-2 text-[11.5px] text-[#9a9ba1]">
                    <span className="font-mono">ID {lot.id}</span>
                    <button type="button" onClick={copyId} className="text-[11.5px] font-bold text-[#5b5bd6]">Copiar</button>
                  </span>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-[#fecdd6] bg-[#fff1f3] px-3.5 py-3">
                <span className="flex-1 text-[12.5px] font-semibold text-[#881337]">Excluir o lote {lot.lotNumber}? Esta ação não pode ser desfeita.</span>
                <button type="button" onClick={() => setConfirmDelete(false)} className="h-8 rounded-[9px] border border-[#fecdd6] bg-white px-3 text-[12.5px] font-bold">
                  Cancelar
                </button>
                <button type="button" onClick={confirmDeleteLot} disabled={deleting} className="h-8 rounded-[9px] bg-[#be123c] px-3 text-[12.5px] font-extrabold text-white disabled:opacity-60">
                  {deleting ? 'Excluindo…' : 'Excluir'}
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="flex flex-col items-start gap-1">
      <span className="text-[10.5px] font-extrabold uppercase tracking-[.1em] text-[#9a9ba1]">{label}</span>
      {children}
    </span>
  );
}
