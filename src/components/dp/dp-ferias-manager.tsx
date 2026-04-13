"use client";

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { useDP } from '@/hooks/use-dp';
import { useAuth } from '@/hooks/use-auth';
import type { User } from '@/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import {
  AlertTriangle, CalendarClock, CalendarDays, ChevronRight,
  Search,
} from 'lucide-react';
import { DPVacationTimeline } from './dp-vacation-timeline';
import {
  calculateVacationHealth,
  getVacationCycleHistory,
  RISK_PROGRESS_CLASS,
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
  // Firebase Timestamp
  if (typeof (ts as any).toDate === 'function') return (ts as any).toDate();
  // ISO string
  if (typeof ts === 'string') return new Date(ts);
  return undefined;
}

// ─── Risk config ──────────────────────────────────────────────────────────────

const RISK_CONFIG: Record<VacationRisk, { label: string; bg: string; text: string; border: string }> = {
  VENCIDA:  { label: 'Vencida',   bg: 'bg-red-100 dark:bg-red-900/30',      text: 'text-red-700 dark:text-red-300',      border: 'border-red-200 dark:border-red-700'      },
  CRITICA:  { label: 'Crítica',   bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-300', border: 'border-orange-200 dark:border-orange-700' },
  ATENCAO:  { label: 'Atenção',   bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-700 dark:text-yellow-300', border: 'border-yellow-200 dark:border-yellow-700' },
  EM_DIA:   { label: 'Em dia',    bg: 'bg-green-100 dark:bg-green-900/30',   text: 'text-green-700 dark:text-green-300',   border: 'border-green-200 dark:border-green-700'   },
};

const RISK_ACCENT: Record<VacationRisk, string> = {
  VENCIDA:  'border-l-red-500',
  CRITICA:  'border-l-orange-500',
  ATENCAO:  'border-l-yellow-500',
  EM_DIA:   'border-l-green-500',
};

// ─── Cycle Stats ──────────────────────────────────────────────────────────────

interface CycleStats {
  plannedDays: number;   // gozo PLANNED
  approvedDays: number;  // gozo APPROVED (gozado)
  soldDays: number;      // venda (abono)
  balance: number;       // 30 - plannedDays - approvedDays - soldDays
}

// ─── Collaborator Health Card ─────────────────────────────────────────────────

interface CollaboratorCardProps {
  user: User;
  health: VacationHealthStatus;
  cycleStats?: CycleStats;
  onClick: () => void;
}

function CollaboratorCard({ user, health, cycleStats, onClick }: CollaboratorCardProps) {
  if (health.status === 'INVALIDO') return null;

  if (health.status === 'AQUISITIVO') {
    return (
      <div
        onClick={onClick}
        className="group flex items-center gap-3 rounded-xl border border-l-4 border-l-muted-foreground/20 bg-card px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
      >
        <Avatar className="h-9 w-9 shrink-0">
          <AvatarImage src={user.avatarUrl} />
          <AvatarFallback className="text-xs">{initials(user.username)}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{user.username}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <Progress value={health.details.progress} className="h-1 flex-1" />
            <span className="text-xs text-muted-foreground shrink-0">
              {Math.round(health.details.progress)}%
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Até {format(health.details.end, 'dd/MM/yyyy')}
          </p>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors shrink-0" />
      </div>
    );
  }

  // CONCESSIVO
  const risk = health.details.risk;
  const cfg = RISK_CONFIG[risk];

  return (
    <div
      onClick={onClick}
      className={`group flex flex-col rounded-xl border border-l-4 ${RISK_ACCENT[risk]} bg-card px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors`}
    >
      {/* Linha principal: avatar + nome + badge + seta */}
      <div className="flex items-center gap-3">
        <Avatar className="h-9 w-9 shrink-0">
          <AvatarImage src={user.avatarUrl} />
          <AvatarFallback className="text-xs">{initials(user.username)}</AvatarFallback>
        </Avatar>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium truncate">{user.username}</p>
            <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`}>
              {cfg.label}
            </span>
          </div>

          <div className="flex items-center gap-2 mt-1">
            <Progress
              value={health.details.progress}
              className={`h-1.5 flex-1 ${RISK_PROGRESS_CLASS[risk]}`}
            />
          </div>

          <p className="text-xs text-muted-foreground mt-0.5">
            Vence em {format(health.details.deadline, 'dd/MM/yyyy', { locale: ptBR })}
          </p>
        </div>

        <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors shrink-0" />
      </div>

      {/* Linha de dias */}
      {cycleStats && (
        <div className="flex items-center gap-2 mt-2.5 pt-2.5 border-t border-border/50 flex-wrap">
          {/* Faltam a agendar */}
          <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full
            ${cycleStats.balance <= 0
              ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
              : 'bg-muted text-muted-foreground'
            }`}>
            <span className="font-bold">{Math.max(0, cycleStats.balance)}d</span>
            <span className="font-normal opacity-80">a agendar</span>
          </span>

          {/* Agendado (PLANNED) */}
          {cycleStats.plannedDays > 0 && (
            <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">
              <span className="font-bold">{cycleStats.plannedDays}d</span>
              <span className="font-normal opacity-80">agendado</span>
            </span>
          )}

          {/* Gozado (APPROVED) */}
          {cycleStats.approvedDays > 0 && (
            <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
              <span className="font-bold">{cycleStats.approvedDays}d</span>
              <span className="font-normal opacity-80">gozado</span>
            </span>
          )}

          {/* Comprado (venda) */}
          {cycleStats.soldDays > 0 && (
            <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
              <span className="font-bold">{cycleStats.soldDays}d</span>
              <span className="font-normal opacity-80">comprado</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function CardSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-l-4 border-l-muted bg-card px-4 py-3 animate-pulse">
      <div className="h-9 w-9 rounded-full bg-muted shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 bg-muted rounded w-3/5" />
        <div className="h-1.5 bg-muted rounded w-full" />
        <div className="h-3 bg-muted/60 rounded w-2/5" />
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function DPFeriasManager() {
  const { vacations, vacationsLoading, units } = useDP();
  const { activeUsers } = useAuth();
  const router = useRouter();

  const [search, setSearch] = useState('');
  const [unitFilter, setUnitFilter] = useState<string>('__all__');

  const operationalUsers = useMemo(() => {
    const ops = activeUsers.filter(u => u.operacional === true);
    if (unitFilter === '__all__') return ops;
    return ops.filter(u => u.unitIds?.includes(unitFilter));
  }, [activeUsers, unitFilter]);

  // Compute health + cycle stats for each active user
  const collaboratorsWithHealth = useMemo(() => {
    return operationalUsers
      .map(user => {
        const admDate = toDate(user.admissionDate);
        const userVacations = vacations.filter(v => v.userId === user.id);
        const health = calculateVacationHealth(admDate, userVacations);

        // Compute cycle stats from the open concessivo cycle
        let cycleStats: CycleStats | undefined;
        if (health.status === 'CONCESSIVO' && admDate) {
          const cycles = getVacationCycleHistory(admDate, userVacations);
          const openCycle = cycles.find(c => c.status !== 'GOZADO' && c.status !== 'AQUISITIVO');
          if (openCycle) {
            const activeRecords = openCycle.records.filter(r => r.status !== 'REJECTED');
            const plannedDays = activeRecords
              .filter(r => r.recordType === 'gozo' && r.status === 'PLANNED')
              .reduce((t, r) => t + r.days, 0);
            const approvedDays = activeRecords
              .filter(r => r.recordType === 'gozo' && r.status === 'APPROVED')
              .reduce((t, r) => t + r.days, 0);
            const soldDays = activeRecords
              .filter(r => r.recordType === 'venda')
              .reduce((t, r) => t + r.days, 0);
            cycleStats = {
              plannedDays,
              approvedDays,
              soldDays,
              balance: 30 - plannedDays - approvedDays - soldDays,
            };
          }
        }

        return { user, health, cycleStats };
      })
      .filter(({ health }) => health.status !== 'INVALIDO');
  }, [operationalUsers, vacations]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return collaboratorsWithHealth.filter(({ user }) =>
      user.username.toLowerCase().includes(q)
    );
  }, [collaboratorsWithHealth, search]);

  // Split into CONCESSIVO (need scheduling) and AQUISITIVO (still accumulating)
  const concessivo = useMemo(() =>
    filtered
      .filter(({ health }) => health.status === 'CONCESSIVO')
      .sort((a, b) => {
        if (a.health.status !== 'CONCESSIVO' || b.health.status !== 'CONCESSIVO') return 0;
        const riskOrder: Record<VacationRisk, number> = { VENCIDA: 0, CRITICA: 1, ATENCAO: 2, EM_DIA: 3 };
        const rA = riskOrder[a.health.details.risk];
        const rB = riskOrder[b.health.details.risk];
        if (rA !== rB) return rA - rB;
        // Same risk: sort by deadline ascending
        return a.health.details.deadline.getTime() - b.health.details.deadline.getTime();
      }),
    [filtered]
  );

  const aquisitivo = useMemo(() =>
    filtered
      .filter(({ health }) => health.status === 'AQUISITIVO')
      .sort((a, b) => {
        if (a.health.status !== 'AQUISITIVO' || b.health.status !== 'AQUISITIVO') return 0;
        return b.health.details.progress - a.health.details.progress;
      }),
    [filtered]
  );

  const isLoading = vacationsLoading;

  // Approved gozo vacations for timeline
  const approvedVacations = useMemo(() =>
    vacations.filter(v => v.status === 'APPROVED' && v.recordType === 'gozo'),
    [vacations]
  );

  return (
    <div className="space-y-8">

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar colaborador..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={unitFilter} onValueChange={setUnitFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Todas as unidades" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todas as unidades</SelectItem>
            {units.map(u => (
              <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Timeline */}
      <DPVacationTimeline users={operationalUsers} vacations={approvedVacations} />

      {/* Prioridade de Agendamento */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Prioridade de Agendamento
          </h2>
          {!isLoading && concessivo.length > 0 && (
            <Badge variant="secondary" className="text-xs">{concessivo.length}</Badge>
          )}
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[...Array(4)].map((_, i) => <CardSkeleton key={i} />)}
          </div>
        ) : concessivo.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2 rounded-xl border border-dashed">
            <CalendarDays className="h-8 w-8 opacity-30" />
            <p className="text-sm">Todos os colaboradores estão com férias em dia.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {concessivo.map(({ user, health, cycleStats }) => (
              <CollaboratorCard
                key={user.id}
                user={user}
                health={health}
                cycleStats={cycleStats}
                onClick={() => router.push(`/dashboard/dp/ferias/${user.id}`)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Período Aquisitivo */}
      {(isLoading || aquisitivo.length > 0) && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Período Aquisitivo
            </h2>
            {!isLoading && (
              <Badge variant="secondary" className="text-xs">{aquisitivo.length}</Badge>
            )}
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[...Array(4)].map((_, i) => <CardSkeleton key={i} />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {aquisitivo.map(({ user, health }) => (
                <CollaboratorCard
                  key={user.id}
                  user={user}
                  health={health}
                  onClick={() => router.push(`/dashboard/dp/ferias/${user.id}`)}
                />
              ))}
            </div>

          )}
        </div>
      )}


    </div>
  );
}
