"use client";

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Briefcase, Calendar, Grid2X2, List, Mail, MapPin, Search, Users, UserX } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { useDPBootstrap } from '@/hooks/use-dp-bootstrap';
import type { User } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

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
    <Avatar className="h-9 w-9 shrink-0 rounded-md">
      <AvatarImage src={user.avatarUrl || undefined} alt={user.username} className="rounded-md object-cover" />
      <AvatarFallback
        className="rounded-md bg-violet-100 text-xs font-bold text-violet-700"
        style={user.color ? { backgroundColor: user.color, color: '#fff' } : undefined}
      >
        {initials(user.username)}
      </AvatarFallback>
    </Avatar>
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
      className="overflow-hidden rounded-md border bg-card text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between bg-violet-50 px-4 py-3">
        <Badge variant="outline" className="bg-white text-[10px] text-violet-700">
          Colaborador
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
          <span className="font-medium text-violet-700">Abrir</span>
        </div>
      </div>
    </button>
  );
}

export default function DPCollaboratorsPage() {
  const { permissions, activeUsers, terminatedUsers } = useAuth();
  const { shiftDefinitions, shiftDefsLoading, units } = useDPBootstrap();
  const router = useRouter();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'terminated'>('active');
  const [unitFilter, setUnitFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');

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

  if (!permissions.dp?.collaborators?.view) {
    return <p className="p-6 text-sm text-muted-foreground">Sem permissão para acessar colaboradores.</p>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Pessoal / colaboradores</p>
          <h1 className="text-2xl font-bold tracking-tight">Colaboradores</h1>
          <p className="text-sm text-muted-foreground">Perfis da equipe, vínculos, escalas e histórico operacional.</p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Cadastros</p><p className="mt-1 text-xl font-bold">{allUsers.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Ativos</p><p className="mt-1 text-xl font-bold text-emerald-600">{activeUsers.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Desligados</p><p className="mt-1 text-xl font-bold text-slate-600">{terminatedUsers.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Funções</p><p className="mt-1 text-xl font-bold">{roleOptions.length}</p></CardContent></Card>
      </div>

      <div className="space-y-3 rounded-md border bg-card p-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative min-w-64 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nome, e-mail, cargo, matrícula..."
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}>
            <SelectTrigger className="w-full lg:w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              <SelectItem value="active">Ativos</SelectItem>
              <SelectItem value="terminated">Desligados</SelectItem>
            </SelectContent>
          </Select>
          <Select value={unitFilter} onValueChange={setUnitFilter}>
            <SelectTrigger className="w-full lg:w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as unidades</SelectItem>
              {units.map((unit) => <SelectItem key={unit.id} value={unit.id}>{unit.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-full lg:w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as funções</SelectItem>
              {roleOptions.map((role) => <SelectItem key={role} value={role}>{role}</SelectItem>)}
            </SelectContent>
          </Select>
          <ToggleGroup
            type="single"
            value={viewMode}
            onValueChange={(value) => value && setViewMode(value as 'table' | 'cards')}
            className="justify-start rounded-md border p-1"
          >
            <ToggleGroupItem value="cards" aria-label="Cards"><Grid2X2 className="h-4 w-4" /></ToggleGroupItem>
            <ToggleGroupItem value="table" aria-label="Tabela"><List className="h-4 w-4" /></ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={statusFilter === 'all' ? 'default' : 'outline'} className="h-7 rounded-full" onClick={() => setStatusFilter('all')}>Todos {allUsers.length}</Button>
          <Button size="sm" variant={statusFilter === 'active' ? 'default' : 'outline'} className="h-7 rounded-full" onClick={() => setStatusFilter('active')}>Ativos {activeUsers.length}</Button>
          <Button size="sm" variant={statusFilter === 'terminated' ? 'default' : 'outline'} className="h-7 rounded-full" onClick={() => setStatusFilter('terminated')}>Desligados {terminatedUsers.length}</Button>
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
        <div className="rounded-md border bg-card py-16 text-center text-muted-foreground">
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
        <div className="rounded-md border bg-card">
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
    </div>
  );
}
