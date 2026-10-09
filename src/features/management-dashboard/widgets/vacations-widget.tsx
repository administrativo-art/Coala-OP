"use client";

import { cn } from "@/lib/utils";

import { widgetIcons } from "./icons";
import { DetailsLink, KpiTile, Pill, WidgetCard, WidgetEmpty, WidgetHead } from "./kit";

export type VacationItem = {
  id: string;
  name: string;
  initials: string;
  rangeLabel: string;
  status: "APPROVED" | "PLANNED" | "PENDING" | string;
  statusLabel: string;
  /** Dias do mês (1 a monthDays) em que a ausência começa e termina, já limitados ao mês. */
  startDay: number;
  endDay: number;
};

export type VacationsWidgetProps = {
  loading: boolean;
  items: VacationItem[];
  monthLabel: string;
  monthDays: number;
  todayDay: number;
  onDetails: () => void;
};

const barClass: Record<string, string> = { APPROVED: "bg-ds-ok", PLANNED: "bg-ds-info", PENDING: "bg-ds-warn" };

function Timeline({ items, monthDays, todayDay }: { items: VacationItem[]; monthDays: number; todayDay: number }) {
  const pct = (day: number) => `${((day - 1) / monthDays) * 100}%`;
  const ticks = [1, 5, 10, 15, 20, 25, monthDays].filter((day, index, list) => list.indexOf(day) === index && day <= monthDays);
  return (
    <div className="space-y-1">
      <div className="relative ml-[132px] h-5">
        {ticks.map((day) => <span key={day} className="absolute -translate-x-1/2 text-[11px] font-medium tabular-nums text-ds-ink-faint" style={{ left: `${((day - 0.5) / monthDays) * 100}%` }}>{day}</span>)}
      </div>
      <div className="relative">
        <div className="pointer-events-none absolute bottom-0 left-[132px] right-0 top-0">
          <span className="absolute bottom-0 top-0 w-0.5 -translate-x-1/2 bg-ds-accent" style={{ left: `${((todayDay - 0.5) / monthDays) * 100}%` }} title="Hoje" />
        </div>
        <ul className="divide-y divide-ds-divider border-y border-ds-divider">
          {items.map((item) => (
            <li key={item.id} className="flex h-12 items-center">
              <div className="flex w-[132px] shrink-0 items-center gap-2 pr-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ds-info-bg text-[11px] font-black text-ds-info">{item.initials}</span>
                <span className="truncate text-xs font-extrabold text-ds-ink">{item.name}</span>
              </div>
              <div className="relative h-full flex-1">
                <span
                  className={cn("absolute top-1/2 flex h-6 -translate-y-1/2 items-center overflow-hidden whitespace-nowrap rounded-md px-2 text-[11px] font-bold text-white", barClass[item.status] ?? "bg-ds-neutral", item.status !== "APPROVED" && "opacity-85")}
                  style={{ left: pct(item.startDay), width: `${((item.endDay - item.startDay + 1) / monthDays) * 100}%` }}
                >
                  {item.rangeLabel}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function VacationsWidget({ loading, items, monthLabel, monthDays, todayDay, onDetails }: VacationsWidgetProps) {
  const approved = items.filter((item) => item.status === "APPROVED").length;
  const planned = items.filter((item) => item.status === "PLANNED").length;
  const pending = items.filter((item) => item.status === "PENDING").length;
  return (
    <WidgetCard widgetId="vacation-calendar">
      {(density) => (
        <>
          <WidgetHead icon={widgetIcons.absences} tone="info" title={density === "compact" ? "Ausências" : "Calendário de ausências"} subtitle={`Férias previstas · ${monthLabel}`} href="/dashboard/dp/ferias" density={density} />
          {loading && items.length === 0 ? (
            <WidgetEmpty>Carregando férias...</WidgetEmpty>
          ) : items.length === 0 ? (
            <WidgetEmpty>Nenhuma ausência de férias prevista no mês corrente.</WidgetEmpty>
          ) : density === "compact" ? (
            <>
              <div className="flex items-baseline gap-3">
                <span className="text-5xl font-black leading-none tracking-tight tabular-nums text-ds-ink">{items.length}</span>
                <span className="text-xs font-semibold leading-snug text-ds-ink-muted">ausência(s)<br />prevista(s) no mês</span>
              </div>
              <div className="flex h-5 items-end gap-0.5" aria-hidden="true">
                {Array.from({ length: monthDays }, (_, index) => {
                  const day = index + 1;
                  const count = items.filter((item) => day >= item.startDay && day <= item.endDay).length;
                  return <span key={day} className={cn("flex-1 rounded-sm", count === 0 ? "bg-ds-muted" : count === 1 ? "bg-ds-info" : "bg-ds-warn", day === todayDay && "ring-1 ring-ds-accent")} style={{ height: count === 0 ? "35%" : count === 1 ? "70%" : "100%" }} />;
                })}
              </div>
              <ul className="space-y-2">
                {items.slice(0, 2).map((item) => (
                  <li key={item.id} className="flex items-center gap-2.5 text-xs">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ds-info-bg text-[11px] font-black text-ds-info">{item.initials}</span>
                    <span className="min-w-0 flex-1 truncate font-extrabold text-ds-ink">{item.name}</span>
                    <span className="whitespace-nowrap font-medium text-ds-ink-faint">{item.rangeLabel}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              {density === "wide" ? (
                <div className="grid grid-cols-4 gap-3">
                  <KpiTile label="Ausências no mês" value={String(items.length)} icon={widgetIcons.absences} tone="info" />
                  <KpiTile label="Aprovadas" value={String(approved)} tone={approved > 0 ? "ok" : "muted"} icon={widgetIcons.checklists} />
                  <KpiTile label="Planejadas" value={String(planned)} icon={widgetIcons.schedules} />
                  <KpiTile label="Aguardando aprovação" value={String(pending)} tone={pending > 0 ? "warn" : "muted"} icon={widgetIcons.workday} />
                </div>
              ) : null}
              <Timeline items={items.slice(0, density === "wide" ? 6 : 4)} monthDays={monthDays} todayDay={todayDay} />
              <div className="flex flex-wrap items-center gap-3 text-xs text-ds-ink-muted">
                <Pill tone="ok" dot>Aprovada</Pill><Pill tone="info" dot>Planejada</Pill><Pill tone="warn" dot>Pendente</Pill>
                <span className="ml-auto"><DetailsLink onClick={onDetails}>Ver detalhes</DetailsLink></span>
              </div>
            </>
          )}
          {density === "compact" && items.length > 0 ? <DetailsLink onClick={onDetails}>Ver detalhes</DetailsLink> : null}
        </>
      )}
    </WidgetCard>
  );
}
