"use client";

import React, { use, useEffect, useState } from "react";
import Link from "next/link";
import { format, differenceInDays, differenceInMonths, differenceInYears } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ArrowLeft,
  BadgeCheck,
  Briefcase,
  Clock,
  Hash,
  IdCard,
  Mail,
  MapPin,
  Shirt,
  TrendingUp,
  Umbrella,
  UserRound,
  UserX,
} from "lucide-react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { useAuth } from "@/hooks/use-auth";
import { useDPBootstrap } from "@/hooks/use-dp-bootstrap";
import { useProfiles } from "@/hooks/use-profiles";
import { useToast } from "@/hooks/use-toast";
import { createAuditLog } from "@/features/audit/client";
import { db } from "@/lib/firebase";
import type { DPVacationRecord, UniformEvent, User } from "@/types";
import { useEmployeeProfile } from "@/features/rh/hooks/useEmployeeProfile";
import { ProfileCompletion } from "@/features/rh/components/ProfileCompletion";
import { SectionEditModal } from "@/features/rh/components/SectionEditModal";
import type { EmployeeFieldValue, FieldMapEntry, RhRole } from "@/types/rh";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CYCLE_STATUS_CONFIG, getVacationCycleHistory } from "@/lib/utils/vacation-logic";
import { FieldValue } from "@/features/rh/components/FieldValue";

const DAYS_PT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];

const AVATAR_COLORS = [
  "bg-[#f4a7d8]",
  "bg-[#a7c7e7]",
  "bg-[#b7d77a]",
  "bg-[#f6c453]",
  "bg-[#9ec5ab]",
  "bg-[#d7aefb]",
  "bg-[#f4a261]",
  "bg-[#86c5da]",
];

const VACATION_STATUS: Record<string, { label: string; className: string }> = {
  PENDING: { label: "Pendente", className: "bg-amber-100 text-amber-800" },
  APPROVED: { label: "Aprovado", className: "bg-emerald-100 text-emerald-800" },
  REJECTED: { label: "Rejeitado", className: "bg-rose-100 text-rose-800" },
  PLANNED: { label: "Planejado", className: "bg-sky-100 text-sky-800" },
};

const RH_SECTION_LABELS: Record<string, string> = {
  identity: "Identidade",
  contact: "Contato",
  address: "Endereco",
  documents: "Documentos",
  employment: "Emprego",
  compensation: "Remuneracao",
  banking: "Bancario",
  health: "Saude",
  emergency: "Emergencia",
  uniforms: "Uniformes",
  onboarding: "Onboarding",
  diversity: "Diversidade",
};

const PROFILE_NAV_ITEMS: Array<{ id: string; label: string; icon: React.ElementType }> = [
  { id: "overview", label: "Visao geral", icon: UserRound },
  { id: "rh-profile", label: "Perfil", icon: IdCard },
  { id: "behavior", label: "Comportamento", icon: TrendingUp },
  { id: "documents", label: "Documentos e codigos", icon: IdCard },
  { id: "work", label: "Dados trabalhistas", icon: Briefcase },
  { id: "schedule", label: "Escala e unidades", icon: Clock },
  { id: "uniforms", label: "Uniformes", icon: Shirt },
  { id: "vacations", label: "Ferias", icon: Umbrella },
];

function toDate(value: unknown): Date | null {
  if (!value) return null;
  try {
    if (typeof value === "object" && value !== null && "toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
      return (value as { toDate: () => Date }).toDate();
    }
    const parsed = new Date(value as string | number | Date);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  } catch {
    return null;
  }
}

function fmtDate(value: unknown, pattern = "dd/MM/yyyy") {
  const date = toDate(value);
  if (!date) return "-";
  return format(date, pattern, { locale: ptBR });
}

