"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SalesMatchFact, SuggestedSalesReconciliationCase } from "./types";
import {
  bases, caseBadgeLabel, caseReason, caseTime, formatDateKey, channels, confidences, factLabel, isAttention, money,
  providerTransactionLabels, saleStatuses,
} from "./review-view";

export const toneBadge = {
  ok: "border-ds-border bg-ds-ok-bg text-ds-ok",
  bad: "border-ds-confirm-border bg-ds-danger-bg text-ds-danger",
  warn: "border-ds-alert-border bg-ds-warn-bg text-ds-warn",
  muted: "border-ds-border bg-ds-muted text-ds-ink-faint",
} as const;

export function StatusBadge({ tone, children }: { tone: keyof typeof toneBadge; children: React.ReactNode }) {
  return <span className={cn("inline-flex h-[22px] w-fit items-center gap-[5px] whitespace-nowrap rounded-full border px-[9px] text-[11px] font-bold", toneBadge[tone])}>{children}</span>;
}

function FactCard({ fact }: { fact: SalesMatchFact }) {
  const [copied, setCopied] = useState(false);
  const providerTransactionId = fact.identifiers.providerTransactionId;
  const identifiers = ([
    [providerTransactionLabels[fact.source], providerTransactionId],
    ["NSU", fact.identifiers.nsu === providerTransactionId ? null : fact.identifiers.nsu],
    ["Event ID Stone", fact.identifiers.providerEventId],
    ["Autorização", fact.identifiers.authorizationCode],
    ["Terminal", fact.identifiers.terminalId],
    ["Pedido", fact.identifiers.merchantOrderId],
  ] as const).filter(([, value]) => value);
  const copy = () => {
    void navigator.clipboard?.writeText(fact.id).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    }).catch(() => undefined);
  };
  return <div className="rounded-xl border border-ds-border bg-ds-input px-3 py-2.5">
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[12.5px] font-bold">{factLabel(fact)}</span>
      <span className="font-mono text-[12.5px] font-bold tabular-nums">{money(fact.grossAmountCents)}</span>
    </div>
    <div className="mt-[3px] flex justify-between gap-2 text-[11.5px]">
      <span className="text-ds-ink-faint">{new Date(fact.soldAt).toLocaleString("pt-BR")}</span>
      <span className={cn("font-bold", fact.status === "approved" ? "text-ds-ok" : "text-ds-danger")}>{saleStatuses[fact.status]}</span>
    </div>
    {identifiers.length ? <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-[3px] text-[11px]">
      {identifiers.map(([label, value]) => <div key={label} className="contents">
        <dt className="text-ds-ink-faint">{label}</dt>
        <dd className="break-all font-mono text-ds-ink-2">{value}</dd>
      </div>)}
    </dl> : null}
    {fact.adjustment ? <div className="mt-2 space-y-0.5 rounded-lg bg-ds-ok-bg px-2 py-1.5 text-[11px]">
      <p className="font-medium text-ds-ok">
        Cupom antes do cancelamento {money(fact.adjustment.originalAmountCents)} · cancelado −{money(fact.adjustment.cancelledAmountCents)} · final {money(fact.adjustment.finalAmountCents)}
      </p>
      {fact.adjustment.itemDiscountCents ? <p className="text-ds-ink-faint">Descontos nos itens incluídos no cálculo · {money(fact.adjustment.itemDiscountCents)}.</p> : null}
      <p className="text-ds-ink-faint">
        {fact.adjustment.finalizedAfterCancellation
          ? `Cancelado às ${fact.adjustment.lastCancellationAt?.slice(11, 19)}; pagamento final às ${fact.adjustment.finalizedAt.slice(11, 19)}.`
          : "O horário do cancelamento não comprova que ocorreu antes do pagamento final."}
      </p>
    </div> : null}
    <div className="mt-2 flex items-center gap-1.5 border-t border-ds-divider pt-[7px]">
      <span className="min-w-0 flex-1 break-all font-mono text-[10.5px] text-ds-ink-faint">ID da evidência: {fact.id}</span>
      <button type="button" onClick={copy} className="h-[22px] shrink-0 rounded-[7px] border border-ds-border bg-white px-2 text-[10.5px] font-bold text-ds-ink-muted hover:bg-ds-input">
        {copied ? "Copiado ✓" : "Copiar"}
      </button>
    </div>
  </div>;
}

