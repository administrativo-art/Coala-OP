"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** "2026-11" → "novembro de 2026" (competência por extenso, docs/design/campos.md). */
export function monthLongLabel(month: string) {
  return `${MONTHS[Number(month.slice(5, 7)) - 1]} de ${month.slice(0, 4)}`;
}

function recentMonths(count: number, now = new Date()) {
  const list: string[] = [];
  for (let offset = 0; offset < count; offset += 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    list.push(date.toISOString().slice(0, 7));
  }
  return list;
}

/** Seletor de competência no padrão do sistema (drop com a seta do guia), no lugar do `input type="month"` nativo. */
export function MonthSelect({ value, onChange, label, count = 12, className = "w-[200px]" }: {
  value: string; onChange: (month: string) => void; label: string; count?: number; className?: string;
}) {
  const options = recentMonths(count);
  if (value && !options.includes(value)) options.push(value);
  return <Select value={value || undefined} onValueChange={onChange}>
    <SelectTrigger aria-label={label} className={`${className} font-semibold normal-case tracking-normal`}><SelectValue placeholder="Escolha o mês" /></SelectTrigger>
    <SelectContent>{options.map(month => <SelectItem key={month} value={month}>{monthLongLabel(month)}</SelectItem>)}</SelectContent>
  </Select>;
}
