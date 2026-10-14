"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { HeroChip } from '@/components/patterns/hero-chip';
import { PageHero } from '@/components/patterns/page-hero';
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
} from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { useDPBootstrap } from '@/hooks/use-dp-bootstrap';
import { activeOperationalUnits } from '@/lib/dp-units';
import type { User } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { UserManagement } from '@/components/user-management';
import { formatPersonName } from '@/lib/person-name';
import { canAccessUserByUnit, filterUnitsByAccess } from '@/lib/unit-access';

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
  const displayName = formatPersonName(user.username) || user.username;
  return (
    <Avatar className="shrink-0 rounded-xl" style={{ width: size, height: size }}>
      <AvatarImage src={user.avatarUrl || undefined} alt={displayName} className="rounded-xl object-cover" />
      <AvatarFallback
        className="rounded-xl bg-ds-ink-faint font-extrabold tracking-[.02em] text-white"
        style={{ backgroundColor: user.color || '#8a8a94', fontSize: size < 40 ? 12 : 14 }}
      >
        {initials(displayName)}
      </AvatarFallback>
    </Avatar>
  );
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex h-[22px] items-center gap-1.5 rounded-full px-2.5 text-[11px] font-extrabold ${
        active ? 'bg-ds-ok-bg text-ds-ok' : 'bg-ds-muted text-ds-ink-faint'
      }`}
    >
      {active ? 'Ativo' : 'Desligado'}
    </span>
  );
}

function CollaboratorInfoTile({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone: 'slate' | 'green' | 'blue';
}) {
  const toneClass = {
    slate: {
      shell: 'bg-ds-muted',
      icon: 'bg-ds-surface text-ds-ink-muted',
      value: 'text-ds-ink',
      label: 'text-ds-ink-muted',
    },
    green: {
      shell: 'bg-ds-ok-bg',
      icon: 'bg-ds-surface text-ds-ok',
      value: 'text-ds-ok',
      label: 'text-ds-ok',
    },
    blue: {
      shell: 'bg-ds-info-bg',
      icon: 'bg-ds-surface text-ds-info',
      value: 'text-ds-info',
      label: 'text-ds-info',
    },
  }[tone];

  return (
    <div className={`flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 ${toneClass.shell}`}>
      <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-md shadow-sm ${toneClass.icon}`}>
        <Icon className="h-3 w-3" />
      </span>
      <div className="min-w-0">
        <p title={value} className={`truncate text-[10px] font-black leading-tight ${toneClass.value}`}>{value}</p>
        <p className={`text-[8px] font-black uppercase tracking-[.04em] ${toneClass.label}`}>{label}</p>
      </div>
    </div>
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
  const displayName = formatPersonName(user.username) || user.username;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group overflow-hidden rounded-xl border border-ds-accent-soft bg-ds-surface text-left shadow-sm transition hover:-translate-y-0.5 hover:border-ds-accent hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent"
    >
      <div className="flex items-start justify-between gap-2 p-2.5">
        <div className="flex min-w-0 items-start gap-2">
          <AvatarMark user={user} size={38} />
          <div className="min-w-0">
            <p className="truncate text-xs font-black leading-tight text-ds-ink">{displayName}</p>
            <p className="truncate text-[10px] font-bold text-ds-ink-muted">{user.jobRoleName || 'Sem cargo'}</p>
            <p className="truncate text-[9px] font-medium text-ds-ink-faint">
              {unitNames.length ? unitNames.join(', ') : 'Sem unidade'}
            </p>
          </div>
        </div>
        <StatusPill active={isActive} />
      </div>

      <div className="space-y-2 px-2.5 pb-2.5">
        <div className="grid grid-cols-3 gap-1.5">
          <CollaboratorInfoTile
            icon={Mail}
            label="E-mail"
            value={user.email || 'Sem e-mail'}
            tone="slate"
          />
          <CollaboratorInfoTile
            icon={MapPin}
            label={unitNames.length === 1 ? 'Unidade' : 'Unidades'}
            value={unitNames.length ? unitNames.join(', ') : 'Sem unidade'}
            tone="green"
          />
          <CollaboratorInfoTile
            icon={Calendar}
            label="Turno"
            value={shiftName || 'Sem turno'}
            tone="blue"
          />
        </div>

        <div className="flex items-center justify-between border-t border-ds-divider pt-1.5 text-[9px] font-bold">
          <span className="text-ds-ink-muted">desde {fmtDate(user.admissionDate)}</span>
          <span className="inline-flex items-center gap-1 text-ds-accent-ink group-hover:underline">
            Abrir perfil <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
          </span>
        </div>
      </div>
    </button>
  );
}

