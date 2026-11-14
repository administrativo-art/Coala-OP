"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { AuthenticatedApiError } from "@/lib/authenticated-api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MappingView } from "../agent/configuration";
import type { StoneAccountMonthResult } from "./reconciliation.server";
import type { StoneReceiptSavedResult } from "./stone-account-snapshot.server";
import { anticipationItems, anticipationWeeks, receiptModalityLabel, receiptMonthRange, weightedMonthlyRate } from "./stone-account";
import { centsLabel, dayLabel, rateLabel } from "./stone-account-format";

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const th = "whitespace-nowrap border-y border-ds-divider bg-ds-muted px-[18px] py-2.5 text-left text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint";
const td = "border-b border-ds-divider px-[18px] py-2.5 align-top text-[13.5px]";
const currentMonth = () => new Date(Date.now() - 8 * 3_600_000 - 86_400_000).toISOString().slice(0, 7);

/**
 * Antecipações (alternativa C10): parcelas pagas antes do vencimento original, por semana retrátil,
 * com vencimento original, dias antecipados, custo e taxa efetiva ao mês. Lê a conferência salva do
 * Recebido; "Reconferir agora" consulta ao vivo, sem gravar.
 */
export function StoneAnticipationsTable({ mapping, stoneCode }: { mapping: MappingView; stoneCode: string }) {
  const api = useAuthenticatedApi();
  const [month, setMonth] = useState(currentMonth);
  const [result, setResult] = useState<StoneAccountMonthResult | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [notReady, setNotReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [openWeeks, setOpenWeeks] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!stoneCode || !/^\d{4}-\d{2}$/.test(month)) return;
    const controller = new AbortController();
    let alive = true;
    void Promise.resolve().then(() => { if (alive) { setBusy(true); setError(""); setNotReady(false); } })
      .then(() => api<StoneReceiptSavedResult>("/api/financial/stone-receipts/reconcile", { method: "POST", json: { view: "saved", kioskId: mapping.kioskId, stoneCode, month }, signal: controller.signal }))
      .then(saved => {
        if (!alive) return;
        if (saved.status === "ready" && saved.result.scope.mappingId === mapping.id) { setResult(saved.result); setSavedAt(saved.savedAt); }
        else { setResult(null); setSavedAt(null); setNotReady(true); }
      })
      .catch(caught => { if (alive && !controller.signal.aborted) setError(caught instanceof AuthenticatedApiError ? caught.message : "Não foi possível abrir as antecipações."); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; controller.abort(); };
  }, [api, mapping.id, mapping.kioskId, stoneCode, month]);

  const reconfer = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const next = await api<StoneAccountMonthResult>("/api/financial/stone-receipts/reconcile", { method: "POST", json: { view: "month", kioskId: mapping.kioskId, stoneCode, ...receiptMonthRange(month) } });
      if (next.scope.mappingId !== mapping.id) throw new AuthenticatedApiError("O vínculo mudou durante a consulta. Recarregue a página.", 409, null);
      setResult(next); setSavedAt(null); setNotReady(false);
    } catch (caught) { setError(caught instanceof AuthenticatedApiError ? caught.message : "Não foi possível conferir as antecipações."); }
    finally { setBusy(false); }
  };

  const items = useMemo(() => anticipationItems(result?.parcels ?? []), [result]);
  const weeks = useMemo(() => anticipationWeeks(items), [items]);
  const toggle = (key: string) => setOpenWeeks(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const totalBase = items.reduce((sum, item) => sum + item.baseCents, 0);
  const totalCost = items.reduce((sum, item) => sum + item.costCents, 0);

  return <section className="rounded-ds-card border border-ds-border bg-ds-surface" aria-label="Parcelas antecipadas">
    <header className="flex flex-wrap items-end gap-3 px-[18px] pb-3 pt-4">
      <div>
        <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Antecipações · pagas antes do vencimento</p>
        <h2 className="mt-0.5 text-[15.5px] font-extrabold text-ds-ink">{items.length} parcela(s) antecipada(s) · {centsLabel(totalBase)}</h2>
        <p className="text-[12.5px] text-ds-ink-muted">Custo {centsLabel(totalCost)} · taxa efetiva {rateLabel(weightedMonthlyRate(items))} a.m.{savedAt ? ` · conferido automaticamente em ${new Date(savedAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : result ? " · conferido agora" : ""}</p>
      </div>
      <label className="ml-auto grid gap-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Mês do pagamento
        <Input aria-label="Mês do pagamento das antecipações" type="month" value={month} onChange={event => { setMonth(event.target.value); setResult(null); setOpenWeeks(new Set()); }} className="w-[170px] normal-case tracking-normal" />
      </label>
      <Button type="button" variant="ds-secondary" size="md" disabled={busy} onClick={() => void reconfer()}><RefreshCw aria-hidden="true" className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />{busy ? "Conferindo…" : "Reconferir agora"}</Button>
    </header>
    {error ? <p role="alert" className="px-[18px] pb-3 text-sm font-semibold text-ds-danger">{error}</p> : null}
    {notReady && !result ? <p role="status" className="mx-[18px] mb-4 rounded-ds-btn-lg border border-dashed border-ds-border-input px-4 py-6 text-center text-sm text-ds-ink-muted">Este mês ainda não foi conferido automaticamente. Use <strong className="text-ds-ink">Reconferir agora</strong>.</p> : null}
    {result ? <div className="overflow-x-auto"><table className="w-full border-separate border-spacing-0">
      <thead><tr><th className={th}>Pago em</th><th className={th}>Vencia</th><th className={th}>Cartão</th><th className={`${th} text-right`}>Dias</th><th className={`${th} text-right`}>Líquido original</th><th className={`${th} text-right`}>Custo</th><th className={`${th} text-right`}>Taxa a.m.</th></tr></thead>
      <tbody>{weeks.length ? weeks.map(week => {
        const open = openWeeks.has(week.from);
        return <Fragment key={week.from}>
          <tr className="cursor-pointer [&>td]:bg-ds-muted hover:[&>td]:bg-ds-seg/60" onClick={() => toggle(week.from)} aria-expanded={open}>
            <td colSpan={4} className={`${td} py-3`}><span className="inline-flex items-center gap-1">{open ? <ChevronDown aria-hidden="true" className="h-4 w-4 text-ds-ink-faint" /> : <ChevronRight aria-hidden="true" className="h-4 w-4 text-ds-ink-faint" />}
              <strong className="inline-block min-w-[150px] font-extrabold text-ds-ink">Semana de {Number(week.from.slice(8))} {MONTHS[Number(week.from.slice(5, 7)) - 1]}</strong>
              <span className="border-l-2 border-ds-ink-faint pl-3 text-[12.5px] font-semibold leading-none text-ds-ink-muted">{week.items.length} parcela(s)</span></span></td>
            <td className={`${td} py-3 text-right font-ds-mono font-bold`}>{centsLabel(week.baseCents)}</td>
            <td className={`${td} py-3 text-right font-ds-mono`}>{centsLabel(week.costCents)}</td>
            <td className={`${td} py-3 text-right font-ds-mono`}>{rateLabel(week.monthlyRate)}</td>
          </tr>
          {open ? week.items.map(item => <tr key={item.id}>
            <td className={`${td} pl-11 font-ds-mono`}>{dayLabel(item.paidDate)}</td>
            <td className={`${td} font-ds-mono`}>{dayLabel(item.originalDate)}</td>
            <td className={td}>{item.brand ?? "Cartão"} · {receiptModalityLabel(item.modality)}{item.installmentCount > 1 ? ` ${item.installment}/${item.installmentCount}` : ""}</td>
            <td className={`${td} text-right font-ds-mono`}>{item.days}</td>
            <td className={`${td} text-right font-ds-mono`}>{centsLabel(item.baseCents)}</td>
            <td className={`${td} text-right font-ds-mono`}>{centsLabel(item.costCents)}</td>
            <td className={`${td} text-right font-ds-mono`}>{rateLabel(item.monthlyRate)}</td>
          </tr>) : null}
        </Fragment>;
      }) : <tr><td colSpan={7} className={`${td} py-8 text-center text-ds-ink-muted`}>Nenhuma parcela antecipada neste mês.</td></tr>}</tbody>
    </table></div> : null}
    <p className="border-t border-ds-divider px-[18px] py-3 text-[12.5px] text-ds-ink-muted">Fonte: pagamentos do arquivo Stone com vencimento original posterior (AdvancedReceivableOriginalPaymentDate) e custo em AdvanceRateAmount. Taxa efetiva = custo ÷ (líquido original × dias ÷ 30). Esta tabela ainda não separa antecipação automática da pedida no dia.</p>
  </section>;
}
