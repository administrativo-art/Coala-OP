
"use client"

import React, { useState, useMemo, useEffect } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getYear, getMonth, addMonths, subMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useKiosks } from '@/hooks/use-kiosks';
import { useMonthlySchedule } from '@/hooks/use-monthly-schedule';
import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronLeft, ChevronRight, Users, Bed, UserX } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type DailySchedule } from '@/types';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

interface ScheduleCalendarProps {
    onEditDay: (day: DailySchedule) => void;
}

export function ScheduleCalendar({ onEditDay }: ScheduleCalendarProps) {
  const { kiosks, loading: kiosksLoading } = useKiosks();
  const { schedule, loading: scheduleLoading, fetchSchedule } = useMonthlySchedule();
  const { users, permissions } = useAuth();
  const [currentDate, setCurrentDate] = useState(new Date());

  const loading = kiosksLoading || scheduleLoading;
  const canManageSchedule = permissions.team.manage;

  const operationalUserMap = useMemo(() => {
    const map = new Map<string, boolean>();
    users.forEach(u => map.set(u.username, u.operacional));
    return map;
  }, [users]);

  useEffect(() => {
    fetchSchedule(getYear(currentDate), getMonth(currentDate) + 1);
  }, [currentDate, fetchSchedule]);

  const handlePrevMonth = () => setCurrentDate(subMonths(currentDate, 1));
  const handleNextMonth = () => setCurrentDate(addMonths(currentDate, 1));
  
  const daysInMonth = useMemo(() => {
    const start = startOfMonth(currentDate);
    const end = endOfMonth(currentDate);
    return eachDayOfInterval({ start, end });
  }, [currentDate]);

  const scheduleMap = useMemo(() => {
    const map = new Map<string, DailySchedule>();
    schedule.forEach(daySchedule => {
      map.set(daySchedule.id, daySchedule);
    });
    return map;
  }, [schedule]);
  
  const kiosksToDisplay = useMemo(() => {
    return kiosks.filter(k => k.id !== 'matriz');
  }, [kiosks]);

  const workDayCounts = useMemo(() => {
    const counts = new Map<string, Map<string, number>>();
    const employeeTrackers = new Map<string, number>();

    // Initialize trackers for all operational users
    users.filter(u => u.operacional).forEach(u => employeeTrackers.set(u.username, 0));

    daysInMonth.forEach(day => {
        const dayISO = format(day, 'yyyy-MM-dd');
        const daySchedule = scheduleMap.get(dayISO);
        const todaysWorkers = new Set<string>();
        const dayCounts = new Map<string, number>();

        if (daySchedule) {
            kiosksToDisplay.forEach(kiosk => {
                ['T1', 'T2'].forEach(turn => {
                    const employeeName = daySchedule[`${kiosk.name} ${turn}`];
                    if (employeeName && typeof employeeName === 'string' && employeeName !== 'Folga') {
                        todaysWorkers.add(employeeName);
                    }
                });
            });
        }

        for (const [employeeName] of employeeTrackers.entries()) {
            if (todaysWorkers.has(employeeName)) {
                const newCount = (employeeTrackers.get(employeeName) || 0) + 1;
                employeeTrackers.set(employeeName, newCount);
                dayCounts.set(employeeName, newCount);
            } else {
                employeeTrackers.set(employeeName, 0);
            }
        }
        counts.set(dayISO, dayCounts);
    });

    return counts;
  }, [daysInMonth, scheduleMap, users, kiosksToDisplay]);


  const handleEditClick = (day: Date) => {
    if (!canManageSchedule) return;
    const dayISO = format(day, 'yyyy-MM-dd');
    const dayData = scheduleMap.get(dayISO);

    const dataToEdit: DailySchedule = dayData || {
        id: dayISO,
        diaDaSemana: format(day, 'EEEE', { locale: ptBR }),
        ...kiosksToDisplay.reduce((acc, kiosk) => {
            ['T1', 'T2'].forEach(turn => {
                acc[`${kiosk.name} ${turn}`] = '';
            });
            return acc;
        }, {} as { [key: string]: any })
    };
    onEditDay(dataToEdit);
  };
  
  const renderEmployee = (name: string, count?: number) => {
    const displayName = count ? `${name}.${count}` : name;
    
    if (!name || name === 'Folga') {
      return <span className="truncate">{displayName}</span>;
    }
    
    const isOperational = operationalUserMap.get(name);

    if (isOperational === false) { // Explicitly check for false, undefined means user not found
      return (
        <TooltipProvider>
          <Tooltip delayDuration={100}>
            <TooltipTrigger asChild>
              <span className="truncate text-destructive flex items-center gap-1">
                <UserX className="h-3 w-3 shrink-0" />
                {displayName}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>{name} não é um colaborador operacional.</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    return <span className="truncate">{displayName}</span>;
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <CardTitle className="flex items-center gap-2"><Users /> Escala de Trabalho</CardTitle>
            <CardDescription className="mt-1">Visualize e edite as escalas de trabalho mensais.</CardDescription>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Button variant="outline" size="icon" onClick={handlePrevMonth}><ChevronLeft /></Button>
            <span className="text-lg font-semibold w-full sm:w-40 text-center capitalize">{format(currentDate, 'MMMM yyyy', { locale: ptBR })}</span>
            <Button variant="outline" size="icon" onClick={handleNextMonth}><ChevronRight /></Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
            <Skeleton className="h-96 w-full" />
        ) : (
        <div className="overflow-x-auto border rounded-lg">
            <div className="grid" style={{ gridTemplateColumns: `minmax(200px, 1fr) repeat(${daysInMonth.length}, minmax(150px, 1fr))` }}>
                {/* <!--- Headers ---> */}
                <div className="sticky left-0 z-30 bg-card border-r border-b font-semibold p-2 flex items-center">Quiosque</div>
                {daysInMonth.map((day, dayIndex) => (
                    <div key={format(day, 'dd')} className={cn("font-semibold p-2 text-center border-b z-20 bg-card", dayIndex < daysInMonth.length - 1 && "border-r")}>
                        <span className="text-muted-foreground text-xs uppercase">{format(day, 'EEE', { locale: ptBR })}</span>
                        <p>{format(day, 'd')}</p>
                    </div>
                ))}

                {/* <!--- Kiosk Rows ---> */}
                {kiosksToDisplay.map((kiosk, kioskIndex) => {
                    const kioskColor = kiosk.name.toLowerCase().includes('tirirical')
                      ? 'bg-blue-100 dark:bg-blue-900/30'
                      : kiosk.name.toLowerCase().includes('joão paulo')
                      ? 'bg-green-100 dark:bg-green-900/30'
                      : 'bg-card';
                    return (
                    <React.Fragment key={kiosk.id}>
                        <div className={cn(
                            "sticky left-0 z-20 border-r p-2 flex items-center gap-3 font-medium text-sm",
                             kioskColor,
                            kioskIndex < kiosksToDisplay.length - 1 && "border-b"
                        )}>
                           {kiosk.name}
                        </div>

                        {daysInMonth.map((day, dayIndex) => {
                            const dayISO = format(day, 'yyyy-MM-dd');
                            const dayData = scheduleMap.get(dayISO);
                            const dayCounts = workDayCounts.get(dayISO);

                            const t1Employee = dayData?.[`${kiosk.name} T1`] || 'Folga';
                            const t2Employee = dayData?.[`${kiosk.name} T2`] || 'Folga';
                            
                            const t1Count = dayCounts?.get(t1Employee);
                            const t2Count = dayCounts?.get(t2Employee);

                            return (
                                <div 
                                    key={dayISO} 
                                    onClick={() => handleEditClick(day)}
                                    className={cn(
                                        "p-1.5 h-full flex items-center justify-center group z-10",
                                        kioskColor,
                                        kioskIndex < kiosksToDisplay.length - 1 && "border-b",
                                        dayIndex < daysInMonth.length - 1 && "border-r",
                                        canManageSchedule && "cursor-pointer hover:bg-muted/50"
                                    )}
                                >
                                    {dayData ? (
                                        <div className="w-full h-full rounded-md p-2 border text-xs flex flex-col justify-center bg-card/50">
                                            <div className="flex items-center gap-1.5">
                                                <span className="font-bold text-sky-600">T1:</span>
                                                {renderEmployee(t1Employee, t1Count)}
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <span className="font-bold text-amber-600">T2:</span>
                                                {renderEmployee(t2Employee, t2Count)}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="text-center text-muted-foreground text-xs space-y-1 p-2 rounded-md bg-muted/30 w-full h-full flex flex-col items-center justify-center">
                                            <Bed className="h-4 w-4"/>
                                            <span>Sem dados</span>
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </React.Fragment>
                    )
                })}
            </div>
        </div>
        )}
      </CardContent>
    </Card>
  );
}
