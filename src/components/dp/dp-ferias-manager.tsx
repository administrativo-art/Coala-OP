"use client";

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  differenceInCalendarDays,
  endOfMonth,
  format,
  parseISO,
  startOfDay,
  startOfMonth,
  subDays,
} from 'date-fns';
import { ChevronRight, Search } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { useDPBootstrap } from '@/hooks/use-dp-bootstrap';
import { activeOperationalUnits } from '@/lib/dp-units';
import {
  VACATION_WORKFLOW_DISPLAY_STAGE_META,
  vacationWorkflowDisplayStageId,
} from '@/lib/dp-vacation-workflow';
import type { DPVacationRecord, DPVacationWorkflow, User } from '@/types';
import { cn } from '@/lib/utils';

import { Input } from '@/components/ui/input';
import { PageHero } from '@/components/patterns/page-hero';
import { HeroChip } from '@/components/patterns/hero-chip';
import { Segmented } from '@/components/patterns/segmented';
import { LiftRow } from '@/components/patterns/lift-row';
import { DPVacationTimeline } from './dp-vacation-timeline';
import {
  calculateVacationHealth,
  getVacationCycleHistory,
  type VacationCycle,
  type VacationHealthStatus,
} from '@/lib/utils/vacation-logic';
import {
  VacationLegend,
  VacationPill,
  VacationStageDots,
  workflowOperationalSummary,
  type VacationPillTone,
} from './dp-ferias-shared';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Férias da CLT valem para empregados e aprendizes. Cadastros antigos sem vínculo informado seguem pelo critério
 * anterior (operacional), para ninguém sumir do Panorama até o vínculo ser preenchido.
 */
function hasVacationEntitlement(user: User) {
  if (user.employmentRelationshipType) return ['clt', 'apprenticeship'].includes(user.employmentRelationshipType);
  return user.operacional === true;
}

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase();
}

function toDate(ts: unknown): Date | undefined {
  if (!ts) return undefined;
  if (ts instanceof Date) return ts;
  if (typeof (ts as { toDate?: () => Date }).toDate === 'function') return (ts as { toDate: () => Date }).toDate();
  if (typeof ts === 'string') return /^\d{4}-\d{2}-\d{2}$/.test(ts) ? parseISO(ts) : new Date(ts);
  return undefined;
}

const fmt = (date: Date) => format(date, 'dd/MM/yyyy');

type PeopleFilter = 'all' | 'schedule' | 'trail' | 'ok' | 'acquiring';
type View = 'panorama' | 'trails' | 'calendar';
type TrailFilter = 'hr' | 'external' | 'all';

interface Person {
  user: User;
  health: VacationHealthStatus;
  role: string;
  unitName: string;
  /** Período concessivo que está correndo: em aberto ou, se quitado, o mais recente ainda no prazo. */
  concessive?: VacationCycle;
  acquisitive?: VacationCycle;
  hasActiveTrail: boolean;
  /** Último dia das férias em gozo hoje, quando houver. */
  onVacationUntil?: Date;
  priority: { label: string; tone: VacationPillTone; rank: number; filter: PeopleFilter };
}

interface ActiveTrail {
  person: Person;
  record: DPVacationRecord;
  workflow: DPVacationWorkflow;
  owner: string;
  action: string;
  waitingExternal: boolean;
  idleDays: number;
}

