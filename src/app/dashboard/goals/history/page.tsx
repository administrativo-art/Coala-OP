"use client";

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { format, eachDayOfInterval } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  ArrowLeft,
  CalendarRange,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Store,
  Users,
  XCircle,
} from 'lucide-react';

import { useGoals } from '@/contexts/goals-context';
import { useKiosks } from '@/hooks/use-kiosks';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { PermissionGuard } from '@/components/permission-guard';
import { CloseGoalModal } from '@/components/close-goal-modal';
import { EmployeeDailyModal } from '@/components/goals-tracking-dashboard';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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

  const attainmentColor =
    attainment >= 100 ? 'text-emerald-600' : attainment >= 70 ? 'text-amber-600' : 'text-rose-500';

  return (
    <>
      <Card className="border-slate-300/70 dark:border-border/40 bg-white dark:bg-card/60 rounded-2xl shadow-sm overflow-hidden">
        {/* ── Summary row (always visible) ── */}
        <CardContent className="pt-5 pb-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-1.5 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-black truncate">{kioskName}</span>
                <Badge variant={period.status === 'closed' ? 'secondary' : period.status === 'cancelled' ? 'destructive' : 'default'}>
                  {statusLabels[period.status] ?? period.status}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><Store className="h-3 w-3" />{kioskName}</span>
                <span className="flex items-center gap-1"><Users className="h-3 w-3" />{collaboratorCount} colaborador(es)</span>
                <span className="flex items-center gap-1"><CalendarRange className="h-3 w-3" />{getGoalDistributionModeLabel(resolvedMode)}</span>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-2 lg:min-w-[440px]">
              <div className="rounded-xl bg-slate-50 dark:bg-slate-900/40 p-2.5">
                <div className="text-[9px] font-black uppercase tracking-wide text-muted-foreground">Meta alvo</div>
                <div className="mt-1 text-sm font-black">R$ {fmt(period.targetValue)}</div>
              </div>
              <div className="rounded-xl bg-slate-50 dark:bg-slate-900/40 p-2.5">
                <div className="text-[9px] font-black uppercase tracking-wide text-muted-foreground">Meta UP</div>
                <div className="mt-1 text-sm font-black text-blue-600">R$ {fmt(period.upValue ?? 0)}</div>
              </div>
              <div className="rounded-xl bg-slate-50 dark:bg-slate-900/40 p-2.5">
                <div className="text-[9px] font-black uppercase tracking-wide text-muted-foreground">Realizado</div>
                <div className="mt-1 text-sm font-black">R$ {fmt(period.currentValue)}</div>
              </div>
              <div className="rounded-xl bg-slate-50 dark:bg-slate-900/40 p-2.5">
                <div className="text-[9px] font-black uppercase tracking-wide text-muted-foreground">% meta</div>
                <div className={`mt-1 text-sm font-black ${attainmentColor}`}>{fmtPct(attainment)}</div>
              </div>
            </div>
          </div>

          {/* ── Actions + expand toggle ── */}
          <div className="mt-3 flex items-center justify-between border-t border-slate-100 dark:border-border/30 pt-3">
            <div className="flex items-center gap-2">
              {isManager && period.status === 'active' && (
                <Button variant="ghost" size="sm" onClick={() => onClose(period)}>
                  <XCircle className="h-3.5 w-3.5 mr-1" /> Encerrar
                </Button>
              )}
              {isManager && (period.status === 'closed' || period.status === 'cancelled') && (
                <Button variant="ghost" size="sm" disabled={reopening === period.id} onClick={() => onReopen(period.id)}>
                  <RotateCcw className="h-3.5 w-3.5 mr-1" />
                  {reopening === period.id ? 'Reabrindo...' : 'Reabrir'}
                </Button>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={() => setExpanded(v => !v)} className="text-muted-foreground">
              {expanded ? <><ChevronUp className="h-4 w-4 mr-1" />Recolher</> : <><ChevronDown className="h-4 w-4 mr-1" />Ver detalhes</>}
            </Button>
          </div>
        </CardContent>

        {/* ── Expanded detail ── */}
        {expanded && (
          <div className="border-t border-slate-100 dark:border-border/30 bg-slate-50/60 dark:bg-slate-900/20 px-5 py-4 space-y-5">
            {/* Distribution info */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">Meta diária registrada</div>
                <div className="mt-1 text-sm font-bold">R$ {fmt(resolvedDailyTarget)}</div>
              </div>
              <div>
                <div className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">Base de distribuição</div>
                <div className="mt-1 text-sm font-bold">{getGoalDistributionModeLabel(resolvedMode)}</div>
              </div>
              <div>
                <div className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">Fechamento</div>
                <div className="mt-1 text-sm font-bold">
                  {period.closedAt
                    ? format((period.closedAt as { toDate: () => Date }).toDate(), 'dd/MM/yyyy', { locale: ptBR })
                    : '—'}
                </div>
              </div>
            </div>

            {/* Shifts */}
            {period.shifts && period.shifts.length > 0 && (
              <div>
                <div className="text-[10px] font-black uppercase tracking-wide text-muted-foreground mb-2">Turnos</div>
                <div className="flex flex-wrap gap-2">
                  {period.shifts.map(shift => (
                    <div key={shift.id} className="rounded-lg border border-slate-200 bg-white dark:bg-card/60 px-3 py-1.5 text-sm">
                      <span className="font-medium">{shift.label}</span>
                      <span className="ml-2 text-muted-foreground">{(shift.fraction * 100).toFixed(0)}%</span>
                      <span className="ml-2 text-xs text-muted-foreground">R$ {fmt(period.targetValue * shift.fraction)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Collaborators — click to open detail modal */}
            {mergedEmployees.length > 0 && (
              <div>
                <div className="text-[10px] font-black uppercase tracking-wide text-muted-foreground mb-2">
                  Colaboradores <span className="normal-case font-normal text-slate-400">— clique para ver detalhes por dia</span>
                </div>
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:bg-card/60">
                  <div className="grid grid-cols-[2fr_1fr_1fr_0.7fr_0.9fr_1fr] border-b border-slate-100 bg-slate-50 px-3 py-2 text-[9px] font-black uppercase tracking-[0.1em] text-slate-400">
                    <span>Colaborador</span>
                    <span className="text-right">Meta alvo</span>
                    <span className="text-right">Realizado</span>
                    <span className="text-right">%</span>
                    <span className="text-right">Dias c/ venda</span>
                    <span className="text-right">Pace médio/dia</span>
                  </div>
                  {mergedEmployees.map((emp) => {
                    const pct = emp.targetValue > 0 ? (emp.currentValue / emp.targetValue) * 100 : 0;
                    const pctColor = pct >= 100 ? 'text-emerald-600' : pct >= 70 ? 'text-amber-600' : 'text-rose-500';
                    const name = getUserName(emp.empId);
                    return (
                      <button
                        key={emp.empId}
                        onClick={() => setModalData({
                          eg: emp.mergedGoal,
                          originalEgs: emp.goals,
                          userName: name,
                          snapshot: distributionSnapshot,
                        })}
                        className="grid w-full grid-cols-[2fr_1fr_1fr_0.7fr_0.9fr_1fr] border-b border-slate-100 px-3 py-2.5 text-xs last:border-b-0 hover:bg-slate-50 transition-colors text-left"
                      >
                        <span className="font-semibold text-zinc-800 truncate underline decoration-dotted underline-offset-2">{name}</span>
                        <span className="text-right text-zinc-500">R$ {fmt(emp.targetValue)}</span>
                        <span className="text-right font-semibold text-zinc-800">R$ {fmt(emp.currentValue)}</span>
                        <span className={`text-right font-bold ${pctColor}`}>{fmtPct(pct)}</span>
                        <span className="text-right text-zinc-500">{emp.daysWithSales} dias</span>
                        <span className="text-right text-zinc-500">R$ {fmt(emp.avgPace)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* General kiosk stats */}
            {kioskDaysWithSales > 0 && (
              <div>
                <div className="text-[10px] font-black uppercase tracking-wide text-muted-foreground mb-2">Desempenho geral</div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                    <div className="text-[9px] font-black uppercase tracking-wide text-slate-400">Dias com venda</div>
                    <div className="mt-1 text-sm font-black text-zinc-800">{kioskDaysWithSales} dias</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                    <div className="text-[9px] font-black uppercase tracking-wide text-slate-400">Pace médio geral</div>
                    <div className="mt-1 text-sm font-black text-zinc-800">R$ {fmt(kioskAvgPace)}/dia</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                    <div className="text-[9px] font-black uppercase tracking-wide text-slate-400">
                      Melhor dia {kioskBestDayDate ? formatDateKey(kioskBestDayDate) : ''}
                    </div>
                    <div className="mt-1 text-sm font-black text-emerald-600">R$ {fmt(kioskBestDay)}</div>
                  </div>
                </div>
              </div>
            )}

            {period.closureNote && (
              <div>
                <div className="text-[10px] font-black uppercase tracking-wide text-muted-foreground mb-1">Nota de fechamento</div>
                <p className="text-sm text-muted-foreground">{period.closureNote}</p>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Per-employee detail modal */}
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

export default function GoalsHistoryPage() {
  const { periods, employeeGoals, loading, reopenPeriod } = useGoals();
  const { kiosks } = useKiosks();
  const { permissions, users } = useAuth();
  const { toast } = useToast();

  const [filterKiosk, setFilterKiosk] = useState('all');
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

    const filtered = filterKiosk === 'all' ? sorted : sorted.filter(p => p.kioskId === filterKiosk);

    const map = new Map<string, GoalPeriodDoc[]>();
    for (const period of filtered) {
      const key = toMonthKey(period.startDate);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(period);
    }

    return [...map.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [periods, filterKiosk]);

  const summary = useMemo(() => ({
    active: periods.filter(p => p.status === 'active').length,
    closed: periods.filter(p => p.status === 'closed').length,
    cancelled: periods.filter(p => p.status === 'cancelled').length,
  }), [periods]);

  if (loading) return <Skeleton className="h-64 w-full" />;

  return (
    <PermissionGuard allowed={permissions.goals?.view ?? false}>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/dashboard/goals/analysis"><ArrowLeft className="mr-2 h-4 w-4" />Voltar</Link>
            </Button>
            <div>
              <h1 className="text-3xl font-bold">Histórico de Metas</h1>
              <p className="text-sm text-muted-foreground">Períodos organizados por mês, com detalhes de turnos e colaboradores.</p>
            </div>
          </div>
        </div>

        {/* Summary + filter */}
        <Card className="border-slate-300/70 dark:border-border/40 bg-slate-100 dark:bg-slate-900/40 rounded-2xl shadow-sm">
          <CardContent className="pt-6">
            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-2xl border border-slate-300/70 bg-white dark:bg-card/60 p-4">
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">Ativas</div>
                <div className="mt-2 text-2xl font-black text-blue-600">{summary.active}</div>
              </div>
              <div className="rounded-2xl border border-slate-300/70 bg-white dark:bg-card/60 p-4">
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">Encerradas</div>
                <div className="mt-2 text-2xl font-black text-green-600">{summary.closed}</div>
              </div>
              <div className="rounded-2xl border border-slate-300/70 bg-white dark:bg-card/60 p-4">
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">Canceladas</div>
                <div className="mt-2 text-2xl font-black text-rose-500">{summary.cancelled}</div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">Filtro por quiosque</div>
                <Select value={filterKiosk} onValueChange={setFilterKiosk}>
                  <SelectTrigger className="bg-white dark:bg-card/60"><SelectValue placeholder="Todos os quiosques" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os quiosques</SelectItem>
                    {kiosks.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {grouped.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">Nenhum período encontrado.</CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {grouped.map(([monthKey, monthPeriods]) => {
              const isCollapsed = collapsedMonths.has(monthKey);
              return (
                <div key={monthKey}>
                  <button
                    onClick={() => toggleMonth(monthKey)}
                    className="flex w-full items-center gap-3 mb-3 group"
                  >
                    <span className="text-sm font-black uppercase tracking-widest text-muted-foreground capitalize">
                      {toMonthLabel(monthKey)}
                    </span>
                    <span className="flex-1 h-px bg-slate-200 dark:bg-border/40" />
                    <span className="text-xs text-muted-foreground">{monthPeriods.length} meta(s)</span>
                    {isCollapsed
                      ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      : <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    }
                  </button>

                  {!isCollapsed && (
                    <div className="space-y-3">
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
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <CloseGoalModal open={closeOpen} onOpenChange={setCloseOpen} period={closingPeriod} />
    </PermissionGuard>
  );
}
