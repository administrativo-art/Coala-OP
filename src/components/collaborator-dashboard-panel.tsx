"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  AlertTriangle,
  Bell,
  CalendarDays,
  CheckCircle2,
  CheckSquare,
  ChevronRight,
  Clock,
  FileText,
  Flag,
  ListOrdered,
  Loader2,
  MapPin,
  Minus,
  Plus,
} from "lucide-react";
import { collection, collectionGroup, getDocs, query, where } from "firebase/firestore";
import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isWithinInterval,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ptBR } from "date-fns/locale";

import { fetchMyFormExecutions } from "@/features/forms/lib/client";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/use-auth";
import { useAllTasks } from "@/hooks/use-all-tasks";
import { useReposition } from "@/hooks/use-reposition";
import { useToast } from "@/hooks/use-toast";
import { useGoals } from "@/contexts/goals-context";
import { GoalsProvider } from "@/components/goals-provider";
import { useStockAudit } from "@/hooks/use-stock-audit";
import { useKiosks } from "@/hooks/use-kiosks";
import { useDPStore } from "@/store/use-dp-store";
import type { DPShift, EmployeeGoal, GoalPeriodDoc, RepositionActivity, StockAuditItem, StockAuditSession } from "@/types";
import type { FormExecution } from "@/types/forms";
import {
  getEmployeeDistributionDateKeys,
  loadGoalDistributionSnapshot,
  type GoalDistributionSnapshot,
} from "@/lib/goals-distribution";
import { formatStockExpiryDate, getStockExpiryAlert, getStockExpirySummary, type StockExpiryAlertLevel } from "@/lib/stock-expiry-alert";
import { Badge } from "@/components/ui/badge";
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
      return "border-red-200 bg-red-50 text-red-700";
    case "urgent":
      return "border-orange-200 bg-orange-50 text-orange-700";
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "ok":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "none":
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

function normalizeIdentity(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
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
  pending: "text-amber-600",
  in_progress: "text-blue-600",
  completed: "text-emerald-600",
  overdue: "text-red-500",
  canceled: "text-slate-500",
};

