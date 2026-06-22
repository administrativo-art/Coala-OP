"use client";

import React, { use, useEffect, useState } from "react";
import Link from "next/link";
import { format, differenceInDays, differenceInMonths, differenceInYears } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ArrowLeft,
  BadgeCheck,
  Briefcase,
  ChevronRight,
  Clock,
  Hash,
  IdCard,
  Mail,
  MapPin,
  MoreHorizontal,
  Search,
  Shirt,
  Sparkles,
  TrendingUp,
  Umbrella,
  UserRound,
  UserX,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useDPBootstrap } from "@/hooks/use-dp-bootstrap";
import { useProfiles } from "@/hooks/use-profiles";
import { createAuditLog } from "@/features/audit/client";
import type { DPVacationRecord, User } from "@/types";
import { CollaboratorUniforms } from "@/components/collaborator-uniforms";
import { useEmployeeProfile, useFieldMap } from "@/features/rh/hooks/useEmployeeProfile";
import { SectionEditModal } from "@/features/rh/components/SectionEditModal";
import type { EmployeeFieldValue, FieldMapEntry, RhRole } from "@/types/rh";
import { canViewField } from "@/types/rh";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CYCLE_STATUS_CONFIG, getVacationCycleHistory } from "@/lib/utils/vacation-logic";
import { FieldValue } from "@/features/rh/components/FieldValue";
import { DEFAULT_PROFILE_BLOCKS } from "@/features/rh/lib/default-field-map";

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
  identity: "Identificação",
  contact: "Contato",
  address: "Endereço",
  documents: "Documentos",
  employment: "Vínculo e Trabalho",
  compensation: "Benefícios",
  banking: "Bancário",
  health: "Saúde - ASOs",
  emergency: "Contatos de Emergência",
  uniforms: "Uniformes",
  onboarding: "Onboarding",
  diversity: "Diversidade",
};

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

function fieldHasValue(fv?: EmployeeFieldValue) {
  if (!fv) return false;
  if (typeof fv.value_text === "string") return fv.value_text.trim().length > 0;
  if (typeof fv.value_number === "number") return true;
  if (typeof fv.value_boolean === "boolean") return true;
  if (fv.value_date) return true;
  if (Array.isArray(fv.value_json)) return fv.value_json.length > 0;
  if (fv.value_json && typeof fv.value_json === "object") return Object.keys(fv.value_json).length > 0;
  return fv.value_json !== undefined && fv.value_json !== null;
}

function profileFieldValue(fv?: EmployeeFieldValue) {
  if (!fv) return undefined;
  if (typeof fv.value_boolean === "boolean") return fv.value_boolean;
  if (typeof fv.value_number === "number") return fv.value_number;
  if (typeof fv.value_text === "string") return fv.value_text;
  if (fv.value_date) return fv.value_date;
  if (fv.value_json !== undefined) return fv.value_json;
  return undefined;
}

function conditionalMatches(entry: FieldMapEntry, values: Record<string, EmployeeFieldValue>) {
  const rules = entry.conditionals?.filter((rule) => rule.kind === "show_if") ?? [];
  if (rules.length === 0) return true;
  return rules.every((rule) => {
    const value = profileFieldValue(values[rule.field]);
    if (rule.operator === "truthy") return Boolean(value);
    if (rule.operator === "eq") return value === rule.value;
    if (rule.operator === "neq") return value !== rule.value;
    return true;
  });
}

function isLegacyUniformField(key: string, entry: FieldMapEntry) {
  return key.startsWith("employee.uniform_") || entry.section.toLowerCase() === "uniforme";
}

function profileSectionDomId(section: string) {
  return `profile-section-${section
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}`;
}

