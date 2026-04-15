"use client";

import { useMemo } from 'react';
import { format, isToday, isWithinInterval, startOfDay, endOfDay, addDays, parseISO, getMonth, startOfWeek, endOfWeek } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { useAuth } from '@/hooks/use-auth';
import { useDPBootstrap } from '@/hooks/use-dp-bootstrap';
import { useDPShifts } from '@/hooks/use-dp-shifts';
import type { User, DPVacationRecord } from '@/types';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Plane, CalendarCheck2, Briefcase, Cake, PartyPopper, Clock,
  MapPin, Palmtree, DollarSign,
} from 'lucide-react';
import { useState } from 'react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase();
}

function fmtDate(d?: string) {
  if (!d) return '—';
  try { return format(parseISO(d), 'dd/MM/yy'); } catch { return d; }
}

// ─── Vacation Stats Cards ─────────────────────────────────────────────────────

function VacationStatCard({ title, value, icon, bg, color }: {
  title: string; value: number; icon: React.ReactNode; bg: string; color: string;
}) {
  return (
    <Card>
      <CardContent className="p-5 flex items-center gap-4">
        <div className={`h-11 w-11 rounded-full flex items-center justify-center shrink-0 ${bg}`}>
          <div className={color}>{icon}</div>
        </div>
        <div>
          <div className="text-3xl font-bold">{value}</div>
          <p className="text-sm text-muted-foreground">{title}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Upcoming Vacations ───────────────────────────────────────────────────────

function UpcomingVacationsCard({ vacations, userMap }: {
  vacations: DPVacationRecord[];
  userMap: Record<string, User>;
}) {
  const upcoming = useMemo(() => {
    const today = startOfDay(new Date());
    return vacations
      .filter(v => v.recordType === 'gozo' && v.startDate && parseISO(v.startDate) > today)
      .sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''))
      .slice(0, 5);
  }, [vacations]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Próximas Férias Agendadas</CardTitle>
        <CardDescription>Os próximos 5 colaboradores a sair de férias.</CardDescription>
      </CardHeader>
      <CardContent>
        {upcoming.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-muted-foreground gap-2">
            <Plane className="h-10 w-10" />
            <p className="text-sm">Nenhuma férias agendada.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Colaborador</TableHead>
                <TableHead>Período</TableHead>
                <TableHead>Pagamento</TableHead>
                <TableHead>Retorno</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {upcoming.map(v => {
                const user = userMap[v.userId];
                return (
                  <TableRow key={v.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={user?.avatarUrl} />
                          <AvatarFallback className="text-xs">{initials(user?.username ?? '?')}</AvatarFallback>
                        </Avatar>
                        <span className="font-medium text-sm">{user?.username ?? 'N/A'}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {fmtDate(v.startDate)} – {fmtDate(v.endDate)}
                    </TableCell>
                    <TableCell>
                      {v.paymentDate && (
                        <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300">
                          <DollarSign className="mr-1 h-3 w-3" />
                          {fmtDate(v.paymentDate)}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {v.returnDate && (
                        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300">
                          <Briefcase className="mr-1 h-3 w-3" />
                          {fmtDate(v.returnDate)}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Shift Schedule (semana) ──────────────────────────────────────────────────

interface EnrichedShift {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  unitId: string;
  userId: string;
  shiftDefinitionId?: string;
  userName: string;
  avatarUrl?: string;
  unitName: string;
  shiftName: string;
}

function ShiftScheduleCard({ shifts, units }: { shifts: EnrichedShift[]; units: { id: string; name: string }[] }) {
  const [selectedUnit, setSelectedUnit] = useState('all');

  const shiftsByDay = useMemo(() => {
    const filtered = selectedUnit === 'all' ? shifts : shifts.filter(s => s.unitId === selectedUnit);
    const grouped: Record<string, EnrichedShift[]> = {};
    for (const s of filtered) {
      if (!grouped[s.date]) grouped[s.date] = [];
      grouped[s.date].push(s);
    }
    for (const d in grouped) grouped[d].sort((a, b) => a.startTime.localeCompare(b.startTime));
    return Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b));
  }, [shifts, selectedUnit]);

  return (
    <Card className="flex flex-col" style={{ height: 600 }}>
      <CardHeader className="flex-none flex flex-row items-center justify-between border-b pb-4">
        <CardTitle>Escala da Semana</CardTitle>
        <Select value={selectedUnit} onValueChange={setSelectedUnit}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Filtrar unidade" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as unidades</SelectItem>
            {units.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto pt-4">
        {shiftsByDay.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            Nenhum turno agendado para esta semana.
          </div>
        ) : (
          <div className="space-y-6">
            {shiftsByDay.map(([date, dayShifts]) => {
              const parsed = parseISO(date);
              const today = isToday(parsed);
              return (
                <div key={date}>
                  <div className={`mb-3 rounded-lg -mx-1 px-2 py-1 ${today ? 'bg-muted/60' : ''}`}>
                    <h3 className={`font-bold text-base capitalize ${today ? 'text-primary' : ''}`}>
                      {format(parsed, 'eeee', { locale: ptBR })}
                    </h3>
                    <p className="text-xs text-muted-foreground">{format(parsed, "d 'de' MMMM", { locale: ptBR })}</p>
                  </div>
                  <div className="space-y-3">
                    {dayShifts.map(shift => (
                      <div key={shift.id} className="flex items-center justify-between p-3 rounded-xl bg-muted/30">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-9 w-9">
                            <AvatarImage src={shift.avatarUrl} />
                            <AvatarFallback className="text-xs">{initials(shift.userName)}</AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium text-sm">{shift.userName}</p>
                            <p className="text-xs text-muted-foreground">{shift.startTime} – {shift.endTime}</p>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <Badge variant="outline" className="text-xs">{shift.shiftName}</Badge>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <MapPin className="h-3 w-3" />
                            {shift.unitName}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Birthday Card ────────────────────────────────────────────────────────────

function BirthdayCard({ users }: { users: User[] }) {
  const birthdays = useMemo(() => {
    const m = getMonth(new Date());
    return users
      .filter(u => u.birthDate && typeof (u.birthDate as any).toDate === 'function' && getMonth((u.birthDate as any).toDate()) === m)
      .sort((a, b) => {
        const da = (a.birthDate as any).toDate().getDate();
        const db = (b.birthDate as any).toDate().getDate();
        return da - db;
      });
  }, [users]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <PartyPopper className="h-4 w-4 text-primary" />
          Aniversariantes do Mês
        </CardTitle>
        <CardDescription>Parabenize seus colegas!</CardDescription>
      </CardHeader>
      <CardContent>
        {birthdays.length === 0 ? (
          <div className="flex flex-col items-center py-6 text-muted-foreground gap-2">
            <Cake className="h-8 w-8" />
            <p className="text-sm">Nenhum aniversário este mês.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {birthdays.map(u => {
              const date = (u.birthDate as any).toDate() as Date;
              const today = isToday(date);
              return (
                <div key={u.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Avatar className={`h-8 w-8 ${today ? 'ring-2 ring-primary ring-offset-1' : ''}`}>
                      <AvatarImage src={u.avatarUrl} />
                      <AvatarFallback className="text-xs">{initials(u.username)}</AvatarFallback>
                    </Avatar>
                    <p className="text-sm font-medium truncate max-w-[120px]">{u.username}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Cake className="h-3.5 w-3.5 text-pink-400" />
                    <Badge variant={today ? 'default' : 'secondary'} className="text-xs">
                      {today ? 'Hoje!' : format(date, 'dd/MMM', { locale: ptBR })}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Active Vacations ─────────────────────────────────────────────────────────

function ActiveVacationsCard({ vacations, userMap }: {
  vacations: DPVacationRecord[];
  userMap: Record<string, User>;
}) {
  const active = useMemo(() => {
    const today = new Date();
    return vacations.filter(v =>
      v.recordType === 'gozo' && v.startDate && v.endDate &&
      isWithinInterval(today, { start: startOfDay(parseISO(v.startDate)), end: endOfDay(parseISO(v.endDate)) })
    );
  }, [vacations]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <div className="bg-blue-100 dark:bg-blue-900/30 p-1.5 rounded-lg">
            <Plane className="h-4 w-4 text-blue-600 dark:text-blue-300" />
          </div>
          Em Férias Hoje
        </CardTitle>
      </CardHeader>
      <CardContent>
        {active.length === 0 ? (
          <div className="flex flex-col items-center py-5 text-muted-foreground gap-2">
            <Palmtree className="h-7 w-7 opacity-50" />
            <p className="text-sm">Todo o time presente.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {active.map(v => {
              const user = userMap[v.userId];
              return (
                <div key={v.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={user?.avatarUrl} />
                      <AvatarFallback className="text-xs">{initials(user?.username ?? '?')}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium">{user?.username ?? 'N/A'}</p>
                      <p className="text-xs text-muted-foreground">
                        Volta em {v.returnDate ? format(parseISO(v.returnDate), "dd 'de' MMM", { locale: ptBR }) : '—'}
                      </p>
                    </div>
                  </div>
                  <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-0 text-xs dark:bg-blue-900/30 dark:text-blue-300">
                    🏖️ Off
                  </Badge>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Today's Shifts ───────────────────────────────────────────────────────────

function TodayShiftsCard({ todayShifts }: {
  todayShifts: { unitName: string; shifts: EnrichedShift[] }[];
}) {
  const now = new Date();

  function isActive(start: string, end: string) {
    const s = new Date(); const e = new Date();
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    s.setHours(sh, sm, 0, 0); e.setHours(eh, em, 0, 0);
    return now >= s && now <= e;
  }

  function isFinished(end: string) {
    const e = new Date();
    const [eh, em] = end.split(':').map(Number);
    e.setHours(eh, em, 0, 0);
    return now > e;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          Turnos do Dia
        </CardTitle>
        <CardDescription>Resumo dos turnos de hoje em todas as unidades.</CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-64">
          {todayShifts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Nenhum turno agendado para hoje.</p>
          ) : (
            <div className="space-y-5 pr-2">
              {todayShifts.map(group => (
                <div key={group.unitName} className="relative">
                  <div className="absolute left-4 top-7 bottom-2 w-px bg-border -z-10" />
                  <h3 className="font-semibold text-xs text-primary mb-3 flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-background border flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-primary ring-4 ring-primary/20" />
                    </div>
                    {group.unitName}
                  </h3>
                  <div className="space-y-2.5 pl-4">
                    {group.shifts.map(shift => {
                      const active = isActive(shift.startTime, shift.endTime);
                      const finished = isFinished(shift.endTime);
                      return (
                        <div key={shift.id} className={`flex items-center justify-between transition-opacity ${finished ? 'opacity-40' : ''}`}>
                          <div className="flex items-center gap-2">
                            <Avatar className="h-8 w-8">
                              <AvatarImage src={shift.avatarUrl} />
                              <AvatarFallback className="text-xs">{initials(shift.userName)}</AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="text-sm font-medium leading-tight">{shift.userName}</p>
                              <p className="text-xs text-muted-foreground">{shift.shiftName}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {active && <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />}
                            <Badge variant={active ? 'default' : 'secondary'} className="text-xs">
                              {shift.startTime}–{shift.endTime}
                            </Badge>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DPDashboardPage() {
  const { permissions, users } = useAuth();
  const { vacations, schedules, units, shiftDefinitions, loading, error } = useDPBootstrap();

  // Encontra a escala do mês atual (ou o mais recente)
  const now = new Date();
  const currentSchedule = useMemo(() => {
    return (
      schedules.find(s => s.month === now.getMonth() + 1 && s.year === now.getFullYear()) ??
      schedules[0] ??
      null
    );
  }, [schedules]);

  const { shifts } = useDPShifts(currentSchedule?.id ?? null);

  // Mapas de lookup
  const userMap = useMemo(() =>
    Object.fromEntries(users.map(u => [u.id, u])),
    [users]
  );
  const unitMap = useMemo(() =>
    Object.fromEntries(units.map(u => [u.id, u])),
    [units]
  );
  const shiftDefMap = useMemo(() =>
    Object.fromEntries(shiftDefinitions.map(d => [d.id, d])),
    [shiftDefinitions]
  );

  // Enriquece shifts com nomes
  const enrichedShifts: EnrichedShift[] = useMemo(() =>
    shifts.map(s => ({
      ...s,
      userName: userMap[s.userId]?.username ?? '?',
      avatarUrl: userMap[s.userId]?.avatarUrl,
      unitName: unitMap[s.unitId]?.name ?? '?',
      shiftName: s.shiftDefinitionId ? (shiftDefMap[s.shiftDefinitionId]?.name ?? s.startTime) : s.startTime,
    })),
    [shifts, userMap, unitMap, shiftDefMap]
  );

  // Semana atual
  const weekStart = format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd');
  const weekEnd   = format(endOfWeek(now,   { weekStartsOn: 1 }), 'yyyy-MM-dd');

  const weeklyShifts = useMemo(() =>
    enrichedShifts.filter(s => s.date >= weekStart && s.date <= weekEnd),
    [enrichedShifts, weekStart, weekEnd]
  );

  // Turnos de hoje agrupados por unidade
  const todayShifts = useMemo(() => {
    const todayStr = format(now, 'yyyy-MM-dd');
    const byUnit: Record<string, EnrichedShift[]> = {};
    for (const s of enrichedShifts.filter(s => s.date === todayStr)) {
      if (!byUnit[s.unitName]) byUnit[s.unitName] = [];
      byUnit[s.unitName].push(s);
    }
    return Object.entries(byUnit)
      .map(([unitName, shifts]) => ({ unitName, shifts: shifts.sort((a, b) => a.startTime.localeCompare(b.startTime)) }))
      .sort((a, b) => a.unitName.localeCompare(b.unitName));
  }, [enrichedShifts]);

  // Stats férias
  const vacationStats = useMemo(() => {
    const today = startOfDay(now);
    const onVacation = vacations.filter(v =>
      v.recordType === 'gozo' && v.startDate && v.endDate &&
      isWithinInterval(today, { start: startOfDay(parseISO(v.startDate)), end: endOfDay(parseISO(v.endDate)) })
    ).length;

    const paymentsSoon = vacations.filter(v =>
      v.recordType === 'gozo' && v.paymentDate &&
      isWithinInterval(parseISO(v.paymentDate), { start: today, end: addDays(today, 15) })
    ).length;

    const returningSoon = vacations.filter(v =>
      v.recordType === 'gozo' && v.returnDate &&
      isWithinInterval(parseISO(v.returnDate), { start: today, end: addDays(today, 7) })
    ).length;

    return { onVacation, paymentsSoon, returningSoon };
  }, [vacations]);

  if (!permissions.dp?.view) {
    return <p className="text-muted-foreground p-6">Sem permissão para acessar o Departamento Pessoal.</p>;
  }

  if (loading) {
    return <p className="text-muted-foreground p-6 text-sm">Carregando...</p>;
  }

  if (error) {
    return <p className="text-destructive p-6 text-sm">Erro ao carregar dashboard do DP: {error}</p>;
  }

  return (
    <div className="space-y-8">
      <div className="grid gap-8 grid-cols-1 lg:grid-cols-3 xl:grid-cols-4">

        {/* ── Coluna principal ── */}
        <div className="lg:col-span-2 xl:col-span-3 space-y-8">

          {/* Resumo de Férias */}
          <div className="space-y-4">
            <h2 className="text-lg font-bold">Resumo de Férias</h2>
            <div className="grid sm:grid-cols-3 gap-4">
              <VacationStatCard
                title="Em Férias Hoje"
                value={vacationStats.onVacation}
                icon={<Plane className="h-5 w-5" />}
                bg="bg-blue-100 dark:bg-blue-900/30"
                color="text-blue-500"
              />
              <VacationStatCard
                title="Pagamentos em 15 dias"
                value={vacationStats.paymentsSoon}
                icon={<CalendarCheck2 className="h-5 w-5" />}
                bg="bg-amber-100 dark:bg-amber-900/30"
                color="text-amber-500"
              />
              <VacationStatCard
                title="Retornos em 7 dias"
                value={vacationStats.returningSoon}
                icon={<Briefcase className="h-5 w-5" />}
                bg="bg-teal-100 dark:bg-teal-900/30"
                color="text-teal-500"
              />
            </div>
            <UpcomingVacationsCard vacations={vacations} userMap={userMap} />
          </div>

          {/* Escala da Semana */}
          <ShiftScheduleCard shifts={weeklyShifts} units={units} />
        </div>

        {/* ── Coluna lateral ── */}
        <div className="flex flex-col gap-6">
          <BirthdayCard users={users} />
          <ActiveVacationsCard vacations={vacations} userMap={userMap} />
          <TodayShiftsCard todayShifts={todayShifts} />
        </div>

      </div>
    </div>
  );
}
