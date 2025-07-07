
"use client"

import React, { useState, useMemo, useEffect } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, addMonths, subMonths, getYear, getMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useKiosks } from '@/hooks/use-kiosks';
import { useMonthlySchedule } from '@/hooks/use-monthly-schedule';
import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronLeft, ChevronRight, Users, Wand2, Loader2, Bed } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type DailySchedule } from '@/types';
import { generateSchedule } from '@/ai/flows/generate-schedule-flow';
import { useToast } from '@/hooks/use-toast';

interface ScheduleCalendarProps {
    onEditDay: (day: DailySchedule) => void;
}

export function ScheduleCalendar({ onEditDay }: ScheduleCalendarProps) {
  const { kiosks, loading: kiosksLoading } = useKiosks();
  const { schedule, loading: scheduleLoading, fetchSchedule, currentYear, currentMonth, createFullMonthSchedule } = useMonthlySchedule();
  const { users, permissions } = useAuth();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [isGenerating, setIsGenerating] = useState(false);
  const { toast } = useToast();

  const loading = kiosksLoading || scheduleLoading;
  const canManageSchedule = permissions.team.manage;

  useEffect(() => {
    fetchSchedule(getYear(currentDate), getMonth(currentDate) + 1);
  }, [currentDate, fetchSchedule]);

  const handlePrevMonth = () => setCurrentDate(subMonths(currentDate, 1));
  const handleNextMonth = () => setCurrentDate(addMonths(currentDate, 1));
  
  const handleGenerateSchedule = async () => {
    if (!canManageSchedule) return;

    setIsGenerating(true);
    toast({
      title: "Gerando escala...",
      description: "A IA está trabalhando para criar a melhor escala. Isso pode levar um minuto."
    });

    try {
        const kiosksToStaff = kiosks.filter(k => k.id !== 'matriz');
        const usersToSchedule = users
            .filter(u => u.operacional)
            .map(u => ({
                id: u.id,
                username: u.username,
                turno: u.turno,
                folguista: u.folguista
            }));
        
        const result = await generateSchedule({
            month: currentMonth,
            year: currentYear,
            users: usersToSchedule,
            kiosks: kiosksToStaff
        });
        
        await createFullMonthSchedule(result);

        toast({
          title: "Sucesso!",
          description: "A escala do mês foi gerada e salva com sucesso."
        });

    } catch (error) {
        console.error("Failed to generate schedule:", error);
        toast({
            variant: "destructive",
            title: "Erro ao gerar escala",
            description: "Não foi possível gerar a escala. Tente novamente mais tarde."
        });
    } finally {
        setIsGenerating(false);
    }
  };

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

  const handleEditClick = (day: Date) => {
    if (!canManageSchedule) return;
    const dayISO = format(day, 'yyyy-MM-dd');
    const dayData = scheduleMap.get(dayISO);

    const dataToEdit: DailySchedule = dayData || {
        id: dayISO,
        diaDaSemana: format(day, 'EEEE', { locale: ptBR }),
        ...kiosks.filter(k => k.id !== 'matriz').reduce((acc, kiosk) => {
            ['T1', 'T2'].forEach(turn => {
                acc[`${kiosk.name} ${turn}`] = '';
            });
            return acc;
        }, {} as { [key: string]: any })
    };
    onEditDay(dataToEdit);
  };
  
  const kiosksToDisplay = useMemo(() => {
    return kiosks.filter(k => k.id !== 'matriz');
  }, [kiosks]);

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <CardTitle className="flex items-center gap-2"><Users /> Escala de Trabalho</CardTitle>
            <CardDescription className="mt-1">Visualize, edite ou gere escalas de trabalho mensais.</CardDescription>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Button variant="outline" size="icon" onClick={handlePrevMonth} disabled={isGenerating}><ChevronLeft /></Button>
            <span className="text-lg font-semibold w-full sm:w-40 text-center capitalize">{format(currentDate, 'MMMM yyyy', { locale: ptBR })}</span>
            <Button variant="outline" size="icon" onClick={handleNextMonth} disabled={isGenerating}><ChevronRight /></Button>
          </div>
        </div>
         {canManageSchedule && (
            <div className="mt-4">
                <Button onClick={handleGenerateSchedule} disabled={isGenerating || loading}>
                    {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Wand2 className="mr-2 h-4 w-4"/>}
                    {isGenerating ? 'Gerando escala...' : 'Gerar Escala com IA'}
                </Button>
            </div>
        )}
      </CardHeader>
      <CardContent>
        {loading && !isGenerating ? (
            <Skeleton className="h-96 w-full" />
        ) : (
        <div className="overflow-x-auto border rounded-lg">
            <div className="grid" style={{ gridTemplateColumns: `200px repeat(${daysInMonth.length}, minmax(150px, 1fr))` }}>
                {/* <!--- Headers ---> */}
                <div className="sticky left-0 z-20 bg-card border-r border-b font-semibold p-2 flex items-center">Quiosque</div>
                {daysInMonth.map((day, dayIndex) => (
                    <div key={format(day, 'dd')} className={cn("font-semibold p-2 text-center border-b", dayIndex < daysInMonth.length - 1 && "border-r")}>
                        <span className="text-muted-foreground text-xs uppercase">{format(day, 'EEE', { locale: ptBR })}</span>
                        <p>{format(day, 'd')}</p>
                    </div>
                ))}

                {/* <!--- Kiosk Rows ---> */}
                {kiosksToDisplay.map((kiosk, kioskIndex) => {
                    return (
                    <React.Fragment key={kiosk.id}>
                        <div className={cn(
                            "sticky left-0 z-10 bg-card border-r p-2 flex items-center gap-3 font-medium text-sm",
                            kioskIndex < kiosksToDisplay.length - 1 && "border-b"
                        )}>
                           {kiosk.name}
                        </div>

                        {daysInMonth.map((day, dayIndex) => {
                            const dayISO = format(day, 'yyyy-MM-dd');
                            const dayData = scheduleMap.get(dayISO);
                            const t1Employee = dayData?.[`${kiosk.name} T1`] || 'Folga';
                            const t2Employee = dayData?.[`${kiosk.name} T2`] || 'Folga';

                            return (
                                <div 
                                    key={dayISO} 
                                    onClick={() => handleEditClick(day)}
                                    className={cn(
                                        "p-1.5 h-full flex items-center justify-center group",
                                        kioskIndex < kiosksToDisplay.length - 1 && "border-b",
                                        dayIndex < daysInMonth.length - 1 && "border-r",
                                        canManageSchedule && "cursor-pointer hover:bg-muted/50"
                                    )}
                                >
                                    {dayData ? (
                                        <div className="w-full h-full rounded-md p-2 border text-xs flex flex-col justify-center bg-muted/30">
                                            <div className="flex items-center gap-1.5">
                                                <span className="font-bold text-sky-600">T1:</span>
                                                <span className="truncate">{t1Employee}</span>
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <span className="font-bold text-amber-600">T2:</span>
                                                <span className="truncate">{t2Employee}</span>
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
