"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHero } from "@/components/patterns/page-hero";
import { HeroChip } from "@/components/patterns/hero-chip";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  AlertTriangle,
  Bell,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  Flag,
  FolderOpen,
  Inbox,
  ListOrdered,
  Loader2,
  MapPin,
  Minus,
  MoreHorizontal,
  Plus,
  UserRound,
} from "lucide-react";
import {
  eachDayOfInterval,
  endOfWeek,
  format,
  isSameDay,
  isWithinInterval,
  startOfWeek,
} from "date-fns";
import { ptBR } from "date-fns/locale";

import { fetchMyFormExecutions } from "@/features/forms/lib/client";
import { useAuth } from "@/hooks/use-auth";
import { ScheduledDarkTheme } from "@/components/theme/scheduled-dark-theme";
import { canOfferPunch, HeroPunchButton, HeroPunchRow } from "@/features/dp/rep-p/collaborator-punch";
import { fiscalClock } from "@/features/dp/rep-p/day-model";
import { nextMarkingOf, PURPOSE_DOT, purposeLabel, RecordDialog, recordActionLabel } from "@/features/dp/rep-p/record-strip";
import { useRepPMarking } from "@/features/dp/rep-p/use-rep-p-marking";
import { useTodayJourney } from "@/features/dp/rep-p/use-today-journey";
import { useAllTasks } from "@/hooks/use-all-tasks";
import { useReposition } from "@/hooks/use-reposition";
import { useToast } from "@/hooks/use-toast";
import { useStockAudit } from "@/hooks/use-stock-audit";
import { useKiosks } from "@/hooks/use-kiosks";
import { useDPStore } from "@/store/use-dp-store";
import type { DPShift, EmployeeGoal, GoalPeriodDoc, RepositionActivity, StockAuditItem, StockAuditSession } from "@/types";
import type { FormExecution } from "@/types/forms";
import {
  getEmployeeDistributionDateKeys,
  type GoalDistributionSnapshot,
} from "@/lib/goals-distribution";
import { calculateTieredGoalBonus, formatCurrencyBRL } from "@/lib/goal-methods";
import { canViewTechnicalSheets } from "@/lib/commercial-permissions";
import { resolveSafeReturnPath } from "@/lib/safe-return-path";
import { formatStockExpiryDate, getStockExpiryAlert, getStockExpirySummary, type StockExpiryAlertLevel } from "@/lib/stock-expiry-alert";
import { Segmented } from "@/components/patterns/segmented";
import { Badge } from "@/components/ui/badge";
import { StatusPill } from "@/components/ui/status-pill";
import {
  groupTimelineTasks,
  toTimelineTaskView,
  type TimelineTaskUrgency,
  type TimelineTaskView,
} from "@/features/tasks/lib/timeline-presentation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function dateKey(value: Date) {
  return format(value, "yyyy-MM-dd");
}

function asDate(value: unknown) {
  if (value && typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate();
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return new Date();
}

function money(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function percent(value: number, target: number) {
  if (target <= 0) return 0;
  return (value / target) * 100;
}

function compactUnique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0)));
}

function stockExpiryBadgeClass(level: StockExpiryAlertLevel) {
  switch (level) {
    case "expired":
    case "today":
    case "invalid":
      return "border-ds-divider bg-ds-danger-bg text-ds-danger";
    case "urgent":
      return "border-ds-divider bg-ds-warn-bg text-ds-warn";
    case "warning":
      return "border-ds-divider bg-ds-accent-soft text-ds-accent-ink";
    case "ok":
      return "border-ds-divider bg-ds-ok-bg text-ds-ok";
    case "none":
    default:
      return "border-ds-divider bg-ds-muted text-ds-ink-muted";
  }
}

