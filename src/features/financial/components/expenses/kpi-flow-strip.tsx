"use client";

import { formatCurrency } from "@/features/financial/lib/utils";
import { cn } from "@/lib/utils";

type ExpenseKpis = {
  open: number;
  launchedOpen: number;
  reconciledProvisionOpen: number;
  auditOpen: number;
  overdue: number;
  paid: number;
  dueSoon: number;
  pendingAudit: number;
};

export function KpiFlowStrip({
  kpis,
  openCount,
  auditCount,
  onAuditClick,
  auditActive = false,
  periodLabel,
}: {
  kpis: ExpenseKpis;
  openCount: number;
  auditCount: number;
  onAuditClick: () => void;
  auditActive?: boolean;
  periodLabel: string;
}) {
  const otherOpen = Math.max(kpis.open - kpis.overdue - kpis.dueSoon, 0);
  const periodTotal = kpis.paid + kpis.open;

  const segments = [
    {
      key: "overdue",
      label: "Vencido",
      value: kpis.overdue,
      valueClass: "text-rose-700 dark:text-rose-300",
      dotClass: "bg-[#e11d48]",
    },
    {
      key: "dueSoon",
      label: "Vence em 7 dias",
      value: kpis.dueSoon,
      valueClass: "text-amber-700 dark:text-amber-300",
      dotClass: "bg-[#f59e0b]",
    },
    {
      key: "other",
      label: "Demais",
      value: otherOpen,
      valueClass: "text-foreground",
      dotClass: "bg-[#3b82f6]",
    },
  ] as const;

  return (
    <section className="overflow-hidden rounded-[18px] border border-[#dedbd4] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.035)] dark:border-border/70 dark:bg-card">
      <div className="flex items-center gap-3 border-b border-[#e7e3dc] px-5 py-3 dark:border-border/60">
        <span className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-[#8a8f99] dark:text-muted-foreground">Período</span>
        <span className="text-[12px] font-extrabold text-[#1a1b1f] dark:text-foreground">{periodLabel}</span>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1.15fr)_minmax(240px,.78fr)]">
        <div className="flex min-w-0 flex-col px-5 py-[18px]">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#6b7078] dark:text-muted-foreground">Total do período</p>
          <div className="mt-4 font-mono text-[30px] font-extrabold leading-none tracking-[-0.02em] text-[#1a1b1f] dark:text-foreground">
            {formatCurrency(periodTotal)}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-x-5 gap-y-3 border-t border-[#ece9e2] pt-3 xl:grid-cols-4 dark:border-border/60">
            {[
              { label: "Pago", value: formatCurrency(kpis.paid), valueClass: "text-emerald-700 dark:text-emerald-300" },
              { label: "Lançamentos a pagar", value: formatCurrency(kpis.launchedOpen), valueClass: "text-blue-700 dark:text-blue-300" },
              { label: "Provisões conc. a pagar", value: formatCurrency(kpis.reconciledProvisionOpen), valueClass: "text-amber-700 dark:text-amber-300" },
              { label: "Em auditoria", value: formatCurrency(kpis.auditOpen), valueClass: "text-violet-700 dark:text-violet-300" },
            ].map((item) => (
              <div key={item.label} className="min-w-0">
                <p className="text-[10px] leading-[1.3] text-[#777b83] dark:text-muted-foreground">{item.label}</p>
                <p className={cn("mt-1 whitespace-nowrap font-mono text-[12px] font-extrabold", item.valueClass)}>{item.value}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="flex min-w-0 flex-col border-t border-[#e7e3dc] px-5 py-[18px] lg:border-l lg:border-t-0 dark:border-border/60">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#6b7078] dark:text-muted-foreground">A pagar no período</p>
            <span className="whitespace-nowrap text-[11px] text-[#8a8f99] dark:text-muted-foreground">
              {openCount} {openCount === 1 ? "lançamento" : "lançamentos"}
            </span>
          </div>
          <div className="mt-4 font-mono text-[30px] font-extrabold leading-none tracking-[-0.02em] text-[#1a1b1f] dark:text-foreground">
            {formatCurrency(kpis.open)}
          </div>
          <div className="mt-5 grid grid-cols-3 gap-3 border-t border-[#ece9e2] pt-3 dark:border-border/60">
            {segments.map((segment) => (
              <div key={segment.key} className="min-w-0">
                <span className="flex items-center gap-1.5 text-[10px] text-[#777b83] dark:text-muted-foreground">
                  <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", segment.dotClass)} />
                  <span className="truncate">{segment.label}</span>
                </span>
                <span className={cn("mt-1 block whitespace-nowrap font-mono text-[12px] font-extrabold", segment.valueClass)}>
                  {formatCurrency(segment.value)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={onAuditClick}
          aria-pressed={auditActive}
          title="Filtrar a lista por pendências de auditoria"
          className={cn(
            "flex min-h-[190px] w-full flex-col border-t border-[#e6d9f5] bg-[#fbf6ff] px-5 py-[18px] text-left text-inherit transition-colors hover:bg-[#f8efff] lg:border-l lg:border-t-0 dark:border-violet-800/70 dark:bg-violet-950/30 dark:hover:bg-violet-950/45",
            auditActive && "bg-[#f6ebff] shadow-[inset_0_0_0_2px_#eadcf7] dark:bg-violet-950/50",
          )}
        >
          <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#7c3aed] dark:text-violet-300">Pendente auditoria</p>
          <div className="mt-4 font-mono text-[30px] font-extrabold leading-none tracking-[-0.02em] text-[#6d28d9] dark:text-violet-300">
            {formatCurrency(kpis.pendingAudit)}
          </div>
          <div className="mt-auto flex items-center justify-between gap-3 border-t border-[#e8d8f7] pt-3 dark:border-violet-800/60">
            <span className="text-[11px] font-semibold text-[#7c3aed] dark:text-violet-300">
              {auditCount} {auditCount === 1 ? "item aguardando" : "itens aguardando"} tratamento
            </span>
            <span aria-hidden="true" className="shrink-0 text-[13px] font-extrabold leading-none text-[#7c3aed] dark:text-violet-300">→</span>
          </div>
        </button>
      </div>
    </section>
  );
}
