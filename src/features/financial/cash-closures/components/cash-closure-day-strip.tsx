import type { ClosureDayStatus, MonthDayStatus } from "../analysis";
import { cn } from "@/lib/utils";

export const DAY_STATUS_META: Record<ClosureDayStatus, { label: string; cell: string; soft: string; ink: string }> = {
  ok: { label: "Bateu", cell: "bg-ds-ok", soft: "bg-ds-ok-bg", ink: "text-ds-ok" },
  difference: { label: "Aprovado com diferença", cell: "bg-ds-caution", soft: "bg-ds-caution-bg", ink: "text-ds-caution" },
  pending: { label: "Contagem pendente", cell: "bg-ds-warn", soft: "bg-ds-warn-bg", ink: "text-ds-alert-ink" },
  draft: { label: "Rascunho", cell: "bg-ds-neutral", soft: "bg-ds-neutral-bg", ink: "text-ds-ink-2" },
  error: { label: "Erro de sincronização", cell: "bg-ds-danger", soft: "bg-ds-danger-bg", ink: "text-ds-confirm-ink" },
  missing: { label: "Não sincronizado", cell: "bg-ds-border-input", soft: "bg-ds-muted", ink: "text-ds-ink-muted" },
  today: { label: "Hoje", cell: "bg-ds-surface ring-2 ring-inset ring-ds-accent", soft: "bg-ds-surface ring-2 ring-inset ring-ds-accent", ink: "text-ds-accent-ink" },
  future: { label: "Ainda não aconteceu", cell: "bg-ds-muted ring-1 ring-inset ring-ds-border", soft: "bg-ds-muted", ink: "text-ds-ink-faint" },
};

export const DAY_STATUS_LEGEND: ClosureDayStatus[] = ["ok", "difference", "pending", "draft", "error", "missing"];

export function DayStatusLegend({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-ds-ink-2", className)}>
      {DAY_STATUS_LEGEND.map((status) => (
        <span key={status} className="inline-flex items-center gap-1.5">
          <span className={cn("h-2.5 w-2.5 rounded-[3px]", DAY_STATUS_META[status].cell)} />
          {DAY_STATUS_META[status].label}
        </span>
      ))}
    </div>
  );
}

/** Faixa compacta: um traço por dia do mês. */
export function CashClosureDayStrip({ days, label }: { days: MonthDayStatus[]; label: string }) {
  return (
    <span className="grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }} role="img" aria-label={label}>
      {days.map((day) => (
        <span key={day.date} title={`${day.date.split("-").reverse().join("/")} · ${DAY_STATUS_META[day.status].label}`} className={cn("h-4 rounded-[2px]", DAY_STATUS_META[day.status].cell)} />
      ))}
    </span>
  );
}
