"use client";

import React, { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useDP } from '@/components/dp-context';
import { useAuth } from '@/hooks/use-auth';
import { useAccessibleDPSchedules } from '@/hooks/use-accessible-dp-schedules';
import {
  activeOperationalUnits,
  canonicalOperationalUnitId,
} from '@/lib/dp-units';
import { formatDPSchedulePeriod } from '@/lib/dp-schedule-periods';
import { resolveDPUnitCity, UNDEFINED_DP_UNIT_CITY } from '@/lib/dp-unit-city';
import { filterUnitsByAccess } from '@/lib/unit-access';
import type { DPSchedule, DPUnit } from '@/types';

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
import { CalendarDays, ChevronLeft, ChevronRight, Lock, Trash2 } from 'lucide-react';
import { BackButton } from '@/components/navigation/back-button';
import { useToast } from '@/hooks/use-toast';
import { CreateScheduleDialog } from '@/components/dp/dp-schedules-list';
import { DPScheduleEditor } from '@/components/dp/dp-schedule-editor';
import { cn } from '@/lib/utils';

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

function adjacentPeriod(year: number, month: number, offset: number) {
  const date = new Date(year, month - 1 + offset, 1);
  return formatDPSchedulePeriod(date.getFullYear(), date.getMonth() + 1);
}

