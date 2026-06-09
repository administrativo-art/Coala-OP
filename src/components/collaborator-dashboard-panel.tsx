"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  ListOrdered,
  Loader2,
  Target,
} from "lucide-react";
import { collection, collectionGroup, getDocs, query, where } from "firebase/firestore";
import { eachDayOfInterval, endOfMonth, format, isSameDay, startOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";

import { fetchMyFormExecutions } from "@/features/forms/lib/client";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/use-auth";
import { useGoals } from "@/contexts/goals-context";
import { GoalsProvider } from "@/components/goals-provider";
import { useDPStore } from "@/store/use-dp-store";
import type { DPShift, EmployeeGoal, GoalPeriodDoc } from "@/types";
import type { FormExecution } from "@/types/forms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

function dateKey(value: Date) {
  return format(value, "yyyy-MM-dd");
}

function money(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function percent(value: number, target: number) {
  if (target <= 0) return 0;
  return (value / target) * 100;
}

const STATUS_LABELS: Record<FormExecution["status"], string> = {
  pending: "Pendente",
  in_progress: "Em andamento",
  completed: "Concluído",
  overdue: "Atrasado",
  canceled: "Cancelado",
};

const STATUS_CLASS: Record<FormExecution["status"], string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-700",
  in_progress: "border-blue-200 bg-blue-50 text-blue-700",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  overdue: "border-red-200 bg-red-50 text-red-700",
  canceled: "border-slate-200 bg-slate-100 text-slate-600",
};

function formatDateTime(value: unknown) {
  if (!value) return "-";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function SummaryTile({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-muted/20 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function ScheduleSummary({ shifts, loading, error }: { shifts: DPShift[]; loading: boolean; error: string | null }) {
  const { units, shiftDefinitions, schedules } = useDPStore();
  const today = new Date();
  const todayKey = dateKey(today);
  const orderedShifts = useMemo(
    () => [...shifts].sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`)),
    [shifts]
  );
  const workShifts = orderedShifts.filter((shift) => shift.type !== "day_off");
  const todayShifts = workShifts.filter((shift) => shift.date === todayKey);
  const upcomingShifts = workShifts.filter((shift) => shift.date >= todayKey).slice(0, 8);
  const nextShift = upcomingShifts[0] ?? null;
  const unitIds = Array.from(new Set(workShifts.map((shift) => shift.unitId).filter(Boolean)));
  const unitLabel =
    unitIds
      .map((unitId) => units.find((unit) => unit.id === unitId)?.name ?? unitId)
      .filter(Boolean)
      .join(", ") || "Não definida";

  const describeShift = (shift: DPShift) => {
    const definition = shift.shiftDefinitionId
      ? shiftDefinitions.find((item) => item.id === shift.shiftDefinitionId)
      : null;
    const schedule = schedules.find((item) => item.id === shift.scheduleId);
    const unit = units.find((item) => item.id === shift.unitId);
    return {
      date: format(new Date(`${shift.date}T12:00:00`), "eee, dd/MM", { locale: ptBR }).replace(/^\w/, (c) => c.toUpperCase()),
      time: `${shift.startTime} - ${shift.endTime}`,
      name: definition?.name ?? (shift.type === "day_off" ? "Folga" : "Turno"),
      unit: unit?.name ?? schedule?.name ?? shift.unitId,
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
      <div className="grid gap-3 py-2 md:grid-cols-3">
        <SummaryTile label="Hoje" value={todayShifts.length ? `${todayShifts.length} turno(s)` : "Sem turno"} />
        <SummaryTile label="Unidade" value={unitLabel} />
        <SummaryTile label="Próximo turno" value={nextShift ? describeShift(nextShift).time : "Não previsto"} />
      </div>

      <div className="overflow-hidden rounded-xl border bg-white">
        <div className="grid grid-cols-[1fr_1fr_1.2fr] border-b bg-muted/30 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          <span>Dia</span>
          <span>Turno</span>
          <span>Unidade</span>
        </div>
        {upcomingShifts.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">Nenhum turno encontrado para este mês.</div>
        ) : (
          upcomingShifts.map((shift) => {
            const detail = describeShift(shift);
            const isToday = shift.date === todayKey;
            return (
              <div key={shift.id} className={`grid grid-cols-[1fr_1fr_1.2fr] border-b px-4 py-3 text-sm last:border-b-0 ${isToday ? "bg-pink-50/60" : ""}`}>
                <span className={isToday ? "font-semibold text-primary" : "font-medium"}>{detail.date}</span>
                <span>
                  <span className="font-semibold">{detail.name}</span>
                  <span className="block text-xs text-muted-foreground">{detail.time}</span>
                </span>
                <span className="text-muted-foreground">{detail.unit}</span>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}

function GoalProgressRow({
  goal,
  period,
}: {
  goal: EmployeeGoal;
  period: GoalPeriodDoc;
}) {
  const pct = percent(goal.currentValue, goal.targetValue);
  const upTarget = goal.targetValue * 1.2;
  const upPct = percent(goal.currentValue, upTarget);
  const periodStart = period.startDate?.toDate?.() ?? new Date();
  const periodEnd = period.endDate?.toDate?.() ?? new Date();
  const days = eachDayOfInterval({ start: periodStart, end: periodEnd });
  const today = new Date();
  const elapsedDays = days.filter((day) => day <= today);
  const dailyTarget = goal.targetValue / Math.max(days.length, 1);
  const hitCount = elapsedDays.filter((day) => (goal.dailyProgress?.[dateKey(day)] ?? 0) >= dailyTarget).length;

  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="font-semibold">Meta da unidade</p>
          <p className="text-xs text-muted-foreground">
            {format(periodStart, "dd/MM", { locale: ptBR })} - {format(periodEnd, "dd/MM/yyyy", { locale: ptBR })}
          </p>
        </div>
        <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">{period.status === "active" ? "Ativa" : period.status}</Badge>
      </div>

      <div className="grid gap-2 md:grid-cols-4">
        <SummaryTile label="Acumulado" value={money(goal.currentValue)} />
        <SummaryTile label="% meta" value={`${pct.toFixed(1)}%`} />
        <SummaryTile label="% meta up" value={`${upPct.toFixed(1)}%`} />
        <SummaryTile label="Dias batidos" value={`${hitCount}/${elapsedDays.length}`} />
      </div>

      <div className="space-y-2 rounded-xl border bg-muted/20 p-4">
        <div className="flex justify-between text-xs font-semibold text-muted-foreground">
          <span>Meta · {money(goal.targetValue)}</span>
          <span>{pct.toFixed(1)}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(pct, 100)}%` }} />
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
          const pastOrToday = day <= today;
          const hit = pastOrToday && value >= dailyTarget;
          return (
            <div key={key} className={`grid grid-cols-[1fr_1fr_1fr_48px] border-b px-4 py-2 text-xs last:border-b-0 ${isSameDay(day, today) ? "bg-pink-50/60" : ""}`}>
              <span className="font-medium">{format(day, "eee dd/MM", { locale: ptBR }).replace(/^\w/, (c) => c.toUpperCase())}</span>
              <span className="text-right text-muted-foreground">{money(dailyTarget)}</span>
              <span className={`text-right font-semibold ${value > 0 ? "text-foreground" : "text-muted-foreground"}`}>{pastOrToday ? money(value) : "-"}</span>
              <span className="text-center">{!pastOrToday ? "-" : hit ? "✓" : value > 0 ? "!" : "•"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GoalsSummary({
  loading,
  goals,
  periods,
}: {
  loading: boolean;
  goals: EmployeeGoal[];
  periods: GoalPeriodDoc[];
}) {
  if (loading) {
    return (
      <div className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Carregando metas...
      </div>
    );
  }

  if (goals.length === 0) {
    return <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">Nenhuma meta ativa encontrada para o colaborador ou unidade vinculada.</div>;
  }

  return (
    <div className="space-y-4">
      {goals.map((goal) => {
        const period = periods.find((item) => item.id === goal.periodId);
        if (!period) return null;
        return <GoalProgressRow key={goal.id} goal={goal} period={period} />;
      })}
    </div>
  );
}

function FormExecutionRow({ execution }: { execution: FormExecution }) {
  return (
    <Link href={`/dashboard/forms/${execution.id}/view`} className="block">
      <div className="rounded-xl border p-4 transition-colors hover:bg-muted/40">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold">{execution.template_name}</p>
              <Badge className={STATUS_CLASS[execution.status]}>{STATUS_LABELS[execution.status]}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {execution.unit_name ?? execution.unit_id}
              {execution.shift_definition_name ? ` · ${execution.shift_definition_name}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground md:text-right">
            <Clock className="h-3.5 w-3.5" />
            {formatDateTime(execution.due_at)}
          </div>
        </div>
      </div>
    </Link>
  );
}

function RoutineCard({
  title,
  description,
  icon,
  badge,
  children,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  badge: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className="h-full text-left">
          <Card className="h-full border-muted/50 shadow-sm transition-all hover:border-primary/20 hover:shadow-md">
            <CardContent className="flex h-full flex-col gap-4 p-5">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-primary/10 p-3 text-primary">{icon}</div>
                <div className="min-w-0">
                  <h3 className="font-semibold">{title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{description}</p>
                </div>
              </div>
              <div className="mt-auto flex items-center justify-between">
                <Badge variant="secondary">{badge}</Badge>
                <span className="inline-flex items-center text-sm font-medium">
                  Abrir resumo
                  <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </span>
              </div>
            </CardContent>
          </Card>
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[86vh] overflow-y-auto sm:max-w-3xl">
        {children}
      </DialogContent>
    </Dialog>
  );
}

function CollaboratorDashboardPanelInner() {
  const { firebaseUser, permissions, user } = useAuth();
  const { periods, employeeGoals, loading: goalsLoading } = useGoals();
  const { schedules } = useDPStore();
  const [executions, setExecutions] = useState<FormExecution[]>([]);
  const [loadingForms, setLoadingForms] = useState(true);
  const [formsError, setFormsError] = useState<string | null>(null);
  const [shifts, setShifts] = useState<DPShift[]>([]);
  const [loadingSchedule, setLoadingSchedule] = useState(true);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

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
      if (!firebaseUser) {
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
        const shiftsQuery = query(
          collectionGroup(db, "shifts"),
          where("userId", "==", firebaseUser.uid),
          where("date", ">=", start),
          where("date", "<=", end)
        );
        const snap = await getDocs(shiftsQuery);
        if (!cancelled) {
          setShifts(snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as DPShift)));
        }
      } catch (error) {
        try {
          const currentMonthSchedules = schedules.filter(
            (schedule) => schedule.month === now.getMonth() + 1 && schedule.year === now.getFullYear()
          );
          const nested = await Promise.all(
            currentMonthSchedules.map(async (schedule) => {
              const snap = await getDocs(collection(db, "dp_schedules", schedule.id, "shifts"));
              return snap.docs
                .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as DPShift))
                .filter((shift) => shift.userId === firebaseUser.uid && shift.date >= start && shift.date <= end);
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
  }, [firebaseUser, schedules]);

  const groups = useMemo(
    () => ({
      pending: executions.filter((execution) => execution.status === "pending" || execution.status === "overdue"),
      inProgress: executions.filter((execution) => execution.status === "in_progress"),
      completed: executions.filter((execution) => execution.status === "completed"),
    }),
    [executions]
  );

  const canOpenStockCount = !!(permissions.stock?.stockCount?.view || permissions.stock?.stockCount?.perform);
  const canOpenSchedule = !!permissions.dp?.schedules?.view;
  const canOpenGoals = !!permissions.goals?.view;
  const userGoalKioskIds = useMemo(() => new Set([...(user?.assignedKioskIds ?? [])]), [user?.assignedKioskIds]);
  const activePeriods = useMemo(() => periods.filter((period) => period.status === "active"), [periods]);
  const visibleGoals = useMemo(() => {
    const ownGoals = employeeGoals.filter((goal) => goal.employeeId === firebaseUser?.uid && activePeriods.some((period) => period.id === goal.periodId));
    if (ownGoals.length > 0) return ownGoals;
    return employeeGoals.filter((goal) => userGoalKioskIds.has(goal.kioskId) && activePeriods.some((period) => period.id === goal.periodId));
  }, [activePeriods, employeeGoals, firebaseUser?.uid, userGoalKioskIds]);

  return (
    <section id="painel-colaborador" className="scroll-mt-6 space-y-4">
      <div className="flex flex-col gap-2 border-b border-border/50 pb-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-3 inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
            Painel do colaborador
          </div>
          <h2 className="text-2xl font-bold tracking-tight">Rotinas do dia</h2>
          <p className="text-sm text-muted-foreground">
            Formulários, contagem, escala e metas resolvidos neste painel, sem depender da navegação completa dos módulos.
          </p>
        </div>
      </div>

      <Card className="border-muted/50 shadow-sm">
        <CardHeader className="border-b border-muted/30 pb-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ClipboardCheck className="h-5 w-5 text-primary" />
                Formulários a preencher
              </CardTitle>
              <CardDescription>Pendentes e atrasados atribuídos ao colaborador.</CardDescription>
            </div>
            <Badge className={groups.pending.length > 0 ? "border-amber-200 bg-amber-50 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}>
              {groups.pending.length} pendente(s)
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-4">
          {loadingForms ? (
            <div className="flex min-h-28 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Carregando formulários...
            </div>
          ) : formsError ? (
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
              {formsError}
            </div>
          ) : groups.pending.length === 0 ? (
            <div className="flex min-h-28 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
              <CheckCircle2 className="mr-2 h-4 w-4 text-emerald-600" />
              Nenhum formulário pendente agora.
            </div>
          ) : (
            <div className="space-y-3">
              {groups.pending.slice(0, 3).map((execution) => (
                <FormExecutionRow key={execution.id} execution={execution} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <RoutineCard
          title="Contagem"
          description="Resumo da rotina de contagem do colaborador."
          icon={<ListOrdered className="h-5 w-5" />}
          badge={canOpenStockCount ? "Disponível" : "Resumo"}
        >
          <DialogHeader>
            <DialogTitle>Contagem de estoque</DialogTitle>
            <DialogDescription>Entrada rápida para executar ou acompanhar a contagem operacional.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2 md:grid-cols-3">
            <SummaryTile label="Status" value={canOpenStockCount ? "Liberada" : "Sem acesso direto"} />
            <SummaryTile label="Sessões" value="Painel" />
            <SummaryTile label="Ação" value="Contar" />
          </div>
          <div className="rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground">
            A contagem aparece aqui como rotina do colaborador. Quando houver uma sessão direcionada para ele, este card deve priorizar essa sessão antes de abrir o módulo completo.
          </div>
          {canOpenStockCount ? (
            <div className="flex justify-end">
              <Button asChild>
                <Link href="/dashboard/stock/count">Abrir contagem</Link>
              </Button>
            </div>
          ) : null}
        </RoutineCard>

        <RoutineCard
          title="Minha escala"
          description="Resumo de turnos e período atual."
          icon={<CalendarDays className="h-5 w-5" />}
          badge={canOpenSchedule ? "Disponível" : "Resumo"}
        >
          <DialogHeader>
            <DialogTitle>Minha escala</DialogTitle>
            <DialogDescription>Resumo operacional da escala do colaborador.</DialogDescription>
          </DialogHeader>
          <ScheduleSummary shifts={shifts} loading={loadingSchedule} error={scheduleError} />
          {canOpenSchedule ? (
            <div className="flex justify-end">
              <Button asChild>
                <Link href="/dashboard/dp/schedules">Abrir escala completa</Link>
              </Button>
            </div>
          ) : null}
        </RoutineCard>

        <RoutineCard
          title="Metas"
          description="Resumo das metas vinculadas ao colaborador."
          icon={<Target className="h-5 w-5" />}
          badge={canOpenGoals ? "Disponível" : "Resumo"}
        >
          <DialogHeader>
            <DialogTitle>Minhas metas</DialogTitle>
            <DialogDescription>Resumo das metas operacionais associadas ao usuário.</DialogDescription>
          </DialogHeader>
          <GoalsSummary loading={goalsLoading} goals={visibleGoals} periods={activePeriods} />
          {canOpenGoals ? (
            <div className="flex justify-end">
              <Button asChild>
                <Link href="/dashboard/goals/tracking">Abrir metas completas</Link>
              </Button>
            </div>
          ) : null}
        </RoutineCard>
      </div>
    </section>
  );
}

export function CollaboratorDashboardPanel() {
  return (
    <GoalsProvider>
      <CollaboratorDashboardPanelInner />
    </GoalsProvider>
  );
}
