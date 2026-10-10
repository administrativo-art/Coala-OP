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
  Users,
  XCircle,
} from 'lucide-react';

import { functions } from '@/lib/firebase';
import { useGoals } from '@/contexts/goals-context';
import { useKiosks } from '@/hooks/use-kiosks';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { type GoalPeriod, type GoalPeriodDoc } from '@/types';
import { ControlPanel } from '@/components/patterns/control-panel';
import { FilterChips } from '@/components/patterns/filter-chips';
import { DarkField, EmptyBox, PanelStat, darkControlClass, kickerClass } from '@/components/goals/goals-ui';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
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
  if (period === 'daily') return 'Diária';
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
      toast({ title: 'Sincronização concluída', description: `${result.data.results.length} dias processados.` });
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
    ticket: 'Ticket médio',
    product_line: 'Linha de Produto',
    product_specific: 'Produto específico',
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

  if (loading) return <Skeleton className="h-64 w-full rounded-ds-card" />;

  const sectionTab = (key: 'goals' | 'methods', label: string, Icon: typeof CalendarRange) => (
    <button
      type="button"
      aria-pressed={activeSection === key}
      onClick={() => setActiveSection(key)}
      className={cn(
        'inline-flex h-[34px] items-center gap-2 whitespace-nowrap rounded-ds-pill border px-[14px] text-[13px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-kicker focus-visible:ring-offset-2 focus-visible:ring-offset-ds-dark',
        activeSection === key ? 'border-ds-accent bg-ds-accent text-white' : 'border-white/[.12] text-ds-on-dark-2 hover:bg-white/[.06]',
      )}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5" />{label}
    </button>
  );

  return (
    <div className="space-y-5 font-ds">
      <ControlPanel>
        <p className={cn(kickerClass, 'text-ds-accent-kicker')}>Metas de vendas</p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold">Cadastro de metas</h1>
            <p className="mt-1 max-w-2xl text-[13px] font-semibold text-ds-on-dark-sub">Cadastre metas e configure as formas de cálculo usadas nas metas de faturamento.</p>
          </div>
          {activeSection === 'goals' && (
            <div className="flex flex-wrap gap-2">
              {isAdmin && (
                <Button variant="ds-secondary" size="md" onClick={() => { setSyncOpen(true); setSyncResults(null); }}>
                  <RefreshCw aria-hidden="true" className="mr-2 h-4 w-4" />Sincronizar metas
                </Button>
              )}
              <Button variant="primary-page" size="md" onClick={() => setNewMetaOpen(true)}>
                <Plus aria-hidden="true" className="mr-2 h-4 w-4" />Nova meta
              </Button>
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {sectionTab('goals', 'Metas', CalendarRange)}
          {sectionTab('methods', 'Formas de meta', Settings2)}
        </div>

        {activeSection === 'goals' && (
          <>
            <div className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-4">
              <PanelStat label="Metas ativas" value={summary.activeCount} />
              <PanelStat label="Meta cadastrada" value={`R$ ${fmt(summary.totalTarget)}`} />
              <PanelStat label="Unidades" value={summary.unitCount} />
              <PanelStat label="Colaboradores vinculados" value={summary.totalCollaborators} tone="text-ds-info" />
            </div>
            <div className="mt-5 flex flex-wrap items-end gap-4 border-t border-white/10 pt-5">
              <FilterChips
                className="flex-1"
                value={filterKioskId === 'all' ? null : filterKioskId}
                onChange={value => setFilterKioskId(value ?? 'all')}
                allLabel="Todos os quiosques"
                chips={availableKiosks.map(kiosk => ({ value: kiosk.id, label: kiosk.name }))}
              />
              <div className="w-48">
                <DarkField label="Periodicidade">
                  <select className={darkControlClass} value={filterPeriod} onChange={event => setFilterPeriod(event.target.value as GoalPeriod | 'all')}>
                    <option value="all">Todas</option>
                    <option value="daily">Diárias</option>
                    <option value="weekly">Semanais</option>
                    <option value="monthly">Mensais</option>
                  </select>
                </DarkField>
              </div>
            </div>
            <p className="mt-3 text-[12.5px] font-bold text-ds-on-dark-muted">{filteredPeriods.length} meta(s) ativa(s) no filtro</p>
          </>
        )}
      </ControlPanel>

      {activeSection === 'methods' ? (
        <GoalMethodSettings canManage={canManageGoalMethods} />
      ) : filteredPeriods.length === 0 ? (
        <EmptyBox>Nenhuma meta ativa para esses filtros.</EmptyBox>
      ) : (
        <div className="space-y-3">
          {filteredPeriods.map(period => {
            const templatePeriod = getTemplatePeriod(period.templateId);
            const collaborators = employeeGoals.filter(goal => goal.periodId === period.id).length;
            const type = getTemplateType(period.templateId);

            return (
              <article
                key={period.id}
                className="rounded-ds-card border border-ds-border bg-ds-surface p-5 transition-[transform,box-shadow] duration-[180ms] ease-ds-lift hover:-translate-y-[2px] hover:shadow-ds-lift motion-reduce:hover:translate-y-0"
              >
                <div className="grid gap-5 xl:grid-cols-[minmax(200px,0.8fr)_minmax(320px,1.2fr)_minmax(200px,0.7fr)_auto] xl:items-center">
                  <div className="min-w-0">
                    <p className={cn(kickerClass, 'text-ds-accent-ink')}>{typeLabels[type] ?? type} · {periodKindLabel(templatePeriod)}</p>
                    <h3 className="mt-1 truncate text-[18px] font-extrabold text-ds-ink">{getKioskName(period.kioskId)}</h3>
                    <p className="mt-0.5 text-[13px] font-semibold capitalize text-ds-ink-muted">{formatPeriodLabel(period, templatePeriod)}</p>
                  </div>

                  <dl className="grid grid-cols-3 gap-3 rounded-ds-md bg-ds-warm px-4 py-3">
                    <div><dt className={cn(kickerClass, 'text-ds-ink-faint')}>Alvo</dt><dd className="mt-0.5 text-[14px] font-extrabold text-ds-ink">R$ {fmt(period.targetValue)}</dd></div>
                    <div><dt className={cn(kickerClass, 'text-ds-ink-faint')}>UP</dt><dd className="mt-0.5 text-[14px] font-extrabold text-ds-ink">R$ {fmt(period.upValue ?? 0)}</dd></div>
                    <div><dt className={cn(kickerClass, 'text-ds-ink-faint')}>TOP</dt><dd className="mt-0.5 text-[14px] font-extrabold text-ds-ink">{period.topValue ? `R$ ${fmt(period.topValue)}` : '—'}</dd></div>
                  </dl>

                  <div className="text-[13px] font-semibold text-ds-ink-2">
                    <p className={cn(kickerClass, 'text-ds-ink-faint')}>Estrutura</p>
                    <p className="mt-0.5">{period.shifts?.length ? `${period.shifts.length} turno(s)` : 'Sem turnos'}</p>
                    <p className="text-ds-ink-muted">{collaborators} colaborador(es)</p>
                  </div>

                  <div className="flex flex-wrap gap-2 xl:justify-end">
                    <Button size="sm" variant="ds-secondary" onClick={() => { setEmployeeGoalPeriod(period); setEmployeeGoalOpen(true); }}>
                      <Users aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />Equipe
                    </Button>
                    <Button size="sm" variant="ds-secondary" onClick={() => setNewMetaOpen(true)}>
                      <Sparkles aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />Copiar
                    </Button>
                    <Button size="sm" variant="danger-link" onClick={() => { setClosingPeriod(period); setCloseGoalOpen(true); }}>
                      <XCircle aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />Encerrar
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
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
