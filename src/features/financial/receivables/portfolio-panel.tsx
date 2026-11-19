"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { LiftRow } from "@/components/patterns/lift-row";
import { SidePanel, PanelSection } from "@/components/patterns/side-panel";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/status-pill";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { AuthenticatedApiError } from "@/lib/authenticated-api-client";
import { centsLabel, rateLabel } from "../receipts-reconciliation/stone-account-format";
import { parcelFeeRate, receiptModalityLabel } from "../receipts-reconciliation/stone-account";
import type { StonePortfolioRow } from "./portfolio-projection";
import { StonePositionBar, type RightsPosition } from "./position-bar";
import {
  receivableItems,
  receivableMonth,
  receivableMonths,
  receivableTotals,
  receivableWeeks,
  type ReceivableItem,
  type ReceivableTotals,
} from "./receivable-view";

type PortfolioResult = {
  status: "synchronized" | "not_synchronized";
  stoneCode: string; firstCaptureDate: string; asOf: string | null; updatedAt?: string;
  latestAvailableDate: string; stale: boolean;
  summary: { openCount: number; openNet: string | null; paidCount: number;
    reviewCount: number; unsupportedCaptureCount: number; paymentsWithoutOriginCount: number } | null;
  rows: StonePortfolioRow[];
  rightsPosition?: RightsPosition | null;
  missingDates?: string[];
};
export type ReceivableIndicators = { openCents: number; openCount: number; next7Cents: number; reviewCount: number } | null;

