"use client";

import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { widgetIcons } from "./icons";
import { DetailsLink, Pill, WidgetCard, WidgetEmpty, WidgetHead } from "./kit";

export type ScheduleShift = { id: string; name: string; time: string; initials: string };
export type ScheduleDay = { key: string; weekday: string; dateLabel: string; isToday: boolean; shifts: ScheduleShift[] };

export type ScheduleWidgetProps = {
  days: ScheduleDay[];
  /** Mensagem quando não há escala ou turnos a mostrar. */
  emptyMessage: string | null;
  unitFilter: ReactNode;
  unitLabel: string;
  onMonth: () => void;
};

function ShiftLine({ shift }: { shift: ScheduleShift }) {
  return (
    <li className="flex items-center gap-2.5 rounded-ds-card border border-ds-divider bg-ds-surface p-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ds-info-bg text-[11px] font-black text-ds-info">{shift.initials}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-extrabold text-ds-ink">{shift.name}</p>
        <p className="text-xs font-medium text-ds-ink-faint">{shift.time}</p>
      </div>
    </li>
  );
}

export function ScheduleWidget({ days, emptyMessage, unitFilter, unitLabel, onMonth }: ScheduleWidgetProps) {
  const today = days.find((day) => day.isToday) ?? days[0];
  const [picked, setPicked] = useState<string | null>(null);
  const selected = days.find((day) => day.key === picked) ?? today;
  return (
    <WidgetCard widgetId="weekly-schedule">
      {(density) => (
        <>
          <WidgetHead icon={widgetIcons.schedule} tone="neutral" title={density === "compact" ? "Escala de hoje" : "Escala da semana"} subtitle={unitLabel} href="/dashboard/dp/schedules" density={density} />
          {density !== "compact" ? unitFilter : null}
          {emptyMessage || !selected ? (
            <WidgetEmpty>{emptyMessage ?? "Nenhum turno cadastrado para esta semana."}</WidgetEmpty>
          ) : density === "compact" ? (
            <>
              <div className="flex items-center gap-2">
                <Pill tone={selected.shifts.length > 0 ? "ok" : "neutral"} dot>{selected.shifts.length > 0 ? `${selected.shifts.length} pessoa(s) hoje` : "Folga"}</Pill>
                <span className="text-xs font-medium text-ds-ink-muted">{selected.weekday} · {selected.dateLabel}</span>
              </div>
              {selected.shifts.length === 0 ? <WidgetEmpty>Ninguém escalado hoje.</WidgetEmpty> : <ul className="space-y-2">{selected.shifts.slice(0, 3).map((shift) => <ShiftLine key={shift.id} shift={shift} />)}</ul>}
            </>
          ) : density === "medium" ? (
            <>
              <div className="grid grid-cols-7 gap-1.5" role="tablist" aria-label="Dias da semana">
                {days.map((day) => (
                  <button
                    key={day.key}
                    type="button"
                    role="tab"
                    aria-selected={day.key === selected.key}
                    onClick={() => setPicked(day.key)}
                    className={cn("flex flex-col items-center gap-0.5 rounded-ds-card border px-1 py-2 text-xs transition-colors", day.key === selected.key ? "border-ds-accent bg-ds-accent text-white" : "border-ds-divider bg-ds-muted text-ds-ink hover:bg-ds-divider")}
                  >
                    <span className="font-bold uppercase">{day.weekday}</span>
                    <span className="text-sm font-black tabular-nums">{day.dateLabel.slice(0, 2)}</span>
                    <span className={cn("mt-0.5 h-1.5 w-1.5 rounded-full", day.shifts.length === 0 ? "bg-ds-border" : day.key === selected.key ? "bg-white" : "bg-ds-ok")} />
                  </button>
                ))}
              </div>
              {selected.shifts.length === 0 ? <WidgetEmpty>Folga em {selected.dateLabel}.</WidgetEmpty> : <ul className="space-y-2">{selected.shifts.slice(0, 4).map((shift) => <ShiftLine key={shift.id} shift={shift} />)}</ul>}
            </>
          ) : (
            <div className="grid grid-cols-7 gap-2">
              {days.map((day) => (
                <div key={day.key} className={cn("min-h-[132px] rounded-ds-card border p-2.5", day.isToday ? "border-ds-accent bg-ds-accent-soft" : "border-ds-divider bg-ds-muted")}>
                  <div className="flex items-center justify-between">
                    <span className={cn("text-xs font-black uppercase", day.isToday ? "text-ds-accent-ink" : "text-ds-ink-faint")}>{day.weekday}</span>
                    <span className="text-xs font-bold tabular-nums text-ds-ink-muted">{day.dateLabel}</span>
                  </div>
                  {day.shifts.length === 0 ? (
                    <p className="mt-3 rounded-md border border-dashed border-ds-border px-2 py-2 text-center text-xs font-bold text-ds-ink-faint">Folga</p>
                  ) : (
                    <ul className="mt-2 space-y-1.5">
                      {day.shifts.slice(0, 3).map((shift) => (
                        <li key={shift.id} className="rounded-md bg-ds-surface px-2 py-1.5 shadow-sm">
                          <p className="truncate text-xs font-extrabold text-ds-ink-2">{shift.name}</p>
                          <p className="text-[10px] font-semibold text-ds-ink-faint">{shift.time}</p>
                        </li>
                      ))}
                      {day.shifts.length > 3 ? <li className="text-center text-[11px] font-bold text-ds-ink-faint">+{day.shifts.length - 3}</li> : null}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
          {!emptyMessage ? <DetailsLink onClick={onMonth}>Ver escala do mês</DetailsLink> : null}
        </>
      )}
    </WidgetCard>
  );
}
