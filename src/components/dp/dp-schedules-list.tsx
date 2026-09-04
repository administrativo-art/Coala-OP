"use client";

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { collection, getDocs, limit, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';

import { useDP } from '@/components/dp-context';
import { useAuth } from '@/hooks/use-auth';
import { useAccessibleDPSchedules } from '@/hooks/use-accessible-dp-schedules';
import type { DPSchedule, DPShift, DPShiftDefinition, DPUnit } from '@/types';
import {
  getShiftDefinitionUnitIds,
  shiftDefinitionMatchesUnit,
} from '@/lib/dp-shift-definitions';
import { isWorkShift } from '@/lib/dp-shift-rules';
import { buildBizneoExportDayOffBlockers } from '@/lib/dp-bizneo-export-preflight';
import { activeOperationalUnits, canonicalOperationalUnitId } from '@/lib/dp-units';
import { formatDPSchedulePeriod, getAutomaticDPSchedulePeriods } from '@/lib/dp-schedule-periods';
import { filterUnitsByAccess } from '@/lib/unit-access';
import { resolveDPUnitCity } from '@/lib/dp-unit-city';
import { countExpectedDPUnitDays } from '@/lib/dp-schedule-progress';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AlertTriangle, ChevronRight, Download, Lock, Plus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { createAuditLog } from '@/features/audit/client';
import { DPSchedulesSidebar, type DPSchedulesSidebarGroup } from '@/components/dp/dp-schedules-sidebar';
import { useDPScheduleFilledDays } from '@/hooks/use-dp-schedule-filled-days';

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 4 }, (_, i) => currentYear - 1 + i);
const PLANNING_YEARS = Array.from({ length: 6 }, (_, i) => currentYear + i);

const BRAZILIAN_STATE_NAMES: Record<string, string> = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará',
  DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso',
  MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná',
  PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte',
  RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina',
  SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
};

function normalizeLocationLabel(value: string) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function stateCodeOf(state: string) {
  const upper = state.toUpperCase();
  if (BRAZILIAN_STATE_NAMES[upper]) return upper;
  return Object.entries(BRAZILIAN_STATE_NAMES)
    .find(([, name]) => normalizeLocationLabel(name) === normalizeLocationLabel(state))?.[0] ?? '—';
}

