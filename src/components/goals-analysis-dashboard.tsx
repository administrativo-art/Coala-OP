"use client";

import { Fragment, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { ChevronRight } from 'lucide-react';
import { StatusPill } from '@/components/ui/status-pill';
import { ptBR } from 'date-fns/locale';

import { useGoals } from '@/contexts/goals-context';
import { useKiosks } from '@/hooks/use-kiosks';
import { useAuth } from '@/hooks/use-auth';
import { ControlPanel, ControlIndicator } from '@/components/patterns/control-panel';
import { FilterChips } from '@/components/patterns/filter-chips';
import { GoalsHistoryView, type GoalsHistoryStatus } from '@/components/goals-history-view';
import { Skeleton } from '@/components/ui/skeleton';
import { DarkField, EmptyBox, HoverHint, PanelStat, SectionCard, attainmentTone, darkControlClass, fmtBRL, fmtPct, kickerClass } from '@/components/goals/goals-ui';
import { type EmployeeGoal, type GoalPeriodDoc, type GoalType, type GoalPeriod } from '@/types';
import { getGoalAttainment } from '@/lib/goals-history';
import { buildEmployeeEarnings, getPeriodBonus, periodMonthKey, reachedTier, summarizePrizes, type EmployeeEarningsRow } from '@/lib/goals-earnings';
import { useKioskGroups } from '@/hooks/use-kiosk-groups';
import { getUserDisplayName } from '@/lib/user-display';
import { cn } from '@/lib/utils';

const typeLabels: Record<string, string> = {
  revenue: 'Faturamento',
  ticket: 'Ticket médio',
  product_line: 'Linha de produto',
  product_specific: 'Produto específico',
};

const periodLabels: Record<string, string> = { daily: 'Diária', weekly: 'Semanal', monthly: 'Mensal' };

const roleLabels: Record<string, string> = { fixed: 'Colaborador', relief: 'Folguista', leader: 'Liderança' };

/** Premiação (gravada ou calculada) como % do faturamento dos períodos que têm premiação. */
function prizeShareOf(items: GoalPeriodDoc[], employeeGoals: EmployeeGoal[]) {
  const prized = items.filter(p => getPeriodBonus(p, employeeGoals));
  const revenue = prized.reduce((sum, p) => sum + p.currentValue, 0);
  return revenue > 0 ? (summarizePrizes(items, employeeGoals).totalPrize / revenue) * 100 : null;
}

const tierLabel = { below: 'Abaixo do alvo', target: 'Alvo', up: 'UP', top: 'TOP' } as const;
const tierVariant = { below: 'danger', target: 'warn', up: 'info', top: 'ok' } as const;

/** Faixa atingida e o próximo nível a buscar (alvo → UP → TOP), com quanto faltou para ele. */
function tierProgress(sum: { revenue: number; target: number; up: number; top: number }) {
  const reached = reachedTier({ currentValue: sum.revenue, targetValue: sum.target, upValue: sum.up, topValue: sum.top });
  const next = reached === 'below' ? { label: 'Alvo', value: sum.target }
    : reached === 'target' ? (sum.up > 0 ? { label: 'UP', value: sum.up } : null)
    : reached === 'up' ? (sum.top > 0 ? { label: 'TOP', value: sum.top } : null)
    : null;
  return { reached, next: next ? { ...next, missing: Math.max(next.value - sum.revenue, 0) } : null };
}

function premiumHint(t: { apuratedCount: number; calculatedCount: number; pendingCount: number }) {
  const parts = [];
  if (t.apuratedCount > 0) parts.push(`${t.apuratedCount} apurada(s) no encerramento`);
  if (t.calculatedCount > 0) parts.push(`${t.calculatedCount} calculada(s) pela regra`);
  if (t.pendingCount > 0) parts.push(`${t.pendingCount} sem como calcular`);
  return parts.length ? parts.join(' · ') : 'nenhuma meta por faixas encerrada';
}

const tierMeta = [
  { key: 'below', label: 'Abaixo do alvo', bar: 'bg-ds-danger' },
  { key: 'target', label: 'Alvo', bar: 'bg-ds-warn' },
  { key: 'up', label: 'UP', bar: 'bg-ds-info' },
  { key: 'top', label: 'TOP', bar: 'bg-ds-ok' },
] as const;

function TrendChart({ points }: { points: { key: string; pct: number }[] }) {
  if (points.length < 2) return <p className="px-5 py-8 text-center text-[13px] font-semibold text-ds-ink-faint">São necessários pelo menos 2 meses com metas encerradas para mostrar a tendência.</p>;
  const w = 720, h = 240, padL = 44, padR = 28, padT = 28, padB = 30;
  const values = points.map(p => p.pct);
  const min = Math.max(0, Math.floor((Math.min(...values, 100) - 10) / 10) * 10);
  const max = Math.ceil((Math.max(...values, 100) + 10) / 10) * 10;
  const x = (i: number) => padL + (i * (w - padL - padR)) / (points.length - 1);
  const y = (v: number) => padT + (1 - (v - min) / (max - min)) * (h - padT - padB);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.pct).toFixed(1)}`).join(' ');
  const ticks = [min, 100, max].filter((v, i, all) => all.indexOf(v) === i);
  return (
    <figure className="px-3 py-4">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Atingimento mensal da meta" className="h-auto w-full">
        {ticks.map(tick => (
          <g key={tick}>
            <line x1={padL} x2={w - padR} y1={y(tick)} y2={y(tick)} className={tick === 100 ? 'stroke-ds-ok' : 'stroke-ds-border'} strokeDasharray={tick === 100 ? '4 4' : undefined} />
            <text x={padL - 8} y={y(tick) + 4} textAnchor="end" className={cn('text-[10.5px] font-bold', tick === 100 ? 'fill-ds-ok' : 'fill-ds-ink-muted')}>{tick}%</text>
          </g>
        ))}
        <path d={path} fill="none" className="stroke-ds-accent" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <g key={p.key}>
            <circle cx={x(i)} cy={y(p.pct)} r={4.5} className={p.pct >= 100 ? 'fill-ds-ok' : 'fill-ds-accent'} />
            <text x={x(i)} y={y(p.pct) + (p.pct >= 100 ? -10 : 18)} textAnchor="middle" className="fill-ds-ink text-[11px] font-extrabold" paintOrder="stroke" stroke="var(--ds-surface)" strokeWidth={3}>{Math.round(p.pct)}%</text>
            <text x={x(i)} y={h - 8} textAnchor="middle" className="fill-ds-ink-muted text-[10.5px] font-bold capitalize">{monthLabel(p.key)}</text>
          </g>
        ))}
      </svg>
    </figure>
  );
}

function monthKeyOf(period: GoalPeriodDoc) {
  try {
    return format(period.startDate.toDate(), 'yyyy-MM');
  } catch {
    return '0000-00';
  }
}

function monthLabel(key: string) {
  const [year, month] = key.split('-').map(Number);
  if (!year || !month) return key;
  return format(new Date(year, month - 1, 1), "MMM/yy", { locale: ptBR });
}

export function GoalsAnalysisDashboard({ initialTab = 'overview' }: { initialTab?: 'overview' | 'closures' }) {
  const { periods, templates, employeeGoals, loading } = useGoals();
  const { kiosks } = useKiosks();
  const { users } = useAuth();

  const [tab, setTab] = useState<'overview' | 'closures'>(initialTab);
  const [filterStatus, setFilterStatus] = useState<GoalsHistoryStatus | null>(null);
  const [filterKioskId, setFilterKioskId] = useState('all');
  const [filterGroupId, setFilterGroupId] = useState<string | null>(null);
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [perfView, setPerfView] = useState<'general' | 'group' | 'unit'>('general');
  const [perfTarget, setPerfTarget] = useState('all');
  const { groups: kioskGroups, groupOf, hasMultipleGroups } = useKioskGroups();
  const [filterType, setFilterType] = useState<GoalType | 'all'>('all');
  const [filterPeriod, setFilterPeriod] = useState<GoalPeriod | 'all'>('all');
  const [filterDateStart, setFilterDateStart] = useState('');
  const [filterDateEnd, setFilterDateEnd] = useState('');

  const getKioskName = (id: string) => kiosks.find(k => k.id === id)?.name ?? id;
  const usersById = useMemo(() => Object.fromEntries(users.map(u => [u.id, u])), [users]);
  const getUserName = (id: string) => getUserDisplayName(usersById[id], id);

  const closedPeriods = useMemo(() => {
    const templateById = new Map(templates.map(t => [t.id, t]));
    return periods
      .filter(period => period.status === 'closed')
      .filter(period => {
        if (filterKioskId !== 'all' && period.kioskId !== filterKioskId) return false;
        if (filterGroupId !== null && groupOf(period.kioskId).id !== filterGroupId) return false;
        const template = templateById.get(period.templateId);
        if (filterType !== 'all' && template?.type !== filterType) return false;
        if (filterPeriod !== 'all' && template?.period !== filterPeriod) return false;
        try {
          if (filterDateStart && period.startDate.toDate() < new Date(`${filterDateStart}T00:00:00`)) return false;
          if (filterDateEnd && period.endDate.toDate() > new Date(`${filterDateEnd}T23:59:59`)) return false;
        } catch { /* período sem datas válidas não é filtrado por data */ }
        return true;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periods, templates, filterKioskId, filterGroupId, kioskGroups, filterType, filterPeriod, filterDateStart, filterDateEnd]);

  const totals = useMemo(() => {
    const target = closedPeriods.reduce((sum, p) => sum + p.targetValue, 0);
    const revenue = closedPeriods.reduce((sum, p) => sum + p.currentValue, 0);
    return {
      target,
      revenue,
      pct: target > 0 ? (revenue / target) * 100 : 0,
      hits: closedPeriods.filter(p => getGoalAttainment(p) >= 100).length,
      prizeShare: prizeShareOf(closedPeriods, employeeGoals),
      ...summarizePrizes(closedPeriods, employeeGoals),
    };
  }, [closedPeriods, employeeGoals]);

  /** Meses cobertos pela análise: deixa claro o que está sendo analisado antes de qualquer filtro. */
  const coverage = useMemo(() => {
    const keys = [...new Set(closedPeriods.map(periodMonthKey))].sort();
    return { keys, first: keys[0], last: keys[keys.length - 1] };
  }, [closedPeriods]);
  const hasDateFilter = Boolean(filterDateStart || filterDateEnd);

  const monthly = useMemo(() => {
    const groups = new Map<string, GoalPeriodDoc[]>();
    for (const period of closedPeriods) {
      const key = monthKeyOf(period);
      groups.set(key, [...(groups.get(key) ?? []), period]);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, items]) => {
        const target = items.reduce((sum, p) => sum + p.targetValue, 0);
        const revenue = items.reduce((sum, p) => sum + p.currentValue, 0);
        const byKiosk = new Map<string, GoalPeriodDoc[]>();
        for (const period of items) byKiosk.set(period.kioskId, [...(byKiosk.get(period.kioskId) ?? []), period]);
        const units = [...byKiosk.entries()]
          .map(([kioskId, list]) => {
            const unitTarget = list.reduce((sum, p) => sum + p.targetValue, 0);
            const unitRevenue = list.reduce((sum, p) => sum + p.currentValue, 0);
            const up = list.reduce((sum, p) => sum + (p.upValue ?? 0), 0);
            const top = list.reduce((sum, p) => sum + (p.topValue ?? 0), 0);
            return { kioskId, name: getKioskName(kioskId), target: unitTarget, revenue: unitRevenue, tier: tierProgress({ revenue: unitRevenue, target: unitTarget, up, top }), pct: unitTarget > 0 ? (unitRevenue / unitTarget) * 100 : 0, ...summarizePrizes(list, employeeGoals) };
          })
          .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
        const tierCounts = units.reduce((acc, unit) => { acc[unit.tier.reached] += 1; return acc; }, { below: 0, target: 0, up: 0, top: 0 });
        return { key, count: items.length, target, revenue, tierCounts, pct: target > 0 ? (revenue / target) * 100 : 0, units, prizeShare: prizeShareOf(items, employeeGoals), ...summarizePrizes(items, employeeGoals) };
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closedPeriods, employeeGoals, kiosks]);

  const kioskRows = useMemo(() => {
    const groups = new Map<string, GoalPeriodDoc[]>();
    for (const period of closedPeriods) groups.set(period.kioskId, [...(groups.get(period.kioskId) ?? []), period]);
    return [...groups.entries()]
      .map(([kioskId, items]) => ({
        kioskId,
        name: getKioskName(kioskId),
        count: items.length,
        monthKeys: [...new Set(items.map(periodMonthKey))].sort(),
        avg: items.reduce((sum, p) => sum + getGoalAttainment(p), 0) / items.length,
        best: Math.max(...items.map(getGoalAttainment)),
        hits: items.filter(p => getGoalAttainment(p) >= 100).length,
        tiers: items.reduce((acc, p) => { acc[reachedTier(p)] += 1; return acc; }, { below: 0, target: 0, up: 0, top: 0 }),
        prizeShare: prizeShareOf(items, employeeGoals),
        ...summarizePrizes(items, employeeGoals),
      }))
      .sort((a, b) => b.avg - a.avg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closedPeriods, kiosks, employeeGoals]);

  const earnings = useMemo(() => buildEmployeeEarnings(closedPeriods, employeeGoals), [closedPeriods, employeeGoals]);

  /** Desempenho dos colaboradores em seções: geral, por grupo ou por unidade (com escolha opcional de um alvo). */
  const performanceSections = useMemo(() => {
    type PerfRow = EmployeeEarningsRow & { groupLabel?: string };
    if (perfView === 'general') {
      // Quem atua em unidades de grupos diferentes aparece em uma linha por grupo; dentro de um mesmo grupo o resultado é somado.
      const perGroup = kioskGroups.map(group => ({
        group,
        rows: buildEmployeeEarnings(closedPeriods.filter(p => group.kioskIds.includes(p.kioskId)), employeeGoals),
      }));
      const groupsByEmployee = new Map<string, number>();
      for (const { rows } of perGroup) for (const row of rows) groupsByEmployee.set(row.employeeId, (groupsByEmployee.get(row.employeeId) ?? 0) + 1);
      const rows: PerfRow[] = perGroup.flatMap(({ group, rows: groupRows }) =>
        groupRows.map(row => ((groupsByEmployee.get(row.employeeId) ?? 0) > 1 ? { ...row, groupLabel: group.name } : row)));
      return [{ id: 'general', title: 'Todos os colaboradores', rows }];
    }
    const sections: { id: string; title: string; rows: PerfRow[] }[] = [];
    if (perfView === 'group') {
      for (const group of kioskGroups) {
        if (perfTarget !== 'all' && perfTarget !== group.id) continue;
        const rows = buildEmployeeEarnings(closedPeriods.filter(p => group.kioskIds.includes(p.kioskId)), employeeGoals);
        if (rows.length > 0) sections.push({ id: group.id, title: group.name, rows });
      }
    } else {
      const kioskIds = [...new Set(closedPeriods.map(p => p.kioskId))].sort((a, b) => getKioskName(a).localeCompare(getKioskName(b), 'pt-BR'));
      for (const kioskId of kioskIds) {
        if (perfTarget !== 'all' && perfTarget !== kioskId) continue;
        const rows = buildEmployeeEarnings(closedPeriods.filter(p => p.kioskId === kioskId), employeeGoals);
        if (rows.length > 0) sections.push({ id: kioskId, title: getKioskName(kioskId), rows });
      }
    }
    return sections;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfView, perfTarget, kioskGroups, closedPeriods, employeeGoals, kiosks]);

  const perfTargets = useMemo(() => {
    if (perfView === 'group') return kioskGroups.map(group => ({ id: group.id, name: group.name }));
    if (perfView === 'unit') return [...new Set(closedPeriods.map(p => p.kioskId))].map(id => ({ id, name: getKioskName(id) })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    return [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfView, kioskGroups, closedPeriods, kiosks]);

  const scopedPeriods = useMemo(
    () => periods.filter(p => (filterKioskId === 'all' || p.kioskId === filterKioskId) && (filterGroupId === null || groupOf(p.kioskId).id === filterGroupId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [periods, filterKioskId, filterGroupId, kioskGroups],
  );
  const statusCounts = useMemo(() => ({
    active: scopedPeriods.filter(p => p.status === 'active').length,
    closed: scopedPeriods.filter(p => p.status === 'closed').length,
    cancelled: scopedPeriods.filter(p => p.status === 'cancelled').length,
  }), [scopedPeriods]);
  const statusPrize = useMemo(() => summarizePrizes(scopedPeriods, employeeGoals), [scopedPeriods, employeeGoals]);

  if (loading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-5 font-ds">
      <ControlPanel>
        <p className={cn(kickerClass, 'text-ds-accent-kicker')}>Metas de vendas</p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-2xl font-extrabold">Análise</h1>
          <p className="max-w-xl text-[13px] font-semibold text-ds-on-dark-sub">
            {tab === 'overview' ? 'Tendência, faixas atingidas e desempenho das metas encerradas. Cada meta é um quiosque em um mês.' : 'Fechamentos mês a mês: o que foi pago a cada colaborador, com folha de premiação para exportar.'}
          </p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Seções da análise">
          {([['overview', 'Visão geral'], ['closures', 'Fechamentos']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn(
                'inline-flex h-[34px] items-center whitespace-nowrap rounded-ds-pill border px-[14px] text-[13px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-kicker focus-visible:ring-offset-2 focus-visible:ring-offset-ds-dark',
                tab === key ? 'border-ds-accent bg-ds-accent text-white' : 'border-white/[.12] text-ds-on-dark-2 hover:bg-white/[.06]',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'overview' ? (
          <>
            <p className="mt-4 text-[12.5px] font-bold text-ds-on-dark-2">
              {coverage.keys.length === 0
                ? 'Nenhuma meta encerrada no filtro.'
                : <>Analisando {coverage.keys.length} {coverage.keys.length === 1 ? 'mês' : 'meses'} com metas encerradas: <span className="capitalize">{monthLabel(coverage.first!)}</span>{coverage.first !== coverage.last && <> a <span className="capitalize">{monthLabel(coverage.last!)}</span></>}. {hasDateFilter ? 'Período filtrado abaixo.' : 'Sem filtro de datas: considera todo o histórico.'}</>}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-5">
              <PanelStat
                label="Realizado"
                value={fmtBRL(totals.revenue)}
                tone={totals.pct >= 100 ? 'text-ds-ok' : totals.pct >= 80 ? 'text-ds-warn' : 'text-ds-danger'}
                hint={`${fmtPct(totals.pct)} da meta de ${fmtBRL(totals.target)}`}
              />
              <PanelStat label="Metas batidas" value={`${totals.hits} de ${closedPeriods.length}`} hint="cada meta = um quiosque em um mês" />
              <PanelStat label="Premiação" value={fmtBRL(totals.totalPrize)} tone="text-ds-ok" hint={premiumHint(totals)} />
              <PanelStat label="Premiação / faturamento" value={totals.prizeShare === null ? '—' : fmtPct(totals.prizeShare)} hint="custo da premiação sobre o realizado" />
              <PanelStat label="Colaboradores" value={earnings.length} hint="com meta no filtro" />
            </div>
            <div className="mt-5 grid grid-cols-1 gap-3 border-t border-white/10 pt-5 sm:grid-cols-2 lg:grid-cols-4">
              <DarkField label="Tipo de meta">
                <select className={darkControlClass} value={filterType} onChange={e => setFilterType(e.target.value as GoalType | 'all')}>
                  <option value="all">Todos</option>
                  {Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </DarkField>
              <DarkField label="Periodicidade">
                <select className={darkControlClass} value={filterPeriod} onChange={e => setFilterPeriod(e.target.value as GoalPeriod | 'all')}>
                  <option value="all">Todas</option>
                  {Object.entries(periodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </DarkField>
              <DarkField label="Início">
                <input type="date" className={darkControlClass} value={filterDateStart} onChange={e => setFilterDateStart(e.target.value)} />
              </DarkField>
              <DarkField label="Fim">
                <input type="date" className={darkControlClass} value={filterDateEnd} onChange={e => setFilterDateEnd(e.target.value)} />
              </DarkField>
            </div>
          </>
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-4">
            <ControlIndicator value={statusCounts.active} label="Ativas" tone="info" active={filterStatus === 'active'} onClick={() => setFilterStatus(filterStatus === 'active' ? null : 'active')} />
            <ControlIndicator value={statusCounts.closed} label="Encerradas" tone="neutral" active={filterStatus === 'closed'} onClick={() => setFilterStatus(filterStatus === 'closed' ? null : 'closed')} />
            <ControlIndicator value={statusCounts.cancelled} label="Canceladas" tone="danger" active={filterStatus === 'cancelled'} onClick={() => setFilterStatus(filterStatus === 'cancelled' ? null : 'cancelled')} />
            <PanelStat label="Premiação" value={fmtBRL(statusPrize.totalPrize)} tone="text-ds-ok" hint={premiumHint(statusPrize)} />
          </div>
        )}

        {hasMultipleGroups && (
          <div className="mt-5">
            <p className={cn(kickerClass, 'mb-2 text-ds-on-dark-muted')}>Grupo</p>
            <FilterChips
              value={filterGroupId}
              onChange={value => {
                setFilterGroupId(value);
                const group = kioskGroups.find(item => item.id === value);
                if (group && filterKioskId !== 'all' && !group.kioskIds.includes(filterKioskId)) setFilterKioskId('all');
              }}
              allLabel="Todos os grupos"
              chips={kioskGroups.map(group => ({ value: group.id, label: group.name, count: group.kioskIds.length }))}
            />
          </div>
        )}
        <div className={hasMultipleGroups ? 'mt-4' : 'mt-5'}>
          {hasMultipleGroups && <p className={cn(kickerClass, 'mb-2 text-ds-on-dark-muted')}>Unidade</p>}
          <FilterChips
            value={filterKioskId === 'all' ? null : filterKioskId}
            onChange={value => setFilterKioskId(value ?? 'all')}
            allLabel={filterGroupId ? 'Todas do grupo' : 'Todas as unidades'}
            chips={kiosks.filter(k => filterGroupId === null || groupOf(k.id).id === filterGroupId).map(k => ({ value: k.id, label: k.name }))}
          />
        </div>
      </ControlPanel>

      {tab === 'closures' ? (
        <GoalsHistoryView kioskId={filterKioskId === 'all' ? null : filterKioskId} groupId={filterGroupId} status={filterStatus} />
      ) : closedPeriods.length === 0 ? (
        <EmptyBox>Nenhuma meta encerrada encontrada para esses filtros.</EmptyBox>
      ) : (
        <>
          <SectionCard title="Tendência do atingimento" subtitle="Cada ponto é um mês com metas encerradas (até os últimos 12), somando as unidades do filtro; a linha tracejada é 100%. Na tabela, clique no mês para ver a meta e o realizado de cada unidade.">
            <TrendChart points={monthly.slice(-12).map(row => ({ key: row.key, pct: row.pct }))} />
            <div className="overflow-x-auto border-t border-ds-divider">
              <table className="w-full min-w-[860px] text-left text-[13px]">
                <thead>
                  <tr className={cn(kickerClass, 'text-ds-ink-faint')}>
                    <th className="px-5 py-3 font-extrabold">Mês</th>
                    <th className="px-3 py-3 text-right font-extrabold" title="Metas encerradas no mês (quiosque × mês)">Metas</th>
                    <th className="px-3 py-3 text-right font-extrabold">Alvo</th>
                    <th className="px-3 py-3 text-right font-extrabold">Realizado</th>
                    <th className="px-3 py-3 text-right font-extrabold">Atingimento</th>
                    <th className="px-3 py-3 text-left font-extrabold">Faixa e próximo nível</th>
                    <th className="px-3 py-3 text-right font-extrabold">Premiação</th>
                    <th className="px-5 py-3 text-right font-extrabold">% do faturamento</th>
                  </tr>
                </thead>
                <tbody>
                  {monthly.map(row => {
                    const open = expandedMonths.has(row.key);
                    return (
                      <Fragment key={row.key}>
                        <tr className="border-t border-ds-divider">
                          <td className="px-5 py-2.5 font-extrabold capitalize text-ds-ink">
                            <button
                              type="button"
                              aria-expanded={open}
                              aria-label={`${open ? 'Recolher' : 'Expandir'} unidades de ${monthLabel(row.key)}`}
                              onClick={() => setExpandedMonths(prev => { const next = new Set(prev); if (next.has(row.key)) next.delete(row.key); else next.add(row.key); return next; })}
                              className="inline-flex items-center gap-1.5 rounded-ds-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink"
                            >
                              <ChevronRight aria-hidden="true" className={cn('h-4 w-4 text-ds-ink-faint transition-transform motion-reduce:transition-none', open && 'rotate-90')} />
                              {monthLabel(row.key)}
                            </button>
                          </td>
                          <td className="px-3 py-2.5 text-right font-semibold text-ds-ink-2">{row.count}</td>
                          <td className="px-3 py-2.5 text-right font-semibold text-ds-ink-muted">{fmtBRL(row.target)}</td>
                          <td className="px-3 py-2.5 text-right font-bold text-ds-ink">{fmtBRL(row.revenue)}</td>
                          <td className={cn('px-3 py-2.5 text-right font-extrabold', attainmentTone(row.pct))}>{fmtPct(row.pct)}</td>
                          <td className="px-3 py-2.5 text-[12px] font-semibold text-ds-ink-muted">
                            {(['top', 'up', 'target', 'below'] as const).filter(key => row.tierCounts[key] > 0).map(key => `${row.tierCounts[key]}× ${tierLabel[key]}`).join(' · ')}
                          </td>
                          <td className="px-3 py-2.5 text-right font-extrabold text-ds-ok">{(row.apuratedCount + row.calculatedCount) > 0 ? fmtBRL(row.totalPrize) : <span className="font-semibold text-ds-ink-faint">—</span>}</td>
                          <td className="px-5 py-2.5 text-right font-semibold text-ds-ink-2">{row.prizeShare === null ? '—' : fmtPct(row.prizeShare)}</td>
                        </tr>
                        {open && row.units.map(unit => (
                          <tr key={unit.kioskId} className="border-t border-ds-divider bg-ds-warm">
                            <td className="py-2 pl-12 pr-3 text-[12.5px] font-bold text-ds-ink-2">{unit.name}</td>
                            <td className="px-3 py-2 text-right text-[12.5px] font-semibold text-ds-ink-muted">1</td>
                            <td className="px-3 py-2 text-right text-[12.5px] font-semibold text-ds-ink-muted">{fmtBRL(unit.target)}</td>
                            <td className="px-3 py-2 text-right text-[12.5px] font-bold text-ds-ink">{fmtBRL(unit.revenue)}</td>
                            <td className={cn('px-3 py-2 text-right text-[12.5px] font-extrabold', attainmentTone(unit.pct))}>{fmtPct(unit.pct)}</td>
                            <td className="px-3 py-2">
                              <StatusPill variant={tierVariant[unit.tier.reached]}>{tierLabel[unit.tier.reached]}</StatusPill>
                              <span className="ml-2 text-[12px] font-semibold text-ds-ink-muted">
                                {unit.tier.next ? `próximo: ${unit.tier.next.label} ${fmtBRL(unit.tier.next.value)} (faltou ${fmtBRL(unit.tier.next.missing)})` : 'nível máximo atingido'}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right text-[12.5px] font-extrabold text-ds-ok">{(unit.apuratedCount + unit.calculatedCount) > 0 ? fmtBRL(unit.totalPrize) : <span className="font-semibold text-ds-ink-faint">—</span>}</td>
                            <td className="px-5 py-2" />
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </SectionCard>

          <SectionCard title="Faixas atingidas por quiosque" subtitle="Em que faixa cada quiosque costuma parar. Se quase tudo fica em um extremo, a meta pode estar fácil ou difícil demais.">
            <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
              {kioskRows.map(item => {
                const gap = item.avg - totals.pct;
                return (
                  <div key={item.kioskId} className="rounded-ds-md border border-ds-border bg-ds-warm p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[14px] font-extrabold text-ds-ink">{item.name}</div>
                        <div className="text-[12px] font-semibold text-ds-ink-muted">{item.count} meta(s) encerrada(s)<HoverHint label={`Meses das metas de ${item.name}`}>{item.monthKeys.map(monthLabel).join(', ')}</HoverHint> · melhor {fmtPct(item.best, 0)}</div>
                      </div>
                      <div className="text-right">
                        <div className={cn('text-[22px] font-extrabold leading-none', attainmentTone(item.avg))}>{fmtPct(item.avg, 0)}</div>
                        {Math.abs(gap) >= 10 && <div className={cn('mt-1 text-[11px] font-extrabold', gap < 0 ? 'text-ds-danger' : 'text-ds-ok')}>{gap < 0 ? 'abaixo' : 'acima'} da média ({gap > 0 ? '+' : ''}{gap.toFixed(0)} p.p.)</div>}
                      </div>
                    </div>
                    <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-ds-muted" role="img" aria-label={tierMeta.map(t => `${t.label}: ${item.tiers[t.key]}`).join(', ')}>
                      {tierMeta.map(t => item.tiers[t.key] > 0 && <div key={t.key} className={t.bar} style={{ width: `${(item.tiers[t.key] / item.count) * 100}%` }} />)}
                    </div>
                    <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[12px] font-semibold text-ds-ink-2">
                      {tierMeta.map(t => (
                        <li key={t.key} className="flex items-center gap-1.5"><span className={cn('h-2 w-2 rounded-full', t.bar)} aria-hidden="true" />{t.label}: <b className="text-ds-ink">{item.tiers[t.key]}</b></li>
                      ))}
                    </ul>
                    <p className="mt-3 text-[12px] font-semibold text-ds-ink-muted">Premiação / faturamento: <b className="text-ds-ink">{item.prizeShare === null ? '—' : fmtPct(item.prizeShare)}</b></p>
                  </div>
                );
              })}
            </div>
          </SectionCard>

          <SectionCard
            title="Desempenho dos colaboradores"
            subtitle="Atingimento individual e tendência. Em Geral e Por grupo o resultado soma as unidades do mesmo grupo; quem atua em grupos diferentes aparece separado por grupo. Valores pagos ficam na aba Fechamentos."
            action={(
              <div className="flex flex-wrap items-center gap-2">
                <div role="radiogroup" aria-label="Agrupar desempenho" className="inline-flex rounded-[11px] bg-ds-seg p-[3px]">
                  {([['general', 'Geral'], ['group', 'Por grupo'], ['unit', 'Por unidade']] as const).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      role="radio"
                      aria-checked={perfView === key}
                      onClick={() => { setPerfView(key); setPerfTarget('all'); }}
                      className={cn(
                        'h-8 rounded-[9px] px-3.5 text-[13px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink',
                        perfView === key ? 'bg-ds-surface text-ds-ink shadow-[0_1px_2px_rgba(0,0,0,.08)]' : 'text-ds-ink-muted hover:text-ds-ink',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {perfView !== 'general' && (
                  <select
                    aria-label={perfView === 'group' ? 'Escolher grupo' : 'Escolher unidade'}
                    value={perfTarget}
                    onChange={event => setPerfTarget(event.target.value)}
                    className="h-9 rounded-ds-btn border border-ds-border-input bg-ds-surface px-3 text-[13px] font-bold text-ds-ink outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink"
                  >
                    <option value="all">{perfView === 'group' ? 'Todos os grupos' : 'Todas as unidades'}</option>
                    {perfTargets.map(target => <option key={target.id} value={target.id}>{target.name}</option>)}
                  </select>
                )}
              </div>
            )}
          >
            {performanceSections.length === 0 ? (
              <p className="px-5 py-8 text-center text-[13px] font-semibold text-ds-ink-faint">Nenhum colaborador vinculado aos períodos filtrados.</p>
            ) : (
              <div className="divide-y divide-ds-divider">
                {performanceSections.map(section => (
                  <div key={section.id}>
                    {perfView !== 'general' && (
                      <div className="flex items-center justify-between bg-ds-warm px-5 py-2.5">
                        <h3 className={cn(kickerClass, 'text-ds-accent-ink')}>{perfView === 'group' ? 'Grupo' : 'Unidade'} · {section.title}</h3>
                        <span className="text-[12px] font-bold text-ds-ink-muted">{section.rows.length} colaborador(es)</span>
                      </div>
                    )}
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[680px] text-left text-[13px]">
                        <thead>
                          <tr className={cn(kickerClass, 'text-ds-ink-faint')}>
                            <th className="px-5 py-3 font-extrabold">Colaborador</th>
                            <th className="px-3 py-3 text-right font-extrabold">Metas</th>
                            <th className="px-3 py-3 text-right font-extrabold">% médio</th>
                            <th className="px-3 py-3 text-right font-extrabold">Melhor</th>
                            <th className="px-5 py-3 text-right font-extrabold">Tendência</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...section.rows].sort((a, b) => b.avgAttainment - a.avgAttainment).map(row => (
                            <tr key={row.employeeId} className="border-t border-ds-divider">
                              <td className="px-5 py-2.5">
                                <div className="font-extrabold text-ds-ink">{getUserName(row.employeeId)}</div>
                                <div className="text-[12px] font-semibold text-ds-ink-muted">
                                  {row.role ? roleLabels[row.role] : '—'} · {row.kioskIds.map(getKioskName).join(', ')}
                                  {'groupLabel' in row && row.groupLabel && <span className="ml-2 rounded-ds-pill bg-ds-info-bg px-2 py-0.5 text-[11px] font-bold text-ds-info">Grupo {row.groupLabel}</span>}
                                </div>
                              </td>
                              <td className="px-3 py-2.5 text-right font-semibold text-ds-ink-2">
                                {row.periodCount}
                                <HoverHint label={`Meses das metas de ${getUserName(row.employeeId)}`}>{row.monthKeys.map(monthLabel).join(', ') || '—'}</HoverHint>
                              </td>
                              <td className={cn('px-3 py-2.5 text-right font-extrabold', attainmentTone(row.avgAttainment))}>{fmtPct(row.avgAttainment)}</td>
                              <td className="px-3 py-2.5 text-right font-semibold text-ds-ink-2">{fmtPct(row.bestAttainment, 0)}</td>
                              <td className="px-5 py-2.5 text-right font-extrabold">
                                {row.trend === null ? <span className="font-semibold text-ds-ink-faint" title="Precisa de pelo menos 4 metas">—</span> : (
                                  <span className={row.trend >= 0 ? 'text-ds-ok' : 'text-ds-danger'}>{row.trend >= 0 ? '▲' : '▼'} {Math.abs(row.trend).toFixed(1)} p.p.</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}
