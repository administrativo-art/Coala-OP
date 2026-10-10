"use client";

import { Fragment, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  ChevronDown,
  Download,
  ChevronUp,
  RotateCcw,
  XCircle,
} from 'lucide-react';

import { useGoals } from '@/contexts/goals-context';
import { useKiosks } from '@/hooks/use-kiosks';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { CloseGoalModal } from '@/components/close-goal-modal';
import { EmployeeDailyModal } from '@/components/goals-tracking-dashboard';
import { LiftRow } from '@/components/patterns/lift-row';
import { SidePanel, PanelField } from '@/components/patterns/side-panel';
import { StatusPill } from '@/components/ui/status-pill';
import { EmptyBox, attainmentTone, fmtBRL, kickerClass } from '@/components/goals/goals-ui';
import { buildEmployeeEarnings, getPeriodBonus, summarizePrizes } from '@/lib/goals-earnings';
import { useKioskGroups } from '@/hooks/use-kiosk-groups';
import { buildEarningsCsv, type EarningsCsvEntry } from '@/lib/goals-earnings-csv';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { type GoalPeriodDoc, type EmployeeGoal } from '@/types';
import { type GoalDistributionSnapshot } from '@/lib/goals-distribution';
import { getUserDisplayName } from '@/lib/user-display';
import {
  getGoalAttainment,
  getGoalDistributionModeLabel,
  getGoalPeriodResolvedDailyTarget,
  getGoalPeriodResolvedMode,
} from '@/lib/goals-history';

