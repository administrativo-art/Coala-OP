"use client";

import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { useGoals } from '@/contexts/goals-context';
import { useKiosks } from '@/hooks/use-kiosks';
import { useAuth } from '@/hooks/use-auth';
import { ControlPanel, ControlIndicator } from '@/components/patterns/control-panel';
import { FilterChips } from '@/components/patterns/filter-chips';
import { GoalsHistoryView, type GoalsHistoryStatus } from '@/components/goals-history-view';
import { Skeleton } from '@/components/ui/skeleton';
import { DarkField, EmptyBox, PanelStat, SectionCard, attainmentTone, darkControlClass, fmtBRL, fmtPct, kickerClass } from '@/components/goals/goals-ui';
import { type GoalPeriodDoc, type GoalType, type GoalPeriod } from '@/types';
import { getGoalAttainment } from '@/lib/goals-history';
import { buildEmployeeEarnings, reachedTier, summarizePrizes } from '@/lib/goals-earnings';
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

/** Premiação apurada como % do faturamento dos mesmos períodos. */
function prizeShareOf(items: GoalPeriodDoc[]) {
  const apurated = items.filter(p => p.closureSnapshot?.bonus);
  const revenue = apurated.reduce((sum, p) => sum + p.currentValue, 0);
  return revenue > 0 ? (summarizePrizes(items).totalPrize / revenue) * 100 : null;
}

const tierMeta = [
  { key: 'below', label: 'Abaixo do alvo', bar: 'bg-ds-danger' },
  { key: 'target', label: 'Alvo', bar: 'bg-ds-warn' },
  { key: 'up', label: 'UP', bar: 'bg-ds-info' },
  { key: 'top', label: 'TOP', bar: 'bg-ds-ok' },
] as const;