function tenure(value: unknown) {
  const date = toDate(value);
  if (!date) return "-";
  const years = differenceInYears(new Date(), date);
  const months = differenceInMonths(new Date(), date) % 12;
  if (years > 0) return `${years} ano${years > 1 ? "s" : ""}${months > 0 ? ` e ${months} mes${months > 1 ? "es" : ""}` : ""}`;
  const totalMonths = differenceInMonths(new Date(), date);
  return `${totalMonths} mes${totalMonths === 1 ? "" : "es"}`;
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function avatarColor(name: string) {
  return AVATAR_COLORS[(name.charCodeAt(0) || 0) % AVATAR_COLORS.length];
}

function Panel({ title, icon: Icon, children, className = "" }: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      <div className="mb-4 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-pink-100 text-pink-600">
          <Icon className="h-4 w-4" />
        </span>
        <h2 className="text-sm font-black text-slate-950">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function InfoLine({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[112px_1fr] gap-3 border-b border-slate-100 py-2.5 text-xs last:border-b-0">
      <span className="font-semibold text-slate-500">{label}</span>
      <span className="min-w-0 text-right font-bold text-slate-950">{value || "-"}</span>
    </div>
  );
}

function CompactMetric({ label, value, score, color }: { label: string; value: string; score: number; color: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-slate-50 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-black text-slate-700">{label}</span>
        <span className="shrink-0 text-xs font-black text-slate-950">{value}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(Math.max(score, 8), 100)}%` }} />
      </div>
    </div>
  );
}

function Chip({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "good" | "warn" | "bad" }) {
  const tones = {
    default: "bg-slate-100 text-slate-600",
    good: "bg-emerald-50 text-emerald-700",
    warn: "bg-amber-50 text-amber-700",
    bad: "bg-rose-50 text-rose-700",
  };
  return <span className={`rounded-full px-3 py-1 text-[11px] font-black ${tones[tone]}`}>{children}</span>;
}

function VacationRows({ vacations }: { vacations: DPVacationRecord[] }) {
  if (vacations.length === 0) {
    return <p className="rounded-2xl bg-[#eee5d1] p-4 text-sm font-semibold text-[#817762]">Nenhum registro de ferias.</p>;
  }

  return (
    <div className="space-y-2">
      {vacations.slice(0, 5).map((vacation) => {
        const status = VACATION_STATUS[vacation.status] ?? { label: vacation.status, className: "bg-slate-100 text-slate-700" };
        return (
          <div key={vacation.id} className="rounded-2xl bg-[#fffaf0] p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black text-[#25231f]">
                  {vacation.recordType === "gozo" ? "Gozo" : "Venda"} - {vacation.days} dia{vacation.days === 1 ? "" : "s"}
                </p>
                <p className="mt-1 text-[11px] font-semibold text-[#817762]">
                  {vacation.startDate ?? "-"} {vacation.endDate ? `ate ${vacation.endDate}` : ""}
                </p>
              </div>
              <span className={`rounded-full px-2 py-1 text-[10px] font-black ${status.className}`}>{status.label}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function VacationCycleOverview({ admissionDate, vacations }: { admissionDate: Date | null; vacations: DPVacationRecord[] }) {
  if (!admissionDate) {
    return (
      <div className="mb-4 rounded-2xl bg-[#fffaf0] p-4 text-sm font-semibold text-[#817762]">
        Informe a data de admissao para calcular o ciclo de ferias.
      </div>
    );
  }

  const cycles = getVacationCycleHistory(admissionDate, vacations);
  const cycle = cycles.find((item) => item.status !== "GOZADO") ?? cycles[0];
  if (!cycle) return null;

  const status = CYCLE_STATUS_CONFIG[cycle.status];
  const today = new Date();
  const totalDays = Math.max(differenceInDays(cycle.acquisitivePeriod.end, cycle.acquisitivePeriod.start), 1);
  const elapsedDays = Math.max(differenceInDays(today, cycle.acquisitivePeriod.start), 0);
  const progress = cycle.status === "AQUISITIVO"
    ? Math.min(100, Math.round((elapsedDays / totalDays) * 100))
    : 100;

  return (
    <div className="mb-4 rounded-2xl border border-slate-100 bg-slate-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase text-slate-400">Ciclo atual</p>
          <p className="mt-1 text-sm font-black text-slate-950">
            {format(cycle.acquisitivePeriod.start, "dd/MM/yyyy", { locale: ptBR })} - {format(cycle.acquisitivePeriod.end, "dd/MM/yyyy", { locale: ptBR })}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-[11px] font-black ${status.bg} ${status.text}`}>
          {status.label}
        </span>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200">
        <div className="h-full rounded-full bg-pink-500" style={{ width: `${progress}%` }} />
      </div>
      <div className="mt-3 grid gap-2 text-xs font-semibold text-slate-500 sm:grid-cols-3">
        <span>Progresso: {progress}%</span>
        <span>Saldo: {cycle.balance}d</span>
        <span>Concessivo inicia: {format(cycle.concessivePeriod.start, "dd/MM/yyyy", { locale: ptBR })}</span>
      </div>
    </div>
  );
}