const STATUS_DOT: Record<FormExecution["status"], string> = {
  pending: "bg-amber-500",
  in_progress: "bg-blue-500",
  completed: "bg-emerald-500",
  overdue: "bg-red-500",
  canceled: "bg-slate-400",
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

/* -------------------------------------------------------------------------- */
/* Live clock                                                                 */
/* -------------------------------------------------------------------------- */

function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-sm font-medium tabular-nums text-muted-foreground">
      <Clock className="h-3.5 w-3.5" />
      {now ? format(now, "HH:mm") : "--:--"}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Progress ring                                                              */
/* -------------------------------------------------------------------------- */

function ProgressRing({ value, total, done }: { value: number; total: number; done: boolean }) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const ratio = total > 0 ? Math.min(value / total, 1) : 0;
  const dash = circumference * ratio;

  return (
    <div className="relative h-[84px] w-[84px] shrink-0">
      <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
        <circle cx="40" cy="40" r={radius} fill="none" strokeWidth="6" className="stroke-[#ece9fb]" />
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          className={done ? "stroke-emerald-500" : "stroke-indigo-600"}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-lg font-bold tracking-tight">
          {value}
          <span className="font-medium text-muted-foreground">/{total}</span>
        </span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Timeline                                                                   */
/* -------------------------------------------------------------------------- */

const TYPE_BADGE = {
  form: { label: "Formulário", icon: FileText, className: "bg-indigo-50 text-indigo-700" },
  task: { label: "Tarefa", icon: CheckSquare, className: "bg-teal-50 text-teal-700" },
  count: { label: "Contagem", icon: ListOrdered, className: "bg-violet-50 text-violet-700" },
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
  completed?: boolean;
  action: React.ReactNode;
  isLast: boolean;
}) {
  const badge = TYPE_BADGE[type];
  const BadgeIcon = badge.icon;
  return (
    <div className="grid grid-cols-[52px_1fr] gap-3">
      <div className="relative flex flex-col items-end pr-1 pt-3.5">
        <span className={`font-mono text-xs tabular-nums ${timeOverdue ? "font-semibold text-red-500" : "text-muted-foreground"}`}>
          {time}
        </span>
        <span className={`absolute right-[-13px] top-4 h-2.5 w-2.5 rounded-full ring-4 ring-background ${dot}`} />
        {!isLast ? <span className="absolute right-[-8px] top-7 h-[calc(100%+0.75rem)] w-px bg-border" /> : null}
      </div>

      <div className="rounded-xl border bg-white p-4 shadow-sm">
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
            </div>
            {titleHref ? (
              <Link href={titleHref} className="group/title block">
                <h4 className={`mt-2 font-semibold underline-offset-2 group-hover/title:underline ${completed ? "text-muted-foreground line-through" : ""}`}>{title}</h4>
                {meta ? <p className="mt-0.5 text-xs text-muted-foreground group-hover/title:text-foreground">{meta}</p> : null}
              </Link>
            ) : (
              <>
                <h4 className={`mt-2 font-semibold ${completed ? "text-muted-foreground line-through" : ""}`}>{title}</h4>
                {meta ? <p className="mt-0.5 text-xs text-muted-foreground">{meta}</p> : null}
              </>
            )}
          </div>
          <div className="shrink-0">{action}</div>
        </div>
      </div>
    </div>
  );
}

function TimelineMarker({ time, label, now, isLast }: { time: string; label: string; now?: boolean; isLast: boolean }) {
  return (
    <div className="grid grid-cols-[52px_1fr] gap-3">
      <div className="relative flex flex-col items-end pr-1 pt-0.5">
        <span className={`font-mono text-xs tabular-nums ${now ? "font-semibold text-indigo-600" : "text-muted-foreground/70"}`}>
          {time}
        </span>
        <span
          className={`absolute right-[-13px] top-1 h-2.5 w-2.5 rounded-full ring-4 ring-background ${
            now ? "bg-indigo-600" : "bg-muted-foreground/30"
          }`}
        />
        {!isLast ? <span className="absolute right-[-8px] top-3.5 h-[calc(100%+0.75rem)] w-px bg-border" /> : null}
      </div>
      <div className="pt-0.5">
        <span className={`text-sm ${now ? "font-semibold uppercase tracking-[0.12em] text-indigo-600" : "text-muted-foreground"}`}>
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
    <div className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-indigo-600 p-2.5 text-white">
          <FileText className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-600">
            Próxima ação{overdue ? " · Atrasada" : ""}
          </p>
          <p className="truncate font-semibold">
            {execution.template_name}
            {time ? <span className="font-normal text-muted-foreground"> · até {time}</span> : null}
          </p>
        </div>
      </div>
      <Button asChild className="bg-indigo-600 text-white hover:bg-indigo-700 sm:shrink-0">
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
  const canSubmit = total > 0 && counted === total && !saving;
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
      await updateAuditSession(session.id, { items: updatedItems });
      setSaved(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Falha ao enviar a contagem.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {session.kioskName} · iniciada {format(new Date(session.startedAt), "dd/MM 'às' HH:mm", { locale: ptBR })}
        </p>
        <span className="text-sm font-semibold">
          {counted}/{total} <span className="font-normal text-muted-foreground">itens</span>
        </span>
      </div>

      {expirySummary.attention > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="flex flex-wrap items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
            <span className="font-semibold">Atenção de validade</span>
            {expirySummary.expired > 0 ? <Badge variant="outline" className={stockExpiryBadgeClass("expired")}>{expirySummary.expired} vencido(s)</Badge> : null}
            {expirySummary.today > 0 ? <Badge variant="outline" className={stockExpiryBadgeClass("today")}>{expirySummary.today} vence(m) hoje</Badge> : null}
            {expirySummary.urgent > 0 ? <Badge variant="outline" className={stockExpiryBadgeClass("urgent")}>{expirySummary.urgent} em até 7 dias</Badge> : null}
            {expirySummary.warning > 0 ? <Badge variant="outline" className={stockExpiryBadgeClass("warning")}>{expirySummary.warning} em até 30 dias</Badge> : null}
          </div>
          <p className="mt-1 text-xs text-amber-800/80">Aviso apenas visual; não altera a quantidade contada.</p>
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
              className={`flex items-center justify-between gap-3 rounded-xl border p-3 ${isTouched ? "border-indigo-200 bg-indigo-50/40" : ""}`}
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{item.productName}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <p className="text-xs text-muted-foreground">{item.displayUnit} · Val: {formatStockExpiryDate(item.expiryDate)}</p>
                  <Badge variant="outline" className={stockExpiryBadgeClass(expiryAlert.level)}>{expiryAlert.label}</Badge>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => adjust(item, -1)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border bg-white text-muted-foreground transition-colors hover:bg-muted"
                  aria-label="Diminuir"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span
                  className={`flex h-9 w-14 items-center justify-center rounded-lg border text-center font-mono text-sm tabular-nums ${
                    isTouched ? "border-indigo-300 bg-white" : "bg-white text-muted-foreground"
                  }`}
                >
                  {isTouched ? quantities[key] ?? 0 : "—"}
                </span>
                <button
                  type="button"
                  onClick={() => adjust(item, 1)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border bg-white text-muted-foreground transition-colors hover:bg-muted"
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
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{saveError}</div>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {saved ? "Contagem enviada com sucesso." : `Conte todos os itens para enviar (${counted}/${total}).`}
        </p>
        <Button onClick={submit} disabled={!canSubmit} className="bg-indigo-600 text-white hover:bg-indigo-700">
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {saved ? "Enviado" : "Enviar contagem"}
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
      dot="bg-amber-500"
      statusLabel="Pendente"
      statusClass="text-amber-600"
      title={`Contagem · ${session.kioskName}`}
      meta={`${session.items.length} ${session.items.length === 1 ? "item" : "itens"}`}
      action={
        <Dialog>
          <DialogTrigger asChild>
            <Button size="sm" className="bg-indigo-600 text-white hover:bg-indigo-700">
              Contar
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[86vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Contagem direcionada</DialogTitle>
              <DialogDescription>Conte apenas os itens da sua sessão e envie quando completar a lista.</DialogDescription>
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
/* Full schedule (dialog)                                                     */
/* -------------------------------------------------------------------------- */

function ScheduleTable({ shifts, loading, error }: { shifts: DPShift[]; loading: boolean; error: string | null }) {
  const { units, shiftDefinitions } = useDPStore();
  const today = new Date();
  const todayKey = dateKey(today);
  const orderedShifts = useMemo(
    () => [...shifts].sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`)),
    [shifts]
  );
  const workShifts = orderedShifts.filter((shift) => shift.type !== "day_off");
  const unitIds = Array.from(new Set(workShifts.map((shift) => shift.unitId).filter(Boolean)));
  const unitLabel =
    unitIds
      .map((unitId) => units.find((unit) => unit.id === unitId)?.name ?? unitId)
      .filter(Boolean)
      .join(", ") || "Unidade não definida";
  const monthLabel = format(today, "MMMM 'de' yyyy", { locale: ptBR }).replace(/^\w/, (c) => c.toUpperCase());

  const describeShift = (shift: DPShift) => {
    const definition = shift.shiftDefinitionId
      ? shiftDefinitions.find((item) => item.id === shift.shiftDefinitionId)
      : null;
    const isOff = shift.type === "day_off";
    return {
      day: format(new Date(`${shift.date}T12:00:00`), "eee dd/MM", { locale: ptBR }).replace(/^\w/, (c) => c.toUpperCase()),
      time: isOff ? "" : `${shift.startTime} — ${shift.endTime}`,
      name: definition?.name ?? (isOff ? "Folga" : "Turno"),
      isOff,
    };
  };

  if (loading) {
    return (
      <div className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Carregando escala...
      </div>
    );
  }

  if (error) {
    return <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>;
  }

  return (
    <>
      <p className="text-sm text-muted-foreground">
        {unitLabel} · {workShifts.length} turno(s) em {monthLabel}
      </p>

      <div className="overflow-hidden rounded-xl border bg-white">
        <div className="grid grid-cols-[1.1fr_1fr_1fr] border-b bg-muted/30 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          <span>Dia</span>
          <span>Turno</span>
          <span>Horário</span>
        </div>
        {orderedShifts.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">Nenhum turno encontrado para este mês.</div>
        ) : (
          orderedShifts.map((shift) => {
            const detail = describeShift(shift);
            const isToday = shift.date === todayKey;
            const isPast = shift.date < todayKey;
            return (
              <div
                key={shift.id}
                className={`grid grid-cols-[1.1fr_1fr_1fr] items-center border-b px-4 py-3 text-sm last:border-b-0 ${
                  isToday ? "bg-indigo-50/70" : ""
                } ${isPast ? "text-muted-foreground/60" : ""}`}
              >
                <span className={`flex items-center gap-2 ${isToday ? "font-semibold text-indigo-700" : "font-medium"}`}>
                  {detail.day}
                  {isToday ? (
                    <span className="rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                      Hoje
                    </span>
                  ) : null}
                </span>
                <span className={detail.isOff ? "italic text-muted-foreground" : "font-medium"}>{detail.name}</span>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">{detail.time || "—"}</span>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Full goals (dialog)                                                        */
/* -------------------------------------------------------------------------- */

function RecorteTile({ label, pct, value, target }: { label: string; pct: number; value: number; target: number }) {
  return (
    <div className="rounded-xl border bg-muted/20 p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight">{pct.toFixed(0)}%</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {money(value)} de {money(target)}
      </p>
    </div>
  );
}

function GoalProgressRow({
  goal,
  period,
  unitName,
  distributionSnapshot,
}: {
  goal: EmployeeGoal & { originalGoals?: EmployeeGoal[] };
  period: GoalPeriodDoc;
  unitName?: string;
  distributionSnapshot?: GoalDistributionSnapshot | null;
}) {
  const pct = percent(goal.currentValue, goal.targetValue);
  const upTarget = goal.targetValue * 1.2;
  const upPct = percent(goal.currentValue, upTarget);
  const recortes = goalRecortes(goal, period, distributionSnapshot);
  const { periodStart, periodEnd, days, dailyTarget, dailyTargets } = recortes;
  const today = new Date();
  const elapsedDays = days.filter((day) => day <= today);
  const hitCount = elapsedDays.filter((day) => {
    const key = dateKey(day);
    return (goal.dailyProgress?.[key] ?? 0) >= (dailyTargets[key] ?? dailyTarget);
  }).length;

  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="font-semibold">{unitName ?? "Meta da unidade"}</p>
          <p className="text-xs text-muted-foreground">
            período {format(periodStart, "eee dd/MM", { locale: ptBR }).replace(/^\w/, (c) => c.toUpperCase())} –{" "}
            {format(periodEnd, "eee dd/MM/yyyy", { locale: ptBR }).replace(/^\w/, (c) => c.toUpperCase())}
          </p>
        </div>
        <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">
          {period.status === "active" ? "Ativa" : period.status}
        </Badge>
      </div>

      <div className="grid gap-2 md:grid-cols-3">
        <RecorteTile label="Meta · Hoje" pct={recortes.today.pct} value={recortes.today.value} target={recortes.today.target} />
        <RecorteTile label="Meta · Semana" pct={recortes.semana.pct} value={recortes.semana.value} target={recortes.semana.target} />
        <RecorteTile label="Meta · Mês" pct={recortes.mes.pct} value={recortes.mes.value} target={recortes.mes.target} />
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <div className="rounded-xl border bg-muted/20 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">% Meta UP</p>
          <p className="mt-1 text-2xl font-bold tracking-tight">{upPct.toFixed(1)}%</p>
          <p className="mt-1 text-xs text-muted-foreground">alvo {money(upTarget)}</p>
        </div>
        <div className="rounded-xl border bg-muted/20 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Dias batidos</p>
          <p className="mt-1 text-2xl font-bold tracking-tight">
            {hitCount}/{elapsedDays.length}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">alvo diário atingido</p>
        </div>
      </div>

      <div className="space-y-2 rounded-xl border bg-muted/20 p-4">
        <div className="flex justify-between text-xs font-semibold text-muted-foreground">
          <span>Meta · {money(goal.targetValue)}</span>
          <span>{pct.toFixed(1)}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-indigo-600" style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
        <div className="flex justify-between text-xs font-semibold text-blue-500">
          <span>Meta UP · {money(upTarget)}</span>
          <span>{upPct.toFixed(1)}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-blue-100">
          <div className="h-full rounded-full bg-blue-400" style={{ width: `${Math.min(upPct, 100)}%` }} />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border">
        <div className="grid grid-cols-[1fr_1fr_1fr_48px] bg-muted/30 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
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
                isSameDay(day, today) ? "bg-indigo-50/70" : ""
              }`}
            >
              <span className="font-medium">{format(day, "eee dd/MM", { locale: ptBR }).replace(/^\w/, (c) => c.toUpperCase())}</span>
              <span className="text-right text-muted-foreground">{money(dayTarget)}</span>
              <span className={`text-right font-semibold ${value > 0 ? "text-foreground" : "text-muted-foreground"}`}>
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
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span className="text-muted-foreground">{icon}</span>
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
}: {
  shifts: DPShift[];
  loading: boolean;
  error: string | null;
}) {
  const { shiftDefinitions } = useDPStore();
  const todayKey = dateKey(new Date());
  const upcoming = useMemo(() => {
    return [...shifts]
      .filter((shift) => shift.type !== "day_off" && shift.date >= todayKey)
      .sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`))
      .slice(0, 5);
  }, [shifts, todayKey]);

  return (
    <SidebarCard
      icon={<CalendarDays className="h-4 w-4" />}
      title="Escala"
      action={
        <Dialog>
          <DialogTrigger asChild>
            <button type="button" className="text-xs font-medium text-indigo-600 hover:underline">
              Ver mês
            </button>
          </DialogTrigger>
          <DialogContent className="max-h-[86vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Minha escala</DialogTitle>
              <DialogDescription>Turnos, horários e folgas do mês.</DialogDescription>
            </DialogHeader>
            <ScheduleTable shifts={shifts} loading={loading} error={error} />
          </DialogContent>
        </Dialog>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          Carregando...
        </div>
      ) : upcoming.length === 0 ? (
        <p className="py-2 text-xs text-muted-foreground">Nenhum turno próximo.</p>
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
                <span className={isToday ? "font-semibold text-indigo-600" : "text-muted-foreground"}>
                  {label}
                  {definition?.name ? <span className="ml-1.5 text-xs text-muted-foreground/70">{definition.name}</span> : null}
                </span>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
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

function SidebarMetas({
  loading,
  goals,
  periods,
  distributionSnapshot,
}: {
  loading: boolean;
  goals: Array<EmployeeGoal & { originalGoals?: EmployeeGoal[] }>;
  periods: GoalPeriodDoc[];
  distributionSnapshot?: GoalDistributionSnapshot | null;
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
          <div className="rounded-2xl border bg-white p-4 shadow-sm transition-colors hover:border-indigo-200 hover:bg-muted/20">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Flag className="h-4 w-4 text-muted-foreground" />
                Metas
              </div>
              <span className="inline-flex items-center text-xs font-medium text-indigo-600">
                Detalhes
                <ChevronRight className="ml-0.5 h-3.5 w-3.5" />
              </span>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                Carregando...
              </div>
            ) : rows.length === 0 ? (
              <p className="py-2 text-xs text-muted-foreground">Nenhuma meta individual cadastrada.</p>
            ) : (
              <div className="space-y-3">
                {goalUnits.length > 1 ? (
                  <p className="text-[11px] font-medium text-muted-foreground">
                    {kioskName(primary!.goal.kioskId)}
                    <span className="text-muted-foreground/60"> · +{goalUnits.length - 1} unidade(s)</span>
                  </p>
                ) : null}
                {rows.map((row) => (
                  <div key={row.label} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold uppercase tracking-[0.12em] text-muted-foreground">{row.label}</span>
                      <span className="text-muted-foreground">
                        {money(row.value)} / {money(row.target)} ·{" "}
                        <span className="font-semibold text-foreground">{row.pct.toFixed(0)}%</span>
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-indigo-600" style={{ width: `${Math.min(row.pct, 100)}%` }} />
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
          <div className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Carregando metas...
          </div>
        ) : goalUnits.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
            Nenhuma meta individual cadastrada para este colaborador no período.
          </div>
        ) : goalUnits.length === 1 ? (
          <GoalProgressRow
            goal={goalUnits[0].goal}
            period={goalUnits[0].period}
            unitName={kioskName(goalUnits[0].goal.kioskId)}
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
                  distributionSnapshot={distributionSnapshot}
                />
              </TabsContent>
            ))}
          </Tabs>
        )}

        <div className="flex justify-end border-t pt-4">
          <Button asChild className="bg-indigo-600 text-white hover:bg-indigo-700">
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

function SidebarComunicados() {
  return (
    <SidebarCard
      icon={<Bell className="h-4 w-4" />}
      title="Comunicados"
      action={<span className="text-xs font-medium text-muted-foreground/60">Em breve</span>}
    >
      <div className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">
        Os comunicados da operação aparecerão aqui.
      </div>
    </SidebarCard>
  );
}

/* -------------------------------------------------------------------------- */
/* Panel                                                                      */
/* -------------------------------------------------------------------------- */

function CollaboratorDashboardPanelInner() {
  const { firebaseUser, user } = useAuth();
  const { periods, employeeGoals, loading: goalsLoading } = useGoals();
  const { kiosks } = useKiosks();
  const { taskNotifications, pendingReceipts, completedReceipts } = useAllTasks();
  const { activities: repositionActivities, updateRepositionActivity } = useReposition();
  const { toast } = useToast();
  const { auditSessions } = useStockAudit();
  const [confirmingReceipt, setConfirmingReceipt] = useState<{ activityId: string; description: string } | null>(null);
  const [isConfirmingReceipt, setIsConfirmingReceipt] = useState(false);
  const { schedules, units, shiftDefinitions } = useDPStore();
  const [executions, setExecutions] = useState<FormExecution[]>([]);
  const [loadingForms, setLoadingForms] = useState(true);
  const [formsError, setFormsError] = useState<string | null>(null);
  const [shifts, setShifts] = useState<DPShift[]>([]);
  const [loadingSchedule, setLoadingSchedule] = useState(true);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [distributionSnapshot, setDistributionSnapshot] = useState<GoalDistributionSnapshot | null>(null);
  const [apiShifts, setApiShifts] = useState<DPShift[] | null>(null);
  const [apiPeriods, setApiPeriods] = useState<GoalPeriodDoc[] | null>(null);
  const [apiEmployeeGoals, setApiEmployeeGoals] = useState<EmployeeGoal[] | null>(null);
  const [loadingCollaboratorData, setLoadingCollaboratorData] = useState(true);
  const currentUserIds = useMemo(
    () => compactUnique([firebaseUser?.uid, user?.id, user?.registrationIdBizneo, user?.registrationIdPdv]),
    [firebaseUser?.uid, user?.id, user?.registrationIdBizneo, user?.registrationIdPdv]
  );
  const currentUserNames = useMemo(
    () => compactUnique([user?.username, firebaseUser?.displayName, firebaseUser?.email]).map(normalizeIdentity),
    [firebaseUser?.displayName, firebaseUser?.email, user?.username]
  );

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!firebaseUser) {
        setApiShifts([]);
        setApiPeriods([]);
        setApiEmployeeGoals([]);
        setLoadingCollaboratorData(false);
        return;
      }

      try {
        setLoadingCollaboratorData(true);
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
          setApiShifts(null);
          setApiPeriods(null);
          setApiEmployeeGoals(null);
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

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!firebaseUser || currentUserIds.length === 0) {
        setShifts([]);
        setLoadingSchedule(false);
        return;
      }

      const now = new Date();
      const start = dateKey(startOfMonth(now));
      const end = dateKey(endOfMonth(now));

      try {
        setLoadingSchedule(true);
        setScheduleError(null);
        const snaps = await Promise.all(
          currentUserIds.map((userId) =>
            getDocs(
              query(
                collectionGroup(db, "shifts"),
                where("userId", "==", userId),
                where("date", ">=", start),
                where("date", "<=", end)
              )
            )
          )
        );
        let foundShifts: DPShift[] = [];
        if (!cancelled) {
          const byId = new Map<string, DPShift>();
          snaps.flatMap((snap) => snap.docs).forEach((docSnap) => {
            byId.set(docSnap.ref.path, { id: docSnap.id, ...docSnap.data() } as DPShift);
          });
          foundShifts = Array.from(byId.values());
          setShifts(foundShifts);
        }

        if (foundShifts.length === 0) {
          const currentMonthSchedules = schedules.filter(
            (schedule) => schedule.month === now.getMonth() + 1 && schedule.year === now.getFullYear()
          );
          const nested = await Promise.all(
            currentMonthSchedules.map(async (schedule) => {
              const snapshotMatchedUserIds = Object.entries(schedule.snapshot?.users ?? {})
                .filter(([, snapshotUser]) => currentUserNames.includes(normalizeIdentity(snapshotUser.username)))
                .map(([userId]) => userId);
              const acceptedUserIds = new Set([...currentUserIds, ...snapshotMatchedUserIds]);
              const snap = await getDocs(collection(db, "dp_schedules", schedule.id, "shifts"));
              return snap.docs
                .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as DPShift))
                .filter((shift) => acceptedUserIds.has(shift.userId) && shift.date >= start && shift.date <= end);
            })
          );
          if (!cancelled) setShifts(nested.flat());
        }
      } catch (error) {
        try {
          const currentMonthSchedules = schedules.filter(
            (schedule) => schedule.month === now.getMonth() + 1 && schedule.year === now.getFullYear()
          );
          const nested = await Promise.all(
            currentMonthSchedules.map(async (schedule) => {
              const snapshotMatchedUserIds = Object.entries(schedule.snapshot?.users ?? {})
                .filter(([, snapshotUser]) => currentUserNames.includes(normalizeIdentity(snapshotUser.username)))
                .map(([userId]) => userId);
              const acceptedUserIds = new Set([...currentUserIds, ...snapshotMatchedUserIds]);
              const snap = await getDocs(collection(db, "dp_schedules", schedule.id, "shifts"));
              return snap.docs
                .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as DPShift))
                .filter((shift) => acceptedUserIds.has(shift.userId) && shift.date >= start && shift.date <= end);
            })
          );
          if (!cancelled) setShifts(nested.flat());
        } catch (fallbackError) {
          if (!cancelled) {
            console.error("[CollaboratorDashboardPanel] failed to load user shifts", error, fallbackError);
            setScheduleError("Falha ao carregar a escala do colaborador.");
          }
        }
      } finally {
        if (!cancelled) setLoadingSchedule(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [firebaseUser, currentUserIds, currentUserNames, schedules]);

  const today = new Date();
  const todayKey = dateKey(today);
  const nowMinutes = today.getHours() * 60 + today.getMinutes();
  const firstName = (user?.username ?? "Colaborador").split(" ")[0];
  const dateEyebrow = format(today, "EEEE, d 'de' MMMM", { locale: ptBR }).toUpperCase();
  const effectiveShifts = apiShifts ?? shifts;
  const effectivePeriods = apiPeriods ?? periods;
  const effectiveEmployeeGoals = apiEmployeeGoals ?? employeeGoals;

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
            title={execution.template_name}
            meta={`${itemCount > 0 ? `${itemCount} ${itemCount === 1 ? "item" : "itens"}` : "Formulário"}${contextLabel ? ` · ${contextLabel}` : ""}`}
            completed={completed}
            action={
              completed ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              ) : (
                <Button asChild size="sm" className="bg-indigo-600 text-white hover:bg-indigo-700">
                  <Link href={`/dashboard/forms/${execution.id}/view`}>Preencher</Link>
                </Button>
              )
            }
            isLast={isLast}
          />
        ),
      });
    });

    taskNotifications.forEach((task, index) => {
      items.push({
        sortMin: nowMinutes + 1,
        order: 2,
        key: `task-${task.id}-${index}`,
        render: (isLast) => (
          <TimelineItem
            type="task"
            time="—"
            dot="bg-amber-500"
            statusLabel="A fazer"
            statusClass="text-amber-600"
            title={task.title}
            meta={task.description}
            action={
              <Button asChild size="sm" variant="outline">
                <Link href={task.link || "/dashboard/tasks"}>Concluir</Link>
              </Button>
            }
            isLast={isLast}
          />
        ),
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
            dot="bg-amber-500"
            statusLabel="A fazer"
            statusClass="text-amber-600"
            title={receipt.title}
            titleHref={receipt.link}
            meta={receipt.description}
            action={
              <Button
                size="sm"
                className="bg-indigo-600 text-white hover:bg-indigo-700"
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
            dot="bg-emerald-500"
            statusLabel={receipt.hasDivergence ? "Concluído com divergência" : "Concluído"}
            statusClass={receipt.hasDivergence ? "text-amber-600" : "text-emerald-600"}
            title={receipt.title}
            meta={`${receipt.description} · Concluído por ${receipt.completedBy}`}
            completed
            action={<CheckCircle2 className="h-5 w-5 text-emerald-500" />}
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

    return items.sort((a, b) => a.sortMin - b.sortMin || a.order - b.order);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayExecutions, taskNotifications, pendingReceipts, completedReceipts, myOpenCountSessions, todayShift, nowMinutes]);

  const activePeriods = useMemo(() => effectivePeriods.filter((period) => period.status === "active"), [effectivePeriods]);
  const kioskNameById = useMemo(
    () => Object.fromEntries(kiosks.map((kiosk) => [kiosk.id, kiosk.name])),
    [kiosks]
  );

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (apiPeriods !== null || apiEmployeeGoals !== null) return;
      if (activePeriods.length === 0 || effectiveEmployeeGoals.length === 0) {
        setDistributionSnapshot(null);
        return;
      }

      try {
        const snapshot = await loadGoalDistributionSnapshot(activePeriods, effectiveEmployeeGoals, kioskNameById);
        if (!cancelled) setDistributionSnapshot(snapshot);
      } catch (error) {
        console.warn("[CollaboratorDashboardPanel] failed to load goal distribution snapshot", error);
        if (!cancelled) setDistributionSnapshot(null);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [activePeriods, apiEmployeeGoals, apiPeriods, effectiveEmployeeGoals, kioskNameById]);

  const visibleGoals = useMemo(() => {
    // Apenas a meta INDIVIDUAL do colaborador. Sem fallback para a meta do
    // quiosque: quem não tem meta individual cadastrada vê o estado "sem meta".
    const ownGoals = effectiveEmployeeGoals.filter(
      (goal) => currentUserIds.includes(goal.employeeId) && activePeriods.some((period) => period.id === goal.periodId)
    );
    return mergeEmployeeGoals(ownGoals);
  }, [activePeriods, currentUserIds, effectiveEmployeeGoals]);

  return (
    <>
    <section id="painel-colaborador" className="scroll-mt-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Left column */}
        <div className="space-y-6">
          {/* Greeting hero */}
          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{dateEyebrow}</p>
              <LiveClock />
            </div>
            <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <h2 className="text-3xl font-bold tracking-tight">
                  {greetingFor(today)}, {firstName}
                </h2>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                  {todayShift ? (
                    <span className="inline-flex items-center gap-2 text-sm font-medium text-indigo-600">
                      <Clock className="h-4 w-4" />
                      {todayShift.name} · {todayShift.time}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <Clock className="h-4 w-4" />
                      Sem turno hoje
                    </span>
                  )}
                  {todayShift?.unit ? (
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5" />
                      {todayShift.unit}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="flex items-center gap-4 md:shrink-0">
                <ProgressRing value={routinesDone} total={routinesTotal} done={allDone} />
                <div className="max-w-[170px]">
                  <p className="font-semibold">{allDone ? "Rotina do dia concluída" : "Rotinas do dia"}</p>
                  <p className="text-sm text-muted-foreground">
                    {loadingForms
                      ? "Carregando rotinas..."
                      : allDone
                        ? "Nada pendente. Bom turno!"
                        : routinesTotal === 0
                          ? "Nenhuma rotina para hoje."
                          : `${pendingCount} pendente(s) até o fim do turno`}
                  </p>
                </div>
              </div>
            </div>

            {!loadingForms && !formsError && nextAction ? (
              <div className="mt-6">
                <NextActionCard execution={nextAction} />
              </div>
            ) : null}
          </div>

          {/* Linha do dia */}
          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Linha do dia</p>

            {loadingForms ? (
              <div className="flex min-h-28 items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Carregando rotinas...
              </div>
            ) : formsError ? (
              <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">{formsError}</div>
            ) : timeline.length === 0 ? (
              <div className="flex min-h-28 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
                <CheckCircle2 className="mr-2 h-4 w-4 text-emerald-600" />
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
          <SidebarEscala shifts={effectiveShifts} loading={loadingCollaboratorData && apiShifts === null ? loadingSchedule : false} error={scheduleError} />
          <SidebarMetas
            loading={loadingCollaboratorData && apiEmployeeGoals === null ? goalsLoading : false}
            goals={visibleGoals}
            periods={activePeriods}
            distributionSnapshot={distributionSnapshot}
          />
          <SidebarComunicados />
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
        <p className="text-sm text-muted-foreground">
          Isso registra <strong>tudo recebido conforme enviado</strong>, sem divergência, e conclui a tarefa.
          Se algo chegou a menos ou a mais, abra a tela de recebimento pelo texto do card para ajustar.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setConfirmingReceipt(null)} disabled={isConfirmingReceipt}>
            Cancelar
          </Button>
          <Button
            className="bg-indigo-600 text-white hover:bg-indigo-700"
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
  return (
    <GoalsProvider>
      <CollaboratorDashboardPanelInner />
    </GoalsProvider>
  );
}
