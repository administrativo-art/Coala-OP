"use client";

import { useEffect, useMemo, useState } from 'react';
import { addDays, addMonths, addWeeks, format, parseISO } from 'date-fns';
import { CalendarDays } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';

type InstallmentModel = 'monthly' | 'custom';
type CustomPeriodUnit = 'days' | 'weeks' | 'months';

interface InstallmentPlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dueDates: string[];
  fallbackStartDate: string;
  onSave: (dueDates: string[]) => void;
}

function safeDate(value: string) {
  const parsed = parseISO(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function buildDates(
  startDate: string,
  count: number,
  model: InstallmentModel,
  interval: number,
  unit: CustomPeriodUnit,
) {
  const start = safeDate(startDate);
  const safeCount = Math.max(2, count);
  const safeInterval = Math.max(1, interval);

  return Array.from({ length: safeCount }, (_, index) => {
    if (model === 'monthly') return format(addMonths(start, index), 'yyyy-MM-dd');
    if (unit === 'days') return format(addDays(start, index * safeInterval), 'yyyy-MM-dd');
    if (unit === 'weeks') return format(addWeeks(start, index * safeInterval), 'yyyy-MM-dd');
    return format(addMonths(start, index * safeInterval), 'yyyy-MM-dd');
  });
}

export function InstallmentPlanDialog({
  open,
  onOpenChange,
  dueDates,
  fallbackStartDate,
  onSave,
}: InstallmentPlanDialogProps) {
  const initialStartDate = dueDates[0] || fallbackStartDate || format(new Date(), 'yyyy-MM-dd');
  const [model, setModel] = useState<InstallmentModel>('monthly');
  const [count, setCount] = useState(Math.max(2, dueDates.length || 2));
  const [startDate, setStartDate] = useState(initialStartDate);
  const [interval, setInterval] = useState(1);
  const [unit, setUnit] = useState<CustomPeriodUnit>('days');
  const [draftDates, setDraftDates] = useState<string[]>(
    dueDates.length >= 2 ? dueDates : buildDates(initialStartDate, 2, 'monthly', 1, 'months'),
  );

  useEffect(() => {
    if (!open) return;
    const nextStartDate = dueDates[0] || fallbackStartDate || format(new Date(), 'yyyy-MM-dd');
    const nextCount = Math.max(2, dueDates.length || 2);
    setModel('monthly');
    setCount(nextCount);
    setStartDate(nextStartDate);
    setInterval(1);
    setUnit('days');
    setDraftDates(
      dueDates.length >= 2
        ? dueDates
        : buildDates(nextStartDate, nextCount, 'monthly', 1, 'months'),
    );
  }, [dueDates, fallbackStartDate, open]);

  const calculatedEndDate = useMemo(
    () => draftDates[draftDates.length - 1] ?? '',
    [draftDates],
  );

  const recalculate = (
    nextModel = model,
    nextCount = count,
    nextStartDate = startDate,
    nextInterval = interval,
    nextUnit = unit,
  ) => {
    setDraftDates(buildDates(nextStartDate, nextCount, nextModel, nextInterval, nextUnit));
  };

  const updateDate = (index: number, value: string) => {
    setDraftDates((current) => current.map((date, dateIndex) => (dateIndex === index ? value : date)));
  };

  const validDates =
    draftDates.length >= 2 &&
    draftDates.every(Boolean) &&
    draftDates.every((date, index) => index === 0 || date >= draftDates[index - 1]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />
            Definir parcelamento
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Modelo</Label>
            <Select
              value={model}
              onValueChange={(value) => {
                const nextModel = value as InstallmentModel;
                setModel(nextModel);
                recalculate(nextModel);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">Parcelas mensais</SelectItem>
                <SelectItem value="custom">Período personalizado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Número de parcelas</Label>
            <Input
              type="number"
              min={2}
              value={count}
              onChange={(event) => {
                const nextCount = Math.max(2, Number(event.target.value || 2));
                setCount(nextCount);
                recalculate(model, nextCount);
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Primeiro vencimento</Label>
            <Input
              type="date"
              value={startDate}
              onChange={(event) => {
                const nextStartDate = event.target.value;
                setStartDate(nextStartDate);
                recalculate(model, count, nextStartDate);
              }}
            />
          </div>

          {model === 'custom' && (
            <>
              <div className="space-y-1.5">
                <Label>Intervalo</Label>
                <Input
                  type="number"
                  min={1}
                  value={interval}
                  onChange={(event) => {
                    const nextInterval = Math.max(1, Number(event.target.value || 1));
                    setInterval(nextInterval);
                    recalculate(model, count, startDate, nextInterval);
                  }}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Período</Label>
                <Select
                  value={unit}
                  onValueChange={(value) => {
                    const nextUnit = value as CustomPeriodUnit;
                    setUnit(nextUnit);
                    recalculate(model, count, startDate, interval, nextUnit);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="days">Dias</SelectItem>
                    <SelectItem value="weeks">Semanas</SelectItem>
                    <SelectItem value="months">Meses</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          <div className="rounded-lg border bg-muted/30 p-3 text-sm sm:col-span-2">
            Término calculado: <strong>{calculatedEndDate ? format(safeDate(calculatedEndDate), 'dd/MM/yyyy') : '—'}</strong>
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label>Vencimentos das parcelas</Label>
            <ScrollArea className="h-48 rounded-lg border">
              <div className="space-y-2 p-3 pr-5">
                {draftDates.map((date, index) => (
                  <div key={index} className="grid grid-cols-[5rem_1fr] items-center gap-3">
                    <span className="text-sm text-muted-foreground">{index + 1}ª parcela</span>
                    <Input type="date" value={date} onChange={(event) => updateDate(index, event.target.value)} />
                  </div>
                ))}
              </div>
            </ScrollArea>
            {!validDates && (
              <p className="text-xs text-destructive">
                Preencha todas as datas em ordem crescente.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={!validDates}
            onClick={() => {
              onSave(draftDates);
              onOpenChange(false);
            }}
          >
            Aplicar parcelamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
