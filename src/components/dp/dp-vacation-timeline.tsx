"use client";

import React, { useMemo, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  addMonths, eachDayOfInterval, endOfMonth, startOfMonth,
  format, isWeekend, isToday, parseISO,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { User, DPVacationRecord } from '@/types';

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase();
}

function cn(...classes: (string | false | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

interface Props {
  users: User[];
  vacations: DPVacationRecord[];
}

export function DPVacationTimeline({ users, vacations }: Props) {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);

  const { monthsData, allDays, today } = useMemo(() => {
    const today = new Date();
    const year = today.getFullYear();
    const start = startOfMonth(new Date(year, 0, 1));   // 1 Jan
    const end = endOfMonth(new Date(year, 11, 31));     // 31 Dez

    const months: Date[] = [];
    let cur = start;
    while (cur <= end) { months.push(cur); cur = addMonths(cur, 1); }

    return { monthsData: months, allDays: eachDayOfInterval({ start, end }), today };
  }, []);

  // Auto-scroll to today
  useEffect(() => {
    if (!scrollRef.current) return;
    const el = scrollRef.current.querySelector(`[data-date="${format(today, 'yyyy-MM-dd')}"]`);
    if (el) {
      const container = scrollRef.current;
      const left = (el as HTMLElement).offsetLeft;
      container.scrollLeft = left - container.offsetWidth / 2 + (el as HTMLElement).offsetWidth / 2;
    }
  }, [today, users]);

  // Only show approved gozo vacations
  const approvedVacations = vacations.filter(v => v.recordType === 'gozo' && v.status === 'APPROVED');

  function dayClass(date: Date) {
    if (isToday(date)) return 'bg-blue-50 dark:bg-blue-900/20';
    if (isWeekend(date)) return 'bg-muted/30';
    return '';
  }

  return (
    <Card className="w-full shadow-sm">
      <CardHeader className="pb-4">
        <CardTitle>Timeline de Férias</CardTitle>
        <CardDescription>Visão do ano inteiro. Role para a direita para navegar.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div ref={scrollRef} className="w-full overflow-x-auto">
          <table className="w-max border-collapse text-sm">
            <thead className="bg-background">
              <tr>
                <th className="sticky left-0 z-40 bg-background min-w-[200px] p-4 text-left font-semibold border-b border-r border-border shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                  Colaborador
                </th>
                {monthsData.map(month => (
                  <th
                    key={month.toString()}
                    colSpan={endOfMonth(month).getDate()}
                    className="sticky top-0 z-30 bg-muted/50 text-muted-foreground border-b border-r border-border px-2 py-2 text-center text-xs font-medium uppercase tracking-wider capitalize"
                  >
                    {format(month, 'MMMM yyyy', { locale: ptBR })}
                  </th>
                ))}
              </tr>
              <tr>
                <th className="sticky left-0 top-[49px] z-40 bg-background border-r border-b border-border shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]" />
                {allDays.map(day => (
                  <th
                    key={day.toISOString()}
                    data-date={format(day, 'yyyy-MM-dd')}
                    className={cn(
                      'sticky top-[49px] z-30 border-b border-r border-border min-w-[32px] h-[32px] text-[10px] text-center font-normal text-muted-foreground bg-background',
                      dayClass(day),
                    )}
                  >
                    <div className="flex flex-col items-center justify-center">
                      <span className="opacity-50 text-[9px] capitalize">{format(day, 'EEEEE', { locale: ptBR })}</span>
                      <span className={cn(
                        'flex items-center justify-center h-5 w-5 rounded-full',
                        isToday(day) && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
                      )}>
                        {format(day, 'd')}
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map(user => (
                <tr key={user.id} className="group hover:bg-muted/20 transition-colors">
                  <td
                    onClick={() => router.push(`/dashboard/dp/ferias/${user.id}`)}
                    className="sticky left-0 z-20 bg-background p-3 border-r border-b border-border group-hover:bg-muted/20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <Avatar className="h-7 w-7 border border-border">
                        <AvatarImage src={user.avatarUrl} />
                        <AvatarFallback className="text-xs">{initials(user.username)}</AvatarFallback>
                      </Avatar>
                      <span className="font-medium text-sm truncate max-w-[130px] text-primary hover:underline">
                        {user.username}
                      </span>
                    </div>
                  </td>
                  {allDays.map(day => {
                    const isOnVacation = approvedVacations.some(v => {
                      if (v.userId !== user.id || !v.startDate || !v.endDate) return false;
                      return day >= parseISO(v.startDate) && day <= parseISO(v.endDate);
                    });
                    return (
                      <td
                        key={day.toISOString()}
                        className={cn('border-r border-b border-border/50 p-0 h-[50px] relative', dayClass(day))}
                      >
                        {isOnVacation && (
                          <div className="absolute top-1/2 left-0 w-full h-3 -translate-y-1/2 bg-purple-500 rounded-sm z-10" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
