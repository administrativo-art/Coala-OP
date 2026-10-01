"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SalesMatchFact, SuggestedSalesReconciliationCase } from "./types";
import {
  bases, caseBadgeLabel, caseReason, caseTime, channels, confidences, factLabel, isAttention, money,
  providerTransactionLabels, saleStatuses,
} from "./review-view";

export const toneBadge = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-700",
  bad: "border-rose-200 bg-rose-50 text-rose-700",
  warn: "border-amber-200 bg-amber-50 text-amber-700",
  muted: "border-[#ebe7de] bg-[#f4f2ec] text-[#7c8189]",
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
  return <div className="rounded-xl border border-[#efebe3] bg-[#fcfbf9] px-3 py-2.5">
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[12.5px] font-bold">{factLabel(fact)}</span>
      <span className="font-mono text-[12.5px] font-bold tabular-nums">{money(fact.grossAmountCents)}</span>
    </div>
    <div className="mt-[3px] flex justify-between gap-2 text-[11.5px]">
      <span className="text-[#7c8189]">{new Date(fact.soldAt).toLocaleString("pt-BR")}</span>
      <span className={cn("font-bold", fact.status === "approved" ? "text-emerald-700" : "text-rose-700")}>{saleStatuses[fact.status]}</span>
    </div>
    {identifiers.length ? <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-[3px] text-[11px]">
      {identifiers.map(([label, value]) => <div key={label} className="contents">
        <dt className="text-[#9a9ba1]">{label}</dt>
        <dd className="break-all font-mono text-[#374151]">{value}</dd>
      </div>)}
    </dl> : null}
    {fact.adjustment ? <div className="mt-2 space-y-0.5 rounded-lg bg-emerald-50 px-2 py-1.5 text-[11px]">
      <p className="font-medium text-emerald-800">
        Cupom original {money(fact.adjustment.originalAmountCents)} · cancelado −{money(fact.adjustment.cancelledAmountCents)} · final {money(fact.adjustment.finalAmountCents)}
      </p>
      <p className="text-[#7c8189]">
        {fact.adjustment.finalizedAfterCancellation
          ? `Cancelado às ${fact.adjustment.lastCancellationAt?.slice(11, 19)}; pagamento final às ${fact.adjustment.finalizedAt.slice(11, 19)}.`
          : "O horário do cancelamento não comprova que ocorreu antes do pagamento final."}
      </p>
    </div> : null}
    <div className="mt-2 flex items-center gap-1.5 border-t border-[#f0ece4] pt-[7px]">
      <span className="min-w-0 flex-1 break-all font-mono text-[10.5px] text-[#a3a099]">ID da evidência: {fact.id}</span>
      <button type="button" onClick={copy} className="h-[22px] shrink-0 rounded-[7px] border border-[#e3ded3] bg-white px-2 text-[10.5px] font-bold text-[#5f646c] hover:bg-[#faf9f6]">
        {copied ? "Copiado ✓" : "Copiar"}
      </button>
    </div>
  </div>;
}

function Side({ title, emptyLabel, ids, facts }: { title: string; emptyLabel: string; ids: string[]; facts: Map<string, SalesMatchFact> }) {
  const selected = ids.map(id => facts.get(id)).filter((fact): fact is SalesMatchFact => !!fact);
  return <div>
    <p className="mb-[7px] text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#9a9ba1]">{title}</p>
    {selected.length ? <div className="flex flex-col gap-[7px]">{selected.map(fact => <FactCard key={fact.id} fact={fact} />)}</div>
      : <div className="rounded-xl border-[1.5px] border-dashed border-[#e3ded3] p-3.5 text-center text-xs text-[#9a9ba1]">{emptyLabel}</div>}
  </div>;
}

export function CaseDetailPanel({ row, facts, position, total, onPrev, onNext, onClose }: {
  row: SuggestedSalesReconciliationCase;
  facts: Map<string, SalesMatchFact>;
  position: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const attention = isAttention(row);
  const different = row.differenceAmountCents !== 0;
  const navButton = "flex h-7 w-7 items-center justify-center rounded-lg border border-[#e3ded3] bg-white text-[#5f646c] hover:bg-[#faf9f6] disabled:opacity-40";
  return <aside aria-label="Evidências do caso" className="sticky top-4 overflow-hidden rounded-2xl border border-[#e9e5dc] bg-white shadow-[0_10px_30px_rgba(0,0,0,.06)]">
    <div className="flex items-center justify-between gap-2.5 border-b border-[#f0ece4] bg-[#faf9f6] px-3.5 py-3">
      <StatusBadge tone={attention ? "bad" : "ok"}>{attention ? "⚠" : "✓"} {caseBadgeLabel(row)}</StatusBadge>
      <div className="flex items-center gap-1">
        <button type="button" aria-label="Caso anterior" className={navButton} disabled={position <= 0} onClick={onPrev}><ChevronUp className="h-4 w-4" /></button>
        <span className="px-1 font-mono text-[11.5px] font-semibold text-[#8a8f99]">{position + 1} de {total}</span>
        <button type="button" aria-label="Próximo caso" className={navButton} disabled={position >= total - 1} onClick={onNext}><ChevronDown className="h-4 w-4" /></button>
        <button type="button" aria-label="Fechar" className="ml-1 flex h-7 w-7 items-center justify-center rounded-lg text-[#8a8f99] hover:bg-[#efebe3]" onClick={onClose}><X className="h-4 w-4" /></button>
      </div>
    </div>
    <div className="flex flex-col gap-3.5 px-4 pb-[18px] pt-4">
      <div>
        <p className="text-[15px] font-extrabold tracking-tight">{channels[row.channel]} · {caseTime(row, facts)}</p>
        <p className="mt-1.5 text-pretty text-[12.5px] leading-[1.55] text-[#4b5058]">{caseReason(row)}</p>
        <div className="mt-[9px] flex flex-wrap gap-1.5">
          <span className="inline-flex h-[22px] items-center rounded-full bg-[#f4f2ec] px-[9px] text-[11px] font-semibold text-[#5f646c]">Critério: {bases[row.matchBasis]}</span>
          <span className="inline-flex h-[22px] items-center rounded-full bg-[#f4f2ec] px-[9px] text-[11px] font-semibold text-[#5f646c]">{confidences[row.confidence]}</span>
        </div>
      </div>
      <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-[#efebe3]">
        {[["PDV", row.pdvGrossAmountCents], ["Stone", row.stoneGrossAmountCents]].map(([label, value]) => <div key={label} className="border-r border-[#efebe3] px-[11px] py-[9px]">
          <p className="text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-[#9a9ba1]">{label}</p>
          <p className="mt-[3px] font-mono text-[13px] font-bold tabular-nums">{money(value as number)}</p>
        </div>)}
        <div className={cn("px-[11px] py-[9px]", different ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700")}>
          <p className="text-[9.5px] font-extrabold uppercase tracking-[0.12em] opacity-80">Diferença</p>
          <p className="mt-[3px] font-mono text-[13px] font-bold tabular-nums">{money(row.differenceAmountCents)}</p>
        </div>
      </div>
      <Side title={`PDV · ${row.pdvFactIds.length} pagamento(s)`} emptyLabel="Não localizado no PDV deste recorte" ids={row.pdvFactIds} facts={facts} />
      <Side title={`Stone · ${row.stoneSaleIds.length} captura(s)`} emptyLabel="Não localizado na fonte Stone consultada" ids={row.stoneSaleIds} facts={facts} />
      <p className="text-[11px] text-[#a3a099]">↑ ↓ navegam entre os casos do filtro · Esc fecha</p>
    </div>
  </aside>;
}
