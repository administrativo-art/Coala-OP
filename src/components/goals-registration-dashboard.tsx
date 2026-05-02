"use client";

import { useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { endOfMonth, eachDayOfInterval, format, startOfMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  Plus,
  RefreshCw,
  Users,
  XCircle,
  Store,
  Target,
  TrendingUp,
  Sparkles,
  CalendarRange,
} from 'lucide-react';

import { functions } from '@/lib/firebase';
import { useGoals } from '@/contexts/goals-context';
import { useKiosks } from '@/hooks/use-kiosks';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { type GoalPeriodDoc } from '@/types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GoalTemplateFormModal } from '@/components/goal-template-form-modal';
import { AddEmployeeGoalModal } from '@/components/add-employee-goal-modal';
import { CloseGoalModal } from '@/components/close-goal-modal';

function formatMonth(ts: unknown): string {
  if (!ts || typeof ts !== 'object' || !('toDate' in (ts as Record<string, unknown>))) return '-';
  try {
    return format((ts as { toDate: () => Date }).toDate(), 'MMMM yyyy', { locale: ptBR });
  } catch {
    return '-';
  }
}

function fmt(value: number) {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pct(value: number, target: number) {
  if (target <= 0) return 0;
  return (value / target) * 100;
}

function getStatusColor(value: number) {
  if (value >= 100) return { text: 'text-green-600', bar: 'bg-green-500' };
  if (value >= 90) return { text: 'text-emerald-500', bar: 'bg-emerald-400' };
  if (value >= 70) return { text: 'text-amber-500', bar: 'bg-amber-400' };
  return { text: 'text-rose-500', bar: 'bg-rose-400' };
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function calcLinearMarker(period: GoalPeriodDoc) {
  const start = period.startDate?.toDate?.() ?? new Date();
  const end = period.endDate?.toDate?.() ?? start;
  const today = new Date();
  const days = eachDayOfInterval({ start, end });
  const elapsed = days.filter(day => day <= today).length;
  return Math.min((elapsed / Math.max(days.length, 1)) * 100, 100);
}

function GoalProgressStack({ period }: { period: GoalPeriodDoc }) {
  const basePct = pct(period.currentValue, period.targetValue);
  const upTarget = period.upValue ?? period.targetValue * 1.2;
  const upPct = pct(period.currentValue, upTarget);
  const marker = calcLinearMarker(period);

  return (
    <div className="min-w-[220px] space-y-3">
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-semibold text-slate-600 dark:text-slate-300">Meta Alvo</span>
          <span className={`font-bold ${getStatusColor(basePct).text}`}>{basePct.toFixed(1)}% · R$ {fmt(period.targetValue)}</span>
        </div>
        <div className="relative h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-visible">
          <div className={`h-full rounded-full ${getStatusColor(basePct).bar}`} style={{ width: `${Math.min(basePct, 100)}%` }} />
          <div className="absolute top-[-3px] bottom-[-3px] w-px bg-slate-400/70" style={{ left: `${marker}%` }} />
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>R$ {fmt(period.currentValue)} realizado</span>
          <span>R$ {fmt(period.targetValue)} meta</span>
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-semibold text-blue-600">Super Meta (UP)</span>
          <span className="font-bold text-blue-500">{upPct.toFixed(1)}% · R$ {fmt(upTarget)}</span>
        </div>
        <div className="relative h-2 rounded-full bg-blue-100 dark:bg-blue-950/30 overflow-visible">
          <div className="h-full rounded-full bg-blue-400" style={{ width: `${Math.min(upPct, 100)}%` }} />
          <div className="absolute top-[-3px] bottom-[-3px] w-px bg-blue-300/80" style={{ left: `${marker}%` }} />
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>R$ {fmt(period.currentValue)} realizado</span>
          <span>R$ {fmt(upTarget)} UP</span>
        </div>
      </div>
    </div>
  );
}

export function GoalsRegistrationDashboard() {
  const { templates, periods, employeeGoals, loading } = useGoals();
  const { kiosks } = useKiosks();
  const { user, permissions } = useAuth();
  const { toast } = useToast();

  const isAdmin = permissions.settings?.manageUsers ?? false;
  const userKioskIds = user?.assignedKioskIds ?? [];
  const availableKiosks = isAdmin ? kiosks : kiosks.filter(kiosk => userKioskIds.includes(kiosk.id));

  const [filterKioskId, setFilterKioskId] = useState<string>('all');
  const [newMetaOpen, setNewMetaOpen] = useState(false);
  const [employeeGoalOpen, setEmployeeGoalOpen] = useState(false);
  const [employeeGoalPeriod, setEmployeeGoalPeriod] = useState<GoalPeriodDoc | null>(null);
  const [closeGoalOpen, setCloseGoalOpen] = useState(false);
  const [closingPeriod, setClosingPeriod] = useState<GoalPeriodDoc | null>(null);

  const [syncOpen, setSyncOpen] = useState(false);
  const [syncKioskId, setSyncKioskId] = useState('');
  const [syncFilialId, setSyncFilialId] = useState('');
  const [syncStart, setSyncStart] = useState('');
  const [syncEnd, setSyncEnd] = useState('');
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncResults, setSyncResults] = useState<{ date: string; revenue?: number; error?: string }[] | null>(null);

  async function handleSyncGoals() {
    if (!syncKioskId || !syncStart || !syncEnd) return;
    setSyncLoading(true);
    setSyncResults(null);
    try {
      const fn = httpsCallable(functions, 'syncGoalsForRange');
      const payload: Record<string, string> = { kioskId: syncKioskId, startDate: syncStart, endDate: syncEnd };
      if (syncFilialId.trim()) payload.pdvFilialId = syncFilialId.trim();
      const result = await fn(payload) as { data: { results: { date: string; revenue?: number; error?: string }[] } };
      setSyncResults(result.data.results);
      toast({ title: 'Sync concluído', description: `${result.data.results.length} dias processados.` });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Falha ao sincronizar metas.';
      toast({ title: 'Erro no sync', description: message, variant: 'destructive' });
    }
    setSyncLoading(false);
  }

  const filteredPeriods = useMemo(() => {
    const base = isAdmin ? periods : periods.filter(period => userKioskIds.includes(period.kioskId));
    return (filterKioskId === 'all' ? base : base.filter(period => period.kioskId === filterKioskId))
      .filter(period => period.status === 'active')
      .sort((a, b) => {
        const aDate = a.startDate?.toDate?.()?.getTime?.() ?? 0;
        const bDate = b.startDate?.toDate?.()?.getTime?.() ?? 0;
        return bDate - aDate;
      });
  }, [periods, filterKioskId, isAdmin, userKioskIds]);

  const getKioskName = (id: string) => kiosks.find(kiosk => kiosk.id === id)?.name ?? id;
  const getTemplateType = (templateId: string) => templates.find(template => template.id === templateId)?.type ?? 'revenue';

  const typeLabels: Record<string, string> = {
    revenue: 'Faturamento',
    ticket: 'Ticket Médio',
    product_line: 'Linha de Produto',
    product_specific: 'Produto Específico',
  };

  const summary = useMemo(() => {
    const totalTarget = filteredPeriods.reduce((sum, period) => sum + period.targetValue, 0);
    const totalCurrent = filteredPeriods.reduce((sum, period) => sum + period.currentValue, 0);
    const avgPct = filteredPeriods.length > 0
      ? filteredPeriods.reduce((sum, period) => sum + pct(period.currentValue, period.targetValue), 0) / filteredPeriods.length
      : 0;
    const totalCollaborators = filteredPeriods.reduce(
      (sum, period) => sum + employeeGoals.filter(goal => goal.periodId === period.id).length,
      0
    );

    return { totalTarget, totalCurrent, avgPct, totalCollaborators };
  }, [filteredPeriods, employeeGoals]);

  if (loading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-6">
      <Card className="border-slate-300/70 dark:border-border/40 bg-slate-100 dark:bg-slate-900/40 rounded-2xl shadow-sm">
        <CardContent className="pt-6 space-y-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="border-pink-200 bg-pink-50 text-pink-600">Gestão</Badge>
                <span className="text-xs font-black uppercase tracking-[0.18em] text-muted-foreground">Cadastro de Metas</span>
              </div>
              <h2 className="text-2xl font-black tracking-tight">Metas ativas e ações de configuração</h2>
              <p className="text-sm text-muted-foreground">Sincronize, replique por mês e gerencie colaboradores sem sair da listagem.</p>
            </div>

            <div className="flex flex-wrap gap-2">
              {isAdmin && (
                <Button variant="outline" onClick={() => { setSyncOpen(true); setSyncResults(null); }}>
                  <RefreshCw className="mr-2 h-4 w-4" /> Sincronizar Metas
                </Button>
              )}
              <Button onClick={() => setNewMetaOpen(true)}>
                <Plus className="mr-2 h-4 w-4" /> Nova Meta
              </Button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-2xl border border-slate-300/70 bg-white dark:bg-card/60 p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">Meta Total</div>
              <div className="mt-2 text-2xl font-black">R$ {fmt(summary.totalTarget)}</div>
            </div>
            <div className="rounded-2xl border border-slate-300/70 bg-white dark:bg-card/60 p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">Atual</div>
              <div className="mt-2 text-2xl font-black text-slate-900 dark:text-slate-100">R$ {fmt(summary.totalCurrent)}</div>
            </div>
            <div className="rounded-2xl border border-slate-300/70 bg-white dark:bg-card/60 p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">Atingimento Médio</div>
              <div className={`mt-2 text-2xl font-black ${getStatusColor(summary.avgPct).text}`}>{summary.avgPct.toFixed(1)}%</div>
            </div>
            <div className="rounded-2xl border border-slate-300/70 bg-white dark:bg-card/60 p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">Colaboradores vinculados</div>
              <div className="mt-2 text-2xl font-black text-blue-600">{summary.totalCollaborators}</div>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[240px] space-y-1">
              <Label className="text-xs font-semibold flex items-center gap-2"><Store className="h-3.5 w-3.5" /> Quiosque</Label>
              <Select value={filterKioskId} onValueChange={setFilterKioskId}>
                <SelectTrigger className="bg-white dark:bg-card/60"><SelectValue placeholder="Todos os quiosques" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os quiosques</SelectItem>
                  {availableKiosks.map(kiosk => <SelectItem key={kiosk.id} value={kiosk.id}>{kiosk.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="text-sm text-muted-foreground pb-0.5">
              {filteredPeriods.length} meta(s) ativa(s) no filtro
            </div>
          </div>
        </CardContent>
      </Card>

      {filteredPeriods.length === 0 ? (
        <Card className="border-dashed border-2">
          <CardContent className="py-16 text-center text-muted-foreground">Nenhuma meta ativa.</CardContent>
        </Card>
      ) : (
        <Card className="border-slate-300/70 dark:border-border/40 bg-white dark:bg-card/60 rounded-2xl shadow-sm overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/40 border-b">
                  <tr>
                    {['Quiosque', 'Mês', 'Tipo', 'Estrutura', 'Progressão', 'Pace', 'Ações'].map(header => (
                      <th key={header} className="text-left px-4 py-3 text-[11px] font-black text-muted-foreground uppercase tracking-[0.18em]">{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredPeriods.map(period => {
                    const progressPct = pct(period.currentValue, period.targetValue);
                    const currentPace = (() => {
                      const days = eachDayOfInterval({
                        start: period.startDate?.toDate?.() ?? new Date(),
                        end: endOfMonth(period.startDate?.toDate?.() ?? new Date()),
                      });
                      const elapsed = Math.max(days.filter(day => day <= new Date()).length, 1);
                      return period.currentValue / elapsed;
                    })();
                    const collaborators = employeeGoals.filter(goal => goal.periodId === period.id).length;
                    const type = getTemplateType(period.templateId);
                    return (
                      <tr key={period.id} className="border-b last:border-b-0 hover:bg-slate-50/70 dark:hover:bg-slate-900/30 transition-colors align-top">
                        <td className="px-4 py-4 min-w-[220px]">
                          <div className="font-semibold">{getKioskName(period.kioskId)}</div>
                          <div className="text-xs text-muted-foreground mt-1">{formatMonth(period.startDate)}</div>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap capitalize">{formatMonth(period.startDate)}</td>
                        <td className="px-4 py-4">
                          <Badge variant="outline" className="border-pink-200 bg-pink-50 text-pink-600">{typeLabels[type] ?? type}</Badge>
                        </td>
                        <td className="px-4 py-4 min-w-[190px]">
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 text-xs">
                              <Badge variant="outline">{period.shifts?.length ? `${period.shifts.length} turno(s)` : 'Sem turnos'}</Badge>
                              <Badge variant="secondary">{collaborators} colaborador(es)</Badge>
                            </div>
                            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                              <CalendarRange className="h-3.5 w-3.5" />
                              Meta R$ {fmt(period.targetValue)} · UP R$ {fmt(period.upValue ?? 0)}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <GoalProgressStack period={period} />
                        </td>
                        <td className="px-4 py-4 min-w-[170px]">
                          <div className="space-y-2">
                            <div className={`text-2xl font-black ${getStatusColor(progressPct).text}`}>{progressPct.toFixed(1)}%</div>
                            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                              <TrendingUp className="h-3.5 w-3.5" />
                              R$ {fmt(currentPace)}/dia pace atual
                            </div>
                            <div className="text-xs text-blue-600 flex items-center gap-1.5">
                              <Target className="h-3.5 w-3.5" />
                              R$ {fmt(period.currentValue)} acumulado
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4 min-w-[180px]">
                          <div className="flex items-center gap-1">
                            <Button size="icon" variant="ghost" onClick={() => { setEmployeeGoalPeriod(period); setEmployeeGoalOpen(true); }} title="Gerenciar colaboradores">
                              <Users className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" className="text-destructive" onClick={() => { setClosingPeriod(period); setCloseGoalOpen(true); }} title="Encerrar meta">
                              <XCircle className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setNewMetaOpen(true)}>
                              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                              Copiar
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <GoalTemplateFormModal open={newMetaOpen} onOpenChange={setNewMetaOpen} />
      <AddEmployeeGoalModal open={employeeGoalOpen} onOpenChange={setEmployeeGoalOpen} period={employeeGoalPeriod} />
      <CloseGoalModal open={closeGoalOpen} onOpenChange={setCloseGoalOpen} period={closingPeriod} />

      <Dialog open={syncOpen} onOpenChange={setSyncOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Sincronizar Metas</DialogTitle>
            <DialogDescription>Busca os dados de faturamento do PDV Legal e atualiza as metas ativas no intervalo informado.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Quiosque</Label>
              <Select value={syncKioskId} onValueChange={setSyncKioskId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{availableKiosks.map(kiosk => <SelectItem key={kiosk.id} value={kiosk.id}>{kiosk.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>ID Filial PDV Legal</Label>
              <Input className="mt-1" placeholder="Ex: 12345 (opcional se já configurado)" value={syncFilialId} onChange={event => setSyncFilialId(event.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Data início</Label>
                <Input type="date" className="mt-1" value={syncStart} onChange={event => setSyncStart(event.target.value)} />
              </div>
              <div>
                <Label>Data fim</Label>
                <Input type="date" className="mt-1" value={syncEnd} onChange={event => setSyncEnd(event.target.value)} />
              </div>
            </div>
            {syncResults && (
              <div className="rounded-md border p-3 max-h-48 overflow-y-auto space-y-1">
                {syncResults.map(result => (
                  <div key={result.date} className="flex justify-between text-xs">
                    <span className="font-mono">{result.date}</span>
                    {result.error
                      ? <span className="text-destructive">{result.error}</span>
                      : <span className="text-muted-foreground">R$ {(result.revenue ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSyncOpen(false)}>Fechar</Button>
            <Button onClick={handleSyncGoals} disabled={!syncKioskId || !syncStart || !syncEnd || syncLoading}>
              {syncLoading ? 'Sincronizando...' : 'Executar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
