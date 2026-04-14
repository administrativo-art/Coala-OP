"use client";

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';

import { useDP } from '@/components/dp-context';
import { useAuth } from '@/hooks/use-auth';
import type { DPSchedule, DPShift } from '@/types';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
import { Plus, CalendarDays, Trash2, Download, Lock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 4 }, (_, i) => currentYear - 1 + i);

// ─── Schema ───────────────────────────────────────────────────────────────────

const scheduleSchema = z.object({
  month: z.coerce.number().min(1).max(12),
  year: z.coerce.number().min(2020),
  calendarId: z.string().min(1, 'Selecione um calendário de feriados.'),
  unitId: z.string().min(1, 'Selecione uma unidade.'),
});

type ScheduleFormValues = z.infer<typeof scheduleSchema>;

// ─── Create Dialog ────────────────────────────────────────────────────────────

function CreateScheduleDialog({ open, onOpenChange, defaultUnitId }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultUnitId?: string;
}) {
  const { addSchedule, calendars, units, schedules } = useDP();
  const { toast } = useToast();
  const router = useRouter();
  const now = new Date();

  const form = useForm<ScheduleFormValues>({
    resolver: zodResolver(scheduleSchema),
    defaultValues: {
      month: now.getMonth() + 1,
      year: now.getFullYear(),
      calendarId: '',
      unitId: defaultUnitId ?? '',
    },
  });

  React.useEffect(() => {
    if (open) form.reset({
      month: now.getMonth() + 1,
      year: now.getFullYear(),
      calendarId: '',
      unitId: defaultUnitId ?? '',
    });
  }, [open]);

  const watchedUnit = form.watch('unitId');
  const watchedYear = form.watch('year');

  // Clear calendarId when year changes (previous year's calendar would be invalid)
  React.useEffect(() => {
    form.setValue('calendarId', '');
  }, [watchedYear]);

  // Months already occupied for this unit+year
  // Blocks: (a) per-unit schedules with the same unitId, (b) legacy schedules (no unitId = cover all units)
  const takenMonths = React.useMemo(() => {
    if (!watchedUnit || !watchedYear) return new Set<number>();
    return new Set(
      schedules
        .filter(s =>
          Number(s.year) === Number(watchedYear) &&
          (s.unitId === watchedUnit || !s.unitId)
        )
        .map(s => s.month)
    );
  }, [schedules, watchedUnit, watchedYear]);

  async function onSubmit(values: ScheduleFormValues) {
    try {
      const name = `${MONTHS[values.month - 1]} de ${values.year}`;
      const id = await addSchedule({ name, month: values.month, year: values.year, calendarId: values.calendarId, unitId: values.unitId });
      toast({ title: 'Escala criada.' });
      onOpenChange(false);
      router.push(`/dashboard/dp/schedules/${id}`);
    } catch {
      toast({ title: 'Erro ao criar escala.', variant: 'destructive' });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Criar Escala</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-2">
            <FormField control={form.control} name="unitId" render={({ field }) => (
              <FormItem>
                <FormLabel>Unidade</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Selecione uma unidade..." /></SelectTrigger></FormControl>
                  <SelectContent>
                    {units.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="month" render={({ field }) => (
                <FormItem>
                  <FormLabel>Mês</FormLabel>
                  <Select value={String(field.value)} onValueChange={v => field.onChange(Number(v))}>
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
                  <Select value={String(field.value)} onValueChange={v => field.onChange(Number(v))}>
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

function BizneoExportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const now = new Date();
  const { schedules, units, shiftDefinitions } = useDP();
  const { activeUsers } = useAuth();
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
          const snap = await getDocs(collection(db, 'dp_schedules', sched.id, 'shifts'));
          snap.docs.forEach(d => {
            allShifts.push({ id: d.id, ...d.data(), scheduleUnitId: sched.unitId } as any);
          });
        })
      );

      if (allShifts.length === 0) {
        toast({ title: 'Nenhum turno nas escalas selecionadas.' });
        return;
      }

      const defMap = new Map(shiftDefinitions.map(d => [d.id, d]));
      const userMap = new Map(activeUsers.map(u => [u.id, u]));

      const rows = allShifts
        .sort((a, b) => {
          const dateCompare = a.date.localeCompare(b.date);
          if (dateCompare !== 0) return dateCompare;
          const ua = userMap.get(a.userId)?.username ?? '';
          const ub = userMap.get(b.userId)?.username ?? '';
          return ua.localeCompare(ub);
        })
        .map(s => {
          const user = userMap.get(s.userId);
          const def = s.shiftDefinitionId ? defMap.get(s.shiftDefinitionId) : undefined;
          const unitId = s.unitId ?? s.scheduleUnitId;
          const unitName = units.find(u => u.id === unitId)?.name ?? '';
          return {
            date: s.date,
            action: 'overwrite',
            state: 'draft',
            employee_id: user?.registrationIdBizneo ?? s.userId,
            employee: user?.username ?? '',
            shift_id: def?.bizneoTemplateId ?? def?.name ?? '',
            shift: def?.name ?? `${s.startTime}–${s.endTime}`,
            unit: unitName,
          };
        });

      const XLSX = await import('xlsx');
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Escala');
      XLSX.writeFile(wb, `bizneo_${MONTHS[selectedMonth - 1]}_${selectedYear}.xlsx`);

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
  const { schedules, schedulesLoading, deleteSchedule, units } = useDP();
  const { permissions } = useAuth();
  const { toast } = useToast();
  const router = useRouter();

  const [createOpen, setCreateOpen] = useState(false);
  const [createDefaultUnit, setCreateDefaultUnit] = useState<string | undefined>();
  const [exportBizneoOpen, setExportBizneoOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DPSchedule | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const canCreate = permissions.dp?.schedules?.create ?? false;
  const canDelete = permissions.dp?.schedules?.delete ?? false;

  function openCreate(unitId?: string) {
    setCreateDefaultUnit(unitId);
    setCreateOpen(true);
  }

  // Group per-unit schedules by unitId → year; legacy (no unitId) go in '__legacy__'
  const groupedByUnit = React.useMemo(() => {
    // unitId → year → schedules
    const byUnit = new Map<string, Map<number, DPSchedule[]>>();

    for (const s of schedules) {
      const key = s.unitId ?? '__legacy__';
      if (!byUnit.has(key)) byUnit.set(key, new Map());
      const byYear = byUnit.get(key)!;
      if (!byYear.has(s.year)) byYear.set(s.year, []);
      byYear.get(s.year)!.push(s);
    }

    // Sort years descending within each unit; sort months descending within year
    byUnit.forEach(byYear => {
      byYear.forEach(items => items.sort((a, b) => b.month - a.month));
    });

    // Build ordered array: known units first (preserving DP unit order), then legacy
    const result: Array<{ unitId: string; unitName: string; byYear: [number, DPSchedule[]][] }> = [];

    // Per-unit sections, ordered by unit name
    const unitOrder = units.map(u => u.id);
    const seen = new Set<string>();
    for (const uid of [...unitOrder, ...[...byUnit.keys()].filter(k => k !== '__legacy__')]) {
      if (seen.has(uid) || !byUnit.has(uid)) continue;
      seen.add(uid);
      const unit = units.find(u => u.id === uid);
      result.push({
        unitId: uid,
        unitName: unit?.name ?? uid,
        byYear: Array.from(byUnit.get(uid)!.entries()).sort((a, b) => b[0] - a[0]),
      });
    }

    // Legacy section at the end
    if (byUnit.has('__legacy__')) {
      result.push({
        unitId: '__legacy__',
        unitName: 'Todas as unidades',
        byYear: Array.from(byUnit.get('__legacy__')!.entries()).sort((a, b) => b[0] - a[0]),
      });
    }

    return result;
  }, [schedules, units]);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteSchedule(deleteTarget.id);
      toast({ title: 'Escala excluída.' });
    } catch {
      toast({ title: 'Erro ao excluir escala.', variant: 'destructive' });
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  if (schedulesLoading) {
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

  return (
    <div className="space-y-8">
      <div className="rounded-md border border-dashed bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        debug: loading={String(schedulesLoading)} schedules={schedules.length} units={units.length} canCreate={String(canCreate)} canDelete={String(canDelete)}
      </div>
      {schedules.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
          <CalendarDays className="h-12 w-12 opacity-30" />
          <p className="text-sm">Nenhuma escala cadastrada.</p>
          {canCreate && (
            <Button onClick={() => openCreate()} className="mt-2">
              <Plus className="mr-2 h-4 w-4" />
              Criar primeira escala
            </Button>
          )}
        </div>
      ) : (
        groupedByUnit.map(({ unitId, unitName, byYear }) => (
          <div key={unitId}>
            {/* Unit section header */}
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                {unitName}
              </p>
              {canCreate && unitId !== '__legacy__' && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => openCreate(unitId)}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Criar
                </Button>
              )}
            </div>

            {/* Years within this unit */}
            <div className="space-y-4">
              {byYear.map(([year, items]) => (
                <div key={year}>
                  <p className="text-[10px] text-muted-foreground/60 mb-1.5 pl-1">{year}</p>
                  <div className="rounded-xl border bg-card overflow-hidden divide-y">
                    {items.map(s => (
                      <div
                        key={s.id}
                        className="flex items-center gap-4 px-4 py-3.5 cursor-pointer hover:bg-muted/40 transition-colors group"
                        onClick={() => router.push(`/dashboard/dp/schedules/${s.id}`)}
                        onMouseEnter={() => setHoveredId(s.id)}
                        onMouseLeave={() => setHoveredId(null)}
                      >
                        <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <CalendarDays className="h-4 w-4 text-primary" />
                        </div>

                        <p className="flex-1 text-sm font-medium flex items-center gap-2">
                          {MONTHS[s.month - 1]}
                          {s.locked && <Lock className="h-3 w-3 text-muted-foreground/60" />}
                        </p>

                        <Badge variant="secondary" className="text-xs shrink-0">
                          {s.shiftCount} {s.shiftCount === 1 ? 'turno' : 'turnos'}
                        </Badge>

                        {canDelete && hoveredId === s.id && (
                          <button
                            onClick={e => { e.stopPropagation(); setDeleteTarget(s); }}
                            className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {/* FABs */}
      <div className="fixed bottom-6 right-6 flex flex-col gap-2 items-end">
        {schedules.some(s => s.unitId) && (
          <Button
            onClick={() => setExportBizneoOpen(true)}
            variant="outline"
            className="rounded-full shadow-lg h-10 px-4 gap-2 bg-background"
          >
            <Download className="h-4 w-4" />
            Exportar Bizneo
          </Button>
        )}
        {canCreate && schedules.length > 0 && (
          <Button
            onClick={() => openCreate()}
            className="rounded-full shadow-lg h-12 px-5 gap-2"
            size="lg"
          >
            <Plus className="h-5 w-5" />
            Criar Escala
          </Button>
        )}
      </div>

      <CreateScheduleDialog open={createOpen} onOpenChange={setCreateOpen} defaultUnitId={createDefaultUnit} />
      <BizneoExportDialog open={exportBizneoOpen} onOpenChange={setExportBizneoOpen} />

      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir escala?</AlertDialogTitle>
            <AlertDialogDescription>
              A escala <strong>{deleteTarget?.name}</strong> e todos os seus turnos serão excluídos permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? 'Excluindo...' : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
