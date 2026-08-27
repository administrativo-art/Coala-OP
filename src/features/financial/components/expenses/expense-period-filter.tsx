"use client";

import { useMemo, useState } from "react";
import { endOfMonth, format, isValid, parseISO, startOfMonth, startOfYear, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type ExpensePeriodPreset =
  | "current_month"
  | "last_3_months"
  | "last_6_months"
  | "current_year"
  | "last_12_months"
  | "custom";

const PRESETS: Array<{ value: ExpensePeriodPreset; label: string }> = [
  { value: "current_month", label: "Mês atual" },
  { value: "last_3_months", label: "Últimos 3 meses" },
  { value: "last_6_months", label: "Últimos 6 meses" },
  { value: "current_year", label: "Ano atual" },
  { value: "last_12_months", label: "Últimos 12 meses" },
  { value: "custom", label: "Personalizado" },
];

function parseFilterDate(value: string) {
  if (!value) return undefined;
  const parsed = parseISO(value);
  return isValid(parsed) ? parsed : undefined;
}

function rangeFromValues(from: string, to: string): DateRange | undefined {
  const parsedFrom = parseFilterDate(from);
  const parsedTo = parseFilterDate(to);
  return parsedFrom || parsedTo ? { from: parsedFrom, to: parsedTo } : undefined;
}

function rangeForPreset(preset: ExpensePeriodPreset, now = new Date()): DateRange | undefined {
  const monthEnd = endOfMonth(now);

  if (preset === "current_month") return { from: startOfMonth(now), to: monthEnd };
  if (preset === "current_year") return { from: startOfYear(now), to: monthEnd };
  if (preset === "last_3_months") return { from: startOfMonth(subMonths(now, 2)), to: monthEnd };
  if (preset === "last_6_months") return { from: startOfMonth(subMonths(now, 5)), to: monthEnd };
  if (preset === "last_12_months") return { from: startOfMonth(subMonths(now, 11)), to: monthEnd };

  return undefined;
}

function triggerLabel(preset: ExpensePeriodPreset, from: string, to: string) {
  if (!from && !to) return "Todos";
  if (preset !== "custom") return PRESETS.find((item) => item.value === preset)?.label || "Período";

  const parsedFrom = parseFilterDate(from);
  const parsedTo = parseFilterDate(to);
  if (parsedFrom && parsedTo) return `${format(parsedFrom, "dd/MM")} – ${format(parsedTo, "dd/MM")}`;

  return "Personalizado";
}

export function ExpensePeriodFilter({
  preset,
  dateFrom,
  dateTo,
  onApply,
}: {
  preset: ExpensePeriodPreset;
  dateFrom: string;
  dateTo: string;
  onApply: (value: { preset: ExpensePeriodPreset; dateFrom: string; dateTo: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draftPreset, setDraftPreset] = useState<ExpensePeriodPreset>(preset);
  const [draftRange, setDraftRange] = useState<DateRange | undefined>(() => rangeFromValues(dateFrom, dateTo));
  const [visibleMonth, setVisibleMonth] = useState<Date>(() => parseFilterDate(dateFrom) || new Date());
  const label = useMemo(() => triggerLabel(preset, dateFrom, dateTo), [dateFrom, dateTo, preset]);

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) return;

    const currentRange = rangeFromValues(dateFrom, dateTo);
    setDraftPreset(preset);
    setDraftRange(currentRange);
    setVisibleMonth(currentRange?.from || new Date());
  }

  function selectPreset(nextPreset: ExpensePeriodPreset) {
    setDraftPreset(nextPreset);
    if (nextPreset === "custom") return;

    const nextRange = rangeForPreset(nextPreset);
    setDraftRange(nextRange);
    if (nextRange?.from) setVisibleMonth(nextRange.from);
  }

  function applyDraft() {
    const nextDateFrom = draftRange?.from ? format(draftRange.from, "yyyy-MM-dd") : "";
    const nextDateTo = draftRange?.to ? format(draftRange.to, "yyyy-MM-dd") : "";
    onApply({
      preset: nextDateFrom || nextDateTo ? draftPreset : "custom",
      dateFrom: nextDateFrom,
      dateTo: nextDateTo,
    });
    setOpen(false);
  }

  const hasIncompleteRange = Boolean(draftRange?.from && !draftRange.to);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          data-testid="expense-due-date-filter"
          variant="outline"
        className={cn(
            "h-8 w-full min-w-0 justify-between rounded-lg border-border/70 bg-background px-2.5 text-[10.5px] font-medium sm:text-xs",
            open && "border-primary"
          )}
        >
          <span className="truncate">Vencimento: {label}</span>
          <ChevronDown className="ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-auto max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl p-0 shadow-xl">
        <div className="flex flex-col sm:flex-row">
          <div className="flex w-full flex-col gap-1 border-b bg-muted/30 p-2 sm:w-44 sm:border-b-0 sm:border-r">
            {PRESETS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={cn(
                  "rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors",
                  draftPreset === option.value
                    ? "bg-background font-semibold text-primary shadow-sm"
                    : "text-foreground/75 hover:bg-background/70"
                )}
                onClick={() => selectPreset(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="w-[302px] max-w-full p-3.5">
            <div className="mb-2 grid grid-cols-2 gap-2">
              <div>
                <p className="mb-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">De</p>
                <div className="flex h-8 items-center rounded-lg border px-2.5 font-mono text-xs font-medium">
                  {draftRange?.from ? format(draftRange.from, "dd/MM/yyyy") : "—"}
                </div>
              </div>
              <div>
                <p className="mb-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Até</p>
                <div className="flex h-8 items-center rounded-lg border px-2.5 font-mono text-xs font-medium">
                  {draftRange?.to ? format(draftRange.to, "dd/MM/yyyy") : "—"}
                </div>
              </div>
            </div>

            <Calendar
              mode="range"
              month={visibleMonth}
              onMonthChange={setVisibleMonth}
              selected={draftRange}
              onSelect={(nextRange) => {
                setDraftRange(nextRange);
                setDraftPreset("custom");
              }}
              locale={ptBR}
              showOutsideDays={false}
              className="p-0"
              classNames={{
                cell: "relative h-9 w-9 p-0 text-center text-sm focus-within:relative focus-within:z-20",
                day_selected: "rounded-lg bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
                day_range_middle: "rounded-none !bg-primary/10 !text-primary hover:!bg-primary/15",
              }}
            />

            <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3">
              <span className="text-[11px] text-muted-foreground">
                {hasIncompleteRange ? "Selecione a data final" : draftRange?.from && draftRange.to ? "Intervalo definido" : "Sem período definido"}
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-lg px-3 text-xs"
                  onClick={() => {
                    setDraftPreset("custom");
                    setDraftRange(undefined);
                  }}
                >
                  Limpar
                </Button>
                <Button type="button" size="sm" className="h-8 rounded-lg px-4 text-xs" disabled={hasIncompleteRange} onClick={applyDraft}>
                  Aplicar
                </Button>
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