function TrendChart({ points }: { points: { key: string; pct: number }[] }) {
  if (points.length < 2) return <p className="px-5 py-8 text-center text-[13px] font-semibold text-ds-ink-faint">São necessários pelo menos 2 meses encerrados para mostrar a tendência.</p>;
  const w = 720, h = 200, padL = 36, padR = 12, padT = 12, padB = 26;
  const max = Math.max(120, ...points.map(p => p.pct));
  const x = (i: number) => padL + (i * (w - padL - padR)) / (points.length - 1);
  const y = (v: number) => padT + (1 - v / max) * (h - padT - padB);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.pct).toFixed(1)}`).join(' ');
  return (
    <figure className="px-3 py-4">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Atingimento mensal da meta" className="h-auto w-full">
        <line x1={padL} x2={w - padR} y1={y(100)} y2={y(100)} className="stroke-ds-ok" strokeDasharray="4 4" />
        <text x={padL - 6} y={y(100) + 4} textAnchor="end" className="fill-ds-ink-muted text-[10px] font-bold">100%</text>
        <line x1={padL} x2={w - padR} y1={y(0)} y2={y(0)} className="stroke-ds-border" />
        <path d={path} fill="none" className="stroke-ds-accent" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <g key={p.key}>
            <circle cx={x(i)} cy={y(p.pct)} r={4} className={p.pct >= 100 ? 'fill-ds-ok' : 'fill-ds-accent'} />
            <text x={x(i)} y={y(p.pct) - 9} textAnchor="middle" className="fill-ds-ink text-[10.5px] font-extrabold">{Math.round(p.pct)}%</text>
            <text x={x(i)} y={h - 8} textAnchor="middle" className="fill-ds-ink-muted text-[10px] font-bold capitalize">{monthLabel(p.key)}</text>
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
  return format(new Date(year, month - 1, 1), 'MMM/yyyy', { locale: ptBR });
}

export function GoalsAnalysisDashboard({ initialTab = 'overview' }: { initialTab?: 'overview' | 'closures' }) {
  const { periods, templates, employeeGoals, loading } = useGoals();
  const { kiosks } = useKiosks();
  const { users } = useAuth();

  const [tab, setTab] = useState<'overview' | 'closures'>(initialTab);
  const [filterStatus, setFilterStatus] = useState<GoalsHistoryStatus | null>(null);
  const [filterKioskId, setFilterKioskId] = useState('all');
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
        const template = templateById.get(period.templateId);
        if (filterType !== 'all' && template?.type !== filterType) return false;
        if (filterPeriod !== 'all' && template?.period !== filterPeriod) return false;
        try {
          if (filterDateStart && period.startDate.toDate() < new Date(`${filterDateStart}T00:00:00`)) return false;
          if (filterDateEnd && period.endDate.toDate() > new Date(`${filterDateEnd}T23:59:59`)) return false;
        } catch { /* período sem datas válidas não é filtrado por data */ }
        return true;
      });
  }, [periods, templates, filterKioskId, filterType, filterPeriod, filterDateStart, filterDateEnd]);

  const totals = useMemo(() => {
    const target = closedPeriods.reduce((sum, p) => sum + p.targetValue, 0);
    const revenue = closedPeriods.reduce((sum, p) => sum + p.currentValue, 0);
    const avg = closedPeriods.length ? closedPeriods.reduce((sum, p) => sum + getGoalAttainment(p), 0) / closedPeriods.length : 0;
    const prizes = summarizePrizes(closedPeriods);
    const apuratedRevenue = closedPeriods.filter(p => p.closureSnapshot?.bonus).reduce((sum, p) => sum + p.currentValue, 0);
    return { prizeShare: apuratedRevenue > 0 ? (prizes.totalPrize / apuratedRevenue) * 100 : null, target, revenue, avg, hits: closedPeriods.filter(p => getGoalAttainment(p) >= 100).length, ...prizes };
  }, [closedPeriods]);

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
        return { key, count: items.length, target, revenue, pct: target > 0 ? (revenue / target) * 100 : 0, prizeShare: prizeShareOf(items), ...summarizePrizes(items) };
      });
  }, [closedPeriods]);

  const kioskRows = useMemo(() => {
    const groups = new Map<string, GoalPeriodDoc[]>();
    for (const period of closedPeriods) groups.set(period.kioskId, [...(groups.get(period.kioskId) ?? []), period]);
    return [...groups.entries()]
      .map(([kioskId, items]) => ({
        kioskId,
        name: getKioskName(kioskId),
        count: items.length,
        avg: items.reduce((sum, p) => sum + getGoalAttainment(p), 0) / items.length,
        best: Math.max(...items.map(getGoalAttainment)),
        hits: items.filter(p => getGoalAttainment(p) >= 100).length,
        tiers: items.reduce((acc, p) => { acc[reachedTier(p)] += 1; return acc; }, { below: 0, target: 0, up: 0, top: 0 }),
        prizeShare: (() => {
          const apurated = items.filter(p => p.closureSnapshot?.bonus);
          const revenue = apurated.reduce((sum, p) => sum + p.currentValue, 0);
          return revenue > 0 ? (summarizePrizes(items).totalPrize / revenue) * 100 : null;
        })(),
        ...summarizePrizes(items),
      }))
      .sort((a, b) => b.avg - a.avg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closedPeriods, kiosks]);

  const earnings = useMemo(() => buildEmployeeEarnings(closedPeriods, employeeGoals), [closedPeriods, employeeGoals]);

  const scopedPeriods = useMemo(() => periods.filter(p => filterKioskId === 'all' || p.kioskId === filterKioskId), [periods, filterKioskId]);
  const statusCounts = useMemo(() => ({
    active: scopedPeriods.filter(p => p.status === 'active').length,
    closed: scopedPeriods.filter(p => p.status === 'closed').length,
    cancelled: scopedPeriods.filter(p => p.status === 'cancelled').length,
  }), [scopedPeriods]);
  const statusPrize = useMemo(() => summarizePrizes(scopedPeriods), [scopedPeriods]);

  if (loading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-5 font-ds">
      <ControlPanel>
        <p className={cn(kickerClass, 'text-ds-accent-kicker')}>Metas de vendas</p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-2xl font-extrabold">Análise</h1>
          <p className="max-w-xl text-[13px] font-semibold text-ds-on-dark-sub">
            {tab === 'overview' ? 'Tendência, faixas atingidas e desempenho dos períodos encerrados.' : 'Fechamentos mês a mês: o que foi pago a cada colaborador, com folha de premiação para exportar.'}
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
            <div className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-5">
              <PanelStat label="Realizado" value={fmtBRL(totals.revenue)} hint={`de ${fmtBRL(totals.target)}`} />
              <PanelStat label="Atingimento médio" value={fmtPct(totals.avg)} tone={totals.avg >= 100 ? 'text-ds-ok' : totals.avg >= 80 ? 'text-ds-warn' : 'text-ds-danger'} hint={`${closedPeriods.length} período(s)`} />
              <PanelStat label="Metas batidas" value={`${totals.hits}/${closedPeriods.length}`} hint="períodos com 100% ou mais" />
              <PanelStat label="Premiação apurada" value={fmtBRL(totals.totalPrize)} tone="text-ds-ok" hint={totals.pendingCount > 0 ? `${totals.pendingCount} período(s) sem apuração` : `${totals.apuratedCount} período(s) apurado(s)`} />
              <PanelStat label="Premiação / faturamento" value={totals.prizeShare === null ? '—' : fmtPct(totals.prizeShare)} hint="custo da premiação sobre o realizado" />
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
            <PanelStat label="Premiação apurada" value={fmtBRL(statusPrize.totalPrize)} tone="text-ds-ok" hint={statusPrize.pendingCount > 0 ? `${statusPrize.pendingCount} período(s) sem apuração` : `${statusPrize.apuratedCount} período(s)`} />
          </div>
        )}

        <FilterChips
          className="mt-5"
          value={filterKioskId === 'all' ? null : filterKioskId}
          onChange={value => setFilterKioskId(value ?? 'all')}
          allLabel="Todos os quiosques"
          chips={kiosks.map(k => ({ value: k.id, label: k.name }))}
        />
      </ControlPanel>

      {tab === 'closures' ? (
        <GoalsHistoryView kioskId={filterKioskId === 'all' ? null : filterKioskId} status={filterStatus} />
      ) : closedPeriods.length === 0 ? (
        <EmptyBox>Nenhum período encerrado encontrado para esses filtros.</EmptyBox>
      ) : (
        <>
          <SectionCard title="Tendência do atingimento" subtitle="Faturamento realizado sobre a meta, mês a mês (últimos 12 meses). A linha tracejada é 100%.">
            <TrendChart points={monthly.slice(-12).map(row => ({ key: row.key, pct: row.pct }))} />
            <div className="overflow-x-auto border-t border-ds-divider">
              <table className="w-full min-w-[640px] text-left text-[13px]">
                <thead>
                  <tr className={cn(kickerClass, 'text-ds-ink-faint')}>
                    <th className="px-5 py-3 font-extrabold">Mês</th>
                    <th className="px-3 py-3 text-right font-extrabold">Metas</th>
                    <th className="px-3 py-3 text-right font-extrabold">Alvo</th>
                    <th className="px-3 py-3 text-right font-extrabold">Realizado</th>
                    <th className="px-3 py-3 text-right font-extrabold">Atingimento</th>
                    <th className="px-3 py-3 text-right font-extrabold">Premiação</th>
                    <th className="px-5 py-3 text-right font-extrabold">% do faturamento</th>
                  </tr>
                </thead>
                <tbody>
                  {monthly.map(row => (
                    <tr key={row.key} className="border-t border-ds-divider">
                      <td className="px-5 py-2.5 font-extrabold capitalize text-ds-ink">{monthLabel(row.key)}</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-ds-ink-2">{row.count}</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-ds-ink-muted">{fmtBRL(row.target)}</td>
                      <td className="px-3 py-2.5 text-right font-bold text-ds-ink">{fmtBRL(row.revenue)}</td>
                      <td className={cn('px-3 py-2.5 text-right font-extrabold', attainmentTone(row.pct))}>{fmtPct(row.pct)}</td>
                      <td className="px-3 py-2.5 text-right font-extrabold text-ds-ok">{row.apuratedCount > 0 ? fmtBRL(row.totalPrize) : <span className="font-semibold text-ds-ink-faint">—</span>}</td>
                      <td className="px-5 py-2.5 text-right font-semibold text-ds-ink-2">{row.prizeShare === null ? '—' : fmtPct(row.prizeShare)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>

          <SectionCard title="Faixas atingidas por quiosque" subtitle="Em que faixa cada quiosque costuma parar. Se quase tudo fica em um extremo, a meta pode estar fácil ou difícil demais.">
            <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
              {kioskRows.map(item => {
                const gap = item.avg - totals.avg;
                return (
                  <div key={item.kioskId} className="rounded-ds-md border border-ds-border bg-ds-warm p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[14px] font-extrabold text-ds-ink">{item.name}</div>
                        <div className="text-[12px] font-semibold text-ds-ink-muted">{item.count} período(s) · melhor {fmtPct(item.best, 0)}</div>
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

          <SectionCard title="Desempenho dos colaboradores" subtitle="Atingimento individual e tendência. Valores pagos ficam na aba Fechamentos." action={<span className="text-[12.5px] font-bold text-ds-ink-muted">{earnings.length} colaborador(es)</span>}>
            {earnings.length === 0 ? (
              <p className="px-5 py-8 text-center text-[13px] font-semibold text-ds-ink-faint">Nenhum colaborador vinculado aos períodos filtrados.</p>
            ) : (
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
                    {[...earnings].sort((a, b) => b.avgAttainment - a.avgAttainment).map(row => (
                      <tr key={row.employeeId} className="border-t border-ds-divider">
                        <td className="px-5 py-2.5">
                          <div className="font-extrabold text-ds-ink">{getUserName(row.employeeId)}</div>
                          <div className="text-[12px] font-semibold text-ds-ink-muted">{row.role ? roleLabels[row.role] : '—'} · {row.kioskIds.map(getKioskName).join(', ')}</div>
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold text-ds-ink-2">{row.periodCount}</td>
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
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}
