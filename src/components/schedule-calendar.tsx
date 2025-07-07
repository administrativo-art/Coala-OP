"use client"

import { useState, useMemo, useEffect } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, addMonths, subMonths, getYear, getMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useKiosks } from '@/hooks/use-kiosks';
import { useMonthlySchedule } from '@/hooks/use-monthly-schedule';
import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronLeft, ChevronRight, Users, Star, Edit, Wand2, Loader2 } from 'lucide-react';
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
    // Fetch schedule when component mounts or currentDate changes
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
  
  const kioskColorMap = useMemo(() => {
    const colorAssignments: { [key: string]: { text: string; bg: string } } = {
      'tirirical': { text: 'text-blue-600', bg: 'bg-blue-500' },
      'joão paulo': { text: 'text-green-600', bg: 'bg-green-500' },
    };
    
    const defaultColors = [
      { text: 'text-red-600', bg: 'bg-red-500' },
      { text: 'text-orange-600', bg: 'bg-orange-500' },
      { text: 'text-indigo-600', bg: 'bg-indigo-500' },
      { text: 'text-purple-600', bg: 'bg-purple-500' },
      { text: 'text-pink-600', bg: 'bg-pink-500' },
      { text: 'text-teal-600', bg: 'bg-teal-500' },
    ];
    let defaultColorIndex = 0;
    
    const map = new Map<string, { text: string; bg: string }>();
    
    kioskList.forEach(kiosk => {
      let assignedColor = null;
      const kioskNameLower = kiosk.name.toLowerCase();

      for (const keyword in colorAssignments) {
        if (kioskNameLower.includes(keyword)) {
          assignedColor = colorAssignments[keyword];
          break;
        }
      }

      if (assignedColor) {
        map.set(kiosk.id, assignedColor);
      } else {
        map.set(kiosk.id, defaultColors[defaultColorIndex % defaultColors.length]);
        defaultColorIndex++;
      }
    });
    
    return map;
  }, [kioskList]);

  const turns = ['T1', 'T2'];

  const renderDayCell = (day: Date) => {
    const dayISO = format(day, 'yyyy-MM-dd');
    const dayData = scheduleMap.get(dayISO);
    const dayNumber = format(day, 'd');
    const dayOfWeek = getDay(day); // 0 = Sunday

    const handleEdit = () => {
        if (!canManageSchedule) return;

        const dataToEdit: DailySchedule = dayData || {
            id: dayISO,
            diaDaSemana: format(day, 'EEEE', { locale: ptBR }),
            ...kioskList.reduce((acc, kiosk) => {
                turns.forEach(turn => {
                    acc[`${kiosk.name} ${turn}`] = '';
                });
                return acc;
            }, {} as { [key: string]: any })
        };
        onEditDay(dataToEdit);
    };

    return (
      <div 
        key={dayISO} 
        className={cn(
            "border-t border-l p-1 min-h-[120px] flex flex-col relative bg-card transition-colors group",
            canManageSchedule && "cursor-pointer hover:bg-muted/50"
        )}
        onClick={handleEdit}
      >
        <div className="flex justify-between items-start">
            <div className={cn("text-sm font-semibold mb-1", dayOfWeek === 0 && 'text-red-600')}>{dayNumber}</div>
            {canManageSchedule && (
                <div className="opacity-0 group-hover:opacity-100 transition-opacity pr-1 pt-1">
                    <Edit className="h-3 w-3 text-muted-foreground" />
                </div>
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

                        const kioskColors = kioskColorMap.get(kiosk.id);
                        const kioskColorClass = kioskColors ? kioskColors.text : 'text-primary';
                        
                        return (
                            <div key={`${kiosk.id}-${turn}`} className="flex items-center gap-1.5 p-1 rounded-sm bg-muted">
                                <span className={cn("font-bold w-6 shrink-0", kioskColorClass)}>{turn}</span>
                                <span className="truncate flex-grow">{mainEmployee}</span>
                                {isReinforcement && <Star className="h-3 w-3 text-yellow-500 shrink-0" />}
                            </div>
                        )
                    })}
                </div>
            ))}
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
          <>
            <div className="grid grid-cols-7 border-r border-b bg-background">
              {weekDays.map(dayName => (
                <div key={dayName} className="text-center font-bold p-2 border-t border-l bg-muted">{dayName}</div>
              ))}
              {Array.from({ length: startingDayIndex }).map((_, i) => <div key={`empty-${i}`} className="border-t border-l h-24"></div>)}
              {days.map(renderDayCell)}
              {Array.from({ length: (7 - (days.length + startingDayIndex) % 7) % 7 }).map((_, i) => <div key={`empty-end-${i}`} className="border-t border-l h-24"></div>)}
            </div>
             {schedule.length === 0 && !loading && (
                 <div className="text-center py-16 text-muted-foreground border">
                    <p className="font-semibold">Nenhuma escala encontrada para {format(currentDate, 'MMMM yyyy', { locale: ptBR })}.</p>
                    <p className="text-sm mt-1">{canManageSchedule ? "Clique em 'Gerar Escala com IA' para começar ou edite um dia manualmente." : "Aguardando a criação da escala."}</p>
                </div>
            )}
            <div className="flex justify-between items-center flex-wrap gap-4 mt-4 text-xs text-muted-foreground">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="font-semibold">Legenda:</span>
                  {kioskList.map(kiosk => {
                      const kioskColors = kioskColorMap.get(kiosk.id);
                      if (!kioskColors) return null;
                      return (
                          <div key={kiosk.id} className="flex items-center gap-1.5">
                              <div className={cn("h-3 w-3 rounded-full border", kioskColors.bg)}></div>
                              <span>{kiosk.name}</span>
                          </div>
                      )
                  })}
              </div>
              <div className="flex items-center gap-1"><Star className="h-3 w-3 text-yellow-500"/> = Reforço Folguista</div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