function Panel({ title, icon: Icon, children, className = "" }: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-[22px] border border-[#dedfe4] bg-white shadow-[0_2px_10px_rgba(15,23,42,0.06)] ${className}`}>
      <div className="flex items-center gap-3 border-b border-[#e8e8ec] px-5 py-4">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#fff0f6] text-[#df2f78]">
          <Icon className="h-5 w-5" />
        </span>
        <h2 className="text-lg font-black leading-tight text-[#1d1d26]">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function InfoLine({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border-b border-[#ececf0] py-4 last:border-b-0">
      <span className="block text-xs font-black uppercase text-[#9d9da9]">{label}</span>
      <span className="mt-2 block min-w-0 text-base font-black text-[#24242e]">{value || "-"}</span>
    </div>
  );
}

function Chip({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "good" | "warn" | "bad" }) {
  const tones = {
    default: "bg-[#f3f3f5] text-[#6f6f7c]",
    good: "bg-[#eafaf2] text-[#008963]",
    warn: "bg-[#fff3c4] text-[#a35a00]",
    bad: "bg-[#ffe9ef] text-[#d9275f]",
  };
  return <span className={`rounded-full px-4 py-1.5 text-sm font-black ${tones[tone]}`}>{children}</span>;
}

function VacationRows({ vacations }: { vacations: DPVacationRecord[] }) {
  if (vacations.length === 0) {
    return <p className="rounded-2xl bg-[#f4f4f6] p-4 text-sm font-semibold text-[#777784]">Nenhum registro de férias.</p>;
  }

  return (
    <div className="space-y-2">
      {vacations.slice(0, 5).map((vacation) => {
        const status = VACATION_STATUS[vacation.status] ?? { label: vacation.status, className: "bg-slate-100 text-slate-700" };
        return (
          <div key={vacation.id} className="rounded-2xl border border-[#ececf0] bg-[#fbfbfc] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black text-[#25231f]">
                  {vacation.recordType === "gozo" ? "Gozo" : "Venda"} - {vacation.days} dia{vacation.days === 1 ? "" : "s"}
                </p>
                <p className="mt-1 text-[11px] font-semibold text-[#817762]">
                  {vacation.startDate ?? "-"} {vacation.endDate ? `até ${vacation.endDate}` : ""}
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
      <div className="mb-4 rounded-2xl bg-[#f4f4f6] p-4 text-sm font-semibold text-[#777784]">
        Informe a data de admissão para calcular o ciclo de férias.
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
            <p className="mt-0.5 text-xs font-semibold text-slate-500">Últimos 12 meses</p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-xs font-black ${participates ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
            {participates ? "Participa" : "Não participa"}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <MiniStat label="Mês atual" value={participates ? "92%" : "-"} />
          <MiniStat label="Média 12m" value="-" />
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
          O histórico consolidado depende dos fechamentos mensais de metas do colaborador.
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
          <p className="text-sm font-black text-slate-900">Campos do perfil indisponíveis</p>
          <p className="mt-1 text-xs font-semibold text-[#817762]">
            Não foi possível preparar o perfil deste colaborador. Motivo: {ensureError}
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
          <p className="text-sm font-black text-slate-900">Campos do perfil indisponíveis</p>
          <p className="mt-1 text-xs font-semibold text-[#817762]">
            Não foi possível carregar os campos deste colaborador. Motivo: {ensureError ?? profileState.message}
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
    if (isLegacyUniformField(key, entry)) return acc;
    if (!canViewField(entry.visibility, role) || !conditionalMatches(entry, fieldValues)) return acc;
    const section = entry.section;
    if (!acc[section]) acc[section] = [];
    acc[section].push({ key, entry, fv: fieldValues[key] });
    return acc;
  }, {});
  Object.values(sections).forEach((items) => {
    items.sort((left, right) => (left.entry.order ?? 0) - (right.entry.order ?? 0));
  });

  const sectionOrder = Object.keys(RH_SECTION_LABELS);
  const orderedSections = [
    ...sectionOrder.filter((section) => sections[section]),
    ...Object.keys(sections).filter((section) => !sectionOrder.includes(section)),
  ];
  const allFields = orderedSections.flatMap((section) => sections[section] ?? []);
  const filledFields = allFields.filter(({ fv }) => fieldHasValue(fv)).length;
  const completionPct = allFields.length > 0 ? Math.round((filledFields / allFields.length) * 100) : employee.profile_completion;

  return (
    <div className="space-y-4">
      <div className="rounded-[18px] border border-[#dedfe4] bg-white px-4 py-3 shadow-[0_2px_10px_rgba(15,23,42,0.06)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div
              className="grid h-14 w-14 place-items-center rounded-full"
              style={{ background: `conic-gradient(#df2f78 ${completionPct * 3.6}deg, #ececf0 0deg)` }}
            >
              <div className="grid h-10 w-10 place-items-center rounded-full bg-white text-sm font-black text-[#1d1d26]">
                {completionPct}%
              </div>
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-lg font-black text-[#1d1d26]">Perfil completo</h2>
                <span className={`rounded-full px-3 py-1 text-xs font-black ${completionPct >= 80 ? "bg-[#eafaf2] text-[#008963]" : "bg-[#ffe9ef] text-[#d9275f]"}`}>
                  {completionPct >= 80 ? "Completo" : "Incompleto"}
                </span>
              </div>
              <p className="mt-1 text-xs font-medium text-[#737381]">
                {filledFields}/{allFields.length} campos preenchidos nas seções prioritárias.
              </p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[520px]">
            {orderedSections.slice(0, 6).map((section) => {
              const sectionFields = sections[section] ?? [];
              const sectionFilled = sectionFields.filter(({ fv }) => fieldHasValue(fv)).length;
              const pct = sectionFields.length > 0 ? Math.round((sectionFilled / sectionFields.length) * 100) : 0;
              return (
                <div key={section} className="min-w-0">
                  <div className="flex items-center justify-between gap-3 text-sm font-black text-[#555563]">
                    <span className="truncate">{RH_SECTION_LABELS[section] ?? section}</span>
                    <span className="text-[#1d1d26]">{pct}%</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#ececf0]">
                    <div className="h-full rounded-full bg-[#19b37d]" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[190px_minmax(0,1fr)]">
        <aside className="space-y-1 lg:sticky lg:top-5 lg:self-start">
          <p className="px-3 pb-2 text-[11px] font-black uppercase text-[#9d9da9]">Seções</p>
          {orderedSections.map((section) => (
            <button
              key={section}
              type="button"
              onClick={() => document.getElementById(profileSectionDomId(section))?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm font-black text-[#737381] transition hover:bg-white hover:text-[#bd185c]"
            >
              <span className="truncate">{RH_SECTION_LABELS[section] ?? section}</span>
            </button>
          ))}
        </aside>

        <div className="space-y-4">
          {orderedSections.map((section) => {
            const sectionFields = sections[section] ?? [];
            const sectionFilled = sectionFields.filter(({ fv }) => fieldHasValue(fv)).length;
            const done = sectionFilled === sectionFields.length && sectionFields.length > 0;
            return (
              <section id={profileSectionDomId(section)} key={section} className="scroll-mt-24 rounded-[18px] border border-[#dedfe4] bg-white shadow-[0_2px_10px_rgba(15,23,42,0.06)]">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e8e8ec] px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#fff0f6] text-[#df2f78]">
                      <IdCard className="h-4 w-4" />
                    </span>
                    <h3 className="text-base font-black text-[#1d1d26]">{RH_SECTION_LABELS[section] ?? section}</h3>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-black ${done ? "bg-[#eafaf2] text-[#008963]" : "bg-[#fff8df] text-[#bd6b00]"}`}>
                    {sectionFilled}/{sectionFields.length} preenchidos
                  </span>
                </div>
                <div className="grid gap-3 p-4 md:grid-cols-2">
                  {sectionFields.map(({ key, entry, fv }) => {
                    const hasValue = fieldHasValue(fv);
                    return (
                      <div key={key} className="rounded-xl border border-[#e8e8ec] bg-[#fbfbfc] p-3">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-black uppercase text-[#9d9da9]">{entry.label}</p>
                            <div className="mt-1.5 text-sm font-black text-[#24242e]">
                              {hasValue ? (
                                <FieldValue fv={fv} type={entry.type} role={role} fieldKey={key} />
                              ) : role !== "employee" ? (
                                <button type="button" onClick={() => setEditKey(key)} className="text-[#df2f78]">
                                  + Adicionar
                                </button>
                              ) : (
                                "-"
                              )}
                            </div>
                          </div>
                          {role !== "employee" && hasValue ? (
                            <button
                              type="button"
                              onClick={() => setEditKey(key)}
                              className="rounded-full bg-white px-2.5 py-1 text-xs font-black text-[#df2f78] shadow-sm ring-1 ring-[#f5d5e2] hover:bg-[#fff0f6]"
                            >
                              Editar
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
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
  const { activeUsers, terminatedUsers, permissions, firebaseUser } = useAuth();
  const { profiles } = useProfiles();
  const { shiftDefinitions, units, vacations } = useDPBootstrap();
  const { fieldMap: profileLayout } = useFieldMap();

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

  if (!permissions.dp?.collaborators?.view) {
    return <p className="p-6 text-sm text-muted-foreground">Sem permissão para acessar este perfil.</p>;
  }

  if (!user) {
    return (
      <div className="p-6 text-center">
        <UserX className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Colaborador não encontrado.</p>
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
  const functionLabel = (user.jobFunctionNames ?? []).filter(Boolean).join(", ");
  const roleFunctionLabel = [user.jobRoleName, functionLabel].filter(Boolean).join(" | ") || (isTerminated ? "Desligado" : "Sem cargo");
  const userInitials = initials(user.username);
  const profileBlocks = { ...DEFAULT_PROFILE_BLOCKS, ...(profileLayout?.profile_blocks ?? {}) };
  const blockOrder = (id: keyof typeof DEFAULT_PROFILE_BLOCKS) => profileBlocks[id]?.order ?? DEFAULT_PROFILE_BLOCKS[id].order;
  const systemBlocks = [
    {
      id: "system.documents_codes" as const,
      className: "",
      content: (
        <Panel title="Documentos e códigos" icon={IdCard} className="h-full">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
            <DocCard icon={Hash} label="Matrícula Bizneo" value={user.registrationIdBizneo ?? "-"} />
            <DocCard icon={Hash} label="Matrícula PDV" value={user.registrationIdPdv ?? "-"} />
            <DocCard icon={Mail} label="E-mail" value={user.email ?? "-"} />
            <DocCard icon={BadgeCheck} label="Perfil de acesso" value={profile?.name ?? user.profileId ?? "-"} />
          </div>
        </Panel>
      ),
    },
    {
      id: "system.role_access" as const,
      className: "",
      content: (
        <Panel title="Cargo, funções e acessos" icon={Briefcase} className="h-full">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
            <div className="rounded-xl border border-[#e8e8ec] bg-[#fbfbfc] p-3">
              <InfoLine label="Cargo" value={user.jobRoleName || "-"} />
              <InfoLine label="Operacional" value={user.operacional ? "Sim" : "Não"} />
              <InfoLine label="Metas" value={user.participatesInGoals ? "Participa" : "Não participa"} />
            </div>
            <div className="rounded-xl border border-[#e8e8ec] bg-[#fbfbfc] p-3">
              <p className="mb-3 text-xs font-black uppercase text-[#9d9da9]">Funções</p>
              {user.jobFunctionNames && user.jobFunctionNames.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {user.jobFunctionNames.map((name) => (
                    <Chip key={name} tone="good">{name}</Chip>
                  ))}
                </div>
              ) : (
                <p className="text-sm font-semibold text-[#777784]">Nenhuma função vinculada.</p>
              )}
            </div>
          </div>
        </Panel>
      ),
    },
    {
      id: "system.schedule_units" as const,
      className: "",
      content: (
        <Panel title="Escala e unidades" icon={Clock} className="h-full">
          <div className="grid gap-3">
            <div className="rounded-xl border border-[#e8e8ec] bg-[#fbfbfc] p-3">
              {shiftDef ? (
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-black text-[#1d1d26]">{shiftDef.name}</p>
                    <p className="mt-1 text-xs font-semibold text-[#817762]">
                      {shiftDef.startTime} - {shiftDef.endTime}
                      {shiftDef.breakStart && shiftDef.breakEnd ? ` | intervalo ${shiftDef.breakStart} - ${shiftDef.breakEnd}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <MonthSchedulePopover shiftDef={shiftDef} />
                    <Chip tone="good">Ativa</Chip>
                  </div>
                </div>
              ) : (
                <p className="text-sm font-semibold text-[#777784]">Sem turno atribuído.</p>
              )}
            </div>
            <div className="rounded-xl border border-[#e8e8ec] bg-[#fbfbfc] p-3">
              <p className="mb-3 text-xs font-black uppercase text-[#9d9da9]">Unidades</p>
              {userUnits.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {userUnits.map((unit) => (
                    <span key={unit.id} className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-black text-[#4f4f5b] ring-1 ring-[#ececf0]">
                      <MapPin className="h-3.5 w-3.5" />
                      {unit.name}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm font-semibold text-[#777784]">Nenhuma unidade vinculada.</p>
              )}
            </div>
          </div>
        </Panel>
      ),
    },
    {
      id: "system.uniforms" as const,
      className: "xl:col-span-3",
      content: (
        <Panel title="Uniformes" icon={Shirt}>
          <CollaboratorUniforms collaborator={user} />
        </Panel>
      ),
    },
    {
      id: "system.vacations" as const,
      className: "",
      content: (
        <Panel title="Férias" icon={Umbrella}>
          <VacationCycleOverview admissionDate={admissionDate} vacations={userVacations} />
          <div className="mb-4 grid grid-cols-3 gap-2">
            <MiniStat label="Aprov." value={`${approvedVacationDays}d`} />
            <MiniStat label="Pend." value={String(pendingVacations)} />
            <MiniStat label="Reg." value={String(userVacations.length)} />
          </div>
          <VacationRows vacations={userVacations} />
        </Panel>
      ),
    },
    {
      id: "system.behavior" as const,
      className: "xl:col-span-2",
      content: (
        <Panel title="Comportamento no sistema" icon={TrendingUp}>
          <div className="space-y-3">
            {[
              ["Usuário operacional", "Aparece nas escalas de trabalho e relatórios operacionais.", user.operacional],
              ["Participa de metas", "Incluído no acompanhamento de metas do quiosque.", user.participatesInGoals],
              ["Vale-transporte", "Colaborador tem direito a vale-transporte por dia trabalhado.", user.needsTransportVoucher],
            ].map(([title, desc, active]) => (
              <div key={String(title)} className="flex items-center justify-between gap-4 rounded-xl border border-[#e8e8ec] bg-[#fbfbfc] p-3">
                <div>
                  <p className="text-sm font-black text-[#1d1d26]">{String(title)}</p>
                  <p className="mt-1 text-xs font-medium text-[#777784]">{String(desc)}</p>
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
      ),
    },
  ].sort((left, right) => blockOrder(left.id) - blockOrder(right.id));

  return (
    <div className="min-h-[calc(100vh-8rem)] bg-[#eeeeef] px-4 py-5 text-[#1d1d26] md:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-[1440px] space-y-4">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/dp/collaborators" className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-[#777784] shadow-sm ring-1 ring-[#dedfe4] hover:text-[#df2f78]">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <span className="text-sm font-black text-[#8f8f9b]">Departamento pessoal</span>
          <ChevronRight className="h-4 w-4 text-[#b5b5bf]" />
          <h1 className="text-lg font-black leading-tight text-[#181820]">Painel DP</h1>
          <Link href="/dashboard/settings?department=pessoal&tab=profile-fields" className="ml-auto rounded-xl bg-white px-3 py-2 text-xs font-black text-[#6f6f7c] shadow-sm ring-1 ring-[#dedfe4] hover:text-[#1d1d26]">
            Editor de campos
          </Link>
        </div>

        <section className="rounded-[18px] border border-[#dedfe4] bg-white p-4 shadow-[0_2px_12px_rgba(15,23,42,0.06)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div className="relative shrink-0">
              {user.avatarUrl ? (
                <img src={user.avatarUrl} alt={user.username} className="h-16 w-16 rounded-[16px] object-cover ring-4 ring-white" />
              ) : (
                <div
                  className={`flex h-16 w-16 items-center justify-center rounded-[16px] text-xl font-black text-white ring-4 ring-white ${avatarColor(user.username)}`}
                  style={user.color ? { backgroundColor: user.color } : undefined}
                >
                  {userInitials}
                </div>
              )}
            </div>
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h2 className="min-w-0 break-words text-xl font-black leading-tight text-[#181820]">{user.username}</h2>
                <span
                  className="inline-flex max-w-full items-center rounded-full bg-[#eafaf2] px-3 py-1 text-xs font-black text-[#008963] sm:max-w-[260px]"
                  title={roleFunctionLabel}
                >
                  <span className="truncate">{roleFunctionLabel}</span>
                </span>
                <span className="inline-flex items-center gap-2 rounded-full bg-[#f3f3f5] px-3 py-1 text-xs font-black text-[#6f6f7c]">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: user.color || "#e92828" }} />
                  Cor na escala
                </span>
              </div>
              <div className="mt-4 grid gap-x-8 gap-y-3 text-xs font-black text-[#24242e] md:grid-cols-4">
                <span>
                  <span className="block text-xs uppercase text-[#9d9da9]">E-mail</span>
                  <span className="mt-1 block max-w-[180px] truncate">{user.email}</span>
                </span>
                <span>
                  <span className="block text-xs uppercase text-[#9d9da9]">Telefone</span>
                  <span className="mt-1 block">{(user as any).phone || "-"}</span>
                </span>
                <span>
                  <span className="block text-xs uppercase text-[#9d9da9]">Último acesso</span>
                  <span className="mt-1 block">{fmtDate((user as any).lastLoginAt)}</span>
                </span>
                <span>
                  <span className="block text-xs uppercase text-[#9d9da9]">Tempo de casa</span>
                  <span className="mt-1 block">{tenure(user.admissionDate)}</span>
                </span>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Link href="/dashboard/settings?department=pessoal&tab=users" className="inline-flex h-10 min-w-28 items-center justify-center rounded-xl bg-[#df2f78] px-4 text-xs font-black text-white shadow-sm hover:bg-[#c92368]">
              Editar dados
            </Link>
            <button type="button" className="grid h-10 w-10 place-items-center rounded-xl border border-[#dedfe4] bg-white text-[#777784]">
              <MoreHorizontal className="h-5 w-5" />
            </button>
          </div>
        </div>
      </section>

        <EmployeeProfileFields userId={user.id} bizneoEmployeeId={user.registrationIdBizneo} />

        <div className="grid gap-4 xl:grid-cols-3">
          {systemBlocks.map((block) => (
            <div key={block.id} className={block.className}>
              {block.content}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-[#f7f7f9] p-3">
      <p className="text-xs font-black uppercase text-[#9d9da9]">{label}</p>
      <p className="mt-1 text-xl font-black text-[#1d1d26]">{value}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-[#f7f7f9] p-3 text-center">
      <p className="text-base font-black text-[#1d1d26]">{value}</p>
      <p className="text-[10px] font-bold text-[#777784]">{label}</p>
    </div>
  );
}

function DocCard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-[#e8e8ec] bg-[#fbfbfc] p-4">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-[#9d9da9] ring-1 ring-[#dedfe4]">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-black uppercase text-[#9d9da9]">{label}</p>
        <p className="mt-1 truncate text-sm font-black text-[#24242e]">{value}</p>
      </div>
    </div>
  );
}