function fmt(value: number) {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(value: number) {
  return `${value.toFixed(1)}%`;
}

function toMonthKey(ts: unknown): string {
  if (!ts || typeof ts !== 'object' || !('toDate' in (ts as Record<string, unknown>))) return '0000-00';
  try {
    return format((ts as { toDate: () => Date }).toDate(), 'yyyy-MM');
  } catch {
    return '0000-00';
  }
}

function toMonthLabel(key: string): string {
  const [year, month] = key.split('-');
  if (!year || !month) return key;
  try {
    const d = new Date(Number(year), Number(month) - 1, 1);
    return format(d, 'MMMM yyyy', { locale: ptBR });
  } catch {
    return key;
  }
}

const statusLabels: Record<string, string> = {
  closed: 'Encerrada',
  cancelled: 'Cancelada',
  active: 'Ativa',
};

function PeriodCard({
  period,
  kioskName,
  employeeGoals,
  getUserName,
  isManager,
  reopening,
  onReopen,
  onClose,
}: {
  period: GoalPeriodDoc;
  kioskName: string;
  employeeGoals: EmployeeGoal[];
  getUserName: (id: string) => string;
  isManager: boolean;
  reopening: string | null;
  onReopen: (id: string) => void;
  onClose: (period: GoalPeriodDoc) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [modalData, setModalData] = useState<{
    eg: EmployeeGoal;
    originalEgs: EmployeeGoal[];
    userName: string;
    snapshot: GoalDistributionSnapshot | null;
  } | null>(null);

  const attainment = getGoalAttainment(period);
  const resolvedMode = getGoalPeriodResolvedMode(period);
  const resolvedDailyTarget = getGoalPeriodResolvedDailyTarget(period);
  const goalEmployees = employeeGoals.filter(g => g.periodId === period.id);
  const collaboratorCount = new Set(goalEmployees.map(g => g.employeeId)).size;

  // Distribution snapshot from closure snapshot (for scheduled_days mode)
  const distributionSnapshot: GoalDistributionSnapshot | null = useMemo(() => {
    const cs = period.closureSnapshot;
    if (!cs) return null;
    return {
      periodDateKeysById: { [period.id]: cs.periodDateKeys ?? [] },
      employeeDateKeysByGoalId: cs.employeeDateKeysByGoalId ?? {},
      goalIdsByPeriodShiftAndDate: {},
      workedDaysByKioskAndUser: {},
      shiftLabelByKioskUserAndDate: {},
    };
  }, [period.closureSnapshot, period.id]);

  // Merge multi-shift goals per employee
  const mergedEmployees = useMemo(() => {
    const byEmp = new Map<string, EmployeeGoal[]>();
    for (const eg of goalEmployees) {
      const arr = byEmp.get(eg.employeeId) ?? [];
      arr.push(eg);
      byEmp.set(eg.employeeId, arr);
    }
    return Array.from(byEmp.entries()).map(([empId, goals]) => {
      const dp: Record<string, number> = {};
      for (const g of goals) {
        for (const [k, v] of Object.entries(g.dailyProgress ?? {})) {
          dp[k] = (dp[k] ?? 0) + v;
        }
      }
      const currentValue = goals.reduce((s, g) => s + g.currentValue, 0);
      const targetValue = goals.reduce((s, g) => s + g.targetValue, 0);
      const dpVals = Object.values(dp).filter(v => v > 0);
      const daysWithSales = dpVals.length;
      const avgPace = daysWithSales > 0 ? currentValue / daysWithSales : 0;
      const mergedGoal: EmployeeGoal = { ...goals[0], currentValue, targetValue, dailyProgress: dp, shiftId: undefined };
      return { empId, goals, mergedGoal, currentValue, targetValue, daysWithSales, avgPace };
    }).sort((a, b) => b.currentValue - a.currentValue);
  }, [goalEmployees]);

  // Kiosk-level stats from merged employees
  const { kioskDaysWithSales, kioskAvgPace, kioskBestDay, kioskBestDayDate } = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const { mergedGoal } of mergedEmployees) {
      for (const [k, v] of Object.entries(mergedGoal.dailyProgress ?? {})) {
        if (v > 0) totals[k] = (totals[k] ?? 0) + v;
      }
    }
    const days = Object.keys(totals).length;
    const avg = days > 0 ? period.currentValue / days : 0;
    const vals = Object.values(totals);
    const best = vals.length > 0 ? Math.max(...vals) : 0;
    const bestDate = vals.length > 0
      ? Object.entries(totals).sort(([, a], [, b]) => b - a)[0]?.[0] ?? null
      : null;
    return { kioskDaysWithSales: days, kioskAvgPace: avg, kioskBestDay: best, kioskBestDayDate: bestDate };
  }, [mergedEmployees, period.currentValue]);

  function formatDateKey(key: string): string {
    try {
      const [y, m, d] = key.split('_').map(Number);
      if (y && m && d) return format(new Date(y, m - 1, d), 'dd/MM', { locale: ptBR });
      // fallback for YYYY-MM-DD format
      const parts = key.split('-').map(Number);
      if (parts.length === 3) return format(new Date(parts[0], parts[1] - 1, parts[2]), 'dd/MM', { locale: ptBR });
    } catch { /* */ }
    return key;
  }

  const periodBonus = getPeriodBonus(period, employeeGoals);
  const bonus = periodBonus?.bonus;
  const bonusCalculated = periodBonus?.calculated ?? false;
  const isTieredClosed = period.status === 'closed' && period.goalMethodSnapshot?.type === 'tiered_unit_bonus';
  const prizeByEmployee = new Map((bonus?.participants ?? []).map(item => [item.employeeId, item]));
  const roleLabels: Record<string, string> = { fixed: 'Colaborador', relief: 'Folguista', leader: 'Liderança' };

  const statusVariant = period.status === 'closed' ? 'ok' : period.status === 'cancelled' ? 'danger' : 'info';
  const closedAt = period.closedAt && typeof (period.closedAt as { toDate?: unknown }).toDate === 'function'
    ? format((period.closedAt as { toDate: () => Date }).toDate(), 'dd/MM/yyyy', { locale: ptBR })
    : '—';

  return (
    <>
      <LiftRow selected={expanded} onClick={() => setExpanded(true)} aria-label={`Abrir fechamento de ${kioskName}`}>
        <div className="grid grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))] items-center gap-3 md:grid-cols-[minmax(0,1.8fr)_repeat(4,minmax(0,1fr))_24px]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-[14.5px] font-extrabold text-ds-ink">{kioskName}</span>
              <StatusPill variant={statusVariant}>{statusLabels[period.status] ?? period.status}</StatusPill>
            </div>
            <p className="mt-0.5 text-[12px] font-semibold text-ds-ink-muted">
              {collaboratorCount} colaborador(es) · {getGoalDistributionModeLabel(resolvedMode)}
            </p>
          </div>
          <div className="hidden md:block">
            <p className={cn(kickerClass, 'text-ds-ink-faint')}>Meta alvo</p>
            <p className="text-[13px] font-bold text-ds-ink-2">R$ {fmt(period.targetValue)}</p>
          </div>
          <div>
            <p className={cn(kickerClass, 'text-ds-ink-faint')}>Realizado</p>
            <p className="text-[13px] font-bold text-ds-ink">R$ {fmt(period.currentValue)}</p>
          </div>
          <div>
            <p className={cn(kickerClass, 'text-ds-ink-faint')}>% meta</p>
            <p className={cn('text-[14px] font-extrabold', attainmentTone(attainment))}>{fmtPct(attainment)}</p>
          </div>
          <div>
            <p className={cn(kickerClass, 'text-ds-ink-faint')}>Premiação</p>
            {isTieredClosed ? (
              bonus
                ? <p className="text-[13px] font-extrabold text-ds-ok">R$ {fmt(bonus.totalPrize)}{bonusCalculated && <span className="ml-1 text-[10.5px] font-bold text-ds-warn" title="Calculada pela regra do método; não havia apuração gravada">calc.</span>}</p>
                : <StatusPill variant="warn">Sem apuração</StatusPill>
            ) : <p className="text-[13px] font-semibold text-ds-ink-faint">—</p>}
          </div>
          <span aria-hidden="true" className="hidden text-[18px] font-bold text-ds-ink-faint md:block">›</span>
        </div>
      </LiftRow>

      <SidePanel
        open={expanded}
        onOpenChange={setExpanded}
        kicker={`${statusLabels[period.status] ?? period.status} · ${getGoalDistributionModeLabel(resolvedMode)}`}
        title={kioskName}
        subtitle={`${collaboratorCount} colaborador(es) · fechamento em ${closedAt}`}
        highlights={(
          <>
            <span>R$ {fmt(period.currentValue)}<span className="ml-1 text-[11px] font-bold text-ds-on-dark-sub">realizado</span></span>
            <span>{fmtPct(attainment)}<span className="ml-1 text-[11px] font-bold text-ds-on-dark-sub">da meta</span></span>
          </>
        )}
      >
        <div className="grid grid-cols-2 gap-4">
          <PanelField label="Meta alvo">R$ {fmt(period.targetValue)}</PanelField>
          <PanelField label="Meta UP">R$ {fmt(period.upValue ?? 0)}</PanelField>
          {period.topValue ? <PanelField label="Meta TOP">R$ {fmt(period.topValue)}</PanelField> : null}
          <PanelField label="Meta diária registrada">R$ {fmt(resolvedDailyTarget)}</PanelField>
        </div>

        {period.shifts && period.shifts.length > 0 && (
          <div>
            <p className={cn(kickerClass, 'text-ds-ink-faint')}>Turnos</p>
            <ul className="mt-2 space-y-1">
              {period.shifts.map(shift => (
                <li key={shift.id} className="flex items-center justify-between rounded-ds-md border border-ds-border bg-ds-surface px-3 py-2 text-[13px]">
                  <span className="font-bold text-ds-ink">{shift.label} <span className="font-semibold text-ds-ink-muted">· {(shift.fraction * 100).toFixed(0)}%</span></span>
                  <span className="font-semibold text-ds-ink-2">R$ {fmt(period.targetValue * shift.fraction)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {isTieredClosed && (
          <div>
            <p className={cn(kickerClass, 'text-ds-ink-faint')}>{bonusCalculated ? 'Premiação calculada pela regra' : 'Premiação apurada no encerramento'}</p>
            {bonusCalculated && (
              <p className="mt-2 rounded-ds-md border border-ds-alert-border bg-ds-alert-bg p-3 text-[12.5px] font-semibold text-ds-alert-ink">
                Este período foi encerrado antes da gravação da premiação. O valor abaixo foi calculado agora pela regra do método com a escala e o faturamento registrados; ele não está gravado no fechamento.
              </p>
            )}
            {bonus ? (
              <div className="mt-2 space-y-3 rounded-ds-card border border-ds-border bg-ds-surface p-4">
                <div className="grid grid-cols-2 gap-3">
                  <PanelField label="Faixa atingida">{bonus.highestTierLabel ?? 'Abaixo do alvo'}</PanelField>
                  <PanelField label="Total pago"><span className="font-extrabold text-ds-ok">R$ {fmt(bonus.totalPrize)}</span></PanelField>
                  <PanelField label="Fixo + excedente">R$ {fmt(bonus.fixedTotal)} + R$ {fmt(bonus.variableTotal)}</PanelField>
                  <PanelField label="Equipe · Liderança">R$ {fmt(bonus.totalTeamBonus)} · R$ {fmt(bonus.leadershipBonus)}</PanelField>
                </div>
                {bonus.tiers.length > 0 ? (
                  <ul className="space-y-1 text-[12px] font-semibold text-ds-ink-muted">
                    {bonus.tiers.map(tier => (
                      <li key={tier.tierId} className="flex justify-between gap-3">
                        <span>{tier.label}: R$ {fmt(tier.fixedBonusAmount)} fixo + R$ {fmt(tier.variableBonusAmount)} sobre R$ {fmt(tier.excessAmount)}</span>
                        <span className="font-extrabold text-ds-ink">R$ {fmt(tier.totalBonusAmount)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[12px] font-semibold text-ds-ink-muted">Faturamento abaixo da Meta Alvo: sem premiação (nem o fixo).</p>
                )}
                <ul className="space-y-1 border-t border-ds-divider pt-3 text-[13px]">
                  {bonus.participants.map(item => (
                    <li key={item.employeeId} className="flex justify-between gap-3">
                      <span className="truncate font-bold text-ds-ink">{getUserName(item.employeeId)} <span className="font-semibold text-ds-ink-muted">· {roleLabels[item.role] ?? item.role}</span></span>
                      <span className="font-extrabold text-ds-ok">R$ {fmt(item.bonusAmount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="mt-2 rounded-ds-md border border-ds-alert-border bg-ds-alert-bg p-3 text-[12.5px] font-semibold text-ds-alert-ink">
                Este período foi encerrado antes da gravação da premiação e ainda não foi apurado.
              </p>
            )}
          </div>
        )}

        {mergedEmployees.length > 0 && (
          <div>
            <p className={cn(kickerClass, 'text-ds-ink-faint')}>Colaboradores <span className="normal-case tracking-normal font-semibold">· toque para ver o detalhe por dia</span></p>
            <ul className="mt-2 overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface">
              {mergedEmployees.map(emp => {
                const pct = emp.targetValue > 0 ? (emp.currentValue / emp.targetValue) * 100 : 0;
                const name = getUserName(emp.empId);
                const prize = prizeByEmployee.get(emp.empId);
                return (
                  <li key={emp.empId} className="border-b border-ds-divider last:border-b-0">
                    <button
                      type="button"
                      onClick={() => {
                        setExpanded(false);
                        setModalData({ eg: emp.mergedGoal, originalEgs: emp.goals, userName: name, snapshot: distributionSnapshot });
                      }}
                      className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-2.5 text-left hover:bg-ds-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ds-accent-ink"
                    >
                      <span className="truncate text-[13px] font-extrabold text-ds-ink">{name}</span>
                      <span className="text-right text-[13px] font-extrabold text-ds-ok">{prize ? `R$ ${fmt(prize.bonusAmount)}` : ''}</span>
                      <span className="col-span-2 text-[12px] font-semibold text-ds-ink-muted">
                        R$ {fmt(emp.currentValue)} de R$ {fmt(emp.targetValue)} · <b className={attainmentTone(pct)}>{fmtPct(pct)}</b> · {emp.daysWithSales} dia(s) com venda · média R$ {fmt(emp.avgPace)}/dia
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {kioskDaysWithSales > 0 && (
          <div className="grid grid-cols-3 gap-3">
            <PanelField label="Dias com venda">{kioskDaysWithSales}</PanelField>
            <PanelField label="Média/dia">R$ {fmt(kioskAvgPace)}</PanelField>
            <PanelField label={`Melhor dia ${kioskBestDayDate ? formatDateKey(kioskBestDayDate) : ''}`}><span className="text-ds-ok">R$ {fmt(kioskBestDay)}</span></PanelField>
          </div>
        )}

        {period.closureNote && (
          <div>
            <p className={cn(kickerClass, 'text-ds-ink-faint')}>Nota de fechamento</p>
            <p className="mt-1 text-[13px] font-semibold text-ds-ink-2">{period.closureNote}</p>
          </div>
        )}

        {isManager && (
          <div className="mt-auto flex flex-wrap gap-2 border-t border-ds-divider pt-4">
            {period.status === 'active' && (
              <Button variant="primary-modal" size="md" onClick={() => { setExpanded(false); onClose(period); }}>
                <XCircle aria-hidden="true" className="mr-2 h-4 w-4" />Encerrar meta
              </Button>
            )}
            {(period.status === 'closed' || period.status === 'cancelled') && (
              <Button variant="ds-secondary" size="md" disabled={reopening === period.id} onClick={() => onReopen(period.id)}>
                <RotateCcw aria-hidden="true" className="mr-2 h-4 w-4" />{reopening === period.id ? 'Reabrindo...' : 'Reabrir meta'}
              </Button>
            )}
          </div>
        )}
      </SidePanel>

      {modalData && (
        <EmployeeDailyModal
          open={modalData !== null}
          onOpenChange={(v) => { if (!v) setModalData(null); }}
          employeeGoal={modalData.eg}
          originalEgs={modalData.originalEgs}
          period={period}
          userName={modalData.userName}
          distributionSnapshot={modalData.snapshot}
        />
      )}
    </>
  );
}

export type GoalsHistoryStatus = GoalPeriodDoc['status'];

/** Fechamentos mês a mês. Os filtros de quiosque e status vêm da tela de Análise. */
export function GoalsHistoryView({ kioskId, groupId = null, status }: { kioskId: string | null; groupId?: string | null; status: GoalsHistoryStatus | null }) {
  const { periods, employeeGoals, loading, reopenPeriod } = useGoals();
  const { kiosks } = useKiosks();
  const { permissions, users } = useAuth();
  const { toast } = useToast();

  const filterKiosk = kioskId ?? 'all';
  const { groups: kioskGroups, groupOf } = useKioskGroups();
  const filterStatus = status;
  const [reopening, setReopening] = useState<string | null>(null);
  const [closingPeriod, setClosingPeriod] = useState<GoalPeriodDoc | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set());

  const isManager = (permissions.goals?.manage ?? false) || (permissions.settings?.manageUsers ?? false);
  const getKioskName = (id: string) => kiosks.find(k => k.id === id)?.name ?? id;

  const usersById = useMemo(
    () => Object.fromEntries(users.map(u => [u.id, u])),
    [users]
  );
  const getUserName = (id: string) => getUserDisplayName(usersById[id], id);

  async function handleReopen(periodId: string) {
    setReopening(periodId);
    await reopenPeriod(periodId);
    toast({ title: 'Meta reaberta com sucesso.' });
    setReopening(null);
  }

  function toggleMonth(key: string) {
    setCollapsedMonths(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const grouped = useMemo(() => {
    const sorted = [...periods].sort((a, b) => {
      const aDate = a.startDate?.toDate?.()?.getTime?.() ?? 0;
      const bDate = b.startDate?.toDate?.()?.getTime?.() ?? 0;
      return bDate - aDate;
    });

    const filtered = sorted
      .filter(p => filterKiosk === 'all' || p.kioskId === filterKiosk)
      .filter(p => groupId === null || groupOf(p.kioskId).id === groupId)
      .filter(p => filterStatus === null || p.status === filterStatus);

    const map = new Map<string, GoalPeriodDoc[]>();
    for (const period of filtered) {
      const key = toMonthKey(period.startDate);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(period);
    }

    return [...map.entries()].sort(([a], [b]) => b.localeCompare(a));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periods, filterKiosk, groupId, kioskGroups, filterStatus]);

  /** Folha do mês organizada em grupo → unidade → colaboradores (um colaborador pode aparecer em mais de uma unidade). */
  function payrollSections(monthPeriods: GoalPeriodDoc[]) {
    const closed = monthPeriods.filter(p => p.status === 'closed');
    return kioskGroups
      .map(group => {
        const units = group.kioskIds
          .map(kioskId => ({
            kioskId,
            name: getKioskName(kioskId),
            rows: buildEmployeeEarnings(closed.filter(p => p.kioskId === kioskId), employeeGoals),
          }))
          .filter(unit => unit.rows.length > 0)
          .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
          .map(unit => ({ ...unit, prize: unit.rows.reduce((sum, row) => sum + row.prize, 0) }));
        return { id: group.id, name: group.name, units, prize: units.reduce((sum, unit) => sum + unit.prize, 0) };
      })
      .filter(group => group.units.length > 0);
  }

  function exportMonth(monthKey: string, sections: ReturnType<typeof payrollSections>) {
    const entries: EarningsCsvEntry[] = sections.flatMap(group => group.units.flatMap(unit => unit.rows.map(row => ({ group: group.name, unit: unit.name, row }))));
    const csv = buildEarningsCsv(entries, { user: getUserName });
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `folha-premiacao-${monthKey}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <Skeleton className="h-64 w-full" />;

  return (
    <>
      <div className="space-y-5 font-ds">
        {grouped.length === 0 ? (
          <EmptyBox>Nenhum período encontrado para esses filtros.</EmptyBox>
        ) : (
          <div className="space-y-6">
            {grouped.map(([monthKey, monthPeriods]) => {
              const isCollapsed = collapsedMonths.has(monthKey);
              const monthRevenue = monthPeriods.filter(p => p.status === 'closed').reduce((sum, p) => sum + p.currentValue, 0);
              const monthPrize = summarizePrizes(monthPeriods, employeeGoals);
              const payroll = payrollSections(monthPeriods);
              const payrollPeople = payroll.reduce((sum, group) => sum + group.units.reduce((n, unit) => n + unit.rows.length, 0), 0);
              return (
                <section key={monthKey} aria-label={toMonthLabel(monthKey)}>
                  <button
                    type="button"
                    onClick={() => toggleMonth(monthKey)}
                    aria-expanded={!isCollapsed}
                    className="mb-3 flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-ds-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink"
                  >
                    <span className="text-[19px] font-extrabold capitalize text-ds-ink">{toMonthLabel(monthKey)}</span>
                    <span className="text-[12.5px] font-bold text-ds-ink-muted">{monthPeriods.length} meta(s)</span>
                    {monthRevenue > 0 && <span className="text-[12.5px] font-bold text-ds-ink-muted">Realizado {fmtBRL(monthRevenue)}</span>}
                    {(monthPrize.apuratedCount + monthPrize.calculatedCount) > 0 && <span className="text-[12.5px] font-extrabold text-ds-ok">Premiação {fmtBRL(monthPrize.totalPrize)}</span>}
                    <span className="ml-auto text-ds-ink-faint">{isCollapsed ? <ChevronDown aria-hidden="true" className="h-4 w-4" /> : <ChevronUp aria-hidden="true" className="h-4 w-4" />}</span>
                  </button>

                  {!isCollapsed && (
                    <div className="space-y-3">
                      {payroll.length > 0 && (
                        <div className="overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface">
                          <div className="flex items-center justify-between gap-3 border-b border-ds-divider px-4 py-3">
                            <div>
                              <h3 className="text-[13.5px] font-extrabold text-ds-ink">Folha de premiação do mês</h3>
                              <span className="text-[12px] font-bold text-ds-ink-muted">{payrollPeople} lançamento(s) · por grupo e unidade</span>
                            </div>
                            <Button variant="ds-secondary" size="sm" onClick={() => exportMonth(monthKey, payroll)}>
                              <Download aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />Exportar CSV
                            </Button>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[560px] text-left text-[13px]">
                              <thead>
                                <tr className={cn(kickerClass, 'text-ds-ink-faint')}>
                                  <th className="px-4 py-2.5 font-extrabold">Colaborador</th>
                                  <th className="px-3 py-2.5 text-right font-extrabold">Faturamento</th>
                                  <th className="px-3 py-2.5 text-right font-extrabold">%</th>
                                  <th className="px-4 py-2.5 text-right font-extrabold">Premiação</th>
                                </tr>
                              </thead>
                              <tbody>
                                {payroll.map(group => (
                                  <Fragment key={group.id}>
                                    <tr className="border-t border-ds-divider bg-ds-muted">
                                      <th colSpan={3} scope="colgroup" className={cn('px-4 py-2 text-left', kickerClass, 'text-ds-ink')}>Grupo · {group.name}</th>
                                      <td className="px-4 py-2 text-right font-extrabold text-ds-ok">R$ {fmt(group.prize)}</td>
                                    </tr>
                                    {group.units.map(unit => (
                                      <Fragment key={unit.kioskId}>
                                        <tr className="border-t border-ds-divider bg-ds-warm">
                                          <th colSpan={3} scope="colgroup" className="px-4 py-1.5 pl-6 text-left text-[12.5px] font-extrabold text-ds-accent-ink">{unit.name}</th>
                                          <td className="px-4 py-1.5 text-right text-[12.5px] font-extrabold text-ds-ink-2">R$ {fmt(unit.prize)}</td>
                                        </tr>
                                        {unit.rows.map(row => (
                                          <tr key={row.employeeId} className="border-t border-ds-divider">
                                            <td className="px-4 py-2.5 pl-8 font-extrabold text-ds-ink">{getUserName(row.employeeId)}</td>
                                            <td className="px-3 py-2.5 text-right font-bold text-ds-ink">{fmtBRL(row.revenue)}</td>
                                            <td className={cn('px-3 py-2.5 text-right font-extrabold', attainmentTone(row.avgAttainment))}>{fmtPct(row.avgAttainment)}</td>
                                            <td className="px-4 py-2.5 text-right font-extrabold text-ds-ok">
                                              {row.prize > 0 ? fmtBRL(row.prize) : <span className="font-semibold text-ds-ink-faint">—</span>}
                                              {row.prizeCalculated > 0 && <span className="ml-1 text-[10.5px] font-bold text-ds-warn" title="Calculada pela regra do método; não havia apuração gravada">calc.</span>}
                                            </td>
                                          </tr>
                                        ))}
                                      </Fragment>
                                    ))}
                                  </Fragment>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                      <div className="rounded-ds-card border border-ds-border bg-ds-surface">
                      {monthPeriods.map(period => (
                        <PeriodCard
                          key={period.id}
                          period={period}
                          kioskName={getKioskName(period.kioskId)}
                          employeeGoals={employeeGoals}
                          getUserName={getUserName}
                          isManager={isManager}
                          reopening={reopening}
                          onReopen={handleReopen}
                          onClose={(p) => { setClosingPeriod(p); setCloseOpen(true); }}
                        />
                      ))}
                      </div>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>

      <CloseGoalModal open={closeOpen} onOpenChange={setCloseOpen} period={closingPeriod} />
    </>
  );
}
