"use client";

import React, { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format, getDaysInMonth, isToday, parseISO, parse } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { useDP } from '@/components/dp-context';
import { useDPShifts } from '@/hooks/use-dp-shifts';
import { useDPHolidays } from '@/hooks/use-dp-holidays';
import { useDPSiblingShifts } from '@/hooks/use-dp-sibling-shifts';
import { useDPScheduleVacations } from '@/hooks/use-dp-schedule-vacations';
import { useAuth } from '@/hooks/use-auth';
import { useAuthenticatedApi } from '@/hooks/use-authenticated-api';
import { useKiosks } from '@/hooks/use-kiosks';
import type { DPSchedule, DPScheduleSnapshot, DPShift, DPUnit, DPVacationRecord, Kiosk, User } from '@/types';
import type { PublishDayOffResult } from '@/features/dp/day-offs/schemas';
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
import { Plus, Pencil, Trash2, AlertTriangle, Users, Filter, Bus, CalendarDays, CalendarOff, Loader2, Lock, LockOpen, Sparkles, ChevronRight } from 'lucide-react';
import { BackButton } from '@/components/navigation/back-button';
import { getUserColor } from '@/lib/utils/user-colors';
import { useToast } from '@/hooks/use-toast';
import type { DPShiftDefinition } from '@/types';
import {
  getPrimaryShiftDefinitionUnitId,
  shiftDefinitionMatchesUnit,
} from '@/lib/dp-shift-definitions';
import { matchDPUnitForKiosk } from '@/lib/dp-kiosk-match';
import { buildShiftStreakState, compareWorkShiftsByTime, isDayOffShift, isWorkShift } from '@/lib/dp-shift-rules';
import {
  buildApprovedVacationIndex,
  findApprovedVacationForDate,
  findApprovedVacationInIndex,
  formatVacationPeriod,
} from '@/lib/dp-vacation-schedule-rules';
import { DPBulkShiftEditDialog } from '@/components/dp/dp-bulk-shift-edit-dialog';
import { canAccessUnit, filterUnitsByAccess, resolveUnitAccess } from '@/lib/unit-access';

// ─── Constants ────────────────────────────────────────────────────────────────

const DOW_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase();
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
  vacations: DPVacationRecord[];
}

