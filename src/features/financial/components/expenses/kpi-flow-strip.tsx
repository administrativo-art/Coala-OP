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
      valueClass: "text-ds-danger",
      dotClass: "bg-ds-danger",
    },
    {
      key: "dueSoon",
      label: "Vence em 7 dias",
      value: kpis.dueSoon,
      valueClass: "text-ds-warn",
      dotClass: "bg-ds-warn",
    },
    {
      key: "other",
      label: "Demais",
      value: otherOpen,
      valueClass: "text-ds-ink",
      dotClass: "bg-ds-info",
    },
  ] as const;

  return (
    <section className="overflow-hidden rounded-[18px] border border-ds-border bg-ds-surface">
      <div className="flex items-center gap-3 border-b border-ds-divider px-5 py-3">
        <span className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Período</span>
        <span className="text-[13px] font-extrabold text-ds-ink">{periodLabel}</span>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1.15fr)_minmax(240px,.78fr)]">
        <div className="flex min-w-0 flex-col px-5 py-[18px]">
          <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-muted">Total do período</p>
          <div className="mt-4 font-mono text-[30px] font-extrabold leading-none tracking-[-0.02em] text-ds-ink">
            {formatCurrency(periodTotal)}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-x-5 gap-y-3 border-t border-ds-divider pt-3 xl:grid-cols-4">
            {[
              { label: "Pago", value: formatCurrency(kpis.paid), valueClass: "text-ds-ok" },
              { label: "Lançamentos a pagar", value: formatCurrency(kpis.launchedOpen), valueClass: "text-ds-info" },
              { label: "Provisões conc. a pagar", value: formatCurrency(kpis.reconciledProvisionOpen), valueClass: "text-ds-warn" },
              { label: "Em auditoria", value: formatCurrency(kpis.auditOpen), valueClass: "text-ds-warn" },
            ].map((item) => (
              <div key={item.label} className="min-w-0">
                <p className="text-[11px] leading-[1.3] text-ds-ink-muted">{item.label}</p>
                <p className={cn("mt-1 whitespace-nowrap font-mono text-[12px] font-extrabold", item.valueClass)}>{item.value}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="flex min-w-0 flex-col border-t border-ds-divider px-5 py-[18px] lg:border-l lg:border-t-0">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-muted">A pagar no período</p>
            <span className="whitespace-nowrap text-[11px] text-ds-ink-faint">
              {openCount} {openCount === 1 ? "lançamento" : "lançamentos"}
            </span>
          </div>
          <div className="mt-4 font-mono text-[30px] font-extrabold leading-none tracking-[-0.02em] text-ds-ink">
            {formatCurrency(kpis.open)}
          </div>
          <div className="mt-5 grid grid-cols-3 gap-3 border-t border-ds-divider pt-3">
            {segments.map((segment) => (
              <div key={segment.key} className="min-w-0">
                <span className="flex items-center gap-1.5 text-[11px] text-ds-ink-muted">
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
            "flex min-h-[190px] w-full flex-col border-t border-ds-divider bg-ds-warn-bg px-5 py-[18px] text-left text-inherit transition-colors hover:bg-ds-warn-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ds-accent-ink lg:border-l lg:border-t-0",
            auditActive && "bg-ds-warn-bg shadow-[inset_0_0_0_2px_var(--ds-warn)]",
          )}
        >
          <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-warn">Pendente auditoria</p>
          <div className="mt-4 font-mono text-[30px] font-extrabold leading-none tracking-[-0.02em] text-ds-warn">
            {formatCurrency(kpis.pendingAudit)}
          </div>
          <div className="mt-auto flex items-center justify-between gap-3 border-t border-ds-divider pt-3">
            <span className="text-[11px] font-bold text-ds-warn">
              {auditCount} {auditCount === 1 ? "item aguardando" : "itens aguardando"} tratamento
            </span>
            <span aria-hidden="true" className="shrink-0 text-[13px] font-extrabold leading-none text-ds-warn">→</span>
          </div>
        </button>
      </div>
    </section>
  );
}
