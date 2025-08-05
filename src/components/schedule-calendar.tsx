
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
import { ChevronLeft, ChevronRight, Users, Wand2, Trash2, Eraser, AlertTriangle, Download, Filter } from 'lucide-react';
import { type DailySchedule, type User, type Kiosk, type AbsenceEntry } from '@/types';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { ScheduleTableView } from './schedule-table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { ScrollArea } from './ui/scroll-area';


const lookupShift = (daySchedule: DailySchedule | undefined, kiosk: Kiosk, turn: 'T1' | 'T2' | 'T3' | 'Folga' | 'Ausencia'): string | AbsenceEntry[] => {
    if (!daySchedule) return turn === 'Ausencia' ? [] : '';
    const byId = daySchedule[`${kiosk.id} ${turn}`];
    if (byId !== undefined) return byId;
    const byName = daySchedule[`${kiosk.name} ${turn}`];
    if (byName !== undefined) return byName;
    return turn === 'Ausencia' ? [] : '';
};

export function ScheduleCalendar({ onEditDay }: { onEditDay: (day: DailySchedule, kioskId: string) => void; }) {
  const { kiosks, loading: kiosksLoading } = useKiosks();
  const { schedule, loading: scheduleLoading, fetchSchedule, createFullMonthSchedule, previousMonthSchedule } = useMonthlySchedule();
  const { users, permissions } = useAuth();

  const [currentDate, setCurrentDate] = useState(new Date());
  const [isClearConfirmationOpen, setIsClearConfirmationOpen] = useState(false);
  const [isGenerateConfirmationOpen, setIsGenerateConfirmationOpen] = useState(false);
  const [selectedKiosks, setSelectedKiosks] = useState<string[]>([]);
  const [initialSelectionDone, setInitialSelectionDone] = useState(false);

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

  useEffect(() => {
    if (!initialSelectionDone && kiosksToDisplay.length > 0) {
      setSelectedKiosks(kiosksToDisplay.map(k => k.id));
      setInitialSelectionDone(true);
    }
  }, [kiosksToDisplay, initialSelectionDone]);
  
  const filteredKiosks = useMemo(() => {
    return kiosksToDisplay.filter(k => selectedKiosks.includes(k.id));
  }, [kiosksToDisplay, selectedKiosks]);

  const { workDayCounts, warnings } = useMemo(() => {
    const counts = new Map<string, number>();
    const warningsMap = new Map<string, { type: 'overwork' | 'conflict'; message: string }>();

    if (users.length === 0 || kiosksToDisplay.length === 0) {
      return { workDayCounts: counts, warnings: warningsMap };
    }
    
    const initialCounts = new Map<string, number>();
    const lastDayOfPrevMonth = endOfMonth(subMonths(new Date(getYear(currentDate), getMonth(currentDate)), 1));
    const lastDayISO = format(lastDayOfPrevMonth, 'yyyy-MM-dd');
    const lastDaySchedule = previousScheduleMap.get(lastDayISO);

    users.forEach(user => {
      let workedLastDay = false;
      if (lastDaySchedule) {
        kiosksToDisplay.forEach(kiosk => {
          ['T1', 'T2', 'T3'].forEach(turn => {
            const shiftWorkers = (lookupShift(lastDaySchedule, kiosk, turn as any) as string || '').split(' + ').map(s => s.trim());
            if (shiftWorkers.includes(user.username)) {
              workedLastDay = true;
            }
          });
        });
      }
      initialCounts.set(user.id, workedLastDay ? 1 : 0);
    });
    
    daysInMonth.forEach(day => {
      const dayISO = format(day, 'yyyy-MM-dd');
      const daySchedule = scheduleMap.get(dayISO);
      const todaysAssignments = new Map<string, string>();
      const prevDayISO = format(subDays(day, 1), 'yyyy-MM-dd');

      users.forEach(user => {
          let workedToday = false;
          let isOnFolga = false;

          if (daySchedule) {
            kiosksToDisplay.forEach(kiosk => {
                ['T1', 'T2', 'T3'].forEach(turn => {
                  const shiftWorkers = (lookupShift(daySchedule, kiosk, turn as any) as string || '').split(' + ').map(s => s.trim());
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
                 const folgaNames = (lookupShift(daySchedule, kiosk, 'Folga') as string || '').split(' + ').map(s => s.trim());
                 if (folgaNames.includes(user.username)) {
                    isOnFolga = true;
                }
            });
          }

          const yesterdayCount = counts.get(`${prevDayISO}-${user.id}`) || initialCounts.get(user.id) || 0;
          
          if (workedToday && !isOnFolga) {
            const newCount = yesterdayCount + 1;
            counts.set(`${dayISO}-${user.id}`, newCount);
            if (newCount > 6) {
                warningsMap.set(`${dayISO}-${user.id}`, { type: 'overwork', message: `Trabalhando há ${newCount} dias seguidos.` });
            }
          } else {
            counts.set(`${dayISO}-${user.id}`, 0);
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
    const newScheduleData: Record<string, DailySchedule> = {};
    const userWorkdayCounts = new Map<string, number>();

    const lastDayOfPrevMonth = endOfMonth(subMonths(currentDate, 1));
    const lastDayISO = format(lastDayOfPrevMonth, 'yyyy-MM-dd');
    const lastDaySchedule = previousScheduleMap.get(lastDayISO);
    
    users.forEach(user => {
        let workedLastDay = false;
        if(lastDaySchedule) {
            kiosksToDisplay.forEach(kiosk => {
                ['T1', 'T2', 'T3'].forEach(turn => {
                    const shiftWorkers = (lookupShift(lastDaySchedule, kiosk, turn as any) as string || '').split(' + ').map(s => s.trim());
                    if (shiftWorkers.includes(user.username)) {
                        workedLastDay = true;
                    }
                });
            });
        }
        userWorkdayCounts.set(user.id, workedLastDay ? 1 : 0);
    });


    daysInMonth.forEach(day => {
      const dayISO = format(day, 'yyyy-MM-dd');
      const newDaySchedule: DailySchedule = {
        id: dayISO,
        diaDaSemana: format(day, 'EEEE', { locale: ptBR }),
      };

      kiosksToDisplay.forEach(kiosk => {
        newDaySchedule[`${kiosk.id} T1`] = '';
        newDaySchedule[`${kiosk.id} T2`] = '';
        newDaySchedule[`${kiosk.id} T3`] = '';
        newDaySchedule[`${kiosk.id} Folga`] = '';
        newDaySchedule[`${kiosk.id} Ausencia`] = [];
      });
      
      const operationalUsers = users.filter(u => u.operacional && !u.folguista);
      
      operationalUsers.forEach(user => {
        const consecutiveDays = userWorkdayCounts.get(user.id) || 0;
        
        if (consecutiveDays >= 6) {
            const kioskId = user.assignedKioskIds[0] || kiosksToDisplay[0].id;
            const folgaKey = `${kioskId} Folga`;
            newDaySchedule[folgaKey] = newDaySchedule[folgaKey] ? `${newDaySchedule[folgaKey]} + ${user.username}` : user.username;
            userWorkdayCounts.set(user.id, 0);
        } else if (user.turno) {
            const kioskId = user.assignedKioskIds[0];
            if (kioskId) {
                const shiftKey = `${kioskId} ${user.turno}`;
                newDaySchedule[shiftKey] = newDaySchedule[shiftKey] ? `${newDaySchedule[shiftKey]} + ${user.username}` : user.username;
                userWorkdayCounts.set(user.id, consecutiveDays + 1);
            }
        }
      });
      newScheduleData[dayISO] = newDaySchedule;
    });

    await createFullMonthSchedule(newScheduleData);
    setIsGenerateConfirmationOpen(false);
  };
  
  const handleEditClick = (day: Date, kioskId: string) => {
    if (!canManageSchedule) return;
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
  
  const handleExportPdf = () => {
    const doc = new jsPDF('landscape');
    const monthYear = format(currentDate, 'MMMM yyyy', { locale: ptBR });
    doc.setFontSize(18);
    doc.text(`Escala de Trabalho - ${monthYear}`, 14, 22);

    const head = [['Dia', ...filteredKiosks.map(k => k.name)]];
    const body = daysInMonth.map(day => {
        const dayStr = format(day, 'dd/MM (EEE)', { locale: ptBR });
        const daySchedule = scheduleMap.get(format(day, 'yyyy-MM-dd'));
        const row = [dayStr];

        filteredKiosks.forEach(kiosk => {
            const t1 = lookupShift(daySchedule, kiosk, 'T1');
            const t2 = lookupShift(daySchedule, kiosk, 'T2');
            const t3 = lookupShift(daySchedule, kiosk, 'T3');
            const folga = lookupShift(daySchedule, kiosk, 'Folga');
            const ausencias = (lookupShift(daySchedule, kiosk, 'Ausencia') as AbsenceEntry[] || []);
            
            let cellText = '';
            if (t1) cellText += `T1: ${t1}\n`;
            if (t2) cellText += `T2: ${t2}\n`;
            if (t3) cellText += `T3: ${t3}\n`;
            if (folga) cellText += `F: ${folga}\n`;
            if (ausencias.length > 0) {
                cellText += `A: ${ausencias.map(a => users.find(u => u.id === a.userId)?.username).join(', ')}`;
            }
            row.push(cellText.trim());
        });
        return row;
    });

    autoTable(doc, {
        head,
        body,
        startY: 30,
        theme: 'grid',
        styles: { fontSize: 8 },
        headStyles: { fillColor: [63, 81, 181] }
    });

    doc.save(`escala_${format(currentDate, 'MM_yyyy')}.pdf`);
  };

  const handleKioskFilterChange = (kioskId: string, checked: boolean) => {
    setSelectedKiosks(current => {
        if (checked) {
            return [...current, kioskId];
        } else {
            return current.filter(id => id !== kioskId);
        }
    });
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

            <div className="flex flex-wrap gap-2">
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline">
                            <Filter className="mr-2 h-4 w-4" />
                            Filtrar Quiosques ({selectedKiosks.length})
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-56">
                        <DropdownMenuLabel>Exibir quiosques</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => setSelectedKiosks(kiosksToDisplay.map(k => k.id))}>Selecionar Todos</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setSelectedKiosks([])}>Limpar Seleção</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <ScrollArea className="h-48">
                        {kiosksToDisplay.map(kiosk => (
                            <DropdownMenuCheckboxItem
                                key={kiosk.id}
                                checked={selectedKiosks.includes(kiosk.id)}
                                onCheckedChange={(checked) => handleKioskFilterChange(kiosk.id, !!checked)}
                                onSelect={(e) => e.preventDefault()}
                            >
                                {kiosk.name}
                            </DropdownMenuCheckboxItem>
                        ))}
                        </ScrollArea>
                    </DropdownMenuContent>
                </DropdownMenu>

                {canManageSchedule && (
                  <>
                    <Button variant="outline" onClick={() => setIsGenerateConfirmationOpen(true)}>
                        <Wand2 className="mr-2 h-4 w-4" /> Preenchimento padrão
                    </Button>
                    <Button variant="destructive" onClick={() => setIsClearConfirmationOpen(true)}>
                        <Trash2 className="mr-2 h-4 w-4" />
                        Limpar Mês
                    </Button>
                  </>
                )}
                 <Button variant="outline" onClick={handleExportPdf}>
                    <Download className="mr-2 h-4 w-4" /> Exportar PDF
                </Button>
            </div>
        </CardHeader>
        <CardContent>
            {loading ? (
                <Skeleton className="h-96 w-full" />
            ) : (
                <ScheduleTableView 
                    kiosks={filteredKiosks}
                    scheduleMap={scheduleMap}
                    dates={daysInMonth}
                    onEditDay={handleEditClick}
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