function Side({ title, emptyLabel, ids, facts }: { title: string; emptyLabel: string; ids: string[]; facts: Map<string, SalesMatchFact> }) {
  const selected = ids.map(id => facts.get(id)).filter((fact): fact is SalesMatchFact => !!fact);
  return <div>
    <p className="mb-[7px] text-[10px] font-extrabold uppercase tracking-[0.12em] text-ds-ink-faint">{title}</p>
    {selected.length ? <div className="flex flex-col gap-[7px]">{selected.map(fact => <FactCard key={fact.id} fact={fact} />)}</div>
      : <div className="rounded-xl border-[1.5px] border-dashed border-ds-border p-3.5 text-center text-xs text-ds-ink-faint">{emptyLabel}</div>}
  </div>;
}

export function CaseDetailPanel({ row, facts, position, total, onPrev, onNext, onClose, onResolve, resolverName }: {
  row: SuggestedSalesReconciliationCase;
  facts: Map<string, SalesMatchFact>;
  position: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  resolverName?: string;
  onResolve?: (justification: string) => Promise<void>;
}) {
  const [writing, setWriting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [justification, setJustification] = useState("");
  const [resolutionError, setResolutionError] = useState("");
  const attention = isAttention(row);
  async function submitResolution() {
    if (writing || !onResolve || justification.trim().length < 12) return;
    setWriting(true);
    setResolutionError("");
    try { await onResolve(justification.trim()); }
    catch (error) { setResolutionError(error instanceof Error ? error.message : "Não foi possível resolver o caso."); }
    finally { setWriting(false); }
  }
  const different = row.differenceAmountCents !== 0;
  const refundCheck = row.pixRefundCheck;
  const cutoff = refundCheck?.checkedThrough.split("-").reverse().join("/");
  const pdvStatus = facts.get(row.pdvFactIds[0])?.status;
  const confirmedRefunds = refundCheck?.events.filter(event => event.state === "confirmed") ?? [];
  const confirmedCents = confirmedRefunds.reduce((sum, event) => sum + (event.amountCents ?? 0), 0);
  const refundTotalLabel = confirmedCents === row.stoneGrossAmountCents ? "Devolução integral confirmada"
    : confirmedCents < row.stoneGrossAmountCents ? "Devolução parcial confirmada" : "Soma confirmada acima do valor da venda";
  const navButton = "flex h-7 w-7 items-center justify-center rounded-lg border border-ds-border bg-white text-ds-ink-muted hover:bg-ds-input disabled:opacity-40";
  return <aside aria-label="Evidências do caso" className="sticky top-4 overflow-hidden rounded-2xl border border-ds-border bg-white shadow-[0_10px_30px_rgba(0,0,0,.06)]">
    <div className="flex items-center justify-between gap-2.5 border-b border-ds-divider bg-ds-input px-3.5 py-3">
      <StatusBadge tone={attention ? "bad" : "ok"}>{attention ? "⚠" : "✓"} {caseBadgeLabel(row)}</StatusBadge>
      <div className="flex items-center gap-1">
        <button type="button" aria-label="Caso anterior" className={navButton} disabled={position <= 0} onClick={onPrev}><ChevronUp className="h-4 w-4" /></button>
        <span className="px-1 font-mono text-[11.5px] font-semibold text-ds-ink-faint">{position + 1} de {total}</span>
        <button type="button" aria-label="Próximo caso" className={navButton} disabled={position >= total - 1} onClick={onNext}><ChevronDown className="h-4 w-4" /></button>
        <button type="button" aria-label="Fechar" className="ml-1 flex h-7 w-7 items-center justify-center rounded-lg text-ds-ink-faint hover:bg-ds-muted" onClick={onClose}><X className="h-4 w-4" /></button>
      </div>
    </div>
    <div className="flex flex-col gap-3.5 px-4 pb-[18px] pt-4">
      <div>
        <p className="text-[15px] font-extrabold tracking-tight">{channels[row.channel]} · {caseTime(row, facts)}</p>
        <p className="mt-1.5 text-pretty text-[12.5px] leading-[1.55] text-ds-ink-2">{caseReason(row)}</p>
        <div className="mt-[9px] flex flex-wrap gap-1.5">
          <span className="inline-flex h-[22px] items-center rounded-full bg-ds-muted px-[9px] text-[11px] font-semibold text-ds-ink-muted">Critério: {bases[row.matchBasis]}</span>
          <span className="inline-flex h-[22px] items-center rounded-full bg-ds-muted px-[9px] text-[11px] font-semibold text-ds-ink-muted">{confidences[row.confidence]}</span>
        </div>
      </div>
      <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-ds-border">
        {[["PDV", row.pdvGrossAmountCents], ["Stone", row.stoneGrossAmountCents]].map(([label, value]) => <div key={label} className="border-r border-ds-border px-[11px] py-[9px]">
          <p className="text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-ds-ink-faint">{label}</p>
          <p className="mt-[3px] font-mono text-[13px] font-bold tabular-nums">{money(value as number)}</p>
        </div>)}
        <div className={cn("px-[11px] py-[9px]", different ? "bg-ds-danger-bg text-ds-danger" : "bg-ds-ok-bg text-ds-ok")}>
          <p className="text-[9.5px] font-extrabold uppercase tracking-[0.12em] opacity-80">Diferença</p>
          <p className="mt-[3px] font-mono text-[13px] font-bold tabular-nums">{money(row.differenceAmountCents)}</p>
        </div>
      </div>
      {refundCheck ? <div className="space-y-1.5 rounded-xl border border-ds-border bg-ds-input px-3 py-2.5 text-[11.5px]">
        <p className="font-bold">Devoluções Pix na Stone</p>
        <p className="text-ds-ink-2">PDV {pdvStatus ? saleStatuses[pdvStatus].toLowerCase() : "cancelado"} · Stone aprovado</p>
        {refundCheck.state === "clear" ? <p className="text-ds-ok">Sem devolução encontrada até {cutoff}.</p> : null}
        {!refundCheck.complete ? <p className="text-ds-warn">A verificação tem cobertura incompleta até {cutoff}.</p> : null}
        {confirmedCents > 0 ? <p className="font-semibold text-ds-ink-2">{refundTotalLabel} · {money(confirmedCents)}</p> : null}
        {refundCheck.events.length ? <ul className="space-y-1.5 text-ds-ink-2">
          {refundCheck.events.map(event => <li key={JSON.stringify(event)}>
            <span className="font-semibold">{event.state === "confirmed" ? "Devolução confirmada" : "Evento de devolução a verificar"}</span>
            {event.amountCents !== null ? ` · ${money(event.amountCents)}` : null}
            {event.occurredAt ? ` · ${new Date(event.occurredAt).toLocaleDateString("pt-BR", { timeZone: "America/Belem" })}` : null}
            {event.refundId ? <span className="block break-all font-mono text-ds-ink-faint">{event.refundId}</span> : null}
          </li>)}
        </ul> : null}
      </div> : null}
      <Side title={`PDV · ${row.pdvFactIds.length} pagamento(s)`} emptyLabel="Não localizado no PDV deste recorte" ids={row.pdvFactIds} facts={facts} />
      <Side title={`Stone · ${row.stoneSaleIds.length} captura(s)`} emptyLabel="Não localizado na fonte Stone consultada" ids={row.stoneSaleIds} facts={facts} />
      {row.unlinkedResolution ? <div className="space-y-1.5 rounded-xl border border-ds-border bg-ds-input px-3 py-2.5 text-[11.5px]">
        <p className="font-bold">Justificativa</p>
        <p className="break-words text-ds-ink-2">{row.unlinkedResolution.justification}</p>
        <p className="break-words text-ds-ink-muted" title={row.unlinkedResolution.actor.id}>{row.unlinkedResolution.actor.namespace === "system"
          ? "Operação autorizada" : resolverName ? `Responsável · ${resolverName}` : "Responsável registrado"}</p>
        <p className="text-ds-ink-muted">Sem devolução encontrada até {formatDateKey(row.unlinkedResolution.checkedThrough)}.</p>
      </div> : onResolve ? <div className="space-y-2">
        {editing ? <>
          <p className="text-xs text-ds-ink-2">Registre o Pix de {money(row.stoneGrossAmountCents)} na Stone como resolvido sem venda vinculada no PDV.</p>
          <label className="block text-xs font-semibold">
            Justificativa
            <textarea className="mt-1.5 block w-full rounded-lg border border-ds-border bg-ds-input px-2.5 py-2 text-sm"
              value={justification} onChange={event => setJustification(event.target.value)} maxLength={500} rows={3} disabled={writing} />
          </label>
          {resolutionError ? <p role="alert" className="text-xs text-ds-danger">{resolutionError}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={writing || justification.trim().length < 12} onClick={() => void submitResolution()}>
              {writing ? "Registrando…" : "Confirmar resolução"}
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={writing} onClick={() => setEditing(false)}>Cancelar</Button>
          </div>
        </> : <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>Resolver sem vínculo</Button>}
      </div> : null}
      <p className="text-[11px] text-ds-ink-faint">↑ ↓ navegam entre os casos do filtro · Esc fecha</p>
    </div>
  </aside>;
}
