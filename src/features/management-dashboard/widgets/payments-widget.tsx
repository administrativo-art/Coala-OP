"use client";

import { cn } from "@/lib/utils";

import { widgetIcons } from "./icons";
import { DetailsLink, IconChip, KpiTile, Pill, WidgetCard, WidgetEmpty, WidgetHead } from "./kit";

export type PaymentRow = { id: string; description: string; dueLabel: string; dueDay: string; value: string; overdue: boolean; daysLabel: string };

export type PaymentsWidgetProps = {
  loading: boolean;
  overdueTotal: number;
  upcomingTotal: number;
  overdueCount: number;
  upcomingCount: number;
  /** Vencidos primeiro, depois a vencer, por data. */
  rows: PaymentRow[];
  formatMoney: (value: number) => string;
  onDetails: () => void;
};

function Row({ row }: { row: PaymentRow }) {
  return (
    <li className="flex items-center gap-3 rounded-ds-card border border-ds-divider bg-ds-surface p-3">
      <div className={cn("flex h-10 w-11 shrink-0 flex-col items-center justify-center rounded-lg", row.overdue ? "bg-ds-danger-bg text-ds-danger" : "bg-ds-warn-bg text-ds-warn")}>
        <span className="text-sm font-black leading-none tabular-nums">{row.dueDay}</span>
        <span className="mt-0.5 text-[9px] font-bold uppercase leading-none">{row.dueLabel}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-extrabold text-ds-ink">{row.description}</p>
        <p className={cn("text-xs font-medium", row.overdue ? "text-ds-danger" : "text-ds-ink-faint")}>{row.daysLabel}</p>
      </div>
      <span className="whitespace-nowrap text-sm font-black tabular-nums text-ds-ink">{row.value}</span>
    </li>
  );
}

export function PaymentsWidget({ loading, overdueTotal, upcomingTotal, overdueCount, upcomingCount, rows, formatMoney, onDetails }: PaymentsWidgetProps) {
  const total = overdueTotal + upcomingTotal;
  const overdueShare = total > 0 ? overdueTotal / total : 0;
  const count = overdueCount + upcomingCount;
  return (
    <WidgetCard widgetId="pending-payments">
      {(density) => (
        <>
          <WidgetHead icon={widgetIcons.payments} tone="ok" title={density === "compact" ? "Pagamentos" : "Pagamentos vencidos e a vencer"} subtitle="Mês corrente" href="/dashboard/financial/expenses" density={density} />
          {loading ? (
            <WidgetEmpty>Carregando pagamentos...</WidgetEmpty>
          ) : density === "compact" ? (
            <>
              <div>
                <p className={cn("flex items-center gap-1.5 text-xs font-bold", overdueCount > 0 ? "text-ds-danger" : "text-ds-ink-muted")}>
                  <widgetIcons.alerts className="h-3.5 w-3.5" />Vencido · {overdueCount} pagamento(s)
                </p>
                <p className={cn("mt-1 whitespace-nowrap text-3xl font-black tracking-tight tabular-nums", overdueCount > 0 ? "text-ds-danger" : "text-ds-ink")}>{formatMoney(overdueTotal)}</p>
              </div>
              <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-ds-muted">
                {overdueTotal > 0 ? <div className="h-full bg-ds-danger" style={{ width: `${overdueShare * 100}%` }} /> : null}
                {upcomingTotal > 0 ? <div className="h-full flex-1 bg-ds-warn" /> : null}
              </div>
              <div className="flex justify-between text-xs font-medium text-ds-ink-muted"><span>A vencer {formatMoney(upcomingTotal)}</span><span>{count} no total</span></div>
              {rows.find((row) => !row.overdue) ? (
                <div className="flex items-center gap-2.5 rounded-ds-card bg-ds-warn-bg p-2.5 text-xs">
                  <IconChip icon={widgetIcons.energy} tone="warn" size="sm" />
                  <span className="min-w-0 truncate font-semibold text-ds-ink">{rows.find((row) => !row.overdue)?.description}<br /><span className="font-medium text-ds-ink-muted">{rows.find((row) => !row.overdue)?.daysLabel}</span></span>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <div className={cn("grid gap-3", density === "wide" ? "grid-cols-4" : "grid-cols-2")}>
                <KpiTile label="Vencidos" value={formatMoney(overdueTotal)} note={`${overdueCount} pagamento(s)`} tone={overdueCount > 0 ? "danger" : "muted"} icon={widgetIcons.alerts} />
                <KpiTile label="A vencer no mês" value={formatMoney(upcomingTotal)} note={`${upcomingCount} pagamento(s)`} tone="warn" icon={widgetIcons.workday} />
                {density === "wide" ? (
                  <>
                    <KpiTile label="Total em aberto" value={formatMoney(total)} note={`${count} pagamento(s)`} icon={widgetIcons.wallet} />
                    <KpiTile label="Parte vencida" value={`${Math.round(overdueShare * 100)}%`} note="do total em aberto" tone={overdueShare > 0.25 ? "danger" : "ok"} icon={widgetIcons.limits} />
                  </>
                ) : null}
              </div>
              <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-ds-muted">
                {overdueTotal > 0 ? <div className="h-full bg-ds-danger" style={{ width: `${overdueShare * 100}%` }} /> : null}
                {upcomingTotal > 0 ? <div className="h-full flex-1 bg-ds-warn" /> : null}
              </div>
              {rows.length === 0 ? (
                <WidgetEmpty>Nenhum pagamento pendente no mês.</WidgetEmpty>
              ) : (
                <ul className={cn("gap-2.5", density === "wide" ? "grid grid-cols-2" : "space-y-2.5")}>{rows.slice(0, density === "wide" ? 6 : 3).map((row) => <Row key={row.id} row={row} />)}</ul>
              )}
              <div className="flex items-center justify-between">
                <DetailsLink onClick={onDetails}>Detalhar pagamentos</DetailsLink>
                {rows.length > (density === "wide" ? 6 : 3) ? <Pill tone="muted">+{rows.length - (density === "wide" ? 6 : 3)} outros</Pill> : null}
              </div>
            </>
          )}
        </>
      )}
    </WidgetCard>
  );
}