export function DPScheduleMonthView({ year, month }: { year: number; month: number }) {
  const {
    schedules,
    schedulesLoading,
    schedulesError,
    units,
    unitsLoading,
    unitsError,
    unitGroups,
    calendars,
    calendarsLoading,
    calendarsError,
    deleteSchedule,
  } = useDP();
  const { permissions, user, isDefaultAdmin } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const accessibleSchedules = useAccessibleDPSchedules();

  const [createOpen, setCreateOpen] = useState(false);
  const [createUnitId, setCreateUnitId] = useState<string>();
  const [deleteTarget, setDeleteTarget] = useState<DPSchedule | null>(null);
  const [deleting, setDeleting] = useState(false);

  const canCreate = permissions.dp?.schedules?.create ?? false;
  const canDelete = permissions.dp?.schedules?.delete ?? false;
  const createDependenciesReady =
    !schedulesLoading &&
    !schedulesError &&
    !unitsLoading &&
    !unitsError &&
    !calendarsLoading &&
    !calendarsError;

  const accessibleActiveUnits = useMemo(() => {
    if (!user) return [];
    return filterUnitsByAccess(activeOperationalUnits(units), user, { isDefaultAdmin });
  }, [isDefaultAdmin, units, user]);

  const monthSchedules = useMemo(() => (
    accessibleSchedules.filter((schedule) => schedule.year === year && schedule.month === month)
  ), [accessibleSchedules, month, year]);

  const unitRows = useMemo(() => {
    const calendarById = new Map(calendars.map((calendar) => [calendar.id, calendar]));
    const groupById = new Map(unitGroups.map((group) => [group.id, group]));
    const latestCalendarCityByCanonicalUnit = new Map<string, string>();
    const schedulesNewestFirst = [...accessibleSchedules].sort((a, b) => (
      (b.year - a.year) || (b.month - a.month)
    ));
    for (const schedule of schedulesNewestFirst) {
      if (!schedule.unitId || !schedule.calendarId) continue;
      const canonicalId = canonicalOperationalUnitId(schedule.unitId, units) ?? schedule.unitId;
      const city = calendarById.get(schedule.calendarId)?.city?.trim();
      if (city && !latestCalendarCityByCanonicalUnit.has(canonicalId)) {
        latestCalendarCityByCanonicalUnit.set(canonicalId, city);
      }
    }

    const scheduleByCanonicalUnit = new Map<string, DPSchedule>();
    for (const schedule of monthSchedules) {
      if (!schedule.unitId) continue;
      const canonicalId = canonicalOperationalUnitId(schedule.unitId, units) ?? schedule.unitId;
      if (!scheduleByCanonicalUnit.has(canonicalId)) scheduleByCanonicalUnit.set(canonicalId, schedule);
    }

    const rows: Array<{
      key: string;
      city: string;
      unit: DPUnit | undefined;
      schedule: DPSchedule | undefined;
    }> = accessibleActiveUnits.map((unit) => {
      const canonicalId = canonicalOperationalUnitId(unit.id, units) ?? unit.id;
      const schedule = scheduleByCanonicalUnit.get(canonicalId);
      return {
        key: `unit:${unit.id}`,
        city: resolveDPUnitCity({
          calendarCity: schedule?.calendarId
            ? calendarById.get(schedule.calendarId)?.city
            : latestCalendarCityByCanonicalUnit.get(canonicalId),
          address: unit.address,
          groupName: unit.groupId ? groupById.get(unit.groupId)?.name : undefined,
        }),
        unit,
        schedule,
      };
    });
    const representedScheduleIds = new Set(
      rows.map((row) => row.schedule?.id).filter((id): id is string => !!id),
    );

    for (const schedule of monthSchedules) {
      if (representedScheduleIds.has(schedule.id)) continue;
      const scheduleUnit = units.find((unit) => unit.id === schedule.unitId);
      rows.push({
        key: `schedule:${schedule.id}`,
        city: resolveDPUnitCity({
          calendarCity: schedule.calendarId ? calendarById.get(schedule.calendarId)?.city : undefined,
          address: scheduleUnit?.address,
          groupName: scheduleUnit?.groupId ? groupById.get(scheduleUnit.groupId)?.name : undefined,
        }),
        unit: scheduleUnit,
        schedule,
      });
    }

    return rows;
  }, [accessibleActiveUnits, accessibleSchedules, calendars, monthSchedules, unitGroups, units]);

  const unitRowsByCity = useMemo(() => {
    const byCity = new Map<string, typeof unitRows>();
    for (const row of unitRows) {
      if (!byCity.has(row.city)) byCity.set(row.city, []);
      byCity.get(row.city)!.push(row);
    }
    return Array.from(byCity.entries())
      .map(([city, rows]) => ({ city, rows }))
      .sort((a, b) => {
        if (a.city === UNDEFINED_DP_UNIT_CITY) return 1;
        if (b.city === UNDEFINED_DP_UNIT_CITY) return -1;
        return a.city.localeCompare(b.city, 'pt-BR');
      });
  }, [unitRows]);

  const selectedId = searchParams.get('schedule');
  const createRequested = searchParams.get('create') === '1';
  const selectedSchedule = useMemo(() => {
    if (selectedId) {
      const found = monthSchedules.find((schedule) => schedule.id === selectedId);
      if (found) return found;
    }
    return monthSchedules[0] ?? null;
  }, [monthSchedules, selectedId]);

  const currentPeriod = formatDPSchedulePeriod(year, month);

  function selectSchedule(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('create');
    params.set('schedule', id);
    router.replace(`/dashboard/dp/schedules/month/${currentPeriod}?${params.toString()}`, { scroll: false });
  }

  function openCreate(unitId?: string) {
    setCreateUnitId(unitId);
    setCreateOpen(true);
  }

  function handleCreateOpenChange(open: boolean) {
    setCreateOpen(open);
    if (open || !createRequested) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete('create');
    const query = params.toString();
    router.replace(
      `/dashboard/dp/schedules/month/${currentPeriod}${query ? `?${query}` : ''}`,
      { scroll: false },
    );
  }

  const existingUnitIds = useMemo(
    () => monthSchedules.map((schedule) => schedule.unitId).filter((id): id is string => !!id),
    [monthSchedules],
  );
  const startedActiveUnitCount = useMemo(() => {
    const startedCanonicalIds = new Set(existingUnitIds.map((unitId) => (
      canonicalOperationalUnitId(unitId, units) ?? unitId
    )));
    return accessibleActiveUnits.filter((unit) => (
      startedCanonicalIds.has(canonicalOperationalUnitId(unit.id, units) ?? unit.id)
    )).length;
  }, [accessibleActiveUnits, existingUnitIds, units]);

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
        const nextSchedule = monthSchedules.find((schedule) => schedule.id !== deleteTarget.id);
        if (nextSchedule) {
          selectSchedule(nextSchedule.id);
        } else {
          router.replace(`/dashboard/dp/schedules/month/${currentPeriod}`, { scroll: false });
        }
      }
    } catch {
      toast({ title: 'Erro ao excluir escala.', variant: 'destructive' });
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  if ((schedulesLoading && schedules.length === 0) || (unitsLoading && units.length === 0)) {
    return <p className="p-6 text-sm text-muted-foreground">Carregando escalas do mês...</p>;
  }

  if ((schedulesError && schedules.length === 0) || (unitsError && units.length === 0)) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
        <p className="font-medium text-destructive">Não foi possível carregar as escalas deste mês.</p>
        <p className="mt-1 text-muted-foreground">{schedulesError ?? unitsError}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <BackButton fallbackHref="/dashboard/dp/schedules" ariaLabel="Voltar à lista de meses" iconOnly variant="ghost" size="icon" iconClassName="h-4 w-4" />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold">{MONTHS[month - 1]} de {year}</h1>
          <p className="text-sm text-muted-foreground">
            {accessibleActiveUnits.length} {accessibleActiveUnits.length === 1 ? 'unidade' : 'unidades'} · {startedActiveUnitCount} {startedActiveUnitCount === 1 ? 'escala iniciada' : 'escalas iniciadas'}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Mês anterior"
            onClick={() => router.push(`/dashboard/dp/schedules/month/${adjacentPeriod(year, month, -1)}`)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Próximo mês"
            onClick={() => router.push(`/dashboard/dp/schedules/month/${adjacentPeriod(year, month, 1)}`)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {(schedulesError || unitsError || calendarsError) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-2.5 text-xs text-amber-900">
          Alguns dados não carregaram. A criação de escalas está bloqueada para evitar duplicidades.
        </div>
      )}

      <div className="flex flex-col gap-4 md:flex-row md:gap-6">
        <aside className="shrink-0 md:w-64">
          <div className="mb-2 px-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Unidades</p>
          </div>

          {unitRows.length === 0 ? (
            <div className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
              Nenhuma unidade disponível para este usuário.
            </div>
          ) : (
            <div className="space-y-4">
              {unitRowsByCity.map(({ city, rows }) => (
                <section key={city}>
                  <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                    {city}
                  </p>
                  <div className="flex gap-1 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0">
                    {rows.map(({ key, unit, schedule }) => {
                      const unitName = unit?.name ?? schedule?.unitId ?? 'Todas as unidades';
                      const isSelected = !!schedule && selectedSchedule?.id === schedule.id;
                      const isArchived = unit?.isArchived === true;
                      return (
                        <div
                          key={key}
                          className={cn(
                            'group flex shrink-0 items-center gap-2 rounded-lg border border-transparent px-2.5 py-2 text-sm transition-colors md:shrink',
                            (schedule || (canCreate && createDependenciesReady)) && 'cursor-pointer',
                            isSelected ? 'border-primary/20 bg-primary/10 font-medium text-primary' : 'hover:bg-muted/60',
                          )}
                          onClick={() => {
                            if (schedule) {
                              selectSchedule(schedule.id);
                            } else if (canCreate && createDependenciesReady) {
                              openCreate(unit?.id);
                            }
                          }}
                        >
                          <span className="min-w-0 flex-1 truncate">{unitName}</span>
                          {schedule && (
                            <>
                              {schedule.locked && <Lock className="h-3 w-3 shrink-0 text-muted-foreground/60" />}
                              <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">{schedule.shiftCount}</Badge>
                              {canDelete && !isArchived && (
                                <button
                                  type="button"
                                  aria-label={`Excluir escala de ${unitName}`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setDeleteTarget(schedule);
                                  }}
                                  className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive group-hover:flex"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </aside>

        <div className="min-w-0 flex-1">
          {selectedSchedule ? (
            <DPScheduleEditor key={selectedSchedule.id} schedule={selectedSchedule} embedded />
          ) : (
            <div className="flex min-h-72 flex-col items-center justify-center gap-3 rounded-xl border border-dashed text-muted-foreground">
              <CalendarDays className="h-8 w-8 opacity-30" />
              <div className="text-center">
                <p className="text-sm font-medium text-foreground">Este mês ainda não foi iniciado.</p>
                <p className="mt-1 text-xs">Selecione uma unidade na lista ao lado para iniciar sua escala.</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <CreateScheduleDialog
        open={canCreate && (createOpen || createRequested)}
        onOpenChange={handleCreateOpenChange}
        defaultUnitId={createUnitId}
        defaultMonth={month}
        defaultYear={year}
        lockPeriod
        excludeUnitIds={existingUnitIds}
        calendars={calendars}
        units={accessibleActiveUnits}
        schedules={accessibleSchedules}
        onCreated={(id) => selectSchedule(id)}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
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
