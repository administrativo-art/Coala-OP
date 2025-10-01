

"use client"

import React, { useState, useMemo, useEffect } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getYear, getMonth, addMonths, subMonths, parseISO, subDays, endOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useKiosks } from '@/hooks/use-kiosks';
import { useMonthlySchedule } from '@/hooks/use-monthly-schedule';
import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronLeft, ChevronRight, Users, Wand2, Trash2, Eraser, AlertTriangle, Download, Filter, DollarSign, Upload, Edit, Square, User as UserIcon } from 'lucide-react';
import { type DailySchedule, type User, type Kiosk, type AbsenceEntry } from '@/types';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { ScheduleTableView } from './schedule-table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { ScrollArea } from './ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion';
import { ScheduleImportModal } from './schedule-import-modal';
import { BulkEditScheduleModal } from './bulk-edit-schedule-modal';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';


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
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isBulkEditModalOpen, setIsBulkEditModalOpen] = useState(false);
  const [selectedKiosks, setSelectedKiosks] = useState<string[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<string>('all');
  const [initialSelectionDone, setInitialSelectionDone] = useState(false);
  const [selectedDays, setSelectedDays] = useState<Set<string>>(new Set());

  const loading = kiosksLoading || scheduleLoading;
  const canManageSchedule = permissions.team.manage;

  useEffect(() => {
    fetchSchedule(getYear(currentDate), getMonth(currentDate) + 1);
  }, [currentDate, fetchSchedule]);

  useEffect(() => {
    setSelectedDays(new Set());
  }, [currentDate, selectedKiosks]);

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

  const { workDayCounts, warnings, todaysWorkersMap } = useMemo(() => {
    const counts = new Map<string, number>();
    const warningsMap = new Map<string, { type: 'overwork' | 'conflict'; message: string }>();
    const dailyWorkers = new Map<string, Set<string>>();

    if (users.length === 0 || kiosksToDisplay.length === 0) {
      return { workDayCounts: counts, warnings: warningsMap, todaysWorkersMap: dailyWorkers };
    }
    
    const prevMonthStartDate = startOfMonth(subMonths(currentDate, 1));
    const prevMonthEndDate = endOfMonth(subMonths(currentDate, 1));
    const prevMonthDays = eachDayOfInterval({ start: prevMonthStartDate, end: prevMonthEndDate });

    const initialCounts = new Map<string, number>();

    users.forEach(user => {
      let consecutiveDays = 0;
      for (let i = prevMonthDays.length - 1; i >= 0; i--) {
        const day = prevMonthDays[i];
        const dayISO = format(day, 'yyyy-MM-dd');
        const daySchedule = previousScheduleMap.get(dayISO);
        let workedThisDay = false;
        if (daySchedule) {
          kiosksToDisplay.forEach(kiosk => {
            ['T1', 'T2', 'T3'].forEach(turn => {
              const shiftWorkers = (lookupShift(daySchedule, kiosk, turn as any) as string || '').split(' + ').map(s => s.trim());
              if (shiftWorkers.includes(user.username)) {
                workedThisDay = true;
              }
            });
          });
        }
        if (workedThisDay) {
          consecutiveDays++;
        } else {
          break; // Streak broken
        }
      }
      initialCounts.set(user.id, consecutiveDays);
    });

    daysInMonth.forEach(day => {
        const dayISO = format(day, 'yyyy-MM-dd');
        const daySchedule = scheduleMap.get(dayISO);
        const todaysAssignments = new Map<string, string>();
        const workersToday = new Set<string>();
      
        if (daySchedule) {
            kiosksToDisplay.forEach(kiosk => {
                ['T1', 'T2', 'T3'].forEach(turn => {
                    const shiftWorkers = (lookupShift(daySchedule, kiosk, turn as any) as string || '').split(' + ').map(s => s.trim());
                    shiftWorkers.forEach(name => workersToday.add(name));
                });
            });
        }
        dailyWorkers.set(dayISO, workersToday);

        users.forEach(user => {
            let workedToday = false;
            let isAusente = false;

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
                    const ausencias = lookupShift(daySchedule, kiosk, 'Ausencia') as AbsenceEntry[] || [];
                    if (ausencias.some(a => a.userId === user.id)) {
                        isAusente = true;
                    }
                });
            }

            let yesterdayCount = 0;
            if (day.getDate() === 1) {
                yesterdayCount = initialCounts.get(user.id) || 0;
            } else {
                const prevDayISO = format(subDays(day, 1), 'yyyy-MM-dd');
                yesterdayCount = counts.get(`${prevDayISO}-${user.id}`) || 0;
            }

            if (workedToday && !isAusente) {
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

    return { workDayCounts: counts, warnings: warningsMap, todaysWorkersMap: dailyWorkers };
  }, [scheduleMap, previousScheduleMap, daysInMonth, users, kiosksToDisplay, currentDate]);
  
   const valeTransporteData = useMemo(() => {
    const dailyWorkers = Array.from(todaysWorkersMap.values());
    const workedDaysByUser = new Map<string, number>();

    dailyWorkers.forEach(daySet => {
        daySet.forEach(username => {
            workedDaysByUser.set(username, (workedDaysByUser.get(username) || 0) + 1);
        });
    });

    let totalCost = 0;
    const userCosts = users
        .map(user => {
            const workedDays = workedDaysByUser.get(user.username) || 0;
            const dailyValue = user.valeTransporte || 0;
            const userTotal = workedDays * dailyValue;
            totalCost += userTotal;
            return {
                username: user.username,
                workedDays,
                dailyValue,
                total: userTotal
            };
        })
        .filter(item => item.workedDays > 0);

    return { totalCost, userCosts };
  }, [todaysWorkersMap, users]);

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
    
    await createFullMonthSchedule(emptyScheduleData, getYear(currentDate), getMonth(currentDate) + 1);
    setIsClearConfirmationOpen(false);
  };

  const handleGenerateConfirm = async () => {
    const newScheduleData: Record<string, DailySchedule> = {};
    const userWorkdayCounts = new Map<string, number>();

    const prevMonthStartDate = startOfMonth(subMonths(currentDate, 1));
    const prevMonthEndDate = endOfMonth(subMonths(currentDate, 1));
    const prevMonthDays = eachDayOfInterval({ start: prevMonthStartDate, end: prevMonthEndDate });

    // Calculate the exact ending streak for each user from the previous month
    users.forEach(user => {
        let consecutiveDays = 0;
        for (let i = prevMonthDays.length - 1; i >= 0; i--) {
            const day = prevMonthDays[i];
            const dayISO = format(day, 'yyyy-MM-dd');
            const daySchedule = previousScheduleMap.get(dayISO);
            let workedThisDay = false;
            if (daySchedule) {
                for (const kiosk of kiosksToDisplay) {
                    for (const turn of ['T1', 'T2', 'T3']) {
                        const shiftWorkers = (lookupShift(daySchedule, kiosk, turn as any) as string || '').split(' + ').map(s => s.trim());
                        if (shiftWorkers.includes(user.username)) {
                            workedThisDay = true;
                            break;
                        }
                    }
                    if (workedThisDay) break;
                }
            }
            if (workedThisDay) {
                consecutiveDays++;
            } else {
                break; // Streak is broken
            }
        }
        userWorkdayCounts.set(user.id, consecutiveDays);
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
            userWorkdayCounts.set(user.id, 0); // Reset count after a day off
        } else if (user.turno) {
            const kioskId = user.assignedKioskIds[0];
            if (kioskId) {
                const shiftKey = `${kioskId} ${user.turno}`;
                newDaySchedule[shiftKey] = newDaySchedule[shiftKey] ? `${newDaySchedule[shiftKey]} + ${user.username}` : user.username;
                userWorkdayCounts.set(user.id, consecutiveDays + 1); // Increment count
            }
        }
      });
      newScheduleData[dayISO] = newDaySchedule;
    });

    await createFullMonthSchedule(newScheduleData, getYear(currentDate), getMonth(currentDate) + 1);
    setIsGenerateConfirmationOpen(false);
  };
  
  const handleDayClick = (day: Date, kioskId: string) => {
    if (!canManageSchedule) return;
    const dayISO = format(day, 'yyyy-MM-dd');
    const selectionKey = `${dayISO}::${kioskId}`;
    
    setSelectedDays(prev => {
        const newSet = new Set(prev);
        if (newSet.has(selectionKey)) {
            newSet.delete(selectionKey);
        } else {
            newSet.add(selectionKey);
        }
        return newSet;
    });
  };

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
      <div className="space-y-6">
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

                <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
                  <SelectTrigger className="w-full sm:w-[220px]">
                      <UserIcon className="mr-2 h-4 w-4" />
                      <SelectValue placeholder="Filtrar por colaborador..." />
                  </SelectTrigger>
                  <SelectContent>
                      <SelectItem value="all">Todos os colaboradores</SelectItem>
                      {users.filter(u => u.operacional).map(user => (
                          <SelectItem key={user.id} value={user.id}>{user.username}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>

                {canManageSchedule && (
                  <>
                    {selectedDays.size > 0 && (
                        <Button onClick={() => setIsBulkEditModalOpen(true)}>
                            <Edit className="mr-2 h-4 w-4" /> Editar em Lote ({selectedDays.size})
                        </Button>
                    )}
                    <Button variant="outline" onClick={() => setIsGenerateConfirmationOpen(true)}>
                        <Wand2 className="mr-2 h-4 w-4" /> Preenchimento padrão
                    </Button>
                     <Button variant="outline" onClick={() => setIsImportModalOpen(true)}>
                        <Upload className="mr-2 h-4 w-4" /> Importar Escala via CSV
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
                    onDayClick={canManageSchedule ? handleDayClick : undefined}
                    selectedDays={selectedDays}
                    canManage={canManageSchedule}
                    users={users}
                    workDayCounts={workDayCounts}
                    warnings={warnings}
                    todaysWorkersMap={todaysWorkersMap}
                    selectedEmployee={selectedEmployee}
                />
            )}
        </CardContent>
      </Card>
      
        {valeTransporteData.totalCost > 0 && (
           <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><DollarSign /> Custo com Vale-Transporte</CardTitle>
                    <CardDescription>Custo total estimado para o mês de {format(currentDate, 'MMMM', { locale: ptBR })}.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex justify-between items-center bg-muted p-4 rounded-lg">
                        <span className="font-semibold">Total mensal</span>
                        <span className="text-2xl font-bold text-primary">{valeTransporteData.totalCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                    </div>
                     <Accordion type="single" collapsible className="w-full mt-2">
                        <AccordionItem value="details" className="border-none">
                            <AccordionTrigger className="text-sm p-2 hover:no-underline">Ver detalhes por colaborador</AccordionTrigger>
                            <AccordionContent>
                                <div className="space-y-2 p-2 border rounded-lg">
                                    {valeTransporteData.userCosts.map(item => (
                                        <div key={item.username} className="flex justify-between items-center text-sm">
                                            <span>{item.username} ({item.workedDays} dias)</span>
                                            <span className="font-medium">{item.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                                        </div>
                                    ))}
                                </div>
                            </AccordionContent>
                        </AccordionItem>
                    </Accordion>
                </CardContent>
           </Card>
        )}
      </div>

      
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

        <ScheduleImportModal
            open={isImportModalOpen}
            onOpenChange={setIsImportModalOpen}
        />
        <BulkEditScheduleModal
            open={isBulkEditModalOpen}
            onOpenChange={setIsBulkEditModalOpen}
            selectedKeys={selectedDays}
            onConfirm={() => {
                // Invalidate and refetch data
                fetchSchedule(getYear(currentDate), getMonth(currentDate) + 1);
                setSelectedDays(new Set());
            }}
        />
    </>
  );
}
