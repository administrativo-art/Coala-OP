"use client";

import Link from "next/link";
import { ArrowRight, CheckCheck, Landmark, SearchCheck } from "lucide-react";
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
      barClass: "bg-rose-500",
      valueClass: "text-rose-700 dark:text-rose-300",
      dotClass: "bg-rose-500",
    },
    {
      key: "dueSoon",
      label: "Vence em 7 dias",
      value: kpis.dueSoon,
      barClass: "bg-amber-500",
      valueClass: "text-amber-700 dark:text-amber-300",
      dotClass: "bg-amber-500",
    },
    {
      key: "other",
      label: "Demais",
      value: otherOpen,
      barClass: "bg-blue-500",
      valueClass: "text-foreground",
      dotClass: "bg-blue-500",
    },
  ] as const;

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)_minmax(0,1fr)]">
      <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
              <Landmark className="h-3.5 w-3.5" />
            </span>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              A pagar no período
            </p>
          </div>
          <span className="text-[11px] font-medium text-muted-foreground">
            {openCount} {openCount === 1 ? "lançamento" : "lançamentos"}
          </span>
        </div>

        <div className="mt-3 font-mono text-[32px] font-bold leading-none tracking-tight">
          {formatCurrency(kpis.open)}
        </div>

        <div
          className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-muted"
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

        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3">
          {segments.map((segment) => (
            <div key={segment.key} className="flex flex-col gap-0.5">
              <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground">
                <span className={cn("h-2 w-2 rounded-sm", segment.dotClass)} />
                {segment.label}
              </span>
              <span className={cn("font-mono text-sm font-bold", segment.valueClass)}>
                {formatCurrency(segment.value)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col rounded-2xl border border-border/70 bg-card p-5 shadow-sm">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            <CheckCheck className="h-3.5 w-3.5" />
          </span>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Pago no período
          </p>
        </div>
        <div
          className={cn(
            "mt-3 font-mono text-[28px] font-bold leading-none tracking-tight",
            kpis.paid > 0 ? "text-foreground" : "text-muted-foreground/70"
          )}
        >
          {formatCurrency(kpis.paid)}
        </div>
        <p className="mt-auto pt-3 text-[11.5px] leading-snug text-muted-foreground">
          {kpis.paid > 0
            ? "Histórico liquidado no período."
            : "Nenhuma liquidação registrada neste período ainda."}
        </p>
      </div>

      <Link
        href={auditHref}
        className="flex flex-col rounded-2xl border border-violet-200/70 bg-gradient-to-b from-violet-50 to-card p-5 shadow-sm transition-colors hover:border-violet-300 dark:border-violet-800/70 dark:from-violet-950/30 dark:hover:border-violet-700"
      >
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-900/60 dark:text-violet-300">
            <SearchCheck className="h-3.5 w-3.5" />
          </span>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-600 dark:text-violet-300">
            Pendente auditoria
          </p>
        </div>
        <div className="mt-3 font-mono text-[28px] font-bold leading-none tracking-tight text-violet-700 dark:text-violet-300">
          {formatCurrency(kpis.pendingAudit)}
        </div>
        <div className="mt-auto flex items-center justify-between gap-3 pt-3">
          <span className="text-[11.5px] font-medium text-violet-700 dark:text-violet-300">
            {auditCount} {auditCount === 1 ? "item aguardando" : "itens aguardando"} tratamento
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-violet-700 dark:text-violet-300" />
        </div>
      </Link>
    </div>
  );
}
