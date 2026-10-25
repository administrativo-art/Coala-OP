'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import { ArrowLeftRight, Check, Loader2, Send, X } from 'lucide-react';

import { PanelSection, SidePanel } from '@/components/patterns/side-panel';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status-pill';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { formatRequestDate, formatRequestDateTime } from '@/features/hr/requests/request-ui';

import { createShiftSwapRequest, fetchShiftSwapOptions, fetchShiftSwaps, updateShiftSwapRequest } from './client';
import type { ShiftSwapOption, ShiftSwapRequest } from './types';

function shiftLabel(shift: Pick<ShiftSwapOption, 'date' | 'startTime' | 'endTime' | 'unitName' | 'occupantName'>, showPerson = false) {
  return `${formatRequestDate(shift.date)} · ${shift.startTime}–${shift.endTime} · ${shift.unitName}${showPerson ? ` · ${shift.occupantName}` : ''}`;
}
function optionKey(shift: Pick<ShiftSwapOption, 'scheduleId' | 'shiftId'>) { return `${shift.scheduleId}:${shift.shiftId}`; }
function statusLabel(status: ShiftSwapRequest['status']) {
  return { pending: 'Aguardando resposta', accepted: 'Aceita', rejected: 'Recusada', cancelled: 'Cancelada', stale: 'Escala alterada' }[status];
}
function statusTone(status: ShiftSwapRequest['status']) {
  if (status === 'accepted') return 'ok' as const;
  if (status === 'pending') return 'warn' as const;
  if (status === 'rejected' || status === 'stale') return 'danger' as const;
  return 'neutral' as const;
}
export function ShiftSwapRequestsSection({ firebaseUser, openCreateSignal = 0 }: { firebaseUser: FirebaseUser | null; openCreateSignal?: number }) {
  const { toast } = useToast();
  const [items, setItems] = useState<ShiftSwapRequest[]>([]);
  const [options, setOptions] = useState<{ ownShifts: ShiftSwapOption[]; candidateShifts: ShiftSwapOption[]; through: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<ShiftSwapRequest | null>(null);
  const [offeredShiftId, setOfferedShiftId] = useState('');
  const [requestedShiftId, setRequestedShiftId] = useState('');
  const [reason, setReason] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    try { setItems((await fetchShiftSwaps(firebaseUser)).requests); }
    catch (cause) { toast({ variant: 'destructive', title: cause instanceof Error ? cause.message : 'Falha ao carregar trocas de turno.' }); }
    finally { setLoading(false); }
  }, [firebaseUser, toast]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const openCreate = useCallback(async () => {
    if (!firebaseUser) return;
    setCreating(true);
    setOptionsLoading(true);
    setOfferedShiftId(''); setRequestedShiftId(''); setReason('');
    try { setOptions(await fetchShiftSwapOptions(firebaseUser)); }
    catch (cause) { toast({ variant: 'destructive', title: cause instanceof Error ? cause.message : 'Falha ao carregar os turnos.' }); }
    finally { setOptionsLoading(false); }
  }, [firebaseUser, toast]);
  useEffect(() => {
    if (openCreateSignal <= 0) return undefined;
    const timer = window.setTimeout(() => void openCreate(), 0);
    return () => window.clearTimeout(timer);
  }, [openCreate, openCreateSignal]);

  const offered = options?.ownShifts.find((shift) => optionKey(shift) === offeredShiftId) ?? null;
  const candidates = useMemo(() => offered ? options?.candidateShifts.filter((shift) =>
    shift.scheduleId === offered.scheduleId && shift.unitId === offered.unitId && shift.date === offered.date) ?? [] : [], [offered, options]);
  const requested = candidates.find((shift) => optionKey(shift) === requestedShiftId) ?? null;

  async function submit() {
    if (!firebaseUser || !offered || !requested || busy) return;
    setBusy(true);
    try {
      const response = await createShiftSwapRequest(firebaseUser, { scheduleId: offered.scheduleId,
        offeredShiftId: offered.shiftId, requestedShiftId: requested.shiftId, operationId: crypto.randomUUID(),
        ...(reason.trim() ? { reason: reason.trim() } : {}) });
      setCreating(false); setSelected(response.request);
      await load();
      toast({ title: `Solicitação enviada para ${requested.occupantName}.` });
    } catch (cause) { toast({ variant: 'destructive', title: cause instanceof Error ? cause.message : 'Falha ao solicitar a troca.' }); }
    finally { setBusy(false); }
  }

  async function decide(action: 'accept' | 'reject' | 'cancel') {
    if (!firebaseUser || !selected || busy) return;
    setBusy(true);
    try {
      const response = await updateShiftSwapRequest(firebaseUser, selected.id, { action, expectedVersion: selected.version,
        operationId: crypto.randomUUID(), ...(action === 'reject' ? { reason: rejectReason.trim() } : {}) } as Parameters<typeof updateShiftSwapRequest>[2]);
      setSelected(response.request); setRejectReason('');
      await load();
      toast({ title: action === 'accept' ? 'Troca aceita e escala atualizada.' : action === 'reject' ? 'Troca recusada.' : 'Troca cancelada.' });
    } catch (cause) { toast({ variant: 'destructive', title: cause instanceof Error ? cause.message : 'Falha ao registrar a decisão.' }); }
    finally { setBusy(false); }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Escala</p><h2 className="mt-1 text-lg font-extrabold text-ds-ink">Trocas de turno</h2></div>
        <Button variant="ds-secondary" size="sm" onClick={() => void openCreate()}><ArrowLeftRight className="h-4 w-4" />Solicitar troca</Button>
      </div>
      <div className="overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface">
        {loading ? <div className="flex items-center gap-2 p-4 text-sm text-ds-ink-muted"><Loader2 className="h-4 w-4 animate-spin" />Carregando trocas…</div>
          : items.length ? items.map((item) => <button key={item.id} type="button" onClick={() => setSelected(item)} className="flex w-full items-center justify-between gap-4 border-b border-ds-divider px-4 py-3 text-left last:border-0 hover:bg-ds-page">
            <span className="min-w-0"><span className="block truncate text-sm font-extrabold text-ds-ink">{item.requesterName} ⇄ {item.targetName}</span><span className="mt-0.5 block text-xs text-ds-ink-muted">{shiftLabel(item.offeredShift)} · proposta em {formatRequestDate(item.createdAt.slice(0, 10))}</span></span>
            <StatusPill variant={statusTone(item.status)}>{statusLabel(item.status)}</StatusPill>
          </button>) : <p className="p-4 text-sm font-semibold text-ds-ink-muted">Nenhuma troca de turno solicitada.</p>}
      </div>

      <SidePanel open={creating} onOpenChange={setCreating} kicker="Solicitações" title="Trocar turno" subtitle="Escolha seu turno e o turno de outra pessoa da mesma unidade e data.">
        <PanelSection title="Turnos da troca">
          {optionsLoading ? <div className="flex items-center gap-2 text-sm text-ds-ink-muted"><Loader2 className="h-4 w-4 animate-spin" />Carregando escala…</div> : <>
            <label className="grid gap-1.5 text-xs font-bold text-ds-ink">Meu turno
              <select value={offeredShiftId} onChange={(event) => { setOfferedShiftId(event.target.value); setRequestedShiftId(''); }} className="h-11 rounded-ds-btn border border-ds-border-input bg-ds-surface px-3">
                <option value="">Selecione</option>{options?.ownShifts.map((shift) => <option key={optionKey(shift)} value={optionKey(shift)}>{shiftLabel(shift)}</option>)}
              </select>
            </label>
            <label className="grid gap-1.5 text-xs font-bold text-ds-ink">Turno que quero receber
              <select value={requestedShiftId} disabled={!offered} onChange={(event) => setRequestedShiftId(event.target.value)} className="h-11 rounded-ds-btn border border-ds-border-input bg-ds-surface px-3 disabled:opacity-60">
                <option value="">Selecione</option>{candidates.map((shift) => <option key={optionKey(shift)} value={optionKey(shift)}>{shiftLabel(shift, true)}</option>)}
              </select>
            </label>
            {offered && candidates.length === 0 ? <p className="rounded-ds-md bg-ds-warn-bg p-3 text-xs font-semibold text-ds-warn">Não há outro turno elegível na mesma unidade e data.</p> : null}
          </>}
        </PanelSection>
        <PanelSection title="Confirmação">
          <Textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder="Motivo da troca (opcional)" className="min-h-24" />
          <p className="text-xs leading-5 text-ds-ink-muted">A outra pessoa receberá uma notificação. A escala só muda depois do aceite autenticado dela. Não informe diagnóstico, atestado ou outro dado de saúde no motivo.</p>
        </PanelSection>
        <div className="mt-auto flex justify-end gap-2 border-t border-ds-divider pt-4"><Button variant="ds-secondary" onClick={() => setCreating(false)}>Cancelar</Button><Button variant="primary-page" disabled={!offered || !requested || busy || Boolean(reason.trim() && reason.trim().length < 5)} loading={busy} loadingLabel="Enviando…" onClick={() => void submit()}><Send className="h-4 w-4" />Enviar</Button></div>
      </SidePanel>

      <SidePanel open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }} kicker="Solicitações" title="Troca de turno" subtitle={selected ? `${selected.requesterName} ⇄ ${selected.targetName}` : undefined}>
        {selected ? <>
          <PanelSection title="Proposta">
            <StatusPill variant={statusTone(selected.status)}>{statusLabel(selected.status)}</StatusPill>
            <div className="grid gap-3 text-xs sm:grid-cols-2"><div><p className="font-extrabold text-ds-ink-faint">Turno oferecido</p><p className="mt-1 font-semibold text-ds-ink">{shiftLabel(selected.offeredShift, true)}</p></div><div><p className="font-extrabold text-ds-ink-faint">Turno solicitado</p><p className="mt-1 font-semibold text-ds-ink">{shiftLabel(selected.requestedShift, true)}</p></div></div>
            {selected.reason ? <p className="rounded-ds-md bg-ds-muted p-3 text-xs text-ds-ink-muted">{selected.reason}</p> : null}
          </PanelSection>
          <PanelSection title="Registro dos atos">
            <ol className="space-y-3">{selected.events.map((item, index) => <li key={`${item.action}:${item.at}:${index}`} className="rounded-ds-md border border-ds-border p-3"><p className="text-xs font-extrabold text-ds-ink">{item.actorName} · {formatRequestDateTime(item.at)}</p><p className="mt-1 text-xs leading-5 text-ds-ink-muted">{item.declaration}</p><p className="mt-1 text-[11px] font-semibold text-ds-ink-faint">Identidade confirmada pela sessão autenticada{item.evidence.signInProvider ? ` via ${item.evidence.signInProvider}` : ''}.</p></li>)}</ol>
          </PanelSection>
          {selected.viewerActions?.accept || (selected.status === 'pending' && firebaseUser?.uid === selected.targetUid) ? <PanelSection title="Sua decisão">
            <Textarea value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} maxLength={500} placeholder="Motivo obrigatório somente se recusar" className="min-h-20" />
            <div className="flex flex-wrap gap-2"><Button variant="primary-page" disabled={busy} loading={busy} onClick={() => void decide('accept')}><Check className="h-4 w-4" />Aceitar e trocar</Button><Button variant="ds-secondary" disabled={busy || rejectReason.trim().length < 5} onClick={() => void decide('reject')}><X className="h-4 w-4" />Recusar</Button></div>
          </PanelSection> : null}
          {selected.viewerActions?.cancel || (selected.status === 'pending' && firebaseUser?.uid === selected.requesterUid) ? <div className="mt-auto border-t border-ds-divider pt-4"><Button variant="danger-link" disabled={busy} onClick={() => void decide('cancel')}><X className="h-4 w-4" />Cancelar proposta</Button></div> : null}
        </> : null}
      </SidePanel>
    </section>
  );
}
