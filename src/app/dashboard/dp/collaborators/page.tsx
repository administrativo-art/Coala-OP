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
  UserX,
} from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { useDPBootstrap } from '@/hooks/use-dp-bootstrap';
import type { User } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { UserManagement } from '@/components/user-management';

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

function AvatarMark({ user }: { user: User }) {
  return (
    <Avatar className="h-10 w-10 shrink-0 rounded-lg">
      <AvatarImage src={user.avatarUrl || undefined} alt={user.username} className="rounded-lg object-cover" />
      <AvatarFallback
        className="rounded-lg bg-slate-100 text-xs font-bold text-slate-700"
        style={user.color ? { backgroundColor: user.color, color: '#fff' } : undefined}
      >
        {initials(user.username)}
      </AvatarFallback>
    </Avatar>
  );
}

function HeaderMetric({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <span className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-600">
      <strong className="text-base text-slate-950">{value}</strong>
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
      className="group overflow-hidden rounded-xl border bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between border-b bg-slate-50/70 px-4 py-3">
        <Badge variant="outline" className="bg-white text-[10px] text-slate-600">
          {user.registrationIdBizneo || user.registrationIdPdv || 'Cadastro'}
        </Badge>
        {isActive ? (
          <Badge className="bg-emerald-600 text-[10px] text-white hover:bg-emerald-600">Ativo</Badge>
        ) : (
          <Badge variant="secondary" className="text-[10px]">Desligado</Badge>
        )}
      </div>
      <div className="space-y-4 p-4">
        <div className="flex items-start gap-3">
          <AvatarMark user={user} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{user.username}</p>
            <p className="truncate text-xs text-muted-foreground">{user.jobRoleName || '-'}</p>
          </div>
        </div>
        <div className="space-y-1.5 text-xs text-muted-foreground">
          {user.email ? <p className="flex items-center gap-1.5"><Mail className="h-3 w-3" />{user.email}</p> : null}
          <p className="flex items-center gap-1.5"><MapPin className="h-3 w-3" />{unitNames.length ? unitNames.join(', ') : 'Sem unidade'}</p>
          <p className="flex items-center gap-1.5"><Calendar className="h-3 w-3" />{shiftName || 'Sem turno padrão'}</p>
        </div>
        <div className="flex items-center justify-between border-t pt-3 text-xs">
          <span className="text-muted-foreground">desde {fmtDate(user.admissionDate)}</span>
          <span className="inline-flex items-center gap-1 font-medium text-[#c81f69]">
            Abrir <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
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
      <section className="rounded-2xl border bg-white px-5 py-4 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-[#df2f78]/10 text-[#c81f69]">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground">Departamento pessoal</p>
              <h1 className="text-2xl font-bold tracking-tight">Colaboradores</h1>
              <p className="text-sm text-muted-foreground">Perfis, vínculos, escalas e histórico operacional da equipe.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <HeaderMetric label="ativos" value={activeUsers.length} />
            <HeaderMetric label="desligados" value={terminatedUsers.length} />
            {permissions.settings.manageUsers ? (
              <Button
                type="button"
                onClick={() => setNewUserOpen(true)}
                className="h-10 rounded-xl bg-[#df2f78] px-4 text-sm font-black text-white hover:bg-[#c92368]"
              >
                <UserPlus className="mr-2 h-4 w-4" />
                Novo usuário
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      <div className="space-y-4 rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
          <SlidersHorizontal className="h-4 w-4" />
          Filtros e visualização
        </div>
        <div className="grid gap-2 lg:grid-cols-[minmax(260px,1fr)_170px_220px_220px_auto] lg:items-center">
          <div className="relative min-w-64 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nome, e-mail, cargo, matrícula..."
              className="h-10 rounded-xl border-slate-200 bg-slate-50 pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}>
            <SelectTrigger className="h-10 w-full rounded-xl border-slate-200 bg-slate-50"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              <SelectItem value="active">Ativos</SelectItem>
              <SelectItem value="terminated">Desligados</SelectItem>
            </SelectContent>
          </Select>
          <Select value={unitFilter} onValueChange={setUnitFilter}>
            <SelectTrigger className="h-10 w-full rounded-xl border-slate-200 bg-slate-50"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as unidades</SelectItem>
              {units.map((unit) => <SelectItem key={unit.id} value={unit.id}>{unit.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="h-10 w-full rounded-xl border-slate-200 bg-slate-50"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as funções</SelectItem>
              {roleOptions.map((role) => <SelectItem key={role} value={role}>{role}</SelectItem>)}
            </SelectContent>
          </Select>
          <ToggleGroup
            type="single"
            value={viewMode}
            onValueChange={(value) => value && setViewMode(value as 'table' | 'cards')}
            className="h-10 justify-start rounded-xl border bg-slate-50 p-1"
          >
            <ToggleGroupItem value="cards" aria-label="Cards"><Grid2X2 className="h-4 w-4" /></ToggleGroupItem>
            <ToggleGroupItem value="table" aria-label="Tabela"><List className="h-4 w-4" /></ToggleGroupItem>
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
        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Colaborador</TableHead>
                <TableHead>Cargo/função</TableHead>
                <TableHead>Unidades</TableHead>
                <TableHead>Turno padrão</TableHead>
                <TableHead>Admissão</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((user) => {
                  const unitNames = (user.unitIds ?? []).map((id) => unitNameById.get(id) ?? id);
                  const shiftName = user.shiftDefinitionId ? shiftNameById.get(user.shiftDefinitionId) : null;
                  return (
                    <TableRow
                      key={user.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/dashboard/dp/collaborators/${user.id}`)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <AvatarMark user={user} />
                          <div>
                            <p className="font-semibold">{user.username}</p>
                            <p className="text-xs text-muted-foreground">{user.email || '-'}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <p className="font-medium">{user.jobRoleName || '-'}</p>
                        <p className="text-xs text-muted-foreground">{user.jobFunctionNames?.join(', ') || '-'}</p>
                      </TableCell>
                      <TableCell>{unitNames.length ? unitNames.join(', ') : '-'}</TableCell>
                      <TableCell>
                        {shiftName ? (
                          <span className="inline-flex items-center gap-1 text-sm"><Calendar className="h-3.5 w-3.5 text-muted-foreground" />{shiftName}</span>
                        ) : '-'}
                      </TableCell>
                      <TableCell>{fmtDate(user.admissionDate)}</TableCell>
                      <TableCell>
                        {user.isActive === false ? (
                          <Badge variant="secondary"><UserX className="mr-1 h-3 w-3" />Desligado</Badge>
                        ) : (
                          <Badge className="bg-emerald-600 text-white hover:bg-emerald-600"><Users className="mr-1 h-3 w-3" />Ativo</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(event) => {
                            event.stopPropagation();
                            router.push(`/dashboard/dp/collaborators/${user.id}`);
                          }}
                        >
                          Abrir
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </div>
      )}
      <Dialog open={newUserOpen} onOpenChange={setNewUserOpen}>
        <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl p-0 sm:max-w-[min(1180px,calc(100vw-2rem))]">
          <DialogHeader className="border-b px-6 py-5">
            <DialogTitle>Novo usuário</DialogTitle>
            <DialogDescription>
              Cadastre o acesso e o vínculo inicial do colaborador. Vale-transporte é tratado no perfil do colaborador.
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 py-5">
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
