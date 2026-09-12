"use client";

import Link from "next/link";
import { CheckCheck, Landmark, SearchCheck } from "lucide-react";
import { formatCurrency } from "@/features/financial/lib/utils";
import { cn } from "@/lib/utils";

type ExpenseKpis = {
  open: number;
  overdue: number;
  paid: number;
  dueSoon: number;
  pendingAudit: number;
};

export function KpiFlowStrip({
  kpis,
  openCount,
  auditCount,
  auditHref,
}: {
  kpis: ExpenseKpis;
  openCount: number;
  auditCount: number;
  auditHref: string;
}) {
  const otherOpen = Math.max(kpis.open - kpis.overdue - kpis.dueSoon, 0);
  const totalOpen = kpis.overdue + kpis.dueSoon + otherOpen;
  const segmentWidth = (value: number) => (totalOpen > 0 ? `${(value / totalOpen) * 100}%` : "0%");

  const segments = [
    {
      key: "overdue",
      label: "Vencido",
      value: kpis.overdue,
      barClass: "bg-[#e11d48]",
      valueClass: "text-rose-700 dark:text-rose-300",
      dotClass: "bg-[#e11d48]",
    },
    {
      key: "dueSoon",
      label: "Vence em 7 dias",
      value: kpis.dueSoon,
      barClass: "bg-[#f59e0b]",
      valueClass: "text-amber-700 dark:text-amber-300",
      dotClass: "bg-[#f59e0b]",
    },
    {
      key: "other",
      label: "Demais",
      value: otherOpen,
      barClass: "bg-[#3b82f6]",
      valueClass: "text-foreground",
      dotClass: "bg-[#3b82f6]",
    },
  ] as const;

  return (
    <div className="grid gap-[14px] lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)_minmax(0,1fr)]">
      <div className="rounded-[18px] border border-[#e2ded4] bg-white px-5 py-[18px] shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:border-border/70 dark:bg-card">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-[9px] bg-[#eff6ff] text-[#1d4ed8] dark:bg-blue-950/40 dark:text-blue-300">
              <Landmark className="h-3.5 w-3.5" />
            </span>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#a3a099] dark:text-muted-foreground">
              A pagar no período
            </p>
          </div>
          <span className="text-[11px] font-bold text-[#8a8f99] dark:text-muted-foreground">
            {openCount} {openCount === 1 ? "lançamento" : "lançamentos"}
          </span>
        </div>

        <div className="mt-2 font-mono text-[34px] font-extrabold leading-none tracking-[-0.02em]">
          {formatCurrency(kpis.open)}
        </div>

        <div
          className="mt-4 flex h-[9px] overflow-hidden rounded-[6px] bg-[#eef0f2] dark:bg-muted"
          role="img"
          aria-label="Composição do valor em aberto"
        >
          {segments.map((segment) =>
            segment.value > 0 ? (
              <div
                key={segment.key}
                className={cn("h-full", segment.barClass)}
                style={{ width: segmentWidth(segment.value) }}
                title={`${segment.label}: ${formatCurrency(segment.value)}`}
              />
            ) : null
          )}
        </div>

        <div className="mt-[14px] flex flex-wrap gap-x-[22px] gap-y-3">
          {segments.map((segment) => (
            <div key={segment.key} className="flex flex-col gap-0.5">
              <span className="flex items-center gap-1.5 text-[11.5px] font-bold text-[#6b7078] dark:text-muted-foreground">
                <span className={cn("h-2 w-2 rounded-sm", segment.dotClass)} />
                {segment.label}
              </span>
              <span className={cn("font-mono text-[15px] font-extrabold", segment.valueClass)}>
                {formatCurrency(segment.value)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col rounded-[18px] border border-[#e2ded4] bg-white px-5 py-[18px] shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:border-border/70 dark:bg-card">
        <div className="flex items-center gap-[9px]">
          <span className="flex h-7 w-7 items-center justify-center rounded-[9px] bg-[#ecfdf5] text-[#047857] dark:bg-emerald-950/40 dark:text-emerald-300">
            <CheckCheck className="h-3.5 w-3.5" />
          </span>
          <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#a3a099] dark:text-muted-foreground">
            Pago no período
          </p>
        </div>
        <div
          className={cn(
            "mt-3 font-mono text-[28px] font-extrabold leading-none tracking-[-0.02em]",
            kpis.paid > 0 ? "text-[#1a1b1f] dark:text-foreground" : "text-[#9a9ba1] dark:text-muted-foreground/70"
          )}
        >
          {formatCurrency(kpis.paid)}
        </div>
        <p className="mt-auto pt-3 text-[11.5px] leading-[1.4] text-[#8a8f99] dark:text-muted-foreground">
          {kpis.paid > 0
            ? "Histórico liquidado no período."
            : "Nenhuma liquidação registrada neste período ainda."}
        </p>
      </div>

      <Link
        href={auditHref}
        className="flex flex-col rounded-[18px] border border-[#e6d9f5] bg-gradient-to-b from-[#faf5ff] to-white px-5 py-[18px] text-inherit shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-colors hover:border-[#d8c4ee] dark:border-violet-800/70 dark:from-violet-950/30 dark:to-card dark:hover:border-violet-700"
      >
        <div className="flex items-center gap-[9px]">
          <span className="flex h-7 w-7 items-center justify-center rounded-[9px] bg-[#f3e8ff] text-[#7c3aed] dark:bg-violet-900/60 dark:text-violet-300">
            <SearchCheck className="h-3.5 w-3.5" />
          </span>
          <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#8b5cf6] dark:text-violet-300">
            Pendente auditoria
          </p>
        </div>
        <div className="mt-3 font-mono text-[28px] font-extrabold leading-none tracking-[-0.02em] text-[#6d28d9] dark:text-violet-300">
          {formatCurrency(kpis.pendingAudit)}
        </div>
        <div className="mt-auto flex items-center justify-between gap-3 pt-3">
          <span className="text-[11.5px] font-semibold text-[#7c3aed] dark:text-violet-300">
            {auditCount} {auditCount === 1 ? "item aguardando" : "itens aguardando"} tratamento
          </span>
          <span aria-hidden="true" className="shrink-0 text-[13px] font-extrabold leading-none text-[#7c3aed] dark:text-violet-300">
            →
          </span>
        </div>
      </Link>
    </div>
  );
}