const ALL = "all";
const CUSTOM = "custom";
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MONTHS_LONG = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const th = "whitespace-nowrap border-y border-ds-divider bg-ds-muted px-[18px] py-2.5 text-left text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint";
const td = "whitespace-nowrap border-b border-ds-divider px-[18px] py-2.5 align-middle text-[13.5px]";
const date = (value: string | null) => value ? value.split("-").reverse().join("/") : "—";
const short = (value: string | null) => value ? `${value.slice(8, 10)}/${value.slice(5, 7)}` : "—";
const weekday = (value: string) => ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][new Date(`${value}T12:00:00Z`).getUTCDay()];
const monthName = (month: string) => `${MONTHS_LONG[Number(month.slice(5)) - 1]}${month.slice(0, 4) !== String(new Date().getFullYear()) ? ` de ${month.slice(0, 4)}` : ""}`;
const periodText = (from: string, through: string) => from && through ? ` de ${date(from)} a ${date(through)}` : from ? ` a partir de ${date(from)}` : through ? ` até ${date(through)}` : " no período";
const range = (first: string, last: string) => {
  const name = MONTHS[Number(first.slice(5, 7)) - 1];
  return first === last ? `${Number(first.slice(8))} de ${name}` : `${Number(first.slice(8))} a ${Number(last.slice(8))} de ${name}`;
};
const addDays = (value: string, days: number) => { const d = new Date(`${value}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

// Parcela numa linha, no mesmo desenho da aba Recebido: venda, data da venda, parcela, previsto, bruto, taxa, líquido e situação.
const PARCEL_GRID = "grid grid-cols-[minmax(170px,1.5fr)_96px_56px_64px_84px_118px_96px_minmax(150px,1.3fr)] items-center gap-3 whitespace-nowrap";

function ParcelHeader() {
  return <div className={`${PARCEL_GRID} border-b border-ds-divider px-[18px] py-2 text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-ds-ink-faint`}>
    <span>Venda</span><span>Data da venda</span><span>Parcela</span><span>Previsto</span><span className="text-right">Bruto</span><span className="text-right">Taxa</span><span className="text-right">Líquido</span><span>Situação</span>
  </div>;
}

function ParcelRow({ item, onOpen }: { item: ReceivableItem; onOpen: () => void }) {
  return <LiftRow table onClick={onOpen} className={`${PARCEL_GRID} text-[13px]`}>
    <span className="truncate font-extrabold text-ds-ink">{itemTitle(item)}</span>
    <span className="tabular-nums text-ds-ink-muted">{short(item.saleDate)}</span>
    <span className="tabular-nums font-bold text-ds-ink">{item.installment}/{item.installmentCount ?? "—"}</span>
    <span className="tabular-nums text-ds-ink-muted">{short(item.dueDate)}</span>
    <span className="text-right tabular-nums text-ds-ink-muted">{centsLabel(item.grossCents)}</span>
    <span className="text-right tabular-nums text-ds-ink-muted">{item.feeCents === null ? "—" : rateLabel(parcelFeeRate(item))}</span>
    <span className="text-right tabular-nums font-bold text-ds-ink">{centsLabel(item.netCents)}</span>
    <span className="flex gap-1">{item.status === "review" ? <StatusPill variant="warn" title={item.reason ?? undefined}>Conferir</StatusPill> : <StatusPill variant="neutral">A receber</StatusPill>}
      {item.feeSource === "derived" ? <StatusPill variant="warn" title="A Stone não mandou o MDR; taxa proposta = bruto − líquido">Verificar taxa</StatusPill> : null}</span>
  </LiftRow>;
}

/** Colunas de totais da linha de mês, semana e dia: mesmas seis colunas da tabela Recebido. */
function TotalsCells({ totals, className, extra }: { totals: ReceivableTotals; className: string; extra?: string }) {
  const feeText = totals.feeUnknown === totals.count ? "—" : centsLabel(totals.feeCents);
  const review = totals.reviewCount;
  return <>
    <td className={`${className} text-right tabular-nums`}>{totals.count}</td>
    <td className={`${className} text-right tabular-nums`}>{centsLabel(totals.grossCents)}</td>
    <td className={`${className} text-right tabular-nums`}>{feeText}</td>
    <td className={`${className} text-right tabular-nums font-bold`}>{centsLabel(totals.netCents)}</td>
    <td className={`${className} text-[12.5px] ${review ? "" : "text-ds-ink-muted"}`}>{review ? <StatusPill variant="warn">{review} para conferir</StatusPill> : extra ?? "a receber"}</td>
  </>;
}

function itemTitle(item: ReceivableItem) {
  if (!item.brand || !item.modality) return "Cartão (aguardando sincronização)";
  return `${item.brand} ${receiptModalityLabel(item.modality).toLowerCase()}`;
}

/**
 * A receber: o que a Stone ainda deve pagar na conta Stone. Abre em "Tudo"; as abas de mês filtram a tabela,
 * semana, dia e parcela abrem em sequência, como em Recebido e os cartões da posição Stone abrem o detalhe por arranjo.
 */
export function StonePortfolioPanel({ stoneCode, onIndicators }: { stoneCode: string; onIndicators?: (value: ReceivableIndicators) => void }) {
  const api = useAuthenticatedApi();
  const [result, setResult] = useState<PortfolioResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [month, setMonth] = useState(ALL);
  const [openWeeks, setOpenWeeks] = useState<Set<string>>(new Set());
  const [from, setFrom] = useState("");
  const [through, setThrough] = useState("");
  const [openDays, setOpenDays] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<ReceivableItem | null>(null);
  useEffect(() => {
    if (!stoneCode) return;
    let active = true;
    setLoading(true);
    setError("");
    api<PortfolioResult>(`/api/financial/stone-portfolio?stoneCode=${encodeURIComponent(stoneCode)}`)
      .then(value => { if (active) setResult(value); })
      .catch(cause => { if (active) setError(cause instanceof AuthenticatedApiError ? cause.message : "Não foi possível ler a carteira."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, stoneCode]);

  const items = useMemo(() => receivableItems(result?.rows ?? []), [result]);
  const months = useMemo(() => receivableMonths(items), [items]);
  const inRange = (item: ReceivableItem) => (!from || item.dueDate >= from) && (!through || item.dueDate <= through);
  const shown = month === ALL ? items : month === CUSTOM ? items.filter(inRange) : items.filter(item => receivableMonth(item.dueDate) === month);
  const total = receivableTotals(items);

  useEffect(() => {
    if (!onIndicators) return;
    if (!result || result.status !== "synchronized" || !result.asOf) { onIndicators(null); return; }
    const until = addDays(result.asOf, 7);
    onIndicators({
      openCents: total.netCents, openCount: total.count,
      next7Cents: items.filter(item => item.dueDate <= until).reduce((sum, item) => sum + item.netCents, 0),
      reviewCount: items.filter(item => item.status === "review").length,
    });
  }, [result, items, total.netCents, total.count, onIndicators]);

  if (!stoneCode) return null;
  const toggle = (key: string) => setOpenWeeks(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const toggleDay = (key: string) => setOpenDays(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const dayRows = (items: ReceivableItem[], date: string) => {
    const open = openDays.has(date);
    const totals = receivableTotals(items);
    return <Fragment key={date}>
      <tr className={`cursor-pointer hover:[&>td]:bg-ds-muted ${open ? "[&>td]:bg-ds-accent-row" : ""}`} onClick={() => toggleDay(date)} aria-expanded={open}>
        <td className={`${td} pl-9`}><span className="inline-flex items-center gap-1 font-bold">{open ? <ChevronDown aria-hidden="true" className="h-4 w-4 text-ds-ink-faint" /> : <ChevronRight aria-hidden="true" className="h-4 w-4 text-ds-ink-faint" />}{weekday(date)} {short(date)}</span></td>
        <TotalsCells totals={totals} className={td} />
      </tr>
      {open ? <tr><td colSpan={6} className="border-b border-ds-divider bg-ds-input px-[18px] pb-3.5 pl-16 pt-2">
        <div className="overflow-x-auto rounded-ds-btn-lg border border-ds-border bg-ds-surface"><div className="min-w-[920px]"><ParcelHeader />{items.map(item => <ParcelRow key={item.id} item={item} onOpen={() => setSelected(item)} />)}</div></div>
      </td></tr> : null}
    </Fragment>;
  };
  const weekRows = (list: ReceivableItem[]) => receivableWeeks(list).map((week, index) => {
    const key = `${month}:${week.from}`;
    const open = openWeeks.has(key);
    const days = [...new Set(week.items.map(item => item.dueDate))];
    return <Fragment key={key}>
      <tr className="cursor-pointer hover:[&>td]:bg-ds-muted" onClick={() => toggle(key)} aria-expanded={open}>
        <td className={`${td} py-3.5`}><span className="inline-flex items-center gap-1">
          {open ? <ChevronDown aria-hidden="true" className="h-4 w-4 text-ds-ink-faint" /> : <ChevronRight aria-hidden="true" className="h-4 w-4 text-ds-ink-faint" />}
          <strong className="inline-block min-w-[92px] font-extrabold text-ds-ink">Semana {index + 1}</strong>
          <span className="border-l-2 border-ds-ink-faint pl-3 text-[12.5px] font-semibold leading-none text-ds-ink-muted">{range(week.first, week.last)}</span>
        </span></td>
        <TotalsCells totals={week.totals} className={`${td} py-3.5`} />
      </tr>
      {open ? days.map(date => dayRows(week.items.filter(item => item.dueDate === date), date)) : null}
    </Fragment>;
  });

  return <section aria-label="A receber" className="space-y-4">
    {loading ? <p role="status" className="text-sm text-ds-ink-muted">Carregando carteira…</p> : null}
    {error ? <p role="alert" className="text-sm font-semibold text-ds-danger">{error}</p> : null}
    {result?.status === "not_synchronized" ? <p role="status" className="rounded-ds-btn-lg border border-dashed border-ds-border-input px-4 py-8 text-center text-sm text-ds-ink-muted">A primeira sincronização da carteira ainda não foi concluída.</p> : null}
    {result?.status === "synchronized" ? <>
      {result.stale ? <p role="alert" className="rounded-xl border border-ds-alert-border bg-ds-alert-bg px-3 py-2.5 text-sm text-ds-alert-ink">A atualização diária está atrasada. O último arquivo esperado é de {date(result.latestAvailableDate)}.</p> : null}
      {result.summary && (result.summary.reviewCount > 0 || result.summary.unsupportedCaptureCount > 0 || (result.missingDates?.length ?? 0) > 0)
        ? <p role="alert" className="rounded-xl border border-ds-alert-border bg-ds-alert-bg px-3 py-2.5 text-sm text-ds-alert-ink">Há {result.summary.reviewCount} parcela(s) em revisão, {result.summary.unsupportedCaptureCount} captura(s) sem parcelas e {result.missingDates?.length ?? 0} arquivo(s) ausente(s). O total não está confirmado.</p> : null}
      {total.count && total.feeUnknown === total.count ? <p role="status" className="rounded-xl border border-ds-border bg-ds-info-bg px-3 py-2.5 text-sm text-ds-info">Cartão e taxa de cada parcela aparecem depois da próxima sincronização automática da carteira.</p> : null}

      <section className="rounded-ds-card border border-ds-border bg-ds-surface">
        <header className="flex flex-wrap items-end gap-3 px-[18px] pb-3 pt-4">
          <div>
            <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Carteira até {date(result.asOf)} · vendas desde {date(result.firstCaptureDate)}</p>
            <h2 className="mt-0.5 text-[15.5px] font-extrabold text-ds-ink">{centsLabel(receivableTotals(shown).netCents)} a receber{month === ALL ? "" : month === CUSTOM ? periodText(from, through) : ` em ${monthName(month)}`}</h2>
          </div>
          <div role="group" aria-label="Mês do vencimento" className="ml-auto flex max-w-full overflow-x-auto"><div className="inline-flex rounded-ds-md bg-ds-seg p-[3px]">
            {[ALL, ...months].map(value => <button key={value} type="button" aria-pressed={month === value} onClick={() => { setMonth(value); setOpenWeeks(new Set()); setOpenDays(new Set()); }}
              className={`h-8 whitespace-nowrap rounded-ds-sm px-3.5 text-[13px] font-bold ${month === value ? "bg-ds-surface text-ds-ink shadow-[0_1px_2px_rgba(0,0,0,.08)]" : "text-ds-ink-muted hover:text-ds-ink"}`}>
              {value === ALL ? "Tudo" : `${MONTHS[Number(value.slice(5)) - 1]}${value.slice(0, 4) !== String(new Date().getFullYear()) ? ` ${value.slice(2, 4)}` : ""}`}
            </button>)}
            <button type="button" aria-pressed={month === CUSTOM} onClick={() => { setMonth(CUSTOM); setOpenWeeks(new Set()); setOpenDays(new Set()); }}
              className={`h-8 whitespace-nowrap rounded-ds-sm px-3.5 text-[13px] font-bold ${month === CUSTOM ? "bg-ds-surface text-ds-ink shadow-[0_1px_2px_rgba(0,0,0,.08)]" : "text-ds-ink-muted hover:text-ds-ink"}`}>Personalizado</button>
          </div></div>
        </header>
        {month === CUSTOM ? <div className="flex flex-wrap items-end gap-3 px-[18px] pb-3.5">
          <label className="grid gap-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Vencimento de<Input aria-label="Vencimento a partir de" type="date" className="w-[170px] normal-case tracking-normal" value={from} max={through || undefined} onChange={event => { setFrom(event.target.value); setOpenWeeks(new Set()); setOpenDays(new Set()); }} /></label>
          <label className="grid gap-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">até<Input aria-label="Vencimento até" type="date" className="w-[170px] normal-case tracking-normal" value={through} min={from || undefined} onChange={event => { setThrough(event.target.value); setOpenWeeks(new Set()); setOpenDays(new Set()); }} /></label>
          <div className="flex gap-2 pb-0.5">{[["7 dias", 7], ["15 dias", 15], ["30 dias", 30]].map(([label, days]) => <button key={label} type="button" onClick={() => { const start = result?.asOf ?? ""; setFrom(start); setThrough(start ? addDays(start, days as number) : ""); }} className="h-8 rounded-full border border-ds-border-input bg-ds-surface px-3 text-[12.5px] font-bold text-ds-ink-2 hover:bg-ds-muted">Próximos {label}</button>)}</div>
        </div> : null}

        <StonePositionBar position={result.rightsPosition ?? null} className="px-[18px] pb-[18px]" />

        <div className="overflow-x-auto"><table className="w-full border-separate border-spacing-0">
          <thead><tr><th className={th}>Semana / dia do vencimento</th><th className={`${th} text-right`}>Parcelas</th><th className={`${th} text-right`}>Bruto</th><th className={`${th} text-right`}>Taxa</th><th className={`${th} text-right`}>Líquido a receber</th><th className={th}>Situação</th></tr></thead>
          <tbody>{!shown.length ? <tr><td colSpan={6} className={`${td} py-8 text-center text-ds-ink-muted`}>Nenhuma parcela aberta neste recorte. Isso não comprova ausência de recebíveis.</td></tr>
            : month === ALL ? months.map(value => {
              const list = items.filter(item => receivableMonth(item.dueDate) === value);
              return <Fragment key={value}>
                {/* Faixa do mês: fundo neutro do sistema, nome maior e contagem; as semanas seguem brancas. */}
                <tr><td className={`${td} border-t-2 border-t-ds-ink-faint bg-ds-muted py-3.5`}>
                    <span className="text-[16px] font-extrabold capitalize text-ds-ink">{monthName(value)}</span></td>
                  <TotalsCells totals={receivableTotals(list)} className={`${td} border-t-2 border-t-ds-ink-faint bg-ds-muted py-3.5`} /></tr>
                {weekRows(list)}
              </Fragment>;
            }) : weekRows(shown)}</tbody>
        </table></div>
        <p className="border-t border-ds-divider px-[18px] py-3 text-[12.5px] text-ds-ink-muted">{result.summary?.paidCount ?? 0} parcela(s) já pagas pela Stone saíram da carteira. Previsão da Stone: não confirma saldo na conta Stone; o pagamento aparece na aba Recebido.</p>
      </section>
    </> : null}

    <SidePanel open={selected !== null} onOpenChange={value => { if (!value) setSelected(null); }} kicker="Parcela a receber"
      title={selected ? `${itemTitle(selected)}${selected.installmentCount && selected.installmentCount > 1 ? ` ${selected.installment}/${selected.installmentCount}` : ""}` : ""}
      subtitle={selected ? `Venda de ${date(selected.saleDate)} · vence ${weekday(selected.dueDate)} ${date(selected.dueDate)}` : undefined}>
      {selected ? <PanelSection title="Stone · parcela" aside="carteira sincronizada">
        <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2 text-[13px]">
          {[["Transação", "AcquirerTransactionKey", selected.transactionId], ["Vencimento", "PrevisionPaymentDate", date(selected.dueDate)],
            ["Bruto", "GrossAmount", centsLabel(selected.grossCents)], ["Líquido", "NetAmount", centsLabel(selected.netCents)],
            ["Taxa", "MdrAmount", selected.feeCents === null ? "—" : `${centsLabel(selected.feeCents)} (${rateLabel(parcelFeeRate(selected))})${selected.feeSource === "derived" ? " · proposta" : selected.feeSource === "exact" ? " · do líquido exato" : ""}`],
            ["Situação", null, selected.status === "review" ? `Conferir${selected.reason ? `: ${selected.reason}` : ""}` : "A receber"]].map(([label, field, value]) =>
            <div key={label as string}><dt className="text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-ds-ink-faint">{label}{field ? <span className="ml-1 tabular-nums font-medium normal-case tracking-normal">{field}</span> : null}</dt>
              <dd className="mt-0.5 wrap-anywhere font-semibold text-ds-ink">{value}</dd></div>)}
        </dl>
        {selected.feeSource === "derived" ? <p className="text-xs font-semibold text-ds-alert-ink">Verificar taxa: a Stone não mandou o MDR desta parcela. Taxa proposta = bruto − líquido.</p> : null}
      </PanelSection> : null}
    </SidePanel>
  </section>;
}
