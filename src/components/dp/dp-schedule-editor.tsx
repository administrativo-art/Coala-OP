"use client";

import React, { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format, getDaysInMonth, isToday, parseISO, parse, subDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { useDP } from '@/components/dp-context';
import { useDPShifts } from '@/hooks/use-dp-shifts';
import { useDPHolidays } from '@/hooks/use-dp-holidays';
import { useDPSiblingShifts } from '@/hooks/use-dp-sibling-shifts';
import { useDPScheduleVacations } from '@/hooks/use-dp-schedule-vacations';
import { useAuth } from '@/hooks/use-auth';
import { useAuthenticatedApi } from '@/hooks/use-authenticated-api';
import { useKiosks } from '@/hooks/use-kiosks';
import type { DPCoverageDemandWindow, DPSchedule, DPScheduleSnapshot, DPShift, DPUnit, DPVacationRecord, Kiosk, User } from '@/types';
import type { PublishDayOffResult, RemoveDayOffResult } from '@/features/dp/day-offs/schemas';
import { cn } from '@/lib/utils';
import {
  activeOperationalUnits,
  canonicalOperationalUnitId,
  findOperationalUnitRecord,
  operationalUnitIdsMatch,
} from '@/lib/dp-units';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogClose,
  DialogDescription,
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Plus, Pencil, Trash2, AlertTriangle, CalendarDays, CalendarOff, Clock3, Loader2, Lock, LockOpen, Sparkles, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { BackButton } from '@/components/navigation/back-button';
import { getUserColor } from '@/lib/utils/user-colors';
import { useToast } from '@/hooks/use-toast';
import type { DPShiftDefinition } from '@/types';
import {
  getPrimaryShiftDefinitionUnitId,
  shiftDefinitionMatchesUnit,
} from '@/lib/dp-shift-definitions';
import { matchDPUnitForKiosk } from '@/lib/dp-kiosk-match';
import {
  buildCrossUnitConflictShiftIds,
  buildShiftStreakState,
  buildWorkDayOffConflictKeys,
  buildWorkDayOffConflictShiftIds,
  compareWorkShiftsByTime,
  isDayOffShift,
  isWorkShift,
} from '@/lib/dp-shift-rules';
import { buildDailyUnitCoverage } from '@/lib/dp-operating-hours';
import {
  buildDailyOnDemandCoverage,
  normalizeDPCoverageDemands,
  resolveDPCoverageMode,
  saveCoverageDemandsSchema,
  type DPDailyCoverage,
} from '@/lib/dp-coverage-demands';
import {
  buildApprovedVacationIndex,
  findApprovedVacationForDate,
  findApprovedVacationInIndex,
  formatVacationPeriod,
} from '@/lib/dp-vacation-schedule-rules';
import { DPBulkShiftEditPanel } from '@/components/dp/dp-bulk-shift-edit-dialog';
import { canAccessUnit, filterUnitsByAccess, resolveUnitAccess } from '@/lib/unit-access';

// ─── Constants ────────────────────────────────────────────────────────────────

const DOW_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const WEEK_TONES = [
  { bar: 'border-l-sky-400', bg: 'bg-sky-50', hover: 'hover:bg-sky-100', text: 'text-sky-700' },
  { bar: 'border-l-violet-400', bg: 'bg-violet-50', hover: 'hover:bg-violet-100', text: 'text-violet-700' },
  { bar: 'border-l-emerald-400', bg: 'bg-emerald-50', hover: 'hover:bg-emerald-100', text: 'text-emerald-700' },
  { bar: 'border-l-amber-400', bg: 'bg-amber-50', hover: 'hover:bg-amber-100', text: 'text-amber-700' },
  { bar: 'border-l-rose-400', bg: 'bg-rose-50', hover: 'hover:bg-rose-100', text: 'text-rose-700' },
  { bar: 'border-l-cyan-400', bg: 'bg-cyan-50', hover: 'hover:bg-cyan-100', text: 'text-cyan-700' },
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase();
}

// Semana do mês (1-based) a que um dia pertence — alinhada ao domingo.
function weekOfMonth(year: number, month: number, day: number) {
  const firstDow = new Date(year, month - 1, 1).getDay();
  return Math.floor((day + firstDow - 1) / 7) + 1;
}

// Anel de "dias consecutivos" no estilo do protótipo: cinza (1–4), âmbar (5–6),
// vermelho cheio (7+). Mostra a contagem no centro.
function StreakRing({ count }: { count: number }) {
  const pct = Math.round((Math.min(count, 7) / 7) * 100);
  const danger = count >= 7;
  const warn = count >= 5 && count < 7;
  const fill = danger
    ? 'hsl(var(--destructive))'
    : warn
      ? '#f59e0b'
      : 'hsl(var(--muted-foreground) / 0.55)';
  return (
    <span
      className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full"
      style={{
        background: danger
          ? 'hsl(var(--destructive))'
          : `conic-gradient(${fill} 0 ${pct}%, hsl(var(--muted)) 0)`,
      }}
      title={`${count} ${count === 1 ? 'dia consecutivo' : 'dias consecutivos'}`}
    >
      <span
        className="grid h-[16px] w-[16px] place-items-center rounded-full bg-card text-[9.5px] font-black tabular-nums"
        style={{ color: danger ? 'hsl(var(--destructive))' : warn ? '#b45309' : 'hsl(var(--muted-foreground))' }}
      >
        {count}
      </span>
    </span>
  );
}

function shiftVacationKey(shift: Pick<DPShift, 'scheduleId' | 'id'>) {
  return `${shift.scheduleId}:${shift.id}`;
}

function userMatchesDPUnit(user: Pick<User, 'unitIds' | 'assignedKioskIds'>, unitId: string | undefined, units: DPUnit[], kiosks: Kiosk[]) {
  if (!unitId) return true;
  if (user.unitIds?.includes(unitId)) return true;

  const assignedKioskIds = user.assignedKioskIds ?? [];
  if (assignedKioskIds.length === 0 || units.length === 0 || kiosks.length === 0) return false;

  return assignedKioskIds.some((kioskId) => {
    const kiosk = kiosks.find((item) => item.id === kioskId);
    if (!kiosk) return false;
    return matchDPUnitForKiosk(kiosk.name, units)?.id === unitId;
  });
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const shiftSchema = z.object({
  userId: z.string().min(1, 'Selecione um colaborador.'),
  unitId: z.string().min(1, 'Selecione uma unidade.'),
  date: z.string().min(1, 'Selecione a data.'),
  shiftDefinitionId: z.string().optional(),
  startTime: z.string().min(1, 'Informe o horário de início.'),
  endTime: z.string().min(1, 'Informe o horário de fim.'),
});

type ShiftFormValues = z.infer<typeof shiftSchema>;

// ─── Shift Dialog ─────────────────────────────────────────────────────────────

interface ShiftDialogProps {
  scheduleId: string;
  shift?: DPShift | null;
  defaultDate?: string;
  defaultUnitId?: string;
  units: DPUnit[];
  shiftDefinitions: DPShiftDefinition[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** userId → Set<date> of dates already occupied in sibling units */
  siblingOccupied?: Map<string, Set<string>>;
  /** userId → datas com folga explicitamente registrada */
  dayOffOccupied?: Map<string, Set<string>>;
  vacations: DPVacationRecord[];
  onDelete?: (shift: DPShift) => void;
}

function ShiftDialog({
  scheduleId, shift, defaultDate, defaultUnitId, units, shiftDefinitions, open, onOpenChange, siblingOccupied, dayOffOccupied, vacations, onDelete,
}: ShiftDialogProps) {
  const { activeUsers } = useAuth();
  const { kiosks } = useKiosks();
  const { addShift, updateShift } = useDPShifts(scheduleId);
  const { toast } = useToast();
  const isEdit = !!shift;

  // Pre-set unit from column click — hide unit selector if locked
  const unitLocked = !isEdit && !!defaultUnitId;

  // Active unit for filtering (defaultUnitId when locked, or single unit in per-unit mode)
  const activeUnitIdForDefs = defaultUnitId ?? (units.length === 1 ? units[0].id : undefined);

  // In per-unit mode, show users linked by DP unit or by the matching kiosk assignment.
  const operationalUsers = (() => {
    const all = activeUsers.filter(u => u.operacional === true);
    if (!activeUnitIdForDefs) return all;
    const linked = all.filter(u => userMatchesDPUnit(u, activeUnitIdForDefs, units, kiosks));
    return linked.length > 0 ? linked : all; // fallback to all if no unitIds configured
  })();

  const form = useForm<ShiftFormValues>({
    resolver: zodResolver(shiftSchema),
    defaultValues: {
      userId: shift?.userId ?? '',
      unitId: shift?.unitId ?? defaultUnitId ?? '',
      date: shift?.date ?? defaultDate ?? '',
      shiftDefinitionId: shift?.shiftDefinitionId ?? '',
      startTime: shift?.startTime ?? '',
      endTime: shift?.endTime ?? '',
    },
  });

  React.useEffect(() => {
    if (open) {
      form.reset({
        userId: shift?.userId ?? '',
        unitId: shift?.unitId ?? defaultUnitId ?? '',
        date: shift?.date ?? defaultDate ?? '',
        shiftDefinitionId: shift?.shiftDefinitionId ?? '',
        startTime: shift?.startTime ?? '',
        endTime: shift?.endTime ?? '',
      });
    }
  }, [open, shift, defaultDate, defaultUnitId]);

  const selectedUserId = form.watch('userId');
  const selectedDate = form.watch('date');
  const selectedUnitId = form.watch('unitId');
  const vacationConflict = useMemo(
    () => findApprovedVacationForDate(vacations, selectedUserId, selectedDate),
    [selectedDate, selectedUserId, vacations],
  );
  const modalDateLabel = selectedDate
    ? format(parseISO(selectedDate), 'dd/MM')
    : 'sem data';
  const modalUnitName = units.find((unit) => unit.id === selectedUnitId)?.name ?? 'Unidade não informada';

  function handleDefinitionChange(defId: string) {
    form.setValue('shiftDefinitionId', defId);
    const def = shiftDefinitions.find(d => d.id === defId);
    if (def) {
      form.setValue('startTime', def.startTime);
      form.setValue('endTime', def.endTime);
      if (!unitLocked) {
        const primaryUnitId = getPrimaryShiftDefinitionUnitId(def);
        const currentUnitId = form.getValues('unitId');
        if (primaryUnitId && (!currentUnitId || shiftDefinitionMatchesUnit(def, currentUnitId) === false)) {
          form.setValue('unitId', primaryUnitId);
        }
      }
    }
  }

  async function onSubmit(values: ShiftFormValues) {
    if (dayOffOccupied?.get(values.userId)?.has(values.date)) {
      toast({
        title: 'Existe uma folga confirmada nesta data.',
        description: 'Remova a folga e aguarde a confirmação do Bizneo antes de atribuir o turno.',
        variant: 'destructive',
      });
      return;
    }

    const approvedVacation = findApprovedVacationForDate(vacations, values.userId, values.date);
    if (approvedVacation) {
      toast({
        title: 'Colaborador(a) em férias nesta data.',
        description: `Período aprovado: ${formatVacationPeriod(approvedVacation)}.`,
        variant: 'destructive',
      });
      return;
    }

    const hasCrossConflict = !!siblingOccupied?.get(values.userId)?.has(values.date);
    const userName = operationalUsers.find((user) => user.id === values.userId)?.username ?? shift?.userName;
    try {
      if (isEdit && shift) {
        await updateShift({ ...shift, ...values, ...(userName ? { userName } : {}), type: 'work', hasConflict: hasCrossConflict });
        toast({ title: 'Turno atualizado.' });
      } else {
        await addShift({ ...values, scheduleId, ...(userName ? { userName } : {}), type: 'work', hasConflict: hasCrossConflict });
        toast({ title: 'Turno adicionado.' });
      }
      if (hasCrossConflict) {
        toast({
          title: 'Conflito entre unidades',
          description: 'Este colaborador já está escalado em outra unidade neste dia.',
          variant: 'destructive',
        });
      }
      onOpenChange(false);
    } catch (error) {
      toast({
        title: 'Erro ao salvar turno.',
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        overlayClassName="!bg-[#0f172a]/[0.42]"
        className="max-h-[86vh] !max-w-[430px] gap-0 overflow-y-auto !rounded-[18px] border-0 bg-white !p-5 shadow-[0_40px_80px_-30px_rgba(15,23,42,0.6)]"
      >
        <DialogHeader className="relative space-y-0 pr-10 text-left">
          <DialogTitle className="text-[16.5px] font-black leading-tight tracking-[-0.015em] text-[#0f172a]">
            {isEdit ? 'Editar turno' : 'Novo turno'} · {modalDateLabel}
          </DialogTitle>
          <DialogDescription className="mt-1 text-[12.5px] font-semibold leading-[1.45] text-[#7d8a9d]">
            {modalUnitName} · colaboradora e faixa de horário.
          </DialogDescription>
          <DialogClose className="absolute -right-0 -top-0 grid h-7 w-7 place-items-center rounded-[9px] border border-[#e6ebf2] text-[#94a3b8] transition-colors hover:border-[#cbd5e1] hover:bg-[#f8fafc] hover:text-[#475569] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0ea5e9]">
            <X className="h-[13px] w-[13px]" strokeWidth={2.6} />
            <span className="sr-only">Fechar</span>
          </DialogClose>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-0">

            <FormField control={form.control} name="userId" render={({ field }) => (
              <FormItem className="mt-[15px] space-y-2">
                <FormLabel className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#94a3b8]">Colaboradora</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl><SelectTrigger className="h-9 rounded-[9px] border-[#e3e9f1] bg-white px-2.5 text-xs font-bold text-[#334155] focus:ring-2 focus:ring-[#0ea5e9] focus:ring-offset-0"><SelectValue placeholder="Selecione" /></SelectTrigger></FormControl>
                  <SelectContent className="rounded-[11px] border-[#e3e9f1] text-xs shadow-[0_22px_44px_-24px_rgba(15,23,42,0.5)]">
                    {operationalUsers.map(u => (
                      <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage className="text-[11px]" />
              </FormItem>
            )} />

            {(!defaultDate || isEdit) && (
              <FormField control={form.control} name="date" render={({ field }) => (
                <FormItem className="mt-[15px] space-y-2">
                  <FormLabel className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#94a3b8]">Data</FormLabel>
                  <FormControl><Input type="date" className="h-9 rounded-[9px] border-[#e3e9f1] bg-white px-2.5 text-xs font-bold text-[#334155] focus-visible:ring-2 focus-visible:ring-[#0ea5e9] focus-visible:ring-offset-0" {...field} /></FormControl>
                  <FormMessage className="text-[11px]" />
                </FormItem>
              )} />
            )}

            {!unitLocked && (
              <FormField control={form.control} name="unitId" render={({ field }) => (
                <FormItem className="mt-[15px] space-y-2">
                  <FormLabel className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#94a3b8]">Unidade</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger className="h-9 rounded-[9px] border-[#e3e9f1] bg-white px-2.5 text-xs font-bold text-[#334155] focus:ring-2 focus:ring-[#0ea5e9] focus:ring-offset-0"><SelectValue placeholder="Selecione a unidade" /></SelectTrigger></FormControl>
                    <SelectContent className="rounded-[11px] border-[#e3e9f1] text-xs shadow-[0_22px_44px_-24px_rgba(15,23,42,0.5)]">
                      {activeOperationalUnits(units).map(u => (
                        <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage className="text-[11px]" />
                </FormItem>
              )} />
            )}

            <FormField control={form.control} name="shiftDefinitionId" render={({ field }) => (
              <FormItem className="mt-[15px] space-y-2">
                <FormLabel className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#94a3b8]">Turno</FormLabel>
                <Select
                  value={field.value || '__none__'}
                  onValueChange={v => handleDefinitionChange(v === '__none__' ? '' : v)}
                >
                  <FormControl><SelectTrigger className="h-9 rounded-[9px] border-[#e3e9f1] bg-white px-2.5 text-xs font-bold text-[#334155] focus:ring-2 focus:ring-[#0ea5e9] focus:ring-offset-0"><SelectValue placeholder="Selecionar turno" /></SelectTrigger></FormControl>
                  <SelectContent className="rounded-[11px] border-[#e3e9f1] text-xs shadow-[0_22px_44px_-24px_rgba(15,23,42,0.5)]">
                    <SelectItem value="__none__">— Manual —</SelectItem>
                    {(activeUnitIdForDefs
                      ? shiftDefinitions.filter(d => shiftDefinitionMatchesUnit(d, activeUnitIdForDefs))
                      : shiftDefinitions
                    ).map(def => (
                      <SelectItem key={def.id} value={def.id}>
                        {def.name} ({def.startTime}–{def.endTime})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage className="text-[11px]" />
              </FormItem>
            )} />

            <div className="mt-[15px] grid grid-cols-2 gap-3">
              <FormField control={form.control} name="startTime" render={({ field }) => (
                <FormItem className="space-y-2">
                  <FormLabel className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#94a3b8]">Início</FormLabel>
                  <FormControl><Input type="time" className="h-9 rounded-[9px] border-[#e3e9f1] bg-white px-2.5 text-xs font-bold text-[#334155] focus-visible:ring-2 focus-visible:ring-[#0ea5e9] focus-visible:ring-offset-0" {...field} /></FormControl>
                  <FormMessage className="text-[11px]" />
                </FormItem>
              )} />
              <FormField control={form.control} name="endTime" render={({ field }) => (
                <FormItem className="space-y-2">
                  <FormLabel className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#94a3b8]">Fim</FormLabel>
                  <FormControl><Input type="time" className="h-9 rounded-[9px] border-[#e3e9f1] bg-white px-2.5 text-xs font-bold text-[#334155] focus-visible:ring-2 focus-visible:ring-[#0ea5e9] focus-visible:ring-offset-0" {...field} /></FormControl>
                  <FormMessage className="text-[11px]" />
                </FormItem>
              )} />
            </div>

            {vacationConflict && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div>
                  <p className="font-semibold">Colaborador(a) em férias nesta data.</p>
                  <p>Período aprovado: {formatVacationPeriod(vacationConflict)}.</p>
                </div>
              </div>
            )}

            <DialogFooter className="!mt-6 !flex !flex-row !items-center !justify-between gap-3 sm:!justify-between sm:!space-x-0">
              {isEdit && shift && onDelete ? (
                <Button type="button" variant="outline" onClick={() => onDelete(shift)} className="h-[34px] rounded-[10px] border-[#fbd0da] px-[13px] text-[12.5px] font-extrabold text-[#be123c] hover:border-[#f7a9bc] hover:bg-[#fef2f4] hover:text-[#be123c]">
                  Remover
                </Button>
              ) : <span />}
              <div className="ml-auto flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="h-[34px] rounded-[10px] border-[#e6ebf2] px-3.5 text-[12.5px] font-extrabold text-[#475569] hover:bg-[#f8fafc]">Fechar</Button>
              <Button type="submit" disabled={form.formState.isSubmitting || !!vacationConflict} className="h-[34px] rounded-[10px] bg-[#db2777] px-4 text-[12.5px] font-extrabold text-white hover:bg-[#be185d]">
                {form.formState.isSubmitting ? 'Salvando...' : isEdit ? 'Salvar alterações' : 'Salvar turno'}
              </Button>
              </div>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function ManualDayOffDialog({
  open,
  onOpenChange,
  date,
  unit,
  users,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string;
  unit?: DPUnit;
  users: User[];
  onConfirm: (userId: string) => Promise<boolean>;
}) {
  const [userId, setUserId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  React.useEffect(() => {
    if (open) setUserId('');
  }, [open]);

  async function handleConfirm() {
    if (!userId) return;
    setSubmitting(true);
    try {
      const success = await onConfirm(userId);
      if (success) onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !submitting && onOpenChange(nextOpen)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Lançar folga manualmente</DialogTitle>
          <DialogDescription>
            A folga será registrada no Coala One e publicada no Bizneo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
            <p className="font-medium">
              {date ? format(parseISO(date), "dd 'de' MMMM 'de' yyyy", { locale: ptBR }) : 'Data não informada'}
            </p>
            <p className="text-xs text-muted-foreground">{unit?.name ?? 'Unidade não informada'}</p>
          </div>

          <div className="space-y-1.5">
            <Label>Colaboradora</Label>
            <Select value={userId} onValueChange={setUserId} disabled={submitting}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {users.map((item) => (
                  <SelectItem key={item.id} value={item.id} disabled={!item.registrationIdBizneo}>
                    {item.username}{item.registrationIdBizneo ? '' : ' — sem vínculo Bizneo'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <p className="text-xs text-muted-foreground">
            Se existir um turno de trabalho nessa data, remova ou substitua o turno antes de lançar a folga.
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" disabled={!userId || submitting} onClick={() => void handleConfirm()}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirmar folga
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Shift Card ───────────────────────────────────────────────────────────────

interface ShiftCardProps {
  shift: DPShift;
  vacationConflict?: DPVacationRecord | null;
  userName: string;
  userAvatar?: string;
  userColor?: string;
  shiftDef?: DPShiftDefinition;
  canEdit: boolean;
  selectionMode?: boolean;
  selected?: boolean;
  onSelect?: (shift: DPShift) => void;
  onEdit: (shift: DPShift) => void;
  onDelete: (shift: DPShift) => void;
}

function ShiftCard({
  shift,
  vacationConflict,
  userName,
  userAvatar,
  userColor,
  shiftDef,
  canEdit,
  selectionMode,
  selected,
  onSelect,
  onEdit,
  onDelete,
}: ShiftCardProps) {
  const accentColor = getUserColor(shift.userId, userColor);
  const hasVisibleConflict = shift.hasConflict || !!vacationConflict;
  const vacationPeriod = vacationConflict ? formatVacationPeriod(vacationConflict) : null;
  const shiftLabel = shiftDef?.name?.trim() || 'Turno manual';
  const cardDetails = `${userName} · ${shiftLabel} · ${shift.startTime}–${shift.endTime}${vacationPeriod ? ` · Conflito: férias aprovadas de ${vacationPeriod}` : ''}`;
  return (
    <div
      role={selectionMode ? 'button' : 'group'}
      aria-label={cardDetails}
      tabIndex={selectionMode ? 0 : undefined}
      onClick={selectionMode ? () => onSelect?.(shift) : undefined}
      onKeyDown={selectionMode ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect?.(shift);
        }
      } : undefined}
      className={cn(
        'group relative flex min-w-0 items-center gap-1.5 rounded-lg border border-l-[3px] px-1.5 py-1 text-[11px] transition-colors',
        hasVisibleConflict
          ? 'bg-destructive/10 border-destructive/20'
          : 'bg-card border-border hover:bg-muted/30',
        selectionMode && 'cursor-pointer',
        selected && 'ring-2 ring-primary bg-primary/5 border-primary/30'
      )}
      style={hasVisibleConflict ? undefined : { borderLeftColor: accentColor }}
      title={cardDetails}
    >
      <Avatar className="h-5 w-5 shrink-0">
        <AvatarImage src={userAvatar} />
        <AvatarFallback className="text-[9px] font-semibold">
          {initials(userName)}
        </AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        <p className="font-semibold truncate text-foreground leading-tight">{userName}</p>
        <p className="mt-px whitespace-normal break-words text-[9px] font-bold uppercase leading-[11px] tracking-[0.01em] text-muted-foreground">
          {shiftLabel}
        </p>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {selectionMode && (
          <span className={cn(
            'rounded-full border px-1.5 py-0.5 text-[10px] font-semibold',
            selected
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border text-muted-foreground'
          )}>
            {selected ? 'Selecionado' : 'Selecionar'}
          </span>
        )}
        {vacationConflict && (
          <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-bold text-destructive">
            Férias
          </span>
        )}
        {hasVisibleConflict && (
          <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
        )}
        {shift.consecutiveDayCount && shift.consecutiveDayCount >= 1 && (
          <StreakRing count={shift.consecutiveDayCount} />
        )}
      </div>

      {canEdit && !selectionMode && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-end gap-0.5 rounded-lg bg-background/90 pr-1.5 opacity-0 transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
          <button type="button" aria-label={`Editar turno de ${userName}`} onClick={() => onEdit(shift)} className="flex h-6 w-6 items-center justify-center rounded hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Pencil className="h-3 w-3" />
          </button>
          <button type="button" aria-label={`Remover turno de ${userName}`} onClick={() => onDelete(shift)} className="flex h-6 w-6 items-center justify-center rounded text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Ghost Shift Badge ────────────────────────────────────────────────────────

function GhostShiftBadge({ shift, unitName, consecutiveDayCount, user, vacationConflict }: {
  shift: DPShift;
  unitName: string;
  consecutiveDayCount: number;
  user: { username: string; avatarUrl?: string; color?: string };
  vacationConflict?: DPVacationRecord | null;
}) {
  const color = user.color ?? getUserColor(user.username);
  const countColor = consecutiveDayCount >= 7 ? 'text-destructive' : consecutiveDayCount >= 5 ? 'text-orange-500' : 'text-muted-foreground/60';
  const vacationPeriod = vacationConflict ? formatVacationPeriod(vacationConflict) : null;
  return (
    <div
      className={cn(
        'inline-flex h-6 w-fit max-w-full min-w-0 items-center gap-1 rounded-[7px] border border-dashed px-1.5 py-0 self-start justify-self-start',
        vacationConflict
          ? 'border-destructive/30 bg-destructive/10'
          : 'border-muted-foreground/25 bg-muted/20',
      )}
      title={vacationPeriod
        ? `${user.username} — conflito com férias aprovadas de ${vacationPeriod}`
        : `${user.username} — ${shift.startTime}–${shift.endTime} (${unitName}) · ${consecutiveDayCount} dias consecutivos`}
    >
      <Avatar className="h-3.5 w-3.5 shrink-0">
        <AvatarImage src={user.avatarUrl} />
        <AvatarFallback style={{ background: color, fontSize: 6 }} className="text-white">
          {initials(user.username)}
        </AvatarFallback>
      </Avatar>
      <span className="max-w-20 truncate text-[9.5px] font-semibold text-muted-foreground">{user.username}</span>
      <span className="shrink-0 text-[9.5px] text-muted-foreground/60">{shift.startTime}–{shift.endTime}</span>
      {vacationConflict && (
        <span className="rounded bg-destructive/15 px-1 py-0.5 text-[8.5px] font-bold text-destructive">Férias</span>
      )}
      <span className={`shrink-0 text-[9.5px] font-bold ${countColor}`}>{consecutiveDayCount}</span>
      <span className="max-w-24 shrink truncate rounded bg-muted px-1 text-[8.5px] text-muted-foreground/70">{unitName}</span>
    </div>
  );
}

// ─── Last Sunday Badge ────────────────────────────────────────────────────────

function LastSundayBadge({ user, dateLabel }: {
  user: { username: string; avatarUrl?: string; color?: string };
  dateLabel: string;
}) {
  const color = user.color ?? getUserColor(user.username);
  return (
    <div
      className="inline-flex h-6 w-fit max-w-full min-w-0 items-center gap-1 rounded-[7px] border border-dashed border-muted-foreground/25 bg-muted/20 px-1.5 py-0 self-start justify-self-start"
      title={`${user.username} — trabalhou no domingo anterior (${dateLabel})`}
    >
      <Avatar className="h-3.5 w-3.5 shrink-0">
        <AvatarImage src={user.avatarUrl} />
        <AvatarFallback style={{ background: color, fontSize: 6 }} className="text-white">
          {initials(user.username)}
        </AvatarFallback>
      </Avatar>
      <span className="max-w-24 truncate text-[9.5px] font-semibold text-muted-foreground">{user.username}</span>
    </div>
  );
}

function DayOffBadge({
  explicit,
  shift,
  user,
  contextLabel,
  canPublish,
  canRemove,
  publishing,
  removing,
  onPublish,
  onRemove,
  conflictsWithWork = false,
}: {
  explicit: boolean;
  shift?: DPShift;
  user: { username: string; avatarUrl?: string; color?: string };
  contextLabel?: string;
  canPublish: boolean;
  canRemove: boolean;
  publishing: boolean;
  removing: boolean;
  onPublish: () => void;
  onRemove: () => void;
  conflictsWithWork?: boolean;
}) {
  const color = user.color ?? getUserColor(user.username);
  const status = shift?.bizneoSyncStatus;
  const isPublished = explicit && status === 'published';
  const isPublishing = publishing;
  const isRemoving = removing || status === 'removing';
  const removalFailed = status === 'removal_failed';
  const hasFailed = explicit && status === 'failed';
  const isPendingRetry = explicit && (status === 'publishing' || status === 'pending');
  const needsRetry = hasFailed || isPendingRetry;
  const canAction = canPublish && !isPublished && !isPublishing && !isRemoving && !removalFailed;
  const canRemoveAction = canRemove && explicit && !isPublishing && !isRemoving;
  const actionLabel = needsRetry ? 'Tentar novamente' : explicit ? 'Enviar ao Bizneo' : 'Confirmar folga';
  let badgeLabel = 'Folga';
  if (isRemoving) badgeLabel = 'Removendo';
  else if (removalFailed) badgeLabel = 'Falha ao remover';
  else if (isPublishing) badgeLabel = 'Enviando';
  else if (!explicit) badgeLabel = canAction ? actionLabel : 'Folga prevista';
  else if (isPublished) badgeLabel = 'Folga confirmada';
  else if (hasFailed) badgeLabel = 'Falha no Bizneo';
  else if (isPendingRetry) badgeLabel = 'Envio pendente';

  if (conflictsWithWork) badgeLabel = 'Conflito: também escalada';

  const badgeTone = conflictsWithWork || hasFailed || removalFailed
    ? 'border-destructive/30 bg-destructive/5 text-destructive'
    : isPendingRetry
      ? 'border-amber-300/60 bg-amber-50/70 text-amber-700 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-300'
      : explicit
        ? 'border-emerald-200 bg-emerald-50/80 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300'
        : 'border-sky-200 bg-sky-50/80 text-sky-700 dark:border-sky-900/40 dark:bg-sky-950/20 dark:text-sky-300';
  return (
    <div
      className={cn(
        'rounded border px-2 py-1.5 min-w-0',
        badgeTone,
      )}
      title={`${user.username} — ${badgeLabel}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <Avatar className="w-5 h-5 shrink-0">
          <AvatarImage src={user.avatarUrl} />
          <AvatarFallback style={{ background: color }} className="text-[8px] text-white">
            {initials(user.username)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-medium">{user.username}</p>
          {contextLabel && (
            <p className="truncate text-[9px] opacity-75">{contextLabel}</p>
          )}
        </div>
        {canAction ? (
          <button
            type="button"
            onClick={onPublish}
            className={cn(
              'ml-auto inline-flex h-6 shrink-0 items-center justify-center rounded-full border px-3 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              hasFailed
                ? 'border-destructive/30 hover:bg-destructive/10'
                : 'border-border/60 bg-background/70 hover:bg-background',
            )}
          >
            {actionLabel}
          </button>
        ) : (
          <Badge variant="outline" className="ml-auto shrink-0 text-[10px]">
            {(isPublishing || isRemoving) && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            {badgeLabel}
          </Badge>
        )}
        {canRemoveAction && (
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-current/60 transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label={removalFailed ? `Tentar remover novamente a folga de ${user.username}` : `Remover folga de ${user.username}`}
            title={removalFailed ? 'Tentar remover novamente' : 'Remover folga'}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

function CoverageStatus({
  coverage,
  canEditDemand,
  onEditDemand,
}: {
  coverage: DPDailyCoverage;
  canEditDemand: boolean;
  onEditDemand?: () => void;
}) {
  if (coverage.mode === 'fixed_hours' && coverage.gaps.length === 0) return null;

  if (coverage.mode === 'on_demand' && !coverage.hasDemand) {
    return (
      <div className={cn(
        'flex items-center justify-between gap-2 rounded-lg border border-dashed px-2.5 py-2',
        coverage.hasUnplannedShifts
          ? 'border-amber-300 bg-amber-50/60 text-amber-800 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-300'
          : 'border-border/70 bg-muted/20 text-muted-foreground',
      )}>
        <div className="flex min-w-0 items-center gap-2">
          <Clock3 className="h-3.5 w-3.5 shrink-0" />
          <p className="truncate text-[11px] font-medium">
            {coverage.hasUnplannedShifts ? 'Equipe escalada sem demanda' : 'Sem demanda'}
          </p>
        </div>
        {canEditDemand && onEditDemand ? (
          <button
            type="button"
            onClick={onEditDemand}
            className="shrink-0 text-[10px] font-semibold text-primary hover:underline"
          >
            Definir
          </button>
        ) : null}
      </div>
    );
  }

  if (coverage.mode === 'on_demand' && coverage.gaps.length === 0) {
    const ranges = coverage.windows
      .map((window) => `${window.startTime}–${window.endTime} · ${window.minimumPeople} pessoa${window.minimumPeople === 1 ? '' : 's'}`)
      .join(', ');
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-300 bg-emerald-50/60 px-2.5 py-2 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300" title={ranges}>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold">Demanda coberta</p>
          <p className="truncate text-[10px]">{ranges}</p>
        </div>
        {canEditDemand && onEditDemand ? (
          <button type="button" onClick={onEditDemand} className="shrink-0 text-[10px] font-semibold hover:underline">
            Editar
          </button>
        ) : null}
      </div>
    );
  }

  const gaps = coverage.gaps.map((gap) => {
    const people = gap.requiredPeople === undefined
      ? ''
      : ` · ${gap.scheduledPeople ?? 0}/${gap.requiredPeople} pessoas`;
    return `${gap.startTime}–${gap.endTime}${people}`;
  }).join(', ');
  const wholeDayUncovered = coverage.mode === 'fixed_hours'
    && coverage.gaps.length === 1
    && coverage.gaps[0].startTime === coverage.startTime
    && coverage.gaps[0].endTime === coverage.endTime;
  return (
    <div
      className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-destructive"
      title={`Período sem cobertura: ${gaps}`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-[11px] font-semibold">
            {wholeDayUncovered ? 'Unidade sem cobertura' : 'Cobertura incompleta'}
          </p>
          <p className="truncate text-[10px]">Falta: {gaps}</p>
        </div>
      </div>
      {coverage.mode === 'on_demand' && canEditDemand && onEditDemand ? (
        <button type="button" onClick={onEditDemand} className="shrink-0 text-[10px] font-semibold hover:underline">
          Editar
        </button>
      ) : null}
    </div>
  );
}

type CoverageDemandRow = DPCoverageDemandWindow & { reason: string };

function emptyCoverageDemandRow(): CoverageDemandRow {
  return { startTime: '09:00', endTime: '18:00', minimumPeople: 1, reason: '' };
}

function CoverageDemandDialog({
  scheduleId,
  unit,
  date,
  initialWindows,
  open,
  onOpenChange,
  onSaved,
}: {
  scheduleId: string;
  unit: DPUnit;
  date: string;
  initialWindows: DPCoverageDemandWindow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (date: string, windows: DPCoverageDemandWindow[]) => void;
}) {
  const api = useAuthenticatedApi();
  const { toast } = useToast();
  const [rows, setRows] = useState<CoverageDemandRow[]>([]);
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (!open) return;
    setRows(initialWindows.length > 0
      ? initialWindows.map((window) => ({ ...window, reason: window.reason ?? '' }))
      : [emptyCoverageDemandRow()]);
  }, [initialWindows, open]);

  const parsed = saveCoverageDemandsSchema.safeParse({
    unitId: unit.id,
    windows: rows.map((row) => ({ ...row, reason: row.reason.trim() || undefined })),
  });

  async function save(windows: DPCoverageDemandWindow[]) {
    if (saving) return;
    setSaving(true);
    try {
      const result = await api<{ date: string; windows: DPCoverageDemandWindow[] }>(
        `/api/dp/schedules/${encodeURIComponent(scheduleId)}/coverage-demands/${encodeURIComponent(date)}`,
        {
          method: 'PUT',
          json: { unitId: unit.id, windows },
          fallbackError: 'Falha ao salvar a demanda.',
        },
      );
      onSaved(result.date, result.windows);
      onOpenChange(false);
      toast({ title: windows.length > 0 ? 'Demanda salva.' : 'Demanda removida.' });
    } catch (caught) {
      toast({
        title: 'Não foi possível salvar a demanda.',
        description: caught instanceof Error ? caught.message : 'Tente novamente.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }

  const formattedDate = format(parseISO(date), "EEEE, dd 'de' MMMM", { locale: ptBR });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Demanda do dia</DialogTitle>
          <DialogDescription className="capitalize">
            {unit.name} · {formattedDate}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {rows.map((row, index) => (
            <div key={`${index}-${row.startTime}`} className="grid gap-3 rounded-xl border p-3 sm:grid-cols-[105px_105px_100px_minmax(0,1fr)_auto]">
              <div className="space-y-1.5">
                <Label htmlFor={`demand-start-${index}`}>Início</Label>
                <Input
                  id={`demand-start-${index}`}
                  type="time"
                  value={row.startTime}
                  onChange={(event) => setRows((current) => current.map((item, itemIndex) => (
                    itemIndex === index ? { ...item, startTime: event.target.value } : item
                  )))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`demand-end-${index}`}>Fim</Label>
                <Input
                  id={`demand-end-${index}`}
                  type="time"
                  value={row.endTime}
                  onChange={(event) => setRows((current) => current.map((item, itemIndex) => (
                    itemIndex === index ? { ...item, endTime: event.target.value } : item
                  )))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`demand-people-${index}`}>Mínimo</Label>
                <Input
                  id={`demand-people-${index}`}
                  type="number"
                  min={1}
                  max={50}
                  value={row.minimumPeople}
                  onChange={(event) => setRows((current) => current.map((item, itemIndex) => (
                    itemIndex === index ? { ...item, minimumPeople: Number(event.target.value) } : item
                  )))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`demand-reason-${index}`}>Motivo</Label>
                <Input
                  id={`demand-reason-${index}`}
                  value={row.reason}
                  maxLength={160}
                  placeholder="Ex.: recebimento de carga"
                  onChange={(event) => setRows((current) => current.map((item, itemIndex) => (
                    itemIndex === index ? { ...item, reason: event.target.value } : item
                  )))}
                />
              </div>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setRows((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                  aria-label={`Remover intervalo ${index + 1}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRows((current) => [...current, emptyCoverageDemandRow()])}
            disabled={rows.length >= 12}
          >
            <Plus className="mr-2 h-4 w-4" />
            Adicionar intervalo
          </Button>
          {!parsed.success && rows.length > 0 ? (
            <p className="text-xs font-medium text-destructive">
              Confira os horários, a quantidade mínima e evite intervalos sobrepostos.
            </p>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={() => void save([])}
            disabled={saving || initialWindows.length === 0}
          >
            Remover demanda
          </Button>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => parsed.success && void save(parsed.data.windows)}
              disabled={saving || rows.length === 0 || !parsed.success}
            >
              {saving ? 'Salvando...' : 'Salvar demanda'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UnassignedBadge({ user, statusLabel = 'Sem unidade vinculada' }: {
  user: { username: string; avatarUrl?: string; color?: string };
  statusLabel?: 'Sem unidade vinculada' | 'Férias';
}) {
  const color = user.color ?? getUserColor(user.username);
  const isVacation = statusLabel === 'Férias';
  return (
    <div
      className={cn(
        'rounded border px-2 py-1.5',
        isVacation
          ? 'border-violet-200 bg-violet-50/70 text-violet-700 dark:border-violet-900 dark:bg-violet-950/20 dark:text-violet-300'
          : 'border-slate-200 bg-slate-50/70 text-slate-600 dark:border-slate-800 dark:bg-slate-950/20 dark:text-slate-300',
      )}
      title={`${user.username} — ${isVacation ? 'Férias aprovadas' : 'Sem unidade vinculada neste dia'}`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Avatar className="h-5 w-5 shrink-0">
          <AvatarImage src={user.avatarUrl} />
          <AvatarFallback style={{ background: color }} className="text-[8px] text-white">
            {initials(user.username)}
          </AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium">{user.username}</span>
        <Badge variant="outline" className="shrink-0 text-[10px] font-medium">
          {statusLabel}
        </Badge>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface DPScheduleEditorProps {
  schedule: DPSchedule;
  embedded?: boolean;
  onBack?: () => void;
  onPreviousMonth?: () => void;
  onNextMonth?: () => void;
}

export function DPScheduleEditor({ schedule, embedded = false, onBack, onPreviousMonth, onNextMonth }: DPScheduleEditorProps) {
  const { activeUsers, permissions, updateUser, user, isDefaultAdmin } = useAuth();
  const { kiosks } = useKiosks();
  const {
    updateSchedule,
    units,
    shiftDefinitions,
    schedules,
    calendars,
    unitsLoading,
    unitsError,
    shiftDefsLoading,
    shiftDefsError,
    schedulesLoading,
    schedulesError,
    calendarsLoading,
    calendarsError,
  } = useDP();
  const {
    shifts,
    loading,
    error: shiftsError,
    applyShiftsBatch,
    deleteShift: doDelete,
  } = useDPShifts(schedule.id);
  const {
    vacations,
    loading: vacationsLoading,
    error: vacationsError,
  } = useDPScheduleVacations(schedule.id);
  const { toast } = useToast();
  const api = useAuthenticatedApi();
  const bootstrapLoading =
    (unitsLoading && units.length === 0) ||
    (shiftDefsLoading && shiftDefinitions.length === 0);
  const blockingBootstrapError =
    (unitsError && units.length === 0 ? unitsError : null) ??
    (shiftDefsError && shiftDefinitions.length === 0 ? shiftDefsError : null);
  const ancillaryBootstrapError = schedulesError ?? calendarsError;
  const accessibleSchedules = useMemo(() => {
    if (!user) return [];
    const access = resolveUnitAccess(user, { isDefaultAdmin });
    return schedules.filter((candidate) =>
      candidate.unitId
        ? canAccessUnit(user, candidate.unitId, { isDefaultAdmin })
        : access.allUnits
    );
  }, [isDefaultAdmin, schedules, user]);

  // Calendar for holidays
  const { holidays } = useDPHolidays(schedule.calendarId ?? null);
  const holidaySet = useMemo(() => {
    const s = new Set<string>();
    holidays.forEach(h => {
      const d = h.date && typeof (h.date as any).toDate === 'function'
        ? format((h.date as any).toDate(), 'yyyy-MM-dd')
        : String(h.date);
      s.add(d);
    });
    return s;
  }, [holidays]);

  async function handleCalendarChange(calendarId: string) {
    await updateSchedule({ ...schedule, calendarId: calendarId === '__none__' ? undefined : calendarId });
  }

  // Load previous month's schedule shifts for carry-over consecutive count + preview
  const prevPeriod = useMemo(() => {
    let prevMonth = schedule.month - 1;
    let prevYear = schedule.year;
    if (prevMonth < 1) { prevMonth = 12; prevYear--; }
    return { month: prevMonth, year: prevYear };
  }, [schedule.month, schedule.year]);

  const prevSchedule = useMemo(() => {
    const candidates = accessibleSchedules.filter(s => s.month === prevPeriod.month && s.year === prevPeriod.year);
    if (schedule.unitId) {
      return findOperationalUnitRecord(candidates, schedule.unitId, units) ?? null;
    }
    return candidates.find(s => !s.unitId) ?? candidates[0] ?? null;
  }, [accessibleSchedules, prevPeriod.month, prevPeriod.year, schedule.unitId, units]);
  const prevScheduleId = prevSchedule?.id ?? null;
  const { shifts: prevShifts } = useDPShifts(prevScheduleId);

  const prevScheduleSourceUnit = useMemo(() => {
    if (!schedule.unitId || !prevSchedule?.unitId || prevSchedule.unitId === schedule.unitId) return null;
    if (!operationalUnitIdsMatch(prevSchedule.unitId, schedule.unitId, units)) return null;
    return units.find(unit => unit.id === prevSchedule.unitId) ?? null;
  }, [prevSchedule?.unitId, schedule.unitId, units]);

  const prevSiblingIds = useMemo(() => {
    if (!schedule.unitId) return [];
    return accessibleSchedules
      .filter(s =>
        s.id !== prevScheduleId &&
        s.month === prevPeriod.month &&
        s.year === prevPeriod.year &&
        !!s.unitId &&
        !operationalUnitIdsMatch(s.unitId, schedule.unitId, units)
      )
      .map(s => s.id);
  }, [accessibleSchedules, prevPeriod.month, prevPeriod.year, prevScheduleId, schedule.unitId, units]);
  const { shifts: prevSiblingShifts } = useDPSiblingShifts(prevSiblingIds);

  // Last 7 days of previous month for preview
  const prevMonthDays = useMemo(() => {
    let prevMonth = schedule.month - 1;
    let prevYear = schedule.year;
    if (prevMonth < 1) { prevMonth = 12; prevYear--; }
    const lastDay = getDaysInMonth(new Date(prevYear, prevMonth - 1));
    const startDay = Math.max(1, lastDay - 6);
    return Array.from({ length: lastDay - startDay + 1 }, (_, i) => {
      const d = new Date(prevYear, prevMonth - 1, startDay + i);
      return {
        day: startDay + i,
        date: format(d, 'yyyy-MM-dd'),
        dow: d.getDay(),
        dowLabel: DOW_SHORT[d.getDay()],
        isPreview: true,
        prevMonth,
        prevYear,
      };
    });
  }, [schedule.month, schedule.year]);

  const scheduleUnit = schedule.unitId ? units.find((unit) => unit.id === schedule.unitId) : undefined;
  const isArchivedUnitSchedule = scheduleUnit?.isArchived === true;
  const canManageSchedule = (permissions.dp?.schedules?.edit ?? false) && !isArchivedUnitSchedule;
  const canPublishDayOff = !isArchivedUnitSchedule && (
    isDefaultAdmin
    || (
      (permissions.dp?.schedules?.view ?? false)
      && (permissions.dp?.schedules?.edit ?? false)
      && (permissions.dp?.schedules?.publishBizneo ?? false)
    )
  );
  const vacationDataReady = !vacationsLoading && !vacationsError;
  const canEdit = canManageSchedule && !schedule.locked && vacationDataReady;

  const [addDialog, setAddDialog] = useState<{ date: string; unitId: string } | null>(null);
  const [manualDayOffDialog, setManualDayOffDialog] = useState<{ date: string; unitId: string } | null>(null);
  const [publishingDayOffKey, setPublishingDayOffKey] = useState<string | null>(null);
  const [removingDayOffKey, setRemovingDayOffKey] = useState<string | null>(null);
  const [dayOffRemovalTarget, setDayOffRemovalTarget] = useState<{
    shift: DPShift;
    userName: string;
    unitName: string;
  } | null>(null);
  const [editShift, setEditShift] = useState<DPShift | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DPShift | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [locking, setLocking] = useState(false);
  const [prevExpanded, setPrevExpanded] = useState(false);
  const [collapsedWeeks, setCollapsedWeeks] = useState<Set<number>>(() => new Set());
  const [bulkSelectionActive, setBulkSelectionActive] = useState(false);
  const [selectedShiftIds, setSelectedShiftIds] = useState<string[]>([]);
  const [bizneoQueueOpen, setBizneoQueueOpen] = useState(false);
  const [vtDialogOpen, setVtDialogOpen] = useState(false);
  const [coverageDemands, setCoverageDemands] = useState(() => normalizeDPCoverageDemands(schedule.coverageDemands));
  const [coverageDemandDialog, setCoverageDemandDialog] = useState<{ date: string; unit: DPUnit } | null>(null);

  React.useEffect(() => {
    setCoverageDemands(normalizeDPCoverageDemands(schedule.coverageDemands));
  }, [schedule.coverageDemands, schedule.id]);

  async function handlePublishDayOff(params: {
    scheduleId?: string;
    userId: string;
    unitId: string;
    date: string;
    source: 'predicted' | 'manual' | 'retry';
  }) {
    const key = `${params.userId}::${params.date}`;
    if (publishingDayOffKey) return false;
    setPublishingDayOffKey(key);
    try {
      const result = await api<PublishDayOffResult>(
        `/api/dp/schedules/${encodeURIComponent(params.scheduleId ?? schedule.id)}/day-offs`,
        {
          method: 'POST',
          json: params,
          fallbackError: 'Falha ao publicar a folga.',
        },
      );
      toast({
        title: result.alreadyPublished ? 'Folga já confirmada.' : 'Folga confirmada.',
        description: 'O Bizneo reconheceu o dia como folga.',
      });
      return true;
    } catch (caught) {
      toast({
        title: 'Não foi possível publicar a folga.',
        description: caught instanceof Error ? caught.message : 'Tente novamente.',
        variant: 'destructive',
      });
      return false;
    } finally {
      setPublishingDayOffKey(null);
    }
  }

  async function confirmDayOffRemoval() {
    if (!dayOffRemovalTarget || removingDayOffKey) return;
    const { shift } = dayOffRemovalTarget;
    const key = `${shift.userId}::${shift.date}`;
    setRemovingDayOffKey(key);
    try {
      const result = await api<RemoveDayOffResult>(
        `/api/dp/schedules/${encodeURIComponent(shift.scheduleId)}/day-offs`,
        {
          method: 'DELETE',
          json: {
            shiftId: shift.id,
            userId: shift.userId,
            unitId: shift.unitId,
            date: shift.date,
          },
          fallbackError: 'Falha ao remover a folga.',
        },
      );
      toast({
        title: result.alreadyRemoved ? 'Folga já removida.' : 'Folga removida.',
        description: 'O Bizneo e o Coala One foram atualizados.',
      });
      setDayOffRemovalTarget(null);
    } catch (caught) {
      toast({
        title: 'Não foi possível remover a folga.',
        description: caught instanceof Error ? caught.message : 'Tente novamente.',
        variant: 'destructive',
      });
      setDayOffRemovalTarget(null);
    } finally {
      setRemovingDayOffKey(null);
    }
  }

  async function handleLock() {
    if (!permissions.dp?.schedules?.edit) return;
    setLocking(true);
    try {
      const snapshotUsers: DPScheduleSnapshot['users'] = {};
      operationalUsers.forEach(u => {
        const entry: DPScheduleSnapshot['users'][string] = { username: u.username };
        if (u.color !== undefined) entry.color = u.color;
        if (u.avatarUrl !== undefined) entry.avatarUrl = u.avatarUrl;
        if (u.needsTransportVoucher !== undefined) entry.needsTransportVoucher = u.needsTransportVoucher;
        if (u.transportVoucherValue !== undefined) entry.transportVoucherValue = u.transportVoucherValue;
        snapshotUsers[u.id] = entry;
      });
      // JSON round-trip to strip any remaining undefined values (Firestore rejects them)
      const cleanSnapshot = JSON.parse(JSON.stringify({ users: snapshotUsers }));
      await updateSchedule({ ...schedule, locked: true, snapshot: cleanSnapshot });
      toast({ title: 'Escala trancada.' });
    } catch {
      toast({ title: 'Erro ao trancar escala.', variant: 'destructive' });
    } finally {
      setLocking(false);
    }
  }

  async function handleUnlock() {
    if (!permissions.dp?.schedules?.edit) return;
    setLocking(true);
    try {
      await updateSchedule({ ...schedule, locked: false });
      toast({ title: 'Escala destrancada.' });
    } catch {
      toast({ title: 'Erro ao destrancar.', variant: 'destructive' });
    } finally {
      setLocking(false);
    }
  }

  function toggleSelectedShift(shiftId: string) {
    setSelectedShiftIds((prev) => (
      prev.includes(shiftId)
        ? prev.filter((item) => item !== shiftId)
        : [...prev, shiftId]
    ));
  }

  function resetBulkSelection() {
    setBulkSelectionActive(false);
    setSelectedShiftIds([]);
  }

  React.useEffect(() => {
    setSelectedShiftIds((prev) => {
      const availableIds = new Set(shifts.filter(isWorkShift).map((shift) => shift.id));
      const next = prev.filter((id) => availableIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [shifts]);

  // Filters
  const [unitFilter, setUnitFilter] = useState<string>('__all__');
  const [userFilter, setUserFilter] = useState<string>('__all__');
  const [weekFilter, setWeekFilter] = useState<string>('__all__');
  const [onlyAlerts, setOnlyAlerts] = useState(false);

  // Days in this month
  const days = useMemo(() => {
    const count = getDaysInMonth(new Date(schedule.year, schedule.month - 1));
    return Array.from({ length: count }, (_, i) => {
      const date = new Date(schedule.year, schedule.month - 1, i + 1);
      return {
        day: i + 1,
        date: format(date, 'yyyy-MM-dd'),
        dow: date.getDay(),
        dowLabel: DOW_SHORT[date.getDay()],
        isToday: isToday(date),
        week: weekOfMonth(schedule.year, schedule.month, i + 1),
      };
    });
  }, [schedule.year, schedule.month]);

  const monthWeeks = useMemo(
    () => Array.from(new Set(days.map((d) => d.week))).sort((a, b) => a - b),
    [days],
  );
  const visibleDays = useMemo(
    () => (weekFilter === '__all__' ? days : days.filter((d) => String(d.week) === weekFilter)),
    [days, weekFilter],
  );

  // Per-unit mode flag (must come before activeUnits)
  const isPerUnit = !!schedule.unitId;

  // All units (from config or derived from shifts)
  const allUnits = useMemo(() => {
    if (units.length > 0) return units;
    const seen = new Map<string, string>();
    shifts.forEach(s => { if (!seen.has(s.unitId)) seen.set(s.unitId, s.unitId); });
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name } as DPUnit));
  }, [units, shifts]);
  const accessibleUnits = useMemo(
    () => user ? filterUnitsByAccess(allUnits, user, { isDefaultAdmin }) : [],
    [allUnits, isDefaultAdmin, user],
  );

  // In per-unit mode, always show only the schedule's own unit
  const activeUnits = useMemo(() => {
    if (isPerUnit && schedule.unitId) {
      const own = accessibleUnits.find(u => u.id === schedule.unitId);
      return own ? [own] : [];
    }
    return unitFilter === '__all__' ? accessibleUnits : accessibleUnits.filter(u => u.id === unitFilter);
  }, [isPerUnit, schedule.unitId, accessibleUnits, unitFilter]);

  // Shift definition lookup
  const defMap = useMemo(() => {
    const m = new Map<string, DPShiftDefinition>();
    shiftDefinitions.forEach(d => m.set(d.id, d));
    return m;
  }, [shiftDefinitions]);

  const operationalUsers = useMemo(() =>
    activeUsers.filter(u => u.operacional === true),
    [activeUsers]
  );
  const manualDayOffUsers = useMemo(() => {
    if (!manualDayOffDialog?.unitId) return operationalUsers;
    const linked = operationalUsers.filter((candidate) => (
      userMatchesDPUnit(candidate, manualDayOffDialog.unitId, units, kiosks)
    ));
    return linked.length > 0 ? linked : operationalUsers;
  }, [kiosks, manualDayOffDialog?.unitId, operationalUsers, units]);

  // User lookup map
  const userMap = useMemo(() => {
    const m = new Map<string, { username: string; avatarUrl?: string; color?: string }>();
    operationalUsers.forEach(u => m.set(u.id, { username: u.username, avatarUrl: u.avatarUrl, color: u.color }));
    return m;
  }, [operationalUsers]);

  // When locked, use snapshot user data; otherwise use live data
  const effectiveUserMap = useMemo(() => {
    if (schedule.locked && schedule.snapshot?.users) {
      return new Map(Object.entries(schedule.snapshot.users));
    }
    return userMap;
  }, [schedule.locked, schedule.snapshot, userMap]);

  const selectedBulkShifts = useMemo(() => {
    const selectedSet = new Set(selectedShiftIds);
    return shifts
      .filter((shift) => selectedSet.has(shift.id) && isWorkShift(shift))
      .map((shift) => ({
        shift,
        userName: effectiveUserMap.get(shift.userId)?.username ?? 'Desconhecido',
        unitName: units.find((unit) => unit.id === shift.unitId)?.name ?? shift.unitId,
      }));
  }, [selectedShiftIds, shifts, effectiveUserMap, units]);

  const bulkPeople = useMemo(() => {
    if (!schedule.unitId) return operationalUsers;
    const linked = operationalUsers.filter((candidate) => (
      userMatchesDPUnit(candidate, schedule.unitId, units, kiosks)
    ));
    return linked.length > 0 ? linked : operationalUsers;
  }, [kiosks, operationalUsers, schedule.unitId, units]);

  // ── Per-unit mode: sibling schedules (same month/year, different unitId) ──
  const siblingIds = useMemo(() => {
    if (!isPerUnit || !schedule.unitId) return [];
    return accessibleSchedules
      .filter(s =>
        s.id !== schedule.id &&
        s.month === schedule.month &&
        s.year === schedule.year &&
        s.unitId &&
        !operationalUnitIdsMatch(s.unitId, schedule.unitId, units)
      )
      .map(s => s.id);
  }, [accessibleSchedules, isPerUnit, schedule.id, schedule.month, schedule.year, schedule.unitId, units]);

  const { shifts: siblingShifts } = useDPSiblingShifts(siblingIds);
  const workShifts = useMemo(() => shifts.filter(isWorkShift), [shifts]);
  const dayOffShifts = useMemo(() => shifts.filter(isDayOffShift), [shifts]);
  const prevWorkShifts = useMemo(() => prevShifts.filter(isWorkShift), [prevShifts]);
  const prevSiblingWorkShifts = useMemo(() => prevSiblingShifts.filter(isWorkShift), [prevSiblingShifts]);
  const siblingWorkShifts = useMemo(() => siblingShifts.filter(isWorkShift), [siblingShifts]);
  const siblingDayOffShifts = useMemo(() => siblingShifts.filter(isDayOffShift), [siblingShifts]);
  const visibleDayOffShifts = useMemo(
    () => isPerUnit ? [...dayOffShifts, ...siblingDayOffShifts] : dayOffShifts,
    [dayOffShifts, isPerUnit, siblingDayOffShifts],
  );
  const bizneoQueueItems = useMemo(
    () => dayOffShifts
      .filter((shift) => shift.bizneoSyncStatus !== 'published')
      .sort((left, right) => left.date.localeCompare(right.date)),
    [dayOffShifts],
  );
  const dayOffOccupied = useMemo(() => {
    const occupied = new Map<string, Set<string>>();
    visibleDayOffShifts.forEach((shift) => {
      if (!occupied.has(shift.userId)) occupied.set(shift.userId, new Set());
      occupied.get(shift.userId)!.add(shift.date);
    });
    return occupied;
  }, [visibleDayOffShifts]);
  const workDayOffConflictShiftIds = useMemo(
    () => buildWorkDayOffConflictShiftIds([
      ...workShifts,
      ...visibleDayOffShifts,
      ...(isPerUnit ? siblingWorkShifts : []),
    ]),
    [isPerUnit, siblingWorkShifts, visibleDayOffShifts, workShifts],
  );
  const workDayOffConflictKeys = useMemo(
    () => buildWorkDayOffConflictKeys([
      ...workShifts,
      ...visibleDayOffShifts,
      ...(isPerUnit ? siblingWorkShifts : []),
    ]),
    [isPerUnit, siblingWorkShifts, visibleDayOffShifts, workShifts],
  );
  const currentScheduleUserIds = useMemo(
    () => new Set(shifts.map((shift) => shift.userId)),
    [shifts],
  );
  const approvedVacationIndex = useMemo(
    () => buildApprovedVacationIndex(vacations),
    [vacations],
  );
  const vacationDatesByUser = useMemo(() => {
    const datesByUser = new Map<string, Set<string>>();
    bulkPeople.forEach((candidate) => {
      const dates = days
        .filter(({ date }) => !!findApprovedVacationInIndex(approvedVacationIndex, candidate.id, date))
        .map(({ date }) => date);
      if (dates.length > 0) datesByUser.set(candidate.id, new Set(dates));
    });
    return datesByUser;
  }, [approvedVacationIndex, bulkPeople, days]);

  const vacationConflictByShiftId = useMemo(() => {
    const conflicts = new Map<string, DPVacationRecord>();
    [...prevWorkShifts, ...workShifts, ...siblingWorkShifts].forEach((shift) => {
      const vacation = findApprovedVacationInIndex(approvedVacationIndex, shift.userId, shift.date);
      if (vacation) conflicts.set(shiftVacationKey(shift), vacation);
    });
    return conflicts;
  }, [approvedVacationIndex, prevWorkShifts, siblingWorkShifts, workShifts]);

  const vacationConflictForShift = (shift: DPShift) => (
    vacationConflictByShiftId.get(shiftVacationKey(shift)) ?? null
  );

  const currentMonthDateSet = useMemo(
    () => new Set(days.map((day) => day.date)),
    [days]
  );

  // Dias consecutivos: inclui mês anterior + escalas-irmãs para contagem cross-unit
  const streakState = useMemo(
    () => buildShiftStreakState(
      isPerUnit
        ? [...prevWorkShifts, ...prevSiblingWorkShifts, ...workShifts, ...siblingWorkShifts]
        : [...prevWorkShifts, ...workShifts]
    ),
    [isPerUnit, prevSiblingWorkShifts, prevWorkShifts, siblingWorkShifts, workShifts]
  );
  const consecutiveCountMap = streakState.countByShiftId;

  // lastSundayShiftsByDate[date] = work shifts of THIS unit on that date.
  // Combines the current schedule with the previous month's own-unit shifts
  // (already loaded for streak carry-over) so the first Sunday of the month
  // can still look back across the month boundary.
  const lastSundayShiftsByDate = useMemo(() => {
    if (!isPerUnit) return {} as Record<string, DPShift[]>;
    const idx: Record<string, DPShift[]> = {};
    for (const s of [...workShifts, ...prevWorkShifts]) {
      if (!idx[s.date]) idx[s.date] = [];
      idx[s.date].push(s);
    }
    Object.values(idx).forEach((items) => items.sort(compareWorkShiftsByTime));
    return idx;
  }, [isPerUnit, workShifts, prevWorkShifts]);

  // ghostIndex[date][userId] = { shift, unitName, consecutiveDayCount }[]
  // Shows users from sibling units who are also linked to the current unit.
  const ghostIndex = useMemo(() => {
    if (!isPerUnit || !schedule.unitId) return {} as Record<string, Record<string, { shift: DPShift; unitName: string; consecutiveDayCount: number }[]>>;
    // Users who are officially linked to this unit (multi-unit workers)
    const linkedUserIds = new Set([
      operationalUsers
        .filter(u => userMatchesDPUnit(u, schedule.unitId, units, kiosks))
        .map(u => u.id),
      ...currentScheduleUserIds,
    ].flat());
    const idx: Record<string, Record<string, { shift: DPShift; unitName: string; consecutiveDayCount: number }[]>> = {};
    for (const s of siblingWorkShifts) {
      if (!linkedUserIds.has(s.userId)) continue;
      const unitName = units.find(u => u.id === s.unitId)?.name ?? s.unitId;
      const consecutiveDayCount = consecutiveCountMap.get(s.id) ?? 1;
      if (!idx[s.date]) idx[s.date] = {};
      if (!idx[s.date][s.userId]) idx[s.date][s.userId] = [];
      idx[s.date][s.userId].push({ shift: s, unitName, consecutiveDayCount });
    }
    Object.values(idx).forEach((byUser) => {
      Object.values(byUser).forEach((items) => {
        items.sort((left, right) => compareWorkShiftsByTime(left.shift, right.shift));
      });
    });
    return idx;
  }, [
    consecutiveCountMap,
    currentScheduleUserIds,
    isPerUnit,
    kiosks,
    operationalUsers,
    schedule.unitId,
    siblingWorkShifts,
    units,
  ]);

  // Cross-unit conflict detection: userId → dates occupied in sibling units
  const siblingOccupied = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const s of siblingWorkShifts) {
      if (!m.has(s.userId)) m.set(s.userId, new Set());
      m.get(s.userId)!.add(s.date);
    }
    return m;
  }, [siblingWorkShifts]);

  // IDs of current-unit shifts that conflict with a sibling schedule (same user, same date).
  // This is intentionally derived from the live sibling listeners. A persisted
  // hasConflict may be stale after the conflicting shift is deleted elsewhere.
  const crossConflictShiftIds = useMemo(() => {
    if (!isPerUnit) return new Set<string>();
    return buildCrossUnitConflictShiftIds(workShifts, siblingWorkShifts);
  }, [isPerUnit, siblingWorkShifts, workShifts]);

  const prevCrossConflictShiftIds = useMemo(() => {
    if (!isPerUnit) return new Set<string>();
    return buildCrossUnitConflictShiftIds(prevWorkShifts, prevSiblingWorkShifts);
  }, [isPerUnit, prevSiblingWorkShifts, prevWorkShifts]);

  const shiftsWithConsecutive = useMemo(() =>
    workShifts.map(s => ({
      ...s,
      hasConflict: crossConflictShiftIds.has(s.id) || workDayOffConflictShiftIds.has(s.id),
      consecutiveDayCount: consecutiveCountMap.get(s.id) ?? 1,
    })),
  [consecutiveCountMap, crossConflictShiftIds, workDayOffConflictShiftIds, workShifts]);

  const prevShiftsWithConsecutive = useMemo(() =>
    prevWorkShifts.map(s => ({
      ...s,
      hasConflict: prevCrossConflictShiftIds.has(s.id),
      consecutiveDayCount: consecutiveCountMap.get(s.id) ?? 1,
    })),
  [consecutiveCountMap, prevCrossConflictShiftIds, prevWorkShifts]);

  // Index prev shifts with correct consecutive counts
  const prevShiftIndexWithCount = useMemo(() => {
    const idx: Record<string, Record<string, (DPShift & { consecutiveDayCount: number })[]>> = {};
    for (const shift of prevShiftsWithConsecutive) {
      const displayUnitId = canonicalOperationalUnitId(shift.unitId, units) ?? shift.unitId;
      if (!idx[shift.date]) idx[shift.date] = {};
      if (!idx[shift.date][displayUnitId]) idx[shift.date][displayUnitId] = [];
      idx[shift.date][displayUnitId].push(shift);
    }
    return idx;
  }, [prevShiftsWithConsecutive, units]);

  const dayOffIndex = useMemo(() => {
    const activeUnitIds = new Set(activeUnits.map((unit) => unit.id));
    const visibleUserIds = userFilter === '__all__' ? null : new Set([userFilter]);
    const entries = new Map<string, {
      userId: string;
      explicit: boolean;
      shift?: DPShift;
      sourceUnitId: string;
      sourceUnitName: string;
    }>();

    const registerEntry = (params: {
      date: string;
      displayUnitId: string;
      sourceUnitId: string;
      userId: string;
      explicit: boolean;
      shift?: DPShift;
    }) => {
      const { date, displayUnitId, sourceUnitId, userId, explicit, shift } = params;
      if (!currentMonthDateSet.has(date) || !activeUnitIds.has(displayUnitId)) return;
      if (visibleUserIds && !visibleUserIds.has(userId)) return;
      const key = `${date}::${displayUnitId}::${userId}`;
      const existing = entries.get(key);
      if (existing?.explicit) return;
      entries.set(key, {
        userId,
        explicit: explicit || existing?.explicit || false,
        shift: shift ?? existing?.shift,
        sourceUnitId,
        sourceUnitName: units.find((unit) => unit.id === sourceUnitId)?.name ?? sourceUnitId,
      });
    };

    const visibleExplicitDayOffs = isPerUnit ? [...dayOffShifts, ...siblingDayOffShifts] : dayOffShifts;
    visibleExplicitDayOffs.forEach((shift) => {
      let displayUnitId = shift.unitId;
      if (isPerUnit && schedule.unitId) {
        const linkedToCurrentUser = operationalUsers.find((user) => user.id === shift.userId);
        const linkedToCurrent = currentScheduleUserIds.has(shift.userId) || (linkedToCurrentUser
          ? userMatchesDPUnit(linkedToCurrentUser, schedule.unitId, units, kiosks)
          : false);
        if (linkedToCurrent || shift.unitId === schedule.unitId) displayUnitId = schedule.unitId;
        else return;
      }
      registerEntry({
        date: shift.date,
        displayUnitId,
        sourceUnitId: shift.unitId,
        userId: shift.userId,
        explicit: true,
        shift,
      });
    });

    streakState.predictedDayOffsByUser.forEach((items, userId) => {
      items.forEach((item) => {
        let displayUnitId = item.sourceUnitId;
        if (isPerUnit && schedule.unitId) {
          const linkedToCurrentUser = operationalUsers.find((user) => user.id === userId);
          const linkedToCurrent = currentScheduleUserIds.has(userId) || (linkedToCurrentUser
            ? userMatchesDPUnit(linkedToCurrentUser, schedule.unitId, units, kiosks)
            : false);
          if (linkedToCurrent || item.sourceUnitId === schedule.unitId) displayUnitId = schedule.unitId;
          else return;
        }
        registerEntry({
          date: item.date,
          displayUnitId,
          sourceUnitId: item.sourceUnitId,
          userId,
          explicit: false,
        });
      });
    });

    const idx: Record<string, Record<string, Array<{
      userId: string;
      explicit: boolean;
      shift?: DPShift;
      sourceUnitId: string;
      sourceUnitName: string;
    }>>> = {};
    entries.forEach((entry, key) => {
      const [date, unitId] = key.split('::');
      if (!idx[date]) idx[date] = {};
      if (!idx[date][unitId]) idx[date][unitId] = [];
      idx[date][unitId].push(entry);
    });

    return idx;
  }, [
    activeUnits,
    currentScheduleUserIds,
    currentMonthDateSet,
    dayOffShifts,
    isPerUnit,
    kiosks,
    operationalUsers,
    schedule.unitId,
    siblingDayOffShifts,
    streakState.predictedDayOffsByUser,
    units,
    userFilter,
  ]);

  const rosterUserIdsByUnit = useMemo(() => {
    const roster = new Map<string, Set<string>>(
      activeUnits.map((unit) => [unit.id, new Set<string>()]),
    );

    activeUnits.forEach((unit) => {
      operationalUsers.forEach((candidate) => {
        if (userMatchesDPUnit(candidate, unit.id, units, kiosks)) {
          roster.get(unit.id)?.add(candidate.id);
        }
      });
    });

    [...workShifts, ...dayOffShifts].forEach((shift) => {
      const unit = activeUnits.find((candidate) => operationalUnitIdsMatch(candidate.id, shift.unitId, units));
      if (unit) roster.get(unit.id)?.add(shift.userId);
    });

    return new Map(
      Array.from(roster.entries()).map(([unitId, userIds]) => [unitId, Array.from(userIds)]),
    );
  }, [activeUnits, dayOffShifts, kiosks, operationalUsers, units, workShifts]);

  const occupiedUserDateKeys = useMemo(
    () => new Set(
      (isPerUnit ? [...workShifts, ...siblingWorkShifts] : workShifts)
        .map((shift) => `${shift.date}::${shift.userId}`),
    ),
    [isPerUnit, siblingWorkShifts, workShifts],
  );

  const coverageByCellKey = useMemo(() => {
    const coverage = new Map<string, DPDailyCoverage>();
    activeUnits.forEach((unit) => {
      const mode = resolveDPCoverageMode(unit);
      if (mode === 'disabled') return;
      const unitShifts = workShifts.filter((shift) => operationalUnitIdsMatch(unit.id, shift.unitId, units));
      days.forEach(({ date }) => {
        const daily = mode === 'on_demand'
          ? buildDailyOnDemandCoverage({ date, windows: coverageDemands[date] ?? [], shifts: unitShifts })
          : buildDailyUnitCoverage({ date, operatingHours: unit.operatingHours, shifts: unitShifts });
        if (mode === 'on_demand' || daily.gaps.length > 0) {
          coverage.set(`${date}::${unit.id}`, daily);
        }
      });
    });
    return coverage;
  }, [activeUnits, coverageDemands, days, units, workShifts]);

  // Index shifts: [date][unitId] → DPShift[] (com filtros e contagem consecutiva)
  const shiftIndex = useMemo(() => {
    const idx: Record<string, Record<string, DPShift[]>> = {};
    for (const shift of shiftsWithConsecutive) {
      if (userFilter !== '__all__' && shift.userId !== userFilter) continue;
      if (!idx[shift.date]) idx[shift.date] = {};
      if (!idx[shift.date][shift.unitId]) idx[shift.date][shift.unitId] = [];
      idx[shift.date][shift.unitId].push(shift);
    }
    Object.values(idx).forEach((byUnit) => {
      Object.values(byUnit).forEach((items) => items.sort(compareWorkShiftsByTime));
    });
    return idx;
  }, [shiftsWithConsecutive, userFilter]);

  const alertsByCellKey = useMemo(() => {
    const index = new Map<string, Array<{ key: string; label: string; tone: 'danger' | 'warning' }>>();
    activeUnits.forEach((unit) => {
      days.forEach(({ date }) => {
        const alerts: Array<{ key: string; label: string; tone: 'danger' | 'warning' }> = [];
        const coverage = coverageByCellKey.get(`${date}::${unit.id}`);
        if (coverage?.gaps.length) {
          alerts.push({
            key: 'coverage',
            label: coverage.gaps.length === 1 ? 'Cobertura incompleta' : `${coverage.gaps.length} lacunas de cobertura`,
            tone: 'danger',
          });
        } else if (coverage?.hasUnplannedShifts) {
          alerts.push({ key: 'unplanned', label: 'Equipe escalada sem demanda', tone: 'warning' });
        }

        (shiftIndex[date]?.[unit.id] ?? []).forEach((shift) => {
          const userName = effectiveUserMap.get(shift.userId)?.username ?? shift.userName ?? 'Colaborador';
          if (shift.hasConflict) {
            alerts.push({ key: `conflict:${shift.id}`, label: `${userName}: conflito de escala`, tone: 'danger' });
          }
          if (vacationConflictByShiftId.has(shiftVacationKey(shift))) {
            alerts.push({ key: `vacation:${shift.id}`, label: `${userName}: turno durante férias`, tone: 'danger' });
          }
          if ((shift.consecutiveDayCount ?? 0) >= 7) {
            alerts.push({ key: `streak:${shift.id}`, label: `${userName}: ${shift.consecutiveDayCount} dias seguidos`, tone: 'warning' });
          }
        });

        (dayOffIndex[date]?.[unit.id] ?? []).forEach(({ userId, shift }) => {
          const userName = effectiveUserMap.get(userId)?.username ?? shift?.userName ?? 'Colaborador';
          if (workDayOffConflictKeys.has(`${userId}::${date}`)) {
            alerts.push({ key: `day-off:${userId}`, label: `${userName}: turno e folga no mesmo dia`, tone: 'danger' });
          }
          if (shift?.bizneoSyncStatus === 'failed' || shift?.bizneoSyncStatus === 'removal_failed') {
            alerts.push({ key: `bizneo-failed:${shift.id}`, label: `${userName}: falha no Bizneo`, tone: 'danger' });
          } else if (shift?.bizneoSyncStatus === 'pending' || shift?.bizneoSyncStatus === 'publishing') {
            alerts.push({ key: `bizneo-pending:${shift.id}`, label: `${userName}: envio ao Bizneo pendente`, tone: 'warning' });
          }
        });

        if (alerts.length > 0) index.set(`${date}::${unit.id}`, alerts);
      });
    });
    return index;
  }, [activeUnits, coverageByCellKey, dayOffIndex, days, effectiveUserMap, shiftIndex, vacationConflictByShiftId, workDayOffConflictKeys]);

  const alertDates = useMemo(
    () => new Set(Array.from(alertsByCellKey.keys()).map((key) => key.slice(0, 10))),
    [alertsByCellKey],
  );
  const renderDays = useMemo(
    () => onlyAlerts ? visibleDays.filter(({ date }) => alertDates.has(date)) : visibleDays,
    [alertDates, onlyAlerts, visibleDays],
  );
  const renderDateSet = useMemo(() => new Set(renderDays.map(({ date }) => date)), [renderDays]);

  const visiblePeople = useMemo(() => {
    const idsByUser = new Map<string, string[]>();
    Object.entries(shiftIndex).forEach(([date, byUnit]) => {
      if (!renderDateSet.has(date)) return;
      Object.values(byUnit).forEach((items) => {
        items.forEach((shift) => {
          const ids = idsByUser.get(shift.userId) ?? [];
          ids.push(shift.id);
          idsByUser.set(shift.userId, ids);
        });
      });
    });
    return Array.from(idsByUser.entries())
      .map(([id, shiftIds]) => ({
        id,
        name: effectiveUserMap.get(id)?.username ?? id,
        shiftIds: Array.from(new Set(shiftIds)),
      }))
      .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
  }, [effectiveUserMap, renderDateSet, shiftIndex]);

  function toggleShiftSelectionGroup(shiftIds: string[]) {
    const groupIds = new Set(shiftIds);
    setSelectedShiftIds((previous) => {
      const allSelected = shiftIds.every((id) => previous.includes(id));
      if (allSelected) return previous.filter((id) => !groupIds.has(id));
      return Array.from(new Set([...previous, ...shiftIds]));
    });
  }

  function removeShiftSelectionGroup(shiftIds: string[]) {
    const groupIds = new Set(shiftIds);
    setSelectedShiftIds((previous) => previous.filter((id) => !groupIds.has(id)));
  }

  function toggleWeek(week: number) {
    setCollapsedWeeks((current) => {
      const next = new Set(current);
      if (next.has(week)) next.delete(week);
      else next.add(week);
      return next;
    });
  }

  // Stats
  const conflictCount = useMemo(() => {
    const issues = new Set<string>();
    workShifts.forEach((shift) => {
      if (crossConflictShiftIds.has(shift.id)) issues.add(`cross:${shift.id}`);
      if (vacationConflictByShiftId.has(shiftVacationKey(shift))) issues.add(`vacation:${shift.id}`);
    });
    workDayOffConflictKeys.forEach((key) => issues.add(`day-off:${key}`));
    return issues.size;
  }, [crossConflictShiftIds, vacationConflictByShiftId, workDayOffConflictKeys, workShifts]);
  const coverageAlertCount = useMemo(
    () => [...coverageByCellKey.values()].filter((coverage) => coverage.gaps.length > 0).length,
    [coverageByCellKey],
  );
  const uniqueCollaborators = useMemo(() => new Set(workShifts.map(s => s.userId)).size, [workShifts]);

  // Dias por colaborador (para popover do card Pessoas)
  const pessoasBreakdown = useMemo(() => {
    const byUser = new Map<string, { name: string; uniqueDates: Set<string> }>();
    workShifts.forEach(shift => {
      const shiftDate = parse(shift.date, 'yyyy-MM-dd', new Date());
      if (shiftDate.getMonth() !== schedule.month - 1 || shiftDate.getFullYear() !== schedule.year) return;
      let userName = '';
      if (schedule.locked && schedule.snapshot?.users) {
        userName = schedule.snapshot.users[shift.userId]?.username ?? shift.userId;
      } else {
        userName = operationalUsers.find(u => u.id === shift.userId)?.username ?? shift.userId;
      }
      if (!byUser.has(shift.userId)) byUser.set(shift.userId, { name: userName, uniqueDates: new Set() });
      byUser.get(shift.userId)!.uniqueDates.add(shift.date);
    });
    return [...byUser.values()]
      .map(u => ({ name: u.name, days: u.uniqueDates.size }))
      .sort((a, b) => b.days - a.days);
  }, [workShifts, operationalUsers, schedule]);

  // Vale Transporte: usa snapshot quando trancado, dados ao vivo caso contrário
  // siblingTotal acumula VT do colaborador nas outras escalas do mesmo mês (cross-quiosque)
  const vtStats = useMemo(() => {
    const workedDays = new Set<string>();
    const byUser = new Map<string, { name: string; days: number; total: number; siblingTotal: number }>();
    let total = 0;

    workShifts.forEach(shift => {
      const shiftDate = parse(shift.date, 'yyyy-MM-dd', new Date());
      if (shiftDate.getMonth() !== schedule.month - 1 || shiftDate.getFullYear() !== schedule.year) return;

      let needsVT = false;
      let vtValue = 0;
      let userName = '';

      if (schedule.locked && schedule.snapshot?.users) {
        const snap = schedule.snapshot.users[shift.userId];
        needsVT = snap?.needsTransportVoucher ?? false;
        vtValue = snap?.transportVoucherValue ?? 0;
        userName = snap?.username ?? shift.userId;
      } else {
        const user = operationalUsers.find(u => u.id === shift.userId);
        needsVT = user?.needsTransportVoucher ?? false;
        vtValue = user?.transportVoucherValue ?? 0;
        userName = user?.username ?? shift.userId;
      }

      if (!needsVT || !vtValue) return;
      const dayKey = `${shift.userId}_${shift.date}`;
      if (!workedDays.has(dayKey)) {
        workedDays.add(dayKey);
        total += vtValue;
        const entry = byUser.get(shift.userId) ?? { name: userName, days: 0, total: 0, siblingTotal: 0 };
        entry.days += 1;
        entry.total += vtValue;
        byUser.set(shift.userId, entry);
      }
    });

    // Acumula VT das escalas-irmãs (outros quiosques) para colaboradores compartilhados
    if (isPerUnit) {
      const siblingWorkedDays = new Set<string>();
      siblingWorkShifts.forEach(shift => {
        const shiftDate = parse(shift.date, 'yyyy-MM-dd', new Date());
        if (shiftDate.getMonth() !== schedule.month - 1 || shiftDate.getFullYear() !== schedule.year) return;
        if (!byUser.has(shift.userId)) return;
        const user = operationalUsers.find(u => u.id === shift.userId);
        if (!user?.needsTransportVoucher || !user?.transportVoucherValue) return;
        const dayKey = `${shift.userId}_${shift.date}`;
        if (!siblingWorkedDays.has(dayKey)) {
          siblingWorkedDays.add(dayKey);
          byUser.get(shift.userId)!.siblingTotal += user.transportVoucherValue;
        }
      });
    }

    return {
      total,
      breakdown: [...byUser.values()].sort((a, b) => b.total - a.total),
    };
  }, [workShifts, siblingWorkShifts, operationalUsers, schedule, isPerUnit]);

  if (bootstrapLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-64 bg-muted rounded" />
        <div className="h-4 w-40 bg-muted/60 rounded" />
        <div className="rounded-xl border overflow-hidden">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-14 border-b bg-muted/20" />
          ))}
        </div>
      </div>
    );
  }

  if (blockingBootstrapError && !bootstrapLoading) {
    return <p className="text-sm text-destructive">Erro ao carregar dados da escala: {blockingBootstrapError}</p>;
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await doDelete(deleteTarget);
      toast({ title: 'Turno removido.' });
    } catch {
      toast({ title: 'Erro ao remover turno.', variant: 'destructive' });
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-64 bg-muted rounded" />
        <div className="h-4 w-40 bg-muted/60 rounded" />
        <div className="rounded-xl border overflow-hidden">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-14 border-b bg-muted/20" />
          ))}
        </div>
      </div>
    );
  }

  if (shiftsError && shifts.length === 0) {
    return <p className="text-sm text-destructive">Erro ao carregar os turnos da escala: {shiftsError}</p>;
  }

  return (
    <div className={cn(embedded ? 'flex min-h-0 flex-1 flex-col bg-white text-[#0f172a]' : 'space-y-4')}>
      {/* Header */}
      <div className={cn(
        'flex flex-wrap items-center gap-3',
        embedded && 'shrink-0 border-b border-[#eef1f6] px-[22px] py-[14px]',
      )}>
        {embedded && onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="Voltar para todos os meses"
            className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] border border-[#e6ebf2] text-[#64748b] outline-none transition hover:bg-[#f8fafc] focus-visible:ring-2 focus-visible:ring-[#db2777]"
          >
            <ChevronLeft className="h-[15px] w-[15px]" strokeWidth={2.4} />
          </button>
        ) : !embedded && (
          <BackButton fallbackHref="/dashboard/dp/schedules" ariaLabel="Voltar à página anterior" iconOnly variant="ghost" size="icon" iconClassName="h-4 w-4" />
        )}
        <div className="flex-1 min-w-0">
          {embedded ? (
            <h1 className="dp-schedule-month-title truncate text-[19px] font-black leading-6 tracking-[-0.02em] text-[#0f172a]">
              {MONTHS[schedule.month - 1]} de {schedule.year} · {scheduleUnit?.name ?? 'Todas as unidades'}
            </h1>
          ) : (
            <h1 className="text-xl font-semibold truncate">{schedule.name}</h1>
          )}
          {!embedded && (
            <p className="text-sm text-muted-foreground">{MONTHS[schedule.month - 1]} {schedule.year}</p>
          )}
        </div>
        {embedded && onPreviousMonth && onNextMonth && (
          <div className="flex items-center overflow-hidden rounded-[10px] border border-[#e6ebf2]">
            <Button type="button" variant="ghost" size="icon" aria-label="Mês anterior" className="h-8 w-8 rounded-none border-r border-[#eef1f6] text-[#64748b] hover:bg-[#f8fafc]" onClick={onPreviousMonth}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" aria-label="Próximo mês" className="h-8 w-8 rounded-none text-[#64748b] hover:bg-[#f8fafc]" onClick={onNextMonth}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
        {isPerUnit && (
          <Button type="button" size="sm" variant="outline" onClick={() => setBizneoQueueOpen(true)} className="h-8 rounded-[10px] border-sky-200 bg-sky-50 px-3 text-[12.5px] font-extrabold text-sky-700 hover:bg-sky-100">
            <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-sky-500" />
            Bizneo · {bizneoQueueItems.length} pendente{bizneoQueueItems.length === 1 ? '' : 's'}
          </Button>
        )}
        {canManageSchedule && (
          schedule.locked ? (
            <Button size="sm" variant="outline" onClick={handleUnlock} disabled={locking} className="h-8 rounded-[10px] border-amber-300 px-3 text-[12.5px] font-bold text-amber-600 hover:bg-amber-50">
              <LockOpen className="mr-2 h-4 w-4" />
              {locking ? 'Destrancando...' : 'Destrancar'}
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={handleLock} disabled={locking} className="h-8 rounded-[10px] border-[#e6ebf2] px-3 text-[12.5px] font-bold text-[#475569] hover:bg-[#f8fafc]">
              <Lock className="mr-2 h-4 w-4" />
              {locking ? 'Trancando...' : 'Trancar'}
            </Button>
          )
        )}
        {canEdit && !bulkSelectionActive && (
          <Button size="sm" variant="outline" onClick={() => setBulkSelectionActive(true)} className="h-8 rounded-[10px] border-[#e6ebf2] px-3 text-[12.5px] font-bold text-[#475569] hover:bg-[#f8fafc]">
            <Sparkles className="mr-2 h-4 w-4" />
            Editar em lote
          </Button>
        )}
        {canEdit && (
          <Button
            size="sm"
            onClick={() => setAddDialog({ date: days[0]?.date ?? '', unitId: activeUnits[0]?.id ?? '' })}
            className="h-8 rounded-[10px] bg-[#db2777] px-[13px] text-[12.5px] font-extrabold text-white hover:bg-[#be185d]"
          >
            <Plus className="mr-2 h-4 w-4" />
            Adicionar turno
          </Button>
        )}
      </div>
      <div className={cn('space-y-4', embedded && 'min-h-0 flex-1 overflow-y-auto')}>
      {schedule.locked && (
        <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
          <Lock className="h-3.5 w-3.5 shrink-0" />
          Escala trancada — dados de colaboradores e vale-transporte estão congelados.
        </div>
      )}
      {isArchivedUnitSchedule && (
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <Lock className="h-3.5 w-3.5 shrink-0" />
          Escala histórica preservada após a incorporação desta unidade. Alterações estão bloqueadas.
        </div>
      )}
      {canManageSchedule && !schedule.locked && vacationsLoading && (
        <div className="flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-700 dark:border-sky-900/40 dark:bg-sky-950/20 dark:text-sky-300">
          <CalendarDays className="h-3.5 w-3.5 shrink-0" />
          Carregando férias aprovadas. A edição da escala será liberada após a validação.
        </div>
      )}
      {vacationsError && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {canManageSchedule && !schedule.locked
            ? 'Não foi possível validar as férias. A edição da escala está bloqueada até os dados serem carregados.'
            : 'Não foi possível validar as férias. Alguns conflitos podem não ser exibidos.'}
        </div>
      )}
      {ancillaryBootstrapError && (
        <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300">
          <Lock className="h-3.5 w-3.5 shrink-0" />
          Alguns dados auxiliares da escala não carregaram: {ancillaryBootstrapError}
        </div>
      )}

      <div className={cn(
        'grid items-start',
        bulkSelectionActive && 'min-[1180px]:grid-cols-[minmax(0,1fr)_314px]',
      )}>
        <div className={cn('min-w-0 space-y-4', embedded && 'px-[22px] pb-5 pt-[14px]')}>
      {/* Stats boxes */}
      <div className="grid grid-cols-2 gap-[10px] lg:grid-cols-5">
        <Popover>
          <PopoverTrigger asChild>
            <div className="cursor-pointer rounded-[13px] border border-[#e3e9f1] bg-white px-3 py-[10px] transition-colors hover:bg-[#f8fafc]">
              <div className="mb-1 flex items-center gap-2 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-[#94a3b8]">
                <span>Pessoas</span>
              </div>
              <p className="flex items-baseline gap-1.5"><span className="text-[20px] font-black tracking-[-0.02em] text-[#0f172a]">{uniqueCollaborators}</span><span className="text-[11px] font-bold text-[#a3aec0]">no mês</span></p>
            </div>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-2" align="start">
            <p className="text-xs font-medium text-muted-foreground mb-2">Por colaborador</p>
            {pessoasBreakdown.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhum colaborador na escala.</p>
            ) : (
              <div className="space-y-1">
                {pessoasBreakdown.map(row => (
                  <div key={row.name} className="flex items-center justify-between">
                    <span className="truncate text-xs">{row.name}</span>
                    <span className="text-xs text-muted-foreground ml-2 shrink-0">{row.days}d</span>
                  </div>
                ))}
              </div>
            )}
          </PopoverContent>
        </Popover>
        <button
          type="button"
          onClick={() => { setUserFilter('__all__'); setOnlyAlerts(false); }}
          className="rounded-[13px] border border-[#e3e9f1] bg-white px-3 py-[10px] text-left transition-colors hover:bg-[#f8fafc]"
        >
          <div className="mb-1 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-[#94a3b8]">
            <span>Turnos</span>
          </div>
          <p className="flex items-baseline gap-1.5"><span className="text-[20px] font-black tracking-[-0.02em] text-[#0f172a]">{workShifts.length}</span><span className="text-[11px] font-bold text-[#a3aec0]">em {days.length} dias</span></p>
        </button>
        <button
          type="button"
          onClick={() => setOnlyAlerts(true)}
          className={`rounded-[13px] border px-3 py-[10px] text-left transition-colors ${conflictCount > 0 ? 'border-[#fecdd6] bg-[#fef2f4]' : 'border-[#e3e9f1] bg-white hover:bg-[#f8fafc]'}`}
        >
          <div className={`mb-1 text-[10.5px] font-extrabold uppercase tracking-[0.06em] ${conflictCount > 0 ? 'text-[#e11d48]' : 'text-[#94a3b8]'}`}>
            <span>Conflito{conflictCount !== 1 ? 's' : ''}</span>
          </div>
          <p className="flex items-baseline gap-1.5"><span className={`text-[20px] font-black tracking-[-0.02em] ${conflictCount > 0 ? 'text-[#e11d48]' : 'text-[#0f172a]'}`}>{conflictCount}</span><span className={`text-[11px] font-bold ${conflictCount > 0 ? 'text-[#fb7185]' : 'text-[#a3aec0]'}`}>{conflictCount > 0 ? 'exigem revisão' : 'sem alertas'}</span></p>
        </button>
        <button
          type="button"
          onClick={() => setOnlyAlerts(true)}
          className={`rounded-[13px] border px-3 py-[10px] text-left transition-colors ${coverageAlertCount > 0 ? 'border-[#fde68a] bg-[#fffbeb]' : 'border-[#e3e9f1] bg-white hover:bg-[#f8fafc]'}`}
        >
          <div className={`mb-1 text-[10.5px] font-extrabold uppercase tracking-[0.06em] ${coverageAlertCount > 0 ? 'text-[#d97706]' : 'text-[#94a3b8]'}`}>
            <span>Cobertura</span>
          </div>
          <p className="flex items-baseline gap-1.5"><span className={`text-[20px] font-black tracking-[-0.02em] ${coverageAlertCount > 0 ? 'text-[#d97706]' : 'text-[#0f172a]'}`}>{coverageAlertCount}</span><span className={`text-[11px] font-bold ${coverageAlertCount > 0 ? 'text-[#d6a037]' : 'text-[#a3aec0]'}`}>{coverageAlertCount > 0 ? 'dias com lacuna' : 'sem lacunas'}</span></p>
        </button>
        <button
          type="button"
          onClick={() => setVtDialogOpen(true)}
          className="rounded-[13px] border border-[#e3e9f1] bg-white px-3 py-[10px] text-left transition-colors hover:bg-[#f8fafc]"
        >
          <div className="mb-1 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-[#94a3b8]">
            <span>Vale Transporte</span>
          </div>
          <p className="flex items-baseline gap-1.5"><span className="text-[20px] font-black tracking-[-0.02em] text-[#0f172a]">{vtStats.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span><span className="text-[11px] font-bold text-[#a3aec0]">{vtStats.breakdown.length} pessoas</span></p>
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Calendar badge (readonly – set at creation) */}
        {schedule.calendarId && (() => {
          const cal = calendars.find(c => c.id === schedule.calendarId);
          return cal ? (
            <div className="flex h-[30px] items-center gap-[7px] rounded-[9px] border border-[#e6ebf2] bg-[#f8fafc] px-[11px] text-xs font-bold text-[#64748b]">
              <CalendarDays className="h-3 w-3 shrink-0" />
              {cal.name}
            </div>
          ) : null;
        })()}
        {!isPerUnit && (
          <Select value={unitFilter} onValueChange={setUnitFilter}>
            <SelectTrigger className="h-8 text-xs w-[160px]"><SelectValue placeholder="Todas as unidades" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todas as unidades</SelectItem>
              {allUnits.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Select value={userFilter} onValueChange={setUserFilter}>
          <SelectTrigger className="h-[30px] w-[210px] rounded-[9px] border-[#e6ebf2] bg-white text-xs font-bold text-[#475569] [&>span]:whitespace-nowrap"><SelectValue placeholder="Todas as colaboradoras" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todas as colaboradoras</SelectItem>
            {operationalUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={weekFilter} onValueChange={setWeekFilter}>
          <SelectTrigger className="h-[30px] w-[120px] rounded-[9px] border-[#e6ebf2] bg-white text-xs font-bold text-[#475569]"><SelectValue placeholder="Mês inteiro" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Mês inteiro</SelectItem>
            {monthWeeks.map(w => <SelectItem key={w} value={String(w)}>Semana {w}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 md:flex">
            Dias seguidos
            <StreakRing count={3} />
            <StreakRing count={6} />
            <StreakRing count={7} />
            <span className="normal-case tracking-normal">1–4 · 5–6 · 7+</span>
          </span>
          <button
            type="button"
            aria-pressed={onlyAlerts}
            onClick={() => setOnlyAlerts(v => !v)}
            className={`flex h-[30px] items-center gap-[7px] rounded-[9px] border px-[11px] text-xs font-extrabold transition-colors
              ${onlyAlerts
                ? 'bg-destructive/10 border-destructive/30 text-destructive'
                : 'border-border text-muted-foreground hover:bg-muted/50'
              }`}
          >
            <AlertTriangle className="h-3 w-3" />
            Ver apenas alertas
          </button>
        </div>
      </div>

      {/* Grid */}
      {activeUnits.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
          <p className="text-sm">Nenhuma unidade cadastrada. Cadastre unidades em Configurações primeiro.</p>
        </div>
      ) : (
        <div className="overflow-auto rounded-[14px] border border-[#e9edf4]">
          <table className="w-max min-w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/40">
                {/* Sticky day column header */}
                <th className="sticky left-0 z-20 min-w-[88px] border-b border-r border-[#e9edf4] bg-[#f6f8fb] px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#94a3b8]">
                  Data
                </th>
                {isPerUnit ? (
                  <>
                    <th className="min-w-[600px] border-b border-r border-[#e9edf4] bg-[#f6f8fb] px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#94a3b8]">Turnos</th>
                    <th className="w-[360px] min-w-[360px] border-b border-r border-[#e9edf4] bg-[#f6f8fb] px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#94a3b8]">Folgas &amp; férias</th>
                    <th className="w-44 min-w-44 border-b border-[#e9edf4] bg-[#f6f8fb] px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#94a3b8]">Alertas</th>
                  </>
                ) : activeUnits.map(unit => (
                  <th
                    key={unit.id}
                    className="border-b border-r px-4 py-2.5 text-left font-medium text-muted-foreground min-w-[200px] text-xs uppercase tracking-wider last:border-r-0"
                  >
                    {unit.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* ── Previous month preview rows ── */}
              {prevMonthDays.length > 0 && (
                <>
                  <tr>
                    <td
                      colSpan={isPerUnit ? 4 : activeUnits.length + 1}
                      className="sticky left-0 border-b"
                    >
                      <button
                        type="button"
                        aria-expanded={prevExpanded}
                        onClick={() => setPrevExpanded(v => !v)}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70 bg-muted/30 hover:bg-muted/50 transition-colors"
                      >
                        <span className={`transition-transform ${prevExpanded ? 'rotate-90' : ''}`}>▶</span>
                        {MONTHS[(prevMonthDays[0].prevMonth) - 1]} {prevMonthDays[0].prevYear} — prévia
                        {prevScheduleSourceUnit && (
                          <Badge
                            variant="outline"
                            className="ml-auto border-blue-200 bg-blue-50 text-[9px] normal-case tracking-normal text-blue-700"
                          >
                            Continuidade: {prevScheduleSourceUnit.name}
                          </Badge>
                        )}
                      </button>
                    </td>
                  </tr>
                  {prevExpanded && prevMonthDays.map(({ day, date, dow, dowLabel }) => {
                    const isSunday = dow === 0;
                    const isHoliday = holidaySet.has(date);
                    return (
                      <tr key={`prev-${date}`} className={`border-b opacity-55 ${isHoliday ? 'bg-orange-50 dark:bg-orange-900/10' : isSunday ? 'bg-muted/20' : ''}`}>
                        <td className={`sticky left-0 z-10 border-r px-3 py-2 align-top ${isHoliday ? 'bg-orange-50 dark:bg-orange-900/10' : isSunday ? 'bg-muted/30' : 'bg-background'}`}>
                          <div className="flex flex-col items-center gap-0.5">
                            <span className={`text-[10px] font-medium uppercase tracking-wider ${isSunday ? 'text-red-400' : 'text-muted-foreground/60'}`}>{dowLabel}</span>
                            <span className={`flex items-center justify-center h-7 w-7 rounded-full text-sm font-bold ${isSunday ? 'text-red-400' : 'text-muted-foreground/60'}`}>{day}</span>
                            {isHoliday && (
                              <span className="text-[9px] font-semibold bg-orange-100 dark:bg-orange-900/40 text-orange-600 dark:text-orange-400 rounded px-1 py-0.5 leading-none">
                                Feriado
                              </span>
                            )}
                          </div>
                        </td>
                        {activeUnits.map(unit => {
                          const cellShifts = prevShiftIndexWithCount[date]?.[unit.id] ?? [];
                          return (
                            <td key={unit.id} colSpan={isPerUnit ? 3 : undefined} className="border-r px-2 py-2 align-top last:border-r-0 min-w-[200px]">
                              <div className="flex flex-col gap-1">
                                {cellShifts.map(shift => {
                                  const user = effectiveUserMap.get(shift.userId);
                                  const def = shift.shiftDefinitionId ? defMap.get(shift.shiftDefinitionId) : undefined;
                                  return (
                                    <ShiftCard
                                      key={shift.id}
                                      shift={shift}
                                      vacationConflict={vacationConflictForShift(shift)}
                                      userName={user?.username ?? 'Desconhecido'}
                                      userAvatar={user?.avatarUrl}
                                      userColor={user?.color}
                                      shiftDef={def}
                                      canEdit={false}
                                      onEdit={() => {}}
                                      onDelete={() => {}}
                                    />
                                  );
                                })}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  <tr>
                    <td
                      colSpan={isPerUnit ? 4 : activeUnits.length + 1}
                      className="sticky left-0 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground bg-muted/50 border-b"
                    >
                      {MONTHS[schedule.month - 1]} {schedule.year}
                    </td>
                  </tr>
                </>
              )}

              {/* ── Current month rows ── */}
              {renderDays.map(({ day, date, dow, dowLabel, isToday: dayIsToday, week }, dayIdx) => {
                const isSunday = dow === 0;
                const isSaturday = dow === 6;
                const isWeekend = isSunday || isSaturday;
                const isHoliday = holidaySet.has(date);
                const showWeekSeparator = dayIdx === 0 || renderDays[dayIdx - 1].week !== week;
                const weekDays = days.filter((d) => d.week === week);
                const weekCollapsed = collapsedWeeks.has(week);
                const weekTone = WEEK_TONES[(week - 1) % WEEK_TONES.length];
                const weekLabel = weekDays.length > 0
                  ? `Semana ${week} · ${weekDays[0].day} a ${weekDays[weekDays.length - 1].day} de ${MONTHS[schedule.month - 1].toLowerCase()}`
                  : `Semana ${week}`;

                const rowBg = isHoliday
                  ? 'bg-orange-50 dark:bg-orange-900/10'
                  : dayIsToday ? 'bg-blue-50 dark:bg-blue-900/10'
                  : isWeekend ? 'bg-muted/20' : 'hover:bg-muted/10';

                const stickyBg = isHoliday
                  ? 'bg-orange-50 dark:bg-orange-900/10'
                  : dayIsToday ? 'bg-blue-50 dark:bg-blue-900/10'
                  : isWeekend ? 'bg-muted/30' : 'bg-background';

                return (
                  <React.Fragment key={date}>
                  {showWeekSeparator && (
                    <tr>
                      <td
                        colSpan={isPerUnit ? 4 : activeUnits.length + 1}
                        className={cn('sticky left-0 border-b border-l-4 p-0', weekTone.bar)}
                      >
                        <button
                          type="button"
                          aria-expanded={!weekCollapsed}
                          onClick={() => toggleWeek(week)}
                          className={cn(
                            'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[9.5px] font-extrabold uppercase tracking-[0.12em] transition-colors',
                            weekTone.bg,
                            weekTone.hover,
                            weekTone.text,
                          )}
                        >
                          <ChevronRight className={cn('h-3 w-3 shrink-0 transition-transform', !weekCollapsed && 'rotate-90')} strokeWidth={2.6} />
                          <span>{weekLabel}</span>
                          <span className="ml-auto text-[9.5px] font-bold normal-case tracking-normal opacity-60">
                            {weekCollapsed ? 'Recolhida' : `${weekDays.length} ${weekDays.length === 1 ? 'dia' : 'dias'}`}
                          </span>
                        </button>
                      </td>
                    </tr>
                  )}
                  {!weekCollapsed && <tr
                    className={`border-b transition-colors last:border-b-0 ${rowBg}`}
                  >
                    {/* Day label cell */}
                    <td className={`sticky left-0 z-10 border-r px-3 py-2 align-top ${stickyBg}`}>
                      <div className="flex flex-col items-center gap-0.5">
                        <span className={`text-[10px] font-medium uppercase tracking-wider
                          ${isSunday ? 'text-red-500' : 'text-muted-foreground'}
                        `}>
                          {dowLabel}
                        </span>
                        <span className={`flex items-center justify-center h-7 w-7 rounded-full text-sm font-bold
                          ${dayIsToday
                            ? 'bg-primary text-primary-foreground'
                            : isSunday ? 'text-red-500'
                            : 'text-foreground'
                          }
                        `}>
                          {day}
                        </span>
                        {isHoliday && (
                          <span className="text-[9px] font-semibold bg-orange-100 dark:bg-orange-900/40 text-orange-600 dark:text-orange-400 rounded px-1 py-0.5 leading-none">
                            Feriado
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Unit cells */}
                    {activeUnits.map(unit => {
                      const cellShifts = shiftIndex[date]?.[unit.id] ?? [];
                      const coverageAlert = coverageByCellKey.get(`${date}::${unit.id}`);
                      const dayOffEntries = dayOffIndex[date]?.[unit.id] ?? [];
                      const ghosts = isPerUnit
                        ? Object.values(ghostIndex[date] ?? {}).flat()
                        : [];
                      const visibleDayOffUserIds = new Set(dayOffEntries.map((entry) => entry.userId));
                      const unassignedUsers = (rosterUserIdsByUnit.get(unit.id) ?? [])
                        .filter((userId) => (
                          (userFilter === '__all__' || userFilter === userId)
                          && !occupiedUserDateKeys.has(`${date}::${userId}`)
                          && !visibleDayOffUserIds.has(userId)
                        ))
                        .flatMap((userId) => {
                          const candidate = effectiveUserMap.get(userId);
                          if (!candidate) return [];
                          const vacation = findApprovedVacationInIndex(approvedVacationIndex, userId, date);
                          return [{
                            userId,
                            user: candidate,
                            statusLabel: vacation ? 'Férias' as const : 'Sem unidade vinculada' as const,
                          }];
                        })
                        .sort((left, right) => left.user.username.localeCompare(right.user.username, 'pt-BR'));

                      const cellAlerts = alertsByCellKey.get(`${date}::${unit.id}`) ?? [];
                      const workCards = [...cellShifts].sort(compareWorkShiftsByTime).map((shift) => {
                        const user = effectiveUserMap.get(shift.userId);
                        const def = shift.shiftDefinitionId ? defMap.get(shift.shiftDefinitionId) : undefined;
                        return (
                          <ShiftCard
                            key={`own-${shift.id}`}
                            shift={shift}
                            vacationConflict={vacationConflictForShift(shift)}
                            userName={user?.username ?? 'Desconhecido'}
                            userAvatar={user?.avatarUrl}
                            userColor={user?.color}
                            shiftDef={def}
                            canEdit={canEdit}
                            selectionMode={bulkSelectionActive}
                            selected={selectedShiftIds.includes(shift.id)}
                            onSelect={(selectedShift) => toggleSelectedShift(selectedShift.id)}
                            onEdit={setEditShift}
                            onDelete={setDeleteTarget}
                          />
                        );
                      });
                      const ghostTags = [...ghosts]
                        .sort((left, right) => compareWorkShiftsByTime(left.shift, right.shift))
                        .map((ghost) => {
                          const user = effectiveUserMap.get(ghost.shift.userId);
                          if (!user) return null;
                          return (
                            <GhostShiftBadge
                              key={`ghost-${ghost.shift.id}`}
                              shift={ghost.shift}
                              unitName={ghost.unitName}
                              consecutiveDayCount={ghost.consecutiveDayCount}
                              user={user}
                              vacationConflict={vacationConflictForShift(ghost.shift)}
                            />
                          );
                        });
                      const priorSundayDate = isSunday
                        ? format(subDays(parse(date, 'yyyy-MM-dd', new Date()), 7), 'yyyy-MM-dd')
                        : null;
                      const priorSundayDateLabel = priorSundayDate
                        ? format(parse(priorSundayDate, 'yyyy-MM-dd', new Date()), 'dd/MM')
                        : '';
                      const lastSundayTags = priorSundayDate
                        ? (lastSundayShiftsByDate[priorSundayDate] ?? []).map((shift) => {
                          const user = effectiveUserMap.get(shift.userId);
                          if (!user) return null;
                          return (
                            <LastSundayBadge
                              key={`last-sunday-${shift.id}`}
                              user={user}
                              dateLabel={priorSundayDateLabel}
                            />
                          );
                        })
                        : [];
                      const dayOffCards = dayOffEntries.map(({ userId, explicit, shift, sourceUnitId, sourceUnitName }) => {
                        const user = effectiveUserMap.get(userId);
                        if (!user) return null;
                        const shouldRetry = shift?.bizneoSyncStatus === 'failed'
                          || shift?.bizneoSyncStatus === 'publishing'
                          || shift?.bizneoSyncStatus === 'pending';
                        const source = !explicit ? 'predicted' as const : shouldRetry ? 'retry' as const : 'manual' as const;
                        return (
                          <DayOffBadge
                            key={`${date}-${unit.id}-${userId}-${explicit ? 'explicit' : 'predicted'}`}
                            explicit={explicit}
                            shift={shift}
                            user={user}
                            contextLabel={sourceUnitId && !operationalUnitIdsMatch(sourceUnitId, unit.id, units) ? `Folga em ${sourceUnitName}` : undefined}
                            canPublish={canPublishDayOff && (explicit || !schedule.locked)}
                            canRemove={canPublishDayOff && explicit}
                            publishing={publishingDayOffKey === `${userId}::${date}`}
                            removing={removingDayOffKey === `${userId}::${date}`}
                            onPublish={() => void handlePublishDayOff({
                              scheduleId: shift?.scheduleId,
                              userId,
                              unitId: shift?.unitId ?? unit.id,
                              date,
                              source,
                            })}
                            onRemove={() => {
                              if (!shift) return;
                              setDayOffRemovalTarget({ shift, userName: user.username, unitName: sourceUnitName });
                            }}
                            conflictsWithWork={workDayOffConflictKeys.has(`${userId}::${date}`)}
                          />
                        );
                      });
                      const unassignedCards = unassignedUsers.map((candidate) => (
                        <UnassignedBadge
                          key={`${date}-${unit.id}-${candidate.userId}-unassigned`}
                          user={candidate.user}
                          statusLabel={candidate.statusLabel}
                        />
                      ));
                      const addShiftButton = canEdit ? (
                        <button
                          type="button"
                          onClick={() => setAddDialog({ date, unitId: unit.id })}
                          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border/50 px-2 py-1.5 text-xs text-muted-foreground/60 transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary/70"
                        >
                          <Plus className="h-3 w-3 shrink-0" />
                          <span>Adicionar turno</span>
                        </button>
                      ) : null;
                      const addDayOffButton = canPublishDayOff && !schedule.locked ? (
                        <button
                          type="button"
                          onClick={() => setManualDayOffDialog({ date, unitId: unit.id })}
                          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-sky-300/70 px-2 py-1.5 text-xs text-sky-600/80 transition-colors hover:border-sky-500 hover:bg-sky-50 dark:border-sky-800 dark:hover:bg-sky-950/20"
                        >
                          <CalendarOff className="h-3 w-3 shrink-0" />
                          <span>Adicionar folga</span>
                        </button>
                      ) : null;

                      return (
                        <td key={unit.id} colSpan={isPerUnit ? 3 : undefined} className="min-w-[200px] border-r p-0 align-top last:border-r-0">
                          {isPerUnit ? (
                            <div className="grid min-h-[52px] grid-cols-[minmax(600px,1fr)_360px_176px] divide-x divide-[#eef1f6]">
                            <div className="p-2">
                              <div className="grid max-w-[600px] grid-cols-3 gap-1">
                                {workCards}
                                {addShiftButton}
                              </div>
                              {(ghostTags.some(Boolean) || lastSundayTags.some(Boolean)) && (
                                <div className="mt-1.5 flex flex-col gap-1 border-t border-dashed border-[#e3e9f1] pt-1.5">
                                  {ghostTags.some(Boolean) && (
                                    <div className="flex items-start gap-1.5">
                                      <span className="shrink-0 pt-1 text-[8.5px] font-extrabold uppercase tracking-[0.08em] text-[#a3aec0]">Em outras unidades</span>
                                      <div className="flex min-w-0 flex-wrap gap-1">{ghostTags}</div>
                                    </div>
                                  )}
                                  {lastSundayTags.some(Boolean) && (
                                    <div className="flex items-start gap-1.5">
                                      <span className="shrink-0 pt-1 text-[8.5px] font-extrabold uppercase tracking-[0.08em] text-[#a3aec0]">Domingo passado</span>
                                      <div className="flex min-w-0 flex-wrap gap-1">{lastSundayTags}</div>
                                    </div>
                                  )}
                                </div>
                              )}
                              </div>
                              <div className="flex flex-col gap-1 p-2">
                                {dayOffCards}
                                {unassignedCards}
                                {addDayOffButton}
                              </div>
                              <div className="flex flex-col gap-1 p-2">
                                {coverageAlert ? (
                                  <CoverageStatus
                                    coverage={coverageAlert}
                                    canEditDemand={canEdit && coverageAlert.mode === 'on_demand'}
                                    onEditDemand={() => setCoverageDemandDialog({ date, unit })}
                                  />
                                ) : null}
                                {cellAlerts
                                  .filter((alert) => alert.key !== 'coverage' && alert.key !== 'unplanned')
                                  .map((alert) => (
                                    <div
                                      key={alert.key}
                                      className={cn(
                                        'flex items-start gap-1.5 rounded-lg border px-2.5 py-2 text-[11px] font-medium',
                                        alert.tone === 'danger'
                                          ? 'border-destructive/30 bg-destructive/5 text-destructive'
                                          : 'border-amber-300 bg-amber-50/70 text-amber-800 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-300',
                                      )}
                                    >
                                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                                      <span>{alert.label}</span>
                                    </div>
                                  ))}
                                {!coverageAlert && cellAlerts.length === 0 && (
                                  <p className="px-1 py-2 text-[11px] text-muted-foreground">Sem alertas.</p>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-1 p-2">
                              {coverageAlert ? (
                                <CoverageStatus
                                  coverage={coverageAlert}
                                  canEditDemand={canEdit && coverageAlert.mode === 'on_demand'}
                                  onEditDemand={() => setCoverageDemandDialog({ date, unit })}
                                />
                              ) : null}
                              {workCards}
                              {dayOffCards}
                              {unassignedCards}
                              {(addShiftButton || addDayOffButton) && (
                                <div className={cn('grid gap-1', addShiftButton && addDayOffButton ? 'grid-cols-2' : 'grid-cols-1')}>
                                  {addShiftButton}
                                  {addDayOffButton}
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>}
                  </React.Fragment>
                );
              })}
              {renderDays.length === 0 && (
                <tr>
                  <td colSpan={isPerUnit ? 4 : activeUnits.length + 1} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    Nenhuma ocorrência encontrada nos filtros atuais.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
        </div>

        {canEdit && bulkSelectionActive && (
          <DPBulkShiftEditPanel
            selectedShifts={selectedBulkShifts}
            allCurrentShifts={shifts}
            previousShifts={isPerUnit ? [...prevShifts, ...prevSiblingShifts] : prevShifts}
            siblingShifts={siblingShifts}
            shiftDefinitions={shiftDefinitions}
            people={bulkPeople.map((u) => ({ id: u.id, name: u.username }))}
            dayOffDatesByUser={dayOffOccupied}
            vacationDatesByUser={vacationDatesByUser}
            visiblePeople={visiblePeople}
            onTogglePerson={toggleShiftSelectionGroup}
            onRemoveSelected={removeShiftSelectionGroup}
            applyShiftsBatch={applyShiftsBatch}
            onApplied={resetBulkSelection}
            onCancel={resetBulkSelection}
          />
        )}
      </div>
      </div>

      {/* Dialogs */}
      <Dialog open={bizneoQueueOpen} onOpenChange={setBizneoQueueOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Fila do Bizneo · {scheduleUnit?.name ?? 'Unidade'}</DialogTitle>
            <DialogDescription>
              Folgas desta escala que ainda precisam de confirmação ou nova tentativa no Bizneo.
            </DialogDescription>
          </DialogHeader>
          {bizneoQueueItems.length === 0 ? (
            <div className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
              Nenhuma pendência nesta unidade.
            </div>
          ) : (
            <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
              {bizneoQueueItems.map((shift) => {
                const userName = effectiveUserMap.get(shift.userId)?.username ?? shift.userName ?? 'Colaborador';
                const busy = publishingDayOffKey === `${shift.userId}::${shift.date}`
                  || removingDayOffKey === `${shift.userId}::${shift.date}`;
                const isRemovalFailure = shift.bizneoSyncStatus === 'removal_failed';
                return (
                  <div key={shift.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{userName}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(parseISO(shift.date), "dd 'de' MMMM", { locale: ptBR })} · {shift.bizneoSyncStatus ?? 'pendente'}
                      </p>
                    </div>
                    {canPublishDayOff && (
                      <Button
                        type="button"
                        size="sm"
                        variant={isRemovalFailure ? 'destructive' : 'outline'}
                        disabled={busy}
                        onClick={() => {
                          if (isRemovalFailure) {
                            setBizneoQueueOpen(false);
                            setDayOffRemovalTarget({
                              shift,
                              userName,
                              unitName: scheduleUnit?.name ?? shift.unitId,
                            });
                            return;
                          }
                          void handlePublishDayOff({
                            scheduleId: shift.scheduleId,
                            userId: shift.userId,
                            unitId: shift.unitId,
                            date: shift.date,
                            source: 'retry',
                          });
                        }}
                      >
                        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        {isRemovalFailure ? 'Tentar remover' : 'Enviar novamente'}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={vtDialogOpen} onOpenChange={setVtDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Vale-transporte da escala</DialogTitle>
            <DialogDescription>
              Valor calculado por dias únicos trabalhados em {MONTHS[schedule.month - 1].toLowerCase()} de {schedule.year}.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border">
            <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-3">
              <span className="text-sm font-medium">Total da unidade</span>
              <span className="text-lg font-bold">{vtStats.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
            </div>
            {vtStats.breakdown.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhum colaborador com VT nesta escala.</p>
            ) : (
              <div className="max-h-[50vh] divide-y overflow-y-auto">
                {vtStats.breakdown.map((row) => (
                  <div key={row.name} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 px-4 py-3 text-sm">
                    <span className="truncate font-medium">{row.name}</span>
                    <span className="text-muted-foreground">{row.days} dia{row.days === 1 ? '' : 's'}</span>
                    <div className="text-right">
                      <p className="font-semibold">{row.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                      {row.siblingTotal > 0 && (
                        <p className="text-[10px] text-muted-foreground">
                          Outras unidades: {row.siblingTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {coverageDemandDialog ? (
        <CoverageDemandDialog
          scheduleId={schedule.id}
          unit={coverageDemandDialog.unit}
          date={coverageDemandDialog.date}
          initialWindows={coverageDemands[coverageDemandDialog.date] ?? []}
          open
          onOpenChange={(open) => { if (!open) setCoverageDemandDialog(null); }}
          onSaved={(date, windows) => {
            setCoverageDemands((current) => {
              const next = { ...current };
              if (windows.length > 0) next[date] = windows;
              else delete next[date];
              return next;
            });
          }}
        />
      ) : null}

      <ShiftDialog
        scheduleId={schedule.id}
        defaultDate={addDialog?.date}
        defaultUnitId={addDialog?.unitId}
        units={activeUnits}
        shiftDefinitions={shiftDefinitions}
        open={!!addDialog}
        onOpenChange={open => { if (!open) setAddDialog(null); }}
        siblingOccupied={isPerUnit ? siblingOccupied : undefined}
        dayOffOccupied={dayOffOccupied}
        vacations={vacations}
      />

      <ManualDayOffDialog
        open={!!manualDayOffDialog}
        onOpenChange={(open) => { if (!open) setManualDayOffDialog(null); }}
        date={manualDayOffDialog?.date ?? ''}
        unit={activeUnits.find((unit) => unit.id === manualDayOffDialog?.unitId)}
        users={manualDayOffUsers}
        onConfirm={(userId) => handlePublishDayOff({
          userId,
          unitId: manualDayOffDialog?.unitId ?? '',
          date: manualDayOffDialog?.date ?? '',
          source: 'manual',
        })}
      />

      <ShiftDialog
        scheduleId={schedule.id}
        shift={editShift}
        units={activeUnits}
        shiftDefinitions={shiftDefinitions}
        open={!!editShift}
        onOpenChange={open => { if (!open) setEditShift(null); }}
        siblingOccupied={isPerUnit ? siblingOccupied : undefined}
        dayOffOccupied={dayOffOccupied}
        vacations={vacations}
        onDelete={(shift) => {
          setEditShift(null);
          setDeleteTarget(shift);
        }}
      />

      <AlertDialog
        open={!!dayOffRemovalTarget}
        onOpenChange={(open) => {
          if (!open && !removingDayOffKey) setDayOffRemovalTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover folga?</AlertDialogTitle>
            <AlertDialogDescription>
              A folga de {dayOffRemovalTarget?.userName} em{' '}
              {dayOffRemovalTarget?.shift.date
                ? format(parseISO(dayOffRemovalTarget.shift.date), "dd 'de' MMMM", { locale: ptBR })
                : ''}{' '}
              ({dayOffRemovalTarget?.unitName}) será removida do Bizneo e do Coala One. Se a remoção externa falhar, o registro será mantido para nova tentativa.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!removingDayOffKey}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void confirmDayOffRemoval();
              }}
              disabled={!!removingDayOffKey}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removingDayOffKey ? 'Removendo...' : 'Remover folga'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover turno?</AlertDialogTitle>
            <AlertDialogDescription>
              O turno de {deleteTarget?.startTime}–{deleteTarget?.endTime} em{' '}
              {deleteTarget?.date
                ? format(parseISO(deleteTarget.date), "dd 'de' MMMM", { locale: ptBR })
                : ''}{' '}
              será removido permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? 'Removendo...' : 'Remover'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
