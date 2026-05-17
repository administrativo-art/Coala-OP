"use client";

import React, { use, useMemo } from 'react';
import Link from 'next/link';
import { format, differenceInYears, differenceInMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  ArrowLeft, Calendar, Clock, Building2, Briefcase, Mail,
  Shield, ShieldOff, Bus, AlertTriangle, CheckCircle2,
  Loader2, UserX, Hash, Star, Umbrella, TrendingUp,
  ChevronRight,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useDPBootstrap } from '@/hooks/use-dp-bootstrap';
import type { User, DPVacationRecord, DPShiftDefinition, DPUnit } from '@/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DAYS_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const AVATAR_COLORS = [
  'bg-indigo-500', 'bg-purple-500', 'bg-pink-500', 'bg-blue-500',
  'bg-teal-500', 'bg-orange-500', 'bg-green-500', 'bg-rose-500',
  'bg-cyan-500', 'bg-amber-500', 'bg-violet-500', 'bg-emerald-500',
];

function avatarColor(name: string) {
  return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
}

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase();
}

function fmtDate(ts: any, pattern = "dd/MM/yyyy") {
  try { return format(ts.toDate ? ts.toDate() : new Date(ts), pattern, { locale: ptBR }); }
  catch { return '—'; }
}

function tenure(ts: any): string {
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const years = differenceInYears(new Date(), d);
    const months = differenceInMonths(new Date(), d) % 12;
    if (years > 0) return `${years} ano${years > 1 ? 's' : ''}${months > 0 ? ` e ${months} mês${months > 1 ? 'es' : ''}` : ''}`;
    return `${differenceInMonths(new Date(), d)} meses`;
  } catch { return '—'; }
}

