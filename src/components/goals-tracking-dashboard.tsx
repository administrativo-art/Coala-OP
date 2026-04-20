"use client";

import React, { useState, useMemo, useEffect } from 'react';
import dynamic from 'next/dynamic';
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
import { 
  Target, Plus, RefreshCw, ChevronDown, ChevronRight, Menu, BarChart2, Sparkles, Calendar as CalendarIcon, Pencil, CheckCircle, Trash2
} from 'lucide-react';
import {
  format, startOfWeek, endOfWeek, endOfMonth, eachDayOfInterval,
  getDaysInMonth, getDate, startOfMonth, isSameDay, startOfYear
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { GoalsAiAnalysisModal } from '@/components/goals-ai-analysis-modal';
import { GoalsAnalysisOutputSchema } from '@/ai/flows/goals-schemas';
import { z } from 'zod';

const PdfDownloadButton = dynamic(() => import('@/components/goal-report-pdf'), { ssr: false });

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
  const now = new Date();
  const start = period.startDate?.toDate?.() ?? now;
  const end = period.endDate?.toDate?.() ?? now;
  
  const totalDays = Math.max(eachDayOfInterval({ start, end }).length, 1);
  const elapsedDays = eachDayOfInterval({ 
    start, 
    end: now < end ? (now < start ? start : now) : end 
  }).length;
  const remainingDays = Math.max(totalDays - elapsedDays, 0);

  const linearMarker = (elapsedDays / totalDays) * 100;
  const currentPace = elapsedDays > 0 ? period.currentValue / elapsedDays : 0;
  const projection = currentPace * totalDays;
  const neededDaily = remainingDays > 0 ? Math.max(period.targetValue - period.currentValue, 0) / remainingDays : 0;

  return { 
    value: period.currentValue, 
    alvo: period.targetValue, 
    up,
    elapsedDays,
    totalDays,
    remainingDays,
    linearMarker,
    currentPace,
    projection,
    neededDaily
  };
}

function calcWeeklyStats(period: GoalPeriodDoc, refDate: Date, periodEnd: Date) {
  const dp = period.dailyProgress ?? {};
  const weekStart = startOfWeek(refDate, { weekStartsOn: 1 });
  const weekEndRaw = endOfWeek(refDate, { weekStartsOn: 1 });
  const monthEnd = endOfMonth(refDate);
  const cap = weekEndRaw > monthEnd ? monthEnd : weekEndRaw;
  const effectiveEnd = cap > periodEnd ? periodEnd : cap;
  const effectiveStart = weekStart < startOfMonth(refDate) ? startOfMonth(refDate) : weekStart;
  const weekDays = eachDayOfInterval({ start: effectiveStart, end: effectiveEnd });
  const value = weekDays.reduce((s, d) => s + (dp[dateKey(d)] ?? 0), 0);

  // Consideramos o alvo proporcional da meta mensal para a semana
  const stats = calcMonthlyStats(period);
  const dailyAlvo = stats.alvo / stats.totalDays;
  const dailyUp = stats.up / stats.totalDays;

  const weekLabel = effectiveStart.getTime() === effectiveEnd.getTime()
    ? format(effectiveStart, 'dd/MM', { locale: ptBR })
    : `${format(effectiveStart, 'dd/MM', { locale: ptBR })} – ${format(effectiveEnd, 'dd/MM', { locale: ptBR })}`;
  
  return { 
    value, 
    alvo: dailyAlvo * weekDays.length, 
    up: dailyUp * weekDays.length, 
    weekLabel 
  };
}

function calcEgMonthly(eg: EmployeeGoal, refDate: Date) {
  const up = eg.targetValue * 1.2;
  const p = pct(eg.currentValue, eg.targetValue);
  return { value: eg.currentValue, alvo: eg.targetValue, up, p };
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
  
  // Alvo semanal proporcional
  const dailyAlvo = eg.targetValue / getDaysInMonth(refDate);
  const alvo = dailyAlvo * weekDays.length;
  const p = pct(value, alvo);
  
  return { value, alvo, p };
}

// ── Linha de indicador ────────────────────────────────────────────────────────

function StatItem({ title, value, subLabel, trend, trendColor }: { 
  title: string; value: string; subLabel: string; trend?: string; trendColor?: string 
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</span>
      <div className="flex items-center gap-2">
        <span className="text-2xl font-bold tabular-nums">R$ {value}</span>
      </div>
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-xs text-muted-foreground whitespace-nowrap">{subLabel}</span>
        {trend && (
          <span className={`text-xs font-bold ${trendColor || 'text-green-500'}`}>
            {trend}
          </span>
        )}
      </div>
    </div>
  );
}

