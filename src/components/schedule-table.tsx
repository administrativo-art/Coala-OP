"use client"

import React from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { type Kiosk, type DailySchedule, type AbsenceEntry, type User } from '../types';
import { cn } from '@/lib/utils';
import { isToday } from 'date-fns';
import { Button } from './ui/button';
import { Edit, UserMinus, AlertTriangle } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from './ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';


interface ScheduleTableViewProps {
  kiosks: Kiosk[];
  scheduleMap: Map<string, DailySchedule>;
  dates: Date[];
  onEditDay: (day: DailySchedule, kioskId: string) => void;
  canManage: boolean;
  users: User[];
  workDayCounts: Map<string, number>;
  warnings: Map<string, { type: 'overwork' | 'conflict'; message: string }>;
}

const lookupShift = (daySchedule: DailySchedule | undefined, kiosk: Kiosk, turn: 'T1' | 'T2' | 'T3' | 'Folga' | 'Ausencia'): string | AbsenceEntry[] => {
    if (!daySchedule) return turn === 'Ausencia' ? [] : '';
    const byId = daySchedule[`${kiosk.id} ${turn}`];
    if (byId !== undefined) return byId;
    const byName = daySchedule[`${kiosk.name} ${turn}`];
    if (byName !== undefined) return byName;
    return turn === 'Ausencia' ? [] : '';
};

export function ScheduleTableView({ kiosks, scheduleMap, dates, onEditDay, canManage, users, workDayCounts, warnings }: ScheduleTableViewProps) {

  const handleEditClick = (day: Date, kioskId: string) => {
    const dayISO = format(day, 'yyyy-MM-dd');
    const dayData = scheduleMap.get(dayISO);

    const dataToEdit: DailySchedule = dayData || {
        id: dayISO,
        diaDaSemana: format(day, 'EEEE', { locale: ptBR }),
        ...kiosks.reduce((acc, kiosk) => {
            ['T1', 'T2', 'T3', 'Folga', 'Ausencia'].forEach(turn => {
                acc[`${kiosk.id} ${turn}`] = turn === 'Ausencia' ? [] : '';
            });
            return acc;
        }, {} as { [key: string]: any })
    };
    onEditDay(dataToEdit, kioskId);
  };
  
  const renderEmployeeName = (name: string, date: Date, kioskId: string) => {
      const dayISO = format(date, 'yyyy-MM-dd');
      const user = users.find(u => u.username === name.trim());
      if (!user) return name;
      
      const count = workDayCounts.get(`${dayISO}-${user.username}`);
      const color = user?.color;
      const overworkWarning = warnings.get(`${dayISO}-${user.username}`);
      const conflictWarning = warnings.get(`${dayISO}-${user.username}-${kioskId}`);

      const warning = conflictWarning || overworkWarning;

      return (
        <span className="inline-flex items-center gap-1">
            <span
                className={cn("px-1.5 py-0.5 rounded-md", color && 'text-black')}
                style={color ? { backgroundColor: color } : {}}
            >
                {name}
                {count && count > 1 && (
                    <span className="text-xs font-bold ml-1 opacity-80">({count})</span>
                )}
            </span>
             {warning && (
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger>
                            <AlertTriangle className="h-4 w-4 text-destructive"/>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>{warning.message}</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            )}
        </span>
      );
  };

  const renderShift = (shiftValue: string | any[], date: Date, kioskId: string) => {
      if (typeof shiftValue !== 'string' || !shiftValue) return null;
      return shiftValue.split(' + ').map(name => renderEmployeeName(name.trim(), date, kioskId)).reduce((prev, curr) => <>{prev} + {curr}</>);
  };

  return (
    <div className="overflow-x-auto rounded-lg border">
        <Table className="min-w-full text-left">
        <TableHeader className="sticky top-0 bg-muted/50 z-10">
            <TableRow>
            <TableHead className="px-2 py-3">Dia</TableHead>
            {kiosks.map(k => (
                <TableHead key={k.id} className="px-2 py-3 text-center">{k.name}</TableHead>
            ))}
            </TableRow>
        </TableHeader>
        <TableBody>
            {dates.map(date => {
            const dateStr = format(date, 'yyyy-MM-dd');
            const daySchedule = scheduleMap.get(dateStr);
            const isWeekend = date.getDay() === 0 || date.getDay() === 6;

            return (
                <TableRow key={dateStr} className={cn(isWeekend && 'bg-muted/30')}>
                <TableCell className={cn("px-2 py-3 align-top font-semibold", isToday(date) && "bg-accent/20 text-accent-foreground")}>
                    <p>{format(date, 'dd')}</p>
                    <p className="text-xs font-normal text-muted-foreground">{format(date, 'EEEE', {locale: ptBR})}</p>
                </TableCell>
                {kiosks.map(kiosk => {
                    const t1 = lookupShift(daySchedule, kiosk, 'T1');
                    const t2 = lookupShift(daySchedule, kiosk, 'T2');
                    const folga = lookupShift(daySchedule, kiosk, 'Folga');
                    const ausencias = (lookupShift(daySchedule, kiosk, 'Ausencia') as AbsenceEntry[] || []);

                    return (
                        <TableCell key={kiosk.id} className="px-2 py-3 align-top text-xs relative group">
                            <div className="min-h-[60px] space-y-1">
                                {t1 && <p><strong>T1:</strong> {renderShift(t1, date, kiosk.id)}</p>}
                                {t2 && <p><strong>T2:</strong> {renderShift(t2, date, kiosk.id)}</p>}
                                {folga && <p className="text-muted-foreground"><strong>F:</strong> {renderShift(folga, date, kiosk.id)}</p>}
                                {ausencias.length > 0 && ausencias.map(a => {
                                    const user = users.find(u => u.id === a.userId);
                                    return (
                                        <p key={a.userId} className="text-red-500 flex items-center gap-1">
                                            <UserMinus className="h-3 w-3"/> Ausente: {user?.username}
                                        </p>
                                    )
                                })}
                            </div>
                            {canManage && (
                                <Button variant="ghost" size="icon" className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => handleEditClick(date, kiosk.id)}>
                                    <Edit className="h-3 w-3" />
                                </Button>
                            )}
                        </TableCell>
                    )
                })}
                </TableRow>
            )
            })}
        </TableBody>
        </Table>
    </div>
  );
}
