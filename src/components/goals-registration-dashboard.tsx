"use client";

import { useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  CalendarRange,
  Plus,
  RefreshCw,
  Settings2,
  Sparkles,
  Store,
  Users,
  XCircle,
} from 'lucide-react';

import { functions } from '@/lib/firebase';
import { useGoals } from '@/contexts/goals-context';
import { useKiosks } from '@/hooks/use-kiosks';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { type GoalPeriod, type GoalPeriodDoc } from '@/types';
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
import { GoalMethodSettings } from '@/components/goal-method-settings';
import { canAccessUnit } from '@/lib/unit-access';

function formatPeriodLabel(period: GoalPeriodDoc, goalPeriod: GoalPeriod): string {
  const start = period.startDate?.toDate?.() ?? new Date();
  const end = period.endDate?.toDate?.() ?? start;

  if (goalPeriod === 'daily') return format(start, 'dd/MM/yyyy', { locale: ptBR });
  if (goalPeriod === 'weekly') {
    return `${format(start, 'dd/MM', { locale: ptBR })} a ${format(end, 'dd/MM/yyyy', { locale: ptBR })}`;
  }

  return format(start, 'MMMM yyyy', { locale: ptBR });
}

function fmt(value: number) {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function periodKindLabel(period: GoalPeriod) {
  if (period === 'daily') return 'Diaria';
  if (period === 'weekly') return 'Semanal';
  return 'Mensal';
}

export function GoalsRegistrationDashboard() {
  const { templates, periods, employeeGoals, loading } = useGoals();
  const { kiosks } = useKiosks();
  const { user, permissions, isDefaultAdmin } = useAuth();
  const { toast } = useToast();

  const isAdmin = permissions.settings?.manageUsers ?? false;
  const canManageGoalMethods = isAdmin || !!permissions.goals?.manage;
  const availableKiosks = user
    ? kiosks.filter((kiosk) => canAccessUnit(user, kiosk.id, { isDefaultAdmin }))
    : [];

  const [activeSection, setActiveSection] = useState<'goals' | 'methods'>('goals');
  const [filterKioskId, setFilterKioskId] = useState<string>('all');
  const [filterPeriod, setFilterPeriod] = useState<GoalPeriod | 'all'>('all');
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
      toast({ title: 'Sync concluido', description: `${result.data.results.length} dias processados.` });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Falha ao sincronizar metas.';
      toast({ title: 'Erro no sync', description: message, variant: 'destructive' });
    }

    setSyncLoading(false);
  }

  const filteredPeriods = useMemo(() => {
    const base = user
      ? periods.filter((period) => canAccessUnit(user, period.kioskId, { isDefaultAdmin }))
      : [];

    return (filterKioskId === 'all' ? base : base.filter(period => period.kioskId === filterKioskId))
      .filter(period => {
        if (filterPeriod === 'all') return true;
        return (templates.find(template => template.id === period.templateId)?.period ?? 'monthly') === filterPeriod;
      })
      .filter(period => period.status === 'active')
      .sort((a, b) => {
        const aDate = a.startDate?.toDate?.()?.getTime?.() ?? 0;
        const bDate = b.startDate?.toDate?.()?.getTime?.() ?? 0;
        return bDate - aDate;
      });
  }, [periods, filterKioskId, filterPeriod, isDefaultAdmin, templates, user]);

  const getKioskName = (id: string) => kiosks.find(kiosk => kiosk.id === id)?.name ?? id;
  const getTemplateType = (templateId: string) => templates.find(template => template.id === templateId)?.type ?? 'revenue';
  const getTemplatePeriod = (templateId: string): GoalPeriod => templates.find(template => template.id === templateId)?.period ?? 'monthly';

  const typeLabels: Record<string, string> = {
    revenue: 'Faturamento',
    ticket: 'Ticket Medio',
    product_line: 'Linha de Produto',
    product_specific: 'Produto Especifico',
  };

  const summary = useMemo(() => {
    const totalTarget = filteredPeriods.reduce((sum, period) => sum + period.targetValue, 0);
    const totalCollaborators = filteredPeriods.reduce(
      (sum, period) => sum + employeeGoals.filter(goal => goal.periodId === period.id).length,
      0
    );
    const unitCount = new Set(filteredPeriods.map(period => period.kioskId)).size;

    return { activeCount: filteredPeriods.length, totalTarget, totalCollaborators, unitCount };
  }, [filteredPeriods, employeeGoals]);

  if (loading) return <Skeleton className="h-64 w-full rounded-2xl" />;

  return (
    <div className="space-y-5">
      <Card className="rounded-2xl border-slate-200 bg-white shadow-sm dark:border-border/40 dark:bg-card/60">
        <CardContent className="space-y-5 p-5 lg:p-6">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-pink-200 bg-pink-50 text-pink-600">Gestao</Badge>
                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">Cadastro de Metas</span>
              </div>
              <h2 className="text-xl font-black tracking-tight">Gestao de metas</h2>
              <p className="max-w-3xl text-sm text-muted-foreground">
                Cadastre metas e configure as formas de calculo usadas nas metas de faturamento.
              </p>
            </div>

            {activeSection === 'goals' && (
              <div className="flex flex-wrap justify-start gap-2 xl:justify-end">
                {isAdmin && (
                  <Button variant="outline" onClick={() => { setSyncOpen(true); setSyncResults(null); }}>
                    <RefreshCw className="mr-2 h-4 w-4" /> Sincronizar Metas
                  </Button>
                )}
                <Button onClick={() => setNewMetaOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" /> Nova Meta
                </Button>
              </div>
            )}
          </div>

          <div className="flex">
            <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1">
              <button
                type="button"
                onClick={() => setActiveSection('goals')}
                className={`inline-flex items-center rounded-xl px-4 py-2 text-sm font-bold transition ${
                  activeSection === 'goals'
                    ? 'bg-white text-pink-700 shadow-sm'
                    : 'text-muted-foreground hover:bg-white/70 hover:text-slate-900'
                }`}
              >
                <CalendarRange className="mr-2 h-4 w-4" />
                Metas
              </button>
              <button
                type="button"
                onClick={() => setActiveSection('methods')}
                className={`inline-flex items-center rounded-xl px-4 py-2 text-sm font-bold transition ${
                  activeSection === 'methods'
                    ? 'bg-white text-pink-700 shadow-sm'
                    : 'text-muted-foreground hover:bg-white/70 hover:text-slate-900'
                }`}
              >
                <Settings2 className="mr-2 h-4 w-4" />
                Formas de meta
              </button>
            </div>
          </div>

          {activeSection === 'goals' && (
            <>
              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:bg-slate-900/30">
                  <div className="text-[9px] font-black uppercase tracking-[0.18em] text-muted-foreground">Metas ativas</div>
                  <div className="mt-1 text-xl font-black">{summary.activeCount}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:bg-slate-900/30">
                  <div className="text-[9px] font-black uppercase tracking-[0.18em] text-muted-foreground">Meta cadastrada</div>
                  <div className="mt-1 text-xl font-black">R$ {fmt(summary.totalTarget)}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:bg-slate-900/30">
                  <div className="text-[9px] font-black uppercase tracking-[0.18em] text-muted-foreground">Unidades</div>
                  <div className="mt-1 text-xl font-black">{summary.unitCount}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:bg-slate-900/30">
                  <div className="text-[9px] font-black uppercase tracking-[0.18em] text-muted-foreground">Colaboradores vinculados</div>
                  <div className="mt-1 text-xl font-black text-blue-600">{summary.totalCollaborators}</div>
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:bg-slate-900/30">
                <div className="min-w-[240px] space-y-1">
                  <Label className="flex items-center gap-2 text-xs font-semibold">
                    <Store className="h-3.5 w-3.5" /> Quiosque
                  </Label>
                  <Select value={filterKioskId} onValueChange={setFilterKioskId}>
                    <SelectTrigger className="bg-white dark:bg-card/60">
                      <SelectValue placeholder="Todos os quiosques" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos os quiosques</SelectItem>
                      {availableKiosks.map(kiosk => <SelectItem key={kiosk.id} value={kiosk.id}>{kiosk.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-[180px] space-y-1">
                  <Label className="flex items-center gap-2 text-xs font-semibold">
                    <CalendarRange className="h-3.5 w-3.5" /> Periodo
                  </Label>
                  <Select value={filterPeriod} onValueChange={value => setFilterPeriod(value as GoalPeriod | 'all')}>
                    <SelectTrigger className="bg-white dark:bg-card/60">
                      <SelectValue placeholder="Todos os periodos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="daily">Diarias</SelectItem>
                      <SelectItem value="weekly">Semanais</SelectItem>
                      <SelectItem value="monthly">Mensais</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="pb-2 text-sm text-muted-foreground">
                  {filteredPeriods.length} meta(s) ativa(s) no filtro
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {activeSection === 'methods' ? (
        <GoalMethodSettings canManage={canManageGoalMethods} />
      ) : (
        <>
          {filteredPeriods.length === 0 ? (
            <Card className="rounded-2xl border-2 border-dashed">
              <CardContent className="py-16 text-center text-muted-foreground">Nenhuma meta ativa.</CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {filteredPeriods.map(period => {
                const templatePeriod = getTemplatePeriod(period.templateId);
                const collaborators = employeeGoals.filter(goal => goal.periodId === period.id).length;
                const type = getTemplateType(period.templateId);

                return (
                  <Card
                    key={period.id}
                    className="overflow-hidden rounded-2xl border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md dark:border-border/40 dark:bg-card/60"
                  >
                    <CardContent className="p-5 lg:p-6">
                      <div className="grid gap-5 xl:grid-cols-[minmax(220px,0.85fr)_minmax(340px,1.15fr)_minmax(240px,0.85fr)_auto] xl:items-center">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className="border-pink-200 bg-pink-50 text-pink-600">
                              {typeLabels[type] ?? type}
                            </Badge>
                            <Badge variant="secondary">{periodKindLabel(templatePeriod)}</Badge>
                          </div>
                          <h3 className="mt-3 truncate text-lg font-black tracking-tight text-slate-950">
                            {getKioskName(period.kioskId)}
                          </h3>
                          <p className="mt-0.5 text-sm text-muted-foreground">
                            {formatPeriodLabel(period, templatePeriod)}
                          </p>
                        </div>

                        <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                          <p className="text-[9px] font-black uppercase tracking-[0.16em] text-muted-foreground">Valores da meta</p>
                          <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
                            <div>
                              <p className="text-[10px] text-muted-foreground">Alvo</p>
                              <p className="font-black">R$ {fmt(period.targetValue)}</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-muted-foreground">UP</p>
                              <p className="font-black">R$ {fmt(period.upValue ?? 0)}</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-muted-foreground">TOP</p>
                              <p className="font-black">{period.topValue ? `R$ ${fmt(period.topValue)}` : '-'}</p>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                          <p className="text-[9px] font-black uppercase tracking-[0.16em] text-muted-foreground">Estrutura</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Badge variant="outline">{period.shifts?.length ? `${period.shifts.length} turno(s)` : 'Sem turnos'}</Badge>
                            <Badge variant="secondary">{collaborators} colaborador(es)</Badge>
                          </div>
                        </div>

                        <div className="flex flex-wrap justify-start gap-2 xl:justify-end">
                          <Button size="sm" variant="outline" onClick={() => { setEmployeeGoalPeriod(period); setEmployeeGoalOpen(true); }}>
                            <Users className="mr-1.5 h-3.5 w-3.5" />
                            Equipe
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive hover:text-destructive"
                            onClick={() => { setClosingPeriod(period); setCloseGoalOpen(true); }}
                          >
                            <XCircle className="mr-1.5 h-3.5 w-3.5" />
                            Encerrar
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setNewMetaOpen(true)}>
                            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                            Copiar
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
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
                <SelectContent>
                  {availableKiosks.map(kiosk => <SelectItem key={kiosk.id} value={kiosk.id}>{kiosk.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>ID Filial PDV Legal</Label>
              <Input
                className="mt-1"
                placeholder="Ex: 12345 (opcional se ja configurado)"
                value={syncFilialId}
                onChange={event => setSyncFilialId(event.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Data inicio</Label>
                <Input type="date" className="mt-1" value={syncStart} onChange={event => setSyncStart(event.target.value)} />
              </div>
              <div>
                <Label>Data fim</Label>
                <Input type="date" className="mt-1" value={syncEnd} onChange={event => setSyncEnd(event.target.value)} />
              </div>
            </div>
            {syncResults && (
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-3">
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
