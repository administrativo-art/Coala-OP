"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  ArrowRight,
  Briefcase,
  Calendar,
  Grid2X2,
  List,
  Mail,
  MapPin,
  Search,
  SlidersHorizontal,
  UserPlus,
  Users,
} from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { useDPBootstrap } from '@/hooks/use-dp-bootstrap';
import type { User } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { UserManagement } from '@/components/user-management';

const COLLABORATOR_GRID = 'minmax(220px,2fr) 1.3fr 1fr 1fr 110px 110px 90px';

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map((n) => n[0]).join('').toUpperCase();
}

function fmtDate(value: any) {
  if (!value) return '-';
  try {
    const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
    return format(date, "dd 'de' MMM. yyyy", { locale: ptBR });
  } catch {
    return '-';
  }
}

function AvatarMark({ user, size = 44 }: { user: User; size?: number }) {
  return (
    <Avatar className="shrink-0 rounded-xl" style={{ width: size, height: size }}>
      <AvatarImage src={user.avatarUrl || undefined} alt={user.username} className="rounded-xl object-cover" />
      <AvatarFallback
        className="rounded-xl bg-[#8a8a94] font-extrabold tracking-[.02em] text-white"
        style={{ backgroundColor: user.color || '#8a8a94', fontSize: size < 40 ? 12 : 14 }}
      >
        {initials(user.username)}
      </AvatarFallback>
    </Avatar>
  );
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex h-[22px] items-center gap-1.5 rounded-full px-2.5 text-[11px] font-extrabold ${
        active ? 'bg-[#eafaf2] text-[#008963]' : 'bg-[#f1f2f5] text-[#8a8a94]'
      }`}
    >
      {active ? 'Ativo' : 'Desligado'}
    </span>
  );
}

function HeaderMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'active' | 'muted';
}) {
  return (
    <span
      className={`inline-flex h-11 items-center gap-1.5 rounded-[13px] border px-3.5 text-[13.5px] font-bold ${
        tone === 'active'
          ? 'border-[#c7ecd8] bg-[#eafaf2] text-[#008963]'
          : 'border-[#e2e0da] bg-white text-[#8a8a94]'
      }`}
    >
      <strong className={`text-base font-black ${tone === 'active' ? '' : 'text-[#494952]'}`}>{value}</strong>
      {label}
    </span>
  );
}

function CollaboratorCard({
  user,
  unitNames,
  shiftName,
  onOpen,
}: {
  user: User;
  unitNames: string[];
  shiftName: string | null;
  onOpen: () => void;
}) {
  const isActive = user.isActive !== false;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group overflow-hidden rounded-[18px] border border-[#e6e4de] bg-white text-left shadow-[0_2px_10px_rgba(15,23,42,.05)] transition hover:-translate-y-0.5 hover:border-[#d7d5cd] hover:shadow-[0_12px_24px_-12px_rgba(15,23,42,.22)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#df2f78]"
    >
      <div className="flex items-center justify-between border-b border-[#f1f0ec] bg-[#faf9f6] px-3.5 py-3">
        <span className="rounded-[7px] border border-[#e2e0da] bg-white px-[7px] py-0.5 font-mono text-[11px] font-semibold text-[#8a8a94]">
          {user.registrationIdBizneo || user.registrationIdPdv || 'Cadastro'}
        </span>
        <StatusPill active={isActive} />
      </div>
      <div className="p-4">
        <div className="flex items-center gap-3">
          <AvatarMark user={user} />
          <div className="min-w-0">
            <p className="truncate text-[14.5px] font-extrabold text-[#1d1d26]">{user.username}</p>
            <p className="truncate text-[12.5px] font-medium text-[#8a8a94]">{user.jobRoleName || '-'}</p>
          </div>
        </div>
        <div className="mt-3.5 flex flex-col gap-[7px] text-[12.5px] font-medium text-[#8a8a94]">
          {user.email ? (
            <span className="flex items-center gap-2 truncate"><Mail className="h-[13px] w-[13px] shrink-0 text-[#b4b4bd]" />{user.email}</span>
          ) : null}
          <span className="flex items-center gap-2 truncate"><MapPin className="h-[13px] w-[13px] shrink-0 text-[#b4b4bd]" />{unitNames.length ? unitNames.join(', ') : 'Sem unidade'}</span>
          <span className="flex items-center gap-2 truncate"><Calendar className="h-[13px] w-[13px] shrink-0 text-[#b4b4bd]" />{shiftName || 'Sem turno padrão'}</span>
        </div>
        <div className="mt-3.5 flex items-center justify-between border-t border-[#f1f0ec] pt-3">
          <span className="text-xs font-medium text-[#a6a6b0]">desde {fmtDate(user.admissionDate)}</span>
          <span className="inline-flex items-center gap-1.5 text-[12.5px] font-extrabold text-[#df2f78]">
            Abrir <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
          </span>
        </div>
      </div>
    </button>
  );
}

export default function DPCollaboratorsPage() {
  const { permissions, activeUsers, terminatedUsers, user: currentUser } = useAuth();
  const { shiftDefinitions, shiftDefsLoading, units } = useDPBootstrap();
  const router = useRouter();
  const ownProfileOnly = permissions.dp?.collaborators?.ownProfileOnly === true;

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'terminated'>('active');
  const [unitFilter, setUnitFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('cards');
  const [newUserOpen, setNewUserOpen] = useState(false);

  const allUsers = useMemo(() => [...activeUsers, ...terminatedUsers], [activeUsers, terminatedUsers]);

  const roleOptions = useMemo(() => {
    return Array.from(new Set(allUsers.map((user) => user.jobRoleName).filter(Boolean) as string[]))
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [allUsers]);

  const unitNameById = useMemo(() => new Map(units.map((unit) => [unit.id, unit.name])), [units]);
  const shiftNameById = useMemo(() => new Map(shiftDefinitions.map((shift) => [shift.id, shift.name])), [shiftDefinitions]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allUsers.filter((user) => {
      const isActive = user.isActive !== false;
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && isActive) ||
        (statusFilter === 'terminated' && !isActive);
      const matchesUnit = unitFilter === 'all' || (user.unitIds ?? []).includes(unitFilter);
      const matchesRole = roleFilter === 'all' || user.jobRoleName === roleFilter;
      const matchesSearch = !q || [
        user.username,
        user.email,
        user.jobRoleName,
        user.registrationIdBizneo,
        user.registrationIdPdv,
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(q));

      return matchesStatus && matchesUnit && matchesRole && matchesSearch;
    });
  }, [allUsers, search, statusFilter, unitFilter, roleFilter]);

  useEffect(() => {
    if (!ownProfileOnly || !currentUser?.id) return;
    router.replace(`/dashboard/dp/collaborators/${currentUser.id}`);
  }, [currentUser?.id, ownProfileOnly, router]);

  if (!permissions.dp?.collaborators?.view) {
    return <p className="p-6 text-sm text-muted-foreground">Sem permissão para acessar colaboradores.</p>;
  }

  if (ownProfileOnly) {
    return <p className="p-6 text-sm text-muted-foreground">Abrindo seu perfil de Gestão do colaborador...</p>;
  }

  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-start justify-between gap-5">
        <div className="flex min-w-0 items-start gap-4">
          <div className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-[15px] bg-[#fde5f0] text-[#df2f78]">
            <Users className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <p className="text-[11.5px] font-extrabold uppercase tracking-[.12em] text-[#df2f78]">Departamento pessoal</p>
            <h1 className="mt-1 text-[30px] font-black tracking-[-.02em] text-[#181820]">Colaboradores</h1>
            <p className="mt-1.5 max-w-[560px] text-[14.5px] font-medium leading-[1.5] text-[#6f6f7c]">
              Perfis, vínculos, escalas e histórico operacional da equipe.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <HeaderMetric label="ativos" value={activeUsers.length} tone="active" />
          <HeaderMetric label={terminatedUsers.length === 1 ? 'desligado' : 'desligados'} value={terminatedUsers.length} tone="muted" />
          {permissions.settings.manageUsers ? (
            <Button
              type="button"
              onClick={() => setNewUserOpen(true)}
              className="h-11 rounded-[13px] bg-[#df2f78] px-5 text-[13.5px] font-extrabold text-white shadow-[0_8px_18px_-8px_#df2f78] hover:bg-[#cc2069]"
            >
              <UserPlus className="mr-2 h-[17px] w-[17px]" />
              Novo usuário
            </Button>
          ) : null}
        </div>
      </section>

      <div className="rounded-[20px] border border-[#e2e0da] bg-white p-[18px] shadow-[0_2px_10px_rgba(15,23,42,.06)]">
        <div className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[.08em] text-[#9d9da9]">
          <SlidersHorizontal className="h-[15px] w-[15px]" />
          Filtros e visualização
        </div>
        <div className="mt-3.5 grid gap-2.5 lg:grid-cols-[minmax(240px,1fr)_150px_180px_180px_auto] lg:items-center">
          <div className="relative min-w-60 flex-1">
            <Search className="absolute left-3.5 top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-[#9d9da9]" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nome, e-mail, cargo, matrícula…"
              className="h-11 rounded-xl border-0 bg-[#f6f5f2] pl-11 text-sm font-medium placeholder:text-[#9d9da9]"
            />
          </div>
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}>
            <SelectTrigger className="h-11 w-full rounded-xl border-[#e2e0da] bg-white text-[13.5px] font-bold text-[#494952]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              <SelectItem value="active">Ativos</SelectItem>
              <SelectItem value="terminated">Desligados</SelectItem>
            </SelectContent>
          </Select>
          <Select value={unitFilter} onValueChange={setUnitFilter}>
            <SelectTrigger className="h-11 w-full rounded-xl border-[#e2e0da] bg-white text-[13.5px] font-bold text-[#494952]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as unidades</SelectItem>
              {units.map((unit) => <SelectItem key={unit.id} value={unit.id}>{unit.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="h-11 w-full rounded-xl border-[#e2e0da] bg-white text-[13.5px] font-bold text-[#494952]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as funções</SelectItem>
              {roleOptions.map((role) => <SelectItem key={role} value={role}>{role}</SelectItem>)}
            </SelectContent>
          </Select>
          <ToggleGroup
            type="single"
            value={viewMode}
            onValueChange={(value) => value && setViewMode(value as 'table' | 'cards')}
            className="h-11 justify-start gap-[3px] rounded-xl bg-[#eceae4] p-1"
          >
            <ToggleGroupItem
              value="cards"
              aria-label="Cards"
              className="h-9 w-9 rounded-[9px] text-[#8a8a94] data-[state=on]:bg-white data-[state=on]:text-[#df2f78] data-[state=on]:shadow-[0_1px_4px_rgba(20,22,28,.12)]"
            >
              <Grid2X2 className="h-[17px] w-[17px]" />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="table"
              aria-label="Tabela"
              className="h-9 w-9 rounded-[9px] text-[#8a8a94] data-[state=on]:bg-white data-[state=on]:text-[#df2f78] data-[state=on]:shadow-[0_1px_4px_rgba(20,22,28,.12)]"
            >
              <List className="h-[17px] w-[17px]" />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {shiftDefsLoading && shiftDefinitions.length === 0 ? (
        viewMode === 'cards' ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[...Array(8)].map((_, index) => <Skeleton key={index} className="h-56 w-full" />)}
          </div>
        ) : (
          <div className="rounded-md border bg-card p-3">
            {[...Array(6)].map((_, index) => <Skeleton key={index} className="mb-2 h-10 w-full last:mb-0" />)}
          </div>
        )
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border bg-white py-16 text-center text-muted-foreground shadow-sm">
          <Briefcase className="mx-auto mb-2 h-8 w-8" />
          Nenhum colaborador encontrado.
        </div>
      ) : viewMode === 'cards' ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {filtered.map((user) => {
            const unitNames = (user.unitIds ?? []).map((id) => unitNameById.get(id) ?? id);
            const shiftName = user.shiftDefinitionId ? shiftNameById.get(user.shiftDefinitionId) ?? null : null;
            return (
              <CollaboratorCard
                key={user.id}
                user={user}
                unitNames={unitNames}
                shiftName={shiftName}
                onOpen={() => router.push(`/dashboard/dp/collaborators/${user.id}`)}
              />
            );
          })}
        </div>
      ) : (
        <div className="overflow-hidden rounded-[20px] border border-[#e2e0da] bg-white shadow-[0_2px_10px_rgba(15,23,42,.06)]">
          <div className="overflow-x-auto">
            <div className="min-w-[980px]">
              <div
                className="grid items-center gap-3.5 border-b border-[#ececf0] bg-[#fbfbfc] px-5 py-3 text-[10.5px] font-extrabold uppercase tracking-[.07em] text-[#9d9da9]"
                style={{ gridTemplateColumns: COLLABORATOR_GRID }}
              >
                <span>Colaborador</span>
                <span>Cargo / função</span>
                <span>Unidades</span>
                <span>Turno</span>
                <span>Admissão</span>
                <span>Status</span>
                <span className="text-right">Ações</span>
              </div>
              {filtered.map((user) => {
                const unitNames = (user.unitIds ?? []).map((id) => unitNameById.get(id) ?? id);
                const shiftName = user.shiftDefinitionId ? shiftNameById.get(user.shiftDefinitionId) : null;
                return (
                  <div
                    key={user.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push(`/dashboard/dp/collaborators/${user.id}`)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        router.push(`/dashboard/dp/collaborators/${user.id}`);
                      }
                    }}
                    className="grid cursor-pointer items-center gap-3.5 border-t border-[#f2f2f5] px-5 py-3 transition hover:bg-[#fbfbfc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#df2f78]"
                    style={{ gridTemplateColumns: COLLABORATOR_GRID }}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <AvatarMark user={user} size={36} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-extrabold text-[#1d1d26]">{user.username}</p>
                        <p className="truncate text-xs font-medium text-[#a6a6b0]">{user.email || '—'}</p>
                      </div>
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px] font-semibold text-[#494952]">{user.jobRoleName || '—'}</p>
                      {user.jobFunctionNames?.length ? (
                        <p className="truncate text-xs font-medium text-[#a6a6b0]">{user.jobFunctionNames.join(', ')}</p>
                      ) : null}
                    </div>
                    <p className="truncate text-[13px] font-medium text-[#6f6f7c]">{unitNames.length ? unitNames.join(', ') : '—'}</p>
                    <p className="truncate text-[13px] font-medium text-[#6f6f7c]">{shiftName || '—'}</p>
                    <p className="truncate text-[13px] font-medium text-[#6f6f7c]">{fmtDate(user.admissionDate)}</p>
                    <div><StatusPill active={user.isActive !== false} /></div>
                    <div className="text-right">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          router.push(`/dashboard/dp/collaborators/${user.id}`);
                        }}
                        className="inline-flex h-8 items-center rounded-[9px] border border-[#e2e0da] bg-white px-3 text-[12.5px] font-extrabold text-[#6f6f7c] hover:bg-[#f6f5f2]"
                      >
                        Abrir
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      <Dialog open={newUserOpen} onOpenChange={setNewUserOpen}>
        <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] overflow-y-auto rounded-[22px] p-0 sm:max-w-[min(980px,calc(100vw-2rem))]">
          <DialogHeader className="space-y-0 border-b border-[#f0efeb] px-7 pb-5 pt-6 text-left">
            <p className="flex items-center gap-2 text-[11.5px] font-extrabold uppercase tracking-[.1em] text-[#df2f78]">
              Gestão do colaborador
              <span className="text-[#e2b8cd]">›</span>
              <span className="text-[#c9a6b8]">Novo usuário</span>
            </p>
            <DialogTitle className="mt-2 text-[23px] font-black tracking-[-.02em] text-[#181820]">Novo usuário</DialogTitle>
            <DialogDescription className="mt-1.5 max-w-[640px] text-[13.5px] font-medium leading-[1.5] text-[#6f6f7c]">
              Cadastre o acesso e o vínculo inicial do colaborador. Vale-transporte é tratado no perfil do colaborador.
            </DialogDescription>
          </DialogHeader>
          <div className="px-7 py-6">
            {newUserOpen ? (
              <UserManagement
                createOnly
                onClose={() => setNewUserOpen(false)}
                contextLabel="Colaboradores › Novo usuário"
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
