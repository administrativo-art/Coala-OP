"use client";

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ArrowLeft, CalendarRange, RotateCcw, Store, XCircle } from 'lucide-react';

import { useGoals } from '@/contexts/goals-context';
import { useKiosks } from '@/hooks/use-kiosks';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { PermissionGuard } from '@/components/permission-guard';
import { CloseGoalModal } from '@/components/close-goal-modal';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { type GoalPeriodDoc } from '@/types';
import {
  getGoalAttainment,
  getGoalDistributionModeLabel,
  getGoalPeriodResolvedDailyTarget,
  getGoalPeriodResolvedMode,
} from '@/lib/goals-history';

function fmt(value: number) {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatMonth(ts: unknown) {
  if (!ts || typeof ts !== 'object' || !('toDate' in (ts as Record<string, unknown>))) return '-';
  try {
    return format((ts as { toDate: () => Date }).toDate(), 'MMM/yyyy', { locale: ptBR });
  } catch {
    return '-';
  }
}

const statusLabels: Record<string, string> = {
  closed: 'Encerrada',
  cancelled: 'Cancelada',
  active: 'Ativa',
};

export default function GoalsHistoryPage() {
  const { periods, employeeGoals, loading, reopenPeriod } = useGoals();
  const { kiosks } = useKiosks();
  const { permissions } = useAuth();
  const { toast } = useToast();

  const [filterKiosk, setFilterKiosk] = useState('all');
  const [reopening, setReopening] = useState<string | null>(null);
  const [closingPeriod, setClosingPeriod] = useState<GoalPeriodDoc | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);

  const isManager = (permissions.goals?.manage ?? false) || (permissions.settings?.manageUsers ?? false);

  const getKioskName = (id: string) => kiosks.find(kiosk => kiosk.id === id)?.name ?? id;

  async function handleReopen(periodId: string) {
    setReopening(periodId);
    await reopenPeriod(periodId);
    toast({ title: 'Meta reaberta com sucesso.' });
    setReopening(null);
  }

  const filteredPeriods = useMemo(() => {
    const sorted = [...periods].sort((a, b) => {
      const aDate = a.startDate?.toDate?.()?.getTime?.() ?? 0;
      const bDate = b.startDate?.toDate?.()?.getTime?.() ?? 0;
      return bDate - aDate;
    });
    if (filterKiosk === 'all') return sorted;
    return sorted.filter(period => period.kioskId === filterKiosk);
  }, [periods, filterKiosk]);

  const summary = useMemo(() => ({
    active: filteredPeriods.filter(period => period.status === 'active').length,
    closed: filteredPeriods.filter(period => period.status === 'closed').length,
    cancelled: filteredPeriods.filter(period => period.status === 'cancelled').length,
  }), [filteredPeriods]);

  if (loading) return <Skeleton className="h-64 w-full" />;

  return (
    <PermissionGuard allowed={permissions.goals?.view ?? false}>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/dashboard/goals/analysis">
                <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
              </Link>
            </Button>
            <div>
              <h1 className="text-3xl font-bold">Histórico de Metas</h1>
              <p className="text-sm text-muted-foreground">Períodos ativos e encerrados, com leitura da base congelada no fechamento.</p>
            </div>
          </div>
        </div>

        <Card className="border-slate-300/70 dark:border-border/40 bg-slate-100 dark:bg-slate-900/40 rounded-2xl shadow-sm">
          <CardContent className="pt-6 space-y-5">
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
                  <SelectTrigger className="bg-white dark:bg-card/60">
                    <SelectValue placeholder="Todos os quiosques" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os quiosques</SelectItem>
                    {kiosks.map(kiosk => <SelectItem key={kiosk.id} value={kiosk.id}>{kiosk.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {filteredPeriods.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">Nenhum período encontrado.</CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredPeriods.map(period => {
              const attainment = getGoalAttainment(period);
              const collaborators = employeeGoals.filter(goal => goal.periodId === period.id).length;
              const resolvedMode = getGoalPeriodResolvedMode(period);
              const resolvedDailyTarget = getGoalPeriodResolvedDailyTarget(period);
              const statusTone =
                period.status === 'active'
                  ? 'text-blue-600'
                  : period.status === 'closed'
                    ? 'text-green-600'
                    : 'text-rose-500';

              return (
                <Card key={period.id} className="border-slate-300/70 dark:border-border/40 bg-white dark:bg-card/60 rounded-2xl shadow-sm">
                  <CardContent className="pt-5 space-y-4">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-lg font-black">{getKioskName(period.kioskId)}</span>
                          <Badge variant="outline" className="border-slate-300">{formatMonth(period.startDate)}</Badge>
                          <Badge variant={period.status === 'closed' ? 'secondary' : period.status === 'cancelled' ? 'destructive' : 'default'}>
                            {statusLabels[period.status] ?? period.status}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1.5"><Store className="h-3.5 w-3.5" /> {collaborators} colaborador(es)</span>
                          <span className="flex items-center gap-1.5"><CalendarRange className="h-3.5 w-3.5" /> {getGoalDistributionModeLabel(resolvedMode)}</span>
                        </div>
                        {period.closureNote ? (
                          <p className="max-w-2xl text-sm text-muted-foreground">{period.closureNote}</p>
                        ) : null}
                      </div>

                      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:min-w-[520px]">
                        <div className="rounded-xl bg-slate-50 dark:bg-slate-900/40 p-3">
                          <div className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">Meta</div>
                          <div className="mt-1 text-base font-black">R$ {fmt(period.targetValue)}</div>
                        </div>
                        <div className="rounded-xl bg-slate-50 dark:bg-slate-900/40 p-3">
                          <div className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">UP</div>
                          <div className="mt-1 text-base font-black text-blue-600">R$ {fmt(period.upValue ?? 0)}</div>
                        </div>
                        <div className="rounded-xl bg-slate-50 dark:bg-slate-900/40 p-3">
                          <div className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">Realizado</div>
                          <div className="mt-1 text-base font-black">R$ {fmt(period.currentValue)}</div>
                        </div>
                        <div className="rounded-xl bg-slate-50 dark:bg-slate-900/40 p-3">
                          <div className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">% da meta</div>
                          <div className={`mt-1 text-base font-black ${statusTone}`}>{attainment.toFixed(1)}%</div>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-3 rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 md:flex-row md:items-center md:justify-between dark:border-border/40 dark:bg-slate-900/30">
                      <div className="grid gap-3 md:grid-cols-3 md:gap-6">
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
                          <div className="mt-1 text-sm font-bold">{period.closedAt ? formatMonth(period.closedAt) : '-'}</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {isManager && period.status === 'active' && (
                          <Button variant="ghost" size="sm" onClick={() => { setClosingPeriod(period); setCloseOpen(true); }}>
                            <XCircle className="h-3.5 w-3.5 mr-1" />
                            Encerrar
                          </Button>
                        )}
                        {isManager && (period.status === 'closed' || period.status === 'cancelled') && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={reopening === period.id}
                            onClick={() => handleReopen(period.id)}
                          >
                            <RotateCcw className="h-3.5 w-3.5 mr-1" />
                            {reopening === period.id ? 'Reabrindo...' : 'Reabrir'}
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <CloseGoalModal open={closeOpen} onOpenChange={setCloseOpen} period={closingPeriod} />
    </PermissionGuard>
  );
}
