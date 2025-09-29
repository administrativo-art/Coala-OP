
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
import { Separator } from './ui/separator';


interface ScheduleTableViewProps {
  kiosks: Kiosk[];
  scheduleMap: Map<string, DailySchedule>;
  dates: Date[];
  onEditDay: (day: Date, kioskId: string) => void;
  onDayClick?: (day: Date, kioskId: string) => void;
  selectedDays?: Set<string>;
  canManage: boolean;
  users: User[];
  workDayCounts: Map<string, number>;
  warnings: Map<string, { type: 'overwork' | 'conflict'; message: string }>;
  todaysWorkersMap: Map<string, Set<string>>;
  selectedEmployee: string;
}

const lookupShift = (daySchedule: DailySchedule | undefined, kiosk: Kiosk, turn: 'T1' | 'T2' | 'T3' | 'Folga' | 'Ausencia'): string | AbsenceEntry[] => {
    if (!daySchedule) return turn === 'Ausencia' ? [] : '';
    const byId = daySchedule[`${kiosk.id} ${turn}`];
    if (byId !== undefined) return byId;
    const byName = daySchedule[`${kiosk.name} ${turn}`];
    if (byName !== undefined) return byName;
    return turn === 'Ausencia' ? [] : '';
};

export function ScheduleTableView({ kiosks, scheduleMap, dates, onEditDay, onDayClick, selectedDays, canManage, users, workDayCounts, warnings, todaysWorkersMap, selectedEmployee }: ScheduleTableViewProps) {

  const renderEmployeeName = (name: string, date: Date, kioskId: string, isFolga = false) => {
      const dayISO = format(date, 'yyyy-MM-dd');
      const user = users.find(u => u.username === name.trim());
      if (!user) return name;
      
      const count = workDayCounts.get(`${dayISO}-${user.id}`);
      
      const color = user?.color;
      const overworkWarning = warnings.get(`${dayISO}-${user.id}`);
      const conflictWarning = warnings.get(`${dayISO}-${user.username}-${kioskId}`);

      const warning = conflictWarning || overworkWarning;
      
      if (isFolga) {
          return <span className="text-muted-foreground">{name}</span>;
      }
      
      const isSelectedEmployee = selectedEmployee !== 'all' && user.id === selectedEmployee;

      return (
        <span className={cn("inline-flex items-center gap-1", isSelectedEmployee && "font-bold")}>
            <span
                className="px-1.5 py-0.5 rounded-md"
                style={color ? { backgroundColor: color, color: 'black' } : {}}
            >
                {name}
                {count && count >= 1 && (
                    <span className="text-xs font-bold opacity-80"> - {count}</span>
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

  const renderShift = (shiftValue: string | any[], date: Date, kioskId: string, isFolga = false) => {
      if (typeof shiftValue !== 'string' || !shiftValue) return null;
      return shiftValue.split(' + ').map((name, index, arr) => (
        <React.Fragment key={name}>
          {renderEmployeeName(name.trim(), date, kioskId, isFolga)}
          {index < arr.length - 1 && ' + '}
        </React.Fragment>
      ));
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
            const dayISO = format(date, 'yyyy-MM-dd');
            const daySchedule = scheduleMap.get(dayISO);
            const isWeekend = date.getDay() === 0 || date.getDay() === 6;
            const isSunday = date.getDay() === 0;

            return (
                <TableRow key={dayISO} className={cn(isWeekend && 'bg-muted/30', isSunday && 'bg-destructive/10')}>
                <TableCell className={cn("px-2 py-3 align-top font-semibold", isToday(date) && "bg-accent/20 text-accent-foreground")}>
                    <p>{format(date, 'dd')}</p>
                    <p className="text-xs font-normal text-muted-foreground">{format(date, 'EEEE', { locale: ptBR })}</p>
                </TableCell>
                {kiosks.map(kiosk => {
                    const t1 = lookupShift(daySchedule, kiosk, 'T1') as string;
                    const t2 = lookupShift(daySchedule, kiosk, 'T2') as string;
                    const t3 = lookupShift(daySchedule, kiosk, 'T3') as string;
                    const ausencias = (lookupShift(daySchedule, kiosk, 'Ausencia') as AbsenceEntry[] || []);
                    
                    const manualFolga = (lookupShift(daySchedule, kiosk, 'Folga') as string || '').split(' + ').filter(Boolean);
                    const todaysWorkers = todaysWorkersMap.get(dayISO) || new Set();
                    const autoFolgas = users
                        .filter(u => u.operacional && u.assignedKioskIds.includes(kiosk.id) && !todaysWorkers.has(u.username))
                        .map(u => u.username);
                    
                    const combinedFolgas = [...new Set([...manualFolga, ...autoFolgas])].join(' + ');

                    const hasWorkShifts = (t1 && t1.length > 0) || (t2 && t2.length > 0) || (t3 && t3.length > 0);
                    const hasFolgaOrAusencia = (combinedFolgas && combinedFolgas.length > 0) || ausencias.length > 0;
                    
                    const selectionKey = `${dayISO}::${kiosk.id}`;
                    const isSelected = selectedDays?.has(selectionKey);

                    const selectedUserObject = selectedEmployee !== 'all' ? users.find(u => u.id === selectedEmployee) : null;
                    const employeeIsWorking = selectedUserObject && 
                        (t1.includes(selectedUserObject.username) || t2.includes(selectedUserObject.username) || t3.includes(selectedUserObject.username));


                    return (
                        <TableCell
                          key={kiosk.id}
                          className={cn(
                            "px-2 py-3 align-top text-xs relative group",
                            onDayClick && "cursor-pointer",
                            isSelected ? "bg-primary/20" : "hover:bg-accent/10",
                            employeeIsWorking && "bg-blue-100 dark:bg-blue-900/50"
                          )}
                          onClick={onDayClick ? () => onDayClick(date, kiosk.id) : undefined}
                        >
                            <div className="min-h-[60px] space-y-1">
                                {t1 && <p><strong>T1:</strong> {renderShift(t1, date, kiosk.id)}</p>}
                                {t2 && <p><strong>T2:</strong> {renderShift(t2, date, kiosk.id)}</p>}
                                {t3 && <p><strong>T3:</strong> {renderShift(t3, date, kiosk.id)}</p>}
                                
                                {hasWorkShifts && hasFolgaOrAusencia && (
                                    <Separator className="my-2 border-dashed" />
                                )}

                                {combinedFolgas && <p className="text-muted-foreground"><strong>F:</strong> {renderShift(combinedFolgas, date, kiosk.id, true)}</p>}
                                
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
                                <div className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); onEditDay(date, kiosk.id);}}>
                                        <Edit className="h-3 w-3 text-muted-foreground" />
                                    </Button>
                                </div>
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
