"use client";

import { useState } from "react";
import { endOfMonth, format, parseISO, startOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import { CalendarRange, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type PickerRange = { from: string; to: string };
export type PickerPreset = { value: string; label: string; range: PickerRange };
export type PickerValue = PickerRange & { preset: string };

const iso = (date: Date) => format(date, "yyyy-MM-dd");
const br = (value: string) => format(parseISO(value), "dd/MM/yyyy");

/**
 * Seletor de período com atalhos e calendário de intervalo, no padrão do filtro de vencimento de Despesas.
 * `minDate` e `maxDate` limitam o que pode ser escolhido (futuro nas projeções, passado em Movimentações).
 */
export function RangePicker({ value, presets, minDate, maxDate, label, onApply, className }: {
  value: PickerValue;
  presets: PickerPreset[];
  minDate: string;
  maxDate: string;
  /** Texto do botão, já formatado pelo chamador. */
  label: string;
  onApply: (value: PickerValue) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draftPreset, setDraftPreset] = useState(value.preset);
  const [draft, setDraft] = useState<DateRange | undefined>({ from: parseISO(value.from), to: parseISO(value.to) });
  const [visibleMonth, setVisibleMonth] = useState<Date>(parseISO(value.from));

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) return;
    setDraftPreset(value.preset);
    setDraft({ from: parseISO(value.from), to: parseISO(value.to) });
    setVisibleMonth(parseISO(value.from));
  };
  const clamp = (range: PickerRange): PickerRange => ({ from: range.from < minDate ? minDate : range.from, to: range.to > maxDate ? maxDate : range.to });
  const selectPreset = (preset: PickerPreset | null) => {
    if (!preset) { setDraftPreset("custom"); return; }
    const range = clamp(preset.range);
    setDraftPreset(preset.value);
    setDraft({ from: parseISO(range.from), to: parseISO(range.to) });
    setVisibleMonth(parseISO(range.from));
  };
  const selectMonth = (month: Date) => {
    const range = clamp({ from: iso(startOfMonth(month)), to: iso(endOfMonth(month)) });
    setDraftPreset("custom");
    setDraft({ from: parseISO(range.from), to: parseISO(range.to) });
  };
  const incomplete = Boolean(draft?.from && !draft.to);
  const ready = Boolean(draft?.from && draft.to);
  const apply = () => {
    if (!draft?.from || !draft.to) return;
    onApply({ preset: draftPreset, from: iso(draft.from), to: iso(draft.to) });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button type="button" variant="on-dark-secondary" size="md" aria-label={`Período: ${label}`} className={cn("gap-2", className)}>
          <CalendarRange aria-hidden="true" className="h-3.5 w-3.5" />
          <span>{label}</span>
          <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 opacity-70" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className="w-auto max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl p-0 shadow-xl">
        <div className="flex flex-col sm:flex-row">
          <div className="flex w-full flex-col gap-1 border-b bg-muted/30 p-2 sm:w-52 sm:border-b-0 sm:border-r">
            {[...presets, { value: "custom", label: "Personalizado", range: value } as PickerPreset].map(option => (
              <button
                key={option.value}
                type="button"
                className={cn("rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors", draftPreset === option.value ? "bg-background font-semibold text-primary shadow-xs" : "text-foreground/75 hover:bg-background/70")}
                onClick={() => selectPreset(option.value === "custom" ? null : option)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="w-[302px] max-w-full p-3.5">
            <div className="mb-2 grid grid-cols-2 gap-2">
              {([["De", draft?.from], ["Até", draft?.to]] as const).map(([name, date]) => (
                <div key={name}>
                  <p className="mb-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{name}</p>
                  <div className="flex h-8 items-center rounded-lg border px-2.5 font-mono text-xs font-medium">{date ? format(date, "dd/MM/yyyy") : "—"}</div>
                </div>
              ))}
            </div>
            <Calendar
              mode="range"
              month={visibleMonth}
              onMonthChange={setVisibleMonth}
              selected={draft}
              onSelect={next => { setDraft(next); setDraftPreset("custom"); }}
              disabled={{ before: parseISO(minDate), after: parseISO(maxDate) }}
              locale={ptBR}
              showOutsideDays={false}
              className="p-0"
              components={{
                CaptionLabel: ({ id, displayMonth }) => (
                  <button
                    id={id}
                    type="button"
                    title="Selecionar o mês inteiro"
                    aria-label={`Selecionar ${format(displayMonth, "MMMM 'de' yyyy", { locale: ptBR })} inteiro`}
                    className="rounded-md px-2 py-1 text-sm font-semibold transition-colors hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => selectMonth(displayMonth)}
                  >
                    {format(displayMonth, "MMMM yyyy", { locale: ptBR })}
                  </button>
                ),
              }}
              classNames={{
                cell: "relative h-9 w-9 p-0 text-center text-sm focus-within:relative focus-within:z-20",
                day_selected: "rounded-lg bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
                day_range_middle: "rounded-none bg-primary/10! text-primary! hover:bg-primary/15!",
              }}
            />
            <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3">
              <span className="text-[11px] text-muted-foreground">
                {incomplete ? "Selecione a data final" : ready ? `${br(iso(draft!.from!))} a ${br(iso(draft!.to!))}` : "Sem período definido"}
              </span>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg px-3 text-xs" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button type="button" size="sm" className="h-8 rounded-lg px-4 text-xs" disabled={!ready} onClick={apply}>Aplicar</Button>
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
