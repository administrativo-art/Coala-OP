"use client";

import { formatCurrency } from "@/features/financial/lib/utils";
import type { ExpenseLifecyclePoint } from "@/features/financial/lib/cash-flow-analysis";
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
  competences,
  selectedCompetence,
  onCompetenceSelect,
}: {
  kpis: ExpenseKpis;
  openCount: number;
  auditCount: number;
  onAuditClick: () => void;
  auditActive?: boolean;
  periodLabel: string;
  /** Provisionado × pago por competência, do mais antigo para o mais recente; clicar filtra a lista pela competência. */
  competences?: ExpenseLifecyclePoint[];
  selectedCompetence?: string;
  onCompetenceSelect?: (competence: string) => void;
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
            "flex min-h-[190px] w-full flex-col border-t border-ds-divider bg-ds-warn-bg px-5 py-[18px] text-left text-inherit transition-colors hover:bg-ds-warn-bg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ds-accent-ink lg:border-l lg:border-t-0",
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

      {competences && competences.length > 0 ? (
        <CompetenceTimeline points={competences} selected={selectedCompetence} onSelect={onCompetenceSelect} />
      ) : null}
    </section>
  );
}

/** Uma coluna por competência: a parte paga cheia e a parte em aberto tracejada, com o percentual pago. */
function CompetenceTimeline({ points, selected, onSelect }: { points: ExpenseLifecyclePoint[]; selected?: string; onSelect?: (competence: string) => void }) {
  const largest = Math.max(...points.map((point) => point.provisioned), 1);
  return (
    <div className="grid gap-4 border-t border-dashed border-ds-divider px-5 pb-4 pt-3.5 lg:grid-cols-[170px_minmax(0,1fr)] lg:items-end">
      <div className="space-y-1.5">
        <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-muted">Por competência</p>
        <p className="text-[11.5px] text-ds-ink-faint">Quanto do provisionado já foi pago. Clique num mês para filtrar a lista.</p>
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ds-ink-muted">
          <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-[2px] bg-ds-ok" aria-hidden="true" />Pago</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-[2px] border border-ds-warn bg-ds-warn-bg" aria-hidden="true" />Em aberto</span>
        </p>
      </div>
      <div className="grid grid-flow-col auto-cols-fr gap-2" role="group" aria-label="Competências">
        {points.map((point) => {
          const paidShare = point.provisioned > 0 ? Math.min(point.paid / point.provisioned, 1) : 0;
          const height = Math.max(Math.round((point.provisioned / largest) * 64), point.provisioned > 0 ? 6 : 2);
          const active = selected === point.key;
          return (
            <button
              key={point.key}
              type="button"
              aria-pressed={active}
              aria-label={`${point.month}: ${formatCurrency(point.paid)} pagos de ${formatCurrency(point.provisioned)} provisionados`}
              onClick={() => onSelect?.(point.key)}
              className={cn(
                "grid justify-items-center gap-1 rounded-xl px-1 py-1.5 transition-colors hover:bg-ds-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-accent-ink",
                active && "bg-ds-accent-row",
              )}
            >
              <span className="flex w-full max-w-[46px] flex-col-reverse overflow-hidden rounded-md bg-ds-muted" style={{ height: 64 }}>
                <span className="flex w-full flex-col-reverse overflow-hidden rounded-md" style={{ height }}>
                  <span className="w-full bg-ds-ok" style={{ height: `${paidShare * 100}%` }} />
                  <span className="w-full border border-ds-warn bg-ds-warn-bg" style={{ height: `${(1 - paidShare) * 100}%` }} />
                </span>
              </span>
              <span className="text-[11.5px] font-bold capitalize text-ds-ink-2">{point.month}</span>
              <span className={cn("font-mono text-[11px]", paidShare < 0.98 ? "font-bold text-ds-warn" : "text-ds-ink-faint")}>{Math.round(paidShare * 100)}%</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
