"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const MONTHS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
] as const;

type ExpenseCompetencePickerProps = {
  value: string;
  options: string[];
  onValueChange: (value: string) => void;
  className?: string;
};

function yearFromCompetence(value: string) {
  const year = Number(value.slice(0, 4));
  return Number.isInteger(year) ? year : null;
}

export function ExpenseCompetencePicker({
  value,
  options,
  onValueChange,
  className,
}: ExpenseCompetencePickerProps) {
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentCompetence = `${currentYear}-${String(currentDate.getMonth() + 1).padStart(2, "0")}`;
  const selectedYear = value === "all" ? null : yearFromCompetence(value);
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(selectedYear ?? currentYear);
  const availableCompetences = useMemo(() => new Set(options), [options]);
  const availableYears = useMemo(
    () => Array.from(new Set(options.map(yearFromCompetence).filter((year): year is number => year !== null)))
      .sort((left, right) => left - right),
    [options]
  );
  const minimumYear = availableYears[0] ?? currentYear;
  const maximumYear = availableYears.at(-1) ?? currentYear;
  const selectedLabel = value === "all"
    ? "Todas"
    : `${value.slice(5, 7)}/${value.slice(0, 4)}`;

  useEffect(() => {
    if (open) setViewYear(selectedYear ?? currentYear);
  }, [currentYear, open, selectedYear]);

  function selectCompetence(competence: string) {
    onValueChange(competence);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={`Competência: ${selectedLabel}`}
          data-testid="expense-competence-filter"
          className={cn(
            "h-8 w-full min-w-0 justify-start rounded-lg border-border/70 bg-background px-2.5 text-[10.5px] font-normal shadow-none sm:text-xs",
            className
          )}
        >
          <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-left">Competência: {selectedLabel}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-[320px] overflow-hidden rounded-xl p-0 shadow-xl">
        <div className="border-b bg-muted/25 px-4 py-3">
          <p className="text-sm font-semibold text-foreground">Competência</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Escolha o mês e o ano de referência.</p>
        </div>

        <div className="p-3">
          <div className="mb-3 flex items-center justify-between rounded-lg border bg-background p-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-md"
              onClick={() => setViewYear((year) => year - 1)}
              disabled={viewYear <= minimumYear}
              aria-label="Ano anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-20 text-center text-sm font-semibold tabular-nums">{viewYear}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-md"
              onClick={() => setViewYear((year) => year + 1)}
              disabled={viewYear >= maximumYear}
              aria-label="Próximo ano"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="grid grid-cols-3 gap-1.5" aria-label={`Meses de ${viewYear}`}>
            {MONTHS.map((monthLabel, monthIndex) => {
              const competence = `${viewYear}-${String(monthIndex + 1).padStart(2, "0")}`;
              const isAvailable = availableCompetences.has(competence);
              const isSelected = value === competence;
              const isCurrent = currentCompetence === competence;

              return (
                <Button
                  key={competence}
                  type="button"
                  variant="ghost"
                  className={cn(
                    "relative h-10 rounded-lg px-2 text-xs font-medium",
                    isAvailable && !isSelected && "border border-transparent hover:border-border hover:bg-muted/70",
                    isCurrent && !isSelected && "border-primary/30 bg-primary/[0.04] text-primary",
                    isSelected && "bg-primary text-primary-foreground shadow-sm hover:bg-primary hover:text-primary-foreground"
                  )}
                  disabled={!isAvailable}
                  onClick={() => selectCompetence(competence)}
                  aria-label={`${monthLabel} de ${viewYear}`}
                  aria-pressed={isSelected}
                >
                  {isSelected ? <Check className="h-3.5 w-3.5" /> : null}
                  {monthLabel.slice(0, 3)}
                </Button>
              );
            })}
          </div>
        </div>

        <div className="border-t bg-muted/20 p-2">
          <Button
            type="button"
            variant="ghost"
            className={cn(
              "h-9 w-full justify-between rounded-lg px-3 text-xs font-medium",
              value === "all" && "bg-background text-primary shadow-sm"
            )}
            onClick={() => selectCompetence("all")}
          >
            Todas as competências
            {value === "all" ? <Check className="h-3.5 w-3.5" /> : null}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