const VACATION_STATUS: Record<string, { label: string; color: string }> = {
  PENDING:  { label: 'Pendente',  color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20' },
  APPROVED: { label: 'Aprovado',  color: 'text-green-400  bg-green-500/10  border-green-500/20' },
  REJECTED: { label: 'Rejeitado', color: 'text-red-400    bg-red-500/10    border-red-500/20' },
  PLANNED:  { label: 'Planejado', color: 'text-blue-400   bg-blue-500/10   border-blue-500/20' },
};

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, icon: Icon, children }: {
  title: string; icon: React.ElementType; children: React.ReactNode;
}) {
  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-4 border-b border-slate-800/60">
        <div className="p-1.5 bg-slate-800 rounded-lg">
          <Icon className="h-3.5 w-3.5 text-slate-400" />
        </div>
        <h3 className="text-sm font-bold text-white">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function InfoRow({ label, value, accent }: { label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-slate-800/40 last:border-0">
      <span className="text-xs text-slate-500 flex-shrink-0">{label}</span>
      <span className={`text-xs font-medium text-right ${accent ? 'text-indigo-400' : 'text-slate-200'}`}>
        {value}
      </span>
    </div>
  );
}

// ─── Profile sections ─────────────────────────────────────────────────────────

function DadosBasicos({ user }: { user: User }) {
  return (
    <Section title="Dados pessoais" icon={Briefcase}>
      <InfoRow label="Admissão" value={user.admissionDate ? fmtDate(user.admissionDate) : '—'} />
      {user.admissionDate && (
        <InfoRow label="Tempo de empresa" value={tenure(user.admissionDate)} accent />
      )}
      <InfoRow label="Nascimento" value={user.birthDate ? fmtDate(user.birthDate) : '—'} />
      <InfoRow label="Matrícula Bizneo" value={user.registrationIdBizneo || '—'} />
      <InfoRow label="Código PDV" value={user.registrationIdPdv || '—'} />
      {user.needsTransportVoucher && (
        <InfoRow
          label="Vale-transporte"
          value={user.transportVoucherValue
            ? `R$ ${user.transportVoucherValue.toFixed(2)}`
            : 'Sim'}
          accent
        />
      )}
    </Section>
  );
}

function EscalaSection({ user, shiftDefinitions, units }: {
  user: User;
  shiftDefinitions: DPShiftDefinition[];
  units: DPUnit[];
}) {
  const shiftDef = shiftDefinitions.find(d => d.id === user.shiftDefinitionId);
  const userUnits = units.filter(u => user.unitIds?.includes(u.id));

  return (
    <Section title="Escala e unidades" icon={Clock}>
      {shiftDef ? (
        <div className="space-y-4">
          <div className="p-4 bg-slate-800/50 rounded-xl">
            <div className="flex items-center justify-between mb-2">
              <p className="font-semibold text-white text-sm">{shiftDef.name}</p>
              <span className="text-sm font-bold text-indigo-400">
                {shiftDef.startTime} – {shiftDef.endTime}
              </span>
            </div>
            {shiftDef.breakStart && shiftDef.breakEnd && (
              <p className="text-xs text-slate-500">
                Intervalo: {shiftDef.breakStart} – {shiftDef.breakEnd}
              </p>
            )}
            <div className="flex gap-1.5 mt-3">
              {DAYS_PT.map((d, i) => (
                <div key={d}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold transition-colors ${
                    shiftDef.daysOfWeek.includes(i)
                      ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                      : 'bg-slate-800/50 text-slate-600'
                  }`}>
                  {d.slice(0, 3)}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-500">Sem turno atribuído.</p>
      )}

      {userUnits.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-slate-500 mb-2">Unidades de trabalho</p>
          <div className="flex flex-wrap gap-2">
            {userUnits.map(u => (
              <span key={u.id}
                className="flex items-center gap-1.5 text-xs text-slate-300 bg-slate-800/70 px-3 py-1.5 rounded-lg border border-slate-700/50">
                <Building2 className="h-3 w-3 text-slate-500" /> {u.name}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 pt-4 border-t border-slate-800/40">
        <InfoRow
          label="Limitador de login"
          value={
            user.loginRestrictionEnabled
              ? <span className="flex items-center gap-1 text-amber-400"><Shield className="h-3 w-3" /> Ativo</span>
              : <span className="flex items-center gap-1 text-slate-500"><ShieldOff className="h-3 w-3" /> Inativo</span>
          }
        />
      </div>
    </Section>
  );
}

function FeriasSection({ user, vacations }: { user: User; vacations: DPVacationRecord[] }) {
  const userVacations = vacations.filter(v => v.userId === user.id);
  const sortedVacations = [...userVacations].sort((a, b) => {
    if (!a.startDate && !b.startDate) return 0;
    if (!a.startDate) return 1;
    if (!b.startDate) return -1;
    return b.startDate.localeCompare(a.startDate);
  });

  const totalApproved = userVacations
    .filter(v => v.status === 'APPROVED')
    .reduce((acc, v) => acc + v.days, 0);

  const upcoming = userVacations.filter(v =>
    (v.status === 'APPROVED' || v.status === 'PLANNED') &&
    v.startDate && v.startDate >= new Date().toISOString().split('T')[0]
  );

  return (
    <Section title="Férias" icon={Umbrella}>
      {userVacations.length === 0 ? (
        <p className="text-sm text-slate-500">Nenhum registro de férias.</p>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            <div className="p-3 bg-slate-800/50 rounded-xl text-center">
              <p className="text-2xl font-bold text-white">{totalApproved}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">dias aprovados</p>
            </div>
            <div className="p-3 bg-slate-800/50 rounded-xl text-center">
              <p className="text-2xl font-bold text-indigo-400">{upcoming.length}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">agendadas</p>
            </div>
            <div className="p-3 bg-slate-800/50 rounded-xl text-center">
              <p className="text-2xl font-bold text-slate-300">{userVacations.length}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">registros</p>
            </div>
          </div>

          {/* Records */}
          <div className="space-y-2">
            {sortedVacations.slice(0, 6).map(v => {
              const statusCfg = VACATION_STATUS[v.status] ?? { label: v.status, color: 'text-slate-400' };
              return (
                <div key={v.id}
                  className="flex items-center gap-3 p-3 bg-slate-800/30 rounded-xl border border-slate-800/40">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-white">
                        {v.recordType === 'gozo' ? 'Gozo' : 'Venda'} — {v.days} dia{v.days !== 1 ? 's' : ''}
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${statusCfg.color}`}>
                        {statusCfg.label}
                      </span>
                    </div>
                    {v.startDate && (
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {v.startDate} {v.endDate ? `→ ${v.endDate}` : ''}
                        {v.cycleId && ` · Ciclo ${v.cycleId}`}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
            {sortedVacations.length > 6 && (
              <p className="text-xs text-slate-600 text-center pt-1">
                + {sortedVacations.length - 6} registros mais antigos
              </p>
            )}
          </div>
        </>
      )}
    </Section>
  );
}

function CargosSection({ user }: { user: User }) {
  return (
    <Section title="Cargos e funções" icon={Star}>
      <InfoRow label="Cargo" value={user.jobRoleName || '—'} accent={!!user.jobRoleName} />
      {user.jobFunctionNames && user.jobFunctionNames.length > 0 && (
        <div className="pt-2">
          <p className="text-xs text-slate-500 mb-2">Funções</p>
          <div className="flex flex-wrap gap-2">
            {user.jobFunctionNames.map((fn, i) => (
              <span key={i} className="text-xs text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-1 rounded-lg">
                {fn}
              </span>
            ))}
          </div>
        </div>
      )}
      {user.jobRoleProfileSyncDisabled && (
        <div className="mt-3 flex items-center gap-2 text-xs text-amber-400/80 bg-amber-500/5 border border-amber-500/10 rounded-lg px-3 py-2">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
          Sincronização de perfil desativada
        </div>
      )}
    </Section>
  );
}

// ─── Profile page ─────────────────────────────────────────────────────────────

export default function CollaboratorProfilePage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params);
  const { activeUsers, terminatedUsers, permissions } = useAuth();
  const { shiftDefinitions, shiftDefsLoading, units, vacations, vacationsLoading } = useDPBootstrap();

  if (!permissions.dp?.collaborators?.view) {
    return <p className="text-slate-400 p-6">Sem permissão para acessar este perfil.</p>;
  }

  const allUsers: User[] = [...activeUsers, ...terminatedUsers];
  const user = allUsers.find(u => u.id === userId);

  const isLoading = shiftDefsLoading && shiftDefinitions.length === 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-7 w-7 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="p-6 space-y-3 text-center">
        <UserX className="h-12 w-12 text-slate-700 mx-auto" />
        <p className="text-slate-400">Colaborador não encontrado.</p>
        <Link href="/dashboard/dp/collaborators"
          className="text-sm text-indigo-400 hover:text-indigo-300 flex items-center justify-center gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Link>
      </div>
    );
  }

  const isTerminated = user.isActive === false;
  const color = avatarColor(user.username);
  const shiftDef = shiftDefinitions.find(d => d.id === user.shiftDefinitionId);

  return (
    <div className="space-y-6">
      {/* Back */}
      <Link href="/dashboard/dp/collaborators"
        className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors">
        <ArrowLeft className="h-4 w-4" /> Colaboradores
      </Link>

      {/* Profile header */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6">
        <div className="flex flex-col sm:flex-row items-start gap-5">
          {/* Avatar */}
          <div
            className={`w-20 h-20 rounded-2xl flex items-center justify-center text-2xl font-bold text-white flex-shrink-0 ${color}`}
            style={user.color ? { backgroundColor: user.color } : {}}
          >
            {initials(user.username)}
          </div>

          {/* Name + meta */}
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-3 mb-1">
              <h1 className="text-2xl font-bold text-white tracking-tight">{user.username}</h1>
              {isTerminated ? (
                <span className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
                  <UserX className="h-3.5 w-3.5" /> Desligado
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Ativo
                </span>
              )}
              {user.loginRestrictionEnabled && (
                <span className="flex items-center gap-1 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
                  <Shield className="h-3 w-3" /> Acesso limitado
                </span>
              )}
            </div>

            <p className="text-slate-400 text-sm mb-3">
              {user.jobRoleName || 'Sem cargo definido'}
            </p>

            <div className="flex flex-wrap gap-3 text-xs text-slate-500">
              {user.email && (
                <span className="flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5" /> {user.email}
                </span>
              )}
              {shiftDef && (
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" /> {shiftDef.name} · {shiftDef.startTime}–{shiftDef.endTime}
                </span>
              )}
              {user.admissionDate && (
                <span className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" /> Desde {fmtDate(user.admissionDate, "MMM. yyyy")} · {tenure(user.admissionDate)}
                </span>
              )}
              {user.registrationIdBizneo && (
                <span className="flex items-center gap-1.5">
                  <Hash className="h-3.5 w-3.5" /> {user.registrationIdBizneo}
                </span>
              )}
            </div>
          </div>

          {/* Quick stats */}
          <div className="flex gap-3 flex-shrink-0">
            <div className="p-3 bg-slate-800/50 rounded-xl text-center min-w-[64px]">
              <p className="text-xl font-bold text-white">
                {vacations.filter(v => v.userId === user.id && v.status === 'APPROVED').reduce((s, v) => s + v.days, 0)}
              </p>
              <p className="text-[10px] text-slate-500 mt-0.5">dias férias</p>
            </div>
            <div className="p-3 bg-slate-800/50 rounded-xl text-center min-w-[64px]">
              <p className="text-xl font-bold text-indigo-400">
                {(user.unitIds ?? []).length}
              </p>
              <p className="text-[10px] text-slate-500 mt-0.5">unidade{(user.unitIds ?? []).length !== 1 ? 's' : ''}</p>
            </div>
          </div>
        </div>

        {/* Termination notice */}
        {isTerminated && (
          <div className="mt-5 p-4 bg-red-500/5 border border-red-500/20 rounded-xl">
            <div className="flex items-start gap-2 text-sm text-red-300">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">Colaborador desligado</span>
                {user.terminationDate && <span> em {fmtDate(user.terminationDate)}</span>}
                {user.terminationReason && <span> · {user.terminationReason}</span>}
                {user.terminationNotes && <p className="text-xs text-red-400/70 mt-1">{user.terminationNotes}</p>}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left col */}
        <div className="space-y-5">
          <DadosBasicos user={user} />
          <CargosSection user={user} />
        </div>

        {/* Center + right */}
        <div className="lg:col-span-2 space-y-5">
          <EscalaSection user={user} shiftDefinitions={shiftDefinitions} units={units} />
          <FeriasSection user={user} vacations={vacations} />
        </div>
      </div>
    </div>
  );
}
