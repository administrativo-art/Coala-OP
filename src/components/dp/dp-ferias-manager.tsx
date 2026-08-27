"use client";

import React, { useMemo, useState } from 'react';
import { format, parseISO, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { useAuth } from '@/hooks/use-auth';
import { useDPBootstrap } from '@/hooks/use-dp-bootstrap';
import { activeOperationalUnits } from '@/lib/dp-units';
import type { User } from '@/types';

import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { CalendarDays, Search } from 'lucide-react';
import { DPFeriasDrawer } from './dp-ferias-drawer';
import {
  calculateVacationHealth,
  getVacationCycleHistory,
  RISK_PROGRESS_CLASS,
  VACATION_STATUS_HEX,
  type VacationHealthStatus,
  type VacationRisk,
} from '@/lib/utils/vacation-logic';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase();
}

function toDate(ts: unknown): Date | undefined {
  if (!ts) return undefined;
  if (ts instanceof Date) return ts;
  if (typeof (ts as any).toDate === 'function') return (ts as any).toDate();
  if (typeof ts === 'string') return new Date(ts);
  return undefined;
}

const RISK_CONFIG: Record<VacationRisk, { label: string; bg: string; text: string }> = {
  VENCIDA:  { label: 'Vencida', bg: 'bg-red-100 dark:bg-red-900/30',      text: 'text-red-700 dark:text-red-300'      },
  CRITICA:  { label: 'Crítica', bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-300' },
  ATENCAO:  { label: 'Atenção', bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-700 dark:text-yellow-300' },
  EM_DIA:   { label: 'Em dia',  bg: 'bg-green-100 dark:bg-green-900/30',   text: 'text-green-700 dark:text-green-300'   },
};

const RISK_ACCENT: Record<VacationRisk, string> = {
  VENCIDA: 'border-l-red-500',
  CRITICA: 'border-l-orange-500',
  ATENCAO: 'border-l-yellow-500',
  EM_DIA:  'border-l-green-500',
};

const RISK_CHIPS: { key: 'ALL' | VacationRisk; label: string }[] = [
  { key: 'ALL', label: 'Todas' },
  { key: 'VENCIDA', label: 'Vencida' },
  { key: 'CRITICA', label: 'Crítica' },
  { key: 'ATENCAO', label: 'Atenção' },
  { key: 'EM_DIA', label: 'Em dia' },
];

interface Enriched {
  user: User;
  health: VacationHealthStatus;
  role: string;
  unitName: string;
  balance: number;
}

// ─── Cards ────────────────────────────────────────────────────────────────────

function ConcessivoCard({ item, onOpen }: { item: Enriched; onOpen: () => void }) {
  if (item.health.status !== 'CONCESSIVO') return null;
  const { risk, deadline, progress } = item.health.details;
  const cfg = RISK_CONFIG[risk];
  const meta = [item.role, item.unitName].filter(Boolean).join(' · ');

  return (
    <div
      onClick={onOpen}
      className={`cursor-pointer rounded-2xl border border-l-4 ${RISK_ACCENT[risk]} bg-card px-4 py-3.5 transition-shadow hover:shadow-md`}
    >
      <div className="flex items-center gap-3">
        <span
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
          style={{ background: item.user.color || '#8B5CF6' }}
        >
          {initials(item.user.username)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-semibold">{item.user.username}</span>
            <span className={`inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${cfg.bg} ${cfg.text}`}>
              {risk === 'VENCIDA' && <span className="h-1.5 w-1.5 rounded-full bg-red-600 animate-pulse" />}
              {cfg.label}
            </span>
          </div>
          {meta && <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{meta}</div>}
        </div>
      </div>
      <Progress value={progress} className={`mt-3 h-[5px] ${RISK_PROGRESS_CLASS[risk]}`} />
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">Vence {format(deadline, 'dd/MM/yyyy', { locale: ptBR })}</span>
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-[10.5px] font-semibold text-muted-foreground">
          {Math.max(0, item.balance)}d a agendar
        </span>
      </div>
    </div>
  );
}

function AquisitivoCard({ item, onOpen }: { item: Enriched; onOpen: () => void }) {
  if (item.health.status !== 'AQUISITIVO') return null;
  const { progress, end } = item.health.details;
  const meta = [item.role, item.unitName].filter(Boolean).join(' · ');

  return (
    <div
      onClick={onOpen}
      className="cursor-pointer rounded-2xl border border-l-4 border-l-border bg-card px-4 py-3.5 transition-shadow hover:shadow-md"
    >
      <div className="flex items-center gap-3">
        <span
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
          style={{ background: item.user.color || '#8B5CF6' }}
        >
          {initials(item.user.username)}
        </span>
        <div className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{item.user.username}</span>
          {meta && <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{meta}</div>}
        </div>
      </div>
      <Progress value={progress} className="mt-3 h-[5px] [&>*]:bg-slate-400" />
      <div className="mt-2 text-[11px] text-muted-foreground">
        Aquisição até {format(end, 'dd/MM/yyyy', { locale: ptBR })}
      </div>
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-l-4 border-l-muted bg-card px-4 py-3.5 animate-pulse">
      <div className="h-9 w-9 flex-shrink-0 rounded-full bg-muted" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 w-3/5 rounded bg-muted" />
        <div className="h-[5px] w-full rounded bg-muted" />
        <div className="h-3 w-2/5 rounded bg-muted/60" />
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function DPFeriasManager() {
  const { activeUsers, users, permissions } = useAuth();
  const { vacations, units, vacationsLoading, vacationsError, unitsError } = useDPBootstrap();

  const [search, setSearch] = useState('');
  const [unitFilter, setUnitFilter] = useState<string>('__all__');
  const [riskFilter, setRiskFilter] = useState<'ALL' | VacationRisk>('ALL');
  const [drawerUserId, setDrawerUserId] = useState<string | null>(null);
  const [monthModal, setMonthModal] = useState(false);

  const canRegister = permissions.dp?.vacation?.request ?? false;
  const activeUnits = useMemo(() => activeOperationalUnits(units), [units]);

  const operationalUsers = useMemo(() => {
    const ops = activeUsers.filter(u => u.operacional === true);
    if (unitFilter === '__all__') return ops;
    return ops.filter(u => u.unitIds?.includes(unitFilter));
  }, [activeUsers, unitFilter]);

  const enriched = useMemo<Enriched[]>(() => {
    return operationalUsers
      .map(user => {
        const admDate = toDate(user.admissionDate);
        const userVacations = vacations.filter(v => v.userId === user.id);
        const health = calculateVacationHealth(admDate, userVacations);

        let balance = 0;
        if (health.status === 'CONCESSIVO' && admDate) {
          const cycles = getVacationCycleHistory(admDate, userVacations);
          const openCycle = cycles.find(c => c.status !== 'GOZADO' && c.status !== 'AQUISITIVO');
          if (openCycle) {
            const active = openCycle.records.filter(r => r.status !== 'REJECTED');
            balance = Math.max(0, 30 - active.reduce((t, r) => t + r.days, 0));
          }
        }

        const unitName = user.unitIds?.[0]
          ? units.find(u => u.id === user.unitIds![0])?.name ?? ''
          : '';

        return { user, health, role: user.jobRoleName ?? '', unitName, balance };
      })
      .filter(e => e.health.status !== 'INVALIDO');
  }, [operationalUsers, vacations, units]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return enriched.filter(e => e.user.username.toLowerCase().includes(q));
  }, [enriched, search]);

  const concessivo = useMemo(() =>
    filtered
      .filter(e => e.health.status === 'CONCESSIVO'
        && (riskFilter === 'ALL' || (e.health.status === 'CONCESSIVO' && e.health.details.risk === riskFilter)))
      .sort((a, b) => {
        if (a.health.status !== 'CONCESSIVO' || b.health.status !== 'CONCESSIVO') return 0;
        const order: Record<VacationRisk, number> = { VENCIDA: 0, CRITICA: 1, ATENCAO: 2, EM_DIA: 3 };
        const d = order[a.health.details.risk] - order[b.health.details.risk];
        if (d !== 0) return d;
        return a.health.details.deadline.getTime() - b.health.details.deadline.getTime();
      }),
    [filtered, riskFilter]);

  const aquisitivo = useMemo(() =>
    filtered
      .filter(e => e.health.status === 'AQUISITIVO')
      .sort((a, b) => {
        if (a.health.status !== 'AQUISITIVO' || b.health.status !== 'AQUISITIVO') return 0;
        return b.health.details.progress - a.health.details.progress;
      }),
    [filtered]);

  // "Férias do mês": gozo records overlapping the current month.
  const monthVacations = useMemo(() => {
    const start = startOfMonth(new Date());
    const end = endOfMonth(new Date());
    return vacations
      .filter(v => v.recordType === 'gozo' && v.status !== 'REJECTED' && v.startDate && v.endDate)
      .filter(v => {
        const s = parseISO(v.startDate!);
        const e = parseISO(v.endDate!);
        return s <= end && e >= start;
      })
      .map(v => {
        const u = users.find(x => x.id === v.userId);
        const cfg = VACATION_STATUS_HEX[v.status] ?? VACATION_STATUS_HEX.PENDING;
        return {
          id: v.id,
          name: u?.username ?? 'Colaborador',
          color: u?.color || '#8B5CF6',
          start: format(parseISO(v.startDate!), 'dd/MM'),
          end: format(parseISO(v.endDate!), 'dd/MM'),
          days: v.days,
          statusFg: cfg.fg,
          statusBg: cfg.bg,
          statusLabel: cfg.label,
          sortKey: v.startDate!,
        };
      })
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }, [vacations, users]);

  const isLoading = vacationsLoading && vacations.length === 0;
  const warningError = vacationsError ?? unitsError;

  return (
    <div className="space-y-8">
      {warningError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-xs">
          <p className="font-medium text-destructive">Falha ao carregar férias.</p>
          <p className="mt-1 text-muted-foreground">{warningError}</p>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[180px] max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar colaborador..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <span className="text-[12.5px] text-muted-foreground">{filtered.length} colaborador(es)</span>
        <div className="ml-auto flex items-center gap-3">
          <Select value={unitFilter} onValueChange={setUnitFilter}>
            <SelectTrigger className="w-[190px]">
              <SelectValue placeholder="Todas as unidades" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todas as unidades</SelectItem>
              {activeUnits.map(u => (
                <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            onClick={() => setMonthModal(true)}
            className="rounded-lg border bg-muted px-3 py-2 text-xs font-semibold hover:bg-muted/70"
          >
            Férias do mês
          </button>
        </div>
      </div>

      {/* Risk filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        {RISK_CHIPS.map(chip => {
          const active = riskFilter === chip.key;
          return (
            <button
              key={chip.key}
              onClick={() => setRiskFilter(chip.key)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                active
                  ? 'border border-primary bg-primary text-primary-foreground'
                  : 'border border-border bg-card text-muted-foreground hover:bg-muted'
              }`}
            >
              {chip.label}
            </button>
          );
        })}
      </div>

      {/* Prioridade de agendamento */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Prioridade de agendamento
          </h2>
          {!isLoading && <Badge variant="secondary" className="text-xs">{concessivo.length}</Badge>}
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[...Array(4)].map((_, i) => <CardSkeleton key={i} />)}
          </div>
        ) : concessivo.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed py-10 text-muted-foreground">
            <CalendarDays className="h-8 w-8 opacity-30" />
            <p className="text-sm">Nenhum colaborador nesse filtro.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {concessivo.map(item => (
              <ConcessivoCard key={item.user.id} item={item} onOpen={() => setDrawerUserId(item.user.id)} />
            ))}
          </div>
        )}
      </div>

      {/* Período aquisitivo */}
      {(isLoading || aquisitivo.length > 0) && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Período aquisitivo
            </h2>
            {!isLoading && <Badge variant="secondary" className="text-xs">{aquisitivo.length}</Badge>}
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[...Array(2)].map((_, i) => <CardSkeleton key={i} />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {aquisitivo.map(item => (
                <AquisitivoCard key={item.user.id} item={item} onOpen={() => setDrawerUserId(item.user.id)} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Drawer */}
      <DPFeriasDrawer
        userId={drawerUserId}
        canEdit={canRegister}
        onOpenChange={open => { if (!open) setDrawerUserId(null); }}
      />

      {/* Férias do mês modal */}
      <Dialog open={monthModal} onOpenChange={setMonthModal}>
        <DialogContent className="max-w-[420px] p-4">
          <DialogHeader>
            <span className="mb-1 inline-flex w-fit rounded-full bg-primary/10 px-3 py-1 text-[11.5px] font-bold text-primary">
              Calendário de ausências
            </span>
            <DialogTitle className="text-xl">Férias do mês</DialogTitle>
            <DialogDescription>
              Ausências previstas para {format(new Date(), 'MMMM', { locale: ptBR })}.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2.5 pt-2">
            {monthVacations.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Nenhuma ausência prevista neste mês.</p>
            ) : (
              monthVacations.map(v => (
                <div key={v.id} className="flex items-center gap-3 rounded-xl border p-2.5">
                  <span
                    className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                    style={{ background: v.color }}
                  >
                    {initials(v.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-semibold">{v.name}</div>
                    <div className="text-xs text-muted-foreground">{v.start} a {v.end} · {v.days}d</div>
                  </div>
                  <span
                    className="rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold"
                    style={{ background: v.statusBg, color: v.statusFg }}
                  >
                    {v.statusLabel}
                  </span>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
