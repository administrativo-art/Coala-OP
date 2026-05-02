"use client";

import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { BarChart3, CalendarRange, Filter, History, Store, TrendingUp } from 'lucide-react';

import { useGoals } from '@/contexts/goals-context';
import { useKiosks } from '@/hooks/use-kiosks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { type GoalPeriodDoc, type GoalType, type GoalPeriod } from '@/types';
import {
  getGoalAttainment,
  getGoalDistributionModeLabel,
  getGoalPeriodResolvedDailyTarget,
  getGoalPeriodResolvedDayCount,
  getGoalPeriodResolvedMode,
} from '@/lib/goals-history';

const typeLabels: Record<string, string> = {
  revenue: 'Faturamento',
  ticket: 'Ticket Médio',
  product_line: 'Linha de Produto',
  product_specific: 'Produto Específico',
};

const periodLabels: Record<string, string> = {
  daily: 'Diária',
  weekly: 'Semanal',
  monthly: 'Mensal',
};

const statusLabels: Record<string, string> = {
  closed: 'Encerrada',
  cancelled: 'Cancelada',
};

function fmtCurrency(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtTs(ts: unknown, mask: string) {
  if (!ts || typeof ts !== 'object' || !('toDate' in (ts as Record<string, unknown>))) return '-';
  try {
    return format((ts as { toDate: () => Date }).toDate(), mask, { locale: ptBR });
  } catch {
    return '-';
  }
}

function getPctTone(attainment: number) {
  if (attainment >= 100) return 'text-green-600';
  if (attainment >= 80) return 'text-amber-500';
  return 'text-rose-500';
}

function getPctBadge(attainment: number) {
  if (attainment >= 100) return 'default' as const;
  if (attainment >= 80) return 'secondary' as const;
  return 'outline' as const;
}

export function GoalsAnalysisDashboard() {
  const { periods, templates, loading } = useGoals();
  const { kiosks } = useKiosks();

  const [filterKioskId, setFilterKioskId] = useState('all');
  const [filterType, setFilterType] = useState<GoalType | 'all'>('all');
  const [filterPeriod, setFilterPeriod] = useState<GoalPeriod | 'all'>('all');
  const [filterDateStart, setFilterDateStart] = useState('');
  const [filterDateEnd, setFilterDateEnd] = useState('');

  const getKioskName = (id: string) => kiosks.find(k => k.id === id)?.name ?? id;
  const getTemplate = (id: string) => templates.find(t => t.id === id);

  const historicPeriods = useMemo(() => {
    return periods
      .filter(period => period.status !== 'active')
      .filter(period => {
        if (filterKioskId !== 'all' && period.kioskId !== filterKioskId) return false;
        const template = getTemplate(period.templateId);
        if (filterType !== 'all' && template?.type !== filterType) return false;
        if (filterPeriod !== 'all' && template?.period !== filterPeriod) return false;
        if (filterDateStart) {
          try {
            if (period.startDate.toDate() < new Date(`${filterDateStart}T00:00:00`)) return false;
          } catch {}
        }
        if (filterDateEnd) {
          try {
            if (period.endDate.toDate() > new Date(`${filterDateEnd}T23:59:59`)) return false;
          } catch {}
        }
        return true;
      })
      .sort((a, b) => {
        const aTime = a.endDate?.toDate?.()?.getTime?.() ?? 0;
        const bTime = b.endDate?.toDate?.()?.getTime?.() ?? 0;
        return bTime - aTime;
      });
  }, [periods, filterKioskId, filterType, filterPeriod, filterDateStart, filterDateEnd, templates]);

  const consolidated = useMemo(() => {
    const totalTarget = historicPeriods.reduce((sum, period) => sum + period.targetValue, 0);
    const totalCurrent = historicPeriods.reduce((sum, period) => sum + period.currentValue, 0);
    const avgPct = historicPeriods.length > 0
      ? historicPeriods.reduce((sum, period) => sum + getGoalAttainment(period), 0) / historicPeriods.length
      : 0;
    const withFrozenScale = historicPeriods.filter(period => getGoalPeriodResolvedMode(period) === 'scheduled_days').length;

    return {
      totalTarget,
      totalCurrent,
      avgPct,
      closedCount: historicPeriods.filter(period => period.status === 'closed').length,
      cancelledCount: historicPeriods.filter(period => period.status === 'cancelled').length,
      withFrozenScale,
    };
  }, [historicPeriods]);

  const kioskComparative = useMemo(() => {
    const groups = new Map<string, GoalPeriodDoc[]>();
    for (const period of historicPeriods) {
      const bucket = groups.get(period.kioskId);
      if (bucket) bucket.push(period);
      else groups.set(period.kioskId, [period]);
    }

    return Array.from(groups.entries())
      .map(([kioskId, items]) => {
        const avgPct = items.reduce((sum, item) => sum + getGoalAttainment(item), 0) / Math.max(items.length, 1);
        const bestPct = Math.max(...items.map(getGoalAttainment), 0);
        return {
          kioskId,
          kioskName: getKioskName(kioskId),
          count: items.length,
          avgPct,
          bestPct,
          hitCount: items.filter(item => getGoalAttainment(item) >= 100).length,
        };
      })
      .sort((a, b) => b.avgPct - a.avgPct);
  }, [historicPeriods, kiosks]);

  if (loading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-6">
      <Card className="border-slate-300/70 dark:border-border/40 bg-slate-100 dark:bg-slate-900/40 rounded-2xl shadow-sm">
        <CardContent className="pt-6 space-y-5">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">Novo</Badge>
            <span className="text-xs font-black uppercase tracking-[0.18em] text-muted-foreground">Visão Consolidada</span>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-2xl border border-slate-300/70 bg-white dark:bg-card/60 p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">Total Realizado</div>
              <div className="mt-2 text-2xl font-black">{fmtCurrency(consolidated.totalCurrent)}</div>
              <div className="text-xs text-muted-foreground">de {fmtCurrency(consolidated.totalTarget)}</div>
            </div>
            <div className="rounded-2xl border border-slate-300/70 bg-white dark:bg-card/60 p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">Atingimento Médio</div>
              <div className={`mt-2 text-2xl font-black ${getPctTone(consolidated.avgPct)}`}>{consolidated.avgPct.toFixed(1)}%</div>
              <div className="text-xs text-muted-foreground">{historicPeriods.length} período(s) filtrado(s)</div>
            </div>
            <div className="rounded-2xl border border-slate-300/70 bg-white dark:bg-card/60 p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">Encerradas</div>
              <div className="mt-2 text-2xl font-black text-green-600">{consolidated.closedCount}</div>
              <div className="text-xs text-muted-foreground">{consolidated.cancelledCount} cancelada(s)</div>
            </div>
            <div className="rounded-2xl border border-slate-300/70 bg-white dark:bg-card/60 p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">Base Congelada</div>
              <div className="mt-2 text-2xl font-black text-blue-600">{consolidated.withFrozenScale}</div>
              <div className="text-xs text-muted-foreground">meta(s) com escala congelada</div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-5">
            <div className="space-y-1 md:col-span-1">
              <Label className="text-xs font-semibold flex items-center gap-2"><Store className="h-3.5 w-3.5" /> Quiosque</Label>
              <Select value={filterKioskId} onValueChange={setFilterKioskId}>
                <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {kiosks.map(kiosk => <SelectItem key={kiosk.id} value={kiosk.id}>{kiosk.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold flex items-center gap-2"><Filter className="h-3.5 w-3.5" /> Tipo</Label>
              <Select value={filterType} onValueChange={value => setFilterType(value as GoalType | 'all')}>
                <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {Object.entries(typeLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold flex items-center gap-2"><CalendarRange className="h-3.5 w-3.5" /> Período</Label>
              <Select value={filterPeriod} onValueChange={value => setFilterPeriod(value as GoalPeriod | 'all')}>
                <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {Object.entries(periodLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Data início</Label>
              <Input type="date" value={filterDateStart} onChange={event => setFilterDateStart(event.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Data fim</Label>
              <Input type="date" value={filterDateEnd} onChange={event => setFilterDateEnd(event.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {kioskComparative.map(item => (
          <Card key={item.kioskId} className="border-slate-300/70 dark:border-border/40 rounded-2xl bg-white dark:bg-card/60 shadow-sm">
            <CardContent className="pt-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-black">{item.kioskName}</div>
                  <div className="text-xs text-muted-foreground">{item.count} período(s) no filtro</div>
                </div>
                <Badge variant={getPctBadge(item.avgPct)}>{item.avgPct.toFixed(1)}%</Badge>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-slate-50 dark:bg-slate-900/40 p-3">
                  <div className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">Média</div>
                  <div className={`mt-1 text-lg font-black ${getPctTone(item.avgPct)}`}>{item.avgPct.toFixed(0)}%</div>
                </div>
                <div className="rounded-xl bg-slate-50 dark:bg-slate-900/40 p-3">
                  <div className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">Melhor</div>
                  <div className="mt-1 text-lg font-black text-blue-600">{item.bestPct.toFixed(0)}%</div>
                </div>
                <div className="rounded-xl bg-slate-50 dark:bg-slate-900/40 p-3">
                  <div className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">Batidas</div>
                  <div className="mt-1 text-lg font-black text-green-600">{item.hitCount}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-slate-300/70 dark:border-border/40 rounded-2xl bg-white dark:bg-card/60 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-xl"><History className="h-5 w-5 text-primary" /> Histórico consolidado</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">Períodos encerrados com base congelada visível para auditoria.</p>
          </div>
          <Badge variant="outline">{historicPeriods.length} registro(s)</Badge>
        </CardHeader>
        <CardContent className="p-0">
          {historicPeriods.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">Nenhum período encerrado encontrado.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quiosque</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Mês</TableHead>
                    <TableHead>Base</TableHead>
                    <TableHead>Dias</TableHead>
                    <TableHead>Meta/dia</TableHead>
                    <TableHead>Alvo</TableHead>
                    <TableHead>Realizado</TableHead>
                    <TableHead>%</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Nota</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {historicPeriods.map(period => {
                    const template = getTemplate(period.templateId);
                    const attainment = getGoalAttainment(period);
                    const resolvedMode = getGoalPeriodResolvedMode(period);
                    const dayCount = getGoalPeriodResolvedDayCount(period);
                    const dailyTarget = getGoalPeriodResolvedDailyTarget(period);

                    return (
                      <TableRow key={period.id}>
                        <TableCell className="font-medium">{getKioskName(period.kioskId)}</TableCell>
                        <TableCell>{template ? typeLabels[template.type] : '-'}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {fmtTs(period.startDate, 'MMM/yyyy')}
                          <div className="text-[11px]">{fmtTs(period.startDate, 'dd/MM/yyyy')} - {fmtTs(period.endDate, 'dd/MM/yyyy')}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={resolvedMode === 'scheduled_days' ? 'border-blue-200 bg-blue-50 text-blue-700' : ''}>
                            {getGoalDistributionModeLabel(resolvedMode)}
                          </Badge>
                        </TableCell>
                        <TableCell>{dayCount}</TableCell>
                        <TableCell>{fmtCurrency(dailyTarget)}</TableCell>
                        <TableCell>{fmtCurrency(period.targetValue)}</TableCell>
                        <TableCell>{fmtCurrency(period.currentValue)}</TableCell>
                        <TableCell>
                          <Badge variant={getPctBadge(attainment)}>{attainment.toFixed(1)}%</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={period.status === 'closed' ? 'secondary' : 'destructive'}>
                            {statusLabels[period.status] ?? period.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[260px] truncate text-xs text-muted-foreground">{period.closureNote ?? '-'}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-300/70 dark:border-border/40 rounded-2xl bg-slate-100 dark:bg-slate-900/40 shadow-sm">
        <CardContent className="pt-5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <TrendingUp className="h-4 w-4 text-primary" />
            Leitura operacional
          </div>
          <div className="mt-2 text-sm text-muted-foreground">
            Períodos encerrados com `Escala congelada` usam o snapshot salvo no fechamento. Isso preserva histórico, meta/dia e base de comparação mesmo se a escala mudar depois.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