function resolveBizneoShiftId(def?: { bizneoTemplateId?: string; code?: string }) {
  const explicitId = String(def?.bizneoTemplateId ?? '').trim();
  if (explicitId) return explicitId.replace(/^#/, '');

  const rawCode = String(def?.code ?? '').trim();
  const numericCode = rawCode.match(/^#?(\d+)$/);
  return numericCode?.[1] ?? '';
}

function getShiftWeekday(date: string) {
  return new Date(`${date}T12:00:00`).getDay();
}

function formatShiftDate(date: string) {
  const [year, month, day] = date.split('-');
  if (!year || !month || !day) return date;
  return `${day}/${month}/${year}`;
}

function resolveShiftDefinitionForExport(
  shift: DPShift,
  unitId: string | undefined,
  shiftDefinitions: DPShiftDefinition[],
  defMap: Map<string, DPShiftDefinition>
) {
  if (shift.shiftDefinitionId) {
    const direct = defMap.get(shift.shiftDefinitionId);
    if (direct) return direct;
  }

  const weekday = getShiftWeekday(shift.date);
  const timeMatches = shiftDefinitions.filter((def) => {
    if (def.startTime !== shift.startTime || def.endTime !== shift.endTime) return false;
    return !def.daysOfWeek?.length || def.daysOfWeek.includes(weekday);
  });

  if (timeMatches.length === 0) return undefined;

  if (unitId) {
    const exactUnitMatches = timeMatches.filter((def) => {
      const linkedUnitIds = getShiftDefinitionUnitIds(def);
      return linkedUnitIds.length > 0 && linkedUnitIds.includes(unitId);
    });
    if (exactUnitMatches.length === 1) return exactUnitMatches[0];
  }

  const globalMatches = timeMatches.filter((def) => getShiftDefinitionUnitIds(def).length === 0);
  if (globalMatches.length === 1) return globalMatches[0];

  const compatibleMatches = unitId
    ? timeMatches.filter((def) => shiftDefinitionMatchesUnit(def, unitId))
    : timeMatches;

  if (compatibleMatches.length === 1) return compatibleMatches[0];

  return undefined;
}

function AddScheduleMonthDialog({
  open,
  onOpenChange,
  schedules,
  onSelectPeriod,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schedules: DPSchedule[];
  onSelectPeriod: (year: number, month: number, isNew: boolean) => void;
}) {
  const initialPeriod = new Date(new Date().getFullYear(), new Date().getMonth() + 2, 1);
  const [month, setMonth] = useState(initialPeriod.getMonth() + 1);
  const [year, setYear] = useState(initialPeriod.getFullYear());
  const alreadyStarted = schedules.some((schedule) => schedule.year === year && schedule.month === month);

  function handleContinue() {
    onOpenChange(false);
    onSelectPeriod(year, month, !alreadyStarted);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Adicionar mês</DialogTitle>
          <DialogDescription>
            {alreadyStarted
              ? 'Este mês já possui escalas. Você será direcionado para ele.'
              : 'Escolha o período que deseja adiantar. Em seguida, crie a primeira escala de unidade.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="space-y-1.5">
            <Label>Mês</Label>
            <Select value={String(month)} onValueChange={(value) => setMonth(Number(value))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTHS.map((name, index) => (
                  <SelectItem key={name} value={String(index + 1)}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Ano</Label>
            <Select value={String(year)} onValueChange={(value) => setYear(Number(value))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PLANNING_YEARS.map((planningYear) => (
                  <SelectItem key={planningYear} value={String(planningYear)}>{planningYear}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="button" onClick={handleContinue}>
            {alreadyStarted ? 'Abrir mês' : 'Adicionar e criar escala'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const scheduleSchema = z.object({
  month: z.coerce.number().min(1).max(12),
  year: z.coerce.number().min(2020),
  calendarId: z.string().min(1, 'Selecione um calendário de feriados.'),
  unitId: z.string().min(1, 'Selecione uma unidade.'),
});

type ScheduleFormValues = z.infer<typeof scheduleSchema>;

// ─── Create Dialog ────────────────────────────────────────────────────────────

export function CreateScheduleDialog({
  open,
  onOpenChange,
  defaultUnitId,
  defaultMonth,
  defaultYear,
  lockPeriod,
  excludeUnitIds,
  calendars,
  units,
  schedules,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultUnitId?: string;
  defaultMonth?: number;
  defaultYear?: number;
  lockPeriod?: boolean;
  excludeUnitIds?: string[];
  calendars: any[];
  units: DPUnit[];
  schedules: DPSchedule[];
  onCreated?: (id: string, month: number, year: number) => void;
}) {
  const { addSchedule } = useDP();
  const { toast } = useToast();
  const router = useRouter();
  const now = new Date();

  const form = useForm<ScheduleFormValues>({
    resolver: zodResolver(scheduleSchema),
    defaultValues: {
      month: defaultMonth ?? now.getMonth() + 1,
      year: defaultYear ?? now.getFullYear(),
      calendarId: '',
      unitId: defaultUnitId ?? '',
    },
  });

  React.useEffect(() => {
    if (!open) return;
    const openedAt = new Date();
    form.reset({
      month: defaultMonth ?? openedAt.getMonth() + 1,
      year: defaultYear ?? openedAt.getFullYear(),
      calendarId: '',
      unitId: defaultUnitId ?? '',
    });
  }, [defaultMonth, defaultUnitId, defaultYear, form, open]);

  const watchedUnit = form.watch('unitId');
  const watchedYear = form.watch('year');
  const selectableUnits = React.useMemo(() => {
    const active = activeOperationalUnits(units);
    if (!excludeUnitIds?.length) return active;
    const excluded = new Set(
      excludeUnitIds.map((unitId) => canonicalOperationalUnitId(unitId, units)),
    );
    return active.filter((unit) => !excluded.has(canonicalOperationalUnitId(unit.id, units)));
  }, [units, excludeUnitIds]);

  // Clear calendarId when year changes (previous year's calendar would be invalid)
  React.useEffect(() => {
    form.setValue('calendarId', '');
  }, [form, watchedYear]);

  // Months already occupied for this unit+year
  // Also treats archived/merged units as the same canonical unit, preventing
  // a duplicate schedule in a month that is still covered by preserved history.
  const takenMonths = React.useMemo(() => {
    if (!watchedUnit || !watchedYear) return new Set<number>();
    const canonicalWatchedUnit = canonicalOperationalUnitId(watchedUnit, units);
    return new Set(
      schedules
        .filter(s =>
          Number(s.year) === Number(watchedYear) &&
          (!s.unitId || canonicalOperationalUnitId(s.unitId, units) === canonicalWatchedUnit)
        )
        .map(s => s.month)
    );
  }, [schedules, units, watchedUnit, watchedYear]);

  async function onSubmit(values: ScheduleFormValues) {
    try {
      const name = `${MONTHS[values.month - 1]} de ${values.year}`;
      const id = await addSchedule({ name, month: values.month, year: values.year, calendarId: values.calendarId, unitId: values.unitId });
      toast({ title: 'Escala criada.' });
      onOpenChange(false);
      if (onCreated) {
        onCreated(id, values.month, values.year);
      } else {
        router.push(`/dashboard/dp/schedules/${id}`);
      }
    } catch (error) {
      const duplicateMessage = error instanceof Error && error.message.startsWith('Já existe')
        ? error.message
        : null;
      toast({
        title: duplicateMessage ?? 'Erro ao criar escala.',
        variant: 'destructive',
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Criar Escala</DialogTitle>
          <DialogDescription>
            {lockPeriod
              ? `Selecione a unidade e o calendário para criar a escala de ${MONTHS[(defaultMonth ?? 1) - 1]} de ${defaultYear}.`
              : 'Selecione unidade, período e calendário para criar uma nova escala mensal.'}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-2">
            <FormField control={form.control} name="unitId" render={({ field }) => (
              <FormItem>
                <FormLabel>Unidade</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Selecione uma unidade..." /></SelectTrigger></FormControl>
                  <SelectContent>
                    {selectableUnits.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="month" render={({ field }) => (
                <FormItem>
                  <FormLabel>Mês</FormLabel>
                  <Select value={String(field.value)} onValueChange={v => field.onChange(Number(v))} disabled={lockPeriod}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {MONTHS.map((m, i) => {
                        const taken = takenMonths.has(i + 1);
                        return (
                          <SelectItem key={i + 1} value={String(i + 1)} disabled={taken}>
                            {m}{taken ? ' — já existe' : ''}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="year" render={({ field }) => (
                <FormItem>
                  <FormLabel>Ano</FormLabel>
                  <Select value={String(field.value)} onValueChange={v => field.onChange(Number(v))} disabled={lockPeriod}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {YEARS.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="calendarId" render={({ field }) => {
              // Compare as numbers to handle Firestore storing year as string or number
              const relevantCalendars = calendars.filter(c => Number(c.year) === Number(watchedYear));
              return (
                <FormItem>
                  <FormLabel>Calendário de feriados</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
                    <SelectContent>
                      {relevantCalendars.length === 0
                        ? <div className="px-3 py-2 text-xs text-muted-foreground">Nenhum calendário para {watchedYear}.</div>
                        : relevantCalendars.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)
                      }
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              );
            }} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Criando...' : 'Criar e abrir'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Bizneo Export Dialog ─────────────────────────────────────────────────────

function BizneoExportDialog({ open, onOpenChange, schedules, units, shiftDefinitions }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  schedules: DPSchedule[];
  units: Array<{ id: string; name: string }>;
  shiftDefinitions: any[];
}) {
  const MAX_SHIFTS_PER_SCHEDULE_EXPORT = 1000;
  const now = new Date();
  const { activeUsers, firebaseUser } = useAuth();
  const { toast } = useToast();

  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [allChecked, setAllChecked] = useState(true);
  const [exporting, setExporting] = useState(false);

  // Reset when dialog opens
  React.useEffect(() => {
    if (open) {
      setSelectedMonth(now.getMonth() + 1);
      setSelectedYear(now.getFullYear());
      setAllChecked(true);
      setSelectedIds(new Set());
    }
  }, [open]);

  // All per-unit schedules for selected month/year
  const monthSchedules = useMemo(() =>
    schedules.filter(s => s.month === selectedMonth && s.year === selectedYear && s.unitId),
    [schedules, selectedMonth, selectedYear]
  );

  const exportableSchedules = useMemo(() => monthSchedules.filter(s => !s.locked), [monthSchedules]);
  const lockedSchedules = useMemo(() => monthSchedules.filter(s => s.locked), [monthSchedules]);

  // Reset checklist when month/year changes
  React.useEffect(() => {
    setAllChecked(true);
    setSelectedIds(new Set());
  }, [selectedMonth, selectedYear]);

  function toggleId(id: string) {
    setAllChecked(false);
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setAllChecked(checked);
    if (checked) setSelectedIds(new Set());
  }

  async function handleExport() {
    const schedulesToExport = allChecked
      ? exportableSchedules
      : exportableSchedules.filter(s => selectedIds.has(s.id));

    if (schedulesToExport.length === 0) {
      toast({ title: 'Selecione ao menos uma escala.' });
      return;
    }

    setExporting(true);
    try {
      const allShifts: (DPShift & { scheduleUnitId?: string })[] = [];
      await Promise.all(
        schedulesToExport.map(async (sched) => {
          const snap = await getDocs(query(
            collection(db, 'dp_schedules', sched.id, 'shifts'),
            limit(MAX_SHIFTS_PER_SCHEDULE_EXPORT + 1),
          ));
          if (snap.size > MAX_SHIFTS_PER_SCHEDULE_EXPORT) {
            throw new Error(`A escala ${sched.name} excede o limite seguro de exportação.`);
          }
          snap.docs.forEach(d => {
            allShifts.push({ id: d.id, ...d.data(), scheduleUnitId: sched.unitId } as any);
          });
        })
      );

      const exportableShifts = allShifts.filter(isWorkShift);
      const userMap = new Map(activeUsers.map(u => [u.id, u]));
      const dayOffBlockers = buildBizneoExportDayOffBlockers(allShifts);

      if (dayOffBlockers.length > 0) {
        const details = dayOffBlockers.map((blocker) => {
          const userName = userMap.get(blocker.userId)?.username ?? 'Colaborador não localizado';
          const reason = blocker.kind === 'work_day_off_conflict'
            ? 'possui turno e folga'
            : `sincronização da folga: ${blocker.syncStatus ?? 'não confirmada'}`;
          return `${formatShiftDate(blocker.date)} · ${userName} · ${reason}`;
        });
        const preview = details.slice(0, 4).join('; ');
        const remainder = details.length > 4 ? `; +${details.length - 4} pendência(s)` : '';
        toast({
          title: 'Reconcilie as folgas antes de exportar.',
          description: `${preview}${remainder}.`,
          variant: 'destructive',
        });
        return;
      }

      if (exportableShifts.length === 0) {
        toast({ title: 'Nenhum turno nas escalas selecionadas.' });
        return;
      }

      const defMap = new Map(shiftDefinitions.map(d => [d.id, d]));
      const unresolvedShiftDetails = new Set<string>();

      const rows = exportableShifts
        .sort((a, b) => {
          const dateCompare = a.date.localeCompare(b.date);
          if (dateCompare !== 0) return dateCompare;
          const ua = userMap.get(a.userId)?.username ?? '';
          const ub = userMap.get(b.userId)?.username ?? '';
          return ua.localeCompare(ub);
        })
        .map(s => {
          const user = userMap.get(s.userId);
          const unitId = s.unitId ?? s.scheduleUnitId;
          const unitName = units.find(u => u.id === unitId)?.name ?? '';
          const def = resolveShiftDefinitionForExport(s, unitId, shiftDefinitions, defMap);
          const shiftId = resolveBizneoShiftId(def);

          if (!shiftId) {
            unresolvedShiftDetails.add(
              `${formatShiftDate(s.date)} · ${unitName || 'Sem unidade'} · ${user?.username ?? 'Sem colaborador'} · ${def?.name ?? `${s.startTime}–${s.endTime}`}`
            );
          }

          return {
            date: s.date,
            action: 'overwrite',
            state: 'draft',
            employee_id: user?.registrationIdBizneo ?? s.userId,
            employee: user?.username ?? '',
            shift_id: shiftId,
            shift: def?.name ?? `${s.startTime}–${s.endTime}`,
            unit: unitName,
          };
        });

      if (unresolvedShiftDetails.size > 0) {
        const unresolvedList = Array.from(unresolvedShiftDetails);
        const preview = unresolvedList.slice(0, 4).join('; ');
        const remainder = unresolvedList.length > 4 ? `; +${unresolvedList.length - 4} registro(s)` : '';
        toast({
          title: 'Turnos sem ID Bizneo.',
          description: `Registros pendentes: ${preview}${remainder}.`,
          variant: 'destructive',
        });
        return;
      }

      const XLSX = await import('xlsx');
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Escala');
      XLSX.writeFile(wb, `bizneo_${MONTHS[selectedMonth - 1]}_${selectedYear}.xlsx`);

      if (firebaseUser) {
        await createAuditLog(firebaseUser, {
          module: 'dp.schedules',
          action: 'schedule_export_created',
          targetType: 'export',
          targetId: `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`,
          targetName: 'Exportacao Bizneo',
          metadata: {
            format: 'xlsx',
            month: selectedMonth,
            year: selectedYear,
            schedule_count: schedulesToExport.length,
            shift_count: rows.length,
            unit_ids: schedulesToExport.map((schedule) => schedule.unitId ?? null),
          },
        }).catch((error) => {
          console.warn('[DPSchedulesList] Falha ao registrar auditoria.', error);
        });
      }

      toast({ title: 'Arquivo exportado.', description: `${rows.length} turno(s) em ${schedulesToExport.length} unidade(s).` });
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: 'Erro ao exportar.', description: e.message, variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Exportar para Bizneo</DialogTitle>
          <DialogDescription>
            Escolha o mês e as escalas por unidade que serão exportadas para o Bizneo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Month + Year selectors */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Mês</Label>
              <Select value={String(selectedMonth)} onValueChange={v => setSelectedMonth(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => (
                    <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Ano</Label>
              <Select value={String(selectedYear)} onValueChange={v => setSelectedYear(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {YEARS.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Schedule checklist */}
          {monthSchedules.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Nenhuma escala por unidade para {MONTHS[selectedMonth - 1]} de {selectedYear}.
            </p>
          ) : (
            <div className="space-y-2">
              <Label>Escalas</Label>
              <div className="rounded-md border divide-y">
                {exportableSchedules.length > 1 && (
                  <div className="flex items-center gap-2.5 px-3 py-2.5">
                    <Checkbox
                      id="sched-all"
                      checked={allChecked}
                      onCheckedChange={v => toggleAll(!!v)}
                    />
                    <label htmlFor="sched-all" className="text-sm font-medium cursor-pointer">
                      Todas as escalas
                    </label>
                  </div>
                )}
                {exportableSchedules.map(s => {
                  const unitName = units.find(u => u.id === s.unitId)?.name ?? s.unitId;
                  return (
                    <div key={s.id} className="flex items-center gap-2.5 px-3 py-2.5">
                      <Checkbox
                        id={`sched-${s.id}`}
                        checked={allChecked || selectedIds.has(s.id)}
                        disabled={allChecked && exportableSchedules.length > 1}
                        onCheckedChange={() => toggleId(s.id)}
                      />
                      <label
                        htmlFor={`sched-${s.id}`}
                        className={`text-sm cursor-pointer flex-1 ${allChecked && exportableSchedules.length > 1 ? 'text-muted-foreground' : ''}`}
                      >
                        {unitName}
                        <span className="text-muted-foreground text-xs ml-1.5">· {s.shiftCount} turno(s)</span>
                      </label>
                    </div>
                  );
                })}
                {lockedSchedules.map(s => {
                  const unitName = units.find(u => u.id === s.unitId)?.name ?? s.unitId;
                  return (
                    <div key={s.id} className="flex items-center gap-2.5 px-3 py-2.5 opacity-50">
                      <Checkbox id={`sched-locked-${s.id}`} checked={false} disabled />
                      <label
                        htmlFor={`sched-locked-${s.id}`}
                        className="text-sm text-muted-foreground flex-1 flex items-center gap-1.5 cursor-not-allowed"
                      >
                        <Lock className="h-3 w-3 shrink-0" />
                        {unitName}
                        <span className="text-xs ml-0.5">· trancada</span>
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleExport} disabled={monthSchedules.length === 0 || exporting}>
            <Download className="mr-2 h-4 w-4" />
            {exporting ? 'Exportando...' : 'Exportar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function DPSchedulesList() {
  const {
    schedules,
    schedulesLoading,
    schedulesError,
    units,
    unitsLoading,
    unitsError,
    unitGroups,
    calendars,
    shiftDefinitions,
    shiftDefsLoading,
    shiftDefsError,
  } = useDP();
  const { permissions, user, isDefaultAdmin } = useAuth();
  const router = useRouter();
  const [addMonthOpen, setAddMonthOpen] = useState(false);
  const [exportBizneoOpen, setExportBizneoOpen] = useState(false);
  const exportDependenciesReady = !shiftDefsLoading && !unitsLoading && !shiftDefsError && !unitsError;
  const ancillaryErrors = [unitsError, shiftDefsError].filter(Boolean);
  const visibleSchedules = useAccessibleDPSchedules();

  const now = React.useMemo(() => new Date(), []);
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [unitQuery, setUnitQuery] = useState('');

  const accessibleUnits = React.useMemo(
    () => (user ? filterUnitsByAccess(activeOperationalUnits(units), user, { isDefaultAdmin }) : []),
    [isDefaultAdmin, units, user],
  );
  const totalUnits = accessibleUnits.length;

  const canonicalOf = React.useCallback(
    (unitId: string) => canonicalOperationalUnitId(unitId, units) ?? unitId,
    [units],
  );

  // Canonical unit id → { city, state }, derived from the newest schedule that
  // links a holiday calendar (calendars carry city/state), then unit address/group.
  const locationByUnit = React.useMemo(() => {
    const calendarById = new Map(calendars.map((c) => [c.id, c]));
    const groupById = new Map(unitGroups.map((g) => [g.id, g]));
    const newestFirst = [...visibleSchedules].sort((a, b) => (b.year - a.year) || (b.month - a.month));
    const map = new Map<string, { city: string; state?: string }>();
    for (const s of newestFirst) {
      if (!s.unitId || !s.calendarId) continue;
      const key = canonicalOf(s.unitId);
      const cal = calendarById.get(s.calendarId);
      const city = cal?.city?.trim();
      const state = cal?.state?.trim();
      const current = map.get(key);
      if ((!current?.city && city) || (!current?.state && state)) {
        map.set(key, {
          city: current?.city || city || '',
          state: current?.state || state || undefined,
        });
      }
    }
    for (const u of accessibleUnits) {
      const key = canonicalOf(u.id);
      const current = map.get(key);
      map.set(key, {
        city: current?.city || resolveDPUnitCity({
          address: u.address,
          groupName: u.groupId ? groupById.get(u.groupId)?.name : undefined,
        }),
        state: current?.state,
      });
    }
    return map;
  }, [accessibleUnits, calendars, canonicalOf, unitGroups, visibleSchedules]);

  const overview = React.useMemo(() => {
    const states = new Set<string>();
    const cities = new Set<string>();
    for (const u of accessibleUnits) {
      const loc = locationByUnit.get(canonicalOf(u.id));
      if (loc?.state) states.add(loc.state);
      if (loc?.city) cities.add(loc.city);
    }
    return { states: states.size, cities: cities.size };
  }, [accessibleUnits, canonicalOf, locationByUnit]);

  const sidebarSchedules = React.useMemo(() => visibleSchedules.filter((schedule) => (
    schedule.year === currentYear && schedule.month === currentMonth
  )), [currentMonth, currentYear, visibleSchedules]);
  const filledDaysByScheduleId = useDPScheduleFilledDays(sidebarSchedules);

  const sidebarGroups = React.useMemo<DPSchedulesSidebarGroup[]>(() => {
    const scheduleByCanonicalUnit = new Map<string, DPSchedule>();
    sidebarSchedules.forEach((schedule) => {
      if (!schedule.unitId) return;
      const canonicalId = canonicalOf(schedule.unitId);
      if (!scheduleByCanonicalUnit.has(canonicalId)) scheduleByCanonicalUnit.set(canonicalId, schedule);
    });

    const queryValue = normalizeLocationLabel(unitQuery.trim());
    const byState = new Map<string, Map<string, DPUnit[]>>();
    accessibleUnits.forEach((unit) => {
      const location = locationByUnit.get(canonicalOf(unit.id));
      const city = location?.city || 'Sem cidade definida';
      const stateValue = location?.state?.trim() || 'Sem estado definido';
      if (queryValue && ![unit.name, city, stateValue].some((value) => (
        normalizeLocationLabel(value).includes(queryValue)
      ))) return;
      if (!byState.has(stateValue)) byState.set(stateValue, new Map());
      const byCity = byState.get(stateValue)!;
      if (!byCity.has(city)) byCity.set(city, []);
      byCity.get(city)!.push(unit);
    });

    return Array.from(byState.entries())
      .sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))
      .map(([state, byCity]) => {
        const stateCode = stateCodeOf(state);
        const cities = Array.from(byCity.entries())
          .sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))
          .map(([city, cityUnits]) => ({
            city,
            units: cityUnits
              .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
              .map((unit) => {
                const schedule = scheduleByCanonicalUnit.get(canonicalOf(unit.id));
                const period = formatDPSchedulePeriod(currentYear, currentMonth);
                return {
                  key: unit.id,
                  name: unit.name,
                  locked: schedule?.locked,
                  filledDays: schedule ? filledDaysByScheduleId[schedule.id] ?? 0 : 0,
                  expectedDays: countExpectedDPUnitDays({ unit, year: currentYear, month: currentMonth, shiftDefinitions }),
                  onClick: () => router.push(
                    `/dashboard/dp/schedules/month/${period}${schedule ? `?schedule=${schedule.id}` : '?create=1'}`,
                  ),
                };
              }),
          }));
        return {
          state: BRAZILIAN_STATE_NAMES[stateCode] ?? state,
          stateCode,
          unitCount: cities.reduce((sum, city) => sum + city.units.length, 0),
          cities,
        };
      });
  }, [accessibleUnits, canonicalOf, currentMonth, currentYear, filledDaysByScheduleId, locationByUnit, router, shiftDefinitions, sidebarSchedules, unitQuery]);

  const summarize = React.useCallback((year: number, month: number) => {
    const items = visibleSchedules.filter((s) => s.year === year && s.month === month);
    const hasData = items.length > 0;
    const allLocked = hasData && items.every((s) => s.locked);
    const legacyAllUnits = items.some((s) => !s.unitId);
    const startedCanonical = new Set(items.filter((s) => s.unitId).map((s) => canonicalOf(s.unitId!)));
    const startedCount = !hasData
      ? 0
      : legacyAllUnits
        ? totalUnits
        : accessibleUnits.filter((u) => startedCanonical.has(canonicalOf(u.id))).length;
    const shiftCount = items.reduce((sum, s) => sum + (s.shiftCount ?? 0), 0);
    const isPast = year < currentYear || (year === currentYear && month < currentMonth);
    const isCurrent = year === currentYear && month === currentMonth;
    const missing = Math.max(0, totalUnits - startedCount);
    const tone: 'active' | 'draft' | 'locked' | 'empty' = !hasData
      ? 'empty'
      : allLocked || isPast
        ? 'locked'
        : isCurrent
          ? 'active'
          : 'draft';
    const statusLabel = !hasData
      ? 'Não iniciada'
      : allLocked
        ? 'Trancada'
        : isPast
          ? 'Encerrada'
          : isCurrent
            ? 'Em andamento'
            : 'Rascunho';
    const alert = hasData && !allLocked && isPast
      ? 'Rever'
      : isCurrent && missing > 0
        ? `${missing} sem escala`
        : null;
    return {
      period: formatDPSchedulePeriod(year, month),
      month,
      hasData,
      allLocked,
      startedCount,
      missing,
      shiftCount,
      tone,
      statusLabel,
      alert,
      pct: totalUnits ? Math.round((startedCount / totalUnits) * 100) : 0,
    };
  }, [accessibleUnits, canonicalOf, currentMonth, currentYear, totalUnits, visibleSchedules]);

  const years = React.useMemo(() => {
    const set = new Set<number>([currentYear]);
    for (const { year } of getAutomaticDPSchedulePeriods()) set.add(year);
    for (const s of visibleSchedules) set.add(s.year);
    return Array.from(set).sort((a, b) => b - a);
  }, [currentYear, visibleSchedules]);

  const effectiveYear = years.includes(selectedYear) ? selectedYear : (years[0] ?? currentYear);

  const monthCards = React.useMemo(
    () => Array.from({ length: 12 }, (_, i) => ({ name: MONTHS[i], ...summarize(effectiveYear, i + 1) })),
    [effectiveYear, summarize],
  );
  const sidebarSummary = summarize(currentYear, currentMonth);

  const attention = React.useMemo(() => {
    const out: Array<{ key: string; title: string; detail: string; tone: 'err' | 'warn'; period: string }> = [];
    if (totalUnits > 0) {
      const current = summarize(currentYear, currentMonth);
      if (current.missing > 0) {
        out.push({
          key: 'current-missing',
          title: `${current.missing} ${current.missing === 1 ? 'unidade' : 'unidades'} sem escala`,
          detail: `${MONTHS[currentMonth - 1]} de ${currentYear} · escala do mês em aberto`,
          tone: 'warn',
          period: formatDPSchedulePeriod(currentYear, currentMonth),
        });
      }
      for (let offset = 1; offset <= 3; offset += 1) {
        const d = new Date(currentYear, currentMonth - 1 - offset, 1);
        const s = summarize(d.getFullYear(), d.getMonth() + 1);
        if (s.hasData && !s.allLocked) {
          out.push({
            key: `open-${s.period}`,
            title: `${MONTHS[d.getMonth()]} ainda não foi trancada`,
            detail: `${s.startedCount} de ${totalUnits} unidades · mês encerrado`,
            tone: 'err',
            period: s.period,
          });
        }
      }
    }
    return out.slice(0, 3);
  }, [currentMonth, currentYear, summarize, totalUnits]);

  const toneStyles: Record<'active' | 'draft' | 'locked' | 'empty', { card: string; bar: string; status: string }> = {
    active: { card: 'border-[#f9a8c4] bg-white shadow-[0_16px_28px_-22px_rgba(219,39,119,0.65)]', bar: 'bg-[#db2777]', status: 'text-[#db2777]' },
    draft: { card: 'border-[#dbe7f4] bg-white', bar: 'bg-[#0ea5e9]', status: 'text-[#0369a1]' },
    locked: { card: 'border-[#e3e9f1] bg-white', bar: 'bg-[#94a3b8]', status: 'text-[#94a3b8]' },
    empty: { card: 'border-[#e3e9f1] bg-[#f5f7fa]', bar: 'bg-[#d9e0e9]', status: 'text-[#a3aec0]' },
  };

  if (schedulesLoading && schedules.length === 0) {
    return (
      <div className="space-y-6">
        {[1, 2].map(i => (
          <div key={i} className="space-y-2 animate-pulse">
            <div className="h-3 w-12 bg-muted rounded" />
            <div className="rounded-xl border divide-y">
              {[1, 2, 3].map(j => <div key={j} className="h-14 bg-muted/30" />)}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (schedulesError && schedules.length === 0) {
    return (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-xs">
        <p className="font-medium text-destructive">Falha ao carregar o módulo de Escalas.</p>
        <p className="mt-1 text-muted-foreground">{schedulesError}</p>
      </div>
    );
  }

  return (
    <div
      className="dp-schedules-redesign flex flex-col gap-[6px] bg-[#eef1f6] lg:h-[calc(100vh-7.25rem)] lg:min-h-[680px] lg:flex-row"
      style={{ fontFamily: "'Inter Tight Variable', 'Inter Tight', Inter, system-ui, sans-serif" }}
    >
      <DPSchedulesSidebar
        groups={sidebarGroups}
        query={unitQuery}
        onQueryChange={setUnitQuery}
        onBack={() => router.push('/dashboard/dp/schedules')}
        startedCount={sidebarSummary.startedCount}
        totalCount={totalUnits}
        emptyLabel={unitQuery ? 'Nenhuma unidade encontrada.' : 'Nenhuma unidade disponível.'}
      />

      <div className="no-scrollbar min-w-0 flex-1 overflow-y-auto bg-[#eef1f6]">
      <div className="mx-auto max-w-[1180px] px-[18px] pb-11 pt-7 md:px-[34px] md:pt-[34px]">
      {ancillaryErrors.length > 0 && (
        <div className="mb-4 rounded-[12px] border border-amber-200 bg-amber-50/70 p-2.5 text-xs text-amber-900">
          <p className="font-medium">Alguns dados auxiliares de Escalas não carregaram.</p>
          <p className="mt-1 text-amber-800/80">{ancillaryErrors[0]}</p>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#db2777]">Escalas operacionais</p>
          <h1 className="dp-schedules-list-title mt-[7px] text-[29px] font-black leading-[34px] tracking-[-0.025em] text-[#0f172a]">Meses de escala</h1>
          <p className="mt-2 text-[13.5px] font-semibold text-[#64748b]">
            {totalUnits} {totalUnits === 1 ? 'unidade' : 'unidades'}
            {overview.states > 0 && ` · ${overview.states} ${overview.states === 1 ? 'estado' : 'estados'}`}
            {overview.cities > 0 && ` · ${overview.cities} ${overview.cities === 1 ? 'cidade' : 'cidades'}`}
            {' · escalas montadas por mês'}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {visibleSchedules.some((schedule) => schedule.unitId) && (
            <Button
              onClick={() => setExportBizneoOpen(true)}
              variant="outline"
              size="sm"
              disabled={!exportDependenciesReady}
              className="h-9 rounded-[11px] border-[#dbe2eb] bg-white px-[14px] text-[13px] font-extrabold text-[#475569] hover:bg-[#f8fafc]"
            >
              <Download className="mr-2 h-4 w-4" />
              Exportar para o Bizneo
            </Button>
          )}
          {permissions.dp?.schedules?.create && (
            <Button type="button" size="sm" onClick={() => setAddMonthOpen(true)} className="h-9 rounded-[11px] bg-[#db2777] px-[14px] text-[13px] font-extrabold text-white hover:bg-[#be185d]">
              <Plus className="mr-2 h-4 w-4" />
              Adicionar mês
            </Button>
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {years.map((year) => {
          const active = year === effectiveYear;
          const meta = year === currentYear ? 'atual' : year < currentYear ? 'encerrado' : 'planejamento';
          return (
            <button
              key={year}
              type="button"
              onClick={() => setSelectedYear(year)}
              className={cn(
                'flex h-[34px] items-center gap-2 rounded-[11px] border px-[15px] text-[13.5px] font-extrabold transition-colors',
                active
                  ? 'border-[#0f172a] bg-[#0f172a] text-white'
                  : 'border-[#e3e9f1] bg-white text-[#475569] hover:bg-[#f8fafc]',
              )}
            >
              {year}
              <span className={cn('text-[11px] font-extrabold', active ? 'text-[#8a96aa]' : 'text-[#a3aec0]')}>
                · {meta}
              </span>
            </button>
          );
        })}
        <div className="ml-auto hidden flex-wrap items-center gap-[14px] md:flex">
          {([
            ['Em andamento', 'bg-[#db2777]'],
            ['Rascunho', 'bg-[#0ea5e9]'],
            ['Trancada', 'bg-[#94a3b8]'],
            ['Não iniciada', 'bg-[#d9e0e9]'],
          ] as const).map(([label, dot]) => (
            <span key={label} className="flex items-center gap-1.5 text-[11.5px] font-bold text-[#7d8a9d]">
              <span className={cn('h-2 w-2 rounded-[3px]', dot)} />
              {label}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {monthCards.map((card) => {
          const s = toneStyles[card.tone];
          return (
            <button
              key={card.period}
              type="button"
              onClick={() => router.push(`/dashboard/dp/schedules/month/${card.period}`)}
              className={cn(
                'flex flex-col rounded-[16px] border px-4 pb-[14px] pt-[15px] text-left transition-all hover:-translate-y-0.5 hover:shadow-md',
                s.card,
              )}
            >
              <div className="flex items-center gap-2">
                <span className={cn('text-[15.5px] font-black tracking-[-0.01em]', card.tone === 'empty' ? 'text-[#a3aec0]' : 'text-[#0f172a]')}>{card.name}</span>
                {card.allLocked && <Lock className="h-3 w-3 text-[#94a3b8]" />}
                <span className={cn('ml-auto text-[10.5px] font-extrabold', s.status)}>
                  {card.statusLabel}
                </span>
              </div>
              <div className="mt-[13px] h-[5px] overflow-hidden rounded-[3px] bg-[#e7ecf2]">
                <div className={cn('h-full rounded-full', s.bar)} style={{ width: `${card.pct}%` }} />
              </div>
              <div className="mt-[9px] flex items-baseline gap-1.5 whitespace-nowrap">
                <span className={cn('text-[12.5px] font-extrabold tabular-nums', card.tone === 'empty' ? 'text-[#a3aec0]' : 'text-[#334155]')}>
                  {card.hasData ? `${card.startedCount} de ${totalUnits}` : `0 de ${totalUnits}`}
                </span>
                <span className="text-[11.5px] font-bold text-[#a3aec0]">unidades</span>
                {card.alert && (
                  <span className="ml-auto rounded-md bg-[#fee2e6] px-[7px] py-0.5 text-[10.5px] font-black text-[#be123c]">
                    {card.alert}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {attention.length > 0 && (
        <div className="mt-[26px] rounded-[16px] border border-[#e3e9f1] bg-white px-[18px] py-4">
          <p className="text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-[#94a3b8]">Precisa de atenção</p>
          <div className="mt-3 grid gap-[10px] sm:grid-cols-2 lg:grid-cols-3">
            {attention.map((a) => (
              <button
                key={a.key}
                type="button"
                onClick={() => router.push(`/dashboard/dp/schedules/month/${a.period}`)}
                className={cn(
                  'flex items-start gap-[9px] rounded-[12px] border px-3 py-[11px] text-left transition-colors',
                  a.tone === 'err'
                    ? 'border-[#fecdd6] bg-[#fef2f4] hover:bg-[#ffe8ed]'
                    : 'border-[#fde68a] bg-[#fffbeb] hover:bg-[#fff7d6]',
                )}
              >
                <AlertTriangle
                  className={cn(
                    'mt-0.5 h-3.5 w-3.5 shrink-0',
                    a.tone === 'err' ? 'text-[#e11d48]' : 'text-[#d97706]',
                  )}
                />
                <span className="min-w-0">
                  <span
                    className={cn(
                      'block text-[12.5px] font-extrabold',
                      a.tone === 'err' ? 'text-[#e11d48]' : 'text-[#b45309]',
                    )}
                  >
                    {a.title}
                  </span>
                  <span className="mt-0.5 block text-[11.5px] font-semibold text-[#7d8a9d]">{a.detail}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <AddScheduleMonthDialog
        open={addMonthOpen}
        onOpenChange={setAddMonthOpen}
        schedules={visibleSchedules}
        onSelectPeriod={(year, month, isNew) => {
          const period = formatDPSchedulePeriod(year, month);
          router.push(`/dashboard/dp/schedules/month/${period}${isNew ? '?create=1' : ''}`);
        }}
      />
      <BizneoExportDialog
        open={exportBizneoOpen}
        onOpenChange={setExportBizneoOpen}
        schedules={visibleSchedules}
        units={units}
        shiftDefinitions={shiftDefinitions}
      />
      </div>
      </div>
    </div>
  );
}
