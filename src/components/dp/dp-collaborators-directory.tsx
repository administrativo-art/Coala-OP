"use client";

import React, { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { useAuth } from '@/hooks/use-auth';
import { useDP } from '@/components/dp-context';
import type { DPShiftDefinition, User } from '@/types';

import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Search } from 'lucide-react';

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(n => n[0])
    .join('')
    .toUpperCase();
}

function CollaboratorCard({ user, shiftDefinitions }: { user: User; shiftDefinitions: DPShiftDefinition[] }) {
  const shiftDef = shiftDefinitions.find(d => d.id === user.shiftDefinitionId);

  function fmtDate(ts: any) {
    try { return format(ts.toDate(), 'dd/MM/yyyy', { locale: ptBR }); } catch { return '—'; }
  }

  return (
    <div className="flex items-start gap-4 py-4 px-1">
      <Avatar className="h-10 w-10 shrink-0">
        <AvatarFallback className="text-sm">{initials(user.username)}</AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium">{user.username}</p>
          {user.registrationIdBizneo && (
            <Badge variant="outline" className="text-xs font-normal">
              Bizneo: {user.registrationIdBizneo}
            </Badge>
          )}
          {user.registrationIdPdv && (
            <Badge variant="outline" className="text-xs font-normal">
              PDV: {user.registrationIdPdv}
            </Badge>
          )}
          {user.isActive === false && (
            <Badge variant="destructive" className="text-xs">Desligado</Badge>
          )}
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
          {user.admissionDate && (
            <span>Admissão: {fmtDate(user.admissionDate)}</span>
          )}
          {user.birthDate && (
            <span>Nascimento: {fmtDate(user.birthDate)}</span>
          )}
          {shiftDef && (
            <span>Turno: {shiftDef.name} ({shiftDef.startTime}–{shiftDef.endTime})</span>
          )}
          {user.isActive === false && user.terminationDate && (
            <span>Desligamento: {fmtDate(user.terminationDate)}</span>
          )}
          {user.isActive === false && user.terminationReason && (
            <span>{user.terminationReason}</span>
          )}
        </div>

      </div>
    </div>
  );
}

function CollaboratorList({ users, emptyMessage, shiftDefinitions }: { users: User[]; emptyMessage: string; shiftDefinitions: DPShiftDefinition[] }) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return users.filter(u =>
      u.username.toLowerCase().includes(q) ||
      (u.registrationIdBizneo ?? '').includes(q) ||
      (u.registrationIdPdv ?? '').includes(q)
    );
  }, [users, search]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou matrícula..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Badge variant="outline">{filtered.length}</Badge>
      </div>

      <ScrollArea className="h-[calc(100vh-280px)]">
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            {search ? 'Nenhum resultado encontrado.' : emptyMessage}
          </p>
        ) : (
          <div className="divide-y">
            {filtered.map(u => <CollaboratorCard key={u.id} user={u} shiftDefinitions={shiftDefinitions} />)}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

export function DPCollaboratorsDirectory() {
  const { activeUsers, terminatedUsers } = useAuth();
  const { shiftDefinitions, shiftDefsLoading, shiftDefsError } = useDP();

  if (shiftDefsLoading && shiftDefinitions.length === 0) return <p className="text-sm text-muted-foreground">Carregando...</p>;
  if (shiftDefsError && shiftDefinitions.length === 0) return <p className="text-sm text-destructive">Erro ao carregar turnos: {shiftDefsError}</p>;

  return (
    <Tabs defaultValue="active">
      <TabsList>
        <TabsTrigger value="active">
          Ativos
          <Badge variant="secondary" className="ml-2 text-xs">{activeUsers.length}</Badge>
        </TabsTrigger>
        <TabsTrigger value="terminated">
          Desligados
          <Badge variant="secondary" className="ml-2 text-xs">{terminatedUsers.length}</Badge>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="active" className="mt-4">
        <CollaboratorList users={activeUsers} emptyMessage="Nenhum colaborador ativo." shiftDefinitions={shiftDefinitions} />
      </TabsContent>

      <TabsContent value="terminated" className="mt-4">
        <CollaboratorList users={terminatedUsers} emptyMessage="Nenhum colaborador desligado." shiftDefinitions={shiftDefinitions} />
      </TabsContent>
    </Tabs>
  );
}