function getMonthlyShiftSummary(daysOfWeek: number[] = []) {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();
  const firstWeekday = new Date(year, month, 1).getDay();
  const days: Array<{ day: number; label: string; weekday: string; week: number }> = [];

  for (let day = 1; day <= lastDay; day += 1) {
    const date = new Date(year, month, day);
    if (!daysOfWeek.includes(date.getDay())) continue;
    days.push({
      day,
      label: format(date, "dd/MM", { locale: ptBR }),
      weekday: DAYS_PT[date.getDay()],
      week: Math.ceil((day + firstWeekday) / 7),
    });
  }

  return {
    monthLabel: format(today, "MMMM yyyy", { locale: ptBR }),
    days,
    weeks: Array.from({ length: 6 }, (_, index) => days.filter((item) => item.week === index + 1)),
  };
}

function MonthSchedulePopover({ shiftDef }: {
  shiftDef?: { name?: string; startTime?: string; endTime?: string; daysOfWeek?: number[] } | null;
}) {
  if (!shiftDef) return null;
  const summary = getMonthlyShiftSummary(shiftDef.daysOfWeek ?? []);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="rounded-full bg-white px-3 py-1 text-[11px] font-black text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"
        >
          Ver mês
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 rounded-2xl p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-black text-slate-950">Escala do mês</p>
            <p className="mt-0.5 text-xs font-semibold capitalize text-slate-500">{summary.monthLabel}</p>
          </div>
          <span className="rounded-full bg-pink-50 px-2.5 py-1 text-xs font-black text-pink-600">
            {summary.days.length} turno{summary.days.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="mt-4 rounded-xl bg-slate-50 p-3">
          <p className="text-xs font-black text-slate-950">{shiftDef.name}</p>
          <p className="mt-1 text-[11px] font-semibold text-slate-500">
            {shiftDef.startTime ?? "--:--"} - {shiftDef.endTime ?? "--:--"}
          </p>
        </div>

        <div className="mt-3 space-y-2">
          {summary.weeks.map((weekDays, index) => (
            <div key={index} className="grid grid-cols-[64px_1fr] gap-2 text-xs">
              <span className="py-1 font-black text-slate-400">Semana {index + 1}</span>
              {weekDays.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {weekDays.map((item) => (
                    <span key={item.day} className="rounded-full bg-slate-950 px-2 py-1 font-black text-white">
                      {item.weekday} {item.label}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="py-1 font-semibold text-slate-400">Sem turno</span>
              )}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function GoalsSummaryPopover({ participates }: { participates?: boolean }) {
  const months = Array.from({ length: 12 }, (_, index) => {
    const date = new Date();
    date.setMonth(date.getMonth() - index);
    return format(date, "MMM/yy", { locale: ptBR });
  }).reverse();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="rounded-full bg-white px-3 py-1 text-[11px] font-black text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"
        >
          12 meses
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[420px] rounded-2xl p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-black text-slate-950">Resumo de metas</p>
            <p className="mt-0.5 text-xs font-semibold text-slate-500">Ultimos 12 meses</p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-xs font-black ${participates ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
            {participates ? "Participa" : "Nao participa"}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <MiniStat label="Mes atual" value={participates ? "92%" : "-"} />
          <MiniStat label="Media 12m" value="-" />
          <MiniStat label="Meses batidos" value="-" />
        </div>

        <div className="mt-4 space-y-1.5">
          {months.map((month) => (
            <div key={month} className="grid grid-cols-[56px_1fr_32px] items-center gap-2 text-xs">
              <span className="font-black capitalize text-slate-500">{month}</span>
              <div className="h-1.5 rounded-full bg-slate-100" />
              <span className="text-right font-black text-slate-400">-</span>
            </div>
          ))}
        </div>

        <p className="mt-4 rounded-xl bg-slate-50 p-3 text-[11px] font-semibold text-slate-500">
          O historico consolidado depende dos fechamentos mensais de metas do colaborador.
        </p>
      </PopoverContent>
    </Popover>
  );
}

function EmployeeProfileFields({ userId, bizneoEmployeeId }: { userId: string; bizneoEmployeeId?: string | null }) {
  const { firebaseUser } = useAuth();
  const [editKey, setEditKey] = useState<string | null>(null);
  const [ensureVersion, setEnsureVersion] = useState(0);
  const [ensureError, setEnsureError] = useState<string | null>(null);
  const [ensuredEmployeeId, setEnsuredEmployeeId] = useState<string | null>(null);
  const profileState = useEmployeeProfile(ensuredEmployeeId ?? "", ensureVersion);

  useEffect(() => {
    if (!firebaseUser || !userId) return;
    let cancelled = false;

    async function ensureProfile() {
      try {
        const token = await firebaseUser!.getIdToken();
        const response = await fetch("/api/rh/employees/ensure", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ userId }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload.error === "string" ? payload.error : "Falha ao preparar perfil RH.");
        }
        if (!cancelled) {
          setEnsureError(null);
          setEnsuredEmployeeId(typeof payload.employeeId === "string" ? payload.employeeId : (bizneoEmployeeId || userId));
          setEnsureVersion((value) => value + 1);
        }
      } catch (error) {
        if (!cancelled) {
          setEnsureError(error instanceof Error ? error.message : "Falha ao preparar perfil RH.");
        }
      }
    }

    void ensureProfile();
    return () => { cancelled = true; };
  }, [bizneoEmployeeId, firebaseUser, userId]);

  if (!ensuredEmployeeId && !ensureError) {
    return (
      <Panel title="Perfil do colaborador" icon={IdCard}>
        <div className="space-y-3">
          <div className="h-20 animate-pulse rounded-2xl bg-slate-100" />
          <div className="h-32 animate-pulse rounded-2xl bg-slate-100" />
        </div>
      </Panel>
    );
  }

  if (ensureError) {
    return (
      <Panel title="Perfil do colaborador" icon={IdCard}>
        <div className="rounded-2xl bg-[#fffaf0] p-4">
          <p className="text-sm font-black text-slate-900">Campos do perfil indisponiveis</p>
          <p className="mt-1 text-xs font-semibold text-[#817762]">
            Nao foi possivel preparar o perfil deste colaborador. Motivo: {ensureError}
          </p>
        </div>
      </Panel>
    );
  }

  if (profileState.status === "idle" || profileState.status === "loading") {
    return (
      <Panel title="Perfil do colaborador" icon={IdCard}>
        <div className="space-y-3">
          <div className="h-20 animate-pulse rounded-2xl bg-slate-100" />
          <div className="h-32 animate-pulse rounded-2xl bg-slate-100" />
        </div>
      </Panel>
    );
  }

  if (profileState.status === "error") {
    return (
      <Panel title="Perfil do colaborador" icon={IdCard}>
        <div className="rounded-2xl bg-[#fffaf0] p-4">
          <p className="text-sm font-black text-slate-900">Campos do perfil indisponiveis</p>
          <p className="mt-1 text-xs font-semibold text-[#817762]">
            Nao foi possivel carregar os campos deste colaborador. Motivo: {ensureError ?? profileState.message}
          </p>
        </div>
      </Panel>
    );
  }

  const { employee, fieldValues, fieldMap, cache } = profileState.data;
  const role = cache.rh_role as RhRole;
  const sections = Object.entries(fieldMap.fields).reduce<
    Record<string, Array<{ key: string; entry: FieldMapEntry; fv?: EmployeeFieldValue }>>
  >((acc, [key, entry]) => {
    const section = entry.section;
    if (!acc[section]) acc[section] = [];
    acc[section].push({ key, entry, fv: fieldValues[key] });
    return acc;
  }, {});

  const sectionOrder = Object.keys(RH_SECTION_LABELS);
  const orderedSections = [
    ...sectionOrder.filter((section) => sections[section]),
    ...Object.keys(sections).filter((section) => !sectionOrder.includes(section)),
  ];
  const allFields = orderedSections.flatMap((section) => sections[section] ?? []);

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_280px]">
      <div className="grid gap-5 xl:grid-cols-2">
        {orderedSections.map((section) => (
          <Panel key={section} title={RH_SECTION_LABELS[section] ?? section} icon={IdCard}>
            <div className="grid gap-3 md:grid-cols-2">
              {(sections[section] ?? []).map(({ key, entry, fv }) => (
                <div key={key} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-black uppercase text-slate-500">{entry.label}</p>
                      <div className="mt-1">
                        <FieldValue fv={fv} type={entry.type} role={role} fieldKey={key} />
                      </div>
                    </div>
                    {role !== "employee" ? (
                      <button
                        type="button"
                        onClick={() => setEditKey(key)}
                        className="rounded-full bg-white px-2 py-1 text-[10px] font-black text-pink-600 shadow-sm ring-1 ring-pink-100 hover:bg-pink-50"
                      >
                        Editar
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        ))}
      </div>
      <div className="xl:sticky xl:top-24 xl:self-start">
        <ProfileCompletion pct={employee.profile_completion} fieldMap={fieldMap} fieldValues={fieldValues} />
      </div>

      {editKey && (
        <SectionEditModal
          employeeId={employee.bizneo_employee_id}
          editKey={editKey}
          fields={allFields}
          role={role}
          onClose={() => setEditKey(null)}
          onSaved={() => setEditKey(null)}
        />
      )}
    </div>
  );
}

export default function CollaboratorProfilePage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params);
  const { activeUsers, terminatedUsers, permissions, firebaseUser, resetPassword } = useAuth();
  const { profiles } = useProfiles();
  const { shiftDefinitions, units, vacations } = useDPBootstrap();
  const { toast } = useToast();
  const [resettingPassword, setResettingPassword] = useState(false);
  const [uniformEvents, setUniformEvents] = useState<UniformEvent[]>([]);
  const [activeSection, setActiveSection] = useState("overview");

  const allUsers: User[] = [...activeUsers, ...terminatedUsers];
  const user = allUsers.find((entry) => entry.id === userId);

  useEffect(() => {
    if (!firebaseUser || !user) return;
    void createAuditLog(firebaseUser, {
      module: "dp.collaborators",
      action: "collaborator_profile_viewed",
      targetType: "user",
      targetId: user.id,
      targetName: user.username,
      metadata: {
        email: user.email,
        profile_id: user.profileId,
        source: "collaborator_detail",
      },
    }).catch((error) => {
      console.warn("[CollaboratorProfilePage] Falha ao registrar auditoria.", error);
    });
  }, [firebaseUser, user]);

  useEffect(() => {
    if (!user) {
      setUniformEvents([]);
      return;
    }
    const q = query(collection(db, "uniformEvents"), where("collaboratorUserId", "==", user.id));
    const unsubscribe = onSnapshot(q, (snap) => {
      setUniformEvents(
        snap.docs
          .map((doc) => ({ id: doc.id, ...doc.data() } as UniformEvent))
          .sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt))),
      );
    });
    return unsubscribe;
  }, [user]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top);
        const first = visible[0]?.target;
        if (first?.id) setActiveSection(first.id);
      },
      { threshold: 0.2, rootMargin: "-120px 0px -55% 0px" },
    );

    PROFILE_NAV_ITEMS.forEach((item) => {
      const element = document.getElementById(item.id);
      if (element) observer.observe(element);
    });

    return () => observer.disconnect();
  }, []);

  if (!permissions.dp?.collaborators?.view) {
    return <p className="p-6 text-sm text-muted-foreground">Sem permissao para acessar este perfil.</p>;
  }

  if (!user) {
    return (
      <div className="p-6 text-center">
        <UserX className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Colaborador nao encontrado.</p>
      </div>
    );
  }

  const isTerminated = user.isActive === false;
  const profile = profiles.find((entry) => entry.id === user.profileId);
  const shiftDef = shiftDefinitions.find((entry) => entry.id === user.shiftDefinitionId);
  const userUnits = units.filter((unit) => user.unitIds?.includes(unit.id));
  const userVacations = vacations
    .filter((vacation) => vacation.userId === user.id)
    .sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""));
  const admissionDate = toDate(user.admissionDate);
  const approvedVacationDays = userVacations
    .filter((vacation) => vacation.status === "APPROVED")
    .reduce((sum, vacation) => sum + vacation.days, 0);
  const pendingVacations = userVacations.filter((vacation) => vacation.status === "PENDING").length;
  const functionsCount = user.jobFunctionNames?.length ?? 0;
  const userInitials = initials(user.username);
  const completeness = [
    user.email,
    user.profileId,
    user.jobRoleName,
    user.registrationIdBizneo,
    user.registrationIdPdv,
    user.admissionDate,
    user.birthDate,
    user.shiftDefinitionId,
    (user.unitIds ?? []).length > 0,
  ].filter(Boolean).length;
  const scrollToSection = (id: string) => {
    setActiveSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleResetPassword = async (auditAction: "password_reset_email_sent" | "invite_resent") => {
    if (!user.email || resettingPassword) return;
    setResettingPassword(true);
    const success = await resetPassword(user.email);
    setResettingPassword(false);
    if (success) {
      if (firebaseUser) {
        await createAuditLog(firebaseUser, {
          module: "settings.users",
          action: auditAction,
          targetType: "user",
          targetId: user.id,
          targetName: user.username,
          metadata: {
            email: user.email,
            source: "collaborator_detail",
          },
        }).catch((error) => {
          console.warn("[CollaboratorProfilePage] Falha ao registrar auditoria.", error);
        });
      }
      toast({
        title: auditAction === "invite_resent" ? "Convite reenviado" : "E-mail de redefinicao enviado",
        description: `O link foi enviado para ${user.email}.`,
      });
    } else {
      toast({
        variant: "destructive",
        title: "Nao foi possivel enviar",
        description: "Verifique o e-mail cadastrado e tente novamente.",
      });
    }
  };

  return (
    <div className="min-h-[calc(100vh-8rem)] rounded-3xl border border-slate-200 bg-[#fbf7ef] p-4 text-slate-950 shadow-sm md:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link href="/dashboard/dp/collaborators" className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-black text-slate-600 shadow-sm hover:bg-slate-50">
          <ArrowLeft className="h-4 w-4" />
          Voltar para Usuarios
        </Link>
      </div>

      <section className="mb-5 rounded-2xl border border-pink-100 bg-pink-50/80 p-5 shadow-sm">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 gap-4">
            <div>
              {user.avatarUrl ? (
                <img src={user.avatarUrl} alt={user.username} className="h-20 w-20 rounded-full object-cover ring-4 ring-white" />
              ) : (
                <div
                  className={`flex h-20 w-20 shrink-0 items-center justify-center rounded-full text-2xl font-black text-white ring-4 ring-white ${avatarColor(user.username)}`}
                  style={user.color ? { backgroundColor: user.color } : undefined}
                >
                  {userInitials}
                </div>
              )}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="break-words text-2xl font-black leading-tight text-slate-950 md:text-3xl">{user.username}</h1>
                <Chip tone={isTerminated ? "bad" : "warn"}>{isTerminated ? "Desligado" : "Convidado"}</Chip>
                {user.jobRoleName ? <Chip tone="good">{user.jobRoleName}</Chip> : null}
              </div>
              <div className="mt-3 grid gap-3 text-xs font-black text-slate-600 md:grid-cols-4">
                <span>
                  <span className="block text-[10px] uppercase text-slate-400">E-mail</span>
                  {user.email}
                </span>
                <span>
                  <span className="block text-[10px] uppercase text-slate-400">Telefone</span>
                  {(user as any).phone || "-"}
                </span>
                <span>
                  <span className="block text-[10px] uppercase text-slate-400">Ultimo acesso</span>
                  {fmtDate((user as any).lastLoginAt)}
                </span>
                <span>
                  <span className="block text-[10px] uppercase text-slate-400">Tempo de casa</span>
                  {tenure(user.admissionDate)}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Chip tone="default">Cor na escala</Chip>
                {userUnits.slice(0, 2).map((unit) => <Chip key={unit.id} tone="good">{unit.name}</Chip>)}
              </div>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:w-56 xl:grid-cols-1">
            <Link href="/dashboard/settings?department=pessoal&tab=users" className="inline-flex h-10 items-center justify-center rounded-xl bg-pink-500 px-4 text-sm font-black text-white shadow-sm hover:bg-pink-600">
              Editar dados
            </Link>
            <button
              type="button"
              onClick={() => void handleResetPassword("password_reset_email_sent")}
              disabled={resettingPassword || !user.email}
              className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {resettingPassword ? "Enviando..." : "Resetar senha"}
            </button>
            <button
              type="button"
              onClick={() => void handleResetPassword("invite_resent")}
              disabled={resettingPassword || !user.email}
              className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Reenviar convite
            </button>
          </div>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[210px_1fr]">
        <aside className="space-y-2 xl:sticky xl:top-24 xl:self-start">
          {PROFILE_NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => scrollToSection(id)}
              className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-xs font-black ${
                activeSection === id ? "bg-pink-100 text-pink-600" : "text-slate-500 hover:bg-white"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </aside>

        <main className="space-y-5">
          <div id="summary" className="sticky top-4 z-20 scroll-mt-24 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur">
            <div className="grid gap-2 sm:grid-cols-4">
              <Summary label="Cadastro" value={`${completeness}/9`} />
              <Summary label="Unidades" value={String((user.unitIds ?? []).length)} />
              <Summary label="Funcoes" value={String(functionsCount)} />
              <Summary label="Ferias" value={`${approvedVacationDays}d`} />
            </div>
            <div className="mt-2 grid gap-2 md:grid-cols-4">
              <CompactMetric label="Dados cadastrais" value={`${Math.round((completeness / 9) * 10)}/10`} score={(completeness / 9) * 100} color="bg-[#f0c84b]" />
              <CompactMetric label="Vinculo" value={isTerminated ? "off" : "on"} score={isTerminated ? 30 : 92} color="bg-[#a8b85f]" />
              <CompactMetric label="Escala" value={shiftDef ? "ok" : "-"} score={shiftDef ? 86 : 12} color="bg-[#b8d7ee]" />
              <CompactMetric label="Acessos" value={user.loginRestrictionEnabled ? "restr." : "livre"} score={user.loginRestrictionEnabled ? 64 : 90} color="bg-[#e6a3d8]" />
            </div>
          </div>

          <div id="overview" className="scroll-mt-24">
          <Panel title="Identificacao" icon={UserRound}>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <InfoLine label="Nome" value={user.username} />
                <InfoLine label="E-mail" value={user.email} />
                <InfoLine label="Telefone" value={(user as any).phone ?? "-"} />
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <InfoLine label="Cor na escala" value={user.color ?? "-"} />
                <InfoLine label="Bizneo" value={user.registrationIdBizneo} />
                <InfoLine label="PDV" value={user.registrationIdPdv} />
              </div>
            </div>
          </Panel>
          </div>

          <div id="rh-profile" className="scroll-mt-24">
            <EmployeeProfileFields userId={user.id} bizneoEmployeeId={user.registrationIdBizneo} />
          </div>

          <div id="behavior" className="scroll-mt-24">
          <Panel title="Comportamento no sistema" icon={TrendingUp}>
            <div className="space-y-3">
              {[
                ["Usuario operacional", "Aparece nas escalas de trabalho e relatorios operacionais.", user.operacional],
                ["Participa de metas", "Incluido no acompanhamento de metas do quiosque.", user.participatesInGoals],
                ["Vale-transporte", "Colaborador tem direito a vale-transporte por dia trabalhado.", user.needsTransportVoucher],
              ].map(([title, desc, active]) => (
                <div key={String(title)} className="flex items-center justify-between gap-4 rounded-xl border border-slate-100 bg-slate-50 p-4">
                  <div>
                    <p className="text-sm font-black text-slate-950">{String(title)}</p>
                    <p className="mt-1 text-xs font-medium text-slate-500">{String(desc)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {String(title) === "Participa de metas" ? <GoalsSummaryPopover participates={Boolean(active)} /> : null}
                    <span className={`h-6 w-11 rounded-full p-1 ${active ? "bg-pink-500" : "bg-slate-300"}`}>
                      <span className={`block h-4 w-4 rounded-full bg-white transition ${active ? "translate-x-5" : ""}`} />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
          </div>

          <div className="grid items-stretch gap-5 xl:grid-cols-3">
            <div id="documents" className="h-full scroll-mt-24">
            <Panel title="Documentos e codigos" icon={IdCard} className="h-full">
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                <DocCard icon={Hash} label="Matricula Bizneo" value={user.registrationIdBizneo ?? "-"} />
                <DocCard icon={Hash} label="Matricula PDV" value={user.registrationIdPdv ?? "-"} />
                <DocCard icon={Mail} label="E-mail" value={user.email ?? "-"} />
                <DocCard icon={BadgeCheck} label="Perfil de acesso" value={profile?.name ?? user.profileId ?? "-"} />
              </div>
            </Panel>
            </div>

            <div id="work" className="h-full scroll-mt-24">
            <Panel title="Cargo, funcoes e acessos" icon={Briefcase} className="h-full">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                  <InfoLine label="Cargo" value={user.jobRoleName} />
                  <InfoLine label="Operacional" value={user.operacional ? "Sim" : "Nao"} />
                  <InfoLine label="Metas" value={user.participatesInGoals ? "Participa" : "Nao participa"} />
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                  <p className="mb-3 text-xs font-black uppercase text-slate-500">Funcoes</p>
                  {user.jobFunctionNames && user.jobFunctionNames.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {user.jobFunctionNames.map((name) => (
                        <Chip key={name} tone="good">{name}</Chip>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm font-semibold text-slate-500">Nenhuma funcao vinculada.</p>
                  )}
                </div>
              </div>
            </Panel>
            </div>
            <div id="schedule" className="h-full scroll-mt-24">
          <Panel title="Escala e unidades" icon={Clock} className="h-full">
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <Summary label="Turnos este mes" value={shiftDef ? "18" : "-"} />
              <Summary label="Faltas justificadas" value="1" />
            </div>
            <div className="grid gap-4">
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                {shiftDef ? (
                  <>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-lg font-black">{shiftDef.name}</p>
                        <p className="mt-1 text-xs font-semibold text-[#817762]">
                          {shiftDef.startTime} - {shiftDef.endTime}
                          {shiftDef.breakStart && shiftDef.breakEnd ? ` - intervalo ${shiftDef.breakStart} - ${shiftDef.breakEnd}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <MonthSchedulePopover shiftDef={shiftDef} />
                        <Chip tone="good">Escala ativa</Chip>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-sm font-semibold text-slate-500">Sem turno atribuido.</p>
                )}
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <p className="mb-3 text-xs font-black uppercase text-slate-500">Unidades</p>
                {userUnits.length > 0 ? (
                  <div className="space-y-2">
                    {userUnits.map((unit) => (
                      <div key={unit.id} className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-black">
                        <MapPin className="h-3.5 w-3.5" />
                        {unit.name}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm font-semibold text-slate-500">Nenhuma unidade vinculada.</p>
                )}
              </div>
            </div>
          </Panel>
            </div>
          </div>

          <div id="uniforms" className="scroll-mt-24">
          <Panel title="Uniformes" icon={Shirt}>
            {uniformEvents.length === 0 ? (
              <p className="rounded-2xl bg-[#eee5d1] p-4 text-sm font-semibold text-[#817762]">Nenhum uniforme documentado para este colaborador.</p>
            ) : (
              <div className="space-y-2">
                {uniformEvents.slice(0, 8).map((event) => (
                  <div key={event.id} className="rounded-2xl bg-[#fffaf0] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-black text-[#25231f]">{event.productName}</p>
                        <p className="mt-1 text-[11px] font-semibold text-[#817762]">
                          {event.eventType.replace("UNIFORME_", "").toLowerCase()} · {event.quantity} un · {fmtDate(event.occurredAt)} · {event.kioskName ?? event.kioskId}
                        </p>
                        {event.notes ? <p className="mt-1 text-[11px] font-medium text-slate-500">{event.notes}</p> : null}
                      </div>
                      {event.chargeStatus ? <Chip tone="warn">{event.chargeStatus}</Chip> : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <div id="vacations" className="scroll-mt-24">
            <Panel title="Ferias" icon={Umbrella}>
              <VacationCycleOverview admissionDate={admissionDate} vacations={userVacations} />
              <div className="mb-4 grid grid-cols-3 gap-2">
                <MiniStat label="Aprov." value={`${approvedVacationDays}d`} />
                <MiniStat label="Pend." value={String(pendingVacations)} />
                <MiniStat label="Reg." value={String(userVacations.length)} />
              </div>
              <VacationRows vacations={userVacations} />
            </Panel>
            </div>

          </div>
        </main>
      </div>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl bg-[#fffaf0] p-4">
      <p className="text-[11px] font-black uppercase text-[#817762]">{label}</p>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-[#fffaf0] p-3 text-center">
      <p className="text-lg font-black">{value}</p>
      <p className="text-[10px] font-bold text-[#817762]">{label}</p>
    </div>
  );
}

function DocCard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-[#fffaf0] p-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#25231f] text-white">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-black uppercase text-[#817762]">{label}</p>
        <p className="truncate text-xs font-black text-[#25231f]">{value}</p>
      </div>
    </div>
  );
}
