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
import type { DPSchedule, DPShift, DPShiftDefinition, DPUnit } from '@/types';
import {
  getShiftDefinitionUnitIds,
  shiftDefinitionMatchesUnit,
} from '@/lib/dp-shift-definitions';
import { isWorkShift } from '@/lib/dp-shift-rules';
import { buildBizneoExportDayOffBlockers } from '@/lib/dp-bizneo-export-preflight';
import { activeOperationalUnits, canonicalOperationalUnitId } from '@/lib/dp-units';
import { canAccessUnit, filterUnitsByAccess, resolveUnitAccess } from '@/lib/unit-access';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { Plus, CalendarDays, Download, Lock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { createAuditLog } from '@/features/audit/client';

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 4 }, (_, i) => currentYear - 1 + i);

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
    if (open) form.reset({
      month: defaultMonth ?? now.getMonth() + 1,
      year: defaultYear ?? now.getFullYear(),
      calendarId: '',
      unitId: defaultUnitId ?? '',
    });
  }, [open]);

  const watchedUnit = form.watch('unitId');
  const watchedYear = form.watch('year');
  const selectableUnits = React.useMemo(() => {
    const active = activeOperationalUnits(units);
    if (!excludeUnitIds?.length) return active;
    const excluded = new Set(excludeUnitIds);
    return active.filter(u => !excluded.has(u.id));
  }, [units, excludeUnitIds]);

  // Clear calendarId when year changes (previous year's calendar would be invalid)
  React.useEffect(() => {
    form.setValue('calendarId', '');
  }, [watchedYear]);

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
    } catch {
      toast({ title: 'Erro ao criar escala.', variant: 'destructive' });
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
    calendars,
    calendarsLoading,
    calendarsError,
    shiftDefinitions,
    shiftDefsLoading,
    shiftDefsError,
  } = useDP();
  const { permissions, user, isDefaultAdmin } = useAuth();
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [exportBizneoOpen, setExportBizneoOpen] = useState(false);
  const createDependenciesReady = !unitsLoading && !calendarsLoading && !unitsError && !calendarsError;
  const exportDependenciesReady = !shiftDefsLoading && !unitsLoading && !shiftDefsError && !unitsError;
  const ancillaryErrors = [unitsError, calendarsError, shiftDefsError].filter(Boolean);
  const activeUnits = React.useMemo(
    () => user
      ? filterUnitsByAccess(activeOperationalUnits(units), user, { isDefaultAdmin })
      : [],
    [isDefaultAdmin, units, user],
  );
  const visibleSchedules = React.useMemo(() => {
    if (!user) return [];
    const access = resolveUnitAccess(user, { isDefaultAdmin });
    return schedules.filter((schedule) =>
      schedule.unitId
        ? canAccessUnit(user, schedule.unitId, { isDefaultAdmin })
        : access.allUnits
    );
  }, [isDefaultAdmin, schedules, user]);

  const canCreate = permissions.dp?.schedules?.create ?? false;

  // Group schedules by year+month across every unit — the top-level list is
  // just the months; picking a month opens the per-unit view with a sidebar.
  const groupedByMonth = React.useMemo(() => {
    const byPeriod = new Map<string, DPSchedule[]>();
    for (const s of visibleSchedules) {
      const key = `${s.year}-${String(s.month).padStart(2, '0')}`;
      if (!byPeriod.has(key)) byPeriod.set(key, []);
      byPeriod.get(key)!.push(s);
    }
    return Array.from(byPeriod.entries())
      .map(([period, items]) => {
        const [year, month] = period.split('-').map(Number);
        return {
          period,
          year,
          month,
          unitCount: items.length,
          shiftCount: items.reduce((sum, s) => sum + (s.shiftCount ?? 0), 0),
          allLocked: items.every(s => s.locked),
        };
      })
      .sort((a, b) => (b.year - a.year) || (b.month - a.month));
  }, [visibleSchedules]);

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
    <div className="space-y-8">
      {ancillaryErrors.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-2.5 text-xs text-amber-900">
          <p className="font-medium">Alguns dados auxiliares de Escalas não carregaram.</p>
          <p className="mt-1 text-amber-800/80">{ancillaryErrors[0]}</p>
        </div>
      )}
      {visibleSchedules.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
          <CalendarDays className="h-8 w-8 opacity-30" />
          <p className="text-sm">Nenhuma escala cadastrada.</p>
          {canCreate && (
            <Button onClick={() => setCreateOpen(true)} className="mt-2" disabled={!createDependenciesReady}>
              <Plus className="mr-2 h-4 w-4" />
              Criar primeira escala
            </Button>
          )}
        </div>
      ) : (
        <div className="rounded-xl border bg-card overflow-hidden divide-y">
          {groupedByMonth.map(({ period, year, month, unitCount, shiftCount, allLocked }) => (
            <div
              key={period}
              className="group flex cursor-pointer items-center gap-3 px-3 py-3 transition-colors hover:bg-muted/40"
              onClick={() => router.push(`/dashboard/dp/schedules/month/${period}`)}
            >
              <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <CalendarDays className="h-4 w-4 text-primary" />
              </div>

              <p className="flex-1 text-sm font-medium flex items-center gap-2">
                {MONTHS[month - 1]} de {year}
                {allLocked && <Lock className="h-3 w-3 text-muted-foreground/60" />}
              </p>

              <Badge variant="secondary" className="text-xs shrink-0">
                {unitCount} {unitCount === 1 ? 'unidade' : 'unidades'}
              </Badge>
              <Badge variant="outline" className="text-xs shrink-0">
                {shiftCount} {shiftCount === 1 ? 'turno' : 'turnos'}
              </Badge>
            </div>
          ))}
        </div>
      )}

      {/* FABs */}
      <div className="fixed bottom-4 right-4 flex flex-col gap-2 items-end sm:bottom-6 sm:right-6">
        {visibleSchedules.some(s => s.unitId) && (
          <Button
            onClick={() => setExportBizneoOpen(true)}
            variant="outline"
            className="h-8 gap-1.5 rounded-lg bg-background px-3 text-xs shadow-md"
            disabled={!exportDependenciesReady}
          >
            <Download className="h-4 w-4" />
            Exportar Bizneo
          </Button>
        )}
        {canCreate && visibleSchedules.length > 0 && (
          <Button
            onClick={() => setCreateOpen(true)}
            className="h-9 gap-1.5 rounded-lg px-3 text-xs shadow-md"
            size="lg"
            disabled={!createDependenciesReady}
          >
            <Plus className="h-5 w-5" />
            Criar Escala
          </Button>
        )}
      </div>

      <CreateScheduleDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        calendars={calendars}
        units={activeUnits}
        schedules={visibleSchedules}
        onCreated={(id, month, year) => {
          const period = `${year}-${String(month).padStart(2, '0')}`;
          router.push(`/dashboard/dp/schedules/month/${period}?schedule=${id}`);
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
  );
}
