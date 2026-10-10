"use client";

import type { MonthOption } from "./month-range";

/** Filtro de mês/ano para o cabeçalho de um widget. */
export function MonthFilter({ label, value, months, onChange }: { label: string; value: string; months: MonthOption[]; onChange: (key: string) => void }) {
  const options = months.some((month) => month.key === value) ? months : [{ key: value, label: value }, ...months];
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 w-full rounded-lg border border-ds-border bg-ds-surface px-3 text-xs font-semibold capitalize text-ds-ink-muted outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink"
    >
      {options.map((month) => (
        <option key={month.key} value={month.key}>{month.label}</option>
      ))}
    </select>
  );
}
