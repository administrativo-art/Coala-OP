"use client";

import React, { useMemo } from 'react';
import {
  addMonths, differenceInCalendarDays, endOfMonth, getDaysInMonth,
  startOfMonth, format, parseISO, max as maxDate, min as minDate,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';

import type { User, DPVacationRecord } from '@/types';
import { VACATION_STATUS_HEX } from '@/lib/utils/vacation-logic';

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase();
}

const DAY_WIDTH = 30;   // px per day
const NAME_COL = 220;   // sticky name column width
const ROW_H = 92;       // row height
const HEAD_H = 58;      // month-header height
const BAR_H = 40;       // vacation bar height
const MONTHS_SPAN = 3;  // visible window in months

interface Props {
  users: User[];
  /** gozo records (any non-rejected status) with start & end dates */
  vacations: DPVacationRecord[];
  onSelectUser: (userId: string) => void;
}

export function DPVacationTimeline({ users, vacations, onSelectUser }: Props) {
  const { months, winStart, winEnd, totalDays } = useMemo(() => {
    const start = startOfMonth(new Date());
    const months = Array.from({ length: MONTHS_SPAN }, (_, i) => addMonths(start, i));
    const winEnd = endOfMonth(months[months.length - 1]);
    const totalDays = months.reduce((t, m) => t + getDaysInMonth(m), 0);
    return { months, winStart: start, winEnd, totalDays };
  }, []);

  const laneWidth = totalDays * DAY_WIDTH;
  const todayOffset = differenceInCalendarDays(startOfDayLocal(new Date()), winStart) * DAY_WIDTH;
  const todayInWindow = todayOffset >= 0 && todayOffset <= laneWidth;

  // Rows: only operational users who actually have a bar in the visible window.
  const rows = useMemo(() => {
    return users
      .map(user => {
        const bars = vacations
          .filter(v => v.userId === user.id && v.startDate && v.endDate)
          .map(v => {
            const rs = parseISO(v.startDate!);
            const re = parseISO(v.endDate!);
            if (re < winStart || rs > winEnd) return null;
            const clampedStart = maxDate([rs, winStart]);
            const clampedEnd = minDate([re, winEnd]);
            const startOff = differenceInCalendarDays(clampedStart, winStart);
            const widthDays = differenceInCalendarDays(clampedEnd, clampedStart) + 1;
            if (widthDays <= 0) return null;
            const cfg = VACATION_STATUS_HEX[v.status] ?? VACATION_STATUS_HEX.PENDING;
            return {
              id: v.id,
              tooltip: `${format(rs, 'dd/MM')} → ${format(re, 'dd/MM')} · ${cfg.label}`,
              left: startOff * DAY_WIDTH + 2,
              width: widthDays * DAY_WIDTH - 4,
              color: cfg.fg,
            };
          })
          .filter(Boolean) as { id: string; tooltip: string; left: number; width: number; color: string }[];
        return { user, bars };
      })
      .filter(r => r.bars.length > 0);
  }, [users, vacations, winStart, winEnd]);

  return (
    <div className="rounded-2xl border bg-card p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Timeline de férias</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {capitalize(format(months[0], 'MMM', { locale: ptBR }))}–
            {capitalize(format(months[months.length - 1], 'MMM yyyy', { locale: ptBR }))} · role para o lado para navegar.
          </p>
        </div>
        <div className="flex items-center gap-5">
          <LegendDot color={VACATION_STATUS_HEX.APPROVED.fg} label="Aprovada" />
          <LegendDot color={VACATION_STATUS_HEX.PLANNED.fg} label="Planejada" />
          <LegendDot color={VACATION_STATUS_HEX.PENDING.fg} label="Pendente" />
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
          Nenhuma férias prevista para os próximos {MONTHS_SPAN} meses.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <div className="flex w-max">
            {/* Sticky name column */}
            <div
              className="sticky left-0 z-[2] flex-shrink-0 border-r bg-card"
              style={{ width: NAME_COL }}
            >
              <div style={{ height: HEAD_H }} className="border-b" />
              {rows.map(({ user }) => (
                <button
                  key={user.id}
                  onClick={() => onSelectUser(user.id)}
                  style={{ height: ROW_H }}
                  className="flex w-full items-center gap-3.5 border-b px-4 text-left transition-colors hover:bg-muted/40"
                >
                  <span
                    className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                    style={{ background: user.color || '#8B5CF6' }}
                  >
                    {initials(user.username)}
                  </span>
                  <span className="truncate text-sm font-semibold">{user.username}</span>
                </button>
              ))}
            </div>

            {/* Lanes */}
            <div className="relative flex-shrink-0" style={{ width: laneWidth }}>
              <div className="flex border-b" style={{ height: HEAD_H }}>
                {months.map(m => (
                  <div
                    key={m.toISOString()}
                    style={{ width: getDaysInMonth(m) * DAY_WIDTH }}
                    className="flex flex-shrink-0 items-center justify-center border-r text-sm font-bold uppercase tracking-wider text-muted-foreground"
                  >
                    {capitalize(format(m, 'MMMM yyyy', { locale: ptBR }))}
                  </div>
                ))}
              </div>

              {todayInWindow && (
                <div
                  className="absolute bottom-0 top-0 z-[1] w-0.5 bg-primary"
                  style={{ left: todayOffset }}
                />
              )}

              {rows.map(({ user, bars }) => (
                <div key={user.id} style={{ height: ROW_H }} className="relative border-b">
                  {bars.map(bar => (
                    <div
                      key={bar.id}
                      title={bar.tooltip}
                      className="absolute rounded-full"
                      style={{
                        top: (ROW_H - BAR_H) / 2,
                        left: bar.left,
                        width: bar.width,
                        height: BAR_H,
                        background: bar.color,
                        opacity: 0.85,
                      }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function startOfDayLocal(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
