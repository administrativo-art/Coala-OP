"use client";

import { Button } from "@/components/ui/button";

import { MONTH_CLOSING_FIRST_MONTH, isClosableRange, monthLabel, shiftMonth } from "./month";

const NAME_ONLY = (month: string) => monthLabel(month).split(" de ")[0];

/** Troca de competência no painel escuro. Limites: início da DRE até o mês corrente. */
export function MonthNav({ month, onChange }: { month: string; onChange: (month: string) => void }) {
  const previous = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  const canGoBack = previous >= MONTH_CLOSING_FIRST_MONTH;
  const canGoForward = isClosableRange(next);
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Competência">
      <Button type="button" variant="on-dark-secondary" size="sm" disabled={!canGoBack} onClick={() => onChange(previous)} aria-label={`Competência anterior: ${monthLabel(previous)}`}>
        ‹ {NAME_ONLY(previous)}
      </Button>
      <span className="inline-flex h-9 items-center rounded-ds-btn bg-white/8 px-3.5 text-[13px] font-bold text-ds-on-dark" aria-live="polite">{monthLabel(month)}</span>
      <Button type="button" variant="on-dark-secondary" size="sm" disabled={!canGoForward} onClick={() => onChange(next)} aria-label={`Próxima competência: ${monthLabel(next)}`}>
        {NAME_ONLY(next)} ›
      </Button>
    </div>
  );
}
