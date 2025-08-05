"use client"

import React, { useState, useMemo, useEffect } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getYear, getMonth, addMonths, subMonths, parseISO, subDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useKiosks } from '@/hooks/use-kiosks';
import { useMonthlySchedule } from '@/hooks/use-monthly-schedule';
import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronLeft, ChevronRight, Users, Wand2, Trash2, Eraser } from 'lucide-react';
import { type DailySchedule, type User, type Kiosk } from '@/types';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScheduleTableView } from './schedule-table';

export function ScheduleCalendar({ onEditDay }: { onEditDay: (day: DailySchedule, kioskId: string) => void; }) {
  const { kiosks, loading: kiosksLoading } = useKiosks();
  const { schedule, loading: scheduleLoading, fetchSchedule, createFullMonthSchedule, previousMonthSchedule } = useMonthlySchedule();
  const { users, permissions } = useAuth();

  const [currentDate, setCurrentDate] = useState(new Date());
  const [isClearConfirmationOpen, setIsClearConfirmationOpen] = useState(false);
  const [isGenerateConfirmationOpen, setIsGenerateConfirmationOpen] = useState(false);
  const [selectedKiosk, setSelectedKiosk] = useState('all');

  const loading = kiosksLoading || scheduleLoading;
  const canManageSchedule = permissions.team.manage;

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

  const previousScheduleMap = useMemo(() => {
    const map = new Map<string, DailySchedule>();
    previousMonthSchedule.forEach(daySchedule => {
      map.set(daySchedule.id, daySchedule);
    });
    return map;
  }, [previousMonthSchedule]);
  
  const kiosksToDisplay = useMemo(() => {
    const kioskOrder = ["matriz", "joao-paulo", "tirirical"];
    
    const sortedKiosks = [...kiosks].sort((a, b) => {
        const indexA = kioskOrder.indexOf(a.id);
        const indexB = kioskOrder.indexOf(b.id);
        
        if (indexA !== -1 && indexB !== -1) return indexA - indexB;
        if (indexA !== -1) return -1;
        if (indexB !== -1) return 1;
        return a.name.localeCompare(b.name);
    });

    return sortedKiosks;
  }, [kiosks]);
  
  const filteredKiosks = useMemo(() => {
    if (selectedKiosk === 'all') {
        return kiosksToDisplay;
    }
    return kiosksToDisplay.filter(k => k.id === selectedKiosk);
  }, [kiosksToDisplay, selectedKiosk]);

  const { workDayCounts, warnings } = useMemo(() => {
    const counts = new Map<string, number>();
    const warningsMap = new Map<string, { type: 'overwork' | 'conflict'; message: string }>();

    if (users.length === 0 || kiosksToDisplay.length === 0) {
      return { workDayCounts: counts, warnings: warningsMap };
    }

    const lastDayOfPrevMonth = endOfMonth(subDays(startOfMonth(currentDate), 1));
    const lastDayISO = format(lastDayOfPrevMonth, 'yyyy-MM-dd');
    const lastDaySchedule = previousScheduleMap.get(lastDayISO);

    users.forEach(user => {
      let consecutiveDays = 0;
      if (lastDaySchedule) {
        let workedLastDay = false;
        kiosksToDisplay.forEach(kiosk => {
          ['T1', 'T2', 'T3'].forEach(turn => {
            const shiftKey = `${kiosk.id} ${turn}`;
            const shiftWorkers = lastDaySchedule[shiftKey] as string || '';
            if (shiftWorkers.includes(user.username)) {
              workedLastDay = true;
            }
          });
        });
        if (workedLastDay) {
            // This part requires a loop backwards, for simplicity we'll just check the very last day
            // A more robust implementation would fetch more history
            consecutiveDays = 1; 
        }
      }
      counts.set(`${user.username}-initial`, consecutiveDays);
    });
    
    daysInMonth.forEach(day => {
      const dayISO = format(day, 'yyyy-MM-dd');
      const daySchedule = scheduleMap.get(dayISO);
      const todaysAssignments = new Map<string, string>();

      users.forEach(user => {
          let workedToday = false;
          kiosksToDisplay.forEach(kiosk => {
            if(daySchedule) {
              ['T1', 'T2', 'T3'].forEach(turn => {
                const shiftKey = `${kiosk.id} ${turn}`;
                const shiftWorkers = (daySchedule[shiftKey] as string || '').split(' + ').map(s => s.trim());
                if (shiftWorkers.includes(user.username)) {
                  workedToday = true;
                  const key = `${dayISO}-${user.username}`;
                  if (todaysAssignments.has(key)) {
                      warningsMap.set(`${key}-${kiosk.id}`, { type: 'conflict', message: `Dupla alocação: também em ${todaysAssignments.get(key)}.` });
                  } else {
                      todaysAssignments.set(key, kiosk.name);
                  }
                }
              });
            }
          });

          const prevDayISO = format(subDays(day, 1), 'yyyy-MM-dd');
          const yesterdayCount = counts.get(`${prevDayISO}-${user.username}`) || counts.get(`${user.username}-initial`) || 0;
          
          if(workedToday) {
            const newCount = yesterdayCount + 1;
            counts.set(`${dayISO}-${user.username}`, newCount);
            if (newCount > 6) {
                warningsMap.set(`${dayISO}-${user.username}`, { type: 'overwork', message: `Trabalhando há ${newCount} dias seguidos.` });
            }
          } else {
            counts.set(`${dayISO}-${user.username}`, 0);
          }
      });
    });

    return { workDayCounts: counts, warnings: warningsMap };
  }, [scheduleMap, previousScheduleMap, daysInMonth, users, kiosksToDisplay, currentDate]);
  
  const handleClearMonthConfirm = async () => {
    const emptyScheduleData: Record<string, any> = {};
    const kioskKeys = kiosksToDisplay.flatMap(kiosk => [`${kiosk.id} T1`, `${kiosk.id} T2`, `${kiosk.id} T3`, `${kiosk.id} Folga`, `${kiosk.id} Ausencia`]);

    daysInMonth.forEach(day => {
        const dayISO = format(day, 'yyyy-MM-dd');
        const emptyDay: Partial<DailySchedule> = {
            id: dayISO,
            diaDaSemana: format(day, 'EEEE', { locale: ptBR }),
        };
        kioskKeys.forEach(key => {
            emptyDay[key] = key.endsWith('Ausencia') ? [] : '';
        });
        emptyScheduleData[dayISO] = emptyDay;
    });
    
    await createFullMonthSchedule(emptyScheduleData);
    setIsClearConfirmationOpen(false);
  };

  const handleGenerateConfirm = async () => {
    // This function can be expanded with real logic
    setIsGenerateConfirmationOpen(false);
  };

  return (
    <>
        <Card className="w-full">
        <CardHeader className="space-y-4">
            <div>
                <CardTitle className="flex items-center gap-2"><Users /> Escala de Trabalho</CardTitle>
                <CardDescription>Visualize e edite as escalas de trabalho mensais.</CardDescription>
            </div>
            
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="icon" onClick={handlePrevMonth}><ChevronLeft /></Button>
                    <span className="text-lg font-semibold w-40 text-center capitalize">{format(currentDate, 'MMMM yyyy', { locale: ptBR })}</span>
                    <Button variant="outline" size="icon" onClick={handleNextMonth}><ChevronRight /></Button>
                </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
                <Select value={selectedKiosk} onValueChange={setSelectedKiosk}>
                    <SelectTrigger className="w-full sm:w-[220px]">
                        <SelectValue placeholder="Filtrar por quiosque" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Todos os Quiosques</SelectItem>
                        {kiosksToDisplay.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
                    </SelectContent>
                </Select>
                 <Button variant="ghost" onClick={() => setSelectedKiosk('all')}>
                    <Eraser className="mr-2 h-4 w-4" />
                    Limpar
                </Button>
            </div>

             {canManageSchedule && (
                <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => setIsGenerateConfirmationOpen(true)}>
                        <Wand2 className="mr-2 h-4 w-4" /> Preenchimento padrão
                    </Button>
                    <Button variant="destructive" onClick={() => setIsClearConfirmationOpen(true)}>
                        <Trash2 className="mr-2 h-4 w-4" />
                        Limpar Mês
                    </Button>
                </div>
            )}
        </CardHeader>
        <CardContent>
            {loading ? (
                <Skeleton className="h-96 w-full" />
            ) : (
                <ScheduleTableView 
                    kiosks={filteredKiosks}
                    scheduleMap={scheduleMap}
                    dates={daysInMonth}
                    onEditDay={onEditDay}
                    canManage={canManageSchedule}
                    users={users}
                    workDayCounts={workDayCounts}
                    warnings={warnings}
                />
            )}
        </CardContent>
      </Card>
      
        {isClearConfirmationOpen && (
            <DeleteConfirmationDialog
                open={isClearConfirmationOpen}
                onOpenChange={setIsClearConfirmationOpen}
                onConfirm={handleClearMonthConfirm}
                title="Limpar a escala do mês?"
                description={`Esta ação irá apagar todos os agendamentos para ${format(currentDate, 'MMMM yyyy', { locale: ptBR })}. Esta ação não pode ser desfeita.`}
                confirmButtonText="Sim, limpar mês"
            />
        )}

        {isGenerateConfirmationOpen && (
            <DeleteConfirmationDialog
                open={isGenerateConfirmationOpen}
                onOpenChange={setIsGenerateConfirmationOpen}
                onConfirm={handleGenerateConfirm}
                title="Usar preenchimento padrão?"
                description="Esta ação irá preencher a escala do mês com base nos turnos padrão dos colaboradores. Os dados existentes serão sobrescritos. Deseja continuar?"
                confirmButtonText="Sim, Preencher Padrão"
                confirmButtonVariant="default"
            />
        )}
    </>
  );
}