function personPriority(concessive: VacationCycle | undefined, acquisitive: VacationCycle | undefined, hasActiveTrail: boolean, today: Date): Person['priority'] {
  if (!concessive) return { label: 'Em aquisição', tone: 'info', rank: 8, filter: 'acquiring' };
  const daysLeft = differenceInCalendarDays(concessive.concessivePeriod.end, today);
  if (concessive.status === 'VENCIDO') return { label: 'Vencido', tone: 'danger', rank: 0, filter: 'schedule' };
  if (concessive.status === 'PENDENTE' || concessive.status === 'PARCIAL') {
    const label = concessive.status === 'PARCIAL' ? 'Agendar o resto' : 'Agendar agora';
    return { label, tone: daysLeft <= 120 ? 'danger' : 'warn', rank: daysLeft <= 120 ? 1 : 2, filter: 'schedule' };
  }
  if (concessive.status === 'AGUARDANDO_APROVACAO') return { label: 'Aguardando aprovação', tone: 'warn', rank: 3, filter: 'trail' };
  if (hasActiveTrail || concessive.status === 'AGENDADO') return { label: 'Agendado', tone: 'ok', rank: 4, filter: hasActiveTrail ? 'trail' : 'ok' };
  void acquisitive;
  return { label: 'Em dia', tone: 'ok', rank: 6, filter: 'ok' };
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function DPFeriasManager() {
  const router = useRouter();
  const { activeUsers } = useAuth();
  const { vacations, units, vacationsLoading, vacationsError, unitsError } = useDPBootstrap();
  const [search, setSearch] = useState('');
  const [unitFilter, setUnitFilter] = useState<string>('__all__');
  const [view, setView] = useState<View>('panorama');
  const [peopleFilter, setPeopleFilter] = useState<PeopleFilter>('all');
  const [trailFilter, setTrailFilter] = useState<TrailFilter>('all');

  const today = useMemo(() => startOfDay(new Date()), []);
  const activeUnits = useMemo(() => activeOperationalUnits(units), [units]);

  const people = useMemo<Person[]>(() => {
    const entitled = activeUsers.filter(hasVacationEntitlement);
    return entitled
      .filter(user => unitFilter === '__all__' || user.unitIds?.includes(unitFilter))
      .filter(user => user.username.toLowerCase().includes(search.toLowerCase()))
      .flatMap((user): Person[] => {
        const admission = toDate(user.admissionDate);
        const userVacations = vacations.filter(record => record.userId === user.id);
        const health = calculateVacationHealth(admission, userVacations);
        if (health.status === 'INVALIDO' || !admission) return [];
        const cycles = getVacationCycleHistory(admission, userVacations);
        const open = cycles.find(cycle => cycle.status !== 'GOZADO' && cycle.status !== 'AQUISITIVO');
        const settledInDeadline = cycles.find(cycle => cycle.status === 'GOZADO' && cycle.concessivePeriod.end >= today);
        const concessive = open ?? settledInDeadline;
        const acquisitive = cycles.find(cycle => cycle.status === 'AQUISITIVO');
        const hasActiveTrail = userVacations.some(record => record.workflow?.status === 'active' && record.status !== 'REJECTED');
        const unitName = user.unitIds?.[0] ? units.find(unit => unit.id === user.unitIds![0])?.name ?? '' : '';
        const enjoying = userVacations.find(record => (
          record.recordType === 'gozo' && record.status !== 'REJECTED' && record.startDate && record.endDate
          && parseISO(record.startDate) <= today && parseISO(record.endDate) >= today
        ));
        return [{
          user,
          health,
          role: user.jobRoleName ?? '',
          unitName,
          concessive,
          acquisitive,
          hasActiveTrail,
          onVacationUntil: enjoying?.endDate ? parseISO(enjoying.endDate) : undefined,
          priority: personPriority(concessive, acquisitive, hasActiveTrail, today),
        }];
      })
      .sort((left, right) => {
        const leftEnd = left.concessive?.concessivePeriod.end.getTime() ?? Number.POSITIVE_INFINITY;
        const rightEnd = right.concessive?.concessivePeriod.end.getTime() ?? Number.POSITIVE_INFINITY;
        if (left.priority.rank !== right.priority.rank && (left.priority.rank <= 2 || right.priority.rank <= 2)) {
          return left.priority.rank - right.priority.rank;
        }
        return leftEnd - rightEnd;
      });
  }, [activeUsers, unitFilter, search, vacations, units, today]);

  const activeTrails = useMemo<ActiveTrail[]>(() => {
    const byUser = new Map(people.map(person => [person.user.id, person]));
    return vacations
      .flatMap((record): ActiveTrail[] => {
        const person = byUser.get(record.userId);
        const workflow = record.workflow;
        if (!person || record.recordType !== 'gozo' || record.status === 'REJECTED' || !workflow || workflow.status !== 'active') return [];
        const summary = workflowOperationalSummary(workflow, person.user.username);
        const updated = workflow.updatedAt ? parseISO(workflow.updatedAt) : today;
        return [{
          person,
          record,
          workflow,
          owner: summary.owner,
          action: summary.action,
          waitingExternal: !['RH', 'Sistema'].includes(summary.owner),
          idleDays: Math.max(0, differenceInCalendarDays(today, updated)),
        }];
      })
      .sort((left, right) => right.idleDays - left.idleDays);
  }, [people, vacations, today]);

  const needsHr = activeTrails.filter(trail => !trail.waitingExternal);
  const withThirdParties = activeTrails.filter(trail => trail.waitingExternal);
  const noticeAtRisk = people.filter(person => {
    const cycle = person.concessive;
    if (!cycle || !['PENDENTE', 'PARCIAL', 'VENCIDO'].includes(cycle.status)) return false;
    const noticeDeadline = subDays(cycle.concessivePeriod.end, Math.max(1, cycle.balance) + 29);
    return differenceInCalendarDays(noticeDeadline, today) <= 60;
  });
  const monthStart = startOfMonth(today);
  const monthEnd = endOfMonth(today);
  const visibleIds = new Set(people.map(person => person.user.id));
  const enjoyingThisMonth = vacations.filter(record => (
    visibleIds.has(record.userId)
    && record.recordType === 'gozo'
    && record.status === 'APPROVED'
    && record.startDate && record.endDate
    && parseISO(record.startDate) <= monthEnd
    && parseISO(record.endDate) >= monthStart
  ));

  const visiblePeople = people.filter(person => peopleFilter === 'all' || person.priority.filter === peopleFilter);
  const visibleTrails = trailFilter === 'all' ? activeTrails : trailFilter === 'hr' ? needsHr : withThirdParties;
  const timelineVacations = vacations.filter(record => (
    visibleIds.has(record.userId) && record.recordType === 'gozo' && record.status !== 'REJECTED' && record.startDate && record.endDate
  ));

  const openPerson = (userId: string) => router.push(`/dashboard/dp/ferias/${encodeURIComponent(userId)}`);
  const openTrail = (trail: ActiveTrail) => router.push(
    `/dashboard/dp/ferias/${encodeURIComponent(trail.record.userId)}?vacation=${encodeURIComponent(trail.record.id)}`,
  );
  const isLoading = vacationsLoading && vacations.length === 0;
  const warningError = vacationsError ?? unitsError;

  return (
    <div className="space-y-4">
      <PageHero
        kicker="Pessoal · Departamento pessoal"
        title="Férias"
        subtitle="Quem precisa agir, em qual etapa e até quando."
        chips={(
          <>
            <HeroChip value={needsHr.length} label="com o RH" tone="info" active={view === 'trails' && trailFilter === 'hr'} onClick={() => { setView('trails'); setTrailFilter('hr'); }} />
            <HeroChip value={withThirdParties.length} label="com terceiros" tone="warning" active={view === 'trails' && trailFilter === 'external'} onClick={() => { setView('trails'); setTrailFilter('external'); }} />
            <HeroChip value={noticeAtRisk.length} label="prazos em risco" tone="danger" active={view === 'panorama' && peopleFilter === 'schedule'} onClick={() => { setView('panorama'); setPeopleFilter('schedule'); }} />
            <HeroChip value={enjoyingThisMonth.length} label="em gozo neste mês" active={view === 'calendar'} onClick={() => setView('calendar')} />
          </>
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] max-w-sm flex-1">
            <Search aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ds-on-dark-muted" />
            <Input
              aria-label="Buscar colaborador"
              placeholder="Buscar colaborador"
              value={search}
              onChange={event => setSearch(event.target.value)}
              className="h-9 rounded-full border-white/10 bg-white/5 pl-9 text-[13px] text-ds-on-dark placeholder:text-ds-on-dark-muted"
            />
          </div>
          <span className="ml-1 text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-on-dark-muted">Unidade</span>
          {[{ id: '__all__', name: 'Todas' }, ...activeUnits].map(unit => (
            <button
              key={unit.id}
              type="button"
              aria-pressed={unitFilter === unit.id}
              onClick={() => setUnitFilter(unit.id)}
              className={cn(
                'h-8 rounded-full px-3 text-[12px] font-bold text-ds-on-dark-2 ring-1 ring-inset transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-accent-kicker',
                unitFilter === unit.id ? 'bg-white/10 ring-2 ring-ds-accent-kicker' : 'bg-white/5 ring-white/10 hover:bg-white/10',
              )}
            >
              {unit.name}
            </button>
          ))}
        </div>
      </PageHero>

      {warningError ? (
        <p className="rounded-ds-card border border-ds-alert-border bg-ds-alert-bg px-4 py-3 text-[13px] font-semibold text-ds-alert-ink">
          Falha ao carregar férias: {warningError}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Segmented<View>
          aria-label="Visão"
          value={view}
          onChange={setView}
          options={[
            { value: 'panorama', label: 'Panorama' },
            { value: 'trails', label: 'Em andamento' },
            { value: 'calendar', label: 'Calendário' },
          ]}
        />
        {view !== 'calendar' ? <VacationLegend className="ml-auto" /> : null}
      </div>

      {view === 'panorama' ? (
        <>
          {needsHr.length > 0 ? (
            <section aria-label="Precisa de você" className="rounded-ds-card-lg border border-ds-accent/25 bg-ds-surface px-2 pb-2 pt-3.5">
              <div className="flex items-baseline gap-2 px-3.5 pb-1.5">
                <h2 className="text-[14px] font-extrabold text-ds-ink">Precisa de você</h2>
                <span className="text-[12px] text-ds-ink-muted">ações do RH, mais antigas primeiro</span>
              </div>
              {needsHr.map(trail => (
                <TrailLine key={trail.record.id} trail={trail} onOpen={() => openTrail(trail)} />
              ))}
            </section>
          ) : null}

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Pessoas</span>
            {([
              ['all', 'Todos'],
              ['schedule', 'Agendar agora'],
              ['trail', 'Com parcela em andamento'],
              ['ok', 'Em dia'],
              ['acquiring', 'Em aquisição'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={peopleFilter === value}
                onClick={() => setPeopleFilter(value)}
                className={cn(
                  'h-8 rounded-ds-pill border px-3 text-[12px] font-bold transition-colors',
                  peopleFilter === value ? 'border-ds-accent bg-ds-accent-soft text-ds-accent-ink' : 'border-ds-border bg-ds-surface text-ds-ink-2 hover:bg-ds-muted',
                )}
              >
                {label}
              </button>
            ))}
            <span className="ml-auto text-[12px] font-semibold text-ds-ink-muted">Ordenado pelo prazo para conceder</span>
          </div>

          <section aria-label="Pessoas e períodos de férias" className="overflow-x-auto rounded-ds-card-lg border border-ds-border bg-ds-surface p-1.5">
            <div className="min-w-[860px]">
              <div className="grid grid-cols-[minmax(230px,1.4fr)_minmax(240px,1.4fr)_minmax(220px,1.2fr)_150px_18px] gap-4 px-[18px] py-2.5 text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-ds-ink-faint">
                <span>Colaborador</span><span>Período concessivo</span><span>Período aquisitivo</span><span>Prioridade</span><span />
              </div>
              {isLoading ? (
                <p className="px-[18px] py-6 text-[13px] text-ds-ink-muted">Carregando férias…</p>
              ) : visiblePeople.length === 0 ? (
                <p className="m-2 rounded-ds-card-lg border border-dashed border-ds-border-input px-4 py-8 text-center text-[13px] text-ds-ink-muted">Ninguém nesse filtro.</p>
              ) : visiblePeople.map(person => (
                <PersonRow key={person.user.id} person={person} today={today} onOpen={() => openPerson(person.user.id)} />
              ))}
            </div>
          </section>
        </>
      ) : null}

      {view === 'trails' ? (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            {([
              ['hr', `Com o RH · ${needsHr.length}`],
              ['external', `Com terceiros · ${withThirdParties.length}`],
              ['all', `Todas · ${activeTrails.length}`],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={trailFilter === value}
                onClick={() => setTrailFilter(value)}
                className={cn(
                  'h-8 rounded-ds-pill border px-3 text-[12px] font-bold transition-colors',
                  trailFilter === value ? 'border-ds-accent bg-ds-accent-soft text-ds-accent-ink' : 'border-ds-border bg-ds-surface text-ds-ink-2 hover:bg-ds-muted',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <section aria-label="Parcelas em andamento" className="rounded-ds-card-lg border border-ds-border bg-ds-surface p-1.5">
            {visibleTrails.length === 0 ? (
              <p className="m-2 rounded-ds-card-lg border border-dashed border-ds-border-input px-4 py-8 text-center text-[13px] text-ds-ink-muted">Nenhuma parcela nesse filtro.</p>
            ) : visibleTrails.map(trail => (
              <TrailLine key={trail.record.id} trail={trail} onOpen={() => openTrail(trail)} showPerson />
            ))}
          </section>
        </>
      ) : null}

      {view === 'calendar' ? (
        <DPVacationTimeline
          users={people.map(person => person.user)}
          vacations={timelineVacations}
          onSelectUser={openPerson}
        />
      ) : null}
    </div>
  );
}

// ─── Rows ─────────────────────────────────────────────────────────────────────

function PersonRow({ person, today, onOpen }: { person: Person; today: Date; onOpen: () => void }) {
  const { concessive, acquisitive } = person;
  const concessiveDaysLeft = concessive ? differenceInCalendarDays(concessive.concessivePeriod.end, today) : null;
  const concessiveUrgent = Boolean(concessive && concessive.balance > 0 && (concessiveDaysLeft ?? 0) <= 120);
  const concessiveLine = !concessive
    ? 'Nenhum período em concessão'
    : concessive.status === 'GOZADO'
      ? 'Quitado · sem saldo'
      : concessive.balance > 0
        ? `Saldo de ${concessive.balance} dias`
        : 'Tudo agendado · sem saldo';
  const acquisitiveProgress = acquisitive
    ? Math.max(0, Math.min(100, Math.round(
        differenceInCalendarDays(today, acquisitive.acquisitivePeriod.start)
        / Math.max(1, differenceInCalendarDays(acquisitive.acquisitivePeriod.end, acquisitive.acquisitivePeriod.start)) * 100,
      )))
    : 0;
  const meta = [person.role, person.unitName].filter(Boolean).join(' · ');

  return (
    <LiftRow table onClick={onOpen} aria-label={`Abrir férias de ${person.user.username}`} className="grid grid-cols-[minmax(230px,1.4fr)_minmax(240px,1.4fr)_minmax(220px,1.2fr)_150px_18px] items-center gap-4">
      <span className="flex min-w-0 items-center gap-3">
        <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-ds-neutral-bg text-xs font-extrabold text-ds-ink-2">{initials(person.user.username)}</span>
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13.5px] font-extrabold text-ds-ink">{person.user.username}</span>
            {person.onVacationUntil ? (
              <VacationPill tone="info" className="h-[18px] px-[7px] text-[10.5px]">Em gozo até {format(person.onVacationUntil, 'dd/MM')}</VacationPill>
            ) : null}
          </span>
          <span className="block truncate text-[12px] text-ds-ink-muted">{meta || '—'}</span>
        </span>
      </span>
      <span>
        <span className="block font-ds-mono text-[12px] font-bold text-ds-ink">
          {concessive ? `${fmt(concessive.acquisitivePeriod.start)} – ${fmt(concessive.acquisitivePeriod.end)}` : '—'}
        </span>
        <span className="mt-0.5 block text-[12.5px] font-extrabold text-ds-ink">{concessiveLine}</span>
        <span className={cn('block text-[11.5px] font-bold', concessiveUrgent ? 'text-ds-danger' : 'text-ds-ink-muted')}>
          {concessive
            ? `conceder até ${fmt(concessive.concessivePeriod.end)} · ${(concessiveDaysLeft ?? 0) < 0 ? `vencido há ${-(concessiveDaysLeft ?? 0)} dias` : `em ${concessiveDaysLeft} dias`}`
            : 'ainda sem direito a férias'}
        </span>
      </span>
      <span>
        <span className="block font-ds-mono text-[12px] font-bold text-ds-ink">
          {acquisitive ? `${fmt(acquisitive.acquisitivePeriod.start)} – ${fmt(acquisitive.acquisitivePeriod.end)}` : '—'}
        </span>
        <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-ds-neutral-bg">
          <span className="block h-full rounded-full bg-ds-info" style={{ width: `${acquisitiveProgress}%` }} />
        </span>
        <span className="mt-1 block text-[11.5px] text-ds-ink-muted">
          {acquisitive ? `${acquisitiveProgress}% · completa em ${fmt(acquisitive.acquisitivePeriod.end)}` : '—'}
        </span>
      </span>
      <VacationPill tone={person.priority.tone}>{person.priority.label}</VacationPill>
      <ChevronRight aria-hidden="true" className="h-4 w-4 text-ds-ink-faint" />
    </LiftRow>
  );
}

function TrailLine({ trail, onOpen, showPerson = false }: { trail: ActiveTrail; onOpen: () => void; showPerson?: boolean }) {
  const stageId = vacationWorkflowDisplayStageId(trail.workflow.currentStage);
  const stageIndex = Math.max(0, VACATION_WORKFLOW_DISPLAY_STAGE_META.findIndex(stage => stage.id === stageId));
  const stage = VACATION_WORKFLOW_DISPLAY_STAGE_META[stageIndex];
  const period = trail.record.startDate && trail.record.endDate
    ? `${format(parseISO(trail.record.startDate), 'dd/MM')} a ${fmt(parseISO(trail.record.endDate))}`
    : 'Sem período';

  return (
    <LiftRow table onClick={onOpen} aria-label={`Ver etapas das férias de ${trail.person.user.username}`} className="grid grid-cols-[minmax(220px,1.3fr)_minmax(180px,1fr)_minmax(240px,1.6fr)_150px_18px] items-center gap-4">
      <span className="min-w-0">
        <span className="block truncate text-[13.5px] font-extrabold text-ds-ink">{trail.person.user.username}</span>
        <span className="block truncate text-[12px] text-ds-ink-muted">{period} · {trail.record.days} dias{showPerson && trail.person.unitName ? ` · ${trail.person.unitName}` : ''}</span>
      </span>
      <span>
        <VacationStageDots current={stageIndex + 1} waitingExternal={trail.waitingExternal} />
        <span className="mt-1.5 block text-[11.5px] font-extrabold text-ds-ink-2">Etapa {stageIndex + 1} de 6 · {stage.short}</span>
      </span>
      <span className="min-w-0">
        <span className="block text-[13.5px] font-extrabold text-ds-ink">{trail.action}</span>
        <span className="block text-[12px] text-ds-ink-muted">Responsável: {trail.owner}</span>
      </span>
      {trail.waitingExternal ? (
        <VacationPill tone={trail.idleDays >= 5 ? 'danger' : 'warn'}>Parada há {trail.idleDays} dia{trail.idleDays === 1 ? '' : 's'}</VacationPill>
      ) : (
        <VacationPill tone="info">Ação do RH</VacationPill>
      )}
      <ChevronRight aria-hidden="true" className="h-4 w-4 text-ds-ink-faint" />
    </LiftRow>
  );
}
