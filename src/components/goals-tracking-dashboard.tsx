"use client";

import React, { useState, useMemo, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { httpsCallable } from 'firebase/functions';
import { doc, getDoc, getDocFromCache } from 'firebase/firestore';
import { db, functions } from '@/lib/firebase';
import { useGoals } from '@/contexts/goals-context';
import { useSalesReports } from '@/contexts/sales-report-context';
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
import { type GoalPeriod, type GoalPeriodDoc, type EmployeeGoal, type SalesReport } from '@/types';
import { 
  Target, Plus, RefreshCw, ChevronDown, ChevronLeft, Menu, BarChart2, Sparkles, Pencil, CheckCircle, Trash2, Flag, Store
} from 'lucide-react';
import {
  format, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { GoalsAiAnalysisModal } from '@/components/goals-ai-analysis-modal';
import { GoalsAnalysisOutputSchema } from '@/ai/flows/goals-schemas';
import { getUserDisplayName, pickUserIdentitySnapshot, type UserIdentityLike } from '@/lib/user-display';
import { calculateTieredGoalBonus, formatCurrencyBRL } from '@/lib/goal-methods';
import { canAccessUnit } from '@/lib/unit-access';
import {
  type GoalDistributionSnapshot,
  getEmployeeDistributionDateKeys,
  getPeriodDistributionDateKeys,
  loadGoalDistributionSnapshot,
  resolveGoalDistributionMode,
} from '@/lib/goals-distribution';
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

function formatGoalPeriodLabel(period: GoalPeriodDoc, kind: GoalPeriod) {
  const start = period.startDate?.toDate?.() ?? new Date();
  const end = period.endDate?.toDate?.() ?? start;
  if (kind === 'daily') return format(start, 'dd/MM/yyyy', { locale: ptBR });
  if (kind === 'weekly') return `${format(start, 'dd/MM', { locale: ptBR })} a ${format(end, 'dd/MM/yyyy', { locale: ptBR })}`;
  return format(start, 'MMMM yyyy', { locale: ptBR });
}

function goalPeriodKindLabel(kind: GoalPeriod) {
  if (kind === 'daily') return 'Diária';
  if (kind === 'weekly') return 'Semanal';
  return 'Mensal';
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
      <div className="absolute top-0 bottom-0 w-px bg-amber-400/60" style={{ left: `${markerUp}%` }} title={`Meta UP: R$ ${fmt(up)}`} />
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

function calcMonthlyStats(period: GoalPeriodDoc, distributionSnapshot?: GoalDistributionSnapshot | null) {
  const up = period.upValue ?? period.targetValue * 1.2;
  // TOP só existe nas metas criadas com o 3º nível; sem fallback para as antigas
  const top = period.topValue && period.topValue > up ? period.topValue : null;
  const now = new Date();
  const start = period.startDate?.toDate?.() ?? now;
  const end = period.endDate?.toDate?.() ?? now;

  const activeDateKeys = getPeriodDistributionDateKeys(period, distributionSnapshot);
  const activeDateSet = new Set(activeDateKeys);
  const totalDays = Math.max(activeDateKeys.length, 1);
  const elapsedDays = eachDayOfInterval({
    start,
    end: now < end ? (now < start ? start : now) : end
  }).filter(day => activeDateSet.has(dateKey(day))).length;
  const remainingDays = Math.max(totalDays - elapsedDays, 0);

  const linearMarker = (elapsedDays / totalDays) * 100;
  const currentPace = elapsedDays > 0 ? period.currentValue / elapsedDays : 0;
  const projection = currentPace * totalDays;
  const neededDaily = remainingDays > 0 ? Math.max(period.targetValue - period.currentValue, 0) / remainingDays : 0;

  return {
    value: period.currentValue,
    alvo: period.targetValue,
    up,
    top,
    elapsedDays,
    totalDays,
    remainingDays,
    linearMarker,
    currentPace,
    projection,
    neededDaily
  };
}

function calcWeeklyStats(period: GoalPeriodDoc, refDate: Date, periodEnd: Date, distributionSnapshot?: GoalDistributionSnapshot | null) {
  const dp = period.dailyProgress ?? {};
  const weekStart = startOfWeek(refDate, { weekStartsOn: 1 });
  const weekEndRaw = endOfWeek(refDate, { weekStartsOn: 1 });
  const periodStart = period.startDate?.toDate?.() ?? refDate;
  const effectiveEnd = weekEndRaw > periodEnd ? periodEnd : weekEndRaw;
  const effectiveStart = weekStart < periodStart ? periodStart : weekStart;
  const weekDays = eachDayOfInterval({ start: effectiveStart, end: effectiveEnd });
  const value = weekDays.reduce((s, d) => s + (dp[dateKey(d)] ?? 0), 0);
  const activeDateSet = new Set(getPeriodDistributionDateKeys(period, distributionSnapshot));
  const activeWeekDays = weekDays.filter(day => activeDateSet.has(dateKey(day)));

  // Consideramos o alvo proporcional da meta mensal para a semana
  const stats = calcMonthlyStats(period, distributionSnapshot);
  const dailyAlvo = stats.alvo / stats.totalDays;
  const dailyUp = stats.up / stats.totalDays;
  const dailyTop = stats.top ? stats.top / stats.totalDays : null;

  const weekLabel = effectiveStart.getTime() === effectiveEnd.getTime()
    ? format(effectiveStart, 'dd/MM', { locale: ptBR })
    : `${format(effectiveStart, 'dd/MM', { locale: ptBR })} – ${format(effectiveEnd, 'dd/MM', { locale: ptBR })}`;
  
  return { 
    value, 
    alvo: dailyAlvo * activeWeekDays.length, 
    up: dailyUp * activeWeekDays.length, 
    top: dailyTop ? dailyTop * activeWeekDays.length : null,
    weekLabel 
  };
}

function calcEgMonthly(eg: EmployeeGoal, refDate: Date) {
  const up = eg.targetValue * 1.2;
  const p = pct(eg.currentValue, eg.targetValue);
  return { value: eg.currentValue, alvo: eg.targetValue, up, p };
}

function calcEgWeekly(eg: EmployeeGoal, period: GoalPeriodDoc, refDate: Date, periodEnd: Date, distributionSnapshot?: GoalDistributionSnapshot | null) {
  const dp = eg.dailyProgress ?? {};
  const weekStart = startOfWeek(refDate, { weekStartsOn: 1 });
  const weekEndRaw = endOfWeek(refDate, { weekStartsOn: 1 });
  const periodStart = period.startDate?.toDate?.() ?? refDate;
  const effectiveEnd = weekEndRaw > periodEnd ? periodEnd : weekEndRaw;
  const effectiveStart = weekStart < periodStart ? periodStart : weekStart;
  const weekDays = eachDayOfInterval({ start: effectiveStart, end: effectiveEnd });
  const value = weekDays.reduce((s, d) => s + (dp[dateKey(d)] ?? 0), 0);
  const activeDateSet = new Set(getStrictEmployeeDistributionDateKeys(eg, period, distributionSnapshot));
  const activeWeekDays = weekDays.filter(day => activeDateSet.has(dateKey(day)));
  
  // Alvo semanal proporcional
  const dailyAlvo = eg.targetValue / Math.max(activeDateSet.size, 1);
  const alvo = dailyAlvo * activeWeekDays.length;
  const p = pct(value, alvo);
  
  return { value, alvo, p };
}

function getGoalTierLabel(period: GoalPeriodDoc, tierId: 'target' | 'up' | 'top', fallback: string) {
  return period.goalMethodSnapshot?.tiers?.find(tier => tier.id === tierId)?.label ?? fallback;
}

function timestampToDate(value: unknown): Date | null {
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  return null;
}

function usesTeamGoalDashboard(period: GoalPeriodDoc) {
  const createdAt = timestampToDate(period.createdAt);
  return Boolean(period.goalMethodSnapshot || (period.topValue && period.topValue > 0) || (createdAt && createdAt >= new Date(2026, 6, 1)));
}

function getReportDateKey(report: SalesReport) {
  if (!report.day) return null;
  return `${report.year}-${String(report.month).padStart(2, '0')}-${String(report.day).padStart(2, '0')}`;
}

function extractHour(value?: string) {
  if (!value) return null;
  const match = value.match(/(?:T|^)(\d{1,2}):/);
  if (!match) return null;
  const hour = Number(match[1]);
  return Number.isFinite(hour) && hour >= 0 && hour <= 23 ? hour : null;
}

function reportTotalRevenue(report: SalesReport) {
  return (report.items ?? []).reduce((sum, item) => {
    const price = Number(item.unitPrice ?? 0);
    const quantity = Number(item.quantity ?? 0);
    return sum + (price > 0 && quantity > 0 ? price * quantity : 0);
  }, 0);
}

function reportHourlyRevenue(report: SalesReport) {
  const values = Array.from({ length: 24 }, () => 0);
  let hasDirectRevenue = false;
  let estimatedFromCoupons = false;

  const priceBySimulation = new Map<string, number>();
  for (const item of report.items ?? []) {
    if (item.simulationId && item.unitPrice != null && Number(item.unitPrice) > 0) {
      priceBySimulation.set(item.simulationId, Number(item.unitPrice));
    }
  }

  for (const [simulationId, hourly] of Object.entries(report.productHourlySales ?? {})) {
    const unitPrice = priceBySimulation.get(simulationId) ?? 0;
    if (!unitPrice) continue;

    for (const [hourRaw, quantityRaw] of Object.entries(hourly)) {
      const hour = Number(hourRaw);
      const quantity = Number(quantityRaw);
      if (!Number.isFinite(hour) || hour < 0 || hour > 23 || !quantity) continue;
      values[hour] += quantity * unitPrice;
      hasDirectRevenue = true;
    }
  }

  if (!hasDirectRevenue) {
    for (const item of report.items ?? []) {
      const hour = extractHour(item.timestamp);
      const unitPrice = Number(item.unitPrice ?? 0);
      const quantity = Number(item.quantity ?? 0);
      if (hour == null || !unitPrice || !quantity) continue;
      values[hour] += quantity * unitPrice;
      hasDirectRevenue = true;
    }
  }

  if (!hasDirectRevenue && report.hourlySales) {
    const totalRevenue = reportTotalRevenue(report);
    const totalCoupons = Object.values(report.hourlySales).reduce((sum, value) => sum + Number(value ?? 0), 0);

    if (totalRevenue > 0 && totalCoupons > 0) {
      for (const [hourRaw, couponsRaw] of Object.entries(report.hourlySales)) {
        const hour = Number(hourRaw);
        const coupons = Number(couponsRaw);
        if (!Number.isFinite(hour) || hour < 0 || hour > 23 || !coupons) continue;
        values[hour] += totalRevenue * (coupons / totalCoupons);
      }
      estimatedFromCoupons = true;
    }
  }

  return { values, estimatedFromCoupons };
}

const SALES_PERIOD_BUCKETS = [
  { label: 'Madrugada', range: '00h-05h', start: 0, end: 5 },
  { label: 'Manhã', range: '06h-11h', start: 6, end: 11 },
  { label: 'Tarde', range: '12h-17h', start: 12, end: 17 },
  { label: 'Noite', range: '18h-23h', start: 18, end: 23 },
];

function buildHourlyRevenueSummary(period: GoalPeriodDoc, reports: SalesReport[]) {
  const periodStartKey = dateKey(period.startDate?.toDate?.() ?? new Date());
  const periodEndKey = dateKey(period.endDate?.toDate?.() ?? new Date());
  const values = Array.from({ length: 24 }, () => 0);
  let estimated = false;

  const periodReports = reports.filter(report => {
    const key = getReportDateKey(report);
    return report.kioskId === period.kioskId && key != null && key >= periodStartKey && key <= periodEndKey;
  });

  for (const report of periodReports) {
    const hourly = reportHourlyRevenue(report);
    hourly.values.forEach((value, hour) => {
      values[hour] += value;
    });
    estimated = estimated || hourly.estimatedFromCoupons;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  const byHour = values.map((value, hour) => ({
    hour,
    label: `${String(hour).padStart(2, '0')}h`,
    value,
    percent: total > 0 ? (value / total) * 100 : 0,
  }));

  const buckets = SALES_PERIOD_BUCKETS.map(bucket => {
    const value = values
      .slice(bucket.start, bucket.end + 1)
      .reduce((sum, item) => sum + item, 0);

    return {
      ...bucket,
      value,
      percent: total > 0 ? (value / total) * 100 : 0,
    };
  });

  const peak = byHour.reduce((best, current) => current.value > best.value ? current : best, byHour[0]);
  const nonZeroHours = byHour.filter(item => item.value > 0);
  const firstHour = nonZeroHours[0]?.hour ?? 8;
  const lastHour = nonZeroHours[nonZeroHours.length - 1]?.hour ?? 22;
  const chartHours = byHour.filter(item => item.hour >= firstHour && item.hour <= lastHour);

  return {
    total,
    estimated,
    byHour,
    buckets,
    peak,
    chartHours,
    reportCount: periodReports.length,
  };
}

// ── Linha de indicador ────────────────────────────────────────────────────────

function getActiveTierTone(value: number, target: number, up?: number | null, top?: number | null) {
  if (value < target) return 'target';
  if (up && value < up) return 'up';
  if (top && value < top) return 'top';
  return top ? 'top' : up ? 'up' : 'target';
}

function tierToneClasses(tone: 'target' | 'up' | 'top', active = false) {
  if (tone === 'target') {
    return active
      ? 'border-pink-200 bg-pink-50 text-pink-600 ring-2 ring-pink-100'
      : 'border-pink-100 bg-pink-50 text-pink-600';
  }
  if (tone === 'up') {
    return active
      ? 'border-blue-200 bg-blue-50 text-blue-600 ring-2 ring-blue-100'
      : 'border-blue-100 bg-blue-50 text-blue-600';
  }
  return active
    ? 'border-violet-200 bg-violet-50 text-violet-600 ring-2 ring-violet-100'
    : 'border-violet-100 bg-violet-50 text-violet-600';
}

// Estilo por ESTADO da meta (não só identidade do tier): batida = verde/✓,
// em andamento = cor do tier, futura = neutro. A barra usa a mesma paleta.
const TIER_PALETTE = {
  target: { dot: 'bg-pink-400', text: 'text-pink-600', fill: 'bg-pink-500', track: 'bg-pink-100' },
  up: { dot: 'bg-blue-400', text: 'text-blue-600', fill: 'bg-blue-500', track: 'bg-blue-100' },
  top: { dot: 'bg-violet-400', text: 'text-violet-600', fill: 'bg-violet-500', track: 'bg-violet-100' },
} as const;
const TIER_REACHED = { dot: 'bg-emerald-500', text: 'text-emerald-600', fill: 'bg-emerald-500', track: 'bg-emerald-100' };
const TIER_FUTURE = { dot: 'bg-zinc-300', text: 'text-zinc-400', fill: 'bg-zinc-300', track: 'bg-zinc-100' };

function tierStateStyle(tone: 'target' | 'up' | 'top', state: 'reached' | 'active' | 'future') {
  if (state === 'reached') return TIER_REACHED;
  if (state === 'future') return TIER_FUTURE;
  return TIER_PALETTE[tone];
}

function GoalTierProgressPills({
  value,
  target,
  up,
  top,
  compact = false,
}: {
  value: number;
  target: number;
  up?: number | null;
  top?: number | null;
  compact?: boolean;
}) {
  const activeTone = getActiveTierTone(value, target, up, top);
  const tiers = [
    { tone: 'target' as const, label: 'Alvo', amount: target },
    ...(up && up > target ? [{ tone: 'up' as const, label: 'UP', amount: up }] : []),
    ...(top && up && top > up ? [{ tone: 'top' as const, label: 'TOP', amount: top }] : []),
  ];

  return (
    <div className={`flex flex-wrap ${compact ? 'justify-center gap-1' : 'gap-1.5'}`}>
      {tiers.map(tier => {
        const reached = value >= tier.amount;
        const active = activeTone === tier.tone && !reached;

        return (
          <span
            key={tier.tone}
            className={`inline-flex items-center gap-1 rounded-full border font-black tabular-nums ${
              reached ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : tierToneClasses(tier.tone, active)
            } ${compact ? 'px-1.5 py-0.5 text-[8px]' : 'px-2 py-1 text-[10px]'}`}
          >
            {reached && <CheckCircle className={compact ? 'h-2 w-2' : 'h-2.5 w-2.5'} />}
            {tier.label} R$ {fmt(tier.amount)}
            <span className={compact ? 'text-[7px]' : 'text-[9px]'}>
              {pct(value, tier.amount).toFixed(0)}%
            </span>
          </span>
        );
      })}
    </div>
  );
}

function GoalTierProgressRows({
  value,
  target,
  up,
  top,
  compact = false,
}: {
  value: number;
  target: number;
  up?: number | null;
  top?: number | null;
  compact?: boolean;
}) {
  const activeTone = getActiveTierTone(value, target, up, top);
  const tiers = [
    { tone: 'target' as const, label: 'Alvo', amount: target },
    ...(up && up > target ? [{ tone: 'up' as const, label: 'UP', amount: up }] : []),
    ...(top && up && top > up ? [{ tone: 'top' as const, label: 'TOP', amount: top }] : []),
  ];

  return (
    <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
      {tiers.map(tier => {
        const reached = value >= tier.amount;
        const percent = pct(value, tier.amount);
        const state: 'reached' | 'active' | 'future' =
          reached ? 'reached' : activeTone === tier.tone ? 'active' : 'future';
        const style = tierStateStyle(tier.tone, state);
        const numSize = compact ? 'text-[9px]' : 'text-[11px]';

        return (
          <div key={tier.tone} className="space-y-1">
            <div className={`flex items-center justify-between gap-2 tabular-nums ${numSize}`}>
              <span className="flex min-w-0 items-center gap-1.5">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} />
                <span className={`font-black ${style.text}`}>{tier.label}</span>
                <span className="truncate font-semibold text-zinc-400">R$ {fmt(tier.amount)}</span>
              </span>
              <span className={`flex shrink-0 items-center gap-0.5 font-black ${style.text}`}>
                {reached && <CheckCircle className={compact ? 'h-2.5 w-2.5' : 'h-3 w-3'} />}
                {percent.toFixed(0)}%
              </span>
            </div>
            <div className={`h-1 w-full overflow-hidden rounded-full ${style.track}`}>
              <div
                className={`h-full rounded-full transition-[width] duration-500 ${style.fill}`}
                style={{ width: `${Math.min(percent, 100)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function activeTierBadgeClass(value: number, target: number, up?: number | null, top?: number | null) {
  const tone = getActiveTierTone(value, target, up, top);
  return tierBadgeClassByTone(tone);
}

function tierBadgeClassByTone(tone: 'target' | 'up' | 'top') {
  if (tone === 'target') return 'bg-pink-500 text-white';
  if (tone === 'up') return 'bg-blue-500 text-white';
  return 'bg-violet-500 text-white';
}

function tierLabelByTone(tone: 'target' | 'up' | 'top') {
  if (tone === 'target') return 'Meta Alvo';
  if (tone === 'up') return 'Meta UP';
  return 'Meta TOP';
}

function tierAmountByTone(tone: 'target' | 'up' | 'top', target: number, up?: number | null, top?: number | null) {
  if (tone === 'target') return target;
  if (tone === 'up') return up && up > target ? up : target;
  return top && up && top > up ? top : up && up > target ? up : target;
}

// Uma barra por meta mostrando "agora" (preenchido, cor do estado) e "projeção"
// (fantasma + marcador). Alvos aparecem uma vez; conta a história agora → onde vai chegar.
function GoalTierDualProgress({ current, projection, target, up, top }: {
  current: number; projection: number; target: number; up?: number | null; top?: number | null;
}) {
  const currentTone = getActiveTierTone(current, target, up, top);
  const tiers = [
    { tone: 'target' as const, label: 'Alvo', amount: target },
    ...(up && up > target ? [{ tone: 'up' as const, label: 'UP', amount: up }] : []),
    ...(top && up && top > up ? [{ tone: 'top' as const, label: 'TOP', amount: top }] : []),
  ];

  return (
    <div className="space-y-2.5">
      {tiers.map(tier => {
        const currentReached = current >= tier.amount;
        const projReached = projection >= tier.amount;
        const currentPct = pct(current, tier.amount);
        const projPct = pct(projection, tier.amount);
        const state: 'reached' | 'active' | 'future' =
          currentReached ? 'reached' : currentTone === tier.tone ? 'active' : 'future';
        const style = tierStateStyle(tier.tone, state);
        const currentW = Math.min(currentPct, 100);
        const projW = Math.min(projPct, 100);

        return (
          <div key={tier.tone} className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-[11px] tabular-nums">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} />
                <span className={`font-black ${style.text}`}>{tier.label}</span>
                <span className="truncate font-semibold text-zinc-400">R$ {fmt(tier.amount)}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2 font-black">
                <span className={style.text}>{currentPct.toFixed(0)}%</span>
                <span className={`flex items-center gap-0.5 ${projReached ? 'text-emerald-600' : 'text-zinc-400'}`}>
                  {projReached && <CheckCircle className="h-2.5 w-2.5" />}
                  {projPct.toFixed(0)}%
                </span>
              </span>
            </div>
            <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
              <div
                className={`absolute inset-y-0 left-0 rounded-full ${projReached ? 'bg-emerald-200' : 'bg-zinc-200'}`}
                style={{ width: `${projW}%` }}
              />
              <div
                className={`absolute inset-y-0 left-0 rounded-full ${style.fill}`}
                style={{ width: `${currentW}%` }}
              />
              {projW > currentW && (
                <div
                  className={`absolute inset-y-0 w-0.5 ${projReached ? 'bg-emerald-500' : 'bg-zinc-400'}`}
                  style={{ left: `calc(${projW}% - 1px)` }}
                />
              )}
            </div>
          </div>
        );
      })}
      <div className="flex items-center gap-3 pt-0.5 text-[9px] font-bold uppercase tracking-wider text-zinc-400">
        <span className="flex items-center gap-1"><span className={`h-1.5 w-3 rounded-full ${TIER_PALETTE[currentTone].fill}`} /> agora</span>
        <span className="flex items-center gap-1"><span className="h-1.5 w-3 rounded-full bg-emerald-300" /> projeção</span>
      </div>
    </div>
  );
}

function StatItem({ title, value, valueSuffix, subLabel, trend, trendColor, trendLabel }: {
  title: string; value: string; valueSuffix?: string; subLabel: React.ReactNode; trend?: string; trendColor?: string; trendLabel?: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</span>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold tabular-nums">R$ {value}</span>
        {valueSuffix && <span className="text-sm font-semibold text-muted-foreground">{valueSuffix}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
        <div className="min-w-0 text-xs text-muted-foreground">{subLabel}</div>
        {trend && (
          <span className={`shrink-0 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-black ${trendColor || 'text-green-500'}`}>
            {trend}
            {trendLabel && <span className="font-semibold opacity-75">{trendLabel}</span>}
          </span>
        )}
      </div>
    </div>
  );
}

function MainGoalProgress({ value, alvo, up, top, linearMarker }: {
  value: number; alvo: number; up: number; top?: number | null; linearMarker: number
}) {
  const p = pct(value, alvo);
  const { bar: color } = getStatusColor(p);
  const markerAlvo = 100; // Representa a barra inteira em relação à meta base
  const markerUp = (up / alvo) * 100;
  const filled = (value / alvo) * 100;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-semibold">Meta do período</span>
        <span className="text-xl font-bold text-amber-500">{p.toFixed(1)}%</span>
      </div>
      
      <div className="relative h-[8px] bg-slate-300 dark:bg-slate-700 rounded-[4px] overflow-visible mb-6">
        {/* Barra preenchida */}
        <div className={`absolute left-0 top-0 h-full rounded-[4px] transition-all duration-700 ${color}`}
             style={{ width: `${Math.min(filled, 100)}%` }} />

        {/* Marcador linear (onde deveria estar hoje) */}
        <div className="absolute top-[-4px] bottom-[-4px] w-[2px] bg-muted-foreground/60 z-10"
             style={{ left: `${Math.min(linearMarker, 100)}%` }} />

        {/* Rótulo do marcador: centralizado no meio da barra, ancorado nas bordas nos extremos */}
        <span
          className="absolute -bottom-5 text-[10px] text-muted-foreground font-medium whitespace-nowrap"
          style={
            linearMarker >= 85 ? { right: 0 }
            : linearMarker <= 8 ? { left: 0 }
            : { left: `${linearMarker}%`, transform: 'translateX(-50%)' }
          }
        >
          hoje ({Math.min(linearMarker, 100).toFixed(1)}%)
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
             <span className="font-bold text-blue-500">Meta UP R$ {fmt(up)}</span>
          </div>
        </div>
      )}

      {/* Barra de Meta TOP (só metas com 3º nível) */}
      {top && top > up && (
        <div className="pt-2 space-y-1.5">
          <div className="relative h-[8px] bg-slate-300 dark:bg-slate-700 rounded-[4px] overflow-visible">
            <div className="absolute left-0 top-0 h-full rounded-[4px] bg-violet-500/70"
                 style={{ width: `${Math.min((value / top) * 100, 100)}%` }} />
          </div>
          <div className="flex justify-between items-center text-[10px] text-muted-foreground">
             <span className="font-bold text-foreground">Realizado R$ {fmt(value)}</span>
             <span className="font-bold text-violet-500">Meta TOP R$ {fmt(top)}</span>
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

function getMergedEmployeeActiveDateKeys(
  employeeGoal: EmployeeGoal,
  period: GoalPeriodDoc,
  distributionSnapshot?: GoalDistributionSnapshot | null,
  originalEgs?: EmployeeGoal[] | null
) {
  if (!originalEgs || originalEgs.length <= 1) {
    return getStrictEmployeeDistributionDateKeys(employeeGoal, period, distributionSnapshot);
  }

  const mergedKeys = new Set<string>();
  for (const goal of originalEgs) {
    for (const key of getStrictEmployeeDistributionDateKeys(goal, period, distributionSnapshot)) {
      mergedKeys.add(key);
    }
  }

  return Array.from(mergedKeys).sort();
}

function getStrictEmployeeDistributionDateKeys(
  employeeGoal: EmployeeGoal,
  period: GoalPeriodDoc,
  distributionSnapshot?: GoalDistributionSnapshot | null
) {
  const isScheduled =
    resolveGoalDistributionMode(employeeGoal) === 'scheduled_days' ||
    resolveGoalDistributionMode(period) === 'scheduled_days';

  if (!isScheduled) {
    return getEmployeeDistributionDateKeys(employeeGoal, period, distributionSnapshot);
  }

  if (!distributionSnapshot) {
    return getEmployeeDistributionDateKeys(employeeGoal, period, distributionSnapshot);
  }

  return distributionSnapshot?.employeeDateKeysByGoalId?.[employeeGoal.id] ?? [];
}

function getEmployeeDailyTargetMap(
  employeeGoal: EmployeeGoal,
  period: GoalPeriodDoc,
  distributionSnapshot?: GoalDistributionSnapshot | null,
  originalEgs?: EmployeeGoal[] | null
) {
  const dailyTargets: Record<string, number> = {};
  const sourceGoals = originalEgs && originalEgs.length > 0 ? originalEgs : [employeeGoal];

  for (const goal of sourceGoals) {
    const keys = getStrictEmployeeDistributionDateKeys(goal, period, distributionSnapshot);
    const targetPerDay = goal.targetValue / Math.max(keys.length, 1);
    for (const key of keys) {
      dailyTargets[key] = (dailyTargets[key] ?? 0) + targetPerDay;
    }
  }

  return dailyTargets;
}

function DailyStatusPill({ tone }: { tone: 'ok' | 'zero' | 'miss' | 'na' }) {
  const config = {
    ok:   { label: '✓', cls: 'border-emerald-400 bg-emerald-500 text-white shadow-[0_6px_16px_-10px_rgba(34,197,94,0.8)]' },
    miss: { label: '✗', cls: 'border-amber-300 bg-amber-100 text-amber-700' },
    zero: { label: '⚠', cls: 'border-zinc-300 bg-zinc-50 text-zinc-500' },
    na:   { label: '—', cls: 'border-slate-200 bg-slate-100 text-slate-400' },
  }[tone];

  return (
    <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full border text-[13px] font-bold ${config.cls}`}>
      {config.label}
    </span>
  );
}

function DailyReferenceStatus({ tone }: { tone: 'ok' | 'zero' | 'miss' | 'future' }) {
  const config = {
    ok: { label: '✓', cls: 'border-emerald-500 bg-emerald-500 text-white shadow-[0_7px_18px_-12px_rgba(16,185,129,0.9)]' },
    miss: { label: '×', cls: 'border-amber-300 bg-amber-50 text-amber-500' },
    zero: { label: '△', cls: 'border-zinc-200 bg-white text-zinc-400' },
    future: { label: '−', cls: 'border-slate-200 bg-slate-50 text-slate-300' },
  }[tone];

  return (
    <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full border text-[13px] font-black leading-none ${config.cls}`}>
      {config.label}
    </span>
  );
}

function DailyBalanceBar({ balance, maxAbs, tone }: { balance: number; maxAbs: number; tone: 'ok' | 'zero' | 'miss' | 'future' }) {
  const width = Math.max(Math.min((Math.abs(balance) / Math.max(maxAbs, 1)) * 49, 49), Math.abs(balance) > 0 ? 1.5 : 0);
  const color = tone === 'ok' ? 'bg-emerald-500' : tone === 'zero' ? 'bg-rose-300' : tone === 'miss' ? 'bg-amber-400' : 'bg-slate-200';

  return (
    <div className="relative h-2 w-full rounded-full bg-zinc-100">
      <span className="absolute left-1/2 top-1/2 h-3 w-px -translate-x-1/2 -translate-y-1/2 bg-zinc-200" />
      {balance >= 0 ? (
        <span className={`absolute left-1/2 top-0 h-2 rounded-r-full ${color}`} style={{ width: `${width}%` }} />
      ) : (
        <span className={`absolute right-1/2 top-0 h-2 rounded-l-full ${color}`} style={{ width: `${width}%` }} />
      )}
    </div>
  );
}

type GoalDetailScope = 'monthly' | 'weekly' | 'daily';
type MonthlyComparisonRow = {
  label: string;
  value: number;
  target: number;
  up?: number | null;
  top?: number | null;
  current?: boolean;
};
type BonusRoleKey = 'fixed' | 'relief' | 'leader';
type BonusParticipantRow = {
  id: string;
  name: string;
  jobLabel: string;
  currentValue: number;
  share: number;
  roleKey: BonusRoleKey;
  roleLabel: string;
  coveredTurns: number;
  prize: number;
};

function getDetailScopeLabel(scope: GoalDetailScope) {
  if (scope === 'daily') return 'Detalhamento diário';
  if (scope === 'weekly') return 'Detalhamento semanal';
  return 'Detalhamento mensal';
}

// ── Dialog de análise diária (Mensal/Semanal/Diária) ─────────────────────────

function DailyAnalysisModal({ open, onOpenChange, period, title, subjectName, activeDateKeys, scope = 'monthly', monthlyComparisonRows }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  period: GoalPeriodDoc | null; title: string; subjectName?: string | null;
  activeDateKeys?: string[] | null;
  scope?: GoalDetailScope;
  monthlyComparisonRows?: MonthlyComparisonRow[] | null;
}) {
  if (!period) return null;
  const now = new Date();
  const start = period.startDate?.toDate?.() ?? now;
  const end = period.endDate?.toDate?.() ?? now;
  const allPeriodDays = eachDayOfInterval({ start, end });
  const dp = period.dailyProgress ?? {};
  const allActiveDateSet = new Set(activeDateKeys ?? allPeriodDays.map(dateKey));
  const activePeriodDayCount = Math.max(allActiveDateSet.size, 1);
  const { refDate } = getPeriodContext(period);
  const scopeStart = start;
  const scopeEnd = end;
  const days = eachDayOfInterval({ start: scopeStart, end: scopeEnd });
  const activeDateSet = new Set(days.map(dateKey).filter(key => allActiveDateSet.has(key)));
  const activeScopeDayCount = Math.max(activeDateSet.size, 1);
  const monthlyActiveTone = getActiveTierTone(period.currentValue, period.targetValue, period.upValue, period.topValue);
  const activeTierLabel = tierLabelByTone(monthlyActiveTone);
  const activePeriodTarget = scope === 'monthly'
    ? period.targetValue
    : tierAmountByTone(monthlyActiveTone, period.targetValue, period.upValue, period.topValue);
  const totalTarget = (activePeriodTarget / activePeriodDayCount) * activeScopeDayCount;
  const dailyTarget = totalTarget / activeScopeDayCount;
  const totalRealized = days.reduce((sum, day) => sum + (dp[dateKey(day)] ?? 0), 0);

  const rows = days.map((day) => {
    const key = dateKey(day);
    const isToday = isSameDay(day, now);
    const isPast = day <= now;
    const isActive = activeDateSet.has(key);
    const value = dp[key] ?? 0;
    const currentNeed = isActive ? dailyTarget : 0;

    const hit = isActive ? value >= currentNeed : value > 0;
    const balance = isActive ? value - currentNeed : value;
    const statusTone: 'ok' | 'zero' | 'miss' | 'future' = !isPast || !isActive
      ? 'future'
      : value >= currentNeed && value > 0
        ? 'ok'
        : value > 0
          ? 'miss'
          : 'zero';

    return { day, key, currentNeed, value, hit, isPast, isToday, isActive, balance, statusTone };
  });

  const activeRows = rows.filter(r => r.isActive);
  const elapsedRows = activeRows.filter(r => r.isPast);
  const hitCount = elapsedRows.filter(r => r.hit && r.value > 0).length;
  const bestRow = elapsedRows.length ? elapsedRows.reduce((best, row) => row.balance > best.balance ? row : best, elapsedRows[0]) : null;
  const worstRow = elapsedRows.length ? elapsedRows.reduce((worst, row) => row.balance < worst.balance ? row : worst, elapsedRows[0]) : null;
  const maxBalanceAbs = Math.max(...rows.map(r => Math.abs(r.balance)), 1);
  const periodLabel = `${format(scopeStart, 'dd/MM/yyyy', { locale: ptBR })} - ${format(scopeEnd, 'dd/MM/yyyy', { locale: ptBR })}`.toUpperCase();
  const targetPct = pct(totalRealized, totalTarget);
  const titleLabel = getDetailScopeLabel(scope);
  const targetCardLabel = scope === 'daily'
    ? `${activeTierLabel} dos dias`
    : scope === 'weekly'
      ? `${activeTierLabel} das semanas`
      : 'Meta do mês';
  const comparisonRows = scope === 'monthly' && monthlyComparisonRows?.length
    ? monthlyComparisonRows
    : [{
        label: format(start, 'MMM/yy', { locale: ptBR }),
        value: period.currentValue,
        target: period.targetValue,
        up: period.upValue,
        top: period.topValue,
        current: true,
      }];
  const rowGroups = rows.reduce<Array<{ key: string; label: string; rows: typeof rows }>>((groups, row) => {
    const rawStart = startOfWeek(row.day, { weekStartsOn: 1 });
    const rawEnd = endOfWeek(row.day, { weekStartsOn: 1 });
    const groupStart = rawStart < scopeStart ? scopeStart : rawStart;
    const groupEnd = rawEnd > scopeEnd ? scopeEnd : rawEnd;
    const key = dateKey(groupStart);
    let group = groups.find(item => item.key === key);

    if (!group) {
      const rangeLabel = groupStart.getTime() === groupEnd.getTime()
        ? format(groupStart, 'dd/MM', { locale: ptBR })
        : `${format(groupStart, 'dd/MM', { locale: ptBR })} a ${format(groupEnd, 'dd/MM', { locale: ptBR })}`;
      group = {
        key,
        label: `Semana ${groups.length + 1} · ${rangeLabel}`,
        rows: [],
      };
      groups.push(group);
    }

    group.rows.push(row);
    return groups;
  }, []);
  const weekSummaryRows = rowGroups.map(group => {
    const value = group.rows.reduce((sum, row) => sum + row.value, 0);
    const target = group.rows.reduce((sum, row) => sum + row.currentNeed, 0);
    const balance = value - target;
    const hasFutureOnly = group.rows.every(row => !row.isPast);
    const statusTone: 'ok' | 'zero' | 'miss' | 'future' = hasFutureOnly
      ? 'future'
      : value >= target && value > 0
        ? 'ok'
        : value > 0
          ? 'miss'
          : 'zero';

    return {
      key: group.key,
      label: group.label,
      value,
      target,
      balance,
      statusTone,
    };
  });
  const maxWeeklyBalanceAbs = Math.max(...weekSummaryRows.map(row => Math.abs(row.balance)), 1);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-[1200px] grid h-[min(92vh,1180px)] w-[min(94vw,1200px)] grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-[30px] border border-zinc-200 bg-white p-0 shadow-[0_36px_90px_-48px_rgba(15,23,42,0.52)]">
        <div className="px-5 pb-6 pt-8 sm:px-12 sm:pb-7 sm:pt-10">
          <div className="flex items-start gap-4 pr-4 sm:pr-12">
            <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-pink-500 text-white shadow-[0_10px_24px_-14px_rgba(236,72,153,0.8)]">
              <Flag className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-black uppercase tracking-[0.18em] text-zinc-400">{periodLabel}</p>
              <DialogTitle className="mt-3 text-[2.15rem] font-black leading-none tracking-[-0.06em] text-zinc-900 md:text-[2.45rem]">
                {titleLabel}
              </DialogTitle>
              {subjectName ? (
                <DialogDescription className="mt-3 text-sm font-bold text-zinc-500">
                  {subjectName}
                </DialogDescription>
              ) : (
                <DialogDescription className="sr-only">Detalhamento de metas diárias para o período</DialogDescription>
              )}
            </div>
          </div>
        </div>

        {scope === 'monthly' ? (
          <div className="mx-4 grid items-stretch gap-4 rounded-[20px] border border-zinc-200 px-5 py-5 sm:mx-12 lg:grid-cols-[minmax(220px,0.72fr)_minmax(0,1.28fr)]">
            <div className="rounded-[16px] bg-pink-50 px-5 py-4">
              <p className="text-[12px] font-black uppercase tracking-[0.12em] text-pink-500">Faturado no mês</p>
              <p className="mt-3 whitespace-nowrap text-[clamp(1.6rem,2.5vw,2.2rem)] font-black leading-none tracking-[-0.03em] text-pink-500">R$ {fmt(totalRealized)}</p>
              <p className="mt-3 text-sm font-semibold text-pink-700/70">{targetPct.toFixed(1)}% da Meta Alvo</p>
            </div>
            <div className="rounded-[16px] bg-zinc-50 px-5 py-4">
              <p className="text-[12px] font-black uppercase tracking-[0.12em] text-zinc-400">Metas do mês</p>
              <div className="mt-3 max-w-[640px]">
                <GoalTierProgressRows
                  value={totalRealized}
                  target={period.targetValue}
                  up={period.upValue}
                  top={period.topValue}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="mx-4 grid grid-cols-2 items-start gap-5 rounded-[20px] border border-zinc-200 px-5 py-6 sm:mx-12 sm:grid-cols-4 sm:gap-10 sm:px-9 sm:py-7">
            <div className="min-w-0">
              <p className="text-[12px] font-black uppercase tracking-[0.12em] text-zinc-400">Realizado</p>
              <p className="mt-3 whitespace-nowrap text-[clamp(1.25rem,2vw,1.8rem)] font-black leading-none tracking-[-0.02em] text-pink-500">R$ {fmt(totalRealized)}</p>
              <p className="mt-3 text-sm font-semibold text-zinc-400">{targetPct.toFixed(0)}% da meta</p>
            </div>
            <div className="min-w-0">
              <p className="text-[12px] font-black uppercase tracking-[0.12em] text-zinc-400">{targetCardLabel}</p>
              <p className="mt-3 whitespace-nowrap text-[clamp(1.25rem,2vw,1.8rem)] font-black leading-none tracking-[-0.02em] text-zinc-900">R$ {fmt(totalTarget)}</p>
              <p className="mt-3 text-sm font-semibold text-zinc-400">{activeRows.length} de {days.length} dias</p>
            </div>
            <div>
              <p className="text-[12px] font-black uppercase tracking-[0.12em] text-zinc-400">Dias batidos</p>
              <p className="mt-3 text-[clamp(1.35rem,2.1vw,1.95rem)] font-black leading-none tracking-[0.02em] text-emerald-600">
                {hitCount}/{Math.max(elapsedRows.length, 0)}
              </p>
              <p className="mt-3 text-sm font-semibold text-zinc-400">
                {elapsedRows.length > 0 ? `${((hitCount / elapsedRows.length) * 100).toFixed(0)}% de acerto` : 'Sem dias apurados'}
              </p>
            </div>
            <div>
              <p className="text-[12px] font-black uppercase tracking-[0.12em] text-zinc-400">Melhor · Pior</p>
              <p className="mt-3 text-[clamp(1.35rem,2.1vw,1.95rem)] font-black leading-none tracking-[0.02em] text-zinc-900">
                {bestRow ? format(bestRow.day, 'dd/MM', { locale: ptBR }) : '--/--'}
              </p>
              <p className="mt-3 text-sm font-semibold text-zinc-400">
                {worstRow ? format(worstRow.day, 'dd/MM', { locale: ptBR }) : '--/--'} foi o pior
              </p>
            </div>
          </div>
        )}

        <div className="min-h-0 overflow-x-auto px-4 py-5 sm:px-11">
          {scope === 'monthly' ? (
            <div className="flex h-full min-h-0 flex-col overflow-hidden">
              <div className="grid min-w-[780px] shrink-0 grid-cols-[0.8fr_1fr_2.4fr] gap-6 border-b border-zinc-200 px-4 py-4 text-[12px] font-black uppercase tracking-[0.12em] text-zinc-400">
                <span>Mês</span>
                <span className="text-right">Faturado</span>
                <span>Metas e atingimento</span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                {comparisonRows.map(row => {
                  return (
                    <div
                      key={row.label}
                      className={`grid min-w-[780px] grid-cols-[0.8fr_1fr_2.4fr] items-center gap-6 border-b border-zinc-100 px-4 py-4 text-sm last:border-b-0 ${row.current ? 'bg-pink-50/60' : ''}`}
                    >
                      <span className={`font-black ${row.current ? 'text-pink-600' : 'text-zinc-800'}`}>{row.label}</span>
                      <span className="text-right font-black tabular-nums text-zinc-900">R$ {fmt(row.value)}</span>
                      <GoalTierProgressRows
                        value={row.value}
                        target={row.target}
                        up={row.up}
                        top={row.top}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ) : scope === 'weekly' ? (
            <div className="flex h-full min-h-0 min-w-[620px] flex-col overflow-hidden">
              <div className="grid shrink-0 grid-cols-[1.2fr_1fr_1.1fr_2fr_100px_70px] gap-7 border-b border-zinc-200 px-4 py-4 text-[12px] font-black uppercase tracking-[0.12em] text-zinc-400">
                <span>Semana</span>
                <span className="text-right">{activeTierLabel}</span>
                <span className="text-right">Realizado</span>
                <span>Saldo da semana</span>
                <span className="text-right">Status</span>
                <span className="sr-only">Icone</span>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                {weekSummaryRows.map(row => {
                  const balanceText = `${row.balance >= 0 ? '+' : '-'}${fmt(Math.abs(row.balance)).split(',')[0]}`;

                  return (
                    <div
                      key={row.key}
                      className="grid grid-cols-[1.2fr_1fr_1.1fr_2fr_100px_70px] items-center gap-7 rounded-[8px] px-4 py-3 text-[1.05rem]"
                    >
                      <span className="font-bold text-zinc-800">{row.label}</span>
                      <span className="text-right font-mono text-[1rem] font-medium tracking-[-0.04em] text-zinc-400">R$ {fmt(row.target)}</span>
                      <span className="text-right font-mono text-[1.05rem] font-black tracking-[-0.04em] text-zinc-900">R$ {fmt(row.value)}</span>
                      <DailyBalanceBar balance={row.balance} maxAbs={maxWeeklyBalanceAbs} tone={row.statusTone} />
                      <span className={`text-right font-mono text-[1rem] font-black tracking-[-0.04em] ${row.balance >= 0 ? 'text-emerald-600' : row.value <= 0 ? 'text-rose-400' : 'text-amber-600'}`}>
                        {balanceText}
                      </span>
                      <span className="flex justify-end">
                        <DailyReferenceStatus tone={row.statusTone} />
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="flex h-full min-h-0 min-w-[620px] flex-col overflow-hidden">
              <div className="grid shrink-0 grid-cols-[90px_1fr_1.1fr_2fr_100px_70px] gap-7 border-b border-zinc-200 px-4 py-4 text-[12px] font-black uppercase tracking-[0.12em] text-zinc-400">
                <span>Dia</span>
                <span className="text-right">{activeTierLabel}</span>
                <span className="text-right">Realizado</span>
                <span>Saldo do dia</span>
                <span className="text-right">Status</span>
                <span className="sr-only">Icone</span>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                {rowGroups.map(group => (
                  <div key={group.key} className="py-1">
                    <div className="mb-1 rounded-[10px] bg-zinc-50 px-4 py-2 text-[11px] font-black uppercase tracking-[0.14em] text-zinc-500">
                      {group.label}
                    </div>
                    {group.rows.map(r => {
                      const balanceText = `${r.balance >= 0 ? '+' : '-'}${fmt(Math.abs(r.balance)).split(',')[0]}`;
                      return (
                        <div
                          key={r.key}
                          className={`grid grid-cols-[90px_1fr_1.1fr_2fr_100px_70px] items-center gap-7 rounded-[8px] px-4 py-2.5 text-[1.05rem] ${r.isToday ? 'bg-pink-50' : ''} ${!r.isPast ? 'opacity-50' : ''}`}
                        >
                          <div className="flex items-center gap-2 font-bold text-zinc-800">
                            <span>{format(r.day, 'dd/MM', { locale: ptBR })}</span>
                            {r.isToday ? <span className="rounded-[5px] bg-pink-500 px-1.5 py-0.5 text-[10px] font-black uppercase text-white">Hoje</span> : null}
                          </div>
                          <span className="text-right font-mono text-[1rem] font-medium tracking-[-0.04em] text-zinc-400">R$ {fmt(r.currentNeed)}</span>
                          <span className="text-right font-mono text-[1.05rem] font-black tracking-[-0.04em] text-zinc-900">R$ {fmt(r.value)}</span>
                          <DailyBalanceBar balance={r.balance} maxAbs={maxBalanceAbs} tone={r.statusTone} />
                          <span className={`text-right font-mono text-[1rem] font-black tracking-[-0.04em] ${r.balance >= 0 ? 'text-emerald-600' : r.value <= 0 ? 'text-rose-400' : 'text-amber-600'}`}>
                            {balanceText}
                          </span>
                          <span className="flex justify-end">
                            <DailyReferenceStatus tone={r.statusTone} />
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col items-start gap-4 border-t border-zinc-100 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-11 sm:py-6">
          {scope === 'monthly' ? (
            <p className="text-sm font-semibold text-zinc-500">
              Comparativo dos últimos 3 meses cadastrados e do mês atual da unidade.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-6 text-sm font-semibold text-zinc-500">
              <span className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-black text-zinc-600">
                Faixa ativa: {activeTierLabel}
              </span>
              <span className="inline-flex items-center gap-2"><DailyReferenceStatus tone="ok" /> Bateu a faixa ativa</span>
              <span className="inline-flex items-center gap-2"><DailyReferenceStatus tone="miss" /> Abaixo da faixa ativa</span>
              <span className="inline-flex items-center gap-2"><DailyReferenceStatus tone="zero" /> Sem faturamento</span>
              <span className="inline-flex items-center gap-2"><DailyReferenceStatus tone="future" /> A vir</span>
            </div>
          )}
          <Button
            onClick={() => onOpenChange(false)}
            className="h-14 rounded-[14px] bg-zinc-900 px-8 text-base font-bold text-white shadow-none hover:bg-zinc-800"
          >
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EmployeeDailyModal({
  open,
  onOpenChange,
  employeeGoal,
  originalEgs,
  period,
  userName,
  distributionSnapshot,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  employeeGoal: EmployeeGoal | null;
  originalEgs?: EmployeeGoal[] | null;
  period: GoalPeriodDoc | null;
  userName?: string | null;
  distributionSnapshot?: GoalDistributionSnapshot | null;
}) {
  if (!employeeGoal || !period || !userName) return null;

  const { refDate, periodEnd } = getPeriodContext(period);
  const dailyTargets = getEmployeeDailyTargetMap(employeeGoal, period, distributionSnapshot, originalEgs);
  const activeDateKeys = Object.keys(dailyTargets).sort();
  const activeDateSet = new Set(activeDateKeys);
  const upTarget = employeeGoal.targetValue * 1.2;
  const progress = employeeGoal.dailyProgress ?? {};
  const periodStart = period.startDate?.toDate?.() ?? refDate;
  const allPeriodDays = eachDayOfInterval({ start: periodStart, end: periodEnd });
  const elapsedActiveDays = allPeriodDays.filter(day => day <= refDate && activeDateSet.has(dateKey(day)));
  const elapsedCount = elapsedActiveDays.length;
  const hitCount = elapsedActiveDays.filter(day => {
    const key = dateKey(day);
    return (progress[key] ?? 0) >= (dailyTargets[key] ?? 0);
  }).length;
  const averagePerElapsedDay = elapsedCount > 0 ? employeeGoal.currentValue / elapsedCount : 0;
  const currentPace = averagePerElapsedDay;
  const remainingActiveDays = Math.max(activeDateKeys.length - elapsedCount, 0);
  const requiredPace = remainingActiveDays > 0 ? Math.max(employeeGoal.targetValue - employeeGoal.currentValue, 0) / remainingActiveDays : 0;
  const currentPct = pct(employeeGoal.currentValue, employeeGoal.targetValue);
  const upPct = pct(employeeGoal.currentValue, upTarget);
  const paceOk = currentPace >= requiredPace;

  const allActiveDays = allPeriodDays.filter(day => activeDateSet.has(dateKey(day)));

  // Dias trabalhados conforme a escala (se disponível no snapshot)
  const workedDaysFromEscala = distributionSnapshot?.workedDaysByKioskAndUser?.[`${period.kioskId}__${employeeGoal.employeeId}`];
  const workedDaySet = workedDaysFromEscala?.length ? new Set(workedDaysFromEscala) : null;
  const displayDays = allActiveDays.length > 0
    ? allActiveDays
    : workedDaySet
      ? allPeriodDays.filter(day => workedDaySet.has(dateKey(day)))
      : [];

  const elapsedDisplayDays = displayDays.filter(day => day <= refDate);
  const noSaleCount = elapsedDisplayDays.filter(day => (progress[dateKey(day)] ?? 0) <= 0).length;
  const bestDayValue = elapsedDisplayDays.reduce((best, day) => Math.max(best, progress[dateKey(day)] ?? 0), 0);

  const initials = getInitials(userName);
  const avatarClass = collaboratorAvatarClass(employeeGoal.employeeId);
  const useTeamView = usesTeamGoalDashboard(period);

  if (useTeamView) {
    const periodProgress = period.dailyProgress ?? {};
    const periodDateKeys = getPeriodDistributionDateKeys(period, distributionSnapshot);
    const periodActiveDateSet = new Set(periodDateKeys.length > 0 ? periodDateKeys : allPeriodDays.map(dateKey));
    const periodDayCount = Math.max(periodActiveDateSet.size, 1);
    const periodDailyTarget = period.targetValue / periodDayCount;
    const periodDailyUp = period.upValue / periodDayCount;
    const periodDailyTop = period.topValue && period.topValue > period.upValue ? period.topValue / periodDayCount : null;
    const rowsDays = allPeriodDays.filter(day => periodActiveDateSet.has(dateKey(day)));
    const elapsedRowsDays = rowsDays.filter(day => day <= refDate);
    const generalHitCount = elapsedRowsDays.filter(day => (periodProgress[dateKey(day)] ?? 0) >= periodDailyTarget).length;
    const employeePeriodShare = pct(employeeGoal.currentValue, period.currentValue);
    const generalToday = periodProgress[dateKey(refDate)] ?? 0;
    const employeeToday = progress[dateKey(refDate)] ?? 0;

    const escalaLabels = distributionSnapshot?.shiftLabelByKioskUserAndDate?.[`${period.kioskId}__${employeeGoal.employeeId}`] ?? {};
    const shiftsByDay = new Map<string, string>(Object.entries(escalaLabels));

    if (shiftsByDay.size === 0) {
      for (const og of (originalEgs ?? [])) {
        const ogLabel = og.shiftId ? period.shifts?.find(s => s.id === og.shiftId)?.label : null;
        if (!ogLabel) continue;
        const ogActiveKeys = getStrictEmployeeDistributionDateKeys(og, period, distributionSnapshot);
        for (const k of ogActiveKeys) {
          const existing = shiftsByDay.get(k);
          shiftsByDay.set(k, existing ? `${existing} · ${ogLabel}` : ogLabel);
        }
      }
    }

    const hasShiftCol = shiftsByDay.size > 0;
    const cols = hasShiftCol
      ? 'grid-cols-[1.05fr_0.95fr_0.95fr_0.8fr_0.7fr_0.9fr_72px]'
      : 'grid-cols-[1.05fr_0.95fr_0.8fr_0.7fr_0.9fr_72px]';

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="!max-w-[1120px] w-[min(96vw,1120px)] overflow-hidden rounded-[22px] border border-zinc-200 bg-white p-0 shadow-[0_24px_60px_-30px_rgba(15,23,42,0.45)]">
          <div className="flex items-center gap-4 border-b border-zinc-100 px-5 py-4">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-extrabold ${avatarClass}`}>
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-base font-bold tracking-tight text-zinc-900">{userName}</DialogTitle>
              <DialogDescription className="text-[11px] font-medium text-slate-400">
                {format(periodStart, 'dd/MM/yyyy', { locale: ptBR })} a {format(periodEnd, 'dd/MM/yyyy', { locale: ptBR })}
              </DialogDescription>
            </div>
          </div>

          <ScrollArea className="h-[min(72vh,640px)]">
            <div className="space-y-4 px-5 py-4">
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                {[
                  { label: 'Geral no período', value: `R$ ${fmt(period.currentValue)}`, hint: `${pct(period.currentValue, period.targetValue).toFixed(1)}% da meta geral`, color: 'text-zinc-900' },
                  { label: 'Colaborador', value: `R$ ${fmt(employeeGoal.currentValue)}`, hint: `${employeePeriodShare.toFixed(1)}% do geral`, color: 'text-blue-600' },
                  { label: 'Hoje geral', value: `R$ ${fmt(generalToday)}`, hint: `Colaborador R$ ${fmt(employeeToday)}`, color: 'text-zinc-900' },
                  { label: 'Dias gerais batidos', value: `${generalHitCount}/${elapsedRowsDays.length}`, hint: 'status da unidade', color: 'text-emerald-600' },
                ].map(({ label, value, hint, color }) => (
                  <div key={label} className="rounded-[14px] border border-zinc-200 bg-zinc-50 px-3 py-2.5">
                    <p className="text-[9px] font-black uppercase tracking-[0.1em] text-slate-400">{label}</p>
                    <p className={`mt-1 text-sm font-extrabold tabular-nums ${color}`}>{value}</p>
                    <p className="mt-1 text-[10px] font-semibold text-zinc-400">{hint}</p>
                  </div>
                ))}
              </div>

              <div className="rounded-[14px] border border-zinc-200 bg-zinc-50 px-4 py-3">
                <p className="mb-2 text-[9px] font-black uppercase tracking-[0.12em] text-zinc-400">Metas gerais do dia</p>
                <GoalTierProgressPills
                  value={generalToday}
                  target={periodDailyTarget}
                  up={periodDailyUp}
                  top={periodDailyTop}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-400">
                    Detalhe por dia · {format(periodStart, 'dd/MM', { locale: ptBR })} - {format(periodEnd, 'dd/MM', { locale: ptBR })}
                  </p>
                  <p className="text-[10px] text-zinc-400">
                    Participação = colaborador ÷ geral do dia
                  </p>
                </div>

                <div className="overflow-x-auto rounded-[14px] border border-zinc-200 bg-white">
                  <div className={`grid min-w-[920px] ${cols} border-b border-zinc-100 bg-zinc-50 px-4 py-2 text-[9px] font-black uppercase tracking-[0.1em] text-slate-400`}>
                    <span>Dia</span>
                    {hasShiftCol && <span>Turno</span>}
                    <span className="text-right">Colaborador</span>
                    <span className="text-right">Alvo colab.</span>
                    <span className="text-right">Part.</span>
                    <span className="text-right">Geral</span>
                    <span className="text-center">Status</span>
                  </div>

                  {rowsDays.map(day => {
                    const key = dateKey(day);
                    const generalValue = periodProgress[key] ?? 0;
                    const employeeValue = progress[key] ?? 0;
                    const employeeTarget = dailyTargets[key] ?? 0;
                    const participation = pct(employeeValue, generalValue);
                    const isToday = isSameDay(day, refDate);
                    const isPastOrToday = day <= refDate;
                    const shiftLabel = shiftsByDay.get(key);
                    const isScheduledForEmployee = shiftsByDay.size > 0 ? Boolean(shiftLabel) : activeDateSet.has(key);
                    // Status reflete o COLABORADOR (a tela é o detalhamento dele), não a unidade.
                    const employeeHit = employeeTarget > 0 && employeeValue >= employeeTarget;
                    const statusLabel = !isPastOrToday
                      ? 'A vir'
                      : !isScheduledForEmployee
                        ? 'Descanso'
                        : employeeValue <= 0
                          ? 'Sem venda'
                          : employeeHit
                            ? 'Batida'
                            : 'Abaixo';
                    const statusClass = !isPastOrToday
                      ? 'border-zinc-200 bg-zinc-50 text-zinc-400'
                      : !isScheduledForEmployee
                        ? 'border-slate-200 bg-slate-50 text-slate-500'
                      : employeeValue <= 0
                        ? 'border-rose-200 bg-rose-50 text-rose-600'
                        : employeeHit
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-amber-200 bg-amber-50 text-amber-700';

                    return (
                      <div
                        key={key}
                        className={`grid min-w-[920px] ${cols} items-center border-b border-zinc-100 px-4 py-2.5 text-xs last:border-b-0 ${isToday ? 'bg-amber-50/60' : ''}`}
                      >
                        <span className={`font-semibold ${isToday ? 'text-amber-600' : 'text-zinc-700'}`}>
                          {format(day, "eee dd/MM", { locale: ptBR }).replace(/^\w/, c => c.toUpperCase())}
                        </span>
                        {hasShiftCol && (
                          <span className="truncate text-[10px] font-medium text-zinc-400">
                            {shiftLabel ?? (isScheduledForEmployee ? '-' : 'Descanso')}
                          </span>
                        )}
                        <span className="text-right font-bold text-blue-600">R$ {fmt(employeeValue)}</span>
                        <span className="text-right font-medium text-zinc-400">R$ {fmt(employeeTarget)}</span>
                        <span className="text-right font-black text-zinc-700">{participation.toFixed(1)}%</span>
                        <span className="text-right font-semibold text-zinc-500">R$ {fmt(generalValue)}</span>
                        <div className="flex justify-center">
                          <span className={`inline-flex min-w-[62px] justify-center rounded-full border px-2 py-1 text-[10px] font-bold ${statusClass}`}>
                            {statusLabel}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </ScrollArea>

          <div className="flex justify-end border-t border-zinc-100 bg-white px-5 py-3">
            <Button onClick={() => onOpenChange(false)} variant="outline" className="h-9 rounded-full px-5 text-xs font-bold">
              Fechar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-[620px] w-[min(96vw,620px)] overflow-hidden rounded-[22px] border border-zinc-200 bg-white p-0 shadow-[0_24px_60px_-30px_rgba(15,23,42,0.45)]">
        {/* Cabeçalho */}
        <div className="flex items-center gap-4 border-b border-zinc-100 px-5 py-4">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-extrabold ${avatarClass}`}>
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-base font-bold tracking-tight text-zinc-900 truncate">{userName}</DialogTitle>
            <DialogDescription className="text-[11px] font-medium text-slate-400">
              {format(periodStart, 'dd/MM/yyyy', { locale: ptBR })} a {format(periodEnd, 'dd/MM/yyyy', { locale: ptBR })}
            </DialogDescription>
          </div>
        </div>

        <ScrollArea className="h-[min(72vh,600px)]">
          <div className="space-y-4 px-5 py-4">

            {/* KPIs compactos */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: 'Acumulado', value: `R$ ${fmt(employeeGoal.currentValue)}`, color: 'text-zinc-900' },
                { label: '% Meta', value: `${currentPct.toFixed(1)}%`, color: currentPct >= 100 ? 'text-emerald-600' : 'text-amber-500' },
                { label: '% Meta UP', value: `${upPct.toFixed(1)}%`, color: upPct >= 100 ? 'text-emerald-600' : 'text-blue-500' },
                { label: 'Dias batidos', value: `${hitCount}/${elapsedCount}`, color: 'text-zinc-700' },
              ].map(({ label, value, color }) => (
                <div key={label} className="rounded-[14px] border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-center">
                  <p className="text-[9px] font-black uppercase tracking-[0.1em] text-slate-400">{label}</p>
                  <p className={`mt-1 text-sm font-extrabold tabular-nums ${color}`}>{value}</p>
                </div>
              ))}
            </div>

            {/* Barra de progresso única */}
            <div className="rounded-[14px] border border-zinc-200 bg-zinc-50 px-4 py-3 space-y-2">
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] font-bold text-zinc-500">
                  <span>Meta · R$ {fmt(employeeGoal.targetValue)}</span>
                  <span className={currentPct >= 100 ? 'text-emerald-600' : 'text-amber-500'}>{currentPct.toFixed(1)}%</span>
                </div>
                <div className="h-2 rounded-full bg-zinc-200 overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${getStatusColor(currentPct).bar}`} style={{ width: `${Math.min(currentPct, 100)}%` }} />
                </div>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] font-bold text-zinc-500">
                  <span>Meta UP · R$ {fmt(upTarget)}</span>
                  <span className="text-blue-500">{upPct.toFixed(1)}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-blue-100 overflow-hidden">
                  <div className="h-full rounded-full bg-blue-400 transition-all" style={{ width: `${Math.min(upPct, 100)}%` }} />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pt-1 text-[10px] font-semibold text-zinc-500">
                <span>Ritmo atual: <span className={paceOk ? 'text-emerald-600 font-bold' : 'text-rose-500 font-bold'}>R$ {fmt(currentPace)}/dia</span></span>
                <span>Necessário: R$ {fmt(requiredPace)}/dia</span>
                <span>Média: R$ {fmt(averagePerElapsedDay)}/dia</span>
              </div>
            </div>

            {/* Tabela semanal */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-400">
                  Detalhe por dia · {format(periodStart, 'dd/MM', { locale: ptBR })} – {format(periodEnd, 'dd/MM', { locale: ptBR })}
                </p>
                <p className="text-[10px] text-zinc-400">
                  Sem venda: <span className="font-bold text-zinc-700">{noSaleCount}</span> · Melhor: <span className="font-bold text-zinc-700">R$ {fmt(bestDayValue)}</span>
                </p>
              </div>

              {(() => {
                // Labels de turno por dia: preferência para dados reais da escala (startTime–endTime),
                // com fallback para o label do shift do goal (antes do merge)
                const escalaLabels = distributionSnapshot?.shiftLabelByKioskUserAndDate?.[`${period.kioskId}__${employeeGoal.employeeId}`] ?? {};
                const shiftsByDay = new Map<string, string>(Object.entries(escalaLabels));

                if (shiftsByDay.size === 0) {
                  for (const og of (originalEgs ?? [])) {
                    const ogLabel = og.shiftId ? period.shifts?.find(s => s.id === og.shiftId)?.label : null;
                    if (!ogLabel) continue;
                    const ogActiveKeys = getStrictEmployeeDistributionDateKeys(og, period, distributionSnapshot);
                    for (const k of ogActiveKeys) {
                      const existing = shiftsByDay.get(k);
                      shiftsByDay.set(k, existing ? `${existing} · ${ogLabel}` : ogLabel);
                    }
                  }
                }

                const hasShiftCol = shiftsByDay.size > 0;
                const cols = hasShiftCol
                  ? 'grid-cols-[1.1fr_0.75fr_0.8fr_0.8fr_0.9fr_56px]'
                  : 'grid-cols-[1.3fr_0.85fr_0.85fr_1fr_56px]';

                return (
                  <div className="overflow-hidden rounded-[14px] border border-zinc-200 bg-white">
                    <div className={`grid ${cols} border-b border-zinc-100 bg-zinc-50 px-4 py-2 text-[9px] font-black uppercase tracking-[0.1em] text-slate-400`}>
                      <span>Dia</span>
                      {hasShiftCol && <span>Turno</span>}
                      <span className="text-right">Alvo/dia</span>
                      <span className="text-right">UP/dia</span>
                      <span className="text-right">Realizado</span>
                      <span className="text-center">Status</span>
                    </div>

                    {displayDays.map((day) => {
                      const key = dateKey(day);
                      const value = progress[key] ?? 0;
                      const isToday = isSameDay(day, refDate);
                      const isPastOrToday = day <= refDate;
                      const shiftLabel = shiftsByDay.get(key);
                      const dayTarget = dailyTargets[key] ?? 0;
                      const dayUpTarget = dayTarget * 1.2;

                      let statusLabel = isPastOrToday ? '⚠' : '—';
                      let statusClass = isPastOrToday ? 'bg-zinc-50 border border-zinc-300 text-zinc-400' : 'text-zinc-300';
                      if (isPastOrToday && value >= dayTarget) {
                        statusLabel = '✓';
                        statusClass = 'bg-emerald-500 text-white shadow-[0_4px_10px_-6px_rgba(34,197,94,0.8)]';
                      } else if (isPastOrToday && value > 0) {
                        statusLabel = '✗';
                        statusClass = 'bg-amber-100 border border-amber-300 text-amber-700';
                      }

                      return (
                        <div
                          key={key}
                          className={`grid ${cols} border-b border-zinc-100 px-4 py-2.5 text-xs last:border-b-0 ${isToday ? 'bg-pink-50/50' : ''}`}
                        >
                          <span className={`font-semibold ${isToday ? 'text-pink-500' : 'text-zinc-700'}`}>
                            {format(day, "eee dd/MM", { locale: ptBR }).replace(/^\w/, c => c.toUpperCase())}
                            {isToday && <span className="ml-1.5 text-[9px] font-bold text-pink-400">hoje</span>}
                          </span>
                          {hasShiftCol && (
                            <span className="text-[10px] font-medium text-zinc-400 truncate">
                              {shiftLabel ?? '—'}
                            </span>
                          )}
                          <span className="text-right font-medium text-zinc-400">
                            R$ {fmt(dayTarget)}
                          </span>
                          <span className="text-right font-medium text-blue-400">
                            R$ {fmt(dayUpTarget)}
                          </span>
                          <span className={`text-right font-bold ${!isPastOrToday ? 'text-zinc-300' : value > 0 ? 'text-zinc-800' : 'text-zinc-300'}`}>
                            {!isPastOrToday ? '—' : `R$ ${fmt(value)}`}
                          </span>
                          <div className="flex justify-center">
                            <span className={`inline-flex w-7 items-center justify-center rounded-full text-[11px] ${statusClass}`}>
                              {statusLabel}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>
        </ScrollArea>

        <div className="flex justify-end border-t border-zinc-100 bg-white px-5 py-3">
          <Button onClick={() => onOpenChange(false)} variant="outline" className="h-9 rounded-full px-5 text-xs font-bold">
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WeekRow({ label, pctValue, barColor }: { label: string; pctValue: number; barColor: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <span className="text-[9px] font-black uppercase tracking-[0.12em] text-zinc-400">{label}</span>
        <span className={`text-[10px] font-bold tabular-nums ${pctValue >= 100 ? 'text-emerald-500' : 'text-zinc-500'}`}>
          {pctValue.toFixed(1)}%
        </span>
      </div>
      <div className="h-[3px] rounded-full bg-[#e8edf5] overflow-hidden">
        <div className={`h-full transition-all duration-500 ${barColor}`} style={{ width: `${Math.min(pctValue, 100)}%` }} />
      </div>
    </div>
  );
}

function PeriodGoalCard({ label, value, target, up, top, showTiers = true, focusTone, onClick }: {
  label: string;
  value: number;
  target: number;
  up?: number | null;
  top?: number | null;
  showTiers?: boolean;
  focusTone?: 'target' | 'up' | 'top';
  onClick?: () => void;
}) {
  const activeTone = getActiveTierTone(value, target, up, top);
  const displayTone = focusTone ?? activeTone;
  const activeTarget = activeTone === 'target'
    ? target
    : activeTone === 'up'
      ? up ?? target
      : top ?? up ?? target;
  const displayTarget = showTiers ? activeTarget : target;
  const activePercent = pct(value, displayTarget);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[18px] border border-[#edf1f6] bg-[#f8fafc] px-4 py-4 text-left transition-colors ${onClick ? 'hover:border-pink-200 hover:bg-pink-50/30' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">{label}</p>
          <p className="mt-2 text-xl font-black tracking-tight text-zinc-900">R$ {fmt(value)}</p>
        </div>
        <Badge className={`rounded-full px-2.5 py-1 text-[11px] font-black ${showTiers ? activeTierBadgeClass(value, target, up, top) : tierBadgeClassByTone(displayTone)}`}>
          {activePercent.toFixed(1)}%
        </Badge>
      </div>

      {showTiers ? (
        <div className="mt-4">
          <GoalTierProgressRows value={value} target={target} up={up} top={top} />
        </div>
      ) : (
        <p className="mt-3 text-xs font-semibold text-zinc-500">{tierLabelByTone(displayTone)}: R$ {fmt(target)}</p>
      )}

    </button>
  );
}

function BonusCalculationDetails({
  row,
  preview,
  totalPeriodTurns,
  fixedCollaboratorCount,
  eligibleCollaboratorCount,
  revenue,
  period,
}: {
  row: BonusParticipantRow;
  preview: NonNullable<ReturnType<typeof calculateTieredGoalBonus>>;
  totalPeriodTurns: number;
  fixedCollaboratorCount: number;
  eligibleCollaboratorCount: number;
  revenue: number;
  period: GoalPeriodDoc;
}) {
  const leadershipConfig = period.goalMethodSnapshot?.leadershipBonus;
  const leadershipNumerator = leadershipConfig?.factorNumerator ?? 0;
  const leadershipDenominator = leadershipConfig?.factorDenominator ?? 1;
  const reliefSplit = preview.reliefWorkerSplit;
  const hasReliefSplit = Boolean(reliefSplit && reliefSplit.reliefWorkerCount > 0);
  const tiers = period.goalMethodSnapshot?.tiers ?? [];
  const achievedByTierId = new Map(preview.achievedTiers.map(item => [item.tier.id, item]));
  const nextTier = tiers.find(tier => !achievedByTierId.has(tier.id));
  const missingForNextTier = nextTier ? Math.max(nextTier.fromAmount - revenue, 0) : 0;
  const resultReason = preview.achievedTiers.length === 0
    ? nextTier
      ? `Ainda não houve bonificação porque ${nextTier.label} não foi alcançada.`
      : 'Ainda não houve bonificação porque nenhuma faixa foi alcançada.'
    : `${preview.achievedTiers.length} faixa(s) de bonificação foram alcançadas.`;
  const roleTone = row.roleKey === 'leader'
    ? 'border-violet-100 bg-violet-50 text-violet-950'
    : row.roleKey === 'relief'
      ? 'border-blue-100 bg-blue-50 text-blue-950'
      : 'border-emerald-100 bg-white/90 text-emerald-950';

  return (
    <div className="space-y-3 rounded-b-[12px] border-t border-emerald-100 bg-emerald-50/60 px-4 py-3 text-[11px] text-emerald-950">
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_180px]">
        <div className="rounded-[12px] border border-emerald-100 bg-white/90 px-3 py-3">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700">Resultado do cálculo</p>
          <p className="mt-1 text-sm font-black text-emerald-950">
            {row.name}: R$ {formatCurrencyBRL(row.prize)}
          </p>
          <p className="mt-1 font-semibold text-emerald-800">{resultReason}</p>
          {nextTier && missingForNextTier > 0 ? (
            <p className="mt-2 rounded-[10px] border border-dashed border-emerald-200 bg-emerald-50 px-3 py-2 font-bold text-emerald-800">
              Falta R$ {formatCurrencyBRL(missingForNextTier)} para alcançar {nextTier.label}.
            </p>
          ) : null}
        </div>
        <div className="rounded-[12px] border border-emerald-100 bg-white/90 px-3 py-3">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700">Base da equipe</p>
          <p className="mt-1 text-lg font-black text-emerald-950">R$ {formatCurrencyBRL(preview.totalTeamBonus)}</p>
          <p className="mt-1 font-semibold text-emerald-800">Soma das faixas alcançadas.</p>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700">Faixas da bonificação</p>
        <div className="grid gap-2 md:grid-cols-3">
          {tiers.map((tier) => {
            const item = achievedByTierId.get(tier.id);
            const isNext = nextTier?.id === tier.id;
            const stateClass = item
              ? 'border-emerald-200 bg-white text-emerald-950'
              : isNext
                ? 'border-amber-200 bg-amber-50 text-amber-950'
                : 'border-zinc-200 bg-white/70 text-zinc-500';

            return (
              <div key={tier.id} className={`rounded-[12px] border px-3 py-3 ${stateClass}`}>
                <div className="flex items-start justify-between gap-2">
                  <p className="font-black">{tier.label}</p>
                  <span className="rounded-full bg-white/80 px-2 py-0.5 text-[9px] font-black">
                    {item ? 'Batida' : isNext ? 'Atual' : 'Aguardando'}
                  </span>
                </div>
                <p className="mt-1 font-semibold opacity-80">
                  Meta: R$ {formatCurrencyBRL(tier.fromAmount)}
                  {tier.toAmount != null ? ` a R$ ${formatCurrencyBRL(tier.toAmount)}` : ' em diante'}
                </p>
                {item ? (
                  <div className="mt-2 space-y-1 font-semibold opacity-90">
                    <p>Excedente: R$ {formatCurrencyBRL(item.excessAmount)}</p>
                    <p>Variável: R$ {formatCurrencyBRL(item.excessAmount)} x {item.tier.excessPercent}% = R$ {formatCurrencyBRL(item.variableBonusAmount)}</p>
                    <p>Fixo: R$ {formatCurrencyBRL(item.fixedBonusAmount)}</p>
                    <p className="font-black">
                      Bonificação da faixa: R$ {formatCurrencyBRL(item.fixedBonusAmount)} + R$ {formatCurrencyBRL(item.variableBonusAmount)} = R$ {formatCurrencyBRL(item.totalBonusAmount)}
                    </p>
                  </div>
                ) : isNext && missingForNextTier > 0 ? (
                  <p className="mt-2 font-bold">Faltam R$ {formatCurrencyBRL(missingForNextTier)} para liberar esta faixa.</p>
                ) : (
                  <p className="mt-2 font-semibold">Esta faixa só entra depois da faixa anterior ser alcançada.</p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {row.roleKey === 'leader' ? (
        <div className={`rounded-[12px] border px-3 py-3 ${roleTone}`}>
          <p className="text-[10px] font-black uppercase tracking-[0.16em]">Divisão para liderança</p>
          <p className="mt-2 font-semibold">
            A liderança é calculada separadamente sobre a base da equipe.
          </p>
          <p className="mt-1">
            Regra: R$ {formatCurrencyBRL(preview.totalTeamBonus)} x {leadershipNumerator}/{leadershipDenominator}.
          </p>
          <p className="mt-1">
            Cálculo: R$ {formatCurrencyBRL(preview.totalTeamBonus)} x {(leadershipNumerator / Math.max(leadershipDenominator, 1)).toLocaleString('pt-BR', { maximumFractionDigits: 4 })} = R$ {formatCurrencyBRL(preview.leadershipBonus)}.
          </p>
          <p className="mt-2 font-black">Bonificação da liderança: R$ {formatCurrencyBRL(row.prize)}</p>
        </div>
      ) : row.roleKey === 'relief' && reliefSplit ? (
        <div className={`rounded-[12px] border px-3 py-3 ${roleTone}`}>
          <p className="text-[10px] font-black uppercase tracking-[0.16em]">Divisão para folguista</p>
          <p className="mt-1">
            Regra: a folguista recebe a parte proporcional aos turnos cobertos dentro do total de turnos do período.
          </p>
          <p className="mt-1">
            Turnos cobertos por {row.name}: {row.coveredTurns}. Total de turnos do período: {totalPeriodTurns}.
          </p>
          <p className="mt-1">
            Cálculo: {row.coveredTurns} ÷ {totalPeriodTurns} x R$ {formatCurrencyBRL(preview.totalTeamBonus)} = R$ {formatCurrencyBRL(row.prize)}.
          </p>
          <p className="mt-2 font-black">Bonificação da folguista: R$ {formatCurrencyBRL(row.prize)}</p>
        </div>
      ) : hasReliefSplit && reliefSplit ? (
        <div className={`rounded-[12px] border px-3 py-3 ${roleTone}`}>
          <p className="text-[10px] font-black uppercase tracking-[0.16em]">Divisão para colaborador fixo</p>
          <p className="mt-1 text-emerald-800">
            Primeiro o sistema separa a parte das folguistas: R$ {formatCurrencyBRL(reliefSplit.totalReliefWorkerBonus)}.
          </p>
          <p className="mt-1 text-emerald-800">
            Depois sobra para as fixas: R$ {formatCurrencyBRL(preview.totalTeamBonus)} - R$ {formatCurrencyBRL(reliefSplit.totalReliefWorkerBonus)} = R$ {formatCurrencyBRL(reliefSplit.remainingFixedBonus)}.
          </p>
          <p className="mt-1 text-emerald-800">
            Cada fixa recebe: R$ {formatCurrencyBRL(reliefSplit.remainingFixedBonus)} ÷ {fixedCollaboratorCount} = R$ {formatCurrencyBRL(row.prize)}.
          </p>
          <p className="mt-2 font-black text-emerald-950">Bonificação de {row.name}: R$ {formatCurrencyBRL(row.prize)}</p>
        </div>
      ) : (
        <div className={`rounded-[12px] border px-3 py-3 ${roleTone}`}>
          <p className="text-[10px] font-black uppercase tracking-[0.16em]">Divisão para colaborador</p>
          <p className="mt-1 text-emerald-800">
            Sem folguista na divisão, a base da equipe é dividida igualmente entre os colaboradores elegíveis.
          </p>
          <p className="mt-1 text-emerald-800">
            Cálculo: R$ {formatCurrencyBRL(preview.totalTeamBonus)} ÷ {eligibleCollaboratorCount} = R$ {formatCurrencyBRL(row.prize)}.
          </p>
          <p className="mt-2 font-black text-emerald-950">Bonificação de {row.name}: R$ {formatCurrencyBRL(row.prize)}</p>
        </div>
      )}
    </div>
  );
}

function SalesByHourPanel({ period, salesReports }: { period: GoalPeriodDoc; salesReports: SalesReport[] }) {
  const summary = useMemo(() => buildHourlyRevenueSummary(period, salesReports), [period, salesReports]);
  const maxHourValue = Math.max(...summary.chartHours.map(item => item.value), 1);

  return (
    <div className="mt-4 rounded-[18px] border border-[#edf1f6] bg-white px-4 py-4">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">Faturamento por hora</p>
          <p className="mt-1 text-sm font-semibold text-zinc-500">
            Percentual de vendas por período do dia.
          </p>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-400">Total com horário</p>
          <p className="text-base font-black tabular-nums text-zinc-900">R$ {fmt(summary.total)}</p>
        </div>
      </div>

      {summary.total <= 0 ? (
        <div className="rounded-[14px] border border-dashed border-zinc-200 bg-[#f8fafc] px-4 py-6 text-center text-sm font-medium text-zinc-500">
          Sem dados de faturamento por hora para este período.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(280px,0.9fr)]">
          <div className="rounded-[14px] border border-zinc-100 bg-[#f8fafc] px-3 py-3">
            <div className="flex h-36 items-end gap-1 overflow-x-auto pb-1">
              {summary.chartHours.map(item => (
                <div key={item.hour} className="flex min-w-[28px] flex-1 flex-col items-center gap-1">
                  <div className="flex h-28 w-full items-end rounded-full bg-white">
                    <div
                      className="w-full rounded-full bg-pink-400"
                      style={{ height: `${Math.max((item.value / maxHourValue) * 100, item.value > 0 ? 5 : 0)}%` }}
                      title={`${item.label}: R$ ${fmt(item.value)} (${item.percent.toFixed(1)}%)`}
                    />
                  </div>
                  <span className="text-[9px] font-bold text-zinc-400">{item.label}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] font-semibold text-zinc-500">
              <span>Pico: {summary.peak.label} · R$ {fmt(summary.peak.value)}</span>
              {summary.estimated ? <span>Parte dos valores foi estimada pela curva de cupons.</span> : null}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {summary.buckets
              .filter(bucket => bucket.value > 0 || summary.total > 0)
              .map(bucket => (
                <div key={bucket.label} className="rounded-[12px] border border-zinc-100 bg-[#f8fafc] px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-black text-zinc-800">{bucket.label}</p>
                      <p className="text-[10px] font-semibold text-zinc-400">{bucket.range}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-black tabular-nums text-zinc-900">R$ {fmt(bucket.value)}</p>
                      <p className="text-[10px] font-bold text-blue-500">{bucket.percent.toFixed(1)}%</p>
                    </div>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-200">
                    <div className="h-full rounded-full bg-blue-400" style={{ width: `${Math.min(bucket.percent, 100)}%` }} />
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CollaboratorCard({ eg, shiftLabel, userName, refDate, periodEnd, period, distributionSnapshot, originalEgs, estimatedBonus, onOpenDaily }: {
  eg: EmployeeGoal; shiftLabel?: string; userName: string;
  refDate: Date; periodEnd: Date;
  period: GoalPeriodDoc;
  distributionSnapshot?: GoalDistributionSnapshot | null;
  originalEgs?: EmployeeGoal[] | null;
  estimatedBonus?: number | null;
  onOpenDaily?: () => void;
}) {
  const initials = getInitials(userName);
  const avatarClass = collaboratorAvatarClass(eg.employeeId);

  const dailyTargets = getEmployeeDailyTargetMap(eg, period, distributionSnapshot, originalEgs);
  const activeDateKeys = Object.keys(dailyTargets).sort();
  const activeDateSet = new Set(activeDateKeys);
  const periodStart = period.startDate?.toDate?.() ?? refDate;

  const isTeamGoalView = usesTeamGoalDashboard(period);
  const mPct = pct(eg.currentValue, eg.targetValue);
  const upTarget = period.targetValue > 0 && period.upValue > 0
    ? eg.targetValue * (period.upValue / period.targetValue)
    : eg.targetValue * 1.2;
  const topTarget = period.targetValue > 0 && period.topValue && period.topValue > period.upValue
    ? eg.targetValue * (period.topValue / period.targetValue)
    : null;
  const upPct = pct(eg.currentValue, upTarget);
  const topPct = topTarget ? pct(eg.currentValue, topTarget) : 0;
  const todayValue = eg.dailyProgress?.[dateKey(refDate)] ?? 0;
  const weekStats = calcEgWeekly(eg, period, refDate, periodEnd, distributionSnapshot);
  const periodStats = calcMonthlyStats(period, distributionSnapshot);
  const periodTodayValue = period.dailyProgress?.[dateKey(refDate)] ?? 0;
  const periodWeekStats = calcWeeklyStats(period, refDate, periodEnd, distributionSnapshot);
  const generalDayTarget = periodStats.alvo / Math.max(periodStats.totalDays, 1);
  const generalDayUp = periodStats.up / Math.max(periodStats.totalDays, 1);
  const generalDayTop = periodStats.top ? periodStats.top / Math.max(periodStats.totalDays, 1) : null;
  const teamActiveTone = getActiveTierTone(periodStats.value, periodStats.alvo, periodStats.up, periodStats.top);
  const activeDayTarget = tierAmountByTone(teamActiveTone, generalDayTarget, generalDayUp, generalDayTop);
  const activeWeekTarget = tierAmountByTone(teamActiveTone, periodWeekStats.alvo, periodWeekStats.up, periodWeekStats.top);
  const activeMonthTarget = tierAmountByTone(teamActiveTone, periodStats.alvo, periodStats.up, periodStats.top);
  const dayShare = pct(todayValue, periodTodayValue);
  const weekShare = pct(weekStats.value, periodWeekStats.value);
  const monthShare = pct(eg.currentValue, period.currentValue);
  const targetLabel = getGoalTierLabel(period, 'target', 'Meta Alvo');
  const upLabel = getGoalTierLabel(period, 'up', 'Meta UP');
  const topLabel = getGoalTierLabel(period, 'top', 'Meta TOP');

  // Semana atual — dots
  const weekStart = startOfWeek(refDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(refDate, { weekStartsOn: 1 });
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });
  const DAY_LABELS = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'];

  const metaColor = mPct >= 100 ? 'text-emerald-600' : 'text-rose-500';
  const metaBarColor = mPct >= 100 ? 'bg-emerald-500' : 'bg-rose-400';
  const topColor = topPct >= 100 ? 'text-emerald-600' : 'text-violet-500';

  return (
    <div className="flex flex-col rounded-[18px] border border-[#dbe3ef] bg-white overflow-hidden shadow-[0_8px_30px_-20px_rgba(15,23,42,0.2)]">

      {/* Cabeçalho */}
      <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`h-9 w-9 rounded-full shrink-0 flex items-center justify-center text-xs font-bold ${avatarClass}`}>
            {initials}
          </div>
          <div className="min-w-0">
            <span className="text-sm font-bold text-zinc-900 block truncate">{userName}</span>
            <p className="text-[10px] text-zinc-500 mt-0.5 truncate">
              {isTeamGoalView ? (
                <>
                  Faturou <span className="font-semibold text-zinc-700">R$ {fmt(eg.currentValue)}</span>
                </>
              ) : (
                <>
                  Meta <span className="font-semibold text-zinc-700">R$ {fmt(eg.targetValue)}</span>
                  {' · '}
                  <span className="font-semibold text-blue-600">UP R$ {fmt(upTarget)}</span>
                </>
              )}
            </p>
          </div>
        </div>
        {!isTeamGoalView && (
          <div className="shrink-0 text-right">
          <p className={`text-xl font-black tabular-nums ${isTeamGoalView ? 'text-blue-600' : metaColor}`}>
            {isTeamGoalView ? monthShare.toFixed(1) : Math.round(mPct)}%
          </p>
          </div>
        )}
      </div>

      <div className="mx-4 h-px bg-zinc-100" />

      {!isTeamGoalView && (
        <>
          {/* Faixas de meta */}
          <div className="px-4 pt-3 pb-2 space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full bg-zinc-400 shrink-0" />
                <span className="text-[11px] font-semibold text-zinc-600">{targetLabel}</span>
              </div>
              <span className={`text-[11px] font-bold tabular-nums ${metaColor}`}>
                {mPct.toFixed(1)}% · R$ {fmt(eg.targetValue)}
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-zinc-100">
              <div
                className={`h-full rounded-full ${metaBarColor}`}
                style={{ width: `${Math.min(mPct, 100)}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[9px] text-zinc-400 font-medium">
              <span>R$ {fmt(eg.currentValue)} realizado</span>
              <span>R$ {fmt(eg.targetValue)} {targetLabel}</span>
            </div>
          </div>

          {/* Meta UP */}
          <div className="px-4 pb-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full bg-blue-500 shrink-0" />
                <span className="text-[11px] font-bold text-blue-600">{upLabel}</span>
              </div>
              <span className="text-[11px] font-bold tabular-nums text-blue-500">
                {upPct.toFixed(1)}% · R$ {fmt(upTarget)}
              </span>
            </div>
            <div className="h-2 rounded-full bg-blue-100 overflow-hidden">
              <div className="h-full rounded-full bg-blue-400 transition-all" style={{ width: `${Math.min(upPct, 100)}%` }} />
            </div>
            <div className="flex items-center justify-between text-[9px] text-zinc-400 font-medium">
              <span>R$ {fmt(eg.currentValue)} realizado</span>
              <span>R$ {fmt(upTarget)} {upLabel}</span>
            </div>
          </div>

          {topTarget && (
            <div className="px-4 pb-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <div className="h-2 w-2 rounded-full bg-violet-500 shrink-0" />
                  <span className="text-[11px] font-bold text-violet-600">{topLabel}</span>
                </div>
                <span className={`text-[11px] font-bold tabular-nums ${topColor}`}>
                  {topPct.toFixed(1)}% · R$ {fmt(topTarget)}
                </span>
              </div>
              <div className="h-2 rounded-full bg-violet-100 overflow-hidden">
                <div className="h-full rounded-full bg-violet-400 transition-all" style={{ width: `${Math.min(topPct, 100)}%` }} />
              </div>
              <div className="flex items-center justify-between text-[9px] text-zinc-400 font-medium">
                <span>R$ {fmt(eg.currentValue)} realizado</span>
                <span>R$ {fmt(topTarget)} {topLabel}</span>
              </div>
            </div>
          )}
        </>
      )}

      <div className="mx-4 h-px bg-zinc-100" />

      <div className="grid grid-cols-3 gap-1.5 px-4 py-3">
        {[
          { label: 'Hoje', value: todayValue, share: dayShare, suffix: 'do dia', target: activeDayTarget },
          { label: 'Semana', value: weekStats.value, share: weekShare, suffix: 'da semana', target: activeWeekTarget },
          { label: 'Mês', value: eg.currentValue, share: monthShare, suffix: 'do mês', target: activeMonthTarget },
        ].map(item => (
          <div key={item.label} className="rounded-[12px] border border-zinc-100 bg-[#f8fafc] px-2 py-2 text-center">
            <p className="text-[8px] font-black uppercase tracking-[0.12em] text-zinc-400">{item.label}</p>
            <p className="mt-1 text-[8px] font-bold uppercase tracking-[0.08em] text-zinc-400">Faturado</p>
            <p className="truncate text-[11px] font-black tabular-nums text-zinc-800">R$ {fmt(item.value)}</p>
            {isTeamGoalView ? (
              <p className={`mt-1 rounded-full px-1.5 py-0.5 text-[8px] font-black tabular-nums ${tierToneClasses(teamActiveTone)}`}>
                {tierLabelByTone(teamActiveTone)} R$ {fmt(item.target)} · {pct(item.value, item.target).toFixed(0)}%
              </p>
            ) : null}
          </div>
        ))}
      </div>

      {estimatedBonus != null && estimatedBonus > 0 && (
        <div className="mx-4 mb-3 rounded-[12px] border border-emerald-100 bg-emerald-50 px-3 py-2">
          <p className="text-[8px] font-black uppercase tracking-[0.12em] text-emerald-700">Bonificação estimada</p>
          <p className="mt-0.5 text-sm font-black tabular-nums text-emerald-700">R$ {formatCurrencyBRL(estimatedBonus)}</p>
        </div>
      )}

      {/* Semana atual */}
      <div className="px-4 pt-3 pb-4 space-y-2">
        <span className="text-[10px] font-semibold text-zinc-500">Faturamento da semana</span>

        <div className="grid grid-cols-7 gap-1.5">
          {weekDays.map((day, i) => {
            const dk = dateKey(day);
            const val = eg.dailyProgress?.[dk] ?? 0;
            const isActive = activeDateSet.has(dk);
            const isToday = isSameDay(day, refDate);
            const isPast = day <= refDate;

            let boxClass = 'border-zinc-100 bg-zinc-50 text-zinc-400';
            let dotTitle = '';
            if (isToday) {
              boxClass = 'border-amber-200 bg-amber-50 text-amber-700 ring-1 ring-amber-200';
              dotTitle = val > 0 ? `Hoje · R$ ${fmt(val)}` : 'Hoje · em andamento';
            } else if (isActive && isPast) {
              if (val > 0) {
                boxClass = 'border-emerald-100 bg-emerald-50 text-emerald-700';
                dotTitle = `R$ ${fmt(val)}`;
              } else {
                boxClass = 'border-rose-100 bg-rose-50 text-rose-600';
                dotTitle = 'Sem venda';
              }
            } else if (!isActive && isPast) {
              boxClass = 'border-zinc-100 bg-white text-zinc-300';
              dotTitle = 'Folga';
            }

            return (
              <div key={dk} className={`min-w-0 rounded-[10px] border px-1.5 py-1.5 text-center ${boxClass}`} title={dotTitle || undefined}>
                <span className="block text-[8px] font-black uppercase tracking-[0.08em]">
                  {DAY_LABELS[i]}
                </span>
                <span className="mt-0.5 block truncate text-[8px] font-bold tabular-nums">
                  R$ {fmt(val)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Rodapé — atalho para o detalhamento diário (acumulado já aparece no topo) */}
      <button
        onClick={onOpenDaily}
        className="flex items-center justify-center gap-1 bg-[#f4f7fc] px-4 py-2.5 border-t border-[#edf1f6] hover:bg-[#eaeff9] transition-colors mt-auto"
      >
        <span className="text-[10px] font-bold text-primary flex items-center gap-0.5">
          Ver detalhamento diário →
        </span>
      </button>
    </div>
  );
}


function getInitialsShort(name: string) {
  return name.split(' ').slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase();
}

function KioskSummaryModal({ open, onOpenChange, group, employeeGoals, getUserName, kioskName, distributionSnapshot }: {
  open: boolean; onOpenChange: (v: boolean) => void; group: any;
  employeeGoals: EmployeeGoal[]; getUserName: (id: string) => string; kioskName: string;
  distributionSnapshot?: GoalDistributionSnapshot | null;
}) {
  if (!group) return null;
  const mainPeriod = group.periods.find((p: any) => p.type === 'revenue' || !p.type) ?? group.periods[0];
  if (!mainPeriod) return null;

  const now = new Date();
  const periodStart = mainPeriod.startDate.toDate();
  const periodEnd = mainPeriod.endDate.toDate();
  const monthDays = eachDayOfInterval({ start: periodStart, end: periodEnd });
  const activeDateKeys = getPeriodDistributionDateKeys(mainPeriod, distributionSnapshot);
  const activeDateSet = new Set(activeDateKeys);
  const elapsedDays = monthDays.filter(d => d <= now && activeDateSet.has(dateKey(d))).length;
  const remainingDays = Math.max(activeDateKeys.length - elapsedDays, 0);
  const dailyAlvo = mainPeriod.targetValue / Math.max(activeDateKeys.length, 1);
  const stats = calcMonthlyStats(mainPeriod, distributionSnapshot);

  // Percentual esperado até hoje
  const expectedPct = (elapsedDays / Math.max(activeDateKeys.length, 1)) * 100;
  const actualPct = pct(stats.value, stats.alvo);
  const diff = actualPct - expectedPct;

  // Dias com venda do quiosque
  const kioskDaysWithSale = monthDays.filter(d => activeDateSet.has(dateKey(d)) && (mainPeriod.dailyProgress?.[dateKey(d)] ?? 0) > 0).length;

  // Pace necessário para bater a meta
  const paceNeeded = remainingDays > 0 ? Math.max(stats.alvo - stats.value, 0) / remainingDays : 0;
  const paceActual = elapsedDays > 0 ? stats.value / elapsedDays : 0;

  // Colaboradores com dados — agrupados por employeeId
  const empRows = (() => {
    const byEmployee = new Map<string, EmployeeGoal[]>();
    for (const eg of employeeGoals.filter(eg => eg.periodId === mainPeriod.id)) {
      const arr = byEmployee.get(eg.employeeId) ?? [];
      arr.push(eg);
      byEmployee.set(eg.employeeId, arr);
    }
    return Array.from(byEmployee.entries()).map(([empId, goals]) => {
      const name = getUserName(empId);
      const dp: Record<string, number> = {};
      for (const g of goals) {
        for (const [k, v] of Object.entries(g.dailyProgress ?? {})) {
          dp[k] = (dp[k] ?? 0) + v;
        }
      }
      const mergedCurrentValue = goals.reduce((s, g) => s + g.currentValue, 0);
      const mergedTargetValue = goals.reduce((s, g) => s + g.targetValue, 0);
      const mergedGoalForTargets: EmployeeGoal = { ...goals[0], currentValue: mergedCurrentValue, targetValue: mergedTargetValue, dailyProgress: dp, shiftId: undefined };
      const employeeDailyTargets = getEmployeeDailyTargetMap(mergedGoalForTargets, mainPeriod, distributionSnapshot, goals);
      const employeeActiveDateKeys = Object.keys(employeeDailyTargets);
      const employeeActiveDateSet = new Set(employeeActiveDateKeys);
      const empDailyAlvo = mergedTargetValue / Math.max(employeeActiveDateKeys.length, 1);
      const daysWithSale = monthDays.filter(d => employeeActiveDateSet.has(dateKey(d)) && (dp[dateKey(d)] ?? 0) > 0).length;
      const daysHit = monthDays.filter(d => {
        const key = dateKey(d);
        return employeeActiveDateSet.has(key) && (dp[key] ?? 0) >= (employeeDailyTargets[key] ?? empDailyAlvo);
      }).length;
      const empPace = elapsedDays > 0 ? mergedCurrentValue / elapsedDays : 0;
      const empPaceNeeded = remainingDays > 0 ? Math.max(mergedTargetValue - mergedCurrentValue, 0) / remainingDays : 0;
      const empPct = pct(mergedCurrentValue, mergedTargetValue);
      const sharePct = pct(mergedCurrentValue, stats.value);
      const eg: EmployeeGoal = mergedGoalForTargets;
      return { eg, name, dp, empDailyAlvo, daysWithSale, daysHit, empPace, empPaceNeeded, empPct, sharePct, employeeActiveDateSet, employeeActiveDateKeys };
    });
  })();

  // Alertas / badges
  const alerts: { label: string; color: string }[] = [];
  if (paceActual < dailyAlvo) alerts.push({ label: 'Ritmo abaixo do necessário', color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400' });
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
    topTarget: stats.top ?? 0,
    topPct: stats.top ? pct(stats.value, stats.top) : 0,
    projection: stats.projection,
    paceActual,
    paceNeeded,
    dailyAlvo,
    elapsedDays,
    remainingDays,
    kioskDaysWithSale,
    totalMonthDays: activeDateKeys.length,
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
      totalDays: e.employeeActiveDateKeys.length,
      dailyProgress: monthDays.map(d => e.dp[dateKey(d)] ?? 0),
    })),
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-[95vw] w-[95vw] h-[95vh] p-0 overflow-hidden flex flex-col">
        {/* ── Cabeçalho ── */}
        <div className="pl-6 pr-16 pt-5 pb-4 border-b border-border/40 flex items-start justify-between gap-4 shrink-0">
          <div>
            <DialogTitle className="text-xl font-bold tracking-tight">Situação Geral — {group.monthLabel}</DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {kioskName} · Meta alvo: R$ {fmt(stats.alvo)} · Meta UP: R$ {fmt(stats.up)}{stats.top ? ` · Meta TOP: R$ ${fmt(stats.top)}` : ''} · Meta/dia: R$ {fmt(dailyAlvo)}
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
                <p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest mb-1">Ritmo Necessário</p>
                <p className={`text-xl font-black tabular-nums ${paceActual >= paceNeeded ? 'text-green-500' : 'text-rose-500'}`}>R$ {fmt(paceNeeded)}/dia</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Atual: R$ {fmt(paceActual)}/dia</p>
                <p className={`text-[10px] font-bold mt-0.5 ${paceActual >= paceNeeded ? 'text-green-600' : 'text-rose-500'}`}>
                  {paceActual >= paceNeeded ? '▲' : '▼'} R$ {fmt(Math.abs(paceActual - paceNeeded))}/dia
                </p>
              </div>
              <div className="p-3 rounded-xl border border-slate-300/60 dark:border-border/40 bg-slate-100 dark:bg-slate-800/40 shadow-sm">
                <p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest mb-1">Consistência</p>
                <p className="text-xl font-black tabular-nums text-blue-500">{kioskDaysWithSale}/{activeDateKeys.length} dias</p>
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
                  <span>Meta alvo</span>
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
                    <span>Meta UP</span>
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
              {stats.top && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[10px] text-muted-foreground font-bold uppercase">
                    <span>Meta TOP</span>
                    <span className="text-violet-500">{pct(stats.value, stats.top).toFixed(1)}%</span>
                  </div>
                  <div className="h-2 bg-slate-300 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div className="h-full bg-violet-500/70 transition-all" style={{ width: `${Math.min(pct(stats.value, stats.top), 100)}%` }} />
                  </div>
                  <div className="flex justify-between text-[9px] text-muted-foreground">
                    <span>R$ 0</span><span>R$ {fmt(stats.top)}</span>
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
                        <th className="p-2 text-center border-x border-border/30 min-w-[50px] font-bold">Part.</th>
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
                          const isActive = activeDateSet.has(dateKey(d));
                          const hit = val >= dailyAlvo;
                          const isFuture = d > now;
                          const isToday = isSameDay(d, now);
                          const label = val > 0 ? (val >= 1000 ? (val/1000).toFixed(1)+'k' : val.toFixed(0)) : '—';
                          return (
                            <td
                              key={d.toISOString()}
                              title={!isActive ? `Dia ${format(d,'dd')}: fora da escala` : val > 0 ? `Dia ${format(d,'dd')}: R$ ${fmt(val)} | Meta: R$ ${fmt(dailyAlvo)}` : `Dia ${format(d,'dd')}: sem venda`}
                              className={`px-1 py-1.5 text-center border-r border-border/20 font-mono text-[10px] w-8 ${isToday ? 'bg-primary/5 ring-1 ring-inset ring-primary/20' : ''} ${!isActive ? 'opacity-25' : isFuture ? 'opacity-20' : val > 0 ? (hit ? 'text-green-600' : 'text-amber-600') : 'text-muted-foreground/30'}`}
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
                          <td className="p-2 text-center border-x border-border/20 font-black text-blue-600">
                            {e.sharePct.toFixed(0)}%
                          </td>
                          <td className="p-2 text-center border-r border-border/20 font-bold">R$ {fmt(e.eg.currentValue)}</td>
                          {monthDays.map(d => {
                            const val = e.dp[dateKey(d)] ?? 0;
                            const isActive = e.employeeActiveDateSet.has(dateKey(d));
                            const hit = val >= e.empDailyAlvo;
                            const isFuture = d > now;
                            const isToday = isSameDay(d, now);
                            const label = val > 0 ? (val >= 1000 ? (val/1000).toFixed(1)+'k' : val.toFixed(0)) : '—';
                            return (
                              <td
                                key={d.toISOString()}
                                title={!isActive ? `Dia ${format(d,'dd')}: fora da escala` : val > 0 ? `Dia ${format(d,'dd')}: R$ ${fmt(val)} faturado pelo colaborador` : `Dia ${format(d,'dd')}: sem faturamento do colaborador`}
                                className={`px-1 py-1.5 text-center border-r border-border/20 font-mono text-[10px] w-8 ${isToday ? 'bg-primary/5 ring-1 ring-inset ring-primary/20' : ''} ${!isActive ? 'opacity-25' : isFuture ? 'opacity-20' : val > 0 ? (hit ? 'text-green-600' : 'text-amber-600') : 'text-muted-foreground/30'}`}
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
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-3">Contribuição por colaborador</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {empRows.map((e, i) => {
                    return (
                      <div key={i} className={`p-4 rounded-xl border-2 bg-card/60 space-y-3 ${e.daysWithSale === 0 ? 'border-amber-500/40' : 'border-border/40'}`}>
                        <div className="flex items-center gap-3">
                          <div className={`h-10 w-10 rounded-full flex items-center justify-center text-sm font-black ${collaboratorAvatarClass(e.eg.employeeId)}`}>
                            {getInitialsShort(e.name)}
                          </div>
                          <div>
                            <p className="font-black text-sm leading-tight">{e.name}</p>
                            <p className="text-[9px] text-muted-foreground">
                              {e.employeeActiveDateKeys.length} dia(s) considerados pela escala
                            </p>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <p className="text-muted-foreground text-[9px] uppercase font-bold">Vendido</p>
                            <p className="font-black text-base">R$ {fmt(e.eg.currentValue)}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground text-[9px] uppercase font-bold">Part. unidade</p>
                            <p className="font-black text-base text-blue-600">{e.sharePct.toFixed(1)}%</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground text-[9px] uppercase font-bold">Dias com venda</p>
                            <p className="font-bold">{e.daysWithSale} / {e.employeeActiveDateKeys.length}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground text-[9px] uppercase font-bold">Média/dia</p>
                            <p className="font-bold text-zinc-800">R$ {fmt(e.empPace)}/dia</p>
                          </div>
                        </div>
                        <div>
                          <p className="text-[9px] text-muted-foreground uppercase font-bold mb-1">Participação no faturamento da unidade</p>
                          <div className="h-1.5 bg-muted/40 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-500 transition-all" style={{ width: `${Math.min(e.sharePct, 100)}%` }} />
                          </div>
                        </div>
                        <div className={`text-[10px] font-bold px-2 py-1 rounded-md ${e.daysWithSale === 0 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400'}`}>
                          {e.daysWithSale === 0
                            ? 'Nenhum faturamento registrado nos dias considerados.'
                            : `${e.daysWithSale} dia(s) com faturamento · ${e.sharePct.toFixed(1)}% do total da unidade.`}
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
  const { periods, employeeGoals, templates, loading, deletePeriod, deleteEmployeeGoal, rebalancePeriodEmployeeGoals } = useGoals();
  const { salesReports } = useSalesReports();
  const { user, permissions, users, firebaseUser, isDefaultAdmin } = useAuth();
  const { kiosks } = useKiosks();
  const { toast } = useToast();
  const [fallbackUsersById, setFallbackUsersById] = useState<Record<string, UserIdentityLike | null>>({});
  const [distributionSnapshot, setDistributionSnapshot] = useState<GoalDistributionSnapshot | null>(null);

  const isManager = (permissions.goals?.manage ?? false) || (permissions.settings?.manageUsers ?? false);
  const [selectedKioskId, setSelectedKioskId] = useState<string>('all');
  const usersById = useMemo(
    () => Object.fromEntries(users.map(collaborator => [collaborator.id, collaborator])),
    [users]
  );

  const getKioskName = (id: string) => kiosks.find(k => k.id === id)?.name ?? id;
  const missingEmployeeIds = useMemo(() => {
    const uniqueIds = Array.from(new Set(employeeGoals.map(goal => goal.employeeId)));
    return uniqueIds.filter(id => !usersById[id] && !(id in fallbackUsersById));
  }, [employeeGoals, usersById, fallbackUsersById]);

  useEffect(() => {
    if (missingEmployeeIds.length === 0) return;

    let cancelled = false;

    void (async () => {
      const resolvedEntries = await Promise.all(
        missingEmployeeIds.map(async (id) => {
          const userRef = doc(db, 'users', id);
          let snapshot = null;

          try {
            snapshot = await getDoc(userRef);
          } catch {
            try {
              snapshot = await getDocFromCache(userRef);
            } catch {
              snapshot = null;
            }
          }

          if (snapshot?.exists()) {
            return [id, pickUserIdentitySnapshot(id, snapshot.data())] as const;
          }

          return [id, null] as const;
        })
      );

      if (cancelled) return;

      setFallbackUsersById(prev => {
        const next = { ...prev };
        for (const [id, resolvedUser] of resolvedEntries) {
          next[id] = resolvedUser;
        }
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [missingEmployeeIds]);

  const getUserName = (id: string) => {
    const collaborator = usersById[id] ?? fallbackUsersById[id];
    return getUserDisplayName(collaborator, id);
  };

  const getUserJobLabel = (id: string) => {
    const collaborator = usersById[id] ?? fallbackUsersById[id];
    const functionNames = Array.isArray((collaborator as any)?.jobFunctionNames)
      ? (collaborator as any).jobFunctionNames.filter(Boolean)
      : [];

    if (functionNames.length > 0) return functionNames.join(', ');

    const roleName = (collaborator as any)?.jobRoleName;
    return typeof roleName === 'string' && roleName.trim().length > 0
      ? roleName.trim()
      : 'Sem cargo/função';
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
  const [dailyModalScope, setDailyModalScope] = useState<GoalDetailScope>('monthly');
  const [dailyModalMonthlyComparisonRows, setDailyModalMonthlyComparisonRows] = useState<MonthlyComparisonRow[] | null>(null);
  const [dailyEmpModalOpen, setDailyEmpModalOpen] = useState(false);
  const [dailyEmpModalData, setDailyEmpModalData] = useState<{eg: EmployeeGoal, originalEgs: EmployeeGoal[], period: GoalPeriodDoc, userName: string} | null>(null);
  const [syncingPeriodId, setSyncingPeriodId] = useState<string | null>(null);

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
    const periodLabel = formatGoalPeriodLabel(period, template?.period ?? 'monthly');
    
    setAiParams({
      kioskName,
      period: periodLabel,
      goalType: template?.type || 'revenue'
    });
    setAiModalOpen(true);
    setIsAiLoading(true);
    setAiResult(null);

    try {
      const data = {
        kioskName,
        periodMonth: periodLabel,
        goalType: template?.type || 'revenue',
        targetValue: period.targetValue,
        upValue: period.upValue,
        topValue: period.topValue ?? 0,
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

  async function handleRebalancePeriod(period: GoalPeriodDoc) {
    if (period.version === 2) {
      toast({ title: 'Meta sem divisão por turno', description: 'Metas novas usam colaboradores por período. Os turnos são apenas informativos.' });
      return;
    }
    const periodEmployeeGoals = employeeGoals.filter(goal => goal.periodId === period.id);
    await rebalancePeriodEmployeeGoals(
      period,
      periodEmployeeGoals,
      { [period.kioskId]: getKioskName(period.kioskId) }
    );
    toast({ title: 'Metas recalculadas pela escala.' });
  }

  async function handleSyncPeriodMonth(period: GoalPeriodDoc) {
    const start = dateKey(period.startDate?.toDate?.() ?? new Date());
    const end = dateKey(period.endDate?.toDate?.() ?? new Date());
    const kiosk = kiosks.find(item => item.id === period.kioskId);

    setSyncingPeriodId(period.id);

    try {
      const fn = httpsCallable(functions, 'syncGoalsForRange');
      const payload: Record<string, string> = { kioskId: period.kioskId, startDate: start, endDate: end };
      if (kiosk?.pdvFilialId) payload.pdvFilialId = String(kiosk.pdvFilialId);
      const result = await fn(payload) as { data: { results: { date: string; revenue?: number; error?: string }[] } };
      const errors = result.data.results.filter(item => item.error).length;

      toast({
        title: 'Mês sincronizado',
        description: `${result.data.results.length} dias processados${errors ? `, ${errors} com erro` : ''}.`,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Falha ao sincronizar mês.';
      toast({ title: 'Erro ao sincronizar mês', description: message, variant: 'destructive' });
    } finally {
      setSyncingPeriodId(null);
    }
  }

  const activePeriods = useMemo(() =>
    periods.filter(p => {
      if (p.status !== 'active') return false;
      if (selectedKioskId !== 'all' && p.kioskId !== selectedKioskId) return false;
      return Boolean(user) && canAccessUnit(user!, p.kioskId, { isDefaultAdmin });
    }),
    [isDefaultAdmin, periods, selectedKioskId, user]
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (activePeriods.length === 0 || employeeGoals.length === 0) {
        setDistributionSnapshot({
          periodDateKeysById: {},
          employeeDateKeysByGoalId: {},
          goalIdsByPeriodShiftAndDate: {},
          workedDaysByKioskAndUser: {},
          shiftLabelByKioskUserAndDate: {},
        });
        return;
      }

      setDistributionSnapshot(null);
      try {
        const kioskNameById = Object.fromEntries(kiosks.map(k => [k.id, k.name]));
        const snapshot = await loadGoalDistributionSnapshot(activePeriods, employeeGoals, kioskNameById);
        if (!cancelled) {
          setDistributionSnapshot(snapshot);
        }
      } catch (error) {
        console.warn('[GoalsTrackingDashboard] failed to load distribution snapshot', error);
        if (!cancelled) {
          setDistributionSnapshot(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activePeriods, employeeGoals, kiosks]);

  // Agrupa períodos por quiosque + granularidade + intervalo para exibir em um único card
  const periodGroups = useMemo(() => {
    const map = new Map<string, { groupKey: string; kioskId: string; monthLabel: string; periodKind: GoalPeriod; periods: GoalPeriodDoc[] }>();
    activePeriods.forEach(p => {
      const start = p.startDate?.toDate?.() ?? new Date();
      const end = p.endDate?.toDate?.() ?? start;
      const templatePeriod = templates.find(template => template.id === p.templateId)?.period ?? 'monthly';
      const groupKey = `${p.kioskId}__${templatePeriod}__${dateKey(start)}__${dateKey(end)}`;
      if (!map.has(groupKey)) {
        map.set(groupKey, {
          groupKey,
          kioskId: p.kioskId,
          monthLabel: formatGoalPeriodLabel(p, templatePeriod),
          periodKind: templatePeriod,
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

  const globalRevenueStats = useMemo(() => {
    const mainPeriods = periodGroups.map(g => {
      const revPeriods = g.periods.filter(p => templates.find(t => t.id === p.templateId)?.type === 'revenue');
      return revPeriods[0] ?? null;
    }).filter((p): p is GoalPeriodDoc => p !== null);

    const totalAcumulado = mainPeriods.reduce((s, p) => s + p.currentValue, 0);
    const totalTarget = mainPeriods.reduce((s, p) => s + p.targetValue, 0);
    const avgAting = totalTarget > 0 ? (totalAcumulado / totalTarget) * 100 : 0;
    const totalProjection = mainPeriods.reduce((s, p) => {
      const stats = calcMonthlyStats(p, distributionSnapshot);
      return s + stats.projection;
    }, 0);

    return { totalAcumulado, totalTarget, avgAting, totalProjection, activeCount: periodGroups.length };
  }, [periodGroups, templates, distributionSnapshot]);

  const availableKiosks = useMemo(
    () => user ? kiosks.filter((kiosk) => canAccessUnit(user, kiosk.id, { isDefaultAdmin })) : [],
    [isDefaultAdmin, kiosks, user]
  );

  const [openCards, setOpenCards] = useState<Record<string, boolean>>({});
  const isCardOpen = (id: string) => openCards[id] !== false; // default: open

  if (loading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-8 pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 px-1">
        <div>
          <h1 className="text-[2.15rem] font-bold tracking-[-0.04em] text-zinc-900">Metas de Faturamento</h1>
          <p className="text-sm text-zinc-500">Acompanhamento em tempo real de performance e projeções.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedKioskId} onValueChange={setSelectedKioskId}>
            <SelectTrigger className="h-10 w-[230px] rounded-full bg-white">
              <Store className="mr-2 h-4 w-4 text-zinc-400" />
              <SelectValue placeholder="Unidade" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as unidades</SelectItem>
              {availableKiosks.map(kiosk => (
                <SelectItem key={kiosk.id} value={kiosk.id}>{kiosk.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isManager && (
            <Button size="sm" onClick={() => setNewMetaOpen(true)} className="h-10 rounded-full bg-primary px-5 hover:bg-primary/90">
              <Plus className="mr-2 h-4 w-4" /> Nova Meta
            </Button>
          )}
        </div>
      </div>

      {periodGroups.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-1">
          <div className="rounded-[18px] border border-[#cfd9e6] bg-[#eef3f9] px-4 py-3">
            <p className="text-[9px] font-black uppercase tracking-[0.18em] text-zinc-500">Total Acumulado</p>
            <p className="mt-1 text-lg font-black tabular-nums text-zinc-900">R$ {fmt(globalRevenueStats.totalAcumulado)}</p>
          </div>
          <div className="rounded-[18px] border border-[#cfd9e6] bg-[#eef3f9] px-4 py-3">
            <p className="text-[9px] font-black uppercase tracking-[0.18em] text-zinc-500">Atingimento Médio</p>
            <p className={`mt-1 text-lg font-black tabular-nums ${globalRevenueStats.avgAting >= 100 ? 'text-emerald-600' : 'text-amber-500'}`}>
              {globalRevenueStats.avgAting.toFixed(1)}%
            </p>
          </div>
          <div className="rounded-[18px] border border-[#cfd9e6] bg-[#eef3f9] px-4 py-3">
            <p className="text-[9px] font-black uppercase tracking-[0.18em] text-zinc-500">Unidades Ativas</p>
            <p className="mt-1 text-lg font-black tabular-nums text-zinc-900">{globalRevenueStats.activeCount}</p>
          </div>
          <div className="rounded-[18px] border border-[#cfd9e6] bg-[#eef3f9] px-4 py-3">
            <p className="text-[9px] font-black uppercase tracking-[0.18em] text-zinc-500">Projeção Total</p>
            <p className={`mt-1 text-lg font-black tabular-nums ${globalRevenueStats.totalProjection >= globalRevenueStats.totalTarget ? 'text-emerald-600' : 'text-rose-500'}`}>
              R$ {fmt(globalRevenueStats.totalProjection)}
            </p>
          </div>
        </div>
      )}

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
            <Card className="overflow-hidden rounded-[24px] border border-[#cfd9e6] bg-[#eef3f9] shadow-[0_28px_70px_-52px_rgba(15,23,42,0.45)] transition-all">
              <CollapsibleTrigger asChild>
                <div className="flex cursor-pointer items-center gap-4 px-6 py-5 transition-colors hover:bg-white/25">
                  <div className="rounded-full bg-primary/10 p-2.5 shrink-0">
                    <Target className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-[1.08rem] font-bold tracking-[-0.03em] text-zinc-900 truncate">{kioskName}</h2>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="outline" className="h-5 rounded-full bg-white/80 px-2 text-[9px] font-black uppercase tracking-[0.12em] text-zinc-500">
                        {goalPeriodKindLabel(group.periodKind)}
                      </Badge>
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">{group.monthLabel}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-center shrink-0">
                    <span className={`text-[1.55rem] font-black leading-none ${pctPrincipal >= 100 ? 'text-emerald-500' : 'text-amber-500'}`}>
                      {pctPrincipal.toFixed(1)}%
                    </span>
                    <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-zinc-400 mt-0.5">da meta</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); setSummaryGroup(group); setKioskSummaryOpen(true); }}
                      className="h-9 rounded-full border-blue-500/25 bg-white px-3 text-xs font-bold text-blue-600 hover:bg-blue-50 hover:text-blue-700"
                    >
                      <BarChart2 className="mr-1.5 h-3.5 w-3.5" /> Situação Geral
                    </Button>
                    {isManager && mainPeriod && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(event) => event.stopPropagation()}
                            className="h-9 rounded-full border-zinc-200 bg-white px-3 text-xs font-bold text-zinc-700 hover:bg-zinc-50"
                          >
                            <Menu className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                           <DropdownMenuItem onClick={() => { setEmployeeGoalPeriod(mainPeriod); setEmployeeGoalOpen(true); }}>
                             <Plus className="mr-2 h-4 w-4" /> Vincular Colaborador
                           </DropdownMenuItem>
                           <DropdownMenuSeparator />
                           <DropdownMenuItem onClick={() => { setEditPeriod(mainPeriod); setEditOpen(true); }}>
                             <Pencil className="mr-2 h-4 w-4" /> Editar Meta
                           </DropdownMenuItem>
                           <DropdownMenuItem
                             disabled={syncingPeriodId === mainPeriod.id}
                             onClick={() => handleSyncPeriodMonth(mainPeriod)}
                           >
                             <RefreshCw className={`mr-2 h-4 w-4 ${syncingPeriodId === mainPeriod.id ? 'animate-spin' : ''}`} />
                             {syncingPeriodId === mainPeriod.id ? 'Sincronizando mês...' : 'Sincronizar mês'}
                           </DropdownMenuItem>
                           <DropdownMenuItem onClick={() => handleRebalancePeriod(mainPeriod)}>
                             <RefreshCw className="mr-2 h-4 w-4" /> Recalcular pela escala
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
                           {process.env.NODE_ENV === 'development' && (
                             <>
                               <DropdownMenuSeparator />
                               {group.periods.map(p => {
                                 const template = templates.find(t => t.id === p.templateId);
                                 return (
                                   <DropdownMenuItem key={p.id} onClick={() => handleAnalyzeWithAi(p)} className="text-primary font-medium">
                                     <Sparkles className="mr-2 h-4 w-4" /> Analisar {getTypeStyle(template?.type).label} com IA
                                   </DropdownMenuItem>
                                 );
                               })}
                             </>
                           )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    <div className={`rounded-full bg-white/80 p-1.5 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}>
                      <ChevronDown className="h-5 w-5 text-zinc-500" />
                    </div>
                  </div>
                </div>
              </CollapsibleTrigger>

              <CollapsibleContent>
                <div className="space-y-8 border-t border-white/70 px-6 pb-7 pt-3 animate-in fade-in slide-in-from-top-2 duration-300">
                  {/* ── Resumo do Período ── */}
                  <div className="space-y-4">
                    <h3 className="px-1 text-[10px] font-black uppercase tracking-[0.32em] text-zinc-500">Visão Geral</h3>
                    <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                       {revenuePeriods.map(period => {
                         const stats = calcMonthlyStats(period, distributionSnapshot);
                         const { refDate, periodEnd } = getPeriodContext(period);
                         const weekly = calcWeeklyStats(period, refDate, periodEnd, distributionSnapshot);
                         const todayValue = period.dailyProgress?.[dateKey(refDate)] ?? 0;
                         const dailyTarget = stats.alvo / Math.max(stats.totalDays, 1);
                         const dailyUp = stats.up / Math.max(stats.totalDays, 1);
                         const dailyTop = stats.top ? stats.top / Math.max(stats.totalDays, 1) : null;
                         const monthlyActiveTone = getActiveTierTone(stats.value, stats.alvo, stats.up, stats.top);
                         const activeTierLabel = tierLabelByTone(monthlyActiveTone);
                         const activeMonthTarget = tierAmountByTone(monthlyActiveTone, stats.alvo, stats.up, stats.top);
                         const activeWeeklyTarget = tierAmountByTone(monthlyActiveTone, weekly.alvo, weekly.up, weekly.top);
                         const activeDailyTarget = tierAmountByTone(monthlyActiveTone, dailyTarget, dailyUp, dailyTop);
                         const remainingForActiveTier = Math.max(activeMonthTarget - stats.value, 0);
                         const neededDailyForActiveTier = stats.remainingDays > 0 ? remainingForActiveTier / stats.remainingDays : 0;
                         const hasActiveTierRemaining = remainingForActiveTier > 0.005;
                         const paceTrendPct = neededDailyForActiveTier > 0
                           ? pct(Math.abs(stats.currentPace - neededDailyForActiveTier), neededDailyForActiveTier).toFixed(0)
                           : '0';
                         const currentPeriodStart = period.startDate?.toDate?.() ?? new Date();
                         const monthlyComparisonRows = periods
                           .filter(candidate => {
                             const template = templates.find(item => item.id === candidate.templateId);
                             const candidateStart = candidate.startDate?.toDate?.() ?? new Date(0);
                             return candidate.kioskId === period.kioskId
                               && template?.type === 'revenue'
                               && (template.period ?? 'monthly') === 'monthly'
                               && candidateStart <= currentPeriodStart;
                           })
                           .sort((a, b) => {
                             const aStart = a.startDate?.toDate?.();
                             const bStart = b.startDate?.toDate?.();
                             return (aStart instanceof Date ? aStart.getTime() : 0) - (bStart instanceof Date ? bStart.getTime() : 0);
                           })
                           .slice(-4)
                           .map(candidate => {
                             const start = candidate.startDate?.toDate?.() ?? new Date();
                             return {
                               label: candidate.id === period.id ? 'Atual' : format(start, 'MMM/yy', { locale: ptBR }),
                               value: candidate.currentValue,
                               target: candidate.targetValue,
                               up: candidate.upValue,
                               top: candidate.topValue,
                               current: candidate.id === period.id,
                             };
                           });
                         const openMonthlyDetail = () => {
                           setDailyModalPeriod(period);
                           setDailyModalScope('monthly');
                           setDailyModalMonthlyComparisonRows(monthlyComparisonRows);
                           setDailyModalOpen(true);
                         };
                         return (
                           <React.Fragment key={period.id}>
                             <button
                               type="button"
                               onClick={openMonthlyDetail}
                               className="rounded-[22px] border border-white/80 bg-white px-5 py-5 text-left shadow-[0_18px_50px_-44px_rgba(15,23,42,0.45)] transition-shadow hover:shadow-[0_18px_50px_-38px_rgba(15,23,42,0.65)] md:col-span-2"
                             >
                               <div className="flex items-end justify-between gap-3">
                                 <div className="min-w-0">
                                   <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Acumulado</span>
                                   <p className="text-2xl font-bold tabular-nums">R$ {fmt(stats.value)}</p>
                                 </div>
                                 <span className="mb-2 shrink-0 text-lg font-black text-zinc-300">→</span>
                                 <div className="min-w-0 text-right">
                                   <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Projeção</span>
                                   <p className={`text-2xl font-bold tabular-nums ${stats.projection >= stats.alvo ? 'text-emerald-600' : ''}`}>R$ {fmt(stats.projection)}</p>
                                 </div>
                               </div>
                               <div className="mt-4">
                                 <GoalTierDualProgress current={stats.value} projection={stats.projection} target={stats.alvo} up={stats.up} top={stats.top} />
                               </div>
                               <div className="mt-3 flex items-center justify-end text-[10px] font-bold text-primary">
                                 Ver detalhamento mensal →
                               </div>
                             </button>
                             <div className="flex flex-col gap-5">
                               <div className="rounded-[22px] border border-white/80 bg-white px-5 py-5 shadow-[0_18px_50px_-44px_rgba(15,23,42,0.45)]">
                                 <StatItem
                                   title="Ritmo Atual"
                                   value={fmt(stats.currentPace)}
                                   valueSuffix="/dia"
                                   subLabel={(
                                     <span className="rounded-full border border-zinc-100 bg-zinc-50 px-2 py-0.5 text-[10px] font-black text-zinc-500">
                                       {hasActiveTierRemaining
                                         ? `Necessário p/ ${activeTierLabel} R$ ${fmt(neededDailyForActiveTier)}/dia`
                                         : `${activeTierLabel} batida`}
                                     </span>
                                   )}
                                   trend={hasActiveTierRemaining ? (stats.currentPace >= neededDailyForActiveTier ? `+${paceTrendPct}%` : `-${paceTrendPct}%`) : 'batida'}
                                   trendColor={!hasActiveTierRemaining || stats.currentPace >= neededDailyForActiveTier ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-500'}
                                   trendLabel={hasActiveTierRemaining ? `vs. ${activeTierLabel}` : undefined}
                                 />
                               </div>
                               <PeriodGoalCard
                                 label="Meta da semana"
                                 value={weekly.value}
                                 target={activeWeeklyTarget}
                                 showTiers={false}
                                 focusTone={monthlyActiveTone}
                                 onClick={() => {
                                   setDailyModalPeriod(period);
                                   setDailyModalScope('weekly');
                                   setDailyModalMonthlyComparisonRows(null);
                                   setDailyModalOpen(true);
                                 }}
                               />
                               <PeriodGoalCard
                                 label="Meta do dia"
                                 value={todayValue}
                                 target={activeDailyTarget}
                                 showTiers={false}
                                 focusTone={monthlyActiveTone}
                                 onClick={() => {
                                   setDailyModalPeriod(period);
                                   setDailyModalScope('daily');
                                   setDailyModalMonthlyComparisonRows(null);
                                   setDailyModalOpen(true);
                                 }}
                               />
                             </div>
                           </React.Fragment>
                         );
                       })}
                    </div>
                  </div>

                  {/* ── Bonificação, ranking e faturamento ── */}
                  {revenuePeriods.map(period => {
                    const stats = calcMonthlyStats(period, distributionSnapshot);
                    const { refDate, periodEnd } = getPeriodContext(period);
                    const periodEgs = employeeGoals.filter(goal => goal.periodId === period.id);
                    const collaboratorIds = Array.from(new Set(periodEgs.map(goal => goal.employeeId)));
                    const roleByCollaborator = new Map(collaboratorIds.map(id => {
                      const goals = periodEgs.filter(goal => goal.employeeId === id);
                      const roleKey = goals.some(goal => goal.participantRole === 'leader')
                        ? 'leader'
                        : goals.some(goal => goal.participantRole === 'relief')
                          ? 'relief'
                          : 'fixed';
                      return [id, roleKey] as const;
                    }));
                    const bonusParticipantIds = collaboratorIds.filter(id => roleByCollaborator.get(id) !== 'leader');
                    const fixedParticipantIds = bonusParticipantIds.filter(id => roleByCollaborator.get(id) !== 'relief');
                    const reliefParticipantIds = bonusParticipantIds.filter(id => roleByCollaborator.get(id) === 'relief');
                    const methodTurnsPerDay = period.goalMethodSnapshot?.teamBonus.reliefWorker?.turnsPerDay;
                    const periodShiftCount = Math.max(methodTurnsPerDay ?? period.shifts?.length ?? 1, 1);
                    const periodDateCount = Math.max(getPeriodDistributionDateKeys(period, distributionSnapshot).length || stats.totalDays, 1);
                    const totalPeriodTurns = periodDateCount * periodShiftCount;
                    const reliefCoveredTurnsByPerson = reliefParticipantIds.map(id =>
                      periodEgs
                        .filter(goal => goal.employeeId === id)
                        .reduce((sum, goal) => sum + (goal.scheduledTurnCount ?? 0), 0)
                    );
                    const bonusPreview = calculateTieredGoalBonus(
                      period.goalMethodSnapshot,
                      stats.value,
                      bonusParticipantIds.length,
                      {
                        fixedCollaboratorCount: fixedParticipantIds.length,
                        reliefWorkerCount: reliefParticipantIds.length,
                        reliefWorkerCoveredTurnsByPerson: reliefCoveredTurnsByPerson,
                        totalPeriodTurns,
                      }
                    );
                    const reliefBonusById = new Map(reliefParticipantIds.map((id, index) => [
                      id,
                      bonusPreview?.reliefWorkerSplit?.reliefWorkerBonuses[index] ?? bonusPreview?.perCollaboratorBonus ?? 0,
                    ]));
                    const participantRows = collaboratorIds.map(id => {
                      const goals = periodEgs.filter(goal => goal.employeeId === id);
                      const currentValue = goals.reduce((sum, goal) => sum + (goal.currentValue ?? 0), 0);
                      const roleKey = roleByCollaborator.get(id) ?? 'fixed';
                      const roleLabel = roleKey === 'leader' ? 'Liderança' : roleKey === 'relief' ? 'Folguista' : 'Colaborador';
                      const coveredTurns = goals.reduce((sum, goal) => sum + (goal.scheduledTurnCount ?? 0), 0);
                      const prize = !bonusPreview
                        ? 0
                        : roleKey === 'leader'
                          ? bonusPreview.leadershipBonus
                          : roleKey === 'relief'
                            ? reliefBonusById.get(id) ?? bonusPreview.perCollaboratorBonus
                            : bonusPreview.reliefWorkerSplit?.perFixedCollaboratorBonus ?? bonusPreview.perCollaboratorBonus;
                      return {
                        id,
                        name: getUserName(id),
                        jobLabel: getUserJobLabel(id),
                        currentValue,
                        share: pct(currentValue, stats.value),
                        roleKey,
                        roleLabel,
                        coveredTurns,
                        prize,
                      };
                    });
                    const rankingRows = [...participantRows].sort((a, b) => b.currentValue - a.currentValue);
                    const totalPrize = bonusPreview
                      ? bonusPreview.totalTeamBonus + bonusPreview.leadershipBonus
                      : 0;

                    return (
                      <div key={period.id} className="space-y-8">
                        <Card className="relative overflow-hidden rounded-[24px] border border-white/80 bg-white p-7 shadow-[0_20px_60px_-46px_rgba(15,23,42,0.45)]">
                          {(bonusPreview || rankingRows.length > 0) && (
                            <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(360px,0.85fr)]">
                              {bonusPreview && (
                                <div className="rounded-[18px] border border-emerald-100 bg-emerald-50 px-4 py-3">
                                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                    <div className="min-w-0">
                                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-700">Bonificação estimada</p>
                                      <p className="truncate text-sm font-semibold text-emerald-900">{period.goalMethodSnapshot?.name}</p>
                                    </div>
                                    <div className="shrink-0 rounded-[12px] bg-white/80 px-4 py-2 text-right">
                                      <p className="text-[11px] font-semibold text-emerald-700/75">Bonificação total</p>
                                      <p className="text-lg font-black text-emerald-900">R$ {formatCurrencyBRL(totalPrize)}</p>
                                    </div>
                                  </div>

                                  {participantRows.length > 0 && (
                                    <div className="mt-3 overflow-x-auto rounded-[12px] bg-white/70">
                                      <div className="grid min-w-[520px] grid-cols-[minmax(170px,1.35fr)_minmax(140px,1fr)_110px] gap-3 border-b border-emerald-100 px-3 py-2 text-[9px] font-black uppercase tracking-[0.14em] text-emerald-700/80">
                                        <span>Colaborador</span>
                                        <span>Cargo/função</span>
                                        <span className="text-right">Bonificação</span>
                                      </div>
                                      {participantRows.map(row => (
                                        <details key={row.id} className="group border-b border-emerald-50 last:border-b-0">
                                          <summary className="grid min-w-[520px] cursor-pointer list-none grid-cols-[minmax(170px,1.35fr)_minmax(140px,1fr)_110px] items-center gap-3 px-3 py-2 text-xs marker:hidden hover:bg-emerald-50/60">
                                            <span className="flex min-w-0 items-center gap-2">
                                              <span className="truncate font-bold text-emerald-950">{row.name}</span>
                                              {row.roleKey !== 'fixed' ? (
                                                <Badge
                                                  variant="outline"
                                                  className={`shrink-0 rounded-full text-[9px] font-bold ${
                                                    row.roleKey === 'leader'
                                                      ? 'border-violet-200 bg-violet-50 text-violet-700'
                                                      : 'border-blue-200 bg-blue-50 text-blue-700'
                                                  }`}
                                                >
                                                  {row.roleLabel}
                                                </Badge>
                                              ) : null}
                                            </span>
                                            <span className="min-w-0 truncate font-semibold text-emerald-800">{row.jobLabel}</span>
                                            <span className="text-right font-black tabular-nums text-emerald-950">R$ {formatCurrencyBRL(row.prize)}</span>
                                          </summary>
                                          <BonusCalculationDetails
                                            row={row}
                                            preview={bonusPreview}
                                            totalPeriodTurns={totalPeriodTurns}
                                            fixedCollaboratorCount={fixedParticipantIds.length}
                                            eligibleCollaboratorCount={bonusParticipantIds.length}
                                            revenue={stats.value}
                                            period={period}
                                          />
                                        </details>
                                      ))}
                                    </div>
                                  )}
                                  {bonusPreview.incentiveMessage && (
                                    <div className="mt-3 rounded-[12px] bg-white/75 px-3 py-2 text-xs font-semibold text-emerald-800">
                                      {bonusPreview.incentiveMessage.message.replace('Prêmio', 'Bonificação').replace('prêmio', 'bonificação')}
                                    </div>
                                  )}
                                </div>
                              )}

                              {rankingRows.length > 0 && (
                                <div className="rounded-[18px] border border-zinc-100 bg-white px-4 py-3">
                                  <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                                    <div>
                                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">Ranking de contribuição</p>
                                      <h3 className="mt-0.5 text-base font-black tracking-[-0.03em] text-zinc-900">Gamificação do quiosque</h3>
                                    </div>
                                    <p className="max-w-[250px] text-[11px] font-semibold leading-snug text-zinc-400 sm:text-right">
                                      Ordem por faturamento no período da meta. Uso visual e motivacional.
                                    </p>
                                  </div>
                                  <div className="mt-3 overflow-x-auto rounded-[12px] border border-zinc-100">
                                    <div className="grid min-w-[620px] grid-cols-[54px_minmax(150px,1.25fr)_minmax(120px,0.9fr)_110px_70px] gap-3 bg-zinc-50 px-3 py-2 text-[9px] font-black uppercase tracking-[0.14em] text-zinc-400">
                                      <span>Rank</span>
                                      <span>Colaborador</span>
                                      <span>Cargo/função</span>
                                      <span className="text-right">Faturamento</span>
                                      <span className="text-right">Part.</span>
                                    </div>
                                    {rankingRows.map((row, index) => (
                                      <div key={row.id} className="grid min-w-[620px] grid-cols-[54px_minmax(150px,1.25fr)_minmax(120px,0.9fr)_110px_70px] items-center gap-3 border-t border-zinc-100 px-3 py-2.5 text-xs">
                                        <span className="w-fit rounded-full border border-pink-100 bg-pink-50 px-2 py-0.5 text-[10px] font-black text-pink-600">
                                          #{index + 1}
                                        </span>
                                        <span className="flex min-w-0 items-center gap-2">
                                          <span className="truncate font-black text-zinc-900">{row.name}</span>
                                          {row.roleKey !== 'fixed' ? (
                                            <Badge
                                              variant="outline"
                                              className={`shrink-0 rounded-full text-[9px] font-bold ${
                                                row.roleKey === 'leader'
                                                  ? 'border-violet-200 bg-violet-50 text-violet-700'
                                                  : 'border-blue-200 bg-blue-50 text-blue-700'
                                              }`}
                                            >
                                              {row.roleLabel}
                                            </Badge>
                                          ) : null}
                                        </span>
                                        <span className="min-w-0 truncate font-semibold text-zinc-500">{row.jobLabel}</span>
                                        <span className="text-right font-black tabular-nums text-zinc-900">R$ {fmt(row.currentValue)}</span>
                                        <span className="text-right font-black tabular-nums text-blue-600">{row.share.toFixed(1)}%</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          <SalesByHourPanel period={period} salesReports={salesReports} />
                        </Card>

                        {/* ── Por Colaborador ── */}
                        <div className="space-y-4">
                          <div className="px-1">
                            <h3 className="text-[10px] font-black uppercase tracking-[0.32em] text-zinc-500">Resultado por colaborador</h3>
                            <p className="mt-1 text-xs font-semibold text-zinc-400">
                              Acompanhamento individual de faturamento, participação no geral e dias trabalhados.
                            </p>
                          </div>
                          {(() => {
                            const periodEgs = employeeGoals.filter(eg => eg.periodId === period.id);
                            if (periodEgs.length === 0) {
                              return (
                                <div className="rounded-[18px] border border-dashed border-[#cfd9e6] bg-[#f8fafc] px-5 py-8 text-center">
                                  <p className="text-sm font-medium text-zinc-500">Sem meta cadastrada para este período</p>
                                  {isManager && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => { setEmployeeGoalPeriod(period); setEmployeeGoalOpen(true); }}
                                      className="mt-3 h-8 rounded-full px-4 text-xs font-bold"
                                    >
                                      <Plus className="mr-1.5 h-3 w-3" /> Cadastrar meta
                                    </Button>
                                  )}
                                </div>
                              );
                            }
                            // Agrupar por employeeId e mesclar goals
                            const byEmployee = new Map<string, EmployeeGoal[]>();
                            for (const eg of periodEgs) {
                              const arr = byEmployee.get(eg.employeeId) ?? [];
                              arr.push(eg);
                              byEmployee.set(eg.employeeId, arr);
                            }
                            const merged = Array.from(byEmployee.entries()).map(([empId, goals]) => {
                              const mergedDp: Record<string, number> = {};
                              for (const g of goals) {
                                for (const [k, v] of Object.entries(g.dailyProgress ?? {})) {
                                  mergedDp[k] = (mergedDp[k] ?? 0) + v;
                                }
                              }
                              const mergedGoal: EmployeeGoal = {
                                ...goals[0],
                                currentValue: goals.reduce((s, g) => s + g.currentValue, 0),
                                targetValue: goals.reduce((s, g) => s + g.targetValue, 0),
                                dailyProgress: mergedDp,
                                shiftId: undefined,
                              };
                              const shiftLabels = goals
                                .map(g => g.shiftId ? period.shifts?.find(s => s.id === g.shiftId)?.label : null)
                                .filter((l): l is string => Boolean(l));
                              return { empId, mergedGoal, shiftLabels, originalGoals: goals };
                            });
                            merged.sort((a, b) => b.mergedGoal.currentValue - a.mergedGoal.currentValue);
                            return (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {merged.map(({ empId, mergedGoal, shiftLabels, originalGoals }) => (
                                  <CollaboratorCard
                                    key={empId}
                                    eg={mergedGoal}
                                    period={period}
                                    userName={getUserName(empId)}
                                    shiftLabel={shiftLabels.join(' · ') || undefined}
                                    estimatedBonus={bonusPreview?.perCollaboratorBonus ?? null}
                                    refDate={refDate}
                                    periodEnd={periodEnd}
                                    distributionSnapshot={distributionSnapshot}
                                    originalEgs={originalGoals}
                                    onOpenDaily={() => {
                                      setDailyEmpModalData({ eg: mergedGoal, originalEgs: originalGoals, period, userName: getUserName(empId) });
                                      setDailyEmpModalOpen(true);
                                    }}
                                  />
                                ))}
                              </div>
                            );
                          })()}
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
                          const { value, alvo } = calcMonthlyStats(period, distributionSnapshot);
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
        distributionSnapshot={distributionSnapshot}
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
        title={getDetailScopeLabel(dailyModalScope)}
        scope={dailyModalScope}
        monthlyComparisonRows={dailyModalMonthlyComparisonRows}
        activeDateKeys={dailyModalPeriod ? getPeriodDistributionDateKeys(dailyModalPeriod, distributionSnapshot) : null}
      />
      <EmployeeDailyModal
        open={dailyEmpModalOpen}
        onOpenChange={setDailyEmpModalOpen}
        employeeGoal={dailyEmpModalData?.eg ?? null}
        originalEgs={dailyEmpModalData?.originalEgs}
        period={dailyEmpModalData?.period ?? null}
        userName={dailyEmpModalData?.userName}
        distributionSnapshot={distributionSnapshot}
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
