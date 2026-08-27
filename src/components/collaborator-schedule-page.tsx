"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CalendarDays,
  CalendarX2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Loader2,
  MapPin,
  RefreshCw,
  Sparkles,
  Users,
} from "lucide-react";

import { BackButton } from "@/components/navigation/back-button";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

type UnitTone = {
  color: string;
  tint: string;
  border: string;
};

type CollaboratorShift = {
  id: string;
  scheduleId: string;
  unitId: string;
  unitName: string;
  unitTone: UnitTone;
  shiftDefinitionId: string | null;
  shiftName: string;
  date: string;
  startTime: string;
  endTime: string;
  type: "work" | "day_off";
};

type TeamShift = CollaboratorShift & {
  userId: string;
  employeeName: string;
  employeeRole: string;
  isCurrentUser: boolean;
};

type TeamUnit = {
  id: string;
  name: string;
  tone: UnitTone;
  shifts: TeamShift[];
};

type SchedulePayload = {
  year: number;
  month: number;
  published: boolean;
  shifts: CollaboratorShift[];
  teamUnits: TeamUnit[];
};

type ViewMode = "today" | "week" | "month" | "team";

const OFF_TONE: UnitTone = {
  color: "#64748b",
  tint: "#f1f5f9",
  border: "#e2e8f0",
};

const MORNING_TONE: UnitTone = {
  color: "#db2777",
  tint: "#fce7f3",
  border: "#fbcfe8",
};

const AFTERNOON_TONE: UnitTone = {
  color: "#7c3aed",
  tint: "#f3e8ff",
  border: "#e9d5ff",
};

const WEEKDAY_LABELS = ["D", "S", "T", "Q", "Q", "S", "S"];

function dateKey(date: Date) {
  return format(date, "yyyy-MM-dd");
}

