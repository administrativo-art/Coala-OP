"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

function pickerDateFromKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function keyFromPickerDate(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export function maskScheduleTimeInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  return digits.length <= 2 ? digits : `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

export function ScheduleTimeInput({
  value,
  minimum,
  disabled,
  onChange,
  className,
}: {
  value: string;
  minimum?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      maxLength={5}
      pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]"
      placeholder="HH:MM"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(maskScheduleTimeInput(event.target.value))}
      onBlur={() => {
        if (minimum && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) && value < minimum) {
          onChange(minimum);
        }
      }}
      className={cn("h-10 w-full rounded-lg border border-ds-border-input bg-ds-input px-3 text-[14px] text-ds-ink outline-none placeholder:text-ds-ink-faint focus:border-ds-modal disabled:bg-ds-muted disabled:opacity-70", className)}
      aria-label="Horário no formato horas e minutos"
    />
  );
}

export function ScheduleDatePicker({
  value,
  minimum,
  disabled,
  onChange,
  className,
}: {
  value: string;
  minimum: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  className?: string;
}) {
  const selectedDate = useMemo(() => pickerDateFromKey(value), [value]);
  const minimumDate = useMemo(() => pickerDateFromKey(minimum) ?? new Date(), [minimum]);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"day" | "month" | "year">("day");
  const [displayMonth, setDisplayMonth] = useState<Date>(selectedDate ?? minimumDate);

  useEffect(() => {
    if (!open) return;
    setView("day");
    setDisplayMonth(selectedDate ?? minimumDate);
  }, [minimumDate, open, selectedDate]);

  const monthOptions = useMemo(
    () => Array.from({ length: 12 }, (_, index) => {
      const date = new Date(displayMonth.getFullYear(), index, 1);
      return {
        index,
        label: format(date, "MMMM", { locale: ptBR }).replace(/^\w/, (character) => character.toUpperCase()),
      };
    }),
    [displayMonth],
  );
  const yearRangeStart = Math.floor(displayMonth.getFullYear() / 12) * 12;
  const yearOptions = useMemo(
    () => Array.from({ length: 12 }, (_, index) => yearRangeStart + index),
    [yearRangeStart],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn("h-10 w-full justify-start rounded-lg border-ds-border-input bg-ds-input px-3 text-left text-[14px] font-normal text-ds-ink", className)}
        >
          {selectedDate ? format(selectedDate, "PPP", { locale: ptBR }) : "Selecione a data"}
          <CalendarIcon className="ml-auto h-4 w-4 opacity-70" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="z-[120] w-auto p-0" align="start">
        <div className="w-[320px]">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setDisplayMonth((current) => new Date(current.getFullYear() - (view === "year" ? 12 : 0), current.getMonth() - (view === "year" ? 0 : 1), 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-1">
              <Button type="button" variant="ghost" className="h-8 px-2 text-sm font-medium" onClick={() => setView("month")}>
                {format(displayMonth, "MMMM", { locale: ptBR }).replace(/^\w/, (character) => character.toUpperCase())}
              </Button>
              <Button type="button" variant="ghost" className="h-8 px-2 text-sm font-medium" onClick={() => setView("year")}>
                {format(displayMonth, "yyyy")}
              </Button>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setDisplayMonth((current) => new Date(current.getFullYear() + (view === "year" ? 12 : 0), current.getMonth() + (view === "year" ? 0 : 1), 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {view === "day" ? (
            <Calendar
              mode="single"
              selected={selectedDate}
              disabled={{ before: minimumDate }}
              fromDate={minimumDate}
              month={displayMonth}
              onMonthChange={setDisplayMonth}
              onSelect={(nextValue) => {
                if (!nextValue || nextValue < minimumDate) return;
                onChange(keyFromPickerDate(nextValue));
                setOpen(false);
              }}
              initialFocus
            />
          ) : view === "month" ? (
            <div className="grid grid-cols-3 gap-2 p-3">
              {monthOptions.map((option) => (
                <Button
                  key={option.index}
                  type="button"
                  variant={displayMonth.getMonth() === option.index ? "default" : "outline"}
                  className="justify-center"
                  disabled={new Date(displayMonth.getFullYear(), option.index + 1, 0, 23, 59) < minimumDate}
                  onClick={() => {
                    setDisplayMonth(new Date(displayMonth.getFullYear(), option.index, 1));
                    setView("day");
                  }}
                >
                  {option.label.slice(0, 3)}
                </Button>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 p-3">
              {yearOptions.map((year) => (
                <Button
                  key={year}
                  type="button"
                  variant={displayMonth.getFullYear() === year ? "default" : "outline"}
                  className="justify-center"
                  disabled={year < minimumDate.getFullYear()}
                  onClick={() => {
                    setDisplayMonth(new Date(year, displayMonth.getMonth(), 1));
                    setView("month");
                  }}
                >
                  {year}
                </Button>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
