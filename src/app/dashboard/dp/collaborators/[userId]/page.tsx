"use client";

import React, { use } from "react";
import Link from "next/link";
import { format, differenceInMonths, differenceInYears } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Briefcase,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  Hash,
  IdCard,
  Mail,
  MapPin,
  Shield,
  ShieldOff,
  Star,
  TrendingUp,
  Umbrella,
  UserRound,
  UserX,
  WalletCards,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useDPBootstrap } from "@/hooks/use-dp-bootstrap";
import { useProfiles } from "@/hooks/use-profiles";
import type { DPVacationRecord, User } from "@/types";

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
    <section className={`rounded-[28px] border border-[#ded8c8] bg-[#f8f0de] p-5 ${className}`}>
      <div className="mb-4 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#e9dfc9] text-[#25231f]">
          <Icon className="h-4 w-4" />
        </span>
        <h2 className="text-sm font-black text-[#25231f]">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function InfoLine({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[112px_1fr] gap-3 border-b border-[#e3dccb] py-2.5 text-xs last:border-b-0">
      <span className="font-semibold text-[#817762]">{label}</span>
      <span className="min-w-0 text-right font-bold text-[#25231f]">{value || "-"}</span>
    </div>
  );
}

function MetricBar({ label, value, score, color }: { label: string; value: string; score: number; color: string }) {
  return (
    <div className="grid grid-cols-[150px_1fr_48px] items-center gap-3">
      <div className="flex items-center gap-2">
        <span className={`h-8 w-8 rounded-full ${color}`} />
        <span className="text-xs font-black text-[#25231f]">{label}</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-[#e8dfcc]">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(Math.max(score, 8), 100)}%` }} />
      </div>
      <span className="text-right text-sm font-black text-[#25231f]">{value}</span>
    </div>
  );
}

function Chip({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "good" | "warn" | "bad" }) {
  const tones = {
    default: "bg-[#eee5d1] text-[#5d553f]",
    good: "bg-[#dcebbf] text-[#4d651d]",
    warn: "bg-[#f5dea6] text-[#73530b]",
    bad: "bg-[#f4c6c0] text-[#7f2921]",
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

export default function CollaboratorProfilePage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params);
  const { activeUsers, terminatedUsers, permissions } = useAuth();
  const { profiles } = useProfiles();
  const { shiftDefinitions, units, vacations } = useDPBootstrap();

  if (!permissions.dp?.collaborators?.view) {
    return <p className="p-6 text-sm text-muted-foreground">Sem permissao para acessar este perfil.</p>;
  }

  const allUsers: User[] = [...activeUsers, ...terminatedUsers];
  const user = allUsers.find((entry) => entry.id === userId);

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
  const approvedVacationDays = userVacations
    .filter((vacation) => vacation.status === "APPROVED")
    .reduce((sum, vacation) => sum + vacation.days, 0);
  const pendingVacations = userVacations.filter((vacation) => vacation.status === "PENDING").length;
  const functionsCount = user.jobFunctionNames?.length ?? 0;
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

  return (
    <div className="min-h-[calc(100vh-8rem)] rounded-[32px] border border-[#ded8c8] bg-[#f3ead6] p-4 text-[#25231f] shadow-sm md:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link href="/dashboard/dp/collaborators" className="inline-flex items-center gap-2 rounded-full bg-[#e8dfcc] px-4 py-2 text-xs font-black text-[#5d553f] hover:bg-[#ddd1b8]">
          <ArrowLeft className="h-4 w-4" />
          Colaboradores
        </Link>
        <div className="flex items-center gap-2">
          <Chip tone={isTerminated ? "bad" : "good"}>{isTerminated ? "Desligado" : "Ativo"}</Chip>
          <Chip tone={user.loginRestrictionEnabled ? "warn" : "default"}>
            {user.loginRestrictionEnabled ? "Acesso limitado" : "Acesso livre"}
          </Chip>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[320px_1fr_320px]">
        <aside className="space-y-5">
          <Panel title="Identificacao" icon={UserRound}>
            <div className="flex gap-4">
              {user.avatarUrl ? (
                <img src={user.avatarUrl} alt={user.username} className="h-24 w-24 rounded-[28px] object-cover" />
              ) : (
                <div
                  className={`flex h-24 w-24 shrink-0 items-center justify-center rounded-[28px] text-3xl font-black text-white ${avatarColor(user.username)}`}
                  style={user.color ? { backgroundColor: user.color } : undefined}
                >
                  {initials(user.username)}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-[11px] font-black uppercase text-[#817762]">Colaborador</p>
                <h1 className="mt-1 break-words text-2xl font-black leading-tight">{user.username}</h1>
                <p className="mt-2 text-xs font-semibold text-[#817762]">{user.jobRoleName ?? "Sem cargo definido"}</p>
              </div>
            </div>

            <div className="mt-5 rounded-3xl bg-[#eee5d1] p-4">
              <InfoLine label="UID" value={<span className="break-all">{user.id}</span>} />
              <InfoLine label="E-mail" value={user.email} />
              <InfoLine label="Perfil" value={profile?.name ?? user.profileId} />
              <InfoLine label="Bizneo" value={user.registrationIdBizneo} />
              <InfoLine label="PDV" value={user.registrationIdPdv} />
              <InfoLine label="Nascimento" value={fmtDate(user.birthDate)} />
              <InfoLine label="Admissao" value={fmtDate(user.admissionDate)} />
              <InfoLine label="Tempo" value={tenure(user.admissionDate)} />
            </div>
          </Panel>

          <Panel title="Alertas e beneficios" icon={WalletCards}>
            <div className="grid gap-3">
              <div className="rounded-2xl bg-[#fffaf0] p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-[#817762]">Vale-transporte</span>
                  <BusIcon active={!!user.needsTransportVoucher} />
                </div>
                <p className="mt-2 text-2xl font-black">
                  {user.needsTransportVoucher
                    ? user.transportVoucherValue
                      ? `R$ ${user.transportVoucherValue.toFixed(2)}`
                      : "Sim"
                    : "Nao"}
                </p>
              </div>
              {user.jobRoleProfileSyncDisabled && (
                <div className="flex gap-2 rounded-2xl bg-[#f5dea6] p-3 text-xs font-bold text-[#73530b]">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Sincronizacao de perfil por cargo desativada.
                </div>
              )}
              {isTerminated && (
                <div className="rounded-2xl bg-[#f4c6c0] p-3 text-xs font-bold text-[#7f2921]">
                  Desligado em {fmtDate(user.terminationDate)}. {user.terminationReason ?? ""}
                  {user.terminationNotes ? <p className="mt-1 font-semibold">{user.terminationNotes}</p> : null}
                </div>
              )}
            </div>
          </Panel>
        </aside>

        <main className="space-y-5">
          <Panel title="Resumo geral" icon={TrendingUp}>
            <div className="mb-5 grid gap-3 sm:grid-cols-4">
              <Summary label="Cadastro" value={`${completeness}/9`} />
              <Summary label="Unidades" value={String((user.unitIds ?? []).length)} />
              <Summary label="Funcoes" value={String(functionsCount)} />
              <Summary label="Ferias" value={`${approvedVacationDays}d`} />
            </div>
            <div className="space-y-4">
              <MetricBar label="Dados cadastrais" value={`${Math.round((completeness / 9) * 10)}/10`} score={(completeness / 9) * 100} color="bg-[#f0c84b]" />
              <MetricBar label="Vinculo" value={isTerminated ? "off" : "on"} score={isTerminated ? 30 : 92} color="bg-[#a8b85f]" />
              <MetricBar label="Escala" value={shiftDef ? "ok" : "-"} score={shiftDef ? 86 : 12} color="bg-[#b8d7ee]" />
              <MetricBar label="Acessos" value={user.loginRestrictionEnabled ? "restr." : "livre"} score={user.loginRestrictionEnabled ? 64 : 90} color="bg-[#e6a3d8]" />
              <MetricBar label="Ferias" value={`${userVacations.length}`} score={Math.min(userVacations.length * 18, 100)} color="bg-[#9ec5ab]" />
            </div>
          </Panel>

          <Panel title="Cargo, funcoes e acessos" icon={Briefcase}>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-3xl bg-[#fffaf0] p-4">
                <InfoLine label="Cargo" value={user.jobRoleName} />
                <InfoLine label="Cargo ID" value={user.jobRoleId} />
                <InfoLine label="Operacional" value={user.operacional ? "Sim" : "Nao"} />
                <InfoLine label="Metas" value={user.participatesInGoals ? "Participa" : "Nao participa"} />
              </div>
              <div className="rounded-3xl bg-[#fffaf0] p-4">
                <p className="mb-3 text-xs font-black uppercase text-[#817762]">Funcoes</p>
                {user.jobFunctionNames && user.jobFunctionNames.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {user.jobFunctionNames.map((name) => (
                      <Chip key={name} tone="good">{name}</Chip>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm font-semibold text-[#817762]">Nenhuma funcao vinculada.</p>
                )}
              </div>
            </div>
          </Panel>

          <Panel title="Escala e unidades" icon={Clock}>
            <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
              <div className="rounded-3xl bg-[#fffaf0] p-4">
                {shiftDef ? (
                  <>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-lg font-black">{shiftDef.name}</p>
                        <p className="mt-1 text-xs font-semibold text-[#817762]">
                          {shiftDef.startTime} - {shiftDef.endTime}
                          {shiftDef.breakStart && shiftDef.breakEnd ? ` · intervalo ${shiftDef.breakStart} - ${shiftDef.breakEnd}` : ""}
                        </p>
                      </div>
                      <Chip tone="good">Escala ativa</Chip>
                    </div>
                    <div className="mt-5 grid grid-cols-7 gap-2">
                      {DAYS_PT.map((day, index) => (
                        <div
                          key={day}
                          className={`rounded-2xl py-3 text-center text-[11px] font-black ${
                            shiftDef.daysOfWeek.includes(index)
                              ? "bg-[#25231f] text-white"
                              : "bg-[#eee5d1] text-[#9b9179]"
                          }`}
                        >
                          {day}
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-sm font-semibold text-[#817762]">Sem turno atribuido.</p>
                )}
              </div>
              <div className="rounded-3xl bg-[#fffaf0] p-4">
                <p className="mb-3 text-xs font-black uppercase text-[#817762]">Unidades</p>
                {userUnits.length > 0 ? (
                  <div className="space-y-2">
                    {userUnits.map((unit) => (
                      <div key={unit.id} className="flex items-center gap-2 rounded-2xl bg-[#eee5d1] px-3 py-2 text-xs font-black">
                        <MapPin className="h-3.5 w-3.5" />
                        {unit.name}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm font-semibold text-[#817762]">Nenhuma unidade vinculada.</p>
                )}
              </div>
            </div>
          </Panel>
        </main>

        <aside className="space-y-5">
          <Panel title="Documentos e codigos" icon={IdCard}>
            <div className="space-y-3">
              <DocCard icon={Hash} label="Matricula Bizneo" value={user.registrationIdBizneo ?? "-"} />
              <DocCard icon={Hash} label="Codigo PDV" value={user.registrationIdPdv ?? "-"} />
              <DocCard icon={Mail} label="E-mail" value={user.email ?? "-"} />
              <DocCard icon={BadgeCheck} label="Perfil de acesso" value={profile?.name ?? user.profileId ?? "-"} />
            </div>
          </Panel>

          <Panel title="Ferias" icon={Umbrella}>
            <div className="mb-4 grid grid-cols-3 gap-2">
              <MiniStat label="Aprov." value={`${approvedVacationDays}d`} />
              <MiniStat label="Pend." value={String(pendingVacations)} />
              <MiniStat label="Reg." value={String(userVacations.length)} />
            </div>
            <VacationRows vacations={userVacations} />
          </Panel>

          <Panel title="Seguranca" icon={Shield}>
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-2xl bg-[#fffaf0] p-4">
                <span className="text-xs font-black text-[#817762]">Restricao de login</span>
                {user.loginRestrictionEnabled ? (
                  <Shield className="h-5 w-5 text-amber-700" />
                ) : (
                  <ShieldOff className="h-5 w-5 text-[#817762]" />
                )}
              </div>
              <div className="rounded-2xl bg-[#fffaf0] p-4">
                <p className="text-xs font-black text-[#817762]">Quiosques atribuidos</p>
                <p className="mt-2 break-words text-sm font-black">
                  {(user.assignedKioskIds ?? []).length > 0 ? user.assignedKioskIds.join(", ") : "-"}
                </p>
              </div>
            </div>
          </Panel>
        </aside>
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

function BusIcon({ active }: { active: boolean }) {
  return active ? <CheckCircle2 className="h-5 w-5 text-emerald-700" /> : <Star className="h-5 w-5 text-[#817762]" />;
}
