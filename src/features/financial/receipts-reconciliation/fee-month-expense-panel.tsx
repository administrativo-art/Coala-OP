"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { AuthenticatedApiError } from "@/lib/authenticated-api-client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { InlineConfirm } from "@/components/patterns/inline-confirm";
import { Textarea } from "@/components/ui/textarea";
import { FEE_EXPENSE_LABEL, type FeeExpenseStatus } from "./fee-month-expense";
import { monthLongLabel } from "./month-select";
import { centsLabel } from "./stone-account-format";

/**
 * Passo 6: lança as taxas Stone do mês (Pix, débito, crédito) como despesas já pagas na origem.
 * O servidor recalcula tudo e recusa se houver pendência ou se os valores mudaram desde a tela.
 */
export function StoneFeeMonthExpensePanel({ kioskId, stoneCode, month, refreshKey }: { kioskId: string; stoneCode: string; month: string; refreshKey: number | null }) {
  const api = useAuthenticatedApi();
  const [status, setStatus] = useState<FeeExpenseStatus | null>(null);
  const [center, setCenter] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [undoOpen, setUndoOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback((signal?: AbortSignal) => api<FeeExpenseStatus>(`/api/financial/stone-fee-expenses?${new URLSearchParams({ kioskId, stoneCode, month })}`, { signal }), [api, kioskId, stoneCode, month]);

  useEffect(() => {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    const controller = new AbortController();
    let alive = true;
    void Promise.resolve().then(() => { if (alive) { setBusy(true); setError(""); } })
      .then(() => load(controller.signal))
      .then(next => { if (!alive) return; setStatus(next); setCenter(current => current || (next.centers.length === 1 ? next.centers[0].id : "")); })
      .catch(caught => { if (alive && !controller.signal.aborted) setError(caught instanceof AuthenticatedApiError ? caught.message : "Não foi possível abrir a despesa do mês."); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; controller.abort(); };
  }, [load, month, refreshKey]);

  const post = async (body: Record<string, unknown>, done: string) => {
    if (saving) return;
    setSaving(true); setError(""); setMessage("");
    try {
      await api("/api/financial/stone-fee-expenses", { method: "POST", json: { kioskId, stoneCode, month, ...body } });
      setStatus(await load()); setUndoOpen(false); setReason(""); setMessage(done);
    } catch (caught) { setError(caught instanceof AuthenticatedApiError ? caught.message : "Não foi possível concluir. Recarregue antes de repetir."); }
    finally { setSaving(false); }
  };

  const plan = status?.plan;
  const record = status?.record?.active ? status.record : null;
  const blocked = Boolean(plan?.blockers.length);
  const canLaunch = Boolean(plan && !record && !blocked && center && !saving);

  return <section className="rounded-ds-card border border-ds-border bg-ds-surface px-[18px] py-4" aria-label="Despesa do mês">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Despesa do mês · {monthLongLabel(month)}</p>
        <h2 className="mt-0.5 text-[15.5px] font-extrabold text-ds-ink">Lançar as taxas como despesa</h2>
        <p className="mt-1 max-w-3xl text-[12.5px] text-ds-ink-muted">Uma despesa por tipo em {status?.accountName ?? "Taxas de cartão"}, competência do mês da venda, já paga: a Stone descontou do repasse, então não haverá outra saída no banco.</p>
      </div>
      {record ? <StatusPill variant="ok">Lançado</StatusPill> : plan ? <StatusPill variant={blocked ? "warn" : "info"}>{blocked ? "Aguardando" : "Pronto para lançar"}</StatusPill> : null}
    </div>

    {busy && !status ? <p role="status" className="mt-3 text-sm text-ds-ink-muted">Carregando…</p> : null}
    {plan ? <div className="mt-3 overflow-x-auto rounded-ds-btn-lg border border-ds-border">
      <table className="w-full border-separate border-spacing-0 text-[13.5px]">
        <thead><tr className="bg-ds-muted text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-ds-ink-faint">
          <th className="px-4 py-2 text-left">Despesa</th><th className="px-4 py-2 text-right">Vendas</th><th className="px-4 py-2 text-right">Valor</th></tr></thead>
        <tbody>
          {(record ? record.items.map(item => ({ kind: item.kind, label: FEE_EXPENSE_LABEL[item.kind], amountCents: item.amountCents, saleCount: plan.items.find(row => row.kind === item.kind)?.saleCount ?? null }))
            : plan.items).map(item => <tr key={item.kind}>
            <td className="whitespace-nowrap border-t border-ds-divider px-4 py-2.5 font-semibold text-ds-ink">{item.label}</td>
            <td className="whitespace-nowrap border-t border-ds-divider px-4 py-2.5 text-right tabular-nums text-ds-ink-muted">{item.saleCount ?? "—"}</td>
            <td className="whitespace-nowrap border-t border-ds-divider px-4 py-2.5 text-right font-bold tabular-nums text-ds-ink">{centsLabel(item.amountCents)}</td></tr>)}
          {!plan.items.length && !record ? <tr><td colSpan={3} className="border-t border-ds-divider px-4 py-4 text-center text-ds-ink-muted">Sem taxas a lançar neste mês.</td></tr> : null}
        </tbody>
      </table>
    </div> : null}

    {plan && !record && blocked ? <ul className="mt-3 space-y-1 rounded-ds-btn-lg border border-ds-alert-border bg-ds-warn-bg px-4 py-3 text-[12.5px] text-ds-alert-ink">
      {plan.blockers.map(text => <li key={text}>{text}</li>)}
    </ul> : null}

    {plan && !record && !blocked ? <div className="mt-3 flex flex-wrap items-end gap-3">
      {status && status.centers.length > 1 ? <label className="grid gap-1.5 text-[12px] font-bold text-ds-ink-2">Centro de resultado
        <Select value={center || undefined} onValueChange={setCenter}>
          <SelectTrigger aria-label="Centro de resultado" className="w-[260px]"><SelectValue placeholder="Escolha o centro" /></SelectTrigger>
          <SelectContent>{status.centers.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
        </Select></label>
        : status?.centers.length === 1 ? <p className="text-[12.5px] text-ds-ink-muted">Centro de resultado: <strong className="text-ds-ink">{status.centers[0].name}</strong></p>
          : <p className="text-[12.5px] text-ds-danger">A unidade não tem centro de resultado exclusivo ativo.</p>}
      <Button type="button" variant="primary-page" size="md" disabled={!canLaunch} onClick={() => void post({ action: "launch", fingerprint: plan.fingerprint, resultCenterId: center }, "Taxas lançadas como despesa paga. Nenhum pagamento ou débito bancário foi criado.")}>
        {saving ? "Lançando…" : `Lançar ${centsLabel(plan.totalCents)}`}</Button>
    </div> : null}

    {record ? <div className="mt-3 space-y-2">
      <p className="text-[12.5px] text-ds-ink-muted">Lançado em {new Date(record.launchedAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · centro {record.resultCenterName}.</p>
      {undoOpen ? <div className="space-y-2">
        <label className="grid gap-1.5 text-[12px] font-bold text-ds-ink-2">Motivo para desfazer<Textarea value={reason} maxLength={500} onChange={event => setReason(event.target.value)} /></label>
        <InlineConfirm message="As despesas deste lançamento serão canceladas." confirmLabel="Desfazer lançamento" loadingLabel="Desfazendo…" loading={saving}
          onConfirm={() => { if (reason.trim().length >= 3) void post({ action: "cancel", reason: reason.trim() }, "Lançamento desfeito; as despesas foram canceladas."); else setError("Informe o motivo (mínimo 3 caracteres)."); }}
          onCancel={() => { setUndoOpen(false); setReason(""); }} />
      </div> : <Button type="button" variant="ds-secondary" size="xs" onClick={() => setUndoOpen(true)}>Desfazer lançamento</Button>}
    </div> : null}

    {status?.record && !status.record.active ? <p className="mt-2 text-xs text-ds-ink-faint">Lançamento anterior desfeito em {status.record.cancelledAt ? new Date(status.record.cancelledAt).toLocaleDateString("pt-BR") : "—"}: {status.record.cancelReason}</p> : null}
    {error ? <p role="alert" className="mt-2 text-sm font-semibold text-ds-danger">{error}</p> : null}
    {message ? <p role="status" className="mt-2 text-sm font-semibold text-ds-ok">{message}</p> : null}
  </section>;
}
