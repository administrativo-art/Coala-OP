
"use client"

import * as React from 'react';
import { useState, useMemo, useEffect } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, addMonths, subMonths, getYear, getMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useKiosks } from '@/hooks/use-kiosks';
import { useMonthlySchedule } from '@/hooks/use-monthly-schedule';
import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { ChevronLeft, ChevronRight, Users, Edit, Wand2, Loader2, Bed, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type DailySchedule, type User } from '@/types';
import { generateSchedule } from '@/ai/flows/generate-schedule-flow';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';


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

  const sortedUsers = useMemo(() => {
    return [...users].sort((a,b) => {
        if (a.operacional && !b.operacional) return -1;
        if (!a.operacional && b.operacional) return 1;
        return a.username.localeCompare(b.username);
    });
  }, [users]);
  
  const kioskColorMap = useMemo(() => {
      const colorAssignments: { [keyword: string]: string } = {
          'tirirical': 'bg-blue-100 text-blue-800 border-blue-200',
          'joão paulo': 'bg-green-100 text-green-800 border-green-200',
      };
      const defaultColors = [
          'bg-yellow-100 text-yellow-800 border-yellow-200',
          'bg-red-100 text-red-800 border-red-200',
          'bg-purple-100 text-purple-800 border-purple-200',
          'bg-indigo-100 text-indigo-800 border-indigo-200',
      ];
      let defaultColorIndex = 0;
      
      const map = new Map<string, string>();
      const kiosksToColor = kiosks.filter(k => k.id !== 'matriz');
      
      kiosksToColor.forEach(kiosk => {
          let assignedColorKey: string | null = null;
          const kioskNameLower = kiosk.name.toLowerCase();

          for (const keyword in colorAssignments) {
              if (kioskNameLower.includes(keyword)) {
                  assignedColorKey = keyword;
                  break;
              }
          }
          if (assignedColorKey) {
              map.set(kiosk.name, colorAssignments[assignedColorKey]);
          } else {
              map.set(kiosk.name, defaultColors[defaultColorIndex % defaultColors.length]);
              defaultColorIndex++;
          }
      });
      return map;
  }, [kiosks]);

  const getUserShiftForDay = (user: User, day: Date): {kiosk: string, turn: string} | null => {
      const dayISO = format(day, 'yyyy-MM-dd');
      const dayData = scheduleMap.get(dayISO);
      if (!dayData) return null;

      for (const key in dayData) {
          if (typeof dayData[key] === 'string' && dayData[key].includes(user.username)) {
              const parts = key.split(' ');
              const turn = parts.pop();
              const kiosk = parts.join(' ');
              if (turn === 'T1' || turn === 'T2') {
                  return { kiosk, turn };
              }
          }
      }
      return null;
  }
  
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
        <div className="grid border-t border-b border-r rounded-lg" style={{ gridTemplateColumns: 'minmax(200px, 1.5fr) 3fr' }}>
            {/* <!--- User Header ---> */}
            <div className="sticky left-0 bg-card border-l font-semibold p-2 flex items-center">Colaborador(a)</div>

            {/* <!--- Scrollable Area ---> */}
            <div className="overflow-x-auto">
                <div className="grid" style={{ gridTemplateColumns: `repeat(${daysInMonth.length}, minmax(140px, 1fr))` }}>
                    {/* <!--- Day Headers ---> */}
                    {daysInMonth.map(day => (
                        <div key={format(day, 'dd')} className="font-semibold p-2 border-l text-center">
                            <span className="text-muted-foreground text-xs uppercase">{format(day, 'EEE', { locale: ptBR })}</span>
                            <p>{format(day, 'd')}</p>
                        </div>
                    ))}
                </div>
            </div>

            {/* <!--- User Rows ---> */}
            {sortedUsers.map((user, userIndex) => (
                <React.Fragment key={user.id}>
                    <div className={cn(
                        "sticky left-0 bg-card border-l p-2 flex items-center gap-3",
                        userIndex < sortedUsers.length -1 && "border-b",
                        !user.operacional && "opacity-60"
                    )}>
                       <Avatar className="h-8 w-8">
                            <AvatarImage src={user.avatarUrl} alt={user.username} />
                            <AvatarFallback>{user.username.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col">
                            <span className="font-medium text-sm">{user.username}</span>
                            {!user.operacional && <Badge variant="secondary" className="text-xs w-fit h-fit p-0.5 px-1.5 leading-tight">Não Operacional</Badge>}
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                         <div className="grid" style={{ gridTemplateColumns: `repeat(${daysInMonth.length}, minmax(140px, 1fr))` }}>
                            {/* <!--- Schedule Cells ---> */}
                            {daysInMonth.map(day => {
                                const shift = user.operacional ? getUserShiftForDay(user, day) : null;

                                return (
                                    <div 
                                        key={format(day, 'dd')} 
                                        onClick={() => user.operacional && handleEditClick(day)}
                                        className={cn(
                                            "p-1.5 border-l h-full flex items-center justify-center group",
                                            userIndex < sortedUsers.length -1 && "border-b",
                                            canManageSchedule && user.operacional && "cursor-pointer hover:bg-muted/50"
                                        )}
                                    >
                                        {!user.operacional ? (
                                             <div className="text-center text-muted-foreground/50 text-xs w-full h-full flex items-center justify-center p-1 rounded-md bg-muted/20">
                                                N/A
                                            </div>
                                        ) : shift ? (
                                            <div className={cn(
                                                "w-full h-full rounded-md p-2 border text-xs flex flex-col justify-center",
                                                kioskColorMap.get(shift.kiosk) || 'bg-gray-100 text-gray-800 border-gray-200'
                                            )}>
                                                <p className="font-bold">{shift.kiosk}</p>
                                                <p>{shift.turn === 'T1' ? '1º Turno' : '2º Turno'}</p>
                                            </div>
                                        ) : (
                                            <div className="text-center text-muted-foreground text-xs space-y-1 p-2 rounded-md bg-muted/30 w-full h-full flex flex-col items-center justify-center">
                                                 <Bed className="h-4 w-4"/>
                                                <span>Dia de folga</span>
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                </React.Fragment>
            ))}
        </div>
        )}
      </CardContent>
    </Card>
  );
}
