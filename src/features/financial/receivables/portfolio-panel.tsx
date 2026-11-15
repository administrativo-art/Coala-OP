"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { SidePanel, PanelSection } from "@/components/patterns/side-panel";
import { StatusPill } from "@/components/ui/status-pill";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { AuthenticatedApiError } from "@/lib/authenticated-api-client";
import type { parseStoneWalletPosition } from "@/lib/integrations/stone/wallet-position-parser";
import { centsLabel, rateLabel } from "../receipts-reconciliation/stone-account-format";
import { parcelFeeRate, receiptModalityLabel } from "../receipts-reconciliation/stone-account";
import type { StonePortfolioRow } from "./portfolio-projection";
import {
  natureLabel,
  receivableItems,
  receivableMonth,
  receivableMonths,
  receivableTotals,
  receivableWeeks,
  rightsByNature,
  type NatureKey,
  type ReceivableItem,
  type ReceivableTotals,
} from "./receivable-view";

type RightsPosition = Pick<ReturnType<typeof parseStoneWalletPosition>,
  "referenceDate" | "status" | "rows" | "unknownNatureCount">;

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
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MONTHS_LONG = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
// Cores categóricas validadas (dataviz validate_palette: PASS), na ordem fixa das naturezas.
const NATURE_COLOR: Record<NatureKey, string> = {
  regular: "#2a78d6", stone_anticipation: "#eb6834", warranty: "#1baf7a", ownership_assignment: "#eda100", unknown: "#5f646c",
};
const th = "whitespace-nowrap border-y border-ds-divider bg-ds-muted px-[18px] py-2.5 text-left text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint";
const td = "whitespace-nowrap border-b border-ds-divider px-[18px] py-2.5 align-middle text-[13.5px]";
const date = (value: string | null) => value ? value.split("-").reverse().join("/") : "—";
const short = (value: string | null) => value ? `${value.slice(8, 10)}/${value.slice(5, 7)}` : "—";
const weekday = (value: string) => ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][new Date(`${value}T12:00:00Z`).getUTCDay()];
const monthName = (month: string) => `${MONTHS_LONG[Number(month.slice(5)) - 1]}${month.slice(0, 4) !== String(new Date().getFullYear()) ? ` de ${month.slice(0, 4)}` : ""}`;
const range = (first: string, last: string) => {
  const name = MONTHS[Number(first.slice(5, 7)) - 1];
  return first === last ? `${Number(first.slice(8))} de ${name}` : `${Number(first.slice(8))} a ${Number(last.slice(8))} de ${name}`;
};
const addDays = (value: string, days: number) => { const d = new Date(`${value}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

function Summary({ totals }: { totals: ReceivableTotals }) {
  return <span className="flex flex-wrap justify-end gap-x-5 gap-y-1 text-[12.5px] text-ds-ink-muted">
    <span>Bruto <b className="ml-1 tabular-nums font-bold text-ds-ink">{centsLabel(totals.grossCents)}</b></span>
    <span>Taxa <b className="ml-1 tabular-nums font-bold text-ds-ink">{totals.feeUnknown === totals.count ? "—" : centsLabel(totals.feeCents)}</b></span>
    <span>Líquido <b className="ml-1 tabular-nums font-bold text-ds-ink">{centsLabel(totals.netCents)}</b></span>
  </span>;
}

function itemTitle(item: ReceivableItem) {
  if (!item.brand || !item.modality) return "Cartão (aguardando sincronização)";
  return `${item.brand} · ${receiptModalityLabel(item.modality)}`;
}

/**
 * A receber: o que a Stone ainda deve pagar na conta Stone. Abre em "Tudo"; as abas de mês filtram a tabela,
 * as semanas abrem nas parcelas e os cartões da posição Stone abrem o detalhe por arranjo.
 */
export function StonePortfolioPanel({ stoneCode, onIndicators }: { stoneCode: string; onIndicators?: (value: ReceivableIndicators) => void }) {
  const api = useAuthenticatedApi();
  const [result, setResult] = useState<PortfolioResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [month, setMonth] = useState(ALL);
  const [openWeeks, setOpenWeeks] = useState<Set<string>>(new Set());
  const [nature, setNature] = useState<NatureKey | null>(null);
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
  const shown = month === ALL ? items : items.filter(item => receivableMonth(item.dueDate) === month);
  const natures = useMemo(() => result?.rightsPosition?.status === "reported" ? rightsByNature(result.rightsPosition.rows) : [], [result]);
  const natureTotal = natures.reduce((sum, item) => sum + item.cents, 0);
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
  const weekRows = (list: ReceivableItem[]) => receivableWeeks(list).map(week => {
    const key = `${month}:${week.from}`;
    const open = openWeeks.has(key);
    return <Fragment key={key}>
      <tr className="cursor-pointer hover:[&>td]:bg-ds-muted" onClick={() => toggle(key)} aria-expanded={open}>
        <td colSpan={4} className={`${td} py-3`}><span className="inline-flex items-center gap-1">
          {open ? <ChevronDown aria-hidden="true" className="h-4 w-4 text-ds-ink-faint" /> : <ChevronRight aria-hidden="true" className="h-4 w-4 text-ds-ink-faint" />}
          <strong className="inline-block min-w-[150px] font-extrabold text-ds-ink">Semana de {Number(week.from.slice(8))} {MONTHS[Number(week.from.slice(5, 7)) - 1]}</strong>
          <span className="border-l-2 border-ds-ink-faint pl-3 text-[12.5px] font-semibold leading-none text-ds-ink-muted">{range(week.first, week.last)}</span>
          <span className="ml-2 text-xs text-ds-ink-faint">{week.totals.count} parcela{week.totals.count > 1 ? "s" : ""}</span>
        </span></td>
        <td colSpan={4} className={`${td} py-3`}><Summary totals={week.totals} /></td>
      </tr>
      {open ? week.items.map(item => <tr key={item.id} className="cursor-pointer hover:[&>td]:bg-ds-muted" onClick={() => setSelected(item)}>
        <td className={`${td} pl-11 tabular-nums`}>{weekday(item.dueDate)} {short(item.dueDate)}</td>
        <td className={`${td} tabular-nums`}>{short(item.saleDate)}</td>
        <td className={td}>{itemTitle(item)}</td>
        <td className={`${td} text-right tabular-nums`}>{item.installment}/{item.installmentCount ?? "—"}</td>
        <td className={`${td} text-right tabular-nums`}>{centsLabel(item.grossCents)}</td>
        <td className={`${td} text-right tabular-nums`}>{item.feeCents === null ? "—" : rateLabel(parcelFeeRate(item))}
          {item.feeSource === "derived" ? <span className="mt-1 block"><StatusPill variant="warn" title="A Stone não mandou o MDR; taxa proposta = bruto − líquido">Verificar taxa</StatusPill></span> : null}</td>
        <td className={`${td} text-right tabular-nums font-bold`}>{centsLabel(item.netCents)}</td>
        <td className={td}>{item.status === "review" ? <StatusPill variant="warn" title={item.reason ?? undefined}>Conferir</StatusPill> : <StatusPill variant="neutral">A receber</StatusPill>}</td>
      </tr>) : null}
    </Fragment>;
  });
  const selectedNature = natures.find(item => item.key === nature) ?? null;

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
            <h2 className="mt-0.5 text-[15.5px] font-extrabold text-ds-ink">{centsLabel(receivableTotals(shown).netCents)} a receber{month === ALL ? "" : ` em ${monthName(month)}`}</h2>
          </div>
          <div role="group" aria-label="Mês do vencimento" className="ml-auto flex max-w-full overflow-x-auto"><div className="inline-flex rounded-ds-md bg-ds-seg p-[3px]">
            {[ALL, ...months].map(value => <button key={value} type="button" aria-pressed={month === value} onClick={() => { setMonth(value); setOpenWeeks(new Set()); }}
              className={`h-8 whitespace-nowrap rounded-ds-sm px-3.5 text-[13px] font-bold ${month === value ? "bg-ds-surface text-ds-ink shadow-[0_1px_2px_rgba(0,0,0,.08)]" : "text-ds-ink-muted hover:text-ds-ink"}`}>
              {value === ALL ? "Tudo" : `${MONTHS[Number(value.slice(5)) - 1]}${value.slice(0, 4) !== String(new Date().getFullYear()) ? ` ${value.slice(2, 4)}` : ""}`}
            </button>)}
          </div></div>
        </header>

        <div className="space-y-3 px-[18px] pb-[18px]">
          {result.rightsPosition?.status === "reported" && natureTotal > 0 ? <>
            <div className="flex h-[22px] gap-0.5 overflow-hidden rounded-full bg-ds-surface" role="img" aria-label="Posição da Stone por natureza">
              {natures.filter(item => item.cents > 0).map(item => <i key={item.key} title={`${natureLabel[item.key]}: ${centsLabel(item.cents)}`} className="block h-full" style={{ width: `${(item.cents / natureTotal * 100).toFixed(2)}%`, background: NATURE_COLOR[item.key] }} />)}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {natures.map(item => <button key={item.key} type="button" onClick={() => setNature(item.key)}
                className="rounded-ds-btn-lg border border-ds-border bg-ds-surface px-4 py-3 text-left transition-colors hover:bg-ds-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-accent-ink">
                <span className="flex items-center gap-1.5 text-[13px] text-ds-ink-2"><i aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: NATURE_COLOR[item.key] }} />{natureLabel[item.key]}</span>
                <span className="mt-1 block tabular-nums text-[19px] font-bold text-ds-ink">{centsLabel(item.cents)}</span>
                <span className="block text-xs text-ds-ink-muted">{Math.round(item.cents / natureTotal * 100)}% da posição · ver detalhe</span>
              </button>)}
            </div>
            <p className="text-xs text-ds-ink-muted">Posição informada pela Stone em {date(result.rightsPosition.referenceDate)}, para a carteira toda. A Stone não separa essa posição por mês nem diz quais parcelas estão antecipadas, em garantia ou cedidas.</p>
          </> : <p className="text-xs text-ds-ink-muted">{result.rightsPosition?.status === "not_provided" ? "A Stone não incluiu a posição por natureza no último arquivo. Isso não comprova saldo zero."
            : result.rightsPosition?.status === "empty" ? "A posição por natureza veio vazia no último arquivo. Isso não comprova saldo zero."
              : "A posição por natureza (livre, antecipado, garantia, cedido) ainda não foi lida."}</p>}
        </div>

        <div className="overflow-x-auto"><table className="w-full border-separate border-spacing-0">
          <thead><tr><th className={th}>Vencimento</th><th className={th}>Venda</th><th className={th}>Cartão</th><th className={`${th} text-right`}>Parcela</th><th className={`${th} text-right`}>Bruto</th><th className={`${th} text-right`}>Taxa</th><th className={`${th} text-right`}>Líquido</th><th className={th}>Situação</th></tr></thead>
          <tbody>{!shown.length ? <tr><td colSpan={8} className={`${td} py-8 text-center text-ds-ink-muted`}>Nenhuma parcela aberta neste recorte. Isso não comprova ausência de recebíveis.</td></tr>
            : month === ALL ? months.map(value => {
              const list = items.filter(item => receivableMonth(item.dueDate) === value);
              return <Fragment key={value}>
                <tr><td colSpan={4} className={`${td} border-t-2 border-t-ds-ink-faint bg-ds-surface py-3 font-extrabold capitalize text-ds-ink`}>{monthName(value)}</td>
                  <td colSpan={4} className={`${td} border-t-2 border-t-ds-ink-faint bg-ds-surface py-3`}><Summary totals={receivableTotals(list)} /></td></tr>
                {weekRows(list)}
              </Fragment>;
            }) : weekRows(shown)}</tbody>
        </table></div>
        <p className="border-t border-ds-divider px-[18px] py-3 text-[12.5px] text-ds-ink-muted">{result.summary?.paidCount ?? 0} parcela(s) já pagas pela Stone saíram da carteira. Previsão da Stone: não confirma saldo na conta Stone; o pagamento aparece na aba Recebido.</p>
      </section>
    </> : null}

    <SidePanel open={selectedNature !== null} onOpenChange={value => { if (!value) setNature(null); }} kicker="Posição da Stone por natureza"
      title={selectedNature ? `${natureLabel[selectedNature.key]} · ${centsLabel(selectedNature.cents)}` : ""}
      subtitle={result?.rightsPosition ? `Informado em ${date(result.rightsPosition.referenceDate)} · carteira toda` : undefined}>
      {selectedNature ? <PanelSection title="Por bandeira e produto" aside={`${selectedNature.rows.length} linha(s)`}>
        {selectedNature.rows.length ? <ul className="divide-y divide-ds-divider">{selectedNature.rows.map(row => <li key={`${row.label}:${row.category}`} className="flex items-baseline justify-between gap-3 py-2 text-[13px]">
          <span><span className="font-semibold text-ds-ink">{row.label}</span><span className="block text-xs text-ds-ink-faint">{row.category}</span></span>
          <span className="tabular-nums font-bold">{centsLabel(row.cents)}</span></li>)}</ul>
          : <p className="text-sm text-ds-ink-muted">Nada informado nesta natureza.</p>}
        <p className="text-xs text-ds-ink-muted">A Stone informa o total por arranjo; não diz quais parcelas da tabela compõem este valor.</p>
      </PanelSection> : null}
    </SidePanel>

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
