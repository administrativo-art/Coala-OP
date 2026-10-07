"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/use-auth';
import { useAuthenticatedApi } from '@/hooks/use-authenticated-api';
import { canReceivePurchase } from '@/lib/purchasing-permissions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { format, parseISO } from 'date-fns';

type Notice = {
  purchaseOrderId: string;
  purchaseReceiptId: string;
  purchaseReceiptItemId: string;
  destinationKioskId: string;
  baseItemId: string | null;
  productId: string | null;
  itemName: string | null;
  unit: string;
  quantityNotReceived: number;
  quantityPendingStockEntry: number;
  expectedDate: string | null;
  receiptStatus: string;
};

function expectedDateLabel(value: string | null) {
  if (!value) return 'não informada';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`;
  const parsed = parseISO(value);
  return Number.isFinite(parsed.getTime()) ? format(parsed, 'dd/MM/yyyy') : 'não informada';
}

export function PendingPurchaseNotices({ destinationKioskId }: { destinationKioskId: string }) {
  const api = useAuthenticatedApi();
  const { permissions, isDefaultAdmin } = useAuth();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<Notice | null>(null);
  const [reason, setReason] = useState('');
  const [ignoring, setIgnoring] = useState(false);
  const generation = useRef(0);

  const load = useCallback(async (cursor?: string) => {
    const requestGeneration = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ destinationKioskId });
      if (cursor) query.set('cursor', cursor);
      const page = await api<{ notices: Notice[]; nextCursor: string | null }>(`/api/purchasing/pending-by-destination?${query}`, {
        fallbackError: 'Não foi possível consultar compras a caminho.',
      });
      if (requestGeneration !== generation.current) return;
      setNotices(current => {
        const combined = cursor ? [...current, ...page.notices] : page.notices;
        return [...new Map(combined.map(notice => [`${notice.purchaseReceiptId}:${notice.purchaseReceiptItemId}`, notice])).values()];
      });
      setNextCursor(page.nextCursor);
      setLoaded(true);
    } catch (cause) {
      if (requestGeneration === generation.current) setError(cause instanceof Error ? cause.message : 'Não foi possível consultar compras a caminho.');
    } finally { if (requestGeneration === generation.current) setLoading(false); }
  }, [api, destinationKioskId]);

  useEffect(() => {
    setNotices([]); setNextCursor(null); setLoaded(false); setSelected(null); setIgnoring(false);
    void load();
    return () => { generation.current += 1; };
  }, [load]);

  const ignore = async () => {
    if (!selected || reason.trim().length < 3) return;
    const requestGeneration = generation.current;
    setIgnoring(true); setError('');
    try {
      await api('/api/purchasing/pending-by-destination/ignore', {
        method: 'POST',
        json: {
          purchaseReceiptId: selected.purchaseReceiptId,
          purchaseReceiptItemId: selected.purchaseReceiptItemId,
          destinationKioskId,
          reason: reason.trim(),
        },
        fallbackError: 'Não foi possível ignorar o aviso.',
      });
      if (requestGeneration !== generation.current) return;
      setNotices(current => current.filter(notice => notice.purchaseReceiptItemId !== selected.purchaseReceiptItemId || notice.purchaseReceiptId !== selected.purchaseReceiptId));
      setSelected(null); setReason('');
    } catch (cause) {
      if (requestGeneration === generation.current) setError(cause instanceof Error ? cause.message : 'Não foi possível ignorar o aviso.');
    } finally { if (requestGeneration === generation.current) setIgnoring(false); }
  };

  return <section className="rounded-lg border bg-card p-4" aria-label="Compras a caminho">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="font-semibold">Compras a caminho</h3><p className="text-xs text-muted-foreground">Avisos separados da falta física. Conferir o recebimento não aumenta o saldo; a entrada dos lotes é necessária.</p></div>
      <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void load()}>Atualizar avisos</Button>
    </div>
    {loading && !loaded && <p role="status" className="mt-3 text-sm">Carregando avisos…</p>}
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    {loaded && notices.length === 0 && !loading && <p className="mt-3 text-sm text-muted-foreground">{nextCursor ? 'Esta página não contém avisos. Carregue a próxima para continuar.' : 'Nenhuma compra a caminho para esta unidade.'}</p>}
    {notices.length > 0 && <div className="mt-3 space-y-2">{notices.map(notice => <div key={`${notice.purchaseReceiptId}:${notice.purchaseReceiptItemId}`} className="rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><strong>{notice.itemName || notice.baseItemId || 'Insumo'}</strong><p className="text-xs text-muted-foreground">Pedido {notice.purchaseOrderId} · previsão {expectedDateLabel(notice.expectedDate)}</p></div><Link className="text-xs underline" href={`/dashboard/purchasing/orders/${notice.purchaseOrderId}`}>Ver pedido</Link></div>
      <p className="mt-2">Ainda não recebido: {notice.quantityNotReceived} {notice.unit} · recebido sem entrada em lote: {notice.quantityPendingStockEntry} {notice.unit}</p>
      {(isDefaultAdmin || canReceivePurchase(permissions)) && <Button type="button" variant="ghost" size="sm" onClick={() => { setSelected(notice); setReason(''); }}>Ignorar aviso</Button>}
    </div>)}</div>}
    {nextCursor && <Button type="button" variant="outline" size="sm" disabled={loading} className="mt-3" onClick={() => void load(nextCursor)}>Carregar mais avisos</Button>}
    {selected && <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm"><strong>Ignorar este aviso?</strong><p>Isso oculta somente o aviso. A compra e a despesa continuam válidas; o saldo não muda.</p><label className="mt-2 block text-xs" htmlFor="notice-ignore-reason">Motivo obrigatório</label><Input id="notice-ignore-reason" value={reason} maxLength={500} onChange={event => setReason(event.target.value)} placeholder="Informe o motivo" /><div className="mt-2 flex gap-2"><Button type="button" size="sm" disabled={ignoring || reason.trim().length < 3} onClick={() => void ignore()}>Confirmar ignorar</Button><Button type="button" size="sm" variant="outline" onClick={() => setSelected(null)}>Cancelar</Button></div></div>}
  </section>;
}
