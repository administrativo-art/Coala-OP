"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { AuthenticatedApiError } from "@/lib/authenticated-api-client";
import { LiftRow } from "@/components/patterns/lift-row";
import { Segmented } from "@/components/patterns/segmented";
import { SidePanel } from "@/components/patterns/side-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/status-pill";
import type { MappingView } from "../agent/configuration";
import type { StoneAccountMonthResult, StoneAccountSaleResult } from "./reconciliation.server";
import {
  receiptGroupKey,
  receiptPeriodDates,
  saleAuditChecks,
  saleAuditVerdict,
  summarizeReceiptDays,
  summarizeReceiptGroups,
  type ReceiptGroup,
  type ReceiptParcel,
  type SaleAudit,
} from "./stone-account";
import { centsLabel, dayLabel, dayReasonLabel, parcelStatusView, parcelTitle, rateLabel, weekdayLabel } from "./stone-account-format";
import { SaleAuditDetail, SaleAuditSummary } from "./sale-audit-view";

type SourceFilter = "all" | "pix" | "card";
type Panel =
  | { mode: "list"; title: string; parcelIds: string[] }
  | { mode: "sale"; parcelId: string; detail: boolean; back: { title: string; parcelIds: string[] } | null };
export type StoneAccountIndicators = { expectedCents: number; paidCents: number; feeCents: number; pendingCount: number; pdvAttentionCount: number } | null;

const PENDING = new Set(["unpaid", "paid_late", "chargeback", "review", "missing_file"]);
const th = "whitespace-nowrap border-y border-ds-divider bg-ds-muted px-[18px] py-2.5 text-left text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint";
const td = "border-b border-ds-divider px-[18px] py-3 align-top text-[13.5px]";

function currentMonth() {
  const now = new Date(Date.now() - 8 * 3_600_000 - 86_400_000);
  return now.toISOString().slice(0, 7);
}
function monthRange(month: string) {
  const [year, value] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, value, 0)).getUTCDate();
  return { from: `${month}-01`, through: `${month}-${String(last).padStart(2, "0")}` };
}

function ParcelRow({ parcel, verdict, onOpen }: { parcel: ReceiptParcel; verdict?: { label: string; tone: "ok" | "danger" | "warn" | "info" }; onOpen: () => void }) {
  const status = parcelStatusView[parcel.status];
  return <LiftRow table onClick={onOpen} className="flex items-center justify-between gap-3">
    <span className="min-w-0">
      <span className="text-sm font-extrabold text-ds-ink">{parcelTitle(parcel)}</span>
      <span className="ml-2 text-xs text-ds-ink-faint">venda <span className="font-ds-mono">{dayLabel(parcel.saleDate)} {parcel.saleTime?.slice(0, 5) ?? ""}</span></span>
      <span className="block text-xs text-ds-ink-muted">previsto {dayLabel(parcel.expectedDate)}{parcel.paidDate ? ` · pago ${dayLabel(parcel.paidDate)}` : ""}{parcel.feeCents !== null && parcel.grossCents ? ` · taxa ${rateLabel(parcel.feeCents / parcel.grossCents)}` : ""}</span>
    </span>
    <span className="shrink-0 text-right">
      <span className="font-ds-mono text-[13.5px] font-bold">{centsLabel(parcel.paidNetCents ?? parcel.expectedNetCents)}</span>
      <span className="mt-1 flex justify-end gap-1"><StatusPill variant={status.variant}>{status.label}</StatusPill>{verdict && verdict.tone !== "ok" && verdict.tone !== "info" ? <StatusPill variant={verdict.tone}>{verdict.label}</StatusPill> : null}</span>
    </span>
  </LiftRow>;
}

