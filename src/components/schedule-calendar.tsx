"use client"

import { useState, useMemo, useEffect } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, addMonths, subMonths, getYear, getMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useKiosks } from '@/hooks/use-kiosks';
import { useMonthlySchedule } from '@/hooks/use-monthly-schedule';
import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronLeft, ChevronRight, Users, VenetianMask, Star, Edit } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type DailySchedule } from '@/types';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from './ui/tooltip';

interface ScheduleCalendarProps {
    onEditDay: (day: DailySchedule) => void;
}

export function ScheduleCalendar({ onEditDay }: ScheduleCalendarProps) {
  const { kiosks, loading: kiosksLoading } = useKiosks();
  const { schedule, loading: scheduleLoading, fetchSchedule } = useMonthlySchedule();
  const { permissions } = useAuth();
  const [currentDate, setCurrentDate] = useState(new Date());

  const loading = kiosksLoading || scheduleLoading;
  const canManageSchedule = permissions.team.manage;

  useEffect(() => {
    // Fetch schedule when component mounts or currentDate changes
    fetchSchedule(getYear(currentDate), getMonth(currentDate) + 1);
  }, [currentDate, fetchSchedule]);


  const handlePrevMonth = () => setCurrentDate(subMonths(currentDate, 1));
  const handleNextMonth = () => setCurrentDate(addMonths(currentDate, 1));

  const { days, firstDayOfMonth } = useMemo(() => {
    const start = startOfMonth(currentDate);
    const end = endOfMonth(currentDate);
    return {
      days: eachDayOfInterval({ start, end }),
      firstDayOfMonth: start,
    };
  }, [currentDate]);

  const startingDayIndex = getDay(firstDayOfMonth);

  const scheduleMap = useMemo(() => {
    const map = new Map<string, DailySchedule>();
    schedule.forEach(daySchedule => {
      map.set(daySchedule.id, daySchedule);
    });
    return map;
  }, [schedule]);

  const kioskList = useMemo(() => {
      return kiosks.filter(k => k.id !== 'matriz').sort((a,b) => a.name.localeCompare(b.name));
  }, [kiosks]);

  const turns = ['T1', 'T2'];

  const handleEditClick = (e: React.MouseEvent, dayData: DailySchedule) => {
      e.stopPropagation();
      onEditDay(dayData);
  }

  const renderDayCell = (day: Date) => {
    const dayISO = format(day, 'yyyy-MM-dd');
    const dayData = scheduleMap.get(dayISO);
    const dayNumber = format(day, 'd');
    const dayOfWeek = getDay(day); // 0 = Sunday

    return (
      <div key={dayISO} className="border-t border-l p-1 min-h-[120px] flex flex-col relative bg-card hover:bg-muted/50 transition-colors group">
        <div className="flex justify-between items-start">
            <div className={cn("text-sm font-semibold mb-1", dayOfWeek === 0 && 'text-red-600')}>{dayNumber}</div>
            {canManageSchedule && dayData && (
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                             <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => handleEditClick(e, dayData)}>
                                <Edit className="h-3 w-3" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>Editar escala do dia</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            )}
        </div>
        {dayData ? (
          <div className="space-y-1 text-xs flex-grow">
            {kioskList.map(kiosk => (
                <div key={kiosk.id}>
                    {turns.map(turn => {
                        const fieldName = `${kiosk.name} ${turn}`;
                        const employeeName = dayData[fieldName];
                        if (!employeeName) return null;
                        
                        const isReinforcement = employeeName.includes('+');
                        const mainEmployee = isReinforcement ? employeeName.split('+')[0].trim() : employeeName;
                        
                        return (
                            <div key={`${kiosk.id}-${turn}`} className="flex items-center gap-1.5 p-1 rounded-sm bg-muted">
                                <span className="font-bold text-primary w-6 shrink-0">{turn}</span>
                                <span className="truncate flex-grow">{mainEmployee}</span>
                                {isReinforcement && <Star className="h-3 w-3 text-yellow-500 shrink-0" />}
                            </div>
                        )
                    })}
                </div>
            ))}
            {dayData.folguistaDSR && (
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <div className="absolute bottom-1 right-1 p-1 bg-green-100 dark:bg-green-900 rounded-full cursor-help">
                                <VenetianMask className="h-4 w-4 text-green-600 dark:text-green-400" />
                            </div>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>DSR Folguista</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            )}
          </div>
        ) : (
          <div className="flex-grow"></div>
        )}
      </div>
    );
  };
  
  const weekDays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  
  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle className="flex items-center gap-2"><Users /> Escala de Trabalho</CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={handlePrevMonth}><ChevronLeft /></Button>
            <span className="text-lg font-semibold w-40 text-center capitalize">{format(currentDate, 'MMMM yyyy', { locale: ptBR })}</span>
            <Button variant="outline" size="icon" onClick={handleNextMonth}><ChevronRight /></Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
            <Skeleton className="h-96 w-full" />
        ) : (
          <>
            <div className="grid grid-cols-7 border-r border-b bg-background">
              {weekDays.map(dayName => (
                <div key={dayName} className="text-center font-bold p-2 border-t border-l bg-muted">{dayName}</div>
              ))}
              {Array.from({ length: startingDayIndex }).map((_, i) => <div key={`empty-${i}`} className="border-t border-l h-24"></div>)}
              {days.map(renderDayCell)}
              {Array.from({ length: (7 - (days.length + startingDayIndex) % 7) % 7 }).map((_, i) => <div key={`empty-end-${i}`} className="border-t border-l h-24"></div>)}
            </div>
             {schedule.length === 0 && (
                 <div className="text-center py-16 text-muted-foreground border">
                    <p className="font-semibold">Nenhuma escala encontrada para {format(currentDate, 'MMMM yyyy', { locale: ptBR })}.</p>
                    <p className="text-sm mt-1">A escala é gerada automaticamente todo dia 25 do mês anterior.</p>
                </div>
            )}
            <div className="flex justify-end gap-4 mt-4 text-xs text-muted-foreground">
                <div className="flex items-center gap-1"><Star className="h-3 w-3 text-yellow-500"/> = Reforço Folguista</div>
                <div className="flex items-center gap-1"><VenetianMask className="h-3 w-3 text-green-600"/> = DSR Folguista</div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
