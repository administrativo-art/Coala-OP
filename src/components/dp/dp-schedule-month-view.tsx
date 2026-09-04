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
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { CreateScheduleDialog } from '@/components/dp/dp-schedules-list';
import { DPScheduleEditor } from '@/components/dp/dp-schedule-editor';
import { DPSchedulesSidebar } from '@/components/dp/dp-schedules-sidebar';
import { countExpectedDPUnitDays } from '@/lib/dp-schedule-progress';
import { useDPScheduleFilledDays } from '@/hooks/use-dp-schedule-filled-days';

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const UNDEFINED_DP_UNIT_STATE = 'Sem estado definido';

const BRAZILIAN_STATE_NAMES: Record<string, string> = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará',
  DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso',
  MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná',
  PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte',
  RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina',
  SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
};

function stateCodeOf(state: string) {
  if (state === UNDEFINED_DP_UNIT_STATE) return '—';
  const upper = state.toUpperCase();
  if (BRAZILIAN_STATE_NAMES[upper]) return upper;
  return Object.entries(BRAZILIAN_STATE_NAMES)
    .find(([, name]) => normalize(name) === normalize(state))?.[0] ?? upper.slice(0, 2);
}

function adjacentPeriod(year: number, month: number, offset: number) {
  const date = new Date(year, month - 1 + offset, 1);
  return formatDPSchedulePeriod(date.getFullYear(), date.getMonth() + 1);
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

type UnitRow = {
  key: string;
  city: string;
  state: string;
  unit: DPUnit | undefined;
  schedule: DPSchedule | undefined;
};

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
    shiftDefinitions,
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
  const [unitQuery, setUnitQuery] = useState('');

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
  const filledDaysByScheduleId = useDPScheduleFilledDays(monthSchedules);

  const unitRows = useMemo<UnitRow[]>(() => {
    const calendarById = new Map(calendars.map((calendar) => [calendar.id, calendar]));
    const groupById = new Map(unitGroups.map((group) => [group.id, group]));
    const latestCalendarCityByCanonicalUnit = new Map<string, string>();
    const latestCalendarStateByCanonicalUnit = new Map<string, string>();
    const schedulesNewestFirst = [...accessibleSchedules].sort((a, b) => (
      (b.year - a.year) || (b.month - a.month)
    ));
    for (const schedule of schedulesNewestFirst) {
      if (!schedule.unitId || !schedule.calendarId) continue;
      const canonicalId = canonicalOperationalUnitId(schedule.unitId, units) ?? schedule.unitId;
      const calendar = calendarById.get(schedule.calendarId);
      const city = calendar?.city?.trim();
      const state = calendar?.state?.trim();
      if (city && !latestCalendarCityByCanonicalUnit.has(canonicalId)) {
        latestCalendarCityByCanonicalUnit.set(canonicalId, city);
      }
      if (state && !latestCalendarStateByCanonicalUnit.has(canonicalId)) {
        latestCalendarStateByCanonicalUnit.set(canonicalId, state);
      }
    }

    const scheduleByCanonicalUnit = new Map<string, DPSchedule>();
    for (const schedule of monthSchedules) {
      if (!schedule.unitId) continue;
      const canonicalId = canonicalOperationalUnitId(schedule.unitId, units) ?? schedule.unitId;
      if (!scheduleByCanonicalUnit.has(canonicalId)) scheduleByCanonicalUnit.set(canonicalId, schedule);
    }

    const rows: UnitRow[] = accessibleActiveUnits.map((unit) => {
      const canonicalId = canonicalOperationalUnitId(unit.id, units) ?? unit.id;
      const schedule = scheduleByCanonicalUnit.get(canonicalId);
      const scheduleCalendar = schedule?.calendarId ? calendarById.get(schedule.calendarId) : undefined;
      const calendarState = scheduleCalendar?.state?.trim() || latestCalendarStateByCanonicalUnit.get(canonicalId);
      const calendarCity = scheduleCalendar?.city?.trim() || latestCalendarCityByCanonicalUnit.get(canonicalId);
      return {
        key: `unit:${unit.id}`,
        city: resolveDPUnitCity({
          calendarCity,
          address: unit.address,
          groupName: unit.groupId ? groupById.get(unit.groupId)?.name : undefined,
        }),
        state: calendarState || UNDEFINED_DP_UNIT_STATE,
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
        state: (schedule.calendarId ? calendarById.get(schedule.calendarId)?.state?.trim() : undefined) || UNDEFINED_DP_UNIT_STATE,
        unit: scheduleUnit,
        schedule,
      });
    }

    return rows;
  }, [accessibleActiveUnits, accessibleSchedules, calendars, monthSchedules, unitGroups, units]);

  const filteredUnitRows = useMemo(() => {
    const q = normalize(unitQuery.trim());
    if (!q) return unitRows;
    return unitRows.filter((row) => {
      const name = row.unit?.name ?? row.schedule?.unitId ?? '';
      return normalize(name).includes(q)
        || normalize(row.city).includes(q)
        || normalize(row.state).includes(q);
    });
  }, [unitQuery, unitRows]);

  const groupedByState = useMemo(() => {
    const byState = new Map<string, Map<string, UnitRow[]>>();
    for (const row of filteredUnitRows) {
      if (!byState.has(row.state)) byState.set(row.state, new Map());
      const byCity = byState.get(row.state)!;
      if (!byCity.has(row.city)) byCity.set(row.city, []);
      byCity.get(row.city)!.push(row);
    }
    const sortLabels = (a: string, b: string, undefinedLabel: string) => {
      if (a === undefinedLabel) return 1;
      if (b === undefinedLabel) return -1;
      return a.localeCompare(b, 'pt-BR');
    };
    return Array.from(byState.entries())
      .map(([state, byCity]) => ({
        state,
        unitCount: Array.from(byCity.values()).reduce((sum, rows) => sum + rows.length, 0),
        cities: Array.from(byCity.entries())
          .map(([city, rows]) => ({
            city,
            rows: [...rows].sort((a, b) => (
              (a.unit?.name ?? '').localeCompare(b.unit?.name ?? '', 'pt-BR')
            )),
          }))
          .sort((a, b) => sortLabels(a.city, b.city, UNDEFINED_DP_UNIT_CITY)),
      }))
      .sort((a, b) => sortLabels(a.state, b.state, UNDEFINED_DP_UNIT_STATE));
  }, [filteredUnitRows]);

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
    <div
      className="dp-schedules-redesign flex flex-col gap-[6px] bg-[#eef1f6] lg:h-[calc(100vh-7.25rem)] lg:min-h-[680px] lg:flex-row"
      style={{ fontFamily: "'Inter Tight Variable', 'Inter Tight', Inter, system-ui, sans-serif" }}
    >
      <DPSchedulesSidebar
        query={unitQuery}
        onQueryChange={setUnitQuery}
        onBack={() => router.push('/dashboard/dp/schedules')}
        startedCount={startedActiveUnitCount}
        totalCount={accessibleActiveUnits.length}
        emptyLabel={unitQuery ? 'Nenhuma unidade encontrada.' : 'Nenhuma unidade disponível.'}
        groups={groupedByState.map(({ state, unitCount, cities }) => {
          const stateCode = stateCodeOf(state);
          return {
            state: state === UNDEFINED_DP_UNIT_STATE ? state : BRAZILIAN_STATE_NAMES[stateCode] ?? state,
            stateCode,
            unitCount,
            cities: cities.map(({ city, rows }) => ({
              city,
              units: rows.map(({ key, unit, schedule }) => {
                const isArchived = unit?.isArchived === true;
                const interactive = !!schedule || (canCreate && createDependenciesReady);
                return {
                  key,
                  name: unit?.name ?? schedule?.unitId ?? 'Todas as unidades',
                  locked: schedule?.locked,
                  selected: !!schedule && selectedSchedule?.id === schedule.id,
                  disabled: !interactive,
                  filledDays: schedule ? filledDaysByScheduleId[schedule.id] ?? 0 : 0,
                  expectedDays: unit ? countExpectedDPUnitDays({ unit, year, month, shiftDefinitions }) : null,
                  onClick: interactive ? () => {
                    if (schedule) selectSchedule(schedule.id);
                    else if (canCreate && createDependenciesReady) openCreate(unit?.id);
                  } : undefined,
                  onDelete: canDelete && !isArchived && schedule ? () => setDeleteTarget(schedule) : undefined,
                };
              }),
            })),
          };
        })}
      />

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[12px] border border-[#e6e4e0] bg-white">
        {!selectedSchedule && <div className="flex flex-wrap items-center gap-3 border-b border-[#eef1f6] px-[22px] py-[14px]">
          <button
            type="button"
            onClick={() => router.push('/dashboard/dp/schedules')}
            aria-label="Voltar para todos os meses"
            className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] border border-[#e6ebf2] text-[#64748b] outline-none hover:bg-[#f8fafc] focus-visible:ring-2 focus-visible:ring-[#db2777]"
          >
            <ChevronLeft className="h-[15px] w-[15px]" strokeWidth={2.4} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="dp-schedule-month-title text-[19px] font-black leading-6 tracking-[-0.02em] text-[#0f172a]">{MONTHS[month - 1]} de {year}</h1>
            <p className="mt-0.5 text-[12.5px] font-semibold text-[#64748b]">
              {accessibleActiveUnits.length} {accessibleActiveUnits.length === 1 ? 'unidade' : 'unidades'} · {startedActiveUnitCount} {startedActiveUnitCount === 1 ? 'escala iniciada' : 'escalas iniciadas'}
            </p>
          </div>
          <div className="flex items-center overflow-hidden rounded-lg border">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Mês anterior"
              className="h-8 w-8 rounded-none border-r"
              onClick={() => router.push(`/dashboard/dp/schedules/month/${adjacentPeriod(year, month, -1)}`)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Próximo mês"
              className="h-8 w-8 rounded-none"
              onClick={() => router.push(`/dashboard/dp/schedules/month/${adjacentPeriod(year, month, 1)}`)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>}

        {(schedulesError || unitsError || calendarsError) && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-2.5 text-xs text-amber-900">
            Alguns dados não carregaram. A criação de escalas está bloqueada para evitar duplicidades.
          </div>
        )}

        <div className="min-w-0 flex-1 lg:overflow-y-auto">
          {selectedSchedule ? (
            <DPScheduleEditor
              key={selectedSchedule.id}
              schedule={selectedSchedule}
              embedded
              onBack={() => router.push('/dashboard/dp/schedules')}
              onPreviousMonth={() => router.push(`/dashboard/dp/schedules/month/${adjacentPeriod(year, month, -1)}`)}
              onNextMonth={() => router.push(`/dashboard/dp/schedules/month/${adjacentPeriod(year, month, 1)}`)}
            />
          ) : (
            <div className="flex min-h-72 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed text-muted-foreground">
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