function normalizeIdentity(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function canPreviewCollaboratorMockups(
  user: { username?: string | null; email?: string | null },
  firebaseUser: { displayName?: string | null; email?: string | null } | null | undefined
) {
  const username = normalizeIdentity(user.username ?? firebaseUser?.displayName);
  const email = normalizeIdentity(user.email ?? firebaseUser?.email);
  return (
    username === normalizeIdentity("Tiago Brasil") ||
    email === "administrativo@coalas.com" ||
    email === "administrativo@coalashakes.com"
  );
}

function mergeEmployeeGoals(goals: EmployeeGoal[]) {
  const byScope = new Map<string, EmployeeGoal & { originalGoals: EmployeeGoal[] }>();

  for (const goal of goals) {
    const key = `${goal.periodId}__${goal.kioskId}`;
    const existing = byScope.get(key);
    if (!existing) {
      byScope.set(key, {
        ...goal,
        id: key,
        dailyProgress: { ...(goal.dailyProgress ?? {}) },
        originalGoals: [goal],
      });
      continue;
    }

    const dailyProgress = { ...(existing.dailyProgress ?? {}) };
    for (const [day, value] of Object.entries(goal.dailyProgress ?? {})) {
      dailyProgress[day] = (dailyProgress[day] ?? 0) + value;
    }

    existing.targetValue += goal.targetValue;
    existing.currentValue += goal.currentValue;
    existing.dailyProgress = dailyProgress;
    existing.originalGoals.push(goal);
  }

  return Array.from(byScope.values());
}

function greetingFor(date: Date) {
  const hour = date.getHours();
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

function hhmmToMinutes(value: string | null | undefined) {
  if (!value) return null;
  const [h, m] = value.split(":").map((part) => Number.parseInt(part, 10));
  if (Number.isNaN(h)) return null;
  return h * 60 + (Number.isNaN(m) ? 0 : m);
}

const STATUS_LABELS: Record<FormExecution["status"], string> = {
  pending: "Pendente",
  in_progress: "Em andamento",
  completed: "Concluído",
  overdue: "Atrasado",
  canceled: "Cancelado",
};

const STATUS_TEXT: Record<FormExecution["status"], string> = {
  pending: "text-ds-warn",
  in_progress: "text-ds-info",
  completed: "text-ds-ok",
  overdue: "text-ds-danger",
  canceled: "text-ds-ink-muted",
};

const STATUS_DOT: Record<FormExecution["status"], string> = {
  pending: "bg-ds-warn",
  in_progress: "bg-ds-info",
  completed: "bg-ds-ok",
  overdue: "bg-ds-danger",
  canceled: "bg-ds-ink-faint",
};

function timeOf(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return format(date, "HH:mm");
}

function dayKeyOf(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return dateKey(date);
}

function itemCountOf(execution: FormExecution) {
  if (execution.sections_summary) {
    const total = Object.values(execution.sections_summary).reduce((acc, section) => acc + (section.total_items ?? 0), 0);
    if (total > 0) return total;
  }
  return execution.items?.length ?? 0;
}

function contextLabelOf(execution: FormExecution) {
  return execution.shift_definition_name ?? execution.unit_name ?? execution.unit_id;
}

function getMergedActiveDateKeys(goal: EmployeeGoal & { originalGoals?: EmployeeGoal[] }, period: GoalPeriodDoc, snapshot?: GoalDistributionSnapshot | null) {
  if (!goal.originalGoals?.length) {
    return getEmployeeDistributionDateKeys(goal, period, snapshot);
  }

  const keys = new Set<string>();
  goal.originalGoals.forEach((originalGoal) => {
    getEmployeeDistributionDateKeys(originalGoal, period, snapshot).forEach((key) => keys.add(key));
  });
  return Array.from(keys).sort();
}

function goalRecortes(goal: EmployeeGoal & { originalGoals?: EmployeeGoal[] }, period: GoalPeriodDoc, snapshot?: GoalDistributionSnapshot | null) {
  const periodStart = asDate(period.startDate);
  const periodEnd = asDate(period.endDate);
  const allDays = eachDayOfInterval({ start: periodStart, end: periodEnd });
  const activeKeys = new Set(getMergedActiveDateKeys(goal, period, snapshot));
  const days = allDays.filter((day) => activeKeys.has(dateKey(day)));
  const dailyTargets: Record<string, number> = {};

  if (goal.originalGoals?.length) {
    for (const originalGoal of goal.originalGoals) {
      const keys = getEmployeeDistributionDateKeys(originalGoal, period, snapshot);
      const targetPerDay = originalGoal.targetValue / Math.max(keys.length, 1);
      keys.forEach((key) => {
        dailyTargets[key] = (dailyTargets[key] ?? 0) + targetPerDay;
      });
    }
  } else {
    const targetPerDay = goal.targetValue / Math.max(days.length, 1);
    days.forEach((day) => {
      dailyTargets[dateKey(day)] = targetPerDay;
    });
  }

  const today = new Date();
  const todayKey = dateKey(today);
  const todayValue = goal.dailyProgress?.[todayKey] ?? 0;
  const todayTarget = dailyTargets[todayKey] ?? 0;

  const weekStart = startOfWeek(today, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(today, { weekStartsOn: 1 });
  const weekDays = days.filter((day) => isWithinInterval(day, { start: weekStart, end: weekEnd }));
  const weekTarget = weekDays.reduce((acc, day) => acc + (dailyTargets[dateKey(day)] ?? 0), 0);
  const weekValue = weekDays
    .filter((day) => day <= today)
    .reduce((acc, day) => acc + (goal.dailyProgress?.[dateKey(day)] ?? 0), 0);
  const averageDailyTarget = goal.targetValue / Math.max(days.length, 1);

  return {
    periodStart,
    periodEnd,
    days,
    dailyTarget: averageDailyTarget,
    dailyTargets,
    today: { value: todayValue, target: todayTarget, pct: percent(todayValue, todayTarget) },
    semana: { value: weekValue, target: weekTarget, pct: percent(weekValue, weekTarget) },
    mes: { value: goal.currentValue, target: goal.targetValue, pct: percent(goal.currentValue, goal.targetValue) },
  };
}

function activePeriodTier(period: GoalPeriodDoc) {
  const up = period.upValue && period.upValue > period.targetValue ? period.upValue : period.targetValue;
  const top = period.topValue && period.topValue > up ? period.topValue : null;

  if (period.currentValue < period.targetValue) {
    return { label: "Meta Alvo", amount: period.targetValue };
  }

  if (period.currentValue < up) {
    return { label: "Meta UP", amount: up };
  }

  if (top && period.currentValue < top) {
    return { label: "Meta TOP", amount: top };
  }

  return top ? { label: "Meta TOP", amount: top } : { label: "Meta UP", amount: up };
}

function teamGoalRecortes(period: GoalPeriodDoc) {
  const periodStart = asDate(period.startDate);
  const periodEnd = asDate(period.endDate);
  const allDays = eachDayOfInterval({ start: periodStart, end: periodEnd });
  const today = new Date();
  const activeTier = activePeriodTier(period);
  const targetPerDay = activeTier.amount / Math.max(allDays.length, 1);
  const todayKey = dateKey(today);
  const todayValue = period.dailyProgress?.[todayKey] ?? 0;

  const weekStart = startOfWeek(today, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(today, { weekStartsOn: 1 });
  const weekDays = allDays.filter((day) => isWithinInterval(day, { start: weekStart, end: weekEnd }));
  const weekValue = weekDays
    .filter((day) => day <= today)
    .reduce((acc, day) => acc + (period.dailyProgress?.[dateKey(day)] ?? 0), 0);

  return {
    tier: activeTier,
    today: { value: todayValue, target: targetPerDay, pct: percent(todayValue, targetPerDay) },
    semana: { value: weekValue, target: targetPerDay * weekDays.length, pct: percent(weekValue, targetPerDay * weekDays.length) },
    mes: { value: period.currentValue, target: activeTier.amount, pct: percent(period.currentValue, activeTier.amount) },
  };
}

function getPeriodDateKeys(period: GoalPeriodDoc) {
  const periodStart = asDate(period.startDate);
  const periodEnd = asDate(period.endDate);
  return eachDayOfInterval({ start: periodStart, end: periodEnd }).map(dateKey);
}

function getGoalRole(goal: EmployeeGoal & { originalGoals?: EmployeeGoal[] }) {
  const roles = goal.originalGoals?.map((item) => item.participantRole).filter(Boolean) ?? [];
  if (roles.includes("leader")) return "leader";
  if (roles.includes("relief")) return "relief";
  return goal.participantRole ?? "fixed";
}

function getGoalCoveredTurns(goal: EmployeeGoal & { originalGoals?: EmployeeGoal[] }) {
  if (goal.originalGoals?.length) {
    return goal.originalGoals.reduce((sum, item) => sum + (item.scheduledTurnCount ?? 0), 0);
  }
  return goal.scheduledTurnCount ?? 0;
}

function getGoalBonusContext(
  goal: EmployeeGoal & { originalGoals?: EmployeeGoal[] },
  period: GoalPeriodDoc,
  periodGoals: EmployeeGoal[]
) {
  const methodSnapshot = period.goalMethodSnapshot;
  if (!methodSnapshot) return null;

  const teamGoals = periodGoals.filter((item) => item.periodId === period.id && item.kioskId === goal.kioskId);
  const bonusParticipants = teamGoals.filter((item) => item.participantRole !== "leader");
  const fixedGoals = bonusParticipants.filter((item) => item.participantRole !== "relief");
  const reliefGoals = bonusParticipants.filter((item) => item.participantRole === "relief");
  const periodShiftCount = Math.max(period.shifts?.length ?? 1, 1);
  const totalPeriodTurns = getPeriodDateKeys(period).length * periodShiftCount;
  const preview = calculateTieredGoalBonus(
    methodSnapshot,
    period.currentValue ?? goal.currentValue,
    bonusParticipants.length,
    {
      fixedCollaboratorCount: fixedGoals.length,
      reliefWorkerCount: reliefGoals.length,
      reliefWorkerCoveredTurnsByPerson: reliefGoals.map((item) => item.scheduledTurnCount ?? 0),
      totalPeriodTurns,
    }
  );

  if (!preview) return null;

  const role = getGoalRole(goal);
  const ownCoveredTurns = getGoalCoveredTurns(goal);
  let individualBonus = preview.perCollaboratorBonus;
  let roleLabel = "Colaborador fixo";

  if (role === "leader") {
    individualBonus = preview.leadershipBonus;
    roleLabel = "Liderança";
  } else if (role === "relief") {
    roleLabel = "Folguista";
    if (preview.reliefWorkerSplit) {
      individualBonus = totalPeriodTurns > 0
        ? (ownCoveredTurns / totalPeriodTurns) * preview.totalTeamBonus
        : preview.reliefWorkerSplit.reliefWorkerBonus;
    }
  } else if (preview.reliefWorkerSplit) {
    individualBonus = preview.reliefWorkerSplit.perFixedCollaboratorBonus;
  }

  const roundedIndividualBonus = Math.round(individualBonus * 100) / 100;
  const rawMessage = preview.incentiveMessage?.message ?? null;
  const collaboratorMessage = rawMessage
    ? rawMessage
        .replace("por colaborador", "para você")
        .replace(`R$ ${formatCurrencyBRL(preview.perCollaboratorBonus)}`, `R$ ${formatCurrencyBRL(roundedIndividualBonus)}`)
    : null;

  return {
    preview,
    individualBonus: roundedIndividualBonus,
    role,
    roleLabel,
    collaboratorMessage,
  };
}

/* -------------------------------------------------------------------------- */
/* Live clock                                                                 */
/* -------------------------------------------------------------------------- */

function LiveClock({ onDark = false }: { onDark?: boolean }) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <span className={cn("inline-flex items-center gap-1.5 font-mono text-sm font-medium tabular-nums", onDark ? "text-ds-on-dark-2" : "text-ds-ink-muted")}>
      <Clock className="h-3.5 w-3.5" />
      {now ? format(now, "HH:mm") : "--:--"}
    </span>
  );
}


/* -------------------------------------------------------------------------- */
/* Timeline                                                                   */
/* -------------------------------------------------------------------------- */

const TYPE_BADGE = {
  form: { label: "Formulário", icon: FileText, className: "bg-ds-accent-soft text-ds-accent-ink" },
  task: { label: "Tarefa", icon: CheckSquare, className: "bg-ds-info-bg text-ds-info" },
  count: { label: "Contagem", icon: ListOrdered, className: "bg-ds-info-bg text-ds-info" },
  punch: { label: "Ponto", icon: Clock, className: "bg-ds-accent-soft text-ds-accent-ink" },
} as const;

function TimelineItem({
  type,
  time,
  timeOverdue,
  dot,
  statusLabel,
  statusClass,
  title,
  titleHref,
  meta,
  details,
  urgency,
  compact = false,
  completed,
  action,
  isLast,
}: {
  type: keyof typeof TYPE_BADGE;
  time: string;
  timeOverdue?: boolean;
  dot: string;
  statusLabel: string;
  statusClass: string;
  title: string;
  titleHref?: string;
  meta?: string;
  /** Substitui `meta` por um bloco estruturado (rota, itens). */
  details?: React.ReactNode;
  urgency?: TimelineTaskUrgency | null;
  compact?: boolean;
  completed?: boolean;
  action: React.ReactNode;
  isLast: boolean;
}) {
  const badge = TYPE_BADGE[type];
  const BadgeIcon = badge.icon;
  const [expanded, setExpanded] = useState(false);
  const body = details ?? (meta ? <p className="mt-0.5 text-xs text-ds-ink-muted">{meta}</p> : null);
  if (compact) {
    return (
      <div className="grid grid-cols-[52px_1fr] gap-3">
        <TimelineRail time={time} timeOverdue={timeOverdue} dot={dot} isLast={isLast} compact />
        <div className="rounded-ds-card border border-ds-border bg-ds-surface px-3 py-2 shadow-xs">
          <div className="flex items-center gap-2">
            <BadgeIcon className={`h-3.5 w-3.5 shrink-0 ${badge.className.split(" ").find((name) => name.startsWith("text-"))}`} aria-label={badge.label} />
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
              disabled={!body}
            >
              <span className={`truncate text-sm font-semibold ${completed ? "text-ds-ink-muted line-through" : ""}`}>{title}</span>
              {body ? <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-ds-ink-faint transition-transform ${expanded ? "rotate-180" : ""}`} /> : null}
            </button>
            {urgency ? <UrgencyPill urgency={urgency} /> : null}
            <div className="shrink-0">{action}</div>
          </div>
          {expanded && body ? <div className="pb-1 pl-5.5">{body}</div> : null}
        </div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[52px_1fr] gap-3">
      <TimelineRail time={time} timeOverdue={timeOverdue} dot={dot} isLast={isLast} />

      <div className="rounded-ds-card border border-ds-border bg-ds-surface p-4 shadow-xs">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${badge.className}`}>
                <BadgeIcon className="h-3 w-3" />
                {badge.label}
              </span>
              <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${statusClass}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
                {statusLabel}
              </span>
              {urgency ? <UrgencyPill urgency={urgency} /> : null}
            </div>
            {titleHref ? (
              <Link href={titleHref} className="group/title block">
                <h4 className={`mt-2 font-semibold underline-offset-2 group-hover/title:underline ${completed ? "text-ds-ink-muted line-through" : ""}`}>{title}</h4>
                {details ?? (meta ? <p className="mt-0.5 text-xs text-ds-ink-muted group-hover/title:text-ds-ink">{meta}</p> : null)}
              </Link>
            ) : (
              <>
                <h4 className={`mt-2 font-semibold ${completed ? "text-ds-ink-muted line-through" : ""}`}>{title}</h4>
                {body}
              </>
            )}
          </div>
          <div className="shrink-0">{action}</div>
        </div>
      </div>
    </div>
  );
}

function TimelineRail({ time, timeOverdue, dot, isLast, compact = false }: { time: string; timeOverdue?: boolean; dot: string; isLast: boolean; compact?: boolean }) {
  return (
    <div className={`relative flex flex-col items-end pr-1 ${compact ? "pt-2" : "pt-3.5"}`}>
      <span className={`font-mono text-xs tabular-nums ${timeOverdue ? "font-semibold text-ds-danger" : "text-ds-ink-muted"}`}>
        {time}
      </span>
      <span className={`absolute right-[-13px] ${compact ? "top-2.5" : "top-4"} h-2.5 w-2.5 rounded-full ring-4 ring-ds-page ${dot}`} />
      {!isLast ? <span className={`absolute right-[-8px] ${compact ? "top-5.5" : "top-7"} h-[calc(100%+0.75rem)] w-px bg-ds-divider`} /> : null}
    </div>
  );
}

const URGENCY_PILL = { overdue: "danger", today: "warn", soon: "info", later: "neutral" } as const;
// A bolinha segue a urgência: atrasada em vermelho, hoje em laranja, sem pressa em azul.
const URGENCY_DOT = { overdue: "bg-ds-danger", today: "bg-ds-warn", soon: "bg-ds-warn", later: "bg-ds-info" } as const;
const URGENCY_TEXT = { overdue: "text-ds-danger", today: "text-ds-warn", soon: "text-ds-warn", later: "text-ds-info" } as const;

function UrgencyPill({ urgency }: { urgency: TimelineTaskUrgency }) {
  return <StatusPill variant={URGENCY_PILL[urgency.level]}>{urgency.label}</StatusPill>;
}

function urgencyTone(urgency: TimelineTaskUrgency | null) {
  return urgency ? { dot: URGENCY_DOT[urgency.level], text: URGENCY_TEXT[urgency.level] } : { dot: "bg-ds-info", text: "text-ds-info" };
}

function TaskDetails({ view }: { view: TimelineTaskView }) {
  if (!view.route && view.items.length === 0 && !view.text) return null;
  return (
    <div className="mt-1.5 space-y-1.5">
      {view.route ? (
        <p className="flex flex-wrap items-center gap-1.5 text-sm text-ds-ink-2">
          <span className="font-medium">{view.route.origin}</span>
          <ArrowRight className="h-3.5 w-3.5 text-ds-accent-ink" aria-label="para" />
          <span className="font-semibold text-ds-ink">{view.route.destination}</span>
        </p>
      ) : null}
      {view.items.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5 text-xs">
          {view.items.map((item) => (
            <li key={item.name} className="rounded-md bg-ds-muted px-2 py-0.5 text-ds-ink-2">
              {item.name} <span className="font-mono font-semibold tabular-nums text-ds-ink">{item.quantity}</span>
            </li>
          ))}
          {view.hiddenItemCount > 0 ? (
            <li className="px-1 py-0.5 font-medium text-ds-ink-muted">+{view.hiddenItemCount} {view.hiddenItemCount === 1 ? "item" : "itens"}</li>
          ) : null}
        </ul>
      ) : null}
      {view.text ? <p className="line-clamp-2 text-xs text-ds-ink-muted">{view.text}</p> : null}
    </div>
  );
}

function TaskAction({ view }: { view: TimelineTaskView }) {
  return (
    <Button asChild size="sm" variant="outline">
      <Link href={resolveSafeReturnPath(view.action.href, "/dashboard/tasks")}>{view.action.label}</Link>
    </Button>
  );
}

function TaskTimelineEntry({ view, compact, isLast }: { view: TimelineTaskView; compact: boolean; isLast: boolean }) {
  const tone = urgencyTone(view.urgency);
  return (
    <TimelineItem
      type="task"
      time="—"
      timeOverdue={view.urgency?.level === "overdue"}
      dot={tone.dot}
      statusLabel="A fazer"
      statusClass={tone.text}
      title={view.title}
      details={<TaskDetails view={view} />}
      urgency={view.urgency}
      compact={compact}
      action={<TaskAction view={view} />}
      isLast={isLast}
    />
  );
}

/** Várias tarefas da mesma origem viram um bloco recolhível; dentro, a rota é o título de cada linha. */
function TaskTimelineGroup({ label, tasks, compact, isLast }: { label: string; tasks: TimelineTaskView[]; compact: boolean; isLast: boolean }) {
  const [open, setOpen] = useState(tasks.length <= 3);
  const top = tasks[0].urgency;
  const tone = urgencyTone(top);
  return (
    <div className="grid grid-cols-[52px_1fr] gap-3">
      <TimelineRail time="—" timeOverdue={top?.level === "overdue"} dot={tone.dot} isLast={isLast} compact={compact} />
      <div className="rounded-ds-card border border-ds-border bg-ds-surface shadow-xs">
        <button
          type="button"
          className={`flex w-full items-center gap-2 text-left ${compact ? "px-3 py-2" : "px-4 py-3"}`}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <CheckSquare className="h-3.5 w-3.5 text-ds-info" />
          <span className="flex-1 text-sm font-semibold">
            {label} <span className="font-mono text-ds-accent-ink tabular-nums">· {tasks.length}</span>
          </span>
          {top ? <UrgencyPill urgency={top} /> : <span className={`text-xs font-medium ${tone.text}`}>A fazer</span>}
          <ChevronDown className={`h-4 w-4 text-ds-ink-faint transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {open ? (
          <ul className="border-t border-ds-divider">
            {tasks.map((view) => (
              <li key={view.id} className={`flex items-start justify-between gap-3 border-b border-ds-divider last:border-b-0 ${compact ? "px-3 py-2" : "px-4 py-3"}`}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {view.route ? (
                      <p className="flex flex-wrap items-center gap-1.5 text-sm">
                        <span className="text-ds-ink-2">{view.route.origin}</span>
                        <ArrowRight className="h-3.5 w-3.5 text-ds-accent-ink" aria-label="para" />
                        <span className="font-semibold">{view.route.destination}</span>
                      </p>
                    ) : (
                      <p className="text-sm font-semibold">{view.title}</p>
                    )}
                    {view.urgency && view !== tasks[0] ? <UrgencyPill urgency={view.urgency} /> : null}
                  </div>
                  {!compact ? <TaskDetails view={{ ...view, route: null }} /> : null}
                </div>
                <div className="shrink-0"><TaskAction view={view} /></div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function TimelineMarker({ time, label, now, isLast }: { time: string; label: string; now?: boolean; isLast: boolean }) {
  return (
    <div className="grid grid-cols-[52px_1fr] gap-3">
      <div className="relative flex flex-col items-end pr-1 pt-0.5">
        <span className={`font-mono text-xs tabular-nums ${now ? "font-semibold text-ds-accent-ink" : "text-ds-ink-faint"}`}>
          {time}
        </span>
        <span
          className={`absolute right-[-13px] top-1 h-2.5 w-2.5 rounded-full ring-4 ring-ds-page ${
            now ? "bg-ds-accent" : "bg-ds-border"
          }`}
        />
        {!isLast ? <span className="absolute right-[-8px] top-3.5 h-[calc(100%+0.75rem)] w-px bg-ds-divider" /> : null}
      </div>
      <div className="pl-3 pt-0.5">
        <span className={`text-sm ${now ? "font-semibold uppercase tracking-[0.12em] text-ds-accent-ink" : "text-ds-ink-muted"}`}>
          {label}
        </span>
      </div>
    </div>
  );
}

function NextActionCard({ execution }: { execution: FormExecution }) {
  const time = timeOf(execution.due_at);
  const overdue = execution.status === "overdue";

  return (
    <div className="flex flex-col gap-3 rounded-ds-card border border-ds-border bg-ds-muted p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <div className="rounded-ds-card bg-ds-accent p-2.5 text-white">
          <FileText className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ds-accent-ink">
            Próxima ação{overdue ? " · Atrasada" : ""}
          </p>
          <p className="truncate font-semibold">
            {execution.template_name}
            {time ? <span className="font-normal text-ds-ink-muted"> · até {time}</span> : null}
          </p>
        </div>
      </div>
      <Button asChild className="bg-ds-accent text-white hover:bg-ds-accent-hover sm:shrink-0">
        <Link href={`/dashboard/forms/${execution.id}/view`}>
          <ArrowRight className="mr-2 h-4 w-4" />
          Preencher agora
        </Link>
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Directed stock count                                                       */
/* -------------------------------------------------------------------------- */

function CountSummary({ session }: { session: StockAuditSession }) {
  const { updateAuditSession } = useStockAudit();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const itemKey = (item: StockAuditItem) => `${item.productId}-${item.lotId}`;

  useEffect(() => {
    const seed: Record<string, number> = {};
    session.items.forEach((item) => {
      seed[itemKey(item)] = item.finalQuantity ?? 0;
    });
    setQuantities(seed);
    setTouched(new Set());
    setSaved(false);
    setSaveError(null);
  }, [session]);

  const total = session.items.length;
  const counted = touched.size;
  const canSubmit = total > 0 && counted === total && !saving && !saved;
  const expirySummary = useMemo(() => getStockExpirySummary(session.items), [session.items]);

  const adjust = (item: StockAuditItem, delta: number) => {
    const key = itemKey(item);
    setQuantities((prev) => ({ ...prev, [key]: Math.max(0, (prev[key] ?? 0) + delta) }));
    setTouched((prev) => new Set(prev).add(key));
    setSaved(false);
  };

  const submit = async () => {
    try {
      setSaving(true);
      setSaveError(null);
      const updatedItems = session.items.map((item) => ({
        ...item,
        finalQuantity: quantities[itemKey(item)] ?? item.finalQuantity ?? 0,
      }));
      await updateAuditSession(session.id, {
        items: updatedItems,
        status: "completed",
        completedAt: new Date().toISOString(),
      });
      setSaved(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Falha ao concluir a contagem.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-ds-ink-muted">
          {session.kioskName} · iniciada {format(new Date(session.startedAt), "dd/MM 'às' HH:mm", { locale: ptBR })}
        </p>
        <span className="text-sm font-semibold">
          {counted}/{total} <span className="font-normal text-ds-ink-muted">itens</span>
        </span>
      </div>

      {expirySummary.attention > 0 ? (
        <div className="rounded-ds-card border border-ds-divider bg-ds-warn-bg p-3 text-sm text-ds-warn">
          <div className="flex flex-wrap items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-ds-warn" />
            <span className="font-semibold">Atenção de validade</span>
            {expirySummary.expired > 0 ? <Badge variant="outline" className={stockExpiryBadgeClass("expired")}>{expirySummary.expired} vencido(s)</Badge> : null}
            {expirySummary.today > 0 ? <Badge variant="outline" className={stockExpiryBadgeClass("today")}>{expirySummary.today} vence(m) hoje</Badge> : null}
            {expirySummary.urgent > 0 ? <Badge variant="outline" className={stockExpiryBadgeClass("urgent")}>{expirySummary.urgent} em até 7 dias</Badge> : null}
            {expirySummary.warning > 0 ? <Badge variant="outline" className={stockExpiryBadgeClass("warning")}>{expirySummary.warning} em até 30 dias</Badge> : null}
          </div>
          <p className="mt-1 text-xs text-ds-warn">Aviso apenas visual; não altera a quantidade contada.</p>
        </div>
      ) : null}

      <div className="space-y-2">
        {session.items.map((item) => {
          const key = itemKey(item);
          const isTouched = touched.has(key);
          const expiryAlert = getStockExpiryAlert(item.expiryDate);
          return (
            <div
              key={key}
              className={`flex items-center justify-between gap-3 rounded-ds-card border p-3 ${isTouched ? "border-ds-divider bg-ds-accent-soft" : ""}`}
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{item.productName}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <p className="text-xs text-ds-ink-muted">{item.displayUnit} · Val: {formatStockExpiryDate(item.expiryDate)}</p>
                  <Badge variant="outline" className={stockExpiryBadgeClass(expiryAlert.level)}>{expiryAlert.label}</Badge>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => adjust(item, -1)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-ds-border bg-ds-surface text-ds-ink-muted transition-colors hover:bg-ds-muted"
                  aria-label="Diminuir"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span
                  className={`flex h-9 w-14 items-center justify-center rounded-lg border text-center font-mono text-sm tabular-nums ${
                    isTouched ? "border-ds-divider bg-ds-surface" : "bg-ds-surface text-ds-ink-muted"
                  }`}
                >
                  {isTouched ? quantities[key] ?? 0 : "—"}
                </span>
                <button
                  type="button"
                  onClick={() => adjust(item, 1)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-ds-border bg-ds-surface text-ds-ink-muted transition-colors hover:bg-ds-muted"
                  aria-label="Aumentar"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {saveError ? (
        <div className="rounded-ds-card border border-ds-danger bg-ds-danger-bg p-3 text-sm text-ds-danger">{saveError}</div>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-ds-ink-muted">
          {saved ? "Contagem concluída e estoque atualizado." : `Conte todos os itens para concluir (${counted}/${total}).`}
        </p>
        <Button onClick={submit} disabled={!canSubmit} className="bg-ds-accent text-white hover:bg-ds-accent-hover">
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {saved ? "Concluída" : "Concluir contagem"}
        </Button>
      </div>
    </div>
  );
}

function CountTimelineAction({ session, isLast }: { session: StockAuditSession; isLast: boolean }) {
  return (
    <TimelineItem
      type="count"
      time="—"
      dot="bg-ds-warn"
      statusLabel="Em aberto"
      statusClass="text-ds-warn"
      title={`Contagem · ${session.kioskName}`}
      meta={`${session.items.length} ${session.items.length === 1 ? "item" : "itens"}`}
      action={
        <Dialog>
          <DialogTrigger asChild>
            <Button size="sm" className="bg-ds-accent text-white hover:bg-ds-accent-hover">
              Continuar
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[86vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Concluir contagem</DialogTitle>
              <DialogDescription>Confira todos os itens da sua sessão. Ao concluir, o estoque será atualizado e a pendência sairá do seu painel.</DialogDescription>
            </DialogHeader>
            <CountSummary session={session} />
          </DialogContent>
        </Dialog>
      }
      isLast={isLast}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Full goals (dialog)                                                        */
/* -------------------------------------------------------------------------- */

function RecorteTile({ label, pct, value, target }: { label: string; pct: number; value: number; target: number }) {
  return (
    <div className="rounded-ds-card border border-ds-border bg-ds-muted p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ds-ink-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight">{pct.toFixed(0)}%</p>
      <p className="mt-1 text-xs text-ds-ink-muted">
        {money(value)} de {money(target)}
      </p>
    </div>
  );
}

function GoalProgressRow({
  goal,
  period,
  unitName,
  periodGoals,
  distributionSnapshot,
}: {
  goal: EmployeeGoal & { originalGoals?: EmployeeGoal[] };
  period: GoalPeriodDoc;
  unitName?: string;
  periodGoals: EmployeeGoal[];
  distributionSnapshot?: GoalDistributionSnapshot | null;
}) {
  const pct = percent(goal.currentValue, goal.targetValue);
  const upTarget = goal.targetValue * 1.2;
  const upPct = percent(goal.currentValue, upTarget);
  const recortes = goalRecortes(goal, period, distributionSnapshot);
  const bonusContext = getGoalBonusContext(goal, period, periodGoals);
  const { periodStart, periodEnd, days, dailyTarget, dailyTargets } = recortes;
  const today = new Date();
  const elapsedDays = days.filter((day) => day <= today);
  const hitCount = elapsedDays.filter((day) => {
    const key = dateKey(day);
    return (goal.dailyProgress?.[key] ?? 0) >= (dailyTargets[key] ?? dailyTarget);
  }).length;

  return (
    <div className="space-y-3 rounded-ds-card border border-ds-border p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="font-semibold">{unitName ?? "Meta da unidade"}</p>
          <p className="text-xs text-ds-ink-muted">
            período {format(periodStart, "eee dd/MM", { locale: ptBR }).replace(/^\w/, (c) => c.toUpperCase())} –{" "}
            {format(periodEnd, "eee dd/MM/yyyy", { locale: ptBR }).replace(/^\w/, (c) => c.toUpperCase())}
          </p>
        </div>
        <Badge className="border-ds-divider bg-ds-ok-bg text-ds-ok">
          {period.status === "active" ? "Ativa" : period.status}
        </Badge>
      </div>

      <div className="grid gap-2 md:grid-cols-3">
        <RecorteTile label="Meta · Hoje" pct={recortes.today.pct} value={recortes.today.value} target={recortes.today.target} />
        <RecorteTile label="Meta · Semana" pct={recortes.semana.pct} value={recortes.semana.value} target={recortes.semana.target} />
        <RecorteTile label="Meta · Mês" pct={recortes.mes.pct} value={recortes.mes.value} target={recortes.mes.target} />
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <div className="rounded-ds-card border border-ds-border bg-ds-muted p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ds-ink-muted">% Meta UP</p>
          <p className="mt-1 text-2xl font-bold tracking-tight">{upPct.toFixed(1)}%</p>
          <p className="mt-1 text-xs text-ds-ink-muted">alvo {money(upTarget)}</p>
        </div>
        <div className="rounded-ds-card border border-ds-border bg-ds-muted p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ds-ink-muted">Dias batidos</p>
          <p className="mt-1 text-2xl font-bold tracking-tight">
            {hitCount}/{elapsedDays.length}
          </p>
          <p className="mt-1 text-xs text-ds-ink-muted">alvo diário atingido</p>
        </div>
      </div>

      {bonusContext ? (
        <div className="rounded-ds-card border border-ds-divider bg-ds-ok-bg p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-ds-ok">Bonificação estimada</p>
              <p className="mt-1 text-sm font-semibold text-ds-ok">
                {period.goalMethodSnapshot?.name ?? "Forma de meta"} · {bonusContext.roleLabel}
              </p>
              {bonusContext.collaboratorMessage ? (
                <p className="mt-2 rounded-lg bg-ds-surface px-3 py-2 text-sm font-semibold text-ds-ok">
                  {bonusContext.collaboratorMessage}
                </p>
              ) : null}
            </div>
            <div className="rounded-ds-card bg-ds-surface px-4 py-3 text-right">
              <p className="text-xs text-ds-ok">Sua bonificação estimada</p>
              <p className="mt-1 text-2xl font-black text-ds-ok">R$ {formatCurrencyBRL(bonusContext.individualBonus)}</p>
            </div>
          </div>
          <div className="mt-3 grid gap-2 text-xs text-ds-ok md:grid-cols-3">
            <div className="rounded-lg bg-ds-surface px-3 py-2">
              Equipe: R$ {formatCurrencyBRL(bonusContext.preview.totalTeamBonus)}
            </div>
            <div className="rounded-lg bg-ds-surface px-3 py-2">
              Realizado: R$ {formatCurrencyBRL(bonusContext.preview.revenue)}
            </div>
            <div className="rounded-lg bg-ds-surface px-3 py-2">
              Papel: {bonusContext.roleLabel}
            </div>
          </div>
        </div>
      ) : null}

      <div className="space-y-2 rounded-ds-card border border-ds-border bg-ds-muted p-4">
        <div className="flex justify-between text-xs font-semibold text-ds-ink-muted">
          <span>Meta · {money(goal.targetValue)}</span>
          <span>{pct.toFixed(1)}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-ds-muted">
          <div className="h-full rounded-full bg-ds-accent" style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
        <div className="flex justify-between text-xs font-semibold text-ds-info">
          <span>Meta UP · {money(upTarget)}</span>
          <span>{upPct.toFixed(1)}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-ds-info-bg">
          <div className="h-full rounded-full bg-ds-info" style={{ width: `${Math.min(upPct, 100)}%` }} />
        </div>
      </div>

      <div className="overflow-hidden rounded-ds-card border border-ds-border">
        <div className="grid grid-cols-[1fr_1fr_1fr_48px] bg-ds-muted px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-ds-ink-muted">
          <span>Dia</span>
          <span className="text-right">Alvo</span>
          <span className="text-right">Realizado</span>
          <span className="text-center">Status</span>
        </div>
        {days.map((day) => {
          const key = dateKey(day);
          const value = goal.dailyProgress?.[key] ?? 0;
          const dayTarget = dailyTargets[key] ?? dailyTarget;
          const pastOrToday = day <= today;
          const hit = pastOrToday && value >= dayTarget;
          return (
            <div
              key={key}
              className={`grid grid-cols-[1fr_1fr_1fr_48px] border-b px-4 py-2 text-xs last:border-b-0 ${
                isSameDay(day, today) ? "bg-ds-accent-soft" : ""
              }`}
            >
              <span className="font-medium">{format(day, "eee dd/MM", { locale: ptBR }).replace(/^\w/, (c) => c.toUpperCase())}</span>
              <span className="text-right text-ds-ink-muted">{money(dayTarget)}</span>
              <span className={`text-right font-semibold ${value > 0 ? "text-ds-ink" : "text-ds-ink-muted"}`}>
                {pastOrToday ? money(value) : "-"}
              </span>
              <span className="text-center">{!pastOrToday ? "-" : hit ? "✓" : value > 0 ? "!" : "•"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Sidebar cards                                                              */
/* -------------------------------------------------------------------------- */

function SidebarCard({
  icon,
  title,
  action,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-ds-card-lg border border-ds-border bg-ds-surface p-4 shadow-xs">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span className="text-ds-ink-muted">{icon}</span>
          {title}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function SidebarEscala({
  shifts,
  loading,
  error,
  showMockup,
}: {
  shifts: DPShift[];
  loading: boolean;
  error: string | null;
  showMockup?: boolean;
}) {
  const { shiftDefinitions } = useDPStore();
  const todayKey = dateKey(new Date());
  const upcoming = useMemo(() => {
    return [...shifts]
      .filter((shift) => shift.type !== "day_off" && shift.date >= todayKey)
      .sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`))
      .slice(0, 5);
  }, [shifts, todayKey]);

  const mockShifts = [
    { day: "Hoje", label: "Tarde", time: "15:45-22:00", tone: "border-ds-divider bg-ds-accent-soft text-ds-accent-ink" },
    { day: "Amanhã", label: "Manhã", time: "10:00-16:15", tone: "border-ds-divider bg-ds-ok-bg text-ds-ok" },
    { day: "Sábado", label: "Descanso", time: "folga", tone: "border-ds-divider bg-ds-muted text-ds-ink-muted" },
  ];

  return (
    <SidebarCard
      icon={<CalendarDays className="h-4 w-4" />}
      title="Escala"
      action={
        <Link
          href="/dashboard/collaborator/schedule"
          className="inline-flex items-center gap-1 text-xs font-semibold text-ds-accent-ink hover:underline"
        >
          Ver escala
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-4 text-xs text-ds-ink-muted">
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          Carregando...
        </div>
      ) : upcoming.length === 0 && showMockup ? (
        <div className="space-y-2">
          <div className="rounded-ds-card border border-ds-divider bg-ds-accent-soft px-3 py-2">
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-ds-accent-ink">Mockup visual</p>
            <p className="mt-0.5 text-xs font-semibold text-ds-accent-ink">Como a escala aparecerá quando houver turnos.</p>
          </div>
          <div className="space-y-1.5">
            {mockShifts.map((shift) => (
              <div key={`${shift.day}-${shift.label}`} className={`flex items-center justify-between rounded-ds-card border px-3 py-2 ${shift.tone}`}>
                <div className="min-w-0">
                  <p className="text-xs font-black">{shift.day}</p>
                  <p className="truncate text-[11px] font-semibold opacity-80">{shift.label}</p>
                </div>
                <span className="rounded-full bg-ds-surface px-2 py-0.5 font-mono text-[11px] font-bold tabular-nums">
                  {shift.time}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : upcoming.length === 0 ? (
        <p className="rounded-ds-card border border-ds-border border-dashed bg-ds-muted px-3 py-4 text-sm text-ds-ink-muted">
          Nenhum turno futuro encontrado para este mês.
        </p>
      ) : (
        <div className="space-y-1">
          {upcoming.map((shift) => {
            const isToday = shift.date === todayKey;
            const definition = shift.shiftDefinitionId
              ? shiftDefinitions.find((item) => item.id === shift.shiftDefinitionId)
              : null;
            const label = isToday
              ? "Hoje"
              : format(new Date(`${shift.date}T12:00:00`), "eee dd/MM", { locale: ptBR }).replace(/^\w/, (c) => c.toUpperCase());
            return (
              <div key={shift.id} className="flex items-center justify-between gap-2 py-1 text-sm">
                <span className={isToday ? "font-semibold text-ds-accent-ink" : "text-ds-ink-muted"}>
                  {label}
                  {definition?.name ? <span className="ml-1.5 text-xs text-ds-ink-faint">{definition.name}</span> : null}
                </span>
                <span className="font-mono text-xs tabular-nums text-ds-ink-muted">
                  {shift.startTime}–{shift.endTime}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </SidebarCard>
  );
}

function MockGoalMiniCard() {
  const mockRows = [
    { label: "Hoje", teamValue: 479.5, ownValue: 0, target: 935.48 },
    { label: "Semana", teamValue: 6354.5, ownValue: 1958, target: 6548.39 },
    { label: "Mês", teamValue: 12639.5, ownValue: 1958, target: 29000 },
  ];

  return (
    <div className="space-y-3">
      <div className="rounded-ds-card border border-ds-divider bg-ds-accent-soft px-3 py-2.5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-ds-accent-ink">Mockup visual</p>
            <p className="mt-0.5 text-xs font-semibold text-ds-accent-ink">Meta do quiosque</p>
          </div>
          <Badge variant="outline" className="rounded-full border-ds-divider bg-ds-surface text-[10px] font-black text-ds-accent-ink">
            Meta Alvo ativa
          </Badge>
        </div>
      </div>

      <div className="rounded-ds-card border border-ds-divider bg-ds-ok-bg px-3 py-2.5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-ds-ok">Bonificação estimada</p>
            <p className="mt-0.5 text-xs text-ds-ok">Quiosque médio por faixas</p>
          </div>
          <p className="text-base font-black text-ds-ok">R$ 0,00</p>
        </div>
      </div>

      {mockRows.map((row) => {
        const pctValue = percent(row.teamValue, row.target);
        const ownShare = percent(row.ownValue, row.teamValue);
        return (
          <div key={row.label} className="rounded-ds-card border border-ds-divider bg-ds-surface px-3 py-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-black uppercase tracking-[0.12em] text-ds-ink-muted">{row.label}</span>
              <span className="rounded-full bg-ds-accent-soft px-2 py-0.5 text-[10px] font-black text-ds-accent-ink">
                Meta Alvo · {pctValue.toFixed(0)}%
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ds-muted">
              <div className="h-full rounded-full bg-ds-accent" style={{ width: `${Math.min(pctValue, 100)}%` }} />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <p className="font-bold text-ds-ink-faint">Equipe</p>
                <p className="font-black text-ds-ink">{money(row.teamValue)}</p>
                <p className="font-medium text-ds-ink-faint">de {money(row.target)}</p>
              </div>
              <div className="text-right">
                <p className="font-bold text-ds-info">Você</p>
                <p className="font-black text-ds-info">{money(row.ownValue)}</p>
                <p className="font-medium text-ds-info">{ownShare.toFixed(1)}% do faturado</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MockGoalDetail() {
  const days = [
    { label: "Seg 06/07", total: 1776.5, own: 1074.5, status: "Com venda" },
    { label: "Ter 07/07", total: 2062.5, own: 1102, status: "Com venda" },
    { label: "Qua 08/07", total: 1887, own: 960.5, status: "Com venda" },
    { label: "Qui 09/07", total: 479.5, own: 0, status: "Sem turno" },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-ds-card-lg border border-ds-divider bg-ds-accent-soft p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Badge variant="outline" className="rounded-full border-ds-divider bg-ds-surface text-ds-accent-ink">Mockup visual</Badge>
            <h3 className="mt-3 text-lg font-black tracking-tight">Meta do quiosque</h3>
            <p className="text-sm text-ds-ink-muted">Exemplo de como a meta aparecerá quando houver dados reais.</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-ds-ink-muted">Faixa ativa</p>
            <p className="text-base font-black text-ds-accent-ink">Meta Alvo</p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {[
            { label: "Hoje", value: 479.5, target: 935.48 },
            { label: "Semana", value: 6354.5, target: 6548.39 },
            { label: "Mês", value: 12639.5, target: 29000 },
          ].map((item) => (
            <div key={item.label} className="rounded-ds-card bg-ds-surface px-3 py-3">
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-ds-ink-faint">{item.label}</p>
              <p className="mt-1 text-base font-black">{money(item.value)}</p>
              <p className="text-xs font-semibold text-ds-accent-ink">{percent(item.value, item.target).toFixed(1)}% da Meta Alvo</p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-ds-card-lg border border-ds-border p-4">
        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-ds-ink-muted">Sua contribuição diária</p>
        <div className="mt-3 overflow-hidden rounded-ds-card border border-ds-border">
          {days.map((day) => (
            <div key={day.label} className="grid grid-cols-[1fr_1fr_1fr_90px] items-center gap-3 border-b px-3 py-2.5 text-xs last:border-b-0">
              <span className="font-bold">{day.label}</span>
              <span className="text-right text-ds-ink-muted">Unidade {money(day.total)}</span>
              <span className="text-right font-black text-ds-info">Você {money(day.own)}</span>
              <span className="text-right font-semibold text-ds-ink-muted">{day.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SidebarMetas({
  loading,
  goals,
  periods,
  allGoals,
  distributionSnapshot,
  showMockup,
}: {
  loading: boolean;
  goals: Array<EmployeeGoal & { originalGoals?: EmployeeGoal[] }>;
  periods: GoalPeriodDoc[];
  allGoals: EmployeeGoal[];
  distributionSnapshot?: GoalDistributionSnapshot | null;
  showMockup?: boolean;
}) {
  const { kiosks } = useKiosks();
  const kioskName = (id: string) => kiosks.find((kiosk) => kiosk.id === id)?.name ?? id;

  const goalUnits = useMemo(
    () =>
      goals
        .map((goal) => ({ goal, period: periods.find((item) => item.id === goal.periodId) ?? null }))
        .filter((entry): entry is { goal: EmployeeGoal; period: GoalPeriodDoc } => entry.period !== null),
    [goals, periods]
  );

  const primary = goalUnits[0] ?? null;
  const recortes = primary ? goalRecortes(primary.goal, primary.period, distributionSnapshot) : null;
  const primaryBonusContext = primary ? getGoalBonusContext(primary.goal, primary.period, allGoals) : null;
  const rows = recortes
    ? [
        { label: "Hoje", ...recortes.today },
        { label: "Semana", ...recortes.semana },
        { label: "Mês", ...recortes.mes },
      ]
    : [];

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className="block w-full text-left">
          <div className="rounded-ds-card-lg border bg-ds-surface p-4 shadow-xs transition-colors hover:border-ds-divider hover:bg-ds-muted">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Flag className="h-4 w-4 text-ds-ink-muted" />
                Metas
              </div>
              <span className="inline-flex items-center text-xs font-medium text-ds-accent-ink">
                Detalhes
                <ChevronRight className="ml-0.5 h-3.5 w-3.5" />
              </span>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-4 text-xs text-ds-ink-muted">
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                Carregando...
              </div>
            ) : rows.length === 0 && showMockup ? (
              <MockGoalMiniCard />
            ) : rows.length === 0 ? (
              <p className="rounded-ds-card border border-ds-border border-dashed bg-ds-muted px-3 py-4 text-sm text-ds-ink-muted">
                Nenhuma meta ativa vinculada a você no momento.
              </p>
            ) : (
              <div className="space-y-3">
                {goalUnits.length > 1 ? (
                  <p className="text-[11px] font-medium text-ds-ink-muted">
                    {kioskName(primary!.goal.kioskId)}
                    <span className="text-ds-ink-faint"> · +{goalUnits.length - 1} unidade(s)</span>
                  </p>
                ) : null}
                {primaryBonusContext ? (
                  <div className="rounded-ds-card border border-ds-divider bg-ds-ok-bg px-3 py-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-ds-ok">Sua bonificação estimada</p>
                        <p className="mt-0.5 text-xs text-ds-ok">{primaryBonusContext.roleLabel}</p>
                      </div>
                      <p className="text-base font-black text-ds-ok">
                        R$ {formatCurrencyBRL(primaryBonusContext.individualBonus)}
                      </p>
                    </div>
                    {primaryBonusContext.collaboratorMessage ? (
                      <p className="mt-2 text-xs font-semibold text-ds-ok">
                        {primaryBonusContext.collaboratorMessage}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {rows.map((row) => (
                  <div key={row.label} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold uppercase tracking-[0.12em] text-ds-ink-muted">{row.label}</span>
                      <span className="text-ds-ink-muted">
                        {money(row.value)} / {money(row.target)} ·{" "}
                        <span className="font-semibold text-ds-ink">{row.pct.toFixed(0)}%</span>
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-ds-muted">
                      <div className="h-full rounded-full bg-ds-accent" style={{ width: `${Math.min(row.pct, 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </button>
      </DialogTrigger>

      <DialogContent className="max-h-[86vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Minhas metas</DialogTitle>
          <DialogDescription>Detalhamento do dia por unidade.</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex min-h-40 items-center justify-center text-sm text-ds-ink-muted">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Carregando metas...
          </div>
        ) : goalUnits.length === 0 && showMockup ? (
          <MockGoalDetail />
        ) : goalUnits.length === 0 ? (
          <div className="rounded-ds-card border border-ds-border border-dashed bg-ds-muted p-6 text-sm text-ds-ink-muted">
            Nenhuma meta ativa vinculada a você no momento.
          </div>
        ) : goalUnits.length === 1 ? (
          <GoalProgressRow
            goal={goalUnits[0].goal}
            period={goalUnits[0].period}
            unitName={kioskName(goalUnits[0].goal.kioskId)}
            periodGoals={allGoals}
            distributionSnapshot={distributionSnapshot}
          />
        ) : (
          <Tabs defaultValue={goalUnits[0].goal.id} className="space-y-4">
            <TabsList className="flex w-full flex-wrap">
              {goalUnits.map((entry) => (
                <TabsTrigger key={entry.goal.id} value={entry.goal.id}>
                  {kioskName(entry.goal.kioskId)}
                </TabsTrigger>
              ))}
            </TabsList>
            {goalUnits.map((entry) => (
              <TabsContent key={entry.goal.id} value={entry.goal.id}>
                <GoalProgressRow
                  goal={entry.goal}
                  period={entry.period}
                  unitName={kioskName(entry.goal.kioskId)}
                  periodGoals={allGoals}
                  distributionSnapshot={distributionSnapshot}
                />
              </TabsContent>
            ))}
          </Tabs>
        )}

        <div className="flex justify-end border-t pt-4">
          <Button asChild className="bg-ds-accent text-white hover:bg-ds-accent-hover">
            <Link href="/dashboard/goals/tracking">
              Acompanhar metas
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SidebarComunicados({ showMockup }: { showMockup?: boolean }) {
  return (
    <SidebarCard
      icon={<Bell className="h-4 w-4" />}
      title="Comunicados"
      action={showMockup ? <span className="rounded-full border border-ds-divider bg-ds-warn-bg px-2 py-0.5 text-[10px] font-black text-ds-warn">Mockup</span> : undefined}
    >
      {showMockup ? (
        <div className="space-y-2">
          <div className="rounded-ds-card border border-ds-divider bg-ds-accent-soft px-3 py-2.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-ds-accent-ink">Operação</p>
                <p className="mt-0.5 truncate text-xs font-black text-ds-accent-ink">Novo padrão de fechamento</p>
                <p className="mt-1 text-[11px] leading-relaxed text-ds-accent-ink">Conferir dinheiro líquido e anexar evidência no fim do turno.</p>
              </div>
              <Badge variant="outline" className="shrink-0 rounded-full border-ds-divider bg-ds-surface text-[10px] text-ds-accent-ink">
                Hoje
              </Badge>
            </div>
          </div>
          <div className="rounded-ds-card border border-ds-divider bg-ds-surface px-3 py-2.5">
            <div className="flex items-center gap-2">
              <FileText className="h-3.5 w-3.5 text-ds-ink-muted" />
              <div className="min-w-0">
                <p className="truncate text-xs font-bold text-ds-ink">Checklist de atendimento atualizado</p>
                <p className="text-[11px] text-ds-ink-muted">Leitura rápida · 2 min</p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <p className="rounded-ds-card border border-ds-border border-dashed bg-ds-muted px-3 py-4 text-sm text-ds-ink-muted">
          Nenhum comunicado para exibir.
        </p>
      )}
    </SidebarCard>
  );
}

/* -------------------------------------------------------------------------- */
/* Quick access                                                               */
/* -------------------------------------------------------------------------- */

function QuickAccessCard({
  href,
  icon,
  title,
  description,
  tone,
  menu,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  tone: string;
  menu?: React.ReactNode;
}) {
  return (
    <div className="relative min-h-24 rounded-ds-card-lg border bg-ds-surface shadow-xs transition-all hover:-translate-y-0.5 hover:border-ds-divider hover:shadow-md">
      <Link href={href} className="group flex min-h-24 items-center gap-3 rounded-ds-card-lg p-4 pr-11">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-ds-card ${tone}`}>
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-ds-ink">{title}</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-ds-ink-muted">{description}</span>
        </span>
        {!menu ? <ChevronRight className="h-4 w-4 shrink-0 text-ds-ink-muted transition-transform group-hover:translate-x-0.5 group-hover:text-ds-accent-ink" /> : null}
      </Link>
      {menu ? <div className="absolute right-3 top-1/2 z-2 -translate-y-1/2">{menu}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Panel                                                                      */
/* -------------------------------------------------------------------------- */

const TIMELINE_DENSITY_KEY = "coala.collaborator.timeline-density";

function CollaboratorDashboardPanelInner() {
  const { firebaseUser, user, permissions } = useAuth();
  const { kiosks } = useKiosks();
  const { taskNotifications, pendingReceipts, completedReceipts } = useAllTasks();
  const { activities: repositionActivities, updateRepositionActivity } = useReposition();
  const { toast } = useToast();
  const { auditSessions } = useStockAudit();
  const [confirmingReceipt, setConfirmingReceipt] = useState<{ activityId: string; description: string } | null>(null);
  // Batida pelo painel: a mesma coleta e confirmação do Registro de ponto. A jornada de hoje só é lida com a coleta liberada.
  const punch = useRepPMarking();
  const punchEnabled = canOfferPunch(punch);
  const punchJourney = useTodayJourney(punch, punchEnabled);
  const [punchOpen, setPunchOpen] = useState(false);
  const [isConfirmingReceipt, setIsConfirmingReceipt] = useState(false);
  const [compactTimeline, setCompactTimeline] = useState(false);
  useEffect(() => {
    try { setCompactTimeline(window.localStorage.getItem(TIMELINE_DENSITY_KEY) === "compact"); } catch { /* preferência só deste navegador */ }
  }, []);
  const changeTimelineDensity = (value: "detailed" | "compact") => {
    setCompactTimeline(value === "compact");
    try { window.localStorage.setItem(TIMELINE_DENSITY_KEY, value); } catch { /* preferência só deste navegador */ }
  };
  const { units, shiftDefinitions } = useDPStore();
  const [executions, setExecutions] = useState<FormExecution[]>([]);
  const [loadingForms, setLoadingForms] = useState(true);
  const [formsError, setFormsError] = useState<string | null>(null);
  const [distributionSnapshot, setDistributionSnapshot] = useState<GoalDistributionSnapshot | null>(null);
  const [apiShifts, setApiShifts] = useState<DPShift[]>([]);
  const [apiPeriods, setApiPeriods] = useState<GoalPeriodDoc[]>([]);
  const [apiEmployeeGoals, setApiEmployeeGoals] = useState<EmployeeGoal[]>([]);
  const [loadingCollaboratorData, setLoadingCollaboratorData] = useState(true);
  const [collaboratorDataError, setCollaboratorDataError] = useState<string | null>(null);
  const currentUserIds = useMemo(
    () => compactUnique([firebaseUser?.uid, user?.id, user?.hrEmployeeId, user?.registrationIdBizneo, user?.registrationIdPdv]),
    [firebaseUser?.uid, user?.id, user?.hrEmployeeId, user?.registrationIdBizneo, user?.registrationIdPdv]
  );
  const showMockup = useMemo(
    () => canPreviewCollaboratorMockups(user ?? {}, firebaseUser),
    [firebaseUser?.displayName, firebaseUser?.email, user?.email, user?.username]
  );
  const canAccessOwnProfile = Boolean(user?.id && permissions.dp?.collaborators?.view);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!firebaseUser) {
        setApiShifts([]);
        setApiPeriods([]);
        setApiEmployeeGoals([]);
        setDistributionSnapshot(null);
        setCollaboratorDataError(null);
        setLoadingCollaboratorData(false);
        return;
      }

      try {
        setLoadingCollaboratorData(true);
        setCollaboratorDataError(null);
        const token = await firebaseUser.getIdToken();
        const response = await fetch("/api/collaborator/dashboard", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error ?? "Falha ao carregar painel do colaborador.");
        if (!cancelled) {
          setApiShifts(Array.isArray(payload.shifts) ? payload.shifts : []);
          setApiPeriods(Array.isArray(payload.goalPeriods) ? payload.goalPeriods : []);
          setApiEmployeeGoals(Array.isArray(payload.employeeGoals) ? payload.employeeGoals : []);
          setDistributionSnapshot(payload.distributionSnapshot ?? null);
        }
      } catch (error) {
        console.warn("[CollaboratorDashboardPanel] API dashboard failed", error);
        if (!cancelled) {
          setApiShifts([]);
          setApiPeriods([]);
          setApiEmployeeGoals([]);
          setDistributionSnapshot(null);
          setCollaboratorDataError(error instanceof Error ? error.message : "Falha ao carregar dados do colaborador.");
        }
      } finally {
        if (!cancelled) setLoadingCollaboratorData(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [firebaseUser]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!firebaseUser) {
        setLoadingForms(false);
        return;
      }

      try {
        setLoadingForms(true);
        setFormsError(null);
        const payload = await fetchMyFormExecutions(firebaseUser);
        if (!cancelled) setExecutions(payload.executions);
      } catch (error) {
        if (!cancelled) {
          setFormsError(error instanceof Error ? error.message : "Falha ao carregar formulários.");
        }
      } finally {
        if (!cancelled) setLoadingForms(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [firebaseUser]);

  const today = new Date();
  const todayKey = dateKey(today);
  const nowMinutes = today.getHours() * 60 + today.getMinutes();
  const firstName = (user?.username ?? "Colaborador").split(" ")[0];
  const dateEyebrow = format(today, "EEEE, d 'de' MMMM", { locale: ptBR }).toUpperCase();
  const effectiveShifts = apiShifts;
  const effectivePeriods = apiPeriods;
  const effectiveEmployeeGoals = apiEmployeeGoals;

  // Today's shift (greeting + timeline markers)
  const todayShift = useMemo(() => {
    const candidates = effectiveShifts
      .filter((shift) => shift.date === todayKey && shift.type !== "day_off")
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
    const shift = candidates[0];
    if (!shift) return null;
    const definition = shift.shiftDefinitionId
      ? shiftDefinitions.find((item) => item.id === shift.shiftDefinitionId)
      : null;
    const unit = units.find((item) => item.id === shift.unitId);
    return {
      name: definition?.name ?? "Turno",
      startTime: shift.startTime,
      endTime: shift.endTime,
      time: `${shift.startTime} — ${shift.endTime}`,
      unit: unit?.name ?? shift.unitId,
    };
  }, [effectiveShifts, shiftDefinitions, units, todayKey]);

  // Day form executions (due/scheduled today, fallback to all)
  const dayExecutions = useMemo(() => {
    const todays = executions.filter(
      (execution) => dayKeyOf(execution.due_at) === todayKey || dayKeyOf(execution.scheduled_for) === todayKey
    );
    const base = todays.length > 0 ? todays : executions;
    return [...base]
      .filter((execution) => execution.status !== "canceled")
      .sort((a, b) => (timeOf(a.due_at) ?? "99:99").localeCompare(timeOf(b.due_at) ?? "99:99"));
  }, [executions, todayKey]);

  const myOpenCountSessions = useMemo(
    () => auditSessions.filter((session) => session.auditedBy?.userId === firebaseUser?.uid && session.status === "pending_review"),
    [auditSessions, firebaseUser?.uid]
  );

  // Routine ring: forms + tasks + pending receipts + counts
  const completedForms = dayExecutions.filter((execution) => execution.status === "completed").length;
  const routinesTotal = dayExecutions.length + taskNotifications.length + pendingReceipts.length + myOpenCountSessions.length;
  const routinesDone = completedForms;
  const pendingCount = routinesTotal - routinesDone;
  const allDone = routinesTotal > 0 && routinesDone === routinesTotal;
  const nextAction =
    dayExecutions.find((execution) => execution.status === "overdue" || execution.status === "pending" || execution.status === "in_progress") ?? null;

  // "Concluir" no card de recebimento: confirma tudo conforme enviado (sem
  // divergência) num toque. Divergências são tratadas pela tela de recebimento
  // (texto do card). Espelha o handleConfirmReceipt da gestão de reposição.
  const handleQuickConfirmReceipt = async () => {
    if (!confirmingReceipt) return;
    const activity = repositionActivities.find((item) => item.id === confirmingReceipt.activityId);
    if (!activity) {
      setConfirmingReceipt(null);
      return;
    }
    setIsConfirmingReceipt(true);
    try {
      const receivedItems = activity.items.map((item) => ({
        ...item,
        receivedLots: item.suggestedLots.map((lot) => ({
          ...lot,
          receivedQuantity: lot.quantityToMove,
        })),
      }));
      await updateRepositionActivity(activity.id, {
        status: "Recebido sem divergência",
        items: receivedItems,
        receiptSignature: {
          signedBy: user?.username ?? user?.email ?? "Colaborador",
          signedAt: new Date().toISOString(),
        },
      });
      toast({
        title: "Recebimento confirmado",
        description: "Tudo recebido conforme enviado. A tarefa foi concluída.",
      });
      setConfirmingReceipt(null);
    } catch (error) {
      toast({
        title: "Erro ao confirmar recebimento",
        description: error instanceof Error ? error.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setIsConfirmingReceipt(false);
    }
  };

  // Build merged timeline descriptors
  const timeline = useMemo(() => {
    type Desc = { sortMin: number; order: number; key: string; render: (isLast: boolean) => React.ReactNode };
    const items: Desc[] = [];

    dayExecutions.forEach((execution, index) => {
      const time = timeOf(execution.due_at) ?? execution.shift_start_time ?? "--:--";
      const min = hhmmToMinutes(timeOf(execution.due_at) ?? execution.shift_start_time) ?? nowMinutes + 1;
      const completed = execution.status === "completed";
      const itemCount = itemCountOf(execution);
      const contextLabel = contextLabelOf(execution);
      items.push({
        sortMin: min,
        order: 1,
        key: `form-${execution.id}-${index}`,
        render: (isLast) => (
          <TimelineItem
            type="form"
            time={time}
            timeOverdue={execution.status === "overdue"}
            dot={STATUS_DOT[execution.status]}
            statusLabel={STATUS_LABELS[execution.status]}
            statusClass={STATUS_TEXT[execution.status]}
            compact={compactTimeline}
            title={execution.template_name}
            meta={`${itemCount > 0 ? `${itemCount} ${itemCount === 1 ? "item" : "itens"}` : "Formulário"}${contextLabel ? ` · ${contextLabel}` : ""}`}
            completed={completed}
            action={
              completed ? (
                <CheckCircle2 className="h-5 w-5 text-ds-ok" />
              ) : (
                <Button asChild size="sm" className="bg-ds-accent text-white hover:bg-ds-accent-hover">
                  <Link href={`/dashboard/forms/${execution.id}/view`}>Preencher</Link>
                </Button>
              )
            }
            isLast={isLast}
          />
        ),
      });
    });

    groupTimelineTasks(taskNotifications.map((task) => toTimelineTaskView(task, today))).forEach((group, index) => {
      const [first] = group.tasks;
      items.push({
        sortMin: nowMinutes + 1,
        order: 2,
        key: group.tasks.length > 1 ? `task-group-${group.kind}` : `task-${first.id}-${index}`,
        render: (isLast) => group.tasks.length > 1
          ? <TaskTimelineGroup label={group.label} tasks={group.tasks} compact={compactTimeline} isLast={isLast} />
          : <TaskTimelineEntry view={first} compact={compactTimeline} isLast={isLast} />,
      });
    });

    pendingReceipts.forEach((receipt, index) => {
      items.push({
        sortMin: nowMinutes + 1,
        order: 2,
        key: `pending-receipt-${receipt.id}-${index}`,
        render: (isLast) => (
          <TimelineItem
            type="task"
            time="—"
            dot="bg-ds-warn"
            statusLabel="A fazer"
            statusClass="text-ds-warn"
            compact={compactTimeline}
            title={receipt.title}
            titleHref={receipt.link}
            meta={receipt.description}
            action={
              <Button
                size="sm"
                className="bg-ds-accent text-white hover:bg-ds-accent-hover"
                onClick={() => setConfirmingReceipt({ activityId: receipt.activityId, description: receipt.description })}
              >
                Concluir
              </Button>
            }
            isLast={isLast}
          />
        ),
      });
    });

    completedReceipts.forEach((receipt, index) => {
      const time = format(new Date(receipt.completedAt), "HH:mm");
      const min = hhmmToMinutes(time) ?? nowMinutes;
      items.push({
        sortMin: min,
        order: 2,
        key: `receipt-done-${receipt.id}-${index}`,
        render: (isLast) => (
          <TimelineItem
            type="task"
            time={time}
            dot="bg-ds-ok"
            statusLabel={receipt.hasDivergence ? "Concluído com divergência" : "Concluído"}
            statusClass={receipt.hasDivergence ? "text-ds-warn" : "text-ds-ok"}
            compact={compactTimeline}
            title={receipt.title}
            meta={`${receipt.description} · Concluído por ${receipt.completedBy}`}
            completed
            action={<CheckCircle2 className="h-5 w-5 text-ds-ok" />}
            isLast={isLast}
          />
        ),
      });
    });

    myOpenCountSessions.forEach((session, index) => {
      items.push({
        sortMin: nowMinutes + 2,
        order: 3,
        key: `count-${session.id}-${index}`,
        render: (isLast) => <CountTimelineAction session={session} isLast={isLast} />,
      });
    });

    // Batidas de hoje e a próxima, entre as rotinas do dia.
    if (punchEnabled) {
      punchJourney.day.markings.forEach((marking, index) => {
        const time = fiscalClock(marking.markedAt);
        const purpose = marking.classification?.purpose ?? null;
        items.push({
          sortMin: hhmmToMinutes(time) ?? 0,
          // Desempata batidas no mesmo minuto pela sequência, para seguir a ordem decrescente da linha.
          order: 1 + index / 1000,
          key: `punch-${marking.receiptId}`,
          render: (isLast) => (
            <TimelineItem type="punch" time={time} dot={purpose ? PURPOSE_DOT[purpose] : "bg-ds-ink-faint"} statusLabel="Registrada" statusClass="text-ds-ok"
              compact={compactTimeline} title={`${purpose ? purposeLabel(purpose) : `${index + 1}ª batida`}`} meta={`${index + 1}ª batida · NSR ${marking.nsr}`}
              completed={false} action={null} isLast={isLast} />
          ),
        });
      });
      const next = nextMarkingOf(punchJourney.day);
      if (!next.extra) {
        items.push({
          sortMin: nowMinutes,
          order: -1,
          key: "punch-next",
          render: (isLast) => (
            <TimelineItem type="punch" time="··:··" dot="bg-ds-accent" statusLabel="Próxima" statusClass="text-ds-accent-ink" compact={compactTimeline}
              title={`${next.position}${next.reliable ? ` · ${purposeLabel(next.purpose).toLowerCase()}` : ""}`}
              meta="A hora gravada é a Hora Legal Brasileira no momento da confirmação."
              action={<Button size="sm" variant="primary-page" disabled={!punch.canRecord} onClick={() => setPunchOpen(true)}>{recordActionLabel(punch, punchJourney.day)}</Button>}
              isLast={isLast} />
          ),
        });
      }
    }

    // Shift markers
    if (todayShift) {
      const startMin = hhmmToMinutes(todayShift.startTime);
      const endMin = hhmmToMinutes(todayShift.endTime);
      if (startMin != null) {
        items.push({
          sortMin: startMin,
          order: 0,
          key: "marker-start",
          render: (isLast) => <TimelineMarker time={todayShift.startTime} label={`Início do turno · ${todayShift.name}`} isLast={isLast} />,
        });
      }
      if (startMin != null && endMin != null && nowMinutes >= startMin && nowMinutes <= endMin) {
        items.push({
          sortMin: nowMinutes,
          order: 0,
          key: "marker-now",
          render: (isLast) => <TimelineMarker time={format(today, "HH:mm")} label="Agora" now isLast={isLast} />,
        });
      }
      if (endMin != null) {
        items.push({
          sortMin: endMin + 1,
          order: 9,
          key: "marker-end",
          render: (isLast) => <TimelineMarker time={todayShift.endTime} label="Fim do turno" isLast={isLast} />,
        });
      }
    }

    // Mais recente no topo: o que está acontecendo agora aparece antes do que já passou.
    return items.sort((a, b) => b.sortMin - a.sortMin || b.order - a.order);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayExecutions, taskNotifications, pendingReceipts, completedReceipts, myOpenCountSessions, todayShift, nowMinutes, compactTimeline,
    punchEnabled, punchJourney.day, punch]);

  const activePeriods = useMemo(() => effectivePeriods.filter((period) => period.status === "active"), [effectivePeriods]);

  const visibleGoals = useMemo(() => {
    // Apenas a meta INDIVIDUAL do colaborador. Sem fallback para a meta do
    // quiosque: quem não tem meta vinculada vê o estado "sem meta".
    const ownGoals = effectiveEmployeeGoals.filter(
      (goal) => currentUserIds.includes(goal.employeeId) && activePeriods.some((period) => period.id === goal.periodId)
    );
    return mergeEmployeeGoals(ownGoals);
  }, [activePeriods, currentUserIds, effectiveEmployeeGoals]);

  return (
    <>
    <section id="painel-colaborador" className="scroll-mt-6">
      <ScheduledDarkTheme />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Left column */}
        <div className="space-y-6">
          {/* Greeting hero */}
          <div className="space-y-4">
            <PageHero
              kicker={dateEyebrow}
              title={`${greetingFor(today)}, ${firstName}`}
              actions={<LiveClock onDark />}
              chips={
                loadingForms || routinesTotal === 0 ? null : allDone ? (
                  <HeroChip value="✓" label="Rotina do dia concluída" />
                ) : (
                  <HeroChip value={`${routinesDone}/${routinesTotal}`} label={`Rotinas do dia · ${pendingCount} pendente(s) até o fim do turno`} tone={pendingCount > 0 ? "warning" : "info"} />
                )
              }
            >
              {punchEnabled ? (
                <HeroPunchRow day={punchJourney.day} today={punch.today}
                  action={<HeroPunchButton marking={punch} day={punchJourney.day} onOpen={() => setPunchOpen(true)} />} />
              ) : null}
            </PageHero>
            {punchEnabled ? <RecordDialog open={punchOpen} onOpenChange={setPunchOpen} marking={punch} day={punchJourney.day} chooseUnit onRecorded={punchJourney.reload} /> : null}
            {!loadingForms && !formsError && nextAction ? <NextActionCard execution={nextAction} /> : null}
          </div>

          {/* Acessos rápidos */}
          {(canViewTechnicalSheets(permissions) || canAccessOwnProfile || (permissions.dashboard.collaborator ?? permissions.dashboard.view)) ? (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ds-ink-muted">Acessos rápidos</p>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {canViewTechnicalSheets(permissions) ? (
                  <QuickAccessCard
                    href="/dashboard/commercial"
                    icon={<BookOpen className="h-5 w-5" />}
                    title="Ficha técnica"
                    description="Produtos e modos de preparo"
                    tone="bg-ds-accent-soft text-ds-accent-ink"
                  />
                ) : null}
                {canAccessOwnProfile ? (
                  <QuickAccessCard
                    href={`/dashboard/dp/collaborators/${user!.id}`}
                    icon={<UserRound className="h-5 w-5" />}
                    title="Meu perfil"
                    description="Dados pessoais e benefícios"
                    tone="bg-ds-info-bg text-ds-info"
                  />
                ) : null}
                {/* A própria pasta (macro 02): só o que o DP publicou para a pessoa. */}
                <QuickAccessCard
                  href="/dashboard/collaborator/documents"
                  icon={<FolderOpen className="h-5 w-5" />}
                  title="Meus documentos"
                  description="Espelho e contracheque, recibos e termos"
                  tone="bg-ds-ok-bg text-ds-ok"
                />
                <QuickAccessCard
                  href="/dashboard/collaborator/requests"
                  icon={<Inbox className="h-5 w-5" />}
                  title="Minhas solicitações"
                  description="Pedidos, análises e termos"
                  tone="bg-ds-warn-bg text-ds-warn"
                  menu={
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button type="button" aria-label="Abrir tipos de solicitação" className="grid h-9 w-9 place-items-center rounded-full text-ds-ink-muted hover:bg-ds-muted hover:text-ds-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-accent-ink">
                          <MoreHorizontal className="h-5 w-5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-64 rounded-ds-btn-lg p-2">
                        <DropdownMenuLabel className="text-[10.5px] uppercase tracking-[0.14em] text-ds-ink-faint">Nova solicitação</DropdownMenuLabel>
                        <DropdownMenuItem asChild className="rounded-ds-md p-2.5">
                          <Link href="/dashboard/collaborator/requests?new=transport_voucher">
                            <Inbox className="h-4 w-4 text-ds-warn" />
                            <span><span className="block font-bold">Vale-transporte</span><span className="block text-[11px] text-ds-ink-faint">Adesão, alteração, suspensão ou reativação</span></span>
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem asChild className="rounded-ds-md p-2.5">
                          <Link href="/dashboard/collaborator/requests?new=absence_preview">
                            <Inbox className="h-4 w-4 text-ds-info" />
                            <span><span className="block font-bold">Prévia de ausência</span><span className="block text-[11px] text-ds-ink-faint">Calcular e preparar rascunho, se disponível</span></span>
                          </Link>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  }
                />
              </div>
            </div>
          ) : null}

          {/* Linha do dia */}
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ds-ink-muted">Linha do dia</p>
              <Segmented
                aria-label="Densidade da linha do dia"
                value={compactTimeline ? "compact" : "detailed"}
                onChange={changeTimelineDensity}
                options={[{ value: "detailed", label: "Detalhado" }, { value: "compact", label: "Compacto" }]}
              />
            </div>

            {loadingForms ? (
              <div className="flex min-h-28 items-center justify-center text-sm text-ds-ink-muted">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Carregando rotinas...
              </div>
            ) : formsError ? (
              <div className="rounded-ds-card border border-ds-danger bg-ds-danger-bg p-4 text-sm text-ds-danger">{formsError}</div>
            ) : timeline.length === 0 ? (
              <div className="flex min-h-28 items-center justify-center rounded-ds-card border border-ds-border border-dashed text-sm text-ds-ink-muted">
                <CheckCircle2 className="mr-2 h-4 w-4 text-ds-ok" />
                Nenhuma rotina para hoje.
              </div>
            ) : (
              <div className="space-y-4">
                {timeline.map((entry, index) => (
                  <div key={entry.key}>{entry.render(index === timeline.length - 1)}</div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right column — sidebar */}
        <aside className="space-y-4">
          <SidebarEscala
            shifts={effectiveShifts}
            loading={loadingCollaboratorData}
            error={collaboratorDataError}
            showMockup={showMockup}
          />
          <SidebarMetas
            loading={loadingCollaboratorData}
            goals={visibleGoals}
            periods={activePeriods}
            allGoals={effectiveEmployeeGoals}
            distributionSnapshot={distributionSnapshot}
            showMockup={showMockup}
          />
          <SidebarComunicados showMockup={showMockup} />
        </aside>
      </div>
    </section>

    <Dialog
      open={!!confirmingReceipt}
      onOpenChange={(open) => {
        if (!open && !isConfirmingReceipt) setConfirmingReceipt(null);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirmar recebimento</DialogTitle>
          {confirmingReceipt ? (
            <DialogDescription>{confirmingReceipt.description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <p className="text-sm text-ds-ink-muted">
          Isso registra <strong>tudo recebido conforme enviado</strong>, sem divergência, e conclui a tarefa.
          Se algo chegou a menos ou a mais, abra a tela de recebimento pelo texto do card para ajustar.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setConfirmingReceipt(null)} disabled={isConfirmingReceipt}>
            Cancelar
          </Button>
          <Button
            className="bg-ds-accent text-white hover:bg-ds-accent-hover"
            onClick={handleQuickConfirmReceipt}
            disabled={isConfirmingReceipt}
          >
            {isConfirmingReceipt ? "Confirmando..." : "Confirmar recebimento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

export function CollaboratorDashboardPanel() {
  return <CollaboratorDashboardPanelInner />;
}
