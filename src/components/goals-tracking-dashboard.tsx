"use client";

import { useState, useMemo } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { useGoals } from '@/contexts/goals-context';
import { useAuth } from '@/hooks/use-auth';
import { useKiosks } from '@/hooks/use-kiosks';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { CloseGoalModal } from '@/components/close-goal-modal';
import { EditGoalPeriodModal } from '@/components/edit-goal-period-modal';
import { GoalTemplateFormModal } from '@/components/goal-template-form-modal';
import { AddEmployeeGoalModal } from '@/components/add-employee-goal-modal';
import { type GoalPeriodDoc, type EmployeeGoal } from '@/types';
import { Target, Plus, RefreshCw, ChevronDown, Menu, BarChart2 } from 'lucide-react';
import {
  format, startOfWeek, endOfWeek, endOfMonth, eachDayOfInterval,
  getDaysInMonth, getDate, startOfMonth,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';

// ── Formatação ────────────────────────────────────────────────────────────────

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pct(value: number, target: number) {
  if (target <= 0) return 0;
  return (value / target) * 100;
}

function getStatusColor(p: number) {
  if (p >= 100) return { bar: 'bg-green-500', text: 'text-green-600 dark:text-green-400' };
  if (p >= 90)  return { bar: 'bg-emerald-400', text: 'text-emerald-600 dark:text-emerald-400' };
  if (p >= 70)  return { bar: 'bg-amber-400', text: 'text-amber-600 dark:text-amber-400' };
  return { bar: 'bg-primary/70', text: 'text-muted-foreground' };
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Barra de progresso ────────────────────────────────────────────────────────

function GoalBar({ value, alvo, up, compact }: { value: number; alvo: number; up: number; compact?: boolean }) {
  const max = Math.max(up * 1.05, value * 1.05, 1);
  const filled = Math.min((value / max) * 100, 100);
  const markerAlvo = Math.min((alvo / max) * 100, 99);
  const markerUp = Math.min((up / max) * 100, 99);
  const { bar: color } = getStatusColor(pct(value, alvo));
  const h = compact ? 'h-1.5' : 'h-2';
  return (
    <div className={`relative ${h} bg-muted rounded-full overflow-visible`}>
      <div className={`${h} rounded-full transition-all ${color}`} style={{ width: `${filled}%` }} />
      <div className="absolute top-0 bottom-0 w-px bg-green-500/60" style={{ left: `${markerAlvo}%` }} title={`Alvo: R$ ${fmt(alvo)}`} />
      <div className="absolute top-0 bottom-0 w-px bg-amber-400/60" style={{ left: `${markerUp}%` }} title={`UP: R$ ${fmt(up)}`} />
    </div>
  );
}

function StatusBadge({ value, alvo, up }: { value: number; alvo: number; up: number }) {
  const p = pct(value, alvo);
  const { text } = getStatusColor(p);
  const dotColor = p >= 100 ? 'bg-green-500' : p >= 90 ? 'bg-emerald-400' : p >= 70 ? 'bg-amber-400' : 'bg-primary/60';
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold tabular-nums shrink-0 ${text}`}>
      <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
      {p.toFixed(1)}%
    </span>
  );
}

// ── Contexto do período ───────────────────────────────────────────────────────

function getPeriodContext(period: GoalPeriodDoc) {
  const now = new Date();
  const periodStart = period.startDate?.toDate?.() ?? now;
  const periodEnd = period.endDate?.toDate?.() ?? now;
  // Se hoje está dentro do período: usa hoje; se passou: usa o último dia do período
  const isCurrent = now >= periodStart && now <= periodEnd;
  const refDate = isCurrent ? now : periodEnd;
  return { isCurrent, refDate, periodStart, periodEnd };
}

// ── Calculadores ──────────────────────────────────────────────────────────────

function calcMonthlyStats(period: GoalPeriodDoc) {
  const up = period.upValue ?? period.targetValue * 1.2;
  return { value: period.currentValue, alvo: period.targetValue, up };
}

function calcDailyStats(period: GoalPeriodDoc, refDate: Date) {
  const dp = period.dailyProgress ?? {};
  const refKey = dateKey(refDate);
  const daysInMonth = getDaysInMonth(refDate);
  const dayOfMonth = getDate(refDate);
  let salesBeforeRef = 0;
  for (let d = 1; d < dayOfMonth; d++) {
    const key = `${refDate.getFullYear()}-${String(refDate.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    salesBeforeRef += dp[key] ?? 0;
  }
  const remainingDays = daysInMonth - dayOfMonth + 1;
  const up = period.upValue ?? period.targetValue * 1.2;
  const alvo = remainingDays > 0 ? Math.max(period.targetValue - salesBeforeRef, 0) / remainingDays : 0;
  const upDay = remainingDays > 0 ? Math.max(up - salesBeforeRef, 0) / remainingDays : 0;
  return { value: dp[refKey] ?? 0, alvo, up: upDay, hasDailyData: Object.keys(dp).length > 0 };
}

function calcWeeklyStats(period: GoalPeriodDoc, refDate: Date, periodEnd: Date) {
  const dp = period.dailyProgress ?? {};
  const up = period.upValue ?? period.targetValue * 1.2;
  const weekStart = startOfWeek(refDate, { weekStartsOn: 1 });
  const weekEndRaw = endOfWeek(refDate, { weekStartsOn: 1 });
  const monthEnd = endOfMonth(refDate);
  const cap = weekEndRaw > monthEnd ? monthEnd : weekEndRaw;
  const effectiveEnd = cap > periodEnd ? periodEnd : cap;
  const effectiveStart = weekStart < startOfMonth(refDate) ? startOfMonth(refDate) : weekStart;
  const weekDays = eachDayOfInterval({ start: effectiveStart, end: effectiveEnd });
  const value = weekDays.reduce((s, d) => s + (dp[dateKey(d)] ?? 0), 0);

  // Alvo calculado a partir do 1º dia da semana: (meta - acumulado antes da semana) / dias restantes no mês desde a semana
  const daysInMonth = getDaysInMonth(refDate);
  const dayOfWeekStart = getDate(effectiveStart);
  let salesBeforeWeekStart = 0;
  for (let d = 1; d < dayOfWeekStart; d++) {
    const key = `${effectiveStart.getFullYear()}-${String(effectiveStart.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    salesBeforeWeekStart += dp[key] ?? 0;
  }
  const remainingFromWeekStart = daysInMonth - dayOfWeekStart + 1;
  const dailyAlvo = remainingFromWeekStart > 0 ? Math.max(period.targetValue - salesBeforeWeekStart, 0) / remainingFromWeekStart : 0;
  const dailyUp = remainingFromWeekStart > 0 ? Math.max(up - salesBeforeWeekStart, 0) / remainingFromWeekStart : 0;

  const weekLabel = effectiveStart.getTime() === effectiveEnd.getTime()
    ? format(effectiveStart, 'dd/MM', { locale: ptBR })
    : `${format(effectiveStart, 'dd/MM', { locale: ptBR })} – ${format(effectiveEnd, 'dd/MM', { locale: ptBR })}`;
  return { value, alvo: dailyAlvo * weekDays.length, up: dailyUp * weekDays.length, weekLabel };
}

function calcEgDaily(eg: EmployeeGoal, refDate: Date) {
  const dp = eg.dailyProgress ?? {};
  const refKey = dateKey(refDate);
  const daysInMonth = getDaysInMonth(refDate);
  const dayOfMonth = getDate(refDate);
  let salesBeforeRef = 0;
  for (let d = 1; d < dayOfMonth; d++) {
    const key = `${refDate.getFullYear()}-${String(refDate.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    salesBeforeRef += dp[key] ?? 0;
  }
  const remainingDays = daysInMonth - dayOfMonth + 1;
  const up = eg.targetValue * 1.2;
  const alvo = remainingDays > 0 ? Math.max(eg.targetValue - salesBeforeRef, 0) / remainingDays : 0;
  const upDay = remainingDays > 0 ? Math.max(up - salesBeforeRef, 0) / remainingDays : 0;
  return { value: dp[refKey] ?? 0, alvo, up: upDay, hasDailyData: Object.keys(dp).length > 0 };
}

function calcEgWeekly(eg: EmployeeGoal, refDate: Date, periodEnd: Date) {
  const dp = eg.dailyProgress ?? {};
  const weekStart = startOfWeek(refDate, { weekStartsOn: 1 });
  const weekEndRaw = endOfWeek(refDate, { weekStartsOn: 1 });
  const monthEnd = endOfMonth(refDate);
  const cap = weekEndRaw > monthEnd ? monthEnd : weekEndRaw;
  const effectiveEnd = cap > periodEnd ? periodEnd : cap;
  const effectiveStart = weekStart < startOfMonth(refDate) ? startOfMonth(refDate) : weekStart;
  const weekDays = eachDayOfInterval({ start: effectiveStart, end: effectiveEnd });
  const value = weekDays.reduce((s, d) => s + (dp[dateKey(d)] ?? 0), 0);
  const daysInMonth = getDaysInMonth(refDate);
  const dayOfWeekStart = getDate(effectiveStart);
  let salesBeforeWeekStart = 0;
  for (let d = 1; d < dayOfWeekStart; d++) {
    const key = `${effectiveStart.getFullYear()}-${String(effectiveStart.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    salesBeforeWeekStart += dp[key] ?? 0;
  }
  const remainingFromWeekStart = daysInMonth - dayOfWeekStart + 1;
  const up = eg.targetValue * 1.2;
  const dailyAlvo = remainingFromWeekStart > 0 ? Math.max(eg.targetValue - salesBeforeWeekStart, 0) / remainingFromWeekStart : 0;
  const dailyUp = remainingFromWeekStart > 0 ? Math.max(up - salesBeforeWeekStart, 0) / remainingFromWeekStart : 0;
  const weekLabel = effectiveStart.getTime() === effectiveEnd.getTime()
    ? format(effectiveStart, 'dd/MM', { locale: ptBR })
    : `${format(effectiveStart, 'dd/MM', { locale: ptBR })} – ${format(effectiveEnd, 'dd/MM', { locale: ptBR })}`;
  return { value, alvo: dailyAlvo * weekDays.length, up: dailyUp * weekDays.length, weekLabel };
}

// ── Linha de indicador ────────────────────────────────────────────────────────

function MetricRow({ label, value, alvo, up, sub }: { label: string; value: number; alvo: number; up: number; sub?: string }) {
  const { text } = getStatusColor(pct(value, alvo));
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-1.5">
          <span className="text-sm font-semibold">{label}</span>
          {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
        </div>
        <StatusBadge value={value} alvo={alvo} up={up} />
      </div>
      <div className="flex items-baseline gap-2">
        <span className={`text-base font-bold ${text}`}>R$ {fmt(value)}</span>
        <span className="text-xs text-muted-foreground">meta R$ {fmt(alvo)}</span>
        {up > alvo && <span className="text-xs text-muted-foreground">· UP R$ {fmt(up)}</span>}
      </div>
      <GoalBar value={value} alvo={alvo} up={up} />
    </div>
  );
}

// ── Cores de colaborador ─────────────────────────────────────────────────────

const COLLABORATOR_COLORS = [
  'text-rose-500',
  'text-orange-500',
  'text-amber-500',
  'text-lime-600',
  'text-teal-500',
  'text-cyan-500',
  'text-sky-500',
  'text-violet-500',
  'text-fuchsia-500',
  'text-pink-500',
];

function collaboratorColor(employeeId: string): string {
  let hash = 0;
  for (let i = 0; i < employeeId.length; i++) {
    hash = (hash * 31 + employeeId.charCodeAt(i)) & 0xffff;
  }
  return COLLABORATOR_COLORS[hash % COLLABORATOR_COLORS.length];
}

const COLLABORATOR_AVATAR_COLORS = [
  'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400',
  'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400',
  'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
  'bg-lime-100 text-lime-700 dark:bg-lime-900/30 dark:text-lime-400',
  'bg-teal-100 text-teal-600 dark:bg-teal-900/30 dark:text-teal-400',
  'bg-cyan-100 text-cyan-600 dark:bg-cyan-900/30 dark:text-cyan-400',
  'bg-sky-100 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400',
  'bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400',
  'bg-fuchsia-100 text-fuchsia-600 dark:bg-fuchsia-900/30 dark:text-fuchsia-400',
  'bg-pink-100 text-pink-600 dark:bg-pink-900/30 dark:text-pink-400',
];

function collaboratorAvatarClass(employeeId: string): string {
  let hash = 0;
  for (let i = 0; i < employeeId.length; i++) {
    hash = (hash * 31 + employeeId.charCodeAt(i)) & 0xffff;
  }
  return COLLABORATOR_AVATAR_COLORS[hash % COLLABORATOR_AVATAR_COLORS.length];
}

function getInitials(name: string): string {
  return name.split(' ').slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase();
}

// ── Coluna de métrica compacta (usada no grid 3-col de CollaboratorCard) ──────

function MiniCol({ label, value, alvo, up, onAnalyze }: {
  label: string; value: number; alvo: number; up: number; onAnalyze?: () => void;
}) {
  const p = pct(value, alvo);
  const { text } = getStatusColor(p);
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex items-center gap-0.5 min-w-0">
        <span className="text-[10px] text-muted-foreground truncate flex-1 leading-none">{label}</span>
        {onAnalyze && (
          <button type="button" onClick={onAnalyze}
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
            title="Análise por dia">
            <BarChart2 className="h-2.5 w-2.5" />
          </button>
        )}
      </div>
      <GoalBar value={value} alvo={alvo} up={up} compact />
      <span className={`text-[11px] font-bold tabular-nums ${text}`}>{p.toFixed(1)}%</span>
      <span className="text-[10px] text-muted-foreground tabular-nums leading-none">R$ {fmt(value)}</span>
    </div>
  );
}

// ── Cálculo diário para o dialog de análise ──────────────────────────────────

function computeDayRow(eg: EmployeeGoal, day: Date) {
  const dp = eg.dailyProgress ?? {};
  const key = dateKey(day);
  const daysInMonth = getDaysInMonth(day);
  const dayOfMonth = getDate(day);
  let salesBefore = 0;
  for (let d = 1; d < dayOfMonth; d++) {
    const k = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    salesBefore += dp[k] ?? 0;
  }
  const remaining = daysInMonth - dayOfMonth + 1;
  const alvo = remaining > 0 ? Math.max(eg.targetValue - salesBefore, 0) / remaining : 0;
  const value = dp[key] ?? 0;
  return { day, key, alvo, value, hit: value >= alvo && alvo > 0, hasData: key in dp };
}

// ── Dialog de análise diária ─────────────────────────────────────────────────

function EgDayAnalysisDialog({ open, onOpenChange, eg, userName, nameColor, title, days }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  eg: EmployeeGoal; userName: string; nameColor: string; title: string; days: Date[];
}) {
  const today = new Date();
  const rows = days
    .map(d => computeDayRow(eg, d))
    .filter(r => r.hasData || r.day <= today);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            <span className={nameColor}>{userName}</span>
            <span className="font-normal text-muted-foreground"> — {title}</span>
          </DialogTitle>
          <DialogDescription>Meta diária por dia do período</DialogDescription>
        </DialogHeader>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Nenhum dado disponível para este período.</p>
        ) : (
          <ScrollArea className="max-h-[60vh]">
            <div className="pr-3">
              {/* Cabeçalho */}
              <div className="grid grid-cols-[3rem_1fr_1fr_2rem] gap-x-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wide pb-1 border-b mb-1">
                <span>Dia</span>
                <span className="text-right">Alvo</span>
                <span className="text-right">Realizado</span>
                <span />
              </div>
              {rows.map(r => (
                <div key={r.key} className="grid grid-cols-[3rem_1fr_1fr_2rem] gap-x-2 items-center text-[11px] py-1 border-b border-border/40 last:border-0">
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {format(r.day, 'dd/MM', { locale: ptBR })}
                  </span>
                  <span className="text-right text-muted-foreground">R$ {fmt(r.alvo)}</span>
                  <span className={`text-right font-medium ${r.hit ? 'text-green-600' : 'text-foreground'}`}>
                    R$ {fmt(r.value)}
                  </span>
                  <span className="flex justify-end">
                    {!r.hasData || r.alvo <= 0
                      ? <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">—</Badge>
                      : r.hit
                      ? <Badge className="bg-green-500 text-white text-[9px] px-1 py-0 h-4">OK</Badge>
                      : <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">Miss</Badge>
                    }
                  </span>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CollaboratorCard({ eg, shiftLabel, userName, isMe, refDate, periodEnd, periodStart, isCurrent, periodMonthLabel }: {
  eg: EmployeeGoal; shiftLabel?: string; userName: string; isMe: boolean;
  refDate: Date; periodEnd: Date; periodStart: Date; isCurrent: boolean; periodMonthLabel: string;
}) {
  const up = eg.targetValue * 1.2;
  const daily = calcEgDaily(eg, refDate);
  const weekly = calcEgWeekly(eg, refDate, periodEnd);
  const nameColor = collaboratorColor(eg.employeeId);
  const avatarClass = collaboratorAvatarClass(eg.employeeId);

  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [analysisDays, setAnalysisDays] = useState<Date[]>([]);
  const [analysisTitle, setAnalysisTitle] = useState('');

  const dayLabel = isCurrent
    ? `Hoje ${format(refDate, 'dd/MM', { locale: ptBR })}`
    : format(refDate, "dd 'de' MMMM", { locale: ptBR });

  const monthShort = periodMonthLabel.split(' ')[0].replace(/^\w/, c => c.toUpperCase());

  function handleWeekAnalyze() {
    setAnalysisDays(eachDayOfInterval({ start: periodStart, end: refDate }));
    setAnalysisTitle(`Semana ${weekly.weekLabel}`);
    setAnalysisOpen(true);
  }

  function handleDayAnalyze() {
    setAnalysisDays(eachDayOfInterval({ start: periodStart, end: refDate }));
    setAnalysisTitle(dayLabel);
    setAnalysisOpen(true);
  }

  return (
    <div className={`rounded-md border px-3 py-2.5 ${isMe ? 'border-primary/40 bg-primary/5' : 'border-border/60'}`}>
      {/* Header: avatar + nome + badges */}
      <div className="flex items-center gap-2 pb-2 mb-2 border-b border-border/40">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${avatarClass}`}>
          {getInitials(userName)}
        </div>
        <span className={`text-xs font-semibold flex-1 truncate ${nameColor}`}>{userName}</span>
        <div className="flex items-center gap-1 shrink-0">
          {isMe && <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">Você</Badge>}
          {shiftLabel && <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">{shiftLabel}</Badge>}
        </div>
      </div>
      {/* Grid 3 colunas: Mês | Semana | Hoje */}
      <div className="grid grid-cols-3 gap-3">
        <MiniCol label={monthShort} value={eg.currentValue} alvo={eg.targetValue} up={up} />
        <MiniCol label={`Sem ${weekly.weekLabel}`} value={weekly.value} alvo={weekly.alvo} up={weekly.up} onAnalyze={handleWeekAnalyze} />
        <MiniCol label={dayLabel} value={daily.value} alvo={daily.alvo} up={daily.up} onAnalyze={handleDayAnalyze} />
      </div>
      <EgDayAnalysisDialog
        open={analysisOpen} onOpenChange={setAnalysisOpen}
        eg={eg} userName={userName} nameColor={nameColor}
        title={analysisTitle} days={analysisDays}
      />
    </div>
  );
}

// ── Estilo por tipo de meta ───────────────────────────────────────────────────

const GOAL_TYPE_STYLE: Record<string, { border: string; text: string; dot: string; label: string }> = {
  revenue:          { border: 'border-l-blue-400',    text: 'text-blue-600 dark:text-blue-400',     dot: 'bg-blue-400',    label: 'Faturamento' },
  ticket:           { border: 'border-l-violet-400',  text: 'text-violet-600 dark:text-violet-400',  dot: 'bg-violet-400',  label: 'Ticket Médio' },
  product_line:     { border: 'border-l-emerald-400', text: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-400', label: 'Linha de Produto' },
  product_specific: { border: 'border-l-orange-400',  text: 'text-orange-600 dark:text-orange-400',   dot: 'bg-orange-400',  label: 'Produto Específico' },
};

function getTypeStyle(type?: string) {
  return GOAL_TYPE_STYLE[type ?? ''] ?? { border: 'border-l-border', text: 'text-muted-foreground', dot: 'bg-muted-foreground', label: type ?? 'Meta' };
}

const TYPE_ORDER: Record<string, number> = { revenue: 0, ticket: 1, product_line: 2, product_specific: 3 };

// ── Componente principal ──────────────────────────────────────────────────────

export function GoalsTrackingDashboard() {
  const { periods, employeeGoals, templates, loading, deletePeriod, deleteEmployeeGoal } = useGoals();
  const { user, permissions, users } = useAuth();
  const { kiosks } = useKiosks();
  const { toast } = useToast();

  const isManager = (permissions.goals?.manage ?? false) || (permissions.settings?.manageUsers ?? false);
  const isAdmin = permissions.settings?.manageUsers ?? false;
  const userKioskIds = user?.assignedKioskIds ?? [];
  const availableKiosks = isAdmin ? kiosks : kiosks.filter(k => userKioskIds.includes(k.id));

  // Modais
  const [newMetaOpen, setNewMetaOpen] = useState(false);
  const [closeGoalOpen, setCloseGoalOpen] = useState(false);
  const [closingPeriod, setClosingPeriod] = useState<GoalPeriodDoc | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editPeriod, setEditPeriod] = useState<GoalPeriodDoc | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingPeriod, setDeletingPeriod] = useState<GoalPeriodDoc | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [employeeGoalOpen, setEmployeeGoalOpen] = useState(false);
  const [employeeGoalPeriod, setEmployeeGoalPeriod] = useState<GoalPeriodDoc | null>(null);

  // Sync manual
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
      const result = await fn(payload) as any;
      setSyncResults(result.data.results);
      toast({ title: 'Sync concluído', description: `${result.data.results.length} dias processados.` });
    } catch (e: any) {
      toast({ title: 'Erro no sync', description: e.message, variant: 'destructive' });
    }
    setSyncLoading(false);
  }

  async function handleDeletePeriod() {
    if (!deletingPeriod) return;
    setDeleteLoading(true);
    const goals = employeeGoals.filter(eg => eg.periodId === deletingPeriod.id);
    await Promise.all(goals.map(eg => deleteEmployeeGoal(eg.id)));
    await deletePeriod(deletingPeriod.id);
    toast({ title: 'Meta excluída.' });
    setDeleteOpen(false);
    setDeletingPeriod(null);
    setDeleteLoading(false);
  }

  const activePeriods = useMemo(() =>
    periods.filter(p => {
      if (p.status !== 'active') return false;
      return isManager || userKioskIds.includes(p.kioskId);
    }),
    [periods, userKioskIds, isManager]
  );

  // Agrupa períodos por quiosque + mês para exibir em um único card
  const periodGroups = useMemo(() => {
    const map = new Map<string, { groupKey: string; kioskId: string; monthLabel: string; periods: GoalPeriodDoc[] }>();
    activePeriods.forEach(p => {
      const start = p.startDate?.toDate?.() ?? new Date();
      const monthKey = format(start, 'yyyy-MM');
      const groupKey = `${p.kioskId}__${monthKey}`;
      if (!map.has(groupKey)) {
        map.set(groupKey, {
          groupKey,
          kioskId: p.kioskId,
          monthLabel: format(start, 'MMMM yyyy', { locale: ptBR }),
          periods: [],
        });
      }
      map.get(groupKey)!.periods.push(p);
    });
    // Ordena tipos dentro de cada grupo: revenue → ticket → product_line → product_specific
    map.forEach(g => {
      g.periods.sort((a, b) => {
        const ta = templates.find(t => t.id === a.templateId)?.type ?? '';
        const tb = templates.find(t => t.id === b.templateId)?.type ?? '';
        return (TYPE_ORDER[ta] ?? 99) - (TYPE_ORDER[tb] ?? 99);
      });
    });
    return Array.from(map.values());
  }, [activePeriods, templates]);

  const [openCards, setOpenCards] = useState<Record<string, boolean>>({});
  const isCardOpen = (id: string) => openCards[id] !== false; // default: open

  const getKioskName = (id: string) => kiosks.find(k => k.id === id)?.name ?? id;
  const getUserName = (id: string) => users.find(u => u.id === id)?.username ?? id;

  if (loading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-6">
      {/* ── Barra de ações (managers) ── */}
      {isManager && (
        <div className="flex items-center gap-3 flex-wrap justify-between">
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Button variant="outline" size="sm" onClick={() => { setSyncOpen(true); setSyncResults(null); }}>
                <RefreshCw className="mr-2 h-4 w-4" /> Sincronizar
              </Button>
            )}
          </div>
          <Button onClick={() => setNewMetaOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Nova Meta
          </Button>
        </div>
      )}

      {periodGroups.length === 0 ? (
        <Card>
          <CardContent className="py-16 flex flex-col items-center gap-2 text-muted-foreground">
            <Target className="h-10 w-10 opacity-30" />
            <p>Nenhuma meta ativa.</p>
            {isManager && (
              <Button variant="outline" size="sm" className="mt-2" onClick={() => setNewMetaOpen(true)}>
                <Plus className="mr-2 h-4 w-4" /> Criar meta
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ── Legenda de tipos ── */}
          {(() => {
            const allTypes = [...new Set(periodGroups.flatMap(g =>
              g.periods.map(p => templates.find(t => t.id === p.templateId)?.type ?? '')
            ))].filter(Boolean);
            if (allTypes.length <= 1) return null;
            return (
              <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                <span className="font-medium">Legenda:</span>
                {allTypes.map(type => {
                  const style = getTypeStyle(type);
                  return (
                    <span key={type} className="flex items-center gap-1">
                      <span className={`inline-block w-2 h-2 rounded-full ${style.dot}`} />
                      <span>{style.label}</span>
                    </span>
                  );
                })}
              </div>
            );
          })()}
          {periodGroups.map(group => {
          const open = isCardOpen(group.groupKey);
          const groupTypes = group.periods.map(p => templates.find(t => t.id === p.templateId)?.type ?? '');

          return (
            <Card key={group.groupKey}>
              <Collapsible
                open={open}
                onOpenChange={v => setOpenCards(prev => ({ ...prev, [group.groupKey]: v }))}
              >
                {/* ── Cabeçalho do grupo ── */}
                <div className="flex items-center justify-between gap-2 px-5 py-4">
                  <CollapsibleTrigger asChild>
                    <button className="flex items-center gap-2 flex-1 min-w-0 text-left">
                      <Target className="h-5 w-5 text-muted-foreground shrink-0" />
                      <span className="text-base font-semibold truncate">{getKioskName(group.kioskId)}</span>
                      <Badge variant="outline" className="text-xs capitalize shrink-0">{group.monthLabel}</Badge>
                      {/* Indicadores coloridos de tipo */}
                      <span className="flex items-center gap-1 shrink-0">
                        {groupTypes.map((type, i) => {
                          const style = getTypeStyle(type);
                          return (
                            <span key={i} title={style.label} className={`inline-block w-2 h-2 rounded-full ${style.dot}`} />
                          );
                        })}
                      </span>
                      <ChevronDown
                        className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
                      />
                    </button>
                  </CollapsibleTrigger>
                </div>

                {/* ── Subcards por tipo de meta ── */}
                <CollapsibleContent>
                  <CardContent className="pt-0 space-y-3 pb-5">
                    {/* ── Geral do quiosque (resumo do faturamento) ── */}
                    {(() => {
                      const revPeriod = group.periods.find(p => templates.find(t => t.id === p.templateId)?.type === 'revenue');
                      if (!revPeriod || group.periods.length <= 1) return null;
                      const up = revPeriod.upValue ?? revPeriod.targetValue * 1.2;
                      return (
                        <div className="rounded-lg bg-muted/40 px-4 py-3 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-muted-foreground">Geral do quiosque</span>
                            <StatusBadge value={revPeriod.currentValue} alvo={revPeriod.targetValue} up={up} />
                          </div>
                          <GoalBar value={revPeriod.currentValue} alvo={revPeriod.targetValue} up={up} />
                          <div className="flex items-baseline gap-1.5">
                            <span className={`text-sm font-bold ${getStatusColor(pct(revPeriod.currentValue, revPeriod.targetValue)).text}`}>
                              R$ {fmt(revPeriod.currentValue)}
                            </span>
                            <span className="text-xs text-muted-foreground">de R$ {fmt(revPeriod.targetValue)}</span>
                          </div>
                        </div>
                      );
                    })()}
                    {group.periods.map(period => {
                      const template = templates.find(t => t.id === period.templateId);
                      const goalType = template?.type ?? 'revenue';
                      const typeStyle = getTypeStyle(goalType);
                      const { isCurrent, refDate, periodEnd, periodStart } = getPeriodContext(period);
                      const monthly = calcMonthlyStats(period);
                      const weekly = calcWeeklyStats(period, refDate, periodEnd);
                      const daily = calcDailyStats(period, refDate);
                      const periodMonthLabel = group.monthLabel;

                      // Título do subcard: para produtos mostra o nome específico
                      const subTitle = goalType === 'product_line'
                        ? `${typeStyle.label}${template?.productLineName ? ` — ${template.productLineName}` : ''}`
                        : goalType === 'product_specific'
                        ? `${typeStyle.label}${template?.productName ? ` — ${template.productName}` : ''}`
                        : typeStyle.label;

                      const periodGoals = goalType === 'revenue'
                        ? employeeGoals
                            .filter(eg => eg.periodId === period.id)
                            .sort((a, b) => pct(b.currentValue, b.targetValue) - pct(a.currentValue, a.targetValue))
                        : [];

                      return (
                        <div
                          key={period.id}
                          className={`rounded-lg border border-border/60 border-l-4 ${typeStyle.border} p-4 space-y-4`}
                        >
                          {/* ── Cabeçalho do subcard ── */}
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 flex-wrap min-w-0">
                              <span className={`text-sm font-semibold ${typeStyle.text}`}>{subTitle}</span>
                              {!isCurrent && (
                                <Badge variant="secondary" className="text-xs shrink-0">Encerrado</Badge>
                              )}
                            </div>
                            {isManager && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 shrink-0">
                                    <Menu className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-44">
                                  <DropdownMenuItem onClick={() => { setEditPeriod(period); setEditOpen(true); }}>
                                    Editar meta
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={() => { setClosingPeriod(period); setCloseGoalOpen(true); }}>
                                    Encerrar meta
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    onClick={() => { setDeletingPeriod(period); setDeleteOpen(true); }}
                                  >
                                    Excluir meta
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </div>

                          {/* ── Métricas ── */}
                          <div className="space-y-4">
                            <MetricRow
                              label={periodMonthLabel.replace(/^\w/, c => c.toUpperCase())}
                              value={monthly.value} alvo={monthly.alvo} up={monthly.up}
                            />
                            <MetricRow
                              label="Semana" sub={weekly.weekLabel}
                              value={weekly.value} alvo={weekly.alvo} up={weekly.up}
                            />
                            <MetricRow
                              label={isCurrent ? 'Hoje' : 'Último dia'} sub={format(refDate, "dd 'de' MMMM", { locale: ptBR })}
                              value={daily.value} alvo={daily.alvo} up={daily.up}
                            />
                          </div>

                          {/* ── Colaboradores (apenas faturamento) ── */}
                          {goalType === 'revenue' && (
                            <>
                              <Separator />
                              <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Por Colaborador</p>
                                  {periodGoals.length > 0 && (
                                    <span className="text-xs text-muted-foreground">({periodGoals.length})</span>
                                  )}
                                </div>
                                {periodGoals.length === 0 ? (
                                  <div className="flex items-center gap-2 py-1">
                                    <p className="text-sm text-muted-foreground">Nenhum colaborador vinculado</p>
                                    {isManager && (
                                      <Button variant="ghost" size="sm" className="h-6 text-xs px-2 text-muted-foreground hover:text-foreground"
                                        onClick={() => { setEmployeeGoalPeriod(period); setEmployeeGoalOpen(true); }}>
                                        · Adicionar
                                      </Button>
                                    )}
                                  </div>
                                ) : (
                                  <div className="space-y-2">
                                    {periodGoals.map(eg => {
                                      const shift = eg.shiftId ? period.shifts?.find(s => s.id === eg.shiftId) : null;
                                      return (
                                        <CollaboratorCard
                                          key={eg.id}
                                          eg={eg}
                                          shiftLabel={shift?.label}
                                          userName={getUserName(eg.employeeId)}
                                          isMe={eg.employeeId === user?.id}
                                          refDate={refDate}
                                          periodEnd={periodEnd}
                                          periodStart={periodStart}
                                          isCurrent={isCurrent}
                                          periodMonthLabel={periodMonthLabel}
                                        />
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            </>
                          )}

                          {/* ── Nota: ticket médio sem colaboradores ── */}
                          {goalType === 'ticket' && (
                            <p className="text-xs text-muted-foreground">Meta global do quiosque — faturamento ÷ cupons.</p>
                          )}
                        </div>
                      );
                    })}
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          );
        })}
        </>
      )}

      {/* ── Modais ── */}
      <GoalTemplateFormModal open={newMetaOpen} onOpenChange={setNewMetaOpen} />
      <EditGoalPeriodModal open={editOpen} onOpenChange={setEditOpen} period={editPeriod} />
      <CloseGoalModal open={closeGoalOpen} onOpenChange={setCloseGoalOpen} period={closingPeriod} />
      <AddEmployeeGoalModal open={employeeGoalOpen} onOpenChange={setEmployeeGoalOpen} period={employeeGoalPeriod} />

      {/* ── Confirmar exclusão ── */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir meta?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso remove o período e todos os dados de colaboradores vinculados. Essa ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteLoading}
              onClick={handleDeletePeriod}
            >
              {deleteLoading ? 'Excluindo...' : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Dialog sync ── */}
      <Dialog open={syncOpen} onOpenChange={setSyncOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Sincronizar Metas</DialogTitle>
            <DialogDescription>Busca faturamento do PDV Legal e atualiza as metas ativas no intervalo informado.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Quiosque</Label>
              <Select value={syncKioskId} onValueChange={setSyncKioskId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{availableKiosks.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>ID Filial PDV Legal</Label>
              <Input className="mt-1" placeholder="Opcional se já configurado" value={syncFilialId} onChange={e => setSyncFilialId(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Data início</Label>
                <Input type="date" className="mt-1" value={syncStart} onChange={e => setSyncStart(e.target.value)} />
              </div>
              <div>
                <Label>Data fim</Label>
                <Input type="date" className="mt-1" value={syncEnd} onChange={e => setSyncEnd(e.target.value)} />
              </div>
            </div>
            {syncResults && (
              <div className="rounded-md border p-3 max-h-48 overflow-y-auto space-y-1">
                {syncResults.map(r => (
                  <div key={r.date} className="flex justify-between text-xs">
                    <span className="font-mono">{r.date}</span>
                    {r.error
                      ? <span className="text-destructive">{r.error}</span>
                      : <span className="text-muted-foreground">R$ {(r.revenue ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>}
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