function MainGoalProgress({ value, alvo, up, linearMarker }: { 
  value: number; alvo: number; up: number; linearMarker: number 
}) {
  const p = pct(value, alvo);
  const { bar: color } = getStatusColor(p);
  const markerAlvo = 100; // Representa a barra inteira em relação à meta base
  const markerUp = (up / alvo) * 100;
  const filled = (value / alvo) * 100;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-semibold">Meta do mês</span>
        <span className="text-xl font-bold text-amber-500">{p.toFixed(1)}%</span>
      </div>
      
      <div className="relative h-[8px] bg-slate-300 dark:bg-slate-700 rounded-[4px] overflow-visible mb-6">
        {/* Barra preenchida */}
        <div className={`absolute left-0 top-0 h-full rounded-[4px] transition-all duration-700 ${color}`} 
             style={{ width: `${Math.min(filled, 100)}%` }} />
        
        {/* Marcador linear (onde deveria estar hoje) */}
        <div className="absolute top-[-4px] bottom-[-4px] w-[2px] bg-muted-foreground/60 z-10" 
             style={{ left: `${linearMarker}%` }} />
        
        <span className="absolute -bottom-5 text-[10px] text-muted-foreground font-medium" style={{ left: `calc(${linearMarker}% - 30px)` }}>
          hoje ({linearMarker.toFixed(1)}%)
        </span>
      </div>

      <div className="flex justify-between items-center text-[10px] text-muted-foreground -mt-2">
         <span className="font-bold text-foreground">Realizado R$ {fmt(value)}</span>
         <span className="font-bold text-primary">Meta Alvo R$ {fmt(alvo)}</span>
      </div>

      {/* Barra de Super Meta (se houver) */}
      {up > alvo && (
        <div className="pt-2 space-y-1.5">
          <div className="relative h-[8px] bg-slate-300 dark:bg-slate-700 rounded-[4px] overflow-visible">
            <div className="absolute left-0 top-0 h-full rounded-[4px] bg-blue-500/70" 
                 style={{ width: `${Math.min((value / up) * 100, 100)}%` }} />
          </div>
          <div className="flex justify-between items-center text-[10px] text-muted-foreground">
             <span className="font-bold text-foreground">Realizado R$ {fmt(value)}</span>
             <span className="font-bold text-blue-500">UP R$ {fmt(up)}</span>
          </div>
        </div>
      )}
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

function looksLikeOpaqueUserIdentifier(value?: string | null): boolean {
  if (!value) return true;
  const trimmed = value.trim();
  if (!trimmed) return true;

  return /^[A-Za-z0-9_-]{20,}$/.test(trimmed);
}

// ── Dialog de análise diária (Mensal) ─────────────────────────────────────────

function DailyAnalysisModal({ open, onOpenChange, period, title, subjectName }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  period: GoalPeriodDoc | null; title: string; subjectName?: string | null;
}) {
  if (!period) return null;
  const now = new Date();
  const start = period.startDate?.toDate?.() ?? now;
  const end = period.endDate?.toDate?.() ?? now;
  const days = eachDayOfInterval({ start, end });
  const dp = period.dailyProgress ?? {};

  let cumulativeSales = 0;
  const totalTarget = period.targetValue;
  const daysInMonth = days.length;
  
  let lockedCurrentNeed: number | null = null;

  const rows = days.map((day, idx) => {
    const key = dateKey(day);
    const isPast = day <= now;
    const value = dp[key] ?? 0;
    
    let currentNeed = 0;

    if (isPast) {
      const remainingDays = daysInMonth - idx;
      currentNeed = remainingDays > 0 ? Math.max(totalTarget - cumulativeSales, 0) / remainingDays : 0;
      cumulativeSales += value;
    } else {
      if (lockedCurrentNeed === null) {
        const remainingDaysGlobal = daysInMonth - idx;
        lockedCurrentNeed = remainingDaysGlobal > 0 ? Math.max(totalTarget - cumulativeSales, 0) / remainingDaysGlobal : 0;
      }
      currentNeed = lockedCurrentNeed;
    }

    const hit = value >= currentNeed;

    return { day, key, currentNeed, value, hit, isPast };
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md">
        <DialogHeader>
          <DialogTitle className="pr-6 text-left leading-tight">{title}</DialogTitle>
          {subjectName ? (
            <div className="text-sm font-semibold text-foreground/85 break-words">
              {subjectName}
            </div>
          ) : null}
          <DialogDescription>Detalhamento de metas diárias para o período</DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_2fr_2fr_1fr] gap-2 text-[10px] uppercase font-bold text-muted-foreground pb-2 border-b">
              <span>Dia</span>
              <span className="text-right">Alvo Diário</span>
              <span className="text-right">Realizado</span>
              <span className="text-center">Status</span>
            </div>
            {rows.map(r => (
              <div key={r.key} className={`grid grid-cols-[1fr_2fr_2fr_1fr] gap-2 py-2 items-center border-b border-border/40 text-xs ${!r.isPast ? 'opacity-50' : ''}`}>
                <span className="font-medium">{format(r.day, 'dd/MM', { locale: ptBR })}</span>
                <span className="text-right text-muted-foreground">R$ {fmt(r.currentNeed)}</span>
                <span className="text-right font-semibold">R$ {fmt(r.value)}</span>
                <span className="flex justify-center">
                  {r.value > 0 ? (
                    r.hit ? <Badge className="bg-green-500 h-4 text-[9px]">OK</Badge> : <Badge variant="secondary" className="h-4 text-[9px]">MISS</Badge>
                  ) : r.isPast ? (
                    <Badge variant="outline" className="h-4 text-[9px]">ZERO</Badge>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CollaboratorCard({ eg, shiftLabel, userName, refDate, periodEnd, onOpenDaily }: {
  eg: EmployeeGoal; shiftLabel?: string; userName: string;
  refDate: Date; periodEnd: Date;
  onOpenDaily?: () => void;
}) {
  const initials = getInitials(userName);
  const avatarClass = collaboratorAvatarClass(eg.employeeId);
  const mPct = pct(eg.currentValue, eg.targetValue);
  const weekly = calcWeeklyStats(eg as any, refDate, periodEnd);
  
  // Detalhamento da semana atual
  const weekStart = startOfWeek(refDate, { weekStartsOn: 1 });
  const weekDays = eachDayOfInterval({ start: weekStart, end: endOfWeek(refDate, { weekStartsOn: 1 }) });
  const dailyTarget = eg.targetValue / getDaysInMonth(refDate);

  // Score de batida de meta no mês
  const monthDays = eachDayOfInterval({ start: startOfMonth(refDate), end: endOfMonth(refDate) });
  const hitCount = monthDays.filter(d => (eg.dailyProgress?.[dateKey(d)] ?? 0) >= dailyTarget).length;
  const totalDays = monthDays.length;

  return (
    <div 
      className="group p-5 hover:bg-accent/5 transition-colors cursor-pointer bg-[#ffffff] dark:bg-card/40 border border-[#e8e8e6] dark:border-border/40 rounded-[12px] mb-[8px]"
      onClick={onOpenDaily}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold shadow-sm ${avatarClass}`}>
            {initials}
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-bold leading-none mb-1">{userName}</span>
            <div className="flex items-center gap-2">
              {shiftLabel && <Badge variant="secondary" className="px-1.5 py-0 text-[9px] font-bold h-4 uppercase">{shiftLabel}</Badge>}
              <span className="text-[10px] text-muted-foreground font-medium">
                Meta: R$ {fmt(eg.targetValue)} · UP: R$ {fmt(eg.targetValue * 1.2)} · Diária: R$ {fmt(dailyTarget)}
              </span>
            </div>
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm font-bold tabular-nums">R$ {fmt(eg.currentValue)}</p>
          <div className="flex items-center justify-end gap-1">
            <span className="text-[10px] text-muted-foreground uppercase font-bold">{hitCount}/{totalDays}</span>
            <span className="text-[9px] text-muted-foreground uppercase font-medium tracking-tighter">dias batidos</span>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {/* Progress Mês */}
        <div className="space-y-1.5 text-[10px] uppercase font-bold tracking-wider text-muted-foreground/80">
          <div className="flex justify-between">
            <span>Progresso Mês</span>
            <span className={mPct >= 100 ? 'text-green-500' : ''}>{mPct.toFixed(1)}%</span>
          </div>
          <div className="h-[6px] bg-slate-300 dark:bg-slate-700 rounded-[3px] overflow-hidden">
            <div className={`h-full transition-all duration-500 ${getStatusColor(mPct).bar}`} style={{ width: `${Math.min(mPct, 100)}%` }} />
          </div>
        </div>

        {/* Progress Semana */}
        <div className="space-y-1.5 text-[10px] uppercase font-bold tracking-wider text-muted-foreground/80">
          <div className="flex justify-between">
            <span>Performance Semanal</span>
            <span className={pct(weekly.value, weekly.alvo) >= 100 ? 'text-green-500' : ''}>{pct(weekly.value, weekly.alvo).toFixed(1)}%</span>
          </div>
          <div className="h-[6px] bg-slate-300 dark:bg-slate-700 rounded-[3px] overflow-hidden">
            <div className="h-full bg-blue-500 transition-all duration-500" style={{ width: `${Math.min(pct(weekly.value, weekly.alvo), 100)}%` }} />
          </div>
        </div>

        {/* Detalhamento Diário da Semana */}
        <div className="grid grid-cols-7 gap-1 pt-2">
          {weekDays.map(d => {
            const key = dateKey(d);
            const val = eg.dailyProgress?.[key] ?? 0;
            const isHit = val >= dailyTarget;
            const isToday = isSameDay(d, refDate);
            return (
              <div key={key} className="flex flex-col items-center gap-1">
                <span className={`text-[8px] uppercase font-bold ${isToday ? 'text-primary' : 'text-muted-foreground/60'}`}>
                  {format(d, 'eee', { locale: ptBR }).substring(0, 1)}
                </span>
                <div 
                  className={`w-full h-1.5 rounded-sm transition-all ${val > 0 ? (isHit ? 'bg-green-500' : 'bg-amber-400') : 'bg-slate-300 dark:bg-slate-700'}`}
                  title={`${format(d, 'dd/MM')}: R$ ${fmt(val)}`}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}


function getInitialsShort(name: string) {
  return name.split(' ').slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase();
}

function KioskSummaryModal({ open, onOpenChange, group, employeeGoals, getUserName, kioskName }: {
  open: boolean; onOpenChange: (v: boolean) => void; group: any;
  employeeGoals: EmployeeGoal[]; getUserName: (id: string) => string; kioskName: string;
}) {
  if (!group) return null;
  const mainPeriod = group.periods.find((p: any) => p.type === 'revenue' || !p.type) ?? group.periods[0];
  if (!mainPeriod) return null;

  const now = new Date();
  const periodStart = mainPeriod.startDate.toDate();
  const periodEnd = mainPeriod.endDate.toDate();
  const monthDays = eachDayOfInterval({ start: startOfMonth(periodStart), end: endOfMonth(periodStart) });
  const elapsedDays = monthDays.filter(d => d <= now).length;
  const remainingDays = monthDays.length - elapsedDays;
  const dailyAlvo = mainPeriod.targetValue / monthDays.length;
  const dailyUp = (mainPeriod.upValue ?? mainPeriod.targetValue * 1.2) / monthDays.length;
  const stats = calcMonthlyStats(mainPeriod);

  // Percentual esperado até hoje
  const expectedPct = (elapsedDays / monthDays.length) * 100;
  const actualPct = pct(stats.value, stats.alvo);
  const diff = actualPct - expectedPct;

  // Dias com venda do quiosque
  const kioskDaysWithSale = monthDays.filter(d => (mainPeriod.dailyProgress?.[dateKey(d)] ?? 0) > 0).length;

  // Pace necessário para bater a meta
  const paceNeeded = remainingDays > 0 ? Math.max(stats.alvo - stats.value, 0) / remainingDays : 0;
  const paceActual = elapsedDays > 0 ? stats.value / elapsedDays : 0;

  // Colaboradores com dados
  const empRows = employeeGoals
    .filter(eg => eg.periodId === mainPeriod.id)
    .map(eg => {
      const name = getUserName(eg.employeeId);
      const dp = eg.dailyProgress ?? {};
      const empDailyAlvo = eg.targetValue / monthDays.length;
      const daysWithSale = monthDays.filter(d => (dp[dateKey(d)] ?? 0) > 0).length;
      const daysHit = monthDays.filter(d => (dp[dateKey(d)] ?? 0) >= empDailyAlvo).length;
      const empPace = elapsedDays > 0 ? eg.currentValue / elapsedDays : 0;
      const empPaceNeeded = remainingDays > 0 ? Math.max(eg.targetValue - eg.currentValue, 0) / remainingDays : 0;
      const empPct = pct(eg.currentValue, eg.targetValue);
      return { eg, name, dp, empDailyAlvo, daysWithSale, daysHit, empPace, empPaceNeeded, empPct };
    });

  // Alertas / badges
  const alerts: { label: string; color: string }[] = [];
  if (paceActual < dailyAlvo) alerts.push({ label: 'Pace insuficiente', color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400' });
  empRows.forEach(e => {
    if (e.daysWithSale === 0) alerts.push({ label: `${e.name.split(' ')[0]} sem vendas`, color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' });
  });
  if (remainingDays > 0) alerts.push({ label: `${remainingDays} dias restantes`, color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' });
  alerts.push({ label: `Projeção: ${actualPct.toFixed(1)}% da meta`, color: actualPct >= 100 ? 'bg-green-100 text-green-700 dark:bg-green-900/30' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' });

  const pdfData = {
    kioskName,
    monthLabel: group.monthLabel,
    totalValue: stats.value,
    totalPct: actualPct,
    expectedPct,
    diff,
    target: stats.alvo,
    upTarget: stats.up,
    upPct: pct(stats.value, stats.up),
    projection: stats.projection,
    paceActual,
    paceNeeded,
    dailyAlvo,
    elapsedDays,
    remainingDays,
    kioskDaysWithSale,
    totalMonthDays: monthDays.length,
    alerts: alerts.map(a => a.label),
    monthDays: monthDays.map(d => ({
      label: format(d, 'dd'),
      dateKey: dateKey(d),
      kioskValue: mainPeriod.dailyProgress?.[dateKey(d)] ?? 0,
    })),
    employees: empRows.map(e => ({
      name: e.name,
      value: e.eg.currentValue,
      target: e.eg.targetValue,
      pct: e.empPct,
      pace: e.empPace,
      paceNeeded: e.empPaceNeeded,
      daysWithSale: e.daysWithSale,
      daysHit: e.daysHit,
      totalDays: monthDays.length,
      dailyProgress: monthDays.map(d => e.dp[dateKey(d)] ?? 0),
    })),
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-[95vw] w-[95vw] h-[95vh] p-0 overflow-hidden flex flex-col">
        {/* ── Cabeçalho ── */}
        <div className="px-6 pt-5 pb-4 border-b border-border/40 flex items-start justify-between gap-4 shrink-0">
          <div>
            <DialogTitle className="text-xl font-bold tracking-tight">Situação Geral — {group.monthLabel}</DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {kioskName} · Meta: R$ {fmt(stats.alvo)} · Meta/dia: R$ {fmt(dailyAlvo)}
            </p>
          </div>
          <PdfDownloadButton data={pdfData} fileName={`relatorio-${group.groupKey}.pdf`} />
        </div>

        <ScrollArea className="flex-1 overflow-auto">
          <div className="px-6 py-5 space-y-6">

            {/* ── KPI Cards ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
              <div className="p-3 rounded-xl border border-slate-300/60 dark:border-border/40 bg-slate-100 dark:bg-slate-800/40 shadow-sm">
                <p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest mb-1">Acumulado</p>
                <p className="text-xl font-black tabular-nums">R$ {fmt(stats.value)}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">de R$ {fmt(stats.alvo)}</p>
              </div>
              <div className="p-3 rounded-xl border border-slate-300/60 dark:border-border/40 bg-slate-100 dark:bg-slate-800/40 shadow-sm">
                <p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest mb-1">% da Meta</p>
                <p className={`text-xl font-black tabular-nums ${actualPct >= 100 ? 'text-green-500' : 'text-amber-500'}`}>{actualPct.toFixed(1)}%</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Esperado hoje: {expectedPct.toFixed(1)}%</p>
                <p className={`text-[10px] font-bold mt-0.5 ${diff >= 0 ? 'text-green-600' : 'text-rose-500'}`}>
                  {diff >= 0 ? '▲' : '▼'} {Math.abs(diff).toFixed(1)} pp {diff >= 0 ? 'à frente' : 'atrás'}
                </p>
              </div>
              <div className="p-3 rounded-xl border border-slate-300/60 dark:border-border/40 bg-slate-100 dark:bg-slate-800/40 shadow-sm">
                <p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest mb-1">Projeção</p>
                <p className={`text-xl font-black tabular-nums ${stats.projection >= stats.alvo ? 'text-green-500' : 'text-rose-500'}`}>R$ {fmt(stats.projection)}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {stats.projection < stats.alvo ? `Falta R$ ${fmt(stats.alvo - stats.projection)}` : `Excede R$ ${fmt(stats.projection - stats.alvo)}`}
                </p>
                <p className={`text-[10px] font-bold mt-0.5 ${stats.projection >= stats.alvo ? 'text-green-600' : 'text-rose-500'}`}>
                  {pct(stats.projection, stats.alvo).toFixed(1)}% da meta
                </p>
              </div>
              <div className="p-3 rounded-xl border border-slate-300/60 dark:border-border/40 bg-slate-100 dark:bg-slate-800/40 shadow-sm">
                <p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest mb-1">Pace Necessário</p>
                <p className={`text-xl font-black tabular-nums ${paceActual >= paceNeeded ? 'text-green-500' : 'text-rose-500'}`}>R$ {fmt(paceNeeded)}/dia</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Atual: R$ {fmt(paceActual)}/dia</p>
                <p className={`text-[10px] font-bold mt-0.5 ${paceActual >= paceNeeded ? 'text-green-600' : 'text-rose-500'}`}>
                  {paceActual >= paceNeeded ? '▲' : '▼'} R$ {fmt(Math.abs(paceActual - paceNeeded))}/dia
                </p>
              </div>
              <div className="p-3 rounded-xl border border-slate-300/60 dark:border-border/40 bg-slate-100 dark:bg-slate-800/40 shadow-sm">
                <p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest mb-1">Consistência</p>
                <p className="text-xl font-black tabular-nums text-blue-500">{kioskDaysWithSale}/{monthDays.length} dias</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Dias com venda</p>
                {empRows.map(e => (
                  <p key={e.eg.id} className={`text-[10px] font-bold mt-0.5 ${e.daysWithSale === 0 ? 'text-rose-500' : 'text-muted-foreground'}`}>
                    {e.name.split(' ')[0]}: {e.daysWithSale} dias
                  </p>
                ))}
              </div>
            </div>

            {/* ── Barras de Progresso ── */}
            <div className="space-y-3 p-4 rounded-xl border border-border/40 bg-card/30">
              <div className="space-y-1.5">
                <div className="flex justify-between text-[10px] text-muted-foreground font-bold uppercase">
                  <span>Meta base</span>
                  <span className={actualPct >= 100 ? 'text-green-500' : 'text-amber-500'}>{actualPct.toFixed(1)}%</span>
                </div>
                <div className="relative h-2.5 bg-muted/40 rounded-full overflow-visible">
                  <div className={`h-full rounded-full transition-all ${actualPct >= 100 ? 'bg-green-500' : 'bg-primary'}`} style={{ width: `${Math.min(actualPct, 100)}%` }} />
                  <div className="absolute top-[-3px] bottom-[-3px] w-0.5 bg-muted-foreground/50" style={{ left: `${expectedPct}%` }} title={`Ritmo esperado: ${expectedPct.toFixed(1)}%`} />
                </div>
                <div className="flex justify-between text-[9px] text-muted-foreground">
                  <span>R$ 0</span>
                  <span className="text-muted-foreground/60">▲ ritmo esperado no dia {elapsedDays}</span>
                  <span>R$ {fmt(stats.alvo)}</span>
                </div>
              </div>
              {stats.up > stats.alvo && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[10px] text-muted-foreground font-bold uppercase">
                    <span>Super meta</span>
                    <span className="text-blue-500">{pct(stats.value, stats.up).toFixed(1)}%</span>
                  </div>
                  <div className="h-2 bg-slate-300 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500/70 transition-all" style={{ width: `${Math.min(pct(stats.value, stats.up), 100)}%` }} />
                  </div>
                  <div className="flex justify-between text-[9px] text-muted-foreground">
                    <span>R$ 0</span><span>R$ {fmt(stats.up)}</span>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                {alerts.map((a, i) => (
                  <span key={i} className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${a.color}`}>{a.label}</span>
                ))}
              </div>
            </div>

            {/* ── Tabela Diária ── */}
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-3">
                Progresso Diário — Valor Vendido vs. Meta do Dia
              </p>
              <div className="rounded-xl border border-border/40 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-[10px] border-collapse">
                    <thead>
                      <tr className="bg-muted/40 border-b border-border/40">
                        <th className="p-2 text-left sticky left-0 bg-muted/40 min-w-[130px] font-bold">Colaborador</th>
                        <th className="p-2 text-center border-x border-border/30 min-w-[50px] font-bold">% meta</th>
                        <th className="p-2 text-center border-r border-border/30 min-w-[70px] font-bold">Total</th>
                        {monthDays.map(d => {
                          const isToday = isSameDay(d, now);
                          return (
                            <th key={d.toISOString()} className={`px-1 py-1.5 text-center border-r border-border/20 w-8 font-bold ${isToday ? 'bg-primary/10 text-primary' : ''}`}>
                              {format(d, 'dd')}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {/* Linha Total Quiosque */}
                      <tr className="border-b border-border/30 bg-blue-50/20 dark:bg-blue-950/20 font-bold">
                        <td className="p-2 sticky left-0 bg-blue-50/40 dark:bg-blue-950/30 border-r border-border/20">
                          <div className="flex items-center gap-2">
                            <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center text-[8px] font-black text-primary">TQ</div>
                            <span>Total Quiosque</span>
                          </div>
                        </td>
                        <td className="p-2 text-center border-x border-border/20 text-primary font-black">
                          {actualPct.toFixed(0)}%
                        </td>
                        <td className="p-2 text-center border-r border-border/20 font-black">R$ {fmt(stats.value)}</td>
                        {monthDays.map(d => {
                          const val = mainPeriod.dailyProgress?.[dateKey(d)] ?? 0;
                          const hit = val >= dailyAlvo;
                          const isFuture = d > now;
                          const isToday = isSameDay(d, now);
                          const label = val > 0 ? (val >= 1000 ? (val/1000).toFixed(1)+'k' : val.toFixed(0)) : '—';
                          return (
                            <td
                              key={d.toISOString()}
                              title={val > 0 ? `Dia ${format(d,'dd')}: R$ ${fmt(val)} | Meta: R$ ${fmt(dailyAlvo)}` : `Dia ${format(d,'dd')}: sem venda`}
                              className={`px-1 py-1.5 text-center border-r border-border/20 font-mono text-[10px] w-8 ${isToday ? 'bg-primary/5 ring-1 ring-inset ring-primary/20' : ''} ${isFuture ? 'opacity-20' : val > 0 ? (hit ? 'text-green-600' : 'text-amber-600') : 'text-muted-foreground/30'}`}
                            >
                              {label}
                            </td>
                          );
                        })}
                      </tr>
                      {/* Linhas dos Colaboradores */}
                      {empRows.map((e, i) => (
                        <tr key={i} className="border-b border-border/20 last:border-0 hover:bg-accent/5">
                          <td className="p-2 sticky left-0 bg-background border-r border-border/20">
                            <div className="flex items-center gap-2">
                              <div className={`h-6 w-6 rounded-full flex items-center justify-center text-[8px] font-black ${collaboratorAvatarClass(e.eg.employeeId)}`}>
                                {getInitialsShort(e.name)}
                              </div>
                              <span className="font-medium">{e.name}</span>
                            </div>
                          </td>
                          <td className={`p-2 text-center border-x border-border/20 font-black ${e.empPct >= 100 ? 'text-green-500' : e.empPct >= 70 ? 'text-amber-500' : 'text-rose-500'}`}>
                            {e.empPct.toFixed(0)}%
                          </td>
                          <td className="p-2 text-center border-r border-border/20 font-bold">R$ {fmt(e.eg.currentValue)}</td>
                          {monthDays.map(d => {
                            const val = e.dp[dateKey(d)] ?? 0;
                            const hit = val >= e.empDailyAlvo;
                            const isFuture = d > now;
                            const isToday = isSameDay(d, now);
                            const label = val > 0 ? (val >= 1000 ? (val/1000).toFixed(1)+'k' : val.toFixed(0)) : '—';
                            return (
                              <td
                                key={d.toISOString()}
                                title={val > 0 ? `Dia ${format(d,'dd')}: R$ ${fmt(val)} | Meta: R$ ${fmt(e.empDailyAlvo)}` : `Dia ${format(d,'dd')}: sem venda`}
                                className={`px-1 py-1.5 text-center border-r border-border/20 font-mono text-[10px] w-8 ${isToday ? 'bg-primary/5 ring-1 ring-inset ring-primary/20' : ''} ${isFuture ? 'opacity-20' : val > 0 ? (hit ? 'text-green-600' : 'text-amber-600') : 'text-muted-foreground/30'}`}
                              >
                                {label}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* ── Diagnóstico Individual ── */}
            {empRows.length > 0 && (
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-3">Diagnóstico Individual</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {empRows.map((e, i) => {
                    const fraction = e.eg.fraction ?? 1;
                    const statusOk = e.empPace >= e.empPaceNeeded;
                    return (
                      <div key={i} className={`p-4 rounded-xl border-2 bg-card/60 space-y-3 ${e.empPct >= 100 ? 'border-green-500/40' : e.daysWithSale === 0 ? 'border-rose-500/40' : 'border-border/40'}`}>
                        <div className="flex items-center gap-3">
                          <div className={`h-10 w-10 rounded-full flex items-center justify-center text-sm font-black ${collaboratorAvatarClass(e.eg.employeeId)}`}>
                            {getInitialsShort(e.name)}
                          </div>
                          <div>
                            <p className="font-black text-sm leading-tight">{e.name}</p>
                            <p className="text-[9px] text-muted-foreground">
                              Fração {(fraction * 100).toFixed(0)}% · Meta R$ {fmt(e.eg.targetValue)} · R$ {fmt(e.empDailyAlvo)}/dia
                            </p>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <p className="text-muted-foreground text-[9px] uppercase font-bold">Vendido</p>
                            <p className="font-black text-base">R$ {fmt(e.eg.currentValue)}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground text-[9px] uppercase font-bold">% meta</p>
                            <p className={`font-black text-base ${e.empPct >= 100 ? 'text-green-500' : e.empPct >= 70 ? 'text-amber-500' : 'text-rose-500'}`}>{e.empPct.toFixed(1)}%</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground text-[9px] uppercase font-bold">Dias ativos</p>
                            <p className="font-bold">{e.daysWithSale} / {monthDays.length}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground text-[9px] uppercase font-bold">Pace atual</p>
                            <p className={`font-bold ${statusOk ? 'text-green-600' : 'text-rose-500'}`}>R$ {fmt(e.empPace)}/dia</p>
                          </div>
                        </div>
                        <div>
                          <p className="text-[9px] text-muted-foreground uppercase font-bold mb-1">Progresso na meta individual</p>
                          <div className="h-1.5 bg-muted/40 rounded-full overflow-hidden">
                            <div className={`h-full transition-all ${e.empPct >= 100 ? 'bg-green-500' : e.empPct >= 70 ? 'bg-amber-400' : 'bg-rose-500'}`} style={{ width: `${Math.min(e.empPct, 100)}%` }} />
                          </div>
                        </div>
                        <div className={`text-[10px] font-bold px-2 py-1 rounded-md ${statusOk ? 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400' : e.daysWithSale === 0 ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/20 dark:text-rose-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400'}`}>
                          {e.daysWithSale === 0
                            ? '⚠ Nenhum dia com venda registrada'
                            : statusOk
                              ? '✓ Pace acima do necessário nos dias trabalhados'
                              : `Pace abaixo do necessário (R$ ${fmt(e.empPaceNeeded)}/dia)`}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

const GOAL_TYPE_STYLE: Record<string, { border: string; text: string; dot: string; label: string }> = {
  revenue:          { border: 'border-l-primary',    text: 'text-primary',        dot: 'bg-primary',        label: 'Faturamento'    },
  ticket:           { border: 'border-l-amber-500',  text: 'text-amber-600',      dot: 'bg-amber-500',      label: 'Ticket Médio'   },
  product_line:     { border: 'border-l-blue-500',   text: 'text-blue-600',       dot: 'bg-blue-500',       label: 'Linha Produto'  },
  product_specific: { border: 'border-l-violet-500', text: 'text-violet-600',     dot: 'bg-violet-500',     label: 'Produto'        },
};

function getTypeStyle(type?: string) {
  return GOAL_TYPE_STYLE[type ?? ''] ?? { border: 'border-l-border', text: 'text-muted-foreground', dot: 'bg-muted-foreground', label: type ?? 'Meta' };
}

const TYPE_ORDER: Record<string, number> = { revenue: 0, ticket: 1, product_line: 2, product_specific: 3 };

// ── Componente principal ──────────────────────────────────────────────────────

export function GoalsTrackingDashboard() {
  const { periods, employeeGoals, templates, loading, deletePeriod, deleteEmployeeGoal } = useGoals();
  const { user, permissions, users, firebaseUser } = useAuth();
  const { kiosks } = useKiosks();
  const { toast } = useToast();

  const isManager = (permissions.goals?.manage ?? false) || (permissions.settings?.manageUsers ?? false);
  const isAdmin = permissions.settings?.manageUsers ?? false;
  const userKioskIds = user?.assignedKioskIds ?? [];
  const availableKiosks = isAdmin ? kiosks : kiosks.filter(k => userKioskIds.includes(k.id));

  const getKioskName = (id: string) => kiosks.find(k => k.id === id)?.name ?? id;
  const getUserName = (id: string) => {
    const collaborator = users.find(u => u.id === id);
    if (!collaborator) return "Colaborador removido";

    const candidates = [
      collaborator.username,
      collaborator.email?.split('@')[0],
      collaborator.registrationIdBizneo,
      collaborator.registrationIdPdv,
    ];

    const preferred = candidates.find(candidate => candidate && !looksLikeOpaqueUserIdentifier(candidate));
    return preferred ?? "Colaborador";
  };

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

  // Detalhamento diário
  const [dailyModalOpen, setDailyModalOpen] = useState(false);
  const [dailyModalPeriod, setDailyModalPeriod] = useState<GoalPeriodDoc | null>(null);
  const [dailyEmpModalOpen, setDailyEmpModalOpen] = useState(false);
  const [dailyEmpModalData, setDailyEmpModalData] = useState<{eg: EmployeeGoal, period: GoalPeriodDoc, userName: string} | null>(null);

  // IA Analysis
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<z.infer<typeof GoalsAnalysisOutputSchema> | null>(null);
  const [aiParams, setAiParams] = useState<{ kioskName: string; period: string; goalType: string } | null>(null);

  // Situação Geral e PDF
  const [kioskSummaryOpen, setKioskSummaryOpen] = useState(false);
  const [summaryGroup, setSummaryGroup] = useState<any>(null);

  async function handleAnalyzeWithAi(period: GoalPeriodDoc) {
    const template = templates.find(t => t.id === period.templateId);
    const kioskName = getKioskName(period.kioskId);
    const monthLabel = format(period.startDate.toDate(), 'MMMM yyyy', { locale: ptBR });
    
    setAiParams({
      kioskName,
      period: monthLabel,
      goalType: template?.type || 'revenue'
    });
    setAiModalOpen(true);
    setIsAiLoading(true);
    setAiResult(null);

    try {
      const data = {
        kioskName,
        periodMonth: monthLabel,
        goalType: template?.type || 'revenue',
        targetValue: period.targetValue,
        upValue: period.upValue,
        currentValue: period.currentValue,
        startDate: period.startDate.toDate().toISOString(),
        endDate: period.endDate.toDate().toISOString(),
        today: new Date().toISOString(),
        dailyProgress: period.dailyProgress,
        employees: employeeGoals
          .filter(eg => eg.periodId === period.id)
          .map(eg => ({
            name: getUserName(eg.employeeId),
            targetValue: eg.targetValue,
            currentValue: eg.currentValue,
            fraction: eg.fraction,
            dailyProgress: eg.dailyProgress
          }))
      };

      const idToken = await firebaseUser?.getIdToken();
      const response = await fetch('/api/ai/analyze-goals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { 'Authorization': `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Erro na resposta da AI');
      }

      const result = await response.json();
      setAiResult(result);
    } catch (e: any) {
      toast({ title: 'Erro na análise IA', description: e.message, variant: 'destructive' });
      setAiModalOpen(false);
    } finally {
      setIsAiLoading(false);
    }
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

  if (loading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="flex flex-col gap-8 pb-10 max-w-5xl mx-auto">
      {/* Header Centralizado */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 px-1">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Metas de Faturamento</h1>
          <p className="text-muted-foreground text-sm">Acompanhamento em tempo real de performance e projeções.</p>
        </div>
        <div className="flex items-center gap-2">
          {isManager && (
            <Button size="sm" onClick={() => setNewMetaOpen(true)} className="bg-primary hover:bg-primary/90">
              <Plus className="mr-2 h-4 w-4" /> Nova Meta
            </Button>
          )}
        </div>
      </div>

      {!loading && periodGroups.length === 0 && (
         <Card className="p-20 text-center bg-card/50 border-dashed border-2">
           <div className="flex flex-col items-center gap-3">
             <Target className="h-12 w-12 text-muted-foreground opacity-20" />
             <p className="text-lg font-medium text-muted-foreground">Nenhuma meta ativa encontrada.</p>
           </div>
         </Card>
      )}

      {periodGroups.map((group) => {
        const kioskName = getKioskName(group.kioskId);
        const revenuePeriods = group.periods.filter(p => templates.find(t => t.id === p.templateId)?.type === 'revenue');
        const mainPeriod = revenuePeriods[0];
        const pctPrincipal = mainPeriod ? pct(mainPeriod.currentValue, mainPeriod.targetValue) : 0;
        const isOpen = isCardOpen(group.groupKey);

        return (
          <Collapsible
            key={group.groupKey}
            open={isOpen}
            onOpenChange={(v) => setOpenCards(prev => ({ ...prev, [group.groupKey]: v }))}
            className="space-y-4"
          >
            <Card className="border-slate-300/80 dark:border-border/40 overflow-hidden bg-slate-200/70 dark:bg-slate-900/40 shadow-md rounded-2xl transition-all">
              <CollapsibleTrigger asChild>
                <div className="flex items-center justify-between p-5 cursor-pointer hover:bg-accent/10 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="p-2.5 bg-primary/10 rounded-xl">
                      <Target className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <h2 className="text-lg font-bold tracking-tight">{kioskName}</h2>
                      <p className="text-[10px] text-muted-foreground uppercase font-black tracking-widest">{group.monthLabel}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-8">
                    <div className="text-right">
                       <span className={`text-lg font-black ${pctPrincipal >= 100 ? 'text-green-500' : 'text-amber-500'}`}>
                         {pctPrincipal.toFixed(1)}%
                       </span>
                       <p className="text-[9px] text-muted-foreground uppercase font-bold tracking-tighter">da meta faturamento</p>
                    </div>
                    <div className={`p-1.5 rounded-full bg-muted/50 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}>
                      <ChevronDown className="h-5 w-5 text-muted-foreground" />
                    </div>
                  </div>
                </div>
              </CollapsibleTrigger>
              
              <CollapsibleContent>
                <div className="p-6 pt-2 border-t border-border/40 space-y-10 animate-in fade-in slide-in-from-top-2 duration-300">
                  <div className="flex justify-between items-center bg-muted/20 -mx-6 px-6 py-3 border-b border-border/10 mb-6">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={(e) => { e.stopPropagation(); setSummaryGroup(group); setKioskSummaryOpen(true); }}
                      className="h-9 px-4 text-xs font-bold border-blue-500/30 text-blue-600 hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-900/20"
                    >
                      <BarChart2 className="mr-2 h-4 w-4" /> Situação Geral & PDF
                    </Button>

                    {isManager && mainPeriod && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-9 px-3 hover:bg-accent"><Menu className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                           <DropdownMenuItem onClick={() => { setEmployeeGoalPeriod(mainPeriod); setEmployeeGoalOpen(true); }}>
                             <Plus className="mr-2 h-4 w-4" /> Vincular Colaborador
                           </DropdownMenuItem>
                           <DropdownMenuSeparator />
                           <DropdownMenuItem onClick={() => { setEditPeriod(mainPeriod); setEditOpen(true); }}>
                             <Pencil className="mr-2 h-4 w-4" /> Editar Meta
                           </DropdownMenuItem>
                           <DropdownMenuItem onClick={() => { setClosingPeriod(mainPeriod); setCloseGoalOpen(true); }}>
                             <CheckCircle className="mr-2 h-4 w-4" /> Encerrar Meta
                           </DropdownMenuItem>
                           <DropdownMenuSeparator />
                           <DropdownMenuItem
                             className="text-destructive focus:text-destructive"
                             onClick={() => { setDeletingPeriod(mainPeriod); setDeleteOpen(true); }}
                           >
                             <Trash2 className="mr-2 h-4 w-4" /> Excluir Meta
                           </DropdownMenuItem>
                           <DropdownMenuSeparator />
                           {process.env.NODE_ENV === 'development' && group.periods.map(p => {
                             const template = templates.find(t => t.id === p.templateId);
                             return (
                               <DropdownMenuItem key={p.id} onClick={() => handleAnalyzeWithAi(p)} className="text-primary font-medium">
                                 <Sparkles className="mr-2 h-4 w-4" /> Analisar {getTypeStyle(template?.type).label} com IA
                               </DropdownMenuItem>
                             );
                           })}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>

                  {/* ── Resumo do Período ── */}
                  <div className="space-y-4">
                    <h3 className="text-xs font-black text-muted-foreground uppercase tracking-[0.2em] px-1 italic">Visão Geral</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                       {revenuePeriods.map(period => {
                         const stats = calcMonthlyStats(period);
                         const diff = pct(stats.projection, stats.up) - 100;
                         return (
                           <React.Fragment key={period.id}>
                             <StatItem 
                               title="Acumulado"
                               value={fmt(stats.value)}
                               subLabel={`Meta base: R$ ${fmt(stats.alvo)}`}
                               trend={`${pct(stats.value, stats.alvo).toFixed(1)}%`}
                               trendColor={stats.value >= stats.alvo ? 'text-green-500' : 'text-muted-foreground'}
                             />
                             <StatItem 
                               title="Pace Atual"
                               value={fmt(stats.currentPace)}
                               subLabel={`Necessário: R$ ${fmt(stats.neededDaily)}`}
                               trend={stats.currentPace >= stats.neededDaily ? `+${pct(stats.currentPace - stats.neededDaily, stats.neededDaily).toFixed(0)}%` : `-${pct(stats.neededDaily - stats.currentPace, stats.neededDaily).toFixed(0)}%`}
                               trendColor={stats.currentPace >= stats.neededDaily ? 'text-green-500' : 'text-rose-500'}
                             />
                             <StatItem 
                               title="Projeção"
                               value={fmt(stats.projection)}
                               subLabel={`Super meta: R$ ${fmt(stats.up)}`}
                               trend={diff >= 0 ? `+${diff.toFixed(0)}%` : `${diff.toFixed(0)}%`}
                               trendColor={diff >= 0 ? 'text-green-500' : 'text-rose-500'}
                             />
                           </React.Fragment>
                         );
                       })}
                    </div>
                  </div>

                  {/* ── Card de Meta do Mês ── */}
                  {revenuePeriods.map(period => {
                    const stats = calcMonthlyStats(period);
                    const { isCurrent, refDate, periodEnd } = getPeriodContext(period);
                    const weekly = calcWeeklyStats(period, refDate, periodEnd);
                    const weekPct = pct(weekly.value, weekly.alvo);

                    return (
                      <div key={period.id} className="space-y-8">
                        <Card className="p-7 border-slate-300/60 dark:border-border/40 bg-slate-100 dark:bg-slate-800/40 shadow-md rounded-2xl overflow-hidden relative">
                          <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full -mr-16 -mt-16 blur-3xl pointer-events-none" />
                          <MainGoalProgress value={stats.value} alvo={stats.alvo} up={stats.up} linearMarker={stats.linearMarker} />
                          
                          <div 
                            className="mt-12 pt-5 border-t border-border/20 flex flex-col md:flex-row justify-between items-center gap-4 cursor-pointer hover:bg-accent/5 transition-all p-3 rounded-xl group/week"
                            onClick={() => { setDailyModalPeriod(period); setDailyModalOpen(true); }}
                          >
                             <div className="flex items-center gap-4">
                               <div className="p-2.5 bg-amber-500/10 rounded-lg group-hover/week:scale-110 transition-transform">
                                 <CalendarIcon className="h-5 w-5 text-amber-500" />
                               </div>
                               <div>
                                 <p className="text-[10px] text-muted-foreground uppercase font-black tracking-widest">Performance da Semana</p>
                                 <span className="text-base font-bold">R$ {fmt(weekly.value)} <span className="text-muted-foreground font-normal text-xs">/ {fmt(weekly.alvo)}</span></span>
                               </div>
                             </div>
                             <div className="flex items-center gap-3">
                               <Badge className={`px-3 py-1 font-bold ${weekPct >= 100 ? 'bg-green-500 text-white' : 'bg-primary/80'}`}>
                                 {weekPct.toFixed(1)}% atingido
                               </Badge>
                               <ChevronRight className="h-4 w-4 text-muted-foreground group-hover/week:translate-x-1 transition-transform" />
                             </div>
                          </div>
                        </Card>

                        {/* ── Por Colaborador ── */}
                        <div className="space-y-5">
                          <div className="flex items-center justify-between">
                             <h3 className="text-xs font-black text-muted-foreground uppercase tracking-[0.2em] px-1 italic">Ranking & Consistência</h3>
                          </div>
                          <div className="space-y-3">
                               {employeeGoals
                                 .filter(eg => eg.periodId === period.id)
                                 .sort((a, b) => b.currentValue - a.currentValue)
                                 .map(eg => {
                                   const shift = eg.shiftId ? period.shifts?.find(s => s.id === eg.shiftId) : null;
                                   return (
                                     <CollaboratorCard 
                                       key={eg.id}
                                       eg={eg}
                                       userName={getUserName(eg.employeeId)}
                                       shiftLabel={shift?.label}
                                       refDate={refDate}
                                       periodEnd={periodEnd}
                                       onOpenDaily={() => {
                                         setDailyEmpModalData({ eg, period, userName: getUserName(eg.employeeId) });
                                         setDailyEmpModalOpen(true);
                                       }}
                                     />
                                   );
                                 })
                               }
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* ── Metas Adicionais ── */}
                  {group.periods.filter(p => templates.find(t => t.id === p.templateId)?.type !== 'revenue').length > 0 && (
                    <div className="space-y-5 pt-4">
                      <h3 className="text-xs font-black text-muted-foreground uppercase tracking-[0.2em] px-1 italic">Linhas de Apoio</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        {group.periods.filter(p => templates.find(t => t.id === p.templateId)?.type !== 'revenue').map(period => {
                          const template = templates.find(t => t.id === period.templateId);
                          const typeStyle = getTypeStyle(template?.type ?? 'revenue');
                          const { value, alvo } = calcMonthlyStats(period);
                          const pPct = pct(value, alvo);
                          return (
                            <Card key={period.id} className="p-5 border-slate-300/60 dark:border-border/40 bg-slate-100 dark:bg-slate-800/40 hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-colors shadow-sm rounded-2xl">
                              <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2">
                                  <div className={`h-2 w-2 rounded-full ${typeStyle.dot} animate-pulse`} />
                                  <span className={`text-[10px] font-black uppercase tracking-widest ${typeStyle.text}`}>
                                    {template?.productLineName || template?.productName || typeStyle.label}
                                  </span>
                                </div>
                                <Badge variant="outline" className="text-[10px] font-bold h-5">{pPct.toFixed(1)}%</Badge>
                              </div>
                              <div className="space-y-3">
                                <div className="flex justify-between items-end">
                                  <span className="text-lg font-bold tracking-tight">R$ {fmt(value)}</span>
                                  <span className="text-muted-foreground text-[10px] uppercase font-bold">Meta {fmt(alvo)}</span>
                                </div>
                                <div className="h-1.5 bg-muted/40 rounded-full overflow-hidden">
                                  <div className={`h-full transition-all duration-1000 ${getStatusColor(pPct).bar}`} style={{ width: `${Math.min(pPct, 100)}%` }} />
                                </div>
                              </div>
                            </Card>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        );
      })}

      <KioskSummaryModal 
        open={kioskSummaryOpen} 
        onOpenChange={setKioskSummaryOpen} 
        group={summaryGroup} 
        employeeGoals={employeeGoals}
        getUserName={getUserName}
        kioskName={summaryGroup ? getKioskName(summaryGroup.kioskId) : ''}
      />

      {/* ── Modais ── */}
      <GoalTemplateFormModal open={newMetaOpen} onOpenChange={setNewMetaOpen} />
      <EditGoalPeriodModal open={editOpen} onOpenChange={setEditOpen} period={editPeriod} />
      <CloseGoalModal open={closeGoalOpen} onOpenChange={setCloseGoalOpen} period={closingPeriod} />
      <AddEmployeeGoalModal 
        open={employeeGoalOpen} 
        onOpenChange={setEmployeeGoalOpen} 
        period={employeeGoalPeriod} 
      />
      <DailyAnalysisModal 
        open={dailyModalOpen} 
        onOpenChange={setDailyModalOpen} 
        period={dailyModalPeriod} 
        title="Detalhamento Diário"
      />
      <DailyAnalysisModal 
        open={dailyEmpModalOpen} 
        onOpenChange={setDailyEmpModalOpen} 
        period={dailyEmpModalData ? {
          ...dailyEmpModalData.period,
          targetValue: dailyEmpModalData.eg.targetValue,
          dailyProgress: dailyEmpModalData.eg.dailyProgress,
        } : null} 
        title="Detalhamento Diário"
        subjectName={dailyEmpModalData?.userName}
      />
      
      <GoalsAiAnalysisModal
        open={aiModalOpen}
        onOpenChange={setAiModalOpen}
        isLoading={isAiLoading}
        analysisResult={aiResult}
        analysisParams={aiParams}
      />

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

      {/* Removido Dialog de sincronização manual */}
    </div>
  );
}