function parseDate(key: string) {
  return new Date(`${key}T12:00:00`);
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function normalizeIdentity(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function canPreviewScheduleMockup(
  user: { username?: string | null; email?: string | null },
  firebaseUser: {
    displayName?: string | null;
    email?: string | null;
  } | null
) {
  const username = normalizeIdentity(
    user.username ?? firebaseUser?.displayName
  );
  const email = normalizeIdentity(user.email ?? firebaseUser?.email);
  return (
    username === normalizeIdentity("Tiago Brasil") ||
    email === "administrativo@coalas.com" ||
    email === "administrativo@coalashakes.com"
  );
}

function buildScheduleMockup(month: Date): CollaboratorShift[] {
  const units = [
    {
      id: "mock-joao-paulo",
      name: "Quiosque João Paulo",
      tone: { color: "#db2777", tint: "#fce7f0", border: "#fbcfe8" },
    },
  ];
  const days = eachDayOfInterval({
    start: startOfMonth(month),
    end: endOfMonth(month),
  });

  return days.map((day, index) => {
    const weekday = day.getDay();
    const isOff = weekday === 0 || weekday === 1;
    const unit = units[index % units.length];
    const morning = index % 2 === 0;
    return {
      id: `mock-${dateKey(day)}`,
      scheduleId: "mock-preview",
      unitId: unit.id,
      unitName: unit.name,
      unitTone: unit.tone,
      shiftDefinitionId: isOff
        ? null
        : morning
          ? "mock-morning"
          : "mock-afternoon",
      shiftName: isOff ? "Folga" : morning ? "Manhã" : "Tarde",
      date: dateKey(day),
      startTime: isOff ? "" : morning ? "10:00" : "15:45",
      endTime: isOff ? "" : morning ? "16:15" : "22:00",
      type: isOff ? "day_off" : "work",
    };
  });
}

function buildTeamMockup(month: Date): TeamUnit[] {
  const unit = {
    id: "mock-joao-paulo",
    name: "Quiosque João Paulo",
    tone: { color: "#db2777", tint: "#fce7f0", border: "#fbcfe8" },
  };
  const members = [
    { id: "mock-tiago", name: "Tiago Brasil", role: "Administrativo", me: true },
    { id: "mock-maria", name: "Maria Joana Barbosa", role: "Atendente", me: false },
    { id: "mock-josiane", name: "Josiane da Silva", role: "Atendente", me: false },
    { id: "mock-heucilene", name: "Heucilene Oliveira", role: "Atendente", me: false },
    { id: "mock-edna", name: "Maria Edna Gois", role: "Atendente", me: false },
    { id: "mock-carliane", name: "Carliane Sousa", role: "Supervisora", me: false },
  ];
  const days = eachDayOfInterval({
    start: startOfMonth(month),
    end: endOfMonth(month),
  });
  const shifts = members.flatMap((member, memberIndex) =>
    days.map((day, dayIndex): TeamShift => {
      const isOff = (dayIndex + memberIndex) % 6 === 0;
      const morning = (dayIndex + memberIndex) % 2 === 0;
      return {
        id: `team-${member.id}-${dateKey(day)}`,
        scheduleId: "mock-team-preview",
        unitId: unit.id,
        unitName: unit.name,
        unitTone: unit.tone,
        shiftDefinitionId: isOff
          ? null
          : morning
            ? "mock-morning"
            : "mock-afternoon",
        shiftName: isOff ? "Folga" : morning ? "Manhã" : "Tarde",
        date: dateKey(day),
        startTime: isOff ? "" : morning ? "10:00" : "15:45",
        endTime: isOff ? "" : morning ? "16:15" : "22:00",
        type: isOff ? "day_off" : "work",
        userId: member.id,
        employeeName: member.name,
        employeeRole: member.role,
        isCurrentUser: member.me,
      };
    })
  );
  return [{ ...unit, shifts }];
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
}

function formatMonth(date: Date) {
  return capitalize(format(date, "MMMM 'de' yyyy", { locale: ptBR }));
}

function formatLongDate(date: Date) {
  return capitalize(format(date, "EEEE, d 'de' MMMM", { locale: ptBR }));
}

function formatShortWeekday(date: Date) {
  return format(date, "EEE", { locale: ptBR }).replace(".", "");
}

function getTone(shift: CollaboratorShift | undefined) {
  if (!shift || shift.type === "day_off") return OFF_TONE;
  return shift.unitTone;
}

function getTeamTone(shift: CollaboratorShift | undefined) {
  if (!shift || shift.type === "day_off") return OFF_TONE;
  const normalizedName = normalizeIdentity(shift.shiftName);
  const startHour = Number(shift.startTime.split(":")[0]);
  return normalizedName.includes("tarde") || startHour >= 12
    ? AFTERNOON_TONE
    : MORNING_TONE;
}

function shiftTime(shift: CollaboratorShift) {
  return shift.type === "day_off"
    ? "Folga"
    : `${shift.startTime} – ${shift.endTime}`;
}

function DayStatus({
  shifts,
  emptyLabel = "Sem turno informado",
}: {
  shifts: CollaboratorShift[];
  emptyLabel?: string;
}) {
  if (shifts.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed bg-slate-50 px-4 py-5 text-sm font-medium text-slate-500">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {shifts.map((shift) => {
        const tone = getTone(shift);
        return (
          <div
            key={`${shift.scheduleId}-${shift.id}`}
            className="flex items-center gap-3 rounded-2xl border p-3.5"
            style={{ backgroundColor: tone.tint, borderColor: tone.border }}
          >
            <span
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white"
              style={{ backgroundColor: tone.color }}
            >
              {shift.type === "day_off" ? (
                <CalendarX2 className="h-5 w-5" />
              ) : (
                <Clock3 className="h-5 w-5" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-base font-black text-slate-950">
                {shiftTime(shift)}
              </p>
              <p className="truncate text-xs font-bold" style={{ color: tone.color }}>
                {shift.type === "day_off"
                  ? "Dia de descanso"
                  : `${shift.shiftName} · ${shift.unitName}`}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="grid min-h-[420px] place-items-center rounded-3xl border bg-white">
      <div className="text-center text-sm font-semibold text-slate-500">
        <Loader2 className="mx-auto mb-3 h-7 w-7 animate-spin text-pink-600" />
        Carregando sua escala...
      </div>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="grid min-h-[360px] place-items-center rounded-3xl border border-red-200 bg-white px-6 text-center">
      <div>
        <CalendarX2 className="mx-auto h-9 w-9 text-red-500" />
        <h2 className="mt-4 text-lg font-black text-slate-950">
          Não foi possível carregar sua escala
        </h2>
        <p className="mt-2 max-w-md text-sm text-slate-600">{message}</p>
        <Button className="mt-5" variant="outline" onClick={onRetry}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Tentar novamente
        </Button>
      </div>
    </div>
  );
}

function UnpublishedState({
  hasPublishedSchedule,
  monthLabel,
  onPreviousMonth,
  onNextMonth,
}: {
  hasPublishedSchedule: boolean;
  monthLabel?: string;
  onPreviousMonth?: () => void;
  onNextMonth?: () => void;
}) {
  return (
    <div className="grid min-h-[380px] place-items-center rounded-3xl border border-dashed bg-white px-6 text-center">
      <div>
        {monthLabel && onPreviousMonth && onNextMonth ? (
          <div className="mx-auto mb-5 flex items-center justify-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="rounded-xl"
              aria-label="Mês anterior"
              onClick={onPreviousMonth}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-40 text-sm font-black text-slate-700">
              {monthLabel}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="rounded-xl"
              aria-label="Próximo mês"
              onClick={onNextMonth}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        ) : null}
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-pink-50 text-pink-600">
          <CalendarDays className="h-8 w-8" />
        </span>
        <h2 className="mt-5 text-xl font-black text-slate-950">
          {hasPublishedSchedule
            ? "Nenhum turno atribuído neste mês"
            : "Sua escala ainda não foi publicada"}
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">
          {hasPublishedSchedule
            ? "A escala do período está confirmada, mas não encontramos turnos vinculados ao seu usuário."
            : "Assim que o DP confirmar a escala deste período, os turnos, horários e folgas aparecerão aqui."}
        </p>
      </div>
    </div>
  );
}

export function CollaboratorSchedulePage() {
  const { firebaseUser, user, permissions } = useAuth();
  const now = useMemo(() => new Date(), []);
  const [view, setView] = useState<ViewMode>("today");
  const [displayMonth, setDisplayMonth] = useState(
    () => new Date(now.getFullYear(), now.getMonth(), 1)
  );
  const [selectedDate, setSelectedDate] = useState(dateKey(now));
  const [selectedTeamUnitId, setSelectedTeamUnitId] = useState("");
  const [selectedTeamDate, setSelectedTeamDate] = useState(dateKey(now));
  const [payload, setPayload] = useState<SchedulePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canView =
    permissions.dashboard.collaborator ?? permissions.dashboard.view;
  const canShowMockup = useMemo(
    () => canPreviewScheduleMockup(user ?? {}, firebaseUser),
    [
      firebaseUser?.displayName,
      firebaseUser?.email,
      user?.email,
      user?.username,
    ]
  );

  const loadSchedule = useCallback(async () => {
    if (!firebaseUser) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const token = await firebaseUser.getIdToken();
      const params = new URLSearchParams({
        year: String(displayMonth.getFullYear()),
        month: String(displayMonth.getMonth() + 1),
      });
      const response = await fetch(`/api/collaborator/schedule?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result?.error ?? "Falha ao carregar sua escala.");
      }
      setPayload({
        year: Number(result.year),
        month: Number(result.month),
        published: result.published === true,
        shifts: Array.isArray(result.shifts) ? result.shifts : [],
        teamUnits: Array.isArray(result.teamUnits) ? result.teamUnits : [],
      });
    } catch (loadError) {
      setPayload(null);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Falha ao carregar sua escala."
      );
    } finally {
      setLoading(false);
    }
  }, [displayMonth, firebaseUser]);

  useEffect(() => {
    void loadSchedule();
  }, [loadSchedule]);

  const showingMockup =
    canShowMockup &&
    loading === false &&
    error === null &&
    (!payload?.published || (payload?.shifts.length ?? 0) === 0);
  const mockShifts = useMemo(
    () => buildScheduleMockup(displayMonth),
    [displayMonth]
  );
  const mockTeamUnits = useMemo(
    () => buildTeamMockup(displayMonth),
    [displayMonth]
  );
  const shifts = showingMockup ? mockShifts : payload?.shifts ?? [];
  const teamUnits = showingMockup ? mockTeamUnits : payload?.teamUnits ?? [];
  const selectedTeamUnit =
    teamUnits.find((unit) => unit.id === selectedTeamUnitId) ??
    teamUnits[0] ??
    null;

  useEffect(() => {
    if (
      teamUnits.length > 0 &&
      !teamUnits.some((unit) => unit.id === selectedTeamUnitId)
    ) {
      setSelectedTeamUnitId(teamUnits[0].id);
    }
  }, [selectedTeamUnitId, teamUnits]);
  const shiftsByDate = useMemo(() => {
    const grouped = new Map<string, CollaboratorShift[]>();
    for (const shift of shifts) {
      const current = grouped.get(shift.date) ?? [];
      current.push(shift);
      grouped.set(shift.date, current);
    }
    return grouped;
  }, [shifts]);

  const todayShifts = shiftsByDate.get(dateKey(now)) ?? [];
  const weekDays = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(now, { weekStartsOn: 1 }),
        end: endOfWeek(now, { weekStartsOn: 1 }),
      }),
    [now]
  );
  const monthCells = useMemo(() => {
    const monthStart = startOfMonth(displayMonth);
    return eachDayOfInterval({
      start: startOfWeek(monthStart, { weekStartsOn: 0 }),
      end: endOfWeek(endOfMonth(displayMonth), { weekStartsOn: 0 }),
    });
  }, [displayMonth]);
  const selectedShifts = shiftsByDate.get(selectedDate) ?? [];
  const selectedDateValue = parseDate(selectedDate);
  const unitLegend = useMemo(() => {
    const entries = new Map<string, { name: string; color: string }>();
    for (const shift of shifts) {
      if (shift.type === "work" && !entries.has(shift.unitId)) {
        entries.set(shift.unitId, {
          name: shift.unitName,
          color: shift.unitTone.color,
        });
      }
    }
    return Array.from(entries.values());
  }, [shifts]);
  const teamWeekMembers = useMemo(() => {
    if (!selectedTeamUnit) return [];
    const weekKeys = new Set(weekDays.map(dateKey));
    const byUser = new Map<
      string,
      {
        userId: string;
        name: string;
        role: string;
        isCurrentUser: boolean;
        shiftsByDate: Map<string, TeamShift[]>;
      }
    >();
    for (const shift of selectedTeamUnit.shifts) {
      if (!weekKeys.has(shift.date)) continue;
      const member = byUser.get(shift.userId) ?? {
        userId: shift.userId,
        name: shift.employeeName,
        role: shift.employeeRole,
        isCurrentUser: shift.isCurrentUser,
        shiftsByDate: new Map<string, TeamShift[]>(),
      };
      const dayShifts = member.shiftsByDate.get(shift.date) ?? [];
      dayShifts.push(shift);
      member.shiftsByDate.set(shift.date, dayShifts);
      byUser.set(shift.userId, member);
    }
    return Array.from(byUser.values()).sort((left, right) => {
      if (left.isCurrentUser !== right.isCurrentUser) {
        return left.isCurrentUser ? -1 : 1;
      }
      return left.name.localeCompare(right.name, "pt-BR");
    });
  }, [selectedTeamUnit, weekDays]);
  const selectedTeamDayShifts = useMemo(
    () =>
      selectedTeamUnit?.shifts
        .filter((shift) => shift.date === selectedTeamDate)
        .sort((left, right) => {
          if (left.type !== right.type) return left.type === "work" ? -1 : 1;
          return left.startTime.localeCompare(right.startTime);
        }) ?? [],
    [selectedTeamDate, selectedTeamUnit]
  );
  const selectedTeamWorkingShifts = selectedTeamDayShifts.filter(
    (shift) => shift.type === "work"
  );
  const selectedTeamDaysOff = selectedTeamDayShifts.filter(
    (shift) => shift.type === "day_off"
  );

  const changeMonth = (amount: number) => {
    const next = addMonths(displayMonth, amount);
    setDisplayMonth(next);
    setSelectedDate(dateKey(startOfMonth(next)));
  };

  const changeView = (next: string) => {
    const nextView = next as ViewMode;
    setView(nextView);
    if (nextView !== "month") {
      const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      if (!isSameMonth(displayMonth, currentMonth)) {
        setDisplayMonth(currentMonth);
      }
      setSelectedDate(dateKey(now));
      setSelectedTeamDate(dateKey(now));
    }
  };

  if (!canView) {
    return (
      <div className="grid min-h-[420px] place-items-center rounded-3xl border bg-white p-8 text-center">
        <div>
          <CalendarX2 className="mx-auto h-10 w-10 text-slate-400" />
          <h1 className="mt-4 text-xl font-black text-slate-950">
            Acesso negado
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Você não tem permissão para visualizar o Painel do colaborador.
          </p>
        </div>
      </div>
    );
  }

  const firstTodayShift = todayShifts[0];
  const todayTone = getTone(firstTodayShift);
  const hasVisibleScheduleForView =
    view === "team" ? teamUnits.length > 0 : shifts.length > 0;
  const firstName = (user?.username ?? firebaseUser?.displayName ?? "")
    .trim()
    .split(/\s+/)[0];

  return (
    <div className="mx-auto w-full max-w-[1280px] space-y-5 pb-8">
      <BackButton
        fallbackHref="/dashboard/collaborator"
        label="Painel do colaborador"
        variant="ghost"
        size="sm"
        className="-ml-2"
      />

      <section className="overflow-hidden rounded-3xl border bg-white shadow-sm">
        <header className="flex flex-col gap-5 border-b px-5 py-6 sm:px-7 lg:flex-row lg:items-end lg:justify-between lg:px-8">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.14em] text-pink-600">
              Minha escala
            </p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">
              {firstName ? `Olá, ${firstName}` : "Olá"}
            </h1>
            <p className="mt-1 text-sm font-medium text-slate-500">
              Seus turnos, horários e folgas em um só lugar.
            </p>
          </div>

          <Tabs value={view} onValueChange={changeView} className="lg:hidden">
            <TabsList className="grid h-12 w-full grid-cols-4 rounded-2xl bg-slate-100 p-1">
              <TabsTrigger
                value="today"
                className="rounded-xl font-bold data-[state=active]:text-pink-600"
              >
                Hoje
              </TabsTrigger>
              <TabsTrigger
                value="week"
                className="rounded-xl font-bold data-[state=active]:text-pink-600"
              >
                Semana
              </TabsTrigger>
              <TabsTrigger
                value="month"
                className="rounded-xl font-bold data-[state=active]:text-pink-600"
              >
                Mês
              </TabsTrigger>
              <TabsTrigger
                value="team"
                className="rounded-xl font-bold data-[state=active]:text-pink-600"
              >
                Equipe
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <Tabs
            value={view === "team" ? "team" : "schedule"}
            onValueChange={(next) => changeView(next === "team" ? "team" : "today")}
            className="hidden lg:block"
          >
            <TabsList className="grid h-12 w-[320px] grid-cols-2 rounded-2xl bg-slate-100 p-1">
              <TabsTrigger
                value="schedule"
                className="rounded-xl font-bold data-[state=active]:text-pink-600"
              >
                Minha escala
              </TabsTrigger>
              <TabsTrigger
                value="team"
                className="rounded-xl font-bold data-[state=active]:text-pink-600"
              >
                Equipe
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </header>

        <div className="bg-slate-100/80 p-4 sm:p-6 lg:p-8">
          {showingMockup ? (
            <div className="mb-4 flex items-start gap-3 rounded-2xl border border-pink-200 bg-pink-50 px-4 py-3 text-pink-900">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-pink-600" />
              <div>
                <p className="text-xs font-black uppercase tracking-[0.12em] text-pink-600">
                  Prévia visual
                </p>
                <p className="mt-0.5 text-sm font-semibold">
                  Estes turnos são apenas um mockup visível no seu cadastro. Nenhum dado foi gravado na escala.
                </p>
              </div>
            </div>
          ) : null}
          {loading ? (
            <LoadingState />
          ) : error ? (
            <ErrorState message={error} onRetry={() => void loadSchedule()} />
          ) : !showingMockup &&
            (!payload?.published || !hasVisibleScheduleForView) ? (
            <UnpublishedState
              hasPublishedSchedule={payload?.published === true}
              monthLabel={view === "month" ? formatMonth(displayMonth) : undefined}
              onPreviousMonth={view === "month" ? () => changeMonth(-1) : undefined}
              onNextMonth={view === "month" ? () => changeMonth(1) : undefined}
            />
          ) : view !== "team" ? (
            <>
              <div className="hidden space-y-5 lg:block">
                <div
                  className="overflow-hidden rounded-3xl p-7 text-white shadow-xl"
                  style={{
                    background:
                      firstTodayShift?.type === "work"
                        ? `linear-gradient(120deg, ${todayTone.color}, #9d174d)`
                        : "linear-gradient(120deg, #64748b, #334155)",
                  }}
                >
                  <div className="flex items-center justify-between gap-8">
                    <div className="min-w-0">
                      <p className="text-xs font-black uppercase tracking-[0.14em] text-white/75">
                        Hoje · {formatLongDate(now)}
                      </p>
                      <h2 className="mt-2 text-3xl font-black tracking-tight">
                        {firstTodayShift
                          ? shiftTime(firstTodayShift)
                          : "Sem turno informado"}
                      </h2>
                      <p className="mt-1 text-sm font-semibold text-white/80">
                        {firstTodayShift?.type === "work"
                          ? `${firstTodayShift.shiftName} · ${firstTodayShift.unitName}`
                          : firstTodayShift
                            ? "Dia de descanso"
                            : "Não há turno ou folga registrados para hoje."}
                      </p>
                    </div>
                    <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-white/15">
                      {firstTodayShift?.type === "day_off" ? (
                        <CalendarX2 className="h-8 w-8" />
                      ) : (
                        <Clock3 className="h-8 w-8" />
                      )}
                    </span>
                  </div>
                  {todayShifts.length > 1 ? (
                    <p className="mt-4 text-xs font-black text-white/80">
                      + {todayShifts.length - 1} outro turno registrado hoje
                    </p>
                  ) : null}
                </div>

                <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
                  <div className="rounded-3xl border bg-white p-5">
                    <div className="mb-4 flex items-center justify-between gap-4">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.12em] text-pink-600">
                          Calendário mensal
                        </p>
                        <h2 className="mt-1 text-xl font-black text-slate-950">
                          {formatMonth(displayMonth)}
                        </h2>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="rounded-xl"
                          aria-label="Mês anterior"
                          onClick={() => changeMonth(-1)}
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="rounded-xl"
                          aria-label="Próximo mês"
                          onClick={() => changeMonth(1)}
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="mb-4 flex flex-wrap gap-3">
                      {unitLegend.map((unit) => (
                        <span
                          key={unit.name}
                          className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600"
                        >
                          <span
                            className="h-2.5 w-2.5 rounded"
                            style={{ backgroundColor: unit.color }}
                          />
                          {unit.name}
                        </span>
                      ))}
                    </div>

                    <div className="mb-2 grid grid-cols-7 gap-1.5">
                      {WEEKDAY_LABELS.map((label, index) => (
                        <div
                          key={`${label}-desktop-${index}`}
                          className="py-1 text-center text-[11px] font-black text-slate-400"
                        >
                          {label}
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-7 gap-1.5">
                      {monthCells.map((day) => {
                        const inMonth = isSameMonth(day, displayMonth);
                        const key = dateKey(day);
                        const dayShifts = inMonth
                          ? shiftsByDate.get(key) ?? []
                          : [];
                        const primary = dayShifts[0];
                        const tone = getTone(primary);
                        const active = selectedDate === key;
                        const isToday = key === dateKey(now);
                        return (
                          <button
                            key={`desktop-${key}`}
                            type="button"
                            disabled={!inMonth}
                            onClick={() => setSelectedDate(key)}
                            className={cn(
                              "relative flex min-h-[76px] flex-col items-start justify-start overflow-hidden rounded-xl border p-2 text-xs font-black transition",
                              !inMonth && "border-transparent bg-slate-50 text-slate-300",
                              inMonth && !primary && "border-slate-100 bg-white text-slate-900",
                              isToday && !active && "ring-2 ring-inset ring-pink-500"
                            )}
                            style={
                              inMonth && primary
                                ? {
                                    backgroundColor: active
                                      ? tone.color
                                      : tone.tint,
                                    color: active ? "#ffffff" : tone.color,
                                    borderColor: tone.border,
                                  }
                                : undefined
                            }
                          >
                            {inMonth ? format(day, "d") : ""}
                            {primary ? (
                              <span
                                className={cn(
                                  "mt-1 max-w-full truncate rounded-md px-1.5 py-0.5 text-[10px]",
                                  active && "bg-white/15 text-white"
                                )}
                                style={
                                  active
                                    ? undefined
                                    : {
                                        backgroundColor: "#ffffffaa",
                                        color: tone.color,
                                      }
                                }
                              >
                                {primary.type === "day_off"
                                  ? "Folga"
                                  : primary.startTime}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <aside className="space-y-4">
                    <div className="rounded-3xl border bg-white p-5">
                      <p className="text-xs font-black uppercase tracking-[0.12em] text-pink-600">
                        Esta semana
                      </p>
                      <h2 className="mt-1 text-lg font-black text-slate-950">
                        {format(weekDays[0], "dd/MM")} a{" "}
                        {format(weekDays[weekDays.length - 1], "dd/MM")}
                      </h2>
                      <div className="mt-4 space-y-2">
                        {weekDays.map((day) => {
                          const key = dateKey(day);
                          const dayShifts = shiftsByDate.get(key) ?? [];
                          const primary = dayShifts[0];
                          const tone = getTone(primary);
                          return (
                            <button
                              key={`summary-${key}`}
                              type="button"
                              onClick={() => setSelectedDate(key)}
                              className={cn(
                                "flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition",
                                selectedDate === key && "ring-2 ring-pink-400"
                              )}
                              style={{
                                backgroundColor: primary ? tone.tint : "#f8fafc",
                                borderColor: primary ? tone.border : "#e2e8f0",
                              }}
                            >
                              <div className="w-10 shrink-0 text-center">
                                <p className="text-[10px] font-black uppercase text-slate-400">
                                  {formatShortWeekday(day)}
                                </p>
                                <p className="text-lg font-black text-slate-950">
                                  {format(day, "dd")}
                                </p>
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-black text-slate-950">
                                  {primary ? shiftTime(primary) : "Sem turno"}
                                </p>
                                <p className="truncate text-[11px] font-semibold text-slate-500">
                                  {primary?.type === "work"
                                    ? primary.unitName
                                    : primary
                                      ? "Dia de descanso"
                                      : "Não informado"}
                                </p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="rounded-3xl border bg-white p-5">
                      <p className="text-xs font-black uppercase tracking-[0.1em] text-slate-400">
                        Dia selecionado
                      </p>
                      <h3 className="mt-1 text-lg font-black text-slate-950">
                        {formatLongDate(selectedDateValue)}
                      </h3>
                      <div className="mt-4">
                        <DayStatus shifts={selectedShifts} />
                      </div>
                    </div>
                  </aside>
                </div>
              </div>

              <div className="lg:hidden">
                {view === "today" ? (
            <div className="grid gap-5">
              <div
                className="overflow-hidden rounded-3xl p-6 text-white shadow-xl sm:p-8"
                style={{
                  background:
                    firstTodayShift?.type === "work"
                      ? `linear-gradient(150deg, ${todayTone.color}, #9d174d)`
                      : "linear-gradient(150deg, #64748b, #334155)",
                }}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-black uppercase tracking-[0.14em] text-white/80">
                    Turno de hoje
                  </span>
                  <span className="rounded-full bg-white/15 px-3 py-1.5 text-xs font-bold">
                    {format(now, "dd/MM/yyyy")}
                  </span>
                </div>
                <h2 className="mt-5 text-3xl font-black tracking-tight sm:text-4xl">
                  {formatLongDate(now)}
                </h2>

                {todayShifts.length > 0 ? (
                  <div className="mt-7 space-y-4">
                    {todayShifts.map((shift) => (
                      <div
                        key={`${shift.scheduleId}-${shift.id}`}
                        className="flex flex-col gap-4 rounded-2xl bg-white/10 p-4 sm:flex-row sm:items-center"
                      >
                        <div className="flex items-center gap-3">
                          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/15">
                            <Clock3 className="h-6 w-6" />
                          </span>
                          <div>
                            <p className="text-2xl font-black">
                              {shiftTime(shift)}
                            </p>
                            <p className="text-xs font-semibold text-white/75">
                              {shift.shiftName}
                            </p>
                          </div>
                        </div>
                        {shift.type === "work" ? (
                          <div className="flex items-center gap-3 sm:ml-auto">
                            <MapPin className="h-5 w-5 text-white/80" />
                            <div>
                              <p className="font-black">{shift.unitName}</p>
                              <p className="text-xs font-semibold text-white/75">
                                sua unidade
                              </p>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-7 rounded-2xl bg-white/10 p-5">
                    <p className="text-2xl font-black">Sem turno informado</p>
                    <p className="mt-1 text-sm font-semibold text-white/75">
                      Não há turno ou folga registrados para hoje.
                    </p>
                  </div>
                )}

                <p className="mt-6 flex items-center gap-2 text-sm font-bold text-white/85">
                  <Sparkles className="h-4 w-4" />
                  Consulte esta página sempre que precisar confirmar sua jornada.
                </p>
              </div>

              <div className="rounded-3xl border bg-white p-5 sm:p-6">
                <h2 className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">
                  Resto da semana
                </h2>
                <div className="mt-4 space-y-2.5">
                  {weekDays
                    .filter((day) => dateKey(day) > dateKey(now))
                    .map((day) => {
                      const dayShifts = shiftsByDate.get(dateKey(day)) ?? [];
                      const primary = dayShifts[0];
                      const tone = getTone(primary);
                      return (
                        <div
                          key={dateKey(day)}
                          className="flex items-center gap-3 rounded-2xl border p-3"
                          style={{
                            backgroundColor: primary ? tone.tint : "#f8fafc",
                            borderColor: primary ? tone.border : "#e2e8f0",
                          }}
                        >
                          <div className="w-10 shrink-0 text-center">
                            <p className="text-[10px] font-black uppercase text-slate-400">
                              {formatShortWeekday(day)}
                            </p>
                            <p className="text-xl font-black leading-none text-slate-950">
                              {format(day, "dd")}
                            </p>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-black text-slate-950">
                              {primary ? shiftTime(primary) : "Sem turno"}
                            </p>
                            <p className="truncate text-xs font-semibold text-slate-500">
                              {primary?.type === "work"
                                ? primary.unitName
                                : primary
                                  ? "Dia de descanso"
                                  : "Não informado"}
                            </p>
                          </div>
                          {dayShifts.length > 1 ? (
                            <span className="text-xs font-black" style={{ color: tone.color }}>
                              +{dayShifts.length - 1}
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          ) : view === "week" ? (
            <div>
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.12em] text-pink-600">
                    Semana atual
                  </p>
                  <h2 className="mt-1 text-xl font-black text-slate-950">
                    {format(weekDays[0], "dd/MM")} a{" "}
                    {format(weekDays[weekDays.length - 1], "dd/MM")}
                  </h2>
                </div>
                <div className="flex flex-wrap gap-3">
                  {unitLegend.map((unit) => (
                    <span
                      key={unit.name}
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600"
                    >
                      <span
                        className="h-2.5 w-2.5 rounded"
                        style={{ backgroundColor: unit.color }}
                      />
                      {unit.name}
                    </span>
                  ))}
                </div>
              </div>

              <div className="hidden grid-cols-7 gap-2.5 lg:grid">
                {weekDays.map((day) => {
                  const dayShifts = shiftsByDate.get(dateKey(day)) ?? [];
                  const primary = dayShifts[0];
                  const tone = getTone(primary);
                  const isToday = dateKey(day) === dateKey(now);
                  return (
                    <div
                      key={dateKey(day)}
                      className={cn(
                        "min-h-[210px] rounded-2xl border bg-white p-4",
                        isToday && "ring-2 ring-pink-500"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-black uppercase text-slate-400">
                          {formatShortWeekday(day)}
                        </span>
                        <span
                          className={cn(
                            "text-base font-black",
                            isToday ? "text-pink-600" : "text-slate-950"
                          )}
                        >
                          {format(day, "dd")}
                        </span>
                      </div>
                      <div
                        className="my-4 h-1.5 rounded-full"
                        style={{ backgroundColor: primary ? tone.color : "#e2e8f0" }}
                      />
                      {primary ? (
                        <>
                          <p className="text-sm font-black text-slate-950">
                            {shiftTime(primary)}
                          </p>
                          <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                            {primary.type === "work"
                              ? primary.unitName
                              : "Dia de descanso"}
                          </p>
                          <span
                            className="mt-4 inline-flex rounded-full px-2.5 py-1 text-[10px] font-black"
                            style={{
                              backgroundColor: tone.tint,
                              color: tone.color,
                            }}
                          >
                            {primary.shiftName}
                          </span>
                          {dayShifts.length > 1 ? (
                            <p className="mt-2 text-[10px] font-bold text-slate-500">
                              + {dayShifts.length - 1} outro turno
                            </p>
                          ) : null}
                        </>
                      ) : (
                        <p className="text-xs font-semibold leading-5 text-slate-400">
                          Sem turno informado
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="space-y-3 lg:hidden">
                {weekDays.map((day) => (
                  <div
                    key={dateKey(day)}
                    className={cn(
                      "rounded-2xl border bg-white p-4",
                      dateKey(day) === dateKey(now) && "border-pink-400"
                    )}
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <p
                        className={cn(
                          "font-black",
                          dateKey(day) === dateKey(now)
                            ? "text-pink-600"
                            : "text-slate-950"
                        )}
                      >
                        {formatLongDate(day)}
                      </p>
                      {dateKey(day) === dateKey(now) ? (
                        <span className="rounded-full bg-pink-50 px-2.5 py-1 text-[10px] font-black uppercase text-pink-600">
                          Hoje
                        </span>
                      ) : null}
                    </div>
                    <DayStatus shifts={shiftsByDate.get(dateKey(day)) ?? []} />
                  </div>
                ))}
              </div>
            </div>
          ) : view === "month" ? (
            <div>
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.12em] text-pink-600">
                    Calendário mensal
                  </p>
                  <h2 className="mt-1 text-xl font-black text-slate-950">
                    {formatMonth(displayMonth)}
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="rounded-xl bg-white"
                    aria-label="Mês anterior"
                    onClick={() => changeMonth(-1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="rounded-xl bg-white"
                    aria-label="Próximo mês"
                    onClick={() => changeMonth(1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="grid gap-5 lg:grid-cols-[1fr_330px]">
                <div className="rounded-3xl border bg-white p-3 sm:p-5">
                  <div className="mb-2 grid grid-cols-7 gap-1.5">
                    {WEEKDAY_LABELS.map((label, index) => (
                      <div
                        key={`${label}-${index}`}
                        className="py-1 text-center text-[11px] font-black text-slate-400"
                      >
                        {label}
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1.5">
                    {monthCells.map((day) => {
                      const inMonth = isSameMonth(day, displayMonth);
                      const key = dateKey(day);
                      const dayShifts = inMonth
                        ? shiftsByDate.get(key) ?? []
                        : [];
                      const primary = dayShifts[0];
                      const tone = getTone(primary);
                      const active = selectedDate === key;
                      const isToday = key === dateKey(now);
                      return (
                        <button
                          key={key}
                          type="button"
                          disabled={!inMonth}
                          onClick={() => setSelectedDate(key)}
                          className={cn(
                            "relative flex aspect-square min-h-11 flex-col items-center justify-center overflow-hidden rounded-xl border text-xs font-black transition sm:aspect-auto sm:min-h-[82px] sm:items-start sm:justify-start sm:p-2",
                            !inMonth && "border-transparent bg-slate-50 text-slate-300",
                            inMonth && !primary && "border-slate-100 bg-white text-slate-900",
                            isToday && !active && "ring-2 ring-inset ring-pink-500"
                          )}
                          style={
                            inMonth && primary
                              ? {
                                  backgroundColor: active
                                    ? tone.color
                                    : tone.tint,
                                  color: active ? "#ffffff" : tone.color,
                                  borderColor: tone.border,
                                }
                              : undefined
                          }
                        >
                          {inMonth ? format(day, "d") : ""}
                          {primary ? (
                            <span
                              className={cn(
                                "mt-1 hidden max-w-full truncate rounded-md px-1.5 py-0.5 text-[10px] sm:block",
                                active && "bg-white/15 text-white"
                              )}
                              style={
                                active
                                  ? undefined
                                  : {
                                      backgroundColor: "#ffffffaa",
                                      color: tone.color,
                                    }
                              }
                            >
                              {primary.type === "day_off"
                                ? "Folga"
                                : `${primary.startTime} · ${primary.unitName}`}
                            </span>
                          ) : null}
                          {dayShifts.length > 1 ? (
                            <span className="absolute bottom-1 right-1 text-[9px] font-black">
                              +{dayShifts.length - 1}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <aside className="self-start rounded-3xl border bg-white p-5 lg:sticky lg:top-4">
                  <p className="text-xs font-black uppercase tracking-[0.1em] text-slate-400">
                    {formatShortWeekday(selectedDateValue)}
                  </p>
                  <h3 className="mt-1 text-xl font-black text-slate-950">
                    {formatLongDate(selectedDateValue)}
                  </h3>
                  <div className="mt-5">
                    <DayStatus shifts={selectedShifts} />
                  </div>
                  <p className="mt-4 text-xs font-semibold leading-5 text-slate-500">
                    A escala é somente para consulta. Se encontrar alguma
                    divergência, fale com o DP ou com sua liderança.
                  </p>
                </aside>
              </div>
            </div>
                ) : null}
              </div>
            </>
          ) : (
            <div>
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.12em] text-pink-600">
                    Escala da sua unidade
                  </p>
                  <h2 className="mt-1 text-xl font-black text-slate-950">
                    {selectedTeamUnit?.name ?? "Unidade não definida"}
                  </h2>
                  <p className="mt-1 text-xs font-semibold text-slate-500">
                    Somente escalas publicadas dos colaboradores vinculados à unidade.
                  </p>
                </div>
                {teamUnits.length > 1 ? (
                  <label className="text-xs font-bold text-slate-600">
                    Unidade
                    <select
                      value={selectedTeamUnit?.id ?? ""}
                      onChange={(event) =>
                        setSelectedTeamUnitId(event.target.value)
                      }
                      className="mt-1 block h-10 min-w-56 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-900 outline-none focus:border-pink-400 focus:ring-2 focus:ring-pink-100"
                    >
                      {teamUnits.map((unit) => (
                        <option key={unit.id} value={unit.id}>
                          {unit.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>

              <div className="mb-4 hidden items-center justify-end gap-4 lg:flex">
                {[
                  { label: "Manhã", tone: MORNING_TONE },
                  { label: "Tarde", tone: AFTERNOON_TONE },
                  { label: "Folga", tone: OFF_TONE },
                ].map(({ label, tone }) => (
                  <span
                    key={label}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600"
                  >
                    <span
                      className="h-2.5 w-2.5 rounded"
                      style={{ backgroundColor: tone.color }}
                    />
                    {label}
                  </span>
                ))}
              </div>

              <div className="hidden overflow-x-auto rounded-3xl border bg-white p-4 lg:block">
                <div className="min-w-[900px]">
                  <div className="grid grid-cols-[190px_repeat(7,minmax(82px,1fr))] gap-2 px-2 pb-2">
                    <div />
                    {weekDays.map((day) => {
                      const isToday = dateKey(day) === dateKey(now);
                      return (
                        <div key={dateKey(day)} className="text-center">
                          <p className="text-[10px] font-black uppercase text-slate-400">
                            {formatShortWeekday(day)}
                          </p>
                          <p
                            className={cn(
                              "text-base font-black",
                              isToday ? "text-pink-600" : "text-slate-950"
                            )}
                          >
                            {format(day, "dd")}
                          </p>
                        </div>
                      );
                    })}
                  </div>

                  <div className="space-y-2">
                    {teamWeekMembers.map((member) => (
                      <div
                        key={member.userId}
                        className={cn(
                          "grid grid-cols-[190px_repeat(7,minmax(82px,1fr))] gap-2 rounded-2xl p-2",
                          member.isCurrentUser && "bg-pink-50"
                        )}
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span
                            className={cn(
                              "grid h-9 w-9 shrink-0 place-items-center rounded-xl text-xs font-black",
                              member.isCurrentUser
                                ? "bg-pink-600 text-white"
                                : "bg-slate-200 text-slate-600"
                            )}
                          >
                            {initials(member.name)}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-black text-slate-950">
                              {member.name}
                            </p>
                            <p className="truncate text-[11px] font-semibold text-slate-500">
                              {member.role}
                              {member.isCurrentUser ? " · você" : ""}
                            </p>
                          </div>
                        </div>

                        {weekDays.map((day) => {
                          const dayShifts =
                            member.shiftsByDate.get(dateKey(day)) ?? [];
                          const primary = dayShifts[0];
                          const tone = getTeamTone(primary);
                          return (
                            <div
                              key={dateKey(day)}
                              className="flex min-h-14 flex-col items-center justify-center rounded-xl border px-1.5 text-center"
                              style={{
                                backgroundColor: primary
                                  ? tone.tint
                                  : "#f8fafc",
                                borderColor: primary
                                  ? tone.border
                                  : "#f1f5f9",
                                color: primary ? tone.color : "#94a3b8",
                              }}
                            >
                              <span className="text-xs font-black">
                                {primary
                                  ? primary.type === "day_off"
                                    ? "Folga"
                                    : primary.startTime
                                  : "—"}
                              </span>
                              {dayShifts.length > 1 ? (
                                <span className="text-[9px] font-bold">
                                  +{dayShifts.length - 1}
                                </span>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="lg:hidden">
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {weekDays.map((day) => {
                    const key = dateKey(day);
                    const active = selectedTeamDate === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setSelectedTeamDate(key)}
                        className={cn(
                          "flex w-14 shrink-0 flex-col items-center rounded-2xl border px-2 py-2.5",
                          active
                            ? "border-pink-600 bg-pink-600 text-white"
                            : "border-slate-200 bg-white text-slate-600"
                        )}
                      >
                        <span className="text-[10px] font-black uppercase opacity-75">
                          {formatShortWeekday(day)}
                        </span>
                        <span className="text-lg font-black">
                          {format(day, "dd")}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <h3 className="text-sm font-black text-slate-950">
                    {formatLongDate(parseDate(selectedTeamDate))}
                  </h3>
                  <span className="text-xs font-bold text-slate-500">
                    {selectedTeamWorkingShifts.length} na escala
                  </span>
                </div>

                <div className="mt-3 space-y-2.5">
                  {selectedTeamWorkingShifts.map((shift) => {
                    const tone = getTeamTone(shift);
                    return (
                      <div
                        key={`${shift.userId}-${shift.id}`}
                        className={cn(
                          "flex items-center gap-3 rounded-2xl border bg-white p-3.5",
                          shift.isCurrentUser && "border-pink-300 bg-pink-50"
                        )}
                      >
                        <span
                          className={cn(
                            "grid h-10 w-10 shrink-0 place-items-center rounded-xl text-xs font-black",
                            shift.isCurrentUser
                              ? "bg-pink-600 text-white"
                              : "bg-slate-200 text-slate-600"
                          )}
                        >
                          {initials(shift.employeeName)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-black text-slate-950">
                            {shift.employeeName}
                            {shift.isCurrentUser ? " · você" : ""}
                          </p>
                          <p className="truncate text-xs font-semibold text-slate-500">
                            {shift.employeeRole}
                          </p>
                        </div>
                        <div className="text-right">
                          <p
                            className="text-sm font-black"
                            style={{ color: tone.color }}
                          >
                            {shiftTime(shift)}
                          </p>
                          <p className="text-[10px] font-bold text-slate-400">
                            {shift.shiftName}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                  {selectedTeamDayShifts.length === 0 ? (
                    <div className="rounded-2xl border border-dashed bg-white p-5 text-center text-sm font-semibold text-slate-500">
                      Nenhum turno publicado para esta unidade neste dia.
                    </div>
                  ) : null}
                </div>

                {selectedTeamDaysOff.length > 0 ? (
                  <div className="mt-5 border-t border-slate-200 pt-4">
                    <p className="text-xs font-black uppercase tracking-[0.1em] text-slate-400">
                      De folga
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {selectedTeamDaysOff.map((shift) => (
                        <span
                          key={`off-${shift.userId}-${shift.id}`}
                          className={cn(
                            "inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600",
                            shift.isCurrentUser && "border-pink-200 bg-pink-50 text-pink-700"
                          )}
                        >
                          <span className="grid h-6 w-6 place-items-center rounded-full bg-slate-100 text-[9px] font-black">
                            {initials(shift.employeeName)}
                          </span>
                          {shift.employeeName}
                          {shift.isCurrentUser ? " · você" : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