export default function DPCollaboratorsPage() {
  const { permissions, activeUsers, terminatedUsers, user: currentUser, isDefaultAdmin } = useAuth();
  const { shiftDefinitions, shiftDefsLoading, units } = useDPBootstrap();
  const router = useRouter();
  const ownProfileOnly = permissions.dp?.collaborators?.ownProfileOnly === true;

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'terminated'>('active');
  const [unitFilter, setUnitFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('cards');
  const [newUserOpen, setNewUserOpen] = useState(false);

  const allUsers = useMemo(() => {
    if (!currentUser) return [];
    return [...activeUsers, ...terminatedUsers].filter((candidate) =>
      candidate.id === currentUser.id || canAccessUserByUnit(currentUser, candidate, { isDefaultAdmin })
    );
  }, [activeUsers, currentUser, isDefaultAdmin, terminatedUsers]);
  const visibleActiveCount = useMemo(
    () => allUsers.filter((candidate) => candidate.isActive !== false).length,
    [allUsers],
  );

  const roleOptions = useMemo(() => {
    return Array.from(new Set(allUsers.map((user) => user.jobRoleName).filter(Boolean) as string[]))
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [allUsers]);

  const unitNameById = useMemo(() => new Map(units.map((unit) => [unit.id, unit.name])), [units]);
  const activeUnits = useMemo(
    () => currentUser
      ? filterUnitsByAccess(activeOperationalUnits(units), currentUser, { isDefaultAdmin })
      : [],
    [currentUser, isDefaultAdmin, units],
  );
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
        user.hrEmployeeId,
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
    <div className="space-y-3">
      <PageHero
        kicker="Departamento pessoal"
        title="Colaboradores"
        actions={permissions.settings.manageUsers ? (
          <Button type="button" variant="primary-page" size="md" onClick={() => setNewUserOpen(true)}>
            <UserPlus className="mr-2 h-[17px] w-[17px]" />
            Novo usuário
          </Button>
        ) : null}
        chips={<HeroChip value={visibleActiveCount} label="ativos" tone="info" />}
      />

      <div className="rounded-xl border border-ds-border bg-ds-surface p-2.5 shadow-[0_2px_8px_rgba(15,23,42,.05)]">
        <div className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[.08em] text-ds-ink-faint">
          <SlidersHorizontal className="h-[15px] w-[15px]" />
          Filtros e visualização
        </div>
        <div className="mt-2 grid gap-2 lg:grid-cols-[minmax(220px,1fr)_120px_150px_150px_auto] lg:items-center">
          <div className="relative min-w-60 flex-1">
            <Search className="absolute left-3.5 top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-ds-ink-faint" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nome, e-mail, cargo, matrícula…"
              className="h-8 rounded-md border-0 bg-ds-muted pl-9 text-xs font-medium placeholder:text-ds-ink-faint"
            />
          </div>
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}>
            <SelectTrigger className="h-8 w-full rounded-md border-ds-border bg-ds-surface text-[11px] font-bold text-ds-ink-2"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              <SelectItem value="active">Ativos</SelectItem>
              <SelectItem value="terminated">Desligados</SelectItem>
            </SelectContent>
          </Select>
          <Select value={unitFilter} onValueChange={setUnitFilter}>
            <SelectTrigger className="h-8 w-full rounded-md border-ds-border bg-ds-surface text-[11px] font-bold text-ds-ink-2"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as unidades</SelectItem>
              {activeUnits.map((unit) => <SelectItem key={unit.id} value={unit.id}>{unit.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="h-8 w-full rounded-md border-ds-border bg-ds-surface text-[11px] font-bold text-ds-ink-2"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as funções</SelectItem>
              {roleOptions.map((role) => <SelectItem key={role} value={role}>{role}</SelectItem>)}
            </SelectContent>
          </Select>
          <ToggleGroup
            type="single"
            value={viewMode}
            onValueChange={(value) => value && setViewMode(value as 'table' | 'cards')}
            className="h-8 justify-start gap-0.5 rounded-md bg-ds-muted p-0.5"
          >
            <ToggleGroupItem
              value="cards"
              aria-label="Cards"
              className="h-7 w-7 rounded-md text-ds-ink-faint data-[state=on]:bg-ds-surface data-[state=on]:text-ds-accent-ink data-[state=on]:shadow-sm"
            >
              <Grid2X2 className="h-[17px] w-[17px]" />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="table"
              aria-label="Tabela"
              className="h-7 w-7 rounded-md text-ds-ink-faint data-[state=on]:bg-ds-surface data-[state=on]:text-ds-accent-ink data-[state=on]:shadow-sm"
            >
              <List className="h-[17px] w-[17px]" />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {shiftDefsLoading && shiftDefinitions.length === 0 ? (
        viewMode === 'cards' ? (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            {[...Array(8)].map((_, index) => <Skeleton key={index} className="h-28 w-full" />)}
          </div>
        ) : (
          <div className="rounded-md border bg-card p-3">
            {[...Array(6)].map((_, index) => <Skeleton key={index} className="mb-2 h-10 w-full last:mb-0" />)}
          </div>
        )
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border bg-ds-surface py-10 text-center text-sm text-muted-foreground shadow-sm">
          <Briefcase className="mx-auto mb-2 h-8 w-8" />
          Nenhum colaborador encontrado.
        </div>
      ) : viewMode === 'cards' ? (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
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
        <div className="overflow-hidden rounded-[20px] border border-ds-border bg-ds-surface shadow-[0_2px_10px_rgba(15,23,42,.06)]">
          <div className="overflow-x-auto">
            <div className="min-w-[980px]">
              <div
                className="grid items-center gap-3.5 border-b border-ds-divider bg-ds-surface px-5 py-3 text-[10.5px] font-extrabold uppercase tracking-[.07em] text-ds-ink-faint"
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
                    className="grid cursor-pointer items-center gap-3.5 border-t border-ds-divider px-5 py-3 transition hover:bg-ds-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ds-accent"
                    style={{ gridTemplateColumns: COLLABORATOR_GRID }}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <AvatarMark user={user} size={36} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-extrabold text-ds-ink">{formatPersonName(user.username) || user.username}</p>
                        <p className="truncate text-xs font-medium text-ds-ink-faint">{user.email || '—'}</p>
                      </div>
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px] font-semibold text-ds-ink-2">{user.jobRoleName || '—'}</p>
                      {user.jobFunctionNames?.length ? (
                        <p className="truncate text-xs font-medium text-ds-ink-faint">{user.jobFunctionNames.join(', ')}</p>
                      ) : null}
                    </div>
                    <p className="truncate text-[13px] font-medium text-ds-ink-muted">{unitNames.length ? unitNames.join(', ') : '—'}</p>
                    <p className="truncate text-[13px] font-medium text-ds-ink-muted">{shiftName || '—'}</p>
                    <p className="truncate text-[13px] font-medium text-ds-ink-muted">{fmtDate(user.admissionDate)}</p>
                    <div><StatusPill active={user.isActive !== false} /></div>
                    <div className="text-right">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          router.push(`/dashboard/dp/collaborators/${user.id}`);
                        }}
                        className="inline-flex h-8 items-center rounded-[9px] border border-ds-border bg-ds-surface px-3 text-[12.5px] font-extrabold text-ds-ink-muted hover:bg-ds-muted"
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
        <DialogContent className="max-h-[84vh] w-[calc(100vw-1rem)] overflow-y-auto rounded-lg p-0 sm:max-w-[min(720px,calc(100vw-1rem))]">
          <DialogHeader className="space-y-0 border-b border-ds-divider px-3.5 pb-2.5 pt-3 text-left">
            <p className="flex items-center gap-1.5 text-[9px] font-extrabold uppercase tracking-[.1em] text-ds-accent-ink">
              Gestão do colaborador
              <span className="text-ds-accent-ink">›</span>
              <span className="text-ds-accent-ink">Novo usuário</span>
            </p>
            <DialogTitle className="mt-1 text-base font-black tracking-[-.02em] text-ds-ink">Novo usuário</DialogTitle>
            <DialogDescription className="mt-1 max-w-[640px] text-[11px] font-medium leading-[1.4] text-ds-ink-muted">
              Cadastre o acesso e o vínculo inicial do colaborador. Vale-transporte é tratado no perfil do colaborador.
            </DialogDescription>
          </DialogHeader>
          <div className="px-3.5 py-2.5">
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
