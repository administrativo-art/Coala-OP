"use client";

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Search, Users, UserX, Clock, Building2, Briefcase, Calendar } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useDPBootstrap } from '@/hooks/use-dp-bootstrap';
import type { User, DPShiftDefinition } from '@/types';

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase();
}

const AVATAR_COLORS = [
  'bg-indigo-500', 'bg-purple-500', 'bg-pink-500', 'bg-blue-500',
  'bg-teal-500',   'bg-orange-500', 'bg-green-500', 'bg-rose-500',
  'bg-cyan-500',   'bg-amber-500',  'bg-violet-500','bg-emerald-500',
];

function avatarColor(name: string, colorHex?: string) {
  if (colorHex) return '';
  return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
}

function fmtDate(ts: any) {
  try { return format(ts.toDate(), "dd 'de' MMM. yyyy", { locale: ptBR }); } catch { return '—'; }
}

function CollaboratorCard({ user, shiftDefinitions, onClick }: {
  user: User;
  shiftDefinitions: DPShiftDefinition[];
  onClick: () => void;
}) {
  const shiftDef = shiftDefinitions.find(d => d.id === user.shiftDefinitionId);
  const color = avatarColor(user.username, user.color);
  const isTerminated = user.isActive === false;

  return (
    <button
      onClick={onClick}
      className={`group w-full text-left p-5 rounded-2xl border transition-all ${
        isTerminated
          ? 'bg-slate-900/30 border-slate-800/50 hover:border-slate-700'
          : 'bg-slate-900/60 border-slate-800 hover:border-indigo-500/40 hover:shadow-lg hover:shadow-indigo-500/5'
      }`}
    >
      {/* Avatar + name */}
      <div className="flex items-start gap-3 mb-4">
        <div
          className={`w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0 ${color}`}
          style={user.color ? { backgroundColor: user.color } : {}}
        >
          {initials(user.username)}
        </div>
        <div className="flex-1 min-w-0 pt-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-white text-sm group-hover:text-indigo-300 transition-colors truncate">
              {user.username}
            </p>
            {isTerminated && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
                Desligado
              </span>
            )}
          </div>
          {user.jobRoleName && (
            <p className="text-xs text-slate-500 truncate mt-0.5">{user.jobRoleName}</p>
          )}
        </div>
      </div>

      {/* Metadata chips */}
      <div className="flex flex-wrap gap-2">
        {shiftDef && (
          <span className="flex items-center gap-1.5 text-[11px] text-slate-400 bg-slate-800/70 px-2.5 py-1 rounded-lg">
            <Clock className="h-3 w-3 text-slate-500" />
            {shiftDef.startTime}–{shiftDef.endTime}
          </span>
        )}
        {user.admissionDate && (
          <span className="flex items-center gap-1.5 text-[11px] text-slate-400 bg-slate-800/70 px-2.5 py-1 rounded-lg">
            <Calendar className="h-3 w-3 text-slate-500" />
            {fmtDate(user.admissionDate)}
          </span>
        )}
        {user.unitIds && user.unitIds.length > 0 && (
          <span className="flex items-center gap-1.5 text-[11px] text-slate-400 bg-slate-800/70 px-2.5 py-1 rounded-lg">
            <Building2 className="h-3 w-3 text-slate-500" />
            {user.unitIds.length} unidade{user.unitIds.length !== 1 ? 's' : ''}
          </span>
        )}
        {isTerminated && user.terminationDate && (
          <span className="flex items-center gap-1.5 text-[11px] text-red-400/70 bg-red-500/5 px-2.5 py-1 rounded-lg">
            Deslig. {fmtDate(user.terminationDate)}
          </span>
        )}
      </div>
    </button>
  );
}

export default function DPCollaboratorsPage() {
  const { permissions, activeUsers, terminatedUsers } = useAuth();
  const { shiftDefinitions, shiftDefsLoading } = useDPBootstrap();
  const router = useRouter();

  const [tab, setTab] = useState<'active' | 'terminated'>('active');
  const [search, setSearch] = useState('');

  if (!permissions.dp?.collaborators?.view) {
    return <p className="text-slate-400 p-6">Sem permissão para acessar Colaboradores.</p>;
  }

  const pool = tab === 'active' ? activeUsers : terminatedUsers;

  const filtered = useMemo(() => {
    if (!search.trim()) return pool;
    const q = search.toLowerCase();
    return pool.filter(u =>
      u.username.toLowerCase().includes(q) ||
      (u.registrationIdBizneo ?? '').toLowerCase().includes(q) ||
      (u.registrationIdPdv ?? '').toLowerCase().includes(q) ||
      (u.jobRoleName ?? '').toLowerCase().includes(q)
    );
  }, [pool, search]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Colaboradores</h1>
          <p className="text-slate-400 mt-1 text-sm">
            {activeUsers.length} ativo{activeUsers.length !== 1 ? 's' : ''} · {terminatedUsers.length} desligado{terminatedUsers.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome, cargo, matrícula…"
            className="pl-10 pr-4 py-2.5 bg-slate-900/50 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 w-72 text-sm"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-slate-900/50 border border-slate-800 rounded-xl p-1 w-fit">
        <button onClick={() => setTab('active')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            tab === 'active' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-300'
          }`}>
          <Users className="h-4 w-4" />
          Ativos
          <span className="bg-indigo-500/20 text-indigo-300 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
            {activeUsers.length}
          </span>
        </button>
        <button onClick={() => setTab('terminated')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            tab === 'terminated' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-300'
          }`}>
          <UserX className="h-4 w-4" />
          Desligados
          <span className="bg-slate-700 text-slate-400 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
            {terminatedUsers.length}
          </span>
        </button>
      </div>

      {/* Grid */}
      {shiftDefsLoading && shiftDefinitions.length === 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-36 bg-slate-900/40 border border-slate-800/50 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center">
          <Briefcase className="h-10 w-10 text-slate-700 mx-auto mb-3" />
          <p className="text-slate-500">
            {search ? 'Nenhum colaborador encontrado.' : `Nenhum colaborador ${tab === 'active' ? 'ativo' : 'desligado'}.`}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map(user => (
            <CollaboratorCard
              key={user.id}
              user={user}
              shiftDefinitions={shiftDefinitions}
              onClick={() => router.push(`/dashboard/dp/collaborators/${user.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