function ShiftDialog({
  scheduleId, shift, defaultDate, defaultUnitId, units, shiftDefinitions, open, onOpenChange, siblingOccupied, vacations,
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
  const vacationConflict = useMemo(
    () => findApprovedVacationForDate(vacations, selectedUserId, selectedDate),
    [selectedDate, selectedUserId, vacations],
  );

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
        await updateShift({ ...shift, ...values, ...(userName ? { userName } : {}), type: 'work', hasConflict: hasCrossConflict || shift.hasConflict });
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
    } catch {
      toast({ title: 'Erro ao salvar turno.', variant: 'destructive' });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar turno' : 'Adicionar turno'}</DialogTitle>
          <DialogDescription>
            Preencha colaborador, unidade, data e faixa de horário do turno.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-2">

            <FormField control={form.control} name="userId" render={({ field }) => (
              <FormItem>
                <FormLabel>Colaborador</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {operationalUsers.map(u => (
                      <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            {(!defaultDate || isEdit) && (
              <FormField control={form.control} name="date" render={({ field }) => (
                <FormItem>
                  <FormLabel>Data</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            )}

            {!unitLocked && (
              <FormField control={form.control} name="unitId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Unidade</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Selecione a unidade" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {activeOperationalUnits(units).map(u => (
                        <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            )}

            <FormField control={form.control} name="shiftDefinitionId" render={({ field }) => (
              <FormItem>
                <FormLabel>Turno pré-definido (opcional)</FormLabel>
                <Select
                  value={field.value || '__none__'}
                  onValueChange={v => handleDefinitionChange(v === '__none__' ? '' : v)}
                >
                  <FormControl><SelectTrigger><SelectValue placeholder="Selecionar turno" /></SelectTrigger></FormControl>
                  <SelectContent>
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
                <FormMessage />
              </FormItem>
            )} />

            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="startTime" render={({ field }) => (
                <FormItem>
                  <FormLabel>Início</FormLabel>
                  <FormControl><Input type="time" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="endTime" render={({ field }) => (
                <FormItem>
                  <FormLabel>Fim</FormLabel>
                  <FormControl><Input type="time" {...field} /></FormControl>
                  <FormMessage />
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

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit" disabled={form.formState.isSubmitting || !!vacationConflict}>
                {form.formState.isSubmitting ? 'Salvando...' : 'Salvar'}
              </Button>
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
  return (
    <div
      role={selectionMode ? 'button' : undefined}
      tabIndex={selectionMode ? 0 : undefined}
      onClick={selectionMode ? () => onSelect?.(shift) : undefined}
      onKeyDown={selectionMode ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect?.(shift);
        }
      } : undefined}
      className={cn(
        'group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs transition-colors border border-l-[3px]',
        hasVisibleConflict
          ? 'bg-destructive/10 border-destructive/20'
          : 'bg-card border-border hover:bg-muted/30',
        selectionMode && 'cursor-pointer',
        selected && 'ring-2 ring-primary bg-primary/5 border-primary/30'
      )}
      style={hasVisibleConflict ? undefined : { borderLeftColor: accentColor }}
      title={vacationPeriod ? `Conflito: férias aprovadas de ${vacationPeriod}` : undefined}
    >
      <Avatar className="h-7 w-7 shrink-0">
        <AvatarImage src={userAvatar} />
        <AvatarFallback className="text-[10px] font-semibold">
          {initials(userName)}
        </AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        <p className="font-semibold truncate text-foreground leading-tight">{userName}</p>
        <p className="text-muted-foreground leading-tight mt-0.5">
          {shift.startTime}–{shift.endTime}
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
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold
            ${shift.consecutiveDayCount > 7
              ? 'bg-destructive/15 text-destructive'
              : shift.consecutiveDayCount === 7
                ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
                : 'bg-muted text-muted-foreground'
            }`}>
            {shift.consecutiveDayCount}
          </span>
        )}
      </div>

      {canEdit && !selectionMode && (
        <div className="absolute inset-0 hidden group-hover:flex items-center justify-end gap-0.5 pr-1.5 bg-background/90 rounded-lg">
          <button onClick={() => onEdit(shift)} className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted">
            <Pencil className="h-3 w-3" />
          </button>
          <button onClick={() => onDelete(shift)} className="h-6 w-6 flex items-center justify-center rounded hover:bg-destructive/10 text-destructive">
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
        'rounded border border-dashed px-1.5 py-1 flex items-center gap-1.5 min-w-0',
        vacationConflict
          ? 'border-destructive/30 bg-destructive/10'
          : 'border-muted-foreground/25 bg-muted/20',
      )}
      title={vacationPeriod
        ? `${user.username} — conflito com férias aprovadas de ${vacationPeriod}`
        : `${user.username} — ${shift.startTime}–${shift.endTime} (${unitName}) · ${consecutiveDayCount} dias consecutivos`}
    >
      <Avatar className="w-4 h-4 shrink-0">
        <AvatarImage src={user.avatarUrl} />
        <AvatarFallback style={{ background: color, fontSize: 6 }} className="text-white">
          {initials(user.username)}
        </AvatarFallback>
      </Avatar>
      <span className="text-[10px] font-medium text-muted-foreground truncate">{user.username}</span>
      <span className="text-[10px] text-muted-foreground/60 shrink-0">{shift.startTime}–{shift.endTime}</span>
      {vacationConflict && (
        <span className="rounded bg-destructive/15 px-1 py-0.5 text-[9px] font-bold text-destructive">Férias</span>
      )}
      <span className={`text-[10px] font-bold shrink-0 ${countColor}`}>{consecutiveDayCount}</span>
      <span className="text-[9px] bg-muted rounded px-1 shrink-0 text-muted-foreground/70 ml-auto">{unitName}</span>
    </div>
  );
}

function DayOffBadge({ explicit, shift, user, canPublish, busy, onPublish }: {
  explicit: boolean;
  shift?: DPShift;
  user: { username: string; avatarUrl?: string; color?: string };
  canPublish: boolean;
  busy: boolean;
  onPublish: () => void;
}) {
  const color = user.color ?? getUserColor(user.username);
  const status = shift?.bizneoSyncStatus;
  const isPublished = explicit && status === 'published';
  const isPublishing = busy;
  const hasFailed = explicit && status === 'failed';
  const isPendingRetry = explicit && (status === 'publishing' || status === 'pending');
  const needsRetry = hasFailed || isPendingRetry;
  const canAction = canPublish && !isPublished && !isPublishing;
  let badgeLabel = 'Folga';
  if (!explicit) badgeLabel = 'Folga prevista';
  else if (isPublished) badgeLabel = 'Folga confirmada';
  else if (isPublishing) badgeLabel = 'Enviando';
  else if (hasFailed) badgeLabel = 'Falha no Bizneo';
  else if (isPendingRetry) badgeLabel = 'Envio pendente';

  const badgeTone = hasFailed
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
        <span className="truncate text-[11px] font-medium">{user.username}</span>
        <Badge variant="outline" className="ml-auto shrink-0 text-[10px]">
          {isPublishing && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
          {badgeLabel}
        </Badge>
      </div>
      {canAction && (
        <button
          type="button"
          onClick={onPublish}
          className={cn(
            'mt-1.5 flex h-6 w-full items-center justify-center rounded border px-2 text-[10px] font-semibold transition-colors',
            hasFailed
              ? 'border-destructive/30 hover:bg-destructive/10'
              : 'border-border/60 hover:bg-background/70',
          )}
        >
          {needsRetry ? 'Tentar novamente' : explicit ? 'Enviar ao Bizneo' : 'Confirmar folga'}
        </button>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface DPScheduleEditorProps {
  schedule: DPSchedule;
}

export function DPScheduleEditor({ schedule }: DPScheduleEditorProps) {
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
    addShiftsBatch,
    updateShiftsBatch,
    deleteShift: doDelete,
    deleteShiftsBatch,
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
  const [editShift, setEditShift] = useState<DPShift | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DPShift | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [locking, setLocking] = useState(false);
  const [prevExpanded, setPrevExpanded] = useState(false);
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [bulkSelectionActive, setBulkSelectionActive] = useState(false);
  const [selectedShiftIds, setSelectedShiftIds] = useState<string[]>([]);

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

  React.useEffect(() => {
    if (!bulkDialogOpen) {
      setBulkSelectionActive(false);
      setSelectedShiftIds([]);
    }
  }, [bulkDialogOpen]);

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

  function handleBulkButtonClick() {
    if (!bulkSelectionActive) {
      setBulkSelectionActive(true);
      return;
    }

    if (selectedShiftIds.length === 0) {
      toast({ title: 'Selecione os turnos que deseja alterar.' });
      return;
    }

    setBulkDialogOpen(true);
  }

  React.useEffect(() => {
    setSelectedShiftIds((prev) => {
      const availableIds = new Set(shifts.filter((shift) => shift.type === 'work').map((shift) => shift.id));
      const next = prev.filter((id) => availableIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [shifts]);

  function clearSelectedShiftIds() {
    setSelectedShiftIds([]);
  }

  // Filters
  const [unitFilter, setUnitFilter] = useState<string>('__all__');
  const [defFilter, setDefFilter] = useState<string>('__all__');
  const [userFilter, setUserFilter] = useState<string>('__all__');
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
      };
    });
  }, [schedule.year, schedule.month]);

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
      .filter((shift) => selectedSet.has(shift.id) && shift.type === 'work')
      .map((shift) => ({
        shift,
        userName: effectiveUserMap.get(shift.userId)?.username ?? 'Desconhecido',
        unitName: units.find((unit) => unit.id === shift.unitId)?.name ?? shift.unitId,
      }));
  }, [selectedShiftIds, shifts, effectiveUserMap, units]);

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
  const approvedVacationIndex = useMemo(
    () => buildApprovedVacationIndex(vacations),
    [vacations],
  );

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

  // ghostIndex[date][userId] = { shift, unitName, consecutiveDayCount }[]
  // Shows users from sibling units who are also linked to the current unit.
  const ghostIndex = useMemo(() => {
    if (!isPerUnit || !schedule.unitId) return {} as Record<string, Record<string, { shift: DPShift; unitName: string; consecutiveDayCount: number }[]>>;
    // Users who are officially linked to this unit (multi-unit workers)
    const linkedUserIds = new Set(
      operationalUsers
        .filter(u => userMatchesDPUnit(u, schedule.unitId, units, kiosks))
        .map(u => u.id)
    );
    const idx: Record<string, Record<string, { shift: DPShift; unitName: string; consecutiveDayCount: number }[]>> = {};
    for (const s of siblingWorkShifts) {
      if (linkedUserIds.size > 0 && !linkedUserIds.has(s.userId)) continue;
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
  }, [isPerUnit, schedule.unitId, siblingWorkShifts, operationalUsers, units, kiosks, consecutiveCountMap]);

  // Cross-unit conflict detection: userId → dates occupied in sibling units
  const siblingOccupied = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const s of siblingWorkShifts) {
      if (!m.has(s.userId)) m.set(s.userId, new Set());
      m.get(s.userId)!.add(s.date);
    }
    return m;
  }, [siblingWorkShifts]);

  // IDs of current-unit shifts that conflict with a sibling schedule (same user, same date)
  const crossConflictShiftIds = useMemo(() => {
    if (!isPerUnit) return new Set<string>();
    const ids = new Set<string>();
    for (const s of workShifts) {
      if (siblingOccupied.get(s.userId)?.has(s.date)) ids.add(s.id);
    }
    return ids;
  }, [isPerUnit, workShifts, siblingOccupied]);

  const shiftsWithConsecutive = useMemo(() =>
    workShifts.map(s => ({ ...s, consecutiveDayCount: consecutiveCountMap.get(s.id) ?? 1 })),
  [workShifts, consecutiveCountMap]);

  const prevShiftsWithConsecutive = useMemo(() =>
    prevWorkShifts.map(s => ({ ...s, consecutiveDayCount: consecutiveCountMap.get(s.id) ?? 1 })),
  [prevWorkShifts, consecutiveCountMap]);

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
    const entries = new Map<string, { userId: string; explicit: boolean; shift?: DPShift }>();

    const registerEntry = (date: string, unitId: string, userId: string, explicit: boolean, shift?: DPShift) => {
      if (!currentMonthDateSet.has(date) || !activeUnitIds.has(unitId)) return;
      if (visibleUserIds && !visibleUserIds.has(userId)) return;
      const key = `${date}::${unitId}::${userId}`;
      const existing = entries.get(key);
      if (existing?.explicit) return;
      entries.set(key, { userId, explicit: explicit || existing?.explicit || false, shift: shift ?? existing?.shift });
    };

    const visibleExplicitDayOffs = isPerUnit ? [...dayOffShifts, ...siblingDayOffShifts] : dayOffShifts;
    visibleExplicitDayOffs.forEach((shift) => {
      let displayUnitId = shift.unitId;
      if (isPerUnit && schedule.unitId) {
        const linkedToCurrentUser = operationalUsers.find((user) => user.id === shift.userId);
        const linkedToCurrent = linkedToCurrentUser
          ? userMatchesDPUnit(linkedToCurrentUser, schedule.unitId, units, kiosks)
          : false;
        if (linkedToCurrent || shift.unitId === schedule.unitId) displayUnitId = schedule.unitId;
        else return;
      }
      registerEntry(shift.date, displayUnitId, shift.userId, true, shift);
    });

    streakState.predictedDayOffsByUser.forEach((items, userId) => {
      items.forEach((item) => {
        let displayUnitId = item.sourceUnitId;
        if (isPerUnit && schedule.unitId) {
          const linkedToCurrentUser = operationalUsers.find((user) => user.id === userId);
          const linkedToCurrent = linkedToCurrentUser
            ? userMatchesDPUnit(linkedToCurrentUser, schedule.unitId, units, kiosks)
            : false;
          if (linkedToCurrent || item.sourceUnitId === schedule.unitId) displayUnitId = schedule.unitId;
          else return;
        }
        registerEntry(item.date, displayUnitId, userId, false);
      });
    });

    const idx: Record<string, Record<string, { userId: string; explicit: boolean; shift?: DPShift }[]>> = {};
    entries.forEach((entry, key) => {
      const [date, unitId] = key.split('::');
      if (!idx[date]) idx[date] = {};
      if (!idx[date][unitId]) idx[date][unitId] = [];
      idx[date][unitId].push(entry);
    });

    return idx;
  }, [
    activeUnits,
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

  // Index shifts: [date][unitId] → DPShift[] (com filtros e contagem consecutiva)
  const shiftIndex = useMemo(() => {
    const idx: Record<string, Record<string, DPShift[]>> = {};
    for (const shift of shiftsWithConsecutive) {
      if (defFilter !== '__all__' && shift.shiftDefinitionId !== defFilter) continue;
      if (userFilter !== '__all__' && shift.userId !== userFilter) continue;
      const hasVacationConflict = vacationConflictByShiftId.has(shiftVacationKey(shift));
      if (onlyAlerts && !shift.hasConflict && !hasVacationConflict && !(shift.consecutiveDayCount && shift.consecutiveDayCount >= 7)) continue;
      if (!idx[shift.date]) idx[shift.date] = {};
      if (!idx[shift.date][shift.unitId]) idx[shift.date][shift.unitId] = [];
      idx[shift.date][shift.unitId].push(shift);
    }
    Object.values(idx).forEach((byUnit) => {
      Object.values(byUnit).forEach((items) => items.sort(compareWorkShiftsByTime));
    });
    return idx;
  }, [shiftsWithConsecutive, defFilter, userFilter, onlyAlerts, vacationConflictByShiftId]);

  // Stats
  const conflictCount = useMemo(
    () => workShifts.filter((shift) => shift.hasConflict || vacationConflictByShiftId.has(shiftVacationKey(shift))).length,
    [vacationConflictByShiftId, workShifts],
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
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <BackButton fallbackHref="/dashboard/dp/schedules" ariaLabel="Voltar à página anterior" iconOnly variant="ghost" size="icon" iconClassName="h-4 w-4" />
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold truncate">{schedule.name}</h1>
          <p className="text-sm text-muted-foreground">
            {MONTHS[schedule.month - 1]} {schedule.year}
          </p>
        </div>
        {canManageSchedule && (
          schedule.locked ? (
            <Button size="sm" variant="outline" onClick={handleUnlock} disabled={locking} className="border-amber-500/50 text-amber-600 hover:bg-amber-50">
              <LockOpen className="mr-2 h-4 w-4" />
              {locking ? 'Destrancando...' : 'Destrancar'}
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={handleLock} disabled={locking}>
              <Lock className="mr-2 h-4 w-4" />
              {locking ? 'Trancando...' : 'Trancar'}
            </Button>
          )
        )}
        {canEdit && (
          <Button size="sm" variant="outline" onClick={handleBulkButtonClick}>
            <Sparkles className="mr-2 h-4 w-4" />
            {bulkSelectionActive
              ? selectedShiftIds.length > 0
                ? `Alterar em lote (${selectedShiftIds.length})`
                : 'Selecionar turnos'
              : 'Editar em lote'}
          </Button>
        )}
        {canEdit && (
          <Button
            size="sm"
            onClick={() => setAddDialog({ date: days[0]?.date ?? '', unitId: activeUnits[0]?.id ?? '' })}
          >
            <Plus className="mr-2 h-4 w-4" />
            Adicionar turno
          </Button>
        )}
      </div>
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
      {canEdit && bulkSelectionActive && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-sky-200 bg-sky-50/80 px-3 py-2 text-sm text-sky-700 dark:border-sky-900/40 dark:bg-sky-950/20 dark:text-sky-300">
          <div className="min-w-0">
            <p className="font-medium">Seleção de turnos ativa</p>
            <p className="text-xs opacity-80">Clique nos cards de turno que deseja alterar em lote.</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant="outline">{selectedShiftIds.length} turno(s)</Badge>
            <Button type="button" variant="ghost" size="sm" onClick={resetBulkSelection}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {/* Stats boxes */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Popover>
          <PopoverTrigger asChild>
            <div className="rounded-xl border bg-card px-4 py-3 cursor-pointer hover:bg-muted/40 transition-colors">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <Users className="h-3.5 w-3.5" />
                <span>Pessoas</span>
                <ChevronRight className="h-3 w-3 ml-auto" />
              </div>
              <p className="text-lg font-bold">{uniqueCollaborators}</p>
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
        <div className={`rounded-xl border px-4 py-3 ${conflictCount > 0 ? 'bg-destructive/5 border-destructive/30' : 'bg-card'}`}>
          <div className={`flex items-center gap-2 text-xs mb-1 ${conflictCount > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>Conflito{conflictCount !== 1 ? 's' : ''}</span>
          </div>
          <p className={`text-lg font-bold ${conflictCount > 0 ? 'text-destructive' : ''}`}>{conflictCount}</p>
        </div>
        <div className="rounded-xl border bg-card px-4 py-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <Filter className="h-3.5 w-3.5" />
            <span>Turnos</span>
          </div>
          <p className="text-lg font-bold">{workShifts.length}</p>
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <div className="rounded-xl border bg-card px-4 py-3 cursor-pointer hover:bg-muted/40 transition-colors">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <Bus className="h-3.5 w-3.5" />
                <span>Vale Transporte</span>
                <ChevronRight className="h-3 w-3 ml-auto" />
              </div>
              <p className="text-lg font-bold">
                {vtStats.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </p>
            </div>
          </PopoverTrigger>
          <PopoverContent className="w-60 p-2" align="end">
            <p className="text-xs font-medium text-muted-foreground mb-2">Por colaborador</p>
            {vtStats.breakdown.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhum colaborador com VT.</p>
            ) : (
              <div className="space-y-1.5">
                {vtStats.breakdown.map(row => (
                  <div key={row.name} className="flex items-start justify-between gap-2">
                    <span className="truncate text-xs pt-px">{row.name}</span>
                    <div className="text-right shrink-0">
                      <p className="text-xs text-muted-foreground">
                        {row.days}d · {row.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </p>
                      {row.siblingTotal > 0 && (
                        <p className="text-[10px] text-destructive/70 leading-tight font-bold">
                          total: {(row.total + row.siblingTotal).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Calendar badge (readonly – set at creation) */}
        {schedule.calendarId && (() => {
          const cal = calendars.find(c => c.id === schedule.calendarId);
          return cal ? (
            <div className="flex items-center gap-1.5 h-8 px-2 rounded-lg border bg-muted/50 text-xs text-muted-foreground">
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
        <Select value={defFilter} onValueChange={setDefFilter}>
          <SelectTrigger className="h-8 text-xs w-[160px]"><SelectValue placeholder="Todos os turnos" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos os turnos</SelectItem>
            {shiftDefinitions.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={userFilter} onValueChange={setUserFilter}>
          <SelectTrigger className="h-8 text-xs w-[160px]"><SelectValue placeholder="Todos os colaboradores" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos os colaboradores</SelectItem>
            {operationalUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>)}
          </SelectContent>
        </Select>
        <button
          onClick={() => setOnlyAlerts(v => !v)}
          className={`h-8 px-3 rounded-lg border text-xs font-medium transition-colors flex items-center gap-1.5
            ${onlyAlerts
              ? 'bg-destructive/10 border-destructive/30 text-destructive'
              : 'border-border text-muted-foreground hover:bg-muted/50'
            }`}
        >
          <AlertTriangle className="h-3 w-3" />
          Ver apenas alertas
        </button>
      </div>

      {/* Grid */}
      {activeUnits.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
          <p className="text-sm">Nenhuma unidade cadastrada. Cadastre unidades em Configurações primeiro.</p>
        </div>
      ) : (
        <div className="overflow-auto rounded-xl border">
          <table className="w-max min-w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/40">
                {/* Sticky day column header */}
                <th className="sticky left-0 z-20 bg-muted/40 border-b border-r px-3 py-2.5 text-left font-medium text-muted-foreground min-w-[80px] text-xs uppercase tracking-wider">
                  Data
                </th>
                {activeUnits.map(unit => (
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
                      colSpan={activeUnits.length + 1}
                      className="sticky left-0 border-b"
                    >
                      <button
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
                            <td key={unit.id} className="border-r px-2 py-2 align-top last:border-r-0 min-w-[200px]">
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
                      colSpan={activeUnits.length + 1}
                      className="sticky left-0 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground bg-muted/50 border-b"
                    >
                      {MONTHS[schedule.month - 1]} {schedule.year}
                    </td>
                  </tr>
                </>
              )}

              {/* ── Current month rows ── */}
              {days.map(({ day, date, dow, dowLabel, isToday: dayIsToday }) => {
                const isSunday = dow === 0;
                const isSaturday = dow === 6;
                const isWeekend = isSunday || isSaturday;
                const isHoliday = holidaySet.has(date);

                const rowBg = isHoliday
                  ? 'bg-orange-50 dark:bg-orange-900/10'
                  : dayIsToday ? 'bg-blue-50 dark:bg-blue-900/10'
                  : isWeekend ? 'bg-muted/20' : 'hover:bg-muted/10';

                const stickyBg = isHoliday
                  ? 'bg-orange-50 dark:bg-orange-900/10'
                  : dayIsToday ? 'bg-blue-50 dark:bg-blue-900/10'
                  : isWeekend ? 'bg-muted/30' : 'bg-background';

                return (
                  <tr
                    key={date}
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
                      const dayOffEntries = dayOffIndex[date]?.[unit.id] ?? [];
                      const ghosts = isPerUnit
                        ? Object.values(ghostIndex[date] ?? {}).flat()
                        : [];
                      const displayWorkEntries = [
                        ...cellShifts.map(shift => ({ kind: 'own' as const, shift })),
                        ...ghosts.map(ghost => ({ kind: 'ghost' as const, ...ghost })),
                      ].sort((left, right) => compareWorkShiftsByTime(left.shift, right.shift));

                      return (
                        <td
                          key={unit.id}
                          className="border-r px-2 py-2 align-top last:border-r-0 min-w-[200px]"
                        >
                          <div className="flex flex-col gap-1">
                            {displayWorkEntries.map((entry) => {
                              const { shift } = entry;
                              const user = effectiveUserMap.get(shift.userId);
                              if (entry.kind === 'ghost') {
                                if (!user) return null;
                                return (
                                  <GhostShiftBadge
                                    key={`ghost-${shift.id}`}
                                    shift={shift}
                                    unitName={entry.unitName}
                                    consecutiveDayCount={entry.consecutiveDayCount}
                                    user={user}
                                    vacationConflict={vacationConflictForShift(shift)}
                                  />
                                );
                              }
                              const def = shift.shiftDefinitionId ? defMap.get(shift.shiftDefinitionId) : undefined;
                              const hasCrossConflict = crossConflictShiftIds.has(shift.id);
                              return (
                                <ShiftCard
                                  key={`own-${shift.id}`}
                                  shift={{ ...shift, hasConflict: shift.hasConflict || hasCrossConflict }}
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
                            })}
                            {dayOffEntries.length > 0 && (
                              <>
                                {displayWorkEntries.length > 0 && (
                                  <div className="border-t border-dashed border-muted-foreground/20 my-0.5" />
                                )}
                                {dayOffEntries.map(({ userId, explicit, shift }) => {
                                  const user = effectiveUserMap.get(userId);
                                  if (!user) return null;
                                  const shouldRetry = shift?.bizneoSyncStatus === 'failed'
                                    || shift?.bizneoSyncStatus === 'publishing'
                                    || shift?.bizneoSyncStatus === 'pending';
                                  const source = !explicit
                                    ? 'predicted' as const
                                    : shouldRetry
                                      ? 'retry' as const
                                      : 'manual' as const;
                                  return (
                                    <DayOffBadge
                                      key={`${date}-${unit.id}-${userId}-${explicit ? 'explicit' : 'predicted'}`}
                                      explicit={explicit}
                                      shift={shift}
                                      user={user}
                                      canPublish={canPublishDayOff && (explicit || !schedule.locked)}
                                      busy={publishingDayOffKey === `${userId}::${date}`}
                                      onPublish={() => void handlePublishDayOff({
                                        scheduleId: shift?.scheduleId,
                                        userId,
                                        unitId: shift?.unitId ?? unit.id,
                                        date,
                                        source,
                                      })}
                                    />
                                  );
                                })}
                              </>
                            )}
                            {(canEdit || (canPublishDayOff && !schedule.locked)) && (
                              <div className={cn('grid gap-1', canEdit && canPublishDayOff ? 'grid-cols-2' : 'grid-cols-1')}>
                                {canEdit && (
                                  <button
                                    onClick={() => setAddDialog({ date, unitId: unit.id })}
                                    className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border/50 hover:border-primary/50 hover:bg-primary/5 transition-colors text-muted-foreground/50 hover:text-primary/70 px-2 py-1.5 text-xs w-full"
                                  >
                                    <Plus className="h-3 w-3 shrink-0" />
                                    <span>Adicionar</span>
                                  </button>
                                )}
                                {canPublishDayOff && !schedule.locked && (
                                  <button
                                    onClick={() => setManualDayOffDialog({ date, unitId: unit.id })}
                                    className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-sky-300/70 hover:border-sky-500 hover:bg-sky-50 transition-colors text-sky-600/80 px-2 py-1.5 text-xs w-full dark:border-sky-800 dark:hover:bg-sky-950/20"
                                  >
                                    <CalendarOff className="h-3 w-3 shrink-0" />
                                    <span>Folga</span>
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Dialogs */}
      <ShiftDialog
        scheduleId={schedule.id}
        defaultDate={addDialog?.date}
        defaultUnitId={addDialog?.unitId}
        units={activeUnits}
        shiftDefinitions={shiftDefinitions}
        open={!!addDialog}
        onOpenChange={open => { if (!open) setAddDialog(null); }}
        siblingOccupied={isPerUnit ? siblingOccupied : undefined}
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
        vacations={vacations}
      />

      <DPBulkShiftEditDialog
        open={bulkDialogOpen}
        onOpenChange={(open) => {
          setBulkDialogOpen(open);
          if (!open) resetBulkSelection();
        }}
        selectedShifts={selectedBulkShifts}
        allCurrentShifts={shifts}
        previousShifts={isPerUnit ? [...prevShifts, ...prevSiblingShifts] : prevShifts}
        siblingShifts={siblingShifts}
        shiftDefinitions={shiftDefinitions}
        addShiftsBatch={addShiftsBatch}
        updateShiftsBatch={updateShiftsBatch}
        deleteShiftsBatch={deleteShiftsBatch}
        onApplied={resetBulkSelection}
      />

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
