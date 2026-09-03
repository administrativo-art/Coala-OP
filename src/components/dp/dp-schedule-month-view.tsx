"use client";

import React, { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useDP } from '@/components/dp-context';
import { useAuth } from '@/hooks/use-auth';
import { useAccessibleDPSchedules } from '@/hooks/use-accessible-dp-schedules';
import { activeOperationalUnits } from '@/lib/dp-units';
import type { DPSchedule } from '@/types';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { Plus, CalendarDays, Trash2, Lock } from 'lucide-react';
import { BackButton } from '@/components/navigation/back-button';
import { useToast } from '@/hooks/use-toast';
import { CreateScheduleDialog } from '@/components/dp/dp-schedules-list';
import { DPScheduleEditor } from '@/components/dp/dp-schedule-editor';
import { cn } from '@/lib/utils';

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

export function DPScheduleMonthView({ year, month }: { year: number; month: number }) {
  const {
    units,
    unitsLoading,
    unitsError,
    calendars,
    calendarsLoading,
    calendarsError,
    deleteSchedule,
  } = useDP();
  const { permissions } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const accessibleSchedules = useAccessibleDPSchedules();

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DPSchedule | null>(null);
  const [deleting, setDeleting] = useState(false);

  const canCreate = permissions.dp?.schedules?.create ?? false;
  const canDelete = permissions.dp?.schedules?.delete ?? false;
  const createDependenciesReady = !unitsLoading && !calendarsLoading && !unitsError && !calendarsError;

  const activeUnits = useMemo(() => activeOperationalUnits(units), [units]);

  const monthSchedules = useMemo(() => {
    const unitOrder = new Map(units.map((u, i) => [u.id, i]));
    return accessibleSchedules
      .filter(s => s.year === year && s.month === month)
      .sort((a, b) => {
        if (!a.unitId && !b.unitId) return 0;
        if (!a.unitId) return 1;
        if (!b.unitId) return -1;
        const ai = unitOrder.get(a.unitId) ?? Number.MAX_SAFE_INTEGER;
        const bi = unitOrder.get(b.unitId) ?? Number.MAX_SAFE_INTEGER;
        return ai - bi;
      });
  }, [accessibleSchedules, units, year, month]);

  const selectedId = searchParams.get('schedule');
  const selectedSchedule = useMemo(() => {
    if (selectedId) {
      const found = monthSchedules.find(s => s.id === selectedId);
      if (found) return found;
    }
    return monthSchedules[0] ?? null;
  }, [monthSchedules, selectedId]);

  function selectSchedule(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('schedule', id);
    router.replace(`/dashboard/dp/schedules/month/${year}-${String(month).padStart(2, '0')}?${params.toString()}`, { scroll: false });
  }

  const existingUnitIds = useMemo(
    () => monthSchedules.map(s => s.unitId).filter((id): id is string => !!id),
    [monthSchedules],
  );

  async function confirmDelete() {
    if (!deleteTarget) return;
    const targetUnit = units.find((unit) => unit.id === deleteTarget.unitId);
    if (targetUnit?.isArchived === true) {
      toast({ title: 'Escalas históricas de unidades incorporadas não podem ser excluídas.', variant: 'destructive' });
      setDeleteTarget(null);
      return;
    }
    setDeleting(true);
    try {
      await deleteSchedule(deleteTarget.id);
      toast({ title: 'Escala excluída.' });
      if (selectedSchedule?.id === deleteTarget.id) {
        const remaining = monthSchedules.filter(s => s.id !== deleteTarget.id);
        if (remaining[0]) selectSchedule(remaining[0].id);
      }
    } catch {
      toast({ title: 'Erro ao excluir escala.', variant: 'destructive' });
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <BackButton fallbackHref="/dashboard/dp/schedules" ariaLabel="Voltar à lista de meses" iconOnly variant="ghost" size="icon" iconClassName="h-4 w-4" />
        <div>
          <h1 className="text-xl font-semibold">{MONTHS[month - 1]} de {year}</h1>
          <p className="text-sm text-muted-foreground">
            {monthSchedules.length} {monthSchedules.length === 1 ? 'unidade' : 'unidades'} nesta escala
          </p>
        </div>
      </div>

      {monthSchedules.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
          <CalendarDays className="h-8 w-8 opacity-30" />
          <p className="text-sm">Nenhuma unidade com escala neste mês.</p>
          {canCreate && (
            <Button onClick={() => setCreateOpen(true)} className="mt-2" disabled={!createDependenciesReady}>
              <Plus className="mr-2 h-4 w-4" />
              Criar escala
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col md:flex-row gap-4 md:gap-6">
          {/* Sidebar: units for this month */}
          <aside className="md:w-56 shrink-0">
            <div className="flex items-center justify-between mb-2 px-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Unidades</p>
              {canCreate && (
                <button
                  onClick={() => setCreateOpen(true)}
                  disabled={!createDependenciesReady}
                  className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
                  aria-label="Adicionar unidade a este mês"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible pb-1 md:pb-0">
              {monthSchedules.map(s => {
                const unitName = s.unitId ? (units.find(u => u.id === s.unitId)?.name ?? s.unitId) : 'Todas as unidades';
                const isSelected = selectedSchedule?.id === s.id;
                const isArchived = units.find(u => u.id === s.unitId)?.isArchived === true;
                return (
                  <div
                    key={s.id}
                    className={cn(
                      'group flex shrink-0 md:shrink cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors',
                      isSelected ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted/60',
                    )}
                    onClick={() => selectSchedule(s.id)}
                  >
                    <span className="flex-1 min-w-0 truncate">{unitName}</span>
                    {s.locked && <Lock className="h-3 w-3 shrink-0 text-muted-foreground/60" />}
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">{s.shiftCount}</Badge>
                    {canDelete && !isArchived && (
                      <button
                        onClick={e => { e.stopPropagation(); setDeleteTarget(s); }}
                        className="h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors hidden group-hover:flex"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </aside>

          {/* Selected unit's schedule, rendered exactly as the standard editor */}
          <div className="flex-1 min-w-0">
            {selectedSchedule && <DPScheduleEditor schedule={selectedSchedule} />}
          </div>
        </div>
      )}

      <CreateScheduleDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultMonth={month}
        defaultYear={year}
        lockPeriod
        excludeUnitIds={existingUnitIds}
        calendars={calendars}
        units={activeUnits}
        schedules={accessibleSchedules}
        onCreated={(id) => selectSchedule(id)}
      />

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