/** Conciliação de recebimentos, 1ª parte: o que a Stone previu × o que pagou na conta Stone. */
export function StoneAccountReceipts({ mapping, stoneCode, onIndicators }: { mapping: MappingView; stoneCode: string; onIndicators: (value: StoneAccountIndicators) => void }) {
  const api = useAuthenticatedApi();
  const [month, setMonth] = useState(currentMonth);
  const [result, setResult] = useState<StoneAccountMonthResult | null>(null);
  const [filter, setFilter] = useState<SourceFilter>("all");
  const [openDays, setOpenDays] = useState<Set<string>>(new Set());
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState<Panel | null>(null);
  const [audits, setAudits] = useState<Record<string, SaleAudit | { error: string } | "loading">>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  const parcels = useMemo(() => (result?.parcels ?? []).filter(parcel => filter === "all" || (filter === "pix" ? parcel.source === "pix" : parcel.source === "card")), [result, filter]);
  const byId = useMemo(() => new Map((result?.parcels ?? []).map(parcel => [parcel.id, parcel])), [result]);
  const days = useMemo(() => result ? summarizeReceiptDays(parcels, receiptPeriodDates(result.period.from, result.period.through), result.coverage.missingDates).reverse() : [], [result, parcels]);
  const groups = useMemo(() => result ? summarizeReceiptGroups(parcels, result.period.from, result.period.through, result.latestPublished) : [], [result, parcels]);
  const usualRates = useMemo(() => new Map(result ? summarizeReceiptGroups(result.parcels, result.period.from, result.period.through, result.latestPublished).map(group => [group.key, group.usualRate]) : []), [result]);

  useEffect(() => {
    if (!result) { onIndicators(null); return; }
    onIndicators({
      expectedCents: days.reduce((sum, day) => sum + day.expectedCents, 0),
      paidCents: days.reduce((sum, day) => sum + (day.paidCents ?? 0), 0),
      feeCents: groups.filter(group => !group.parentKey).reduce((sum, group) => sum + group.feeCents, 0),
      pendingCount: parcels.filter(parcel => PENDING.has(parcel.status)).length,
      pdvAttentionCount: result.coverage.pdvAttentionCount,
    });
  }, [result, days, groups, parcels, onIndicators]);

  const run = async () => {
    if (busy || !stoneCode || !/^\d{4}-\d{2}$/.test(month)) return;
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setError("");
    try {
      const next = await api<StoneAccountMonthResult>("/api/financial/stone-receipts/reconcile", { method: "POST", json: { view: "month", kioskId: mapping.kioskId, stoneCode, ...monthRange(month) }, signal: controller.signal });
      if (next.scope.mappingId !== mapping.id || next.scope.kioskId !== mapping.kioskId || next.scope.stoneCode !== stoneCode) {
        throw new AuthenticatedApiError("O vínculo mudou durante a consulta. Recarregue a página e tente novamente.", 409, null);
      }
      setResult(next); setPanel(null); setAudits({}); setOpenDays(new Set()); setOpenGroups(new Set());
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof AuthenticatedApiError ? caught.message : "Não foi possível conferir os recebimentos.");
    } finally { if (active.current === controller) { active.current = null; setBusy(false); } }
  };

  const openSale = (parcelId: string, back: Panel | null) => {
    const parcel = byId.get(parcelId);
    if (!parcel || !parcel.saleDate) return;
    setPanel({ mode: "sale", parcelId, detail: false, back: back?.mode === "list" ? { title: back.title, parcelIds: back.parcelIds } : null });
    if (audits[parcel.saleId] && audits[parcel.saleId] !== "loading" && !("error" in (audits[parcel.saleId] as object))) return;
    setAudits(current => ({ ...current, [parcel.saleId]: "loading" }));
    void api<StoneAccountSaleResult>("/api/financial/stone-receipts/reconcile", { method: "POST", json: {
      view: "sale", kioskId: mapping.kioskId, stoneCode, saleDate: parcel.saleDate, source: parcel.source, saleId: parcel.saleId,
    } }).then(next => setAudits(current => ({ ...current, [parcel.saleId]: next.audit })))
      .catch(caught => setAudits(current => ({ ...current, [parcel.saleId]: { error: caught instanceof AuthenticatedApiError ? caught.message : "Não foi possível carregar a auditoria da venda." } })));
  };

  const selectedParcel = panel?.mode === "sale" ? byId.get(panel.parcelId) ?? null : null;
  const audit = selectedParcel ? audits[selectedParcel.saleId] : undefined;
  const loadedAudit = audit && audit !== "loading" && !("error" in audit) ? audit : null;
  const checks = loadedAudit && selectedParcel ? saleAuditChecks(loadedAudit, usualRates.get(receiptGroupKey(selectedParcel)) ?? null) : null;
  const verdict = checks ? saleAuditVerdict(checks) : null;
  const visibleGroups = groups.filter(group => !group.parentKey || openGroups.has(group.parentKey));
  const toggle = (set: Set<string>, value: string) => { const next = new Set(set); if (next.has(value)) next.delete(value); else next.add(value); return next; };
  const openGroup = (group: ReceiptGroup) => {
    if (group.modality === "installment" && !group.parentKey) { setOpenGroups(current => toggle(current, group.key)); return; }
    const parent = group.parentKey ? groups.find(item => item.key === group.parentKey) : null;
    setPanel({ mode: "list", title: parent ? `${parent.label} · ${group.label}` : group.label, parcelIds: group.parcelIds });
  };

  return <div className="space-y-[18px]">
    <section className="rounded-ds-card border border-ds-border bg-ds-surface p-4 sm:px-[18px]">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Competência
          <Input aria-label="Competência dos recebimentos" type="month" value={month} onChange={event => { setMonth(event.target.value); setResult(null); }} className="w-[180px] normal-case tracking-normal" />
        </label>
        <Button type="button" variant="primary-page" size="md" disabled={busy || !stoneCode || !month} onClick={() => void run()}>
          <RefreshCw aria-hidden="true" className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />{busy ? "Conferindo…" : "Conferir recebimentos"}
        </Button>
        {result ? <span className="ml-auto inline-flex h-7 items-center rounded-full bg-ds-ok-bg px-3 text-xs font-bold text-ds-ok">
          Arquivos Stone até {dayLabel(result.period.through)}{result.coverage.missingDates.length ? ` · faltam ${result.coverage.missingDates.length}` : ""}
        </span> : null}
      </div>
      <p className="mt-2 text-xs text-ds-ink-muted">Lê os arquivos diários da Stone, a carteira sincronizada, o Pix e o fechamento da Conciliação de vendas. Não cria lançamentos.</p>
      {error ? <p role="alert" className="mt-2 text-sm font-semibold text-ds-danger">{error}</p> : null}
    </section>

    {result ? <>
      <div className="flex flex-wrap items-center gap-3">
        <Segmented aria-label="Meio de pagamento" value={filter} onChange={setFilter} options={[{ value: "all", label: "Pix + cartão" }, { value: "pix", label: "Pix" }, { value: "card", label: "Cartão" }]} />
        <span className="ml-auto flex gap-4 text-[13px] font-bold"><a className="text-ds-accent-ink hover:underline" href="#dia-a-dia">Dia a dia</a><a className="text-ds-accent-ink hover:underline" href="#por-cartao">Por cartão e parcelas</a></span>
      </div>

      <section id="dia-a-dia" className="scroll-mt-24 rounded-ds-card border border-ds-border bg-ds-surface">
        <header className="px-[18px] pb-3 pt-4">
          <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Etapa 04 · previsto × pago</p>
          <h2 className="mt-0.5 text-[15.5px] font-extrabold text-ds-ink">Dia a dia · previsto × caiu na conta Stone</h2>
          <p className="text-[12.5px] text-ds-ink-muted">Clique no dia para ver as parcelas; clique na parcela para a auditoria completa da venda.</p>
        </header>
        <div className="overflow-x-auto"><table className="w-full border-separate border-spacing-0">
          <thead><tr><th className={th}>Dia do pagamento</th><th className={`${th} text-right`}>Parcelas</th><th className={`${th} text-right`}>Previsto pela Stone</th><th className={`${th} text-right`}>Caiu na conta Stone</th><th className={`${th} text-right`}>Diferença</th><th className={th}>Explicação</th></tr></thead>
          <tbody>{days.map(day => {
            const open = openDays.has(day.date);
            const attention = day.missingFile || (day.differenceCents !== null && day.differenceCents !== 0);
            const dayParcels = parcels.filter(parcel => parcel.expectedDate === day.date || parcel.paidDate === day.date);
            return <Fragment key={day.date}>
              <tr className={`cursor-pointer hover:[&>td]:bg-ds-muted ${open ? "[&>td]:bg-ds-accent-row" : attention ? "[&>td]:bg-ds-alert-bg/50" : ""}`} onClick={() => setOpenDays(current => toggle(current, day.date))} aria-expanded={open}>
                <td className={td}><span className="inline-flex items-center gap-1 font-extrabold">{open ? <ChevronDown aria-hidden="true" className="h-4 w-4 text-ds-ink-faint" /> : <ChevronRight aria-hidden="true" className="h-4 w-4 text-ds-ink-faint" />}{weekdayLabel(day.date)} {dayLabel(day.date)}</span></td>
                <td className={`${td} text-right font-ds-mono`}>{day.parcelCount}</td>
                <td className={`${td} text-right font-ds-mono`}>{centsLabel(day.expectedCents)}</td>
                <td className={`${td} text-right font-ds-mono`}>{day.missingFile ? "?" : centsLabel(day.paidCents)}</td>
                <td className={`${td} text-right font-ds-mono ${day.differenceCents ? "font-bold text-ds-danger" : "text-ds-ink-faint"}`}>{day.missingFile ? "?" : day.differenceCents ? centsLabel(day.differenceCents) : "—"}</td>
                <td className={`${td} text-[12.5px]`}>{day.missingFile ? <StatusPill variant="warn">Arquivo Stone não recebido</StatusPill>
                  : day.reasons.length ? day.reasons.map(reason => `${reason.cents >= 0 ? "+" : "−"}${centsLabel(Math.abs(reason.cents))} ${dayReasonLabel[reason.kind]}`).join(" · ")
                    : day.parcelCount ? <StatusPill variant="ok">Bateu</StatusPill> : <span className="text-ds-ink-faint">sem parcelas</span>}</td>
              </tr>
              {open ? <tr><td colSpan={6} className="border-b border-ds-divider bg-ds-input px-[18px] pb-3.5 pl-10 pt-2">
                {dayParcels.length ? <div className="rounded-ds-btn-lg border border-ds-border bg-ds-surface">{dayParcels.map(parcel => <ParcelRow key={parcel.id} parcel={parcel} onOpen={() => openSale(parcel.id, null)} />)}</div>
                  : <p className="text-sm text-ds-ink-muted">Nenhuma parcela neste dia.</p>}
              </td></tr> : null}
            </Fragment>;
          })}</tbody>
        </table></div>
      </section>

      <section id="por-cartao" className="scroll-mt-24 rounded-ds-card border border-ds-border bg-ds-surface">
        <header className="px-[18px] pb-3 pt-4">
          <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Vendas da competência</p>
          <h2 className="mt-0.5 text-[15.5px] font-extrabold text-ds-ink">Por cartão e parcelas</h2>
          <p className="text-[12.5px] text-ds-ink-muted">Cada bandeira e modalidade tem sua taxa; no parcelado, a taxa muda com o número de parcelas.</p>
        </header>
        <div className="overflow-x-auto"><table className="w-full border-separate border-spacing-0">
          <thead><tr><th className={th}>Cartão</th><th className={`${th} text-right`}>Vendido (bruto)</th><th className={`${th} text-right`}>Taxa praticada</th><th className={`${th} text-right`}>Taxa (R$)</th><th className={`${th} text-right`}>Caiu na Stone</th><th className={`${th} text-right`}>A receber</th><th className={`${th} text-right`}>No prazo</th><th className={th}>Pendências</th></tr></thead>
          <tbody>{visibleGroups.length ? visibleGroups.map(group => {
            const parent = group.modality === "installment" && !group.parentKey;
            const varies = !parent && group.rateMin !== null && group.rateMax !== null && group.rateMax - group.rateMin > 0.0001;
            return <tr key={group.key} onClick={() => openGroup(group)} aria-expanded={parent ? openGroups.has(group.key) : undefined}
              className={`cursor-pointer hover:[&>td]:bg-ds-muted ${group.parentKey ? "[&>td]:bg-ds-input" : ""} ${parent && openGroups.has(group.key) ? "[&>td]:bg-ds-accent-row" : ""}`}>
              <td className={`${td} ${group.parentKey ? "pl-11" : ""}`}>
                <span className="inline-flex items-center gap-1 font-extrabold">{parent ? openGroups.has(group.key) ? <ChevronDown aria-hidden="true" className="h-4 w-4 text-ds-ink-faint" /> : <ChevronRight aria-hidden="true" className="h-4 w-4 text-ds-ink-faint" /> : null}{group.label}</span>
                <span className="block text-xs text-ds-ink-muted">{group.saleCount} venda(s)</span>
              </td>
              <td className={`${td} text-right font-ds-mono`}>{centsLabel(group.grossCents)}</td>
              <td className={`${td} text-right`}><span className="font-ds-mono font-semibold">{rateLabel(group.rate)}</span>
                {parent ? <span className="block text-xs text-ds-ink-faint">varia por nº de parcelas</span> : varies ? <span className="mt-1 block"><StatusPill variant="warn">! {rateLabel(group.rateMin)} a {rateLabel(group.rateMax)}</StatusPill></span> : null}</td>
              <td className={`${td} text-right font-ds-mono`}>{centsLabel(group.feeCents)}</td>
              <td className={`${td} text-right font-ds-mono text-ds-ok`}>{centsLabel(group.paidCents)}</td>
              <td className={`${td} text-right font-ds-mono`}>{centsLabel(group.toReceiveCents)}</td>
              <td className={`${td} text-right font-ds-mono`}>{group.onTimeRatio === null ? "—" : `${Math.round(group.onTimeRatio * 100)}%`}</td>
              <td className={td}>{group.pendingCount ? <StatusPill variant="danger">{group.pendingCount} pendente{group.pendingCount > 1 ? "s" : ""}</StatusPill> : <span className="text-ds-ink-faint">—</span>}</td>
            </tr>;
          }) : <tr><td colSpan={8} className={`${td} text-center text-ds-ink-muted`}>Nenhuma venda da competência nos arquivos lidos.</td></tr>}</tbody>
        </table></div>
        <p className="border-t border-ds-divider px-[18px] py-3 text-[12.5px] text-ds-ink-muted">Taxa contratada: ainda não há tabela oficial por bandeira, modalidade e parcelas no sistema; a coluna mostra a taxa praticada (MDR ÷ bruto).</p>
      </section>

      {result.limitations.length ? <ul className="space-y-1 rounded-ds-btn-lg border border-ds-border bg-ds-surface px-4 py-3 text-xs text-ds-ink-muted">{result.limitations.map(text => <li key={text}>{text}</li>)}</ul> : null}
    </> : !busy ? <div className="rounded-ds-card border border-dashed border-ds-border-input px-6 py-10 text-center text-sm text-ds-ink-muted">Escolha a competência e clique em <strong className="text-ds-ink">Conferir recebimentos</strong>.</div> : null}

    <SidePanel open={panel !== null} onOpenChange={open => { if (!open) setPanel(null); }} className="w-[920px]"
      kicker={panel?.mode === "list" ? "Parcelas do grupo" : panel?.detail ? "Detalhe do cruzamento" : "Auditoria da venda"}
      title={panel?.mode === "list" ? panel.title : selectedParcel ? `${parcelTitle(selectedParcel)} · ${centsLabel(loadedAudit?.stone.capturedCents ?? selectedParcel.grossCents)}` : ""}
      subtitle={panel?.mode === "list" ? `${panel.parcelIds.length} parcela(s) · clique para ver a auditoria da venda` : selectedParcel ? `Venda de ${dayLabel(selectedParcel.saleDate)}${selectedParcel.saleTime ? ` às ${selectedParcel.saleTime}` : ""} · ${mapping.kioskName} · StoneCode ${stoneCode}` : undefined}
      highlights={panel?.mode === "sale" && selectedParcel ? <>
        <span className="flex flex-col"><small className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-on-dark-muted">Taxa</small><span className="font-ds-mono text-[22px]">{selectedParcel.feeCents !== null && selectedParcel.grossCents ? rateLabel(selectedParcel.feeCents / selectedParcel.grossCents) : "—"}</span></span>
        <span className="flex flex-col"><small className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-on-dark-muted">Líquido</small><span className="font-ds-mono text-[22px]">{centsLabel(selectedParcel.paidNetCents ?? selectedParcel.expectedNetCents)}</span></span>
        {verdict ? <span className="ml-auto self-end"><StatusPill variant={verdict.tone}>{verdict.label}</StatusPill></span> : null}
      </> : undefined}>
      {panel?.mode === "list" ? <div className="rounded-ds-btn-lg border border-ds-border bg-ds-surface">
        {panel.parcelIds.map(id => byId.get(id)).filter((parcel): parcel is ReceiptParcel => Boolean(parcel)).map(parcel =>
          <ParcelRow key={parcel.id} parcel={parcel} onOpen={() => openSale(parcel.id, panel)} />)}
      </div> : null}
      {panel?.mode === "sale" ? <>
        {panel.back && !panel.detail ? <div><Button type="button" variant="ds-ghost" size="sm" onClick={() => setPanel({ mode: "list", ...panel.back! })}><ArrowLeft aria-hidden="true" className="h-4 w-4" />Voltar a {panel.back.title}</Button></div> : null}
        {audit === "loading" || audit === undefined ? <p role="status" className="text-sm text-ds-ink-muted">Lendo os arquivos da venda…</p>
          : "error" in audit ? <p role="alert" className="text-sm font-semibold text-ds-danger">{audit.error}</p>
            : checks ? panel.detail ? <SaleAuditDetail checks={checks} onBack={() => setPanel({ ...panel, detail: false })} />
              : <SaleAuditSummary audit={audit} checks={checks} onDetail={() => setPanel({ ...panel, detail: true })} /> : null}
      </> : null}
    </SidePanel>
  </div>;
}
