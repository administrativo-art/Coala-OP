"use client"

import React, { useState, useMemo, useEffect } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getYear, getMonth, addMonths, subMonths, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useKiosks } from '@/hooks/use-kiosks';
import { useMonthlySchedule } from '@/hooks/use-monthly-schedule';
import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronLeft, ChevronRight, Users, Bed, UserX, Trash2, Wand2, DollarSign, AlertTriangle, Eraser, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type DailySchedule, type User, type Kiosk } from '@/types';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface ScheduleCalendarProps {
    onEditDay: (day: DailySchedule, kioskId: string) => void;
}

const calculateConsecutiveWorkDays = (
    days: Date[],
    scheduleMap: Map<string, DailySchedule>,
    users: User[],
    kiosksToDisplay: Kiosk[],
    initialCounts: Map<string, number> = new Map()
) => {
    const counts = new Map<string, Map<string, number>>();
    const operationalUsers = users.filter(u => u.operacional);
    const employeeTrackers = new Map<string, number>(initialCounts);

    operationalUsers.forEach(u => {
        if (!employeeTrackers.has(u.username)) {
            employeeTrackers.set(u.username, 0);
        }
    });

    days.forEach(day => {
        const dayISO = format(day, 'yyyy-MM-dd');
        const daySchedule = scheduleMap.get(dayISO);
        const todaysWorkers = new Set<string>();
        const dayCounts = new Map<string, number>();

        if (daySchedule) {
            kiosksToDisplay.forEach(kiosk => {
                ['T1', 'T2', 'T3'].forEach(turn => {
                    const employeeNames = daySchedule[`${kiosk.name} ${turn}`];
                    if (employeeNames && typeof employeeNames === 'string') {
                        employeeNames.split(' + ').forEach(name => {
                            if (name.trim() && name.toLowerCase() !== 'folga') {
                                todaysWorkers.add(name.trim());
                            }
                        });
                    }
                });
            });
        }

        for (const employee of operationalUsers) {
            const employeeName = employee.username;
            if (todaysWorkers.has(employeeName)) {
                const newCount = (employeeTrackers.get(employeeName) || 0) + 1;
                employeeTrackers.set(employeeName, newCount);
            } else {
                employeeTrackers.set(employeeName, 0);
            }
            dayCounts.set(employeeName, employeeTrackers.get(employeeName) || 0);
        }
        counts.set(dayISO, dayCounts);
    });
    
    return counts;
};

const TransportationCostAnalysis = ({ scheduleMap, users, kiosksToDisplay }: { scheduleMap: Map<string, DailySchedule>, users: User[], kiosksToDisplay: Kiosk[] }) => {
    const costData = useMemo(() => {
        const workDays = new Map<string, number>();
        const operationalUsers = users.filter(u => u.operacional);

        operationalUsers.forEach(u => workDays.set(u.username, 0));

        for (const daySchedule of scheduleMap.values()) {
            kiosksToDisplay.forEach(kiosk => {
                ['T1', 'T2', 'T3'].forEach(turn => {
                    const employeeNames = daySchedule[`${kiosk.name} ${turn}`];
                    if (employeeNames && typeof employeeNames === 'string') {
                        employeeNames.split(' + ').forEach(name => {
                            const trimmedName = name.trim();
                            if (trimmedName && workDays.has(trimmedName)) {
                                workDays.set(trimmedName, (workDays.get(trimmedName) || 0) + 1);
                            }
                        });
                    }
                });
            });
        }
        
        return operationalUsers
            .map(user => {
                const daysWorked = workDays.get(user.username) || 0;
                const dailyCost = user.valeTransporte || 0;
                return {
                    id: user.id,
                    username: user.username,
                    daysWorked,
                    totalCost: daysWorked * dailyCost,
                };
            })
            .filter(item => item.daysWorked > 0)
            .sort((a, b) => a.username.localeCompare(b.username));

    }, [scheduleMap, users, kiosksToDisplay]);

    if (costData.length === 0) {
        return null;
    }

    return (
        <Card className="mt-6">
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><DollarSign /> Análise de Custo de Vale-Transporte</CardTitle>
                <CardDescription>Custo total de VT para os colaboradores na escala do mês atual.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Colaborador</TableHead>
                                <TableHead className="text-center">Dias Trabalhados</TableHead>
                                <TableHead className="text-right">Valor Total (VT)</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {costData.map(item => (
                                <TableRow key={item.id}>
                                    <TableCell className="font-medium">{item.username}</TableCell>
                                    <TableCell className="text-center">{item.daysWorked}</TableCell>
                                    <TableCell className="text-right">{item.totalCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    );
};


export function ScheduleCalendar({ onEditDay }: ScheduleCalendarProps) {
  const { kiosks, loading: kiosksLoading } = useKiosks();
  const { schedule, previousMonthSchedule, loading: scheduleLoading, fetchSchedule, createFullMonthSchedule } = useMonthlySchedule();
  const { users, permissions } = useAuth();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [isClearConfirmationOpen, setIsClearConfirmationOpen] = useState(false);
  const [isGenerateConfirmationOpen, setIsGenerateConfirmationOpen] = useState(false);
  const [selectedKiosk, setSelectedKiosk] = useState('all');
  const [selectedEmployee, setSelectedEmployee] = useState('all');

  const loading = kiosksLoading || scheduleLoading;
  const canManageSchedule = permissions.team.manage;

  const operationalUserMap = useMemo(() => {
    const map = new Map<string, boolean>();
    users.forEach(u => map.set(u.username, u.operacional));
    return map;
  }, [users]);

  const userColorMap = useMemo(() => {
    const map = new Map<string, string>();
    users.forEach(u => {
        if (u.color) {
            map.set(u.username, u.color);
        }
    });
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
  
  const filteredKiosks = useMemo(() => {
    if (selectedKiosk === 'all') {
        return kiosksToDisplay;
    }
    return kiosksToDisplay.filter(k => k.id === selectedKiosk);
  }, [kiosksToDisplay, selectedKiosk]);
  
  const operationalUsers = useMemo(() => {
    return users.filter(u => u.operacional);
  }, [users]);


  const workDayCounts = useMemo(() => {
    const operationalUsers = users.filter(u => u.operacional);
    
    // 1. Calculate final counts from previous month
    let initialCounts = new Map<string, number>();
    if (previousMonthSchedule.length > 0) {
        const sortedPrevMonthDays = previousMonthSchedule.map(s => parseISO(s.id)).sort((a,b) => a.getTime() - b.getTime());
        const prevMonthScheduleMap = new Map<string, DailySchedule>();
        previousMonthSchedule.forEach(day => prevMonthScheduleMap.set(day.id, day));
        
        const prevMonthCounts = calculateConsecutiveWorkDays(sortedPrevMonthDays, prevMonthScheduleMap, users, kiosksToDisplay);
        const lastDayISO = format(sortedPrevMonthDays[sortedPrevMonthDays.length - 1], 'yyyy-MM-dd');
        initialCounts = prevMonthCounts.get(lastDayISO) || new Map();
    } else {
        operationalUsers.forEach(u => initialCounts.set(u.username, 0));
    }
    
    // 2. Calculate current month counts using initial counts
    return calculateConsecutiveWorkDays(daysInMonth, scheduleMap, users, kiosksToDisplay, initialCounts);

  }, [daysInMonth, scheduleMap, users, kiosksToDisplay, previousMonthSchedule]);

  const folguistaUsernames = useMemo(() => {
    return new Set(users.filter(u => u.folguista).map(u => u.username));
  }, [users]);
  
  const duplicateFolguistaAssignments = useMemo(() => {
    const dailyDuplicates = new Map<string, Set<string>>();

    if (!scheduleMap.size || !folguistaUsernames.size || !kiosksToDisplay.length) {
      return dailyDuplicates;
    }

    daysInMonth.forEach(day => {
      const dayISO = format(day, 'yyyy-MM-dd');
      const daySchedule = scheduleMap.get(dayISO);
      if (!daySchedule) return;

      const todaysFolguistaAssignments = new Map<string, number>();

      kiosksToDisplay.forEach(kiosk => {
        ['T1', 'T2', 'T3'].forEach(turn => {
          const employeeNames = daySchedule[`${kiosk.name} ${turn}`];
          if (employeeNames && typeof employeeNames === 'string') {
            employeeNames.split(' + ').forEach(name => {
              const trimmedName = name.trim();
              if (folguistaUsernames.has(trimmedName)) {
                todaysFolguistaAssignments.set(trimmedName, (todaysFolguistaAssignments.get(trimmedName) || 0) + 1);
              }
            });
          }
        });
      });

      const duplicates = new Set<string>();
      todaysFolguistaAssignments.forEach((count, name) => {
        if (count > 1) {
          duplicates.add(name);
        }
      });

      if (duplicates.size > 0) {
        dailyDuplicates.set(dayISO, duplicates);
      }
    });

    return dailyDuplicates;
  }, [scheduleMap, daysInMonth, kiosksToDisplay, folguistaUsernames]);

  const handleEditClick = (day: Date, kioskId: string) => {
    if (!canManageSchedule) return;
    const dayISO = format(day, 'yyyy-MM-dd');
    const dayData = scheduleMap.get(dayISO);

    const dataToEdit: DailySchedule = dayData || {
        id: dayISO,
        diaDaSemana: format(day, 'EEEE', { locale: ptBR }),
        ...kiosksToDisplay.reduce((acc, kiosk) => {
            ['T1', 'T2', 'T3', 'Folga'].forEach(turn => {
                acc[`${kiosk.name} ${turn}`] = '';
            });
            return acc;
        }, {} as { [key: string]: any })
    };
    onEditDay(dataToEdit, kioskId);
  };
  
  const handleClearMonthConfirm = async () => {
    const emptyScheduleData: Record<string, any> = {};
    const kioskKeys = kiosksToDisplay.flatMap(kiosk => [`${kiosk.name} T1`, `${kiosk.name} T2`, `${kiosk.name} T3`, `${kiosk.name} Folga`]);

    daysInMonth.forEach(day => {
        const dayISO = format(day, 'yyyy-MM-dd');
        const emptyDay: Partial<DailySchedule> = {
            id: dayISO,
            diaDaSemana: format(day, 'EEEE', { locale: ptBR }),
        };
        kioskKeys.forEach(key => {
            emptyDay[key] = '';
        });
        emptyScheduleData[dayISO] = emptyDay;
    });
    
    await createFullMonthSchedule(emptyScheduleData);
    setIsClearConfirmationOpen(false);
  };

  const handleGenerateConfirm = async () => {
    const operationalStaff = users.filter(u => u.operacional && !u.folguista && u.turno);
    const kioskStaff: Record<string, { T1: string[], T2: string[] }> = {};
    kiosksToDisplay.forEach(kiosk => {
        kioskStaff[kiosk.id] = { T1: [], T2: [] };
    });

    operationalStaff.forEach(user => {
        user.assignedKioskIds.forEach(kioskId => {
            if (kioskStaff[kioskId] && user.turno) {
                kioskStaff[kioskId][user.turno].push(user.username);
            }
        });
    });

    const newScheduleData: Record<string, Partial<DailySchedule>> = {};

    daysInMonth.forEach(day => {
        const dayISO = format(day, 'yyyy-MM-dd');
        const dayOfWeek = day.getDay(); // 0 = Sunday

        const dailyAssignments: Partial<DailySchedule> = {
            id: dayISO,
            diaDaSemana: format(day, 'EEEE', { locale: ptBR }),
        };

        kiosksToDisplay.forEach(kiosk => {
            const staff = kioskStaff[kiosk.id];
            dailyAssignments[`${kiosk.name} T1`] = '';
            dailyAssignments[`${kiosk.name} T2`] = '';
            dailyAssignments[`${kiosk.name} T3`] = '';
            dailyAssignments[`${kiosk.name} Folga`] = '';
            
            if (dayOfWeek !== 0 && staff) {
                dailyAssignments[`${kiosk.name} T1`] = staff.T1.join(' + ');
                dailyAssignments[`${kiosk.name} T2`] = staff.T2.join(' + ');
            }
        });

        newScheduleData[dayISO] = dailyAssignments;
    });

    await createFullMonthSchedule(newScheduleData);
    setIsGenerateConfirmationOpen(false);
  };

  const handleExportPdf = () => {
    if (selectedKiosk === 'all' || !scheduleMap.size) {
        return;
    }

    const kiosk = kiosks.find(k => k.id === selectedKiosk);
    if (!kiosk) return;

    const doc = new jsPDF();
    const monthYear = format(currentDate, 'MMMM yyyy', { locale: ptBR });
    const title = `Escala de Trabalho - ${kiosk.name}`;

    doc.setFontSize(18);
    doc.text(title, 14, 22);
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(monthYear.charAt(0).toUpperCase() + monthYear.slice(1), 14, 29);

    const head = [['Data', 'Dia da Semana', 'Turno 1', 'Turno 2', 'Turno 3', 'Folga']];
    const body = daysInMonth.map(day => {
        const dayISO = format(day, 'yyyy-MM-dd');
        const daySchedule = scheduleMap.get(dayISO);
        const isSunday = day.getDay() === 0;
        
        const t1 = daySchedule?.[`${kiosk.name} T1`] || '';
        const t2 = !isSunday ? (daySchedule?.[`${kiosk.name} T2`] || '') : '';
        const t3 = !isSunday ? (daySchedule?.[`${kiosk.name} T3`] || '') : '';
        const folga = daySchedule?.[`${kiosk.name} Folga`] || '';

        return [
            format(day, 'dd/MM'),
            format(day, 'EEEE', { locale: ptBR }),
            t1,
            t2,
            t3,
            folga
        ];
    });

    autoTable(doc, {
        startY: 35,
        head: head,
        body: body,
        theme: 'grid',
        headStyles: { fillColor: '#3F51B5' },
    });
    
    doc.save(`escala_${kiosk.name.replace(/\s/g, '_')}_${format(currentDate, 'MM-yyyy')}.pdf`);
  };

  const renderEmployee = (name: string, count?: number, dayISO?: string, selectedEmployeeFilter?: string) => {
    if (!name || (selectedEmployeeFilter !== 'all' && name !== selectedEmployeeFilter && name.toLowerCase() !== 'folga')) {
      return null;
    }
  
    const userColor = userColorMap.get(name);
    const displayName = count ? `${name}.${count}` : name;
  
    const nameElement = (
      <span
        className={cn("rounded-sm px-1 py-0.5", !userColor && "px-0 py-0 bg-transparent")}
        style={userColor ? { backgroundColor: userColor } : {}}
      >
        {displayName}
      </span>
    );
  
    if (name.toLowerCase() === 'folga') {
      return <span className="truncate text-muted-foreground">{displayName}</span>;
    }
  
    const isFolguista = folguistaUsernames.has(name);
    const hasDuplicate = dayISO ? duplicateFolguistaAssignments.get(dayISO)?.has(name) : false;
    const isOperational = operationalUserMap.get(name);
  
    if (count && count > 6) {
      return (
        <TooltipProvider>
          <Tooltip delayDuration={100}>
            <TooltipTrigger asChild>
              <span className="truncate text-orange-500 font-bold flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                {nameElement}
              </span>
            </TooltipTrigger>
            <TooltipContent><p>Colaborador excedeu 6 dias de trabalho consecutivos.</p></TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }
  
    if (isFolguista && hasDuplicate) {
      return (
        <TooltipProvider>
          <Tooltip delayDuration={100}>
            <TooltipTrigger asChild>
              <span className="truncate text-destructive font-bold flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                {nameElement}
              </span>
            </TooltipTrigger>
            <TooltipContent><p>Folguista escalado em múltiplos quiosques neste dia.</p></TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }
  
    if (isOperational === false) {
      return (
        <TooltipProvider>
          <Tooltip delayDuration={100}>
            <TooltipTrigger asChild>
              <span className="truncate text-destructive flex items-center gap-1">
                <UserX className="h-3 w-3 shrink-0" />
                {nameElement}
              </span>
            </TooltipTrigger>
            <TooltipContent><p>{name} não é um colaborador operacional.</p></TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }
  
    return <span className="truncate">{nameElement}</span>;
  };

  return (
    <>
        <Card className="w-full">
        <CardHeader className="space-y-4">
            <div>
                <CardTitle className="flex items-center gap-2"><Users /> Escala de Trabalho</CardTitle>
                <CardDescription>Visualize e edite as escalas de trabalho mensais.</CardDescription>
            </div>
            
            <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" onClick={handlePrevMonth}><ChevronLeft /></Button>
                <span className="text-lg font-semibold w-40 text-center capitalize">{format(currentDate, 'MMMM yyyy', { locale: ptBR })}</span>
                <Button variant="outline" size="icon" onClick={handleNextMonth}><ChevronRight /></Button>
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
                <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
                    <SelectTrigger className="w-full sm:w-[220px]">
                        <SelectValue placeholder="Filtrar por colaborador" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Todos os Colaboradores</SelectItem>
                        {operationalUsers.map(u => <SelectItem key={u.id} value={u.username}>{u.username}</SelectItem>)}
                    </SelectContent>
                </Select>
                <Button variant="ghost" onClick={() => {
                    setSelectedKiosk('all');
                    setSelectedEmployee('all');
                }}>
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
            <div className="overflow-x-auto border rounded-lg">
                <div className="grid" style={{ gridTemplateColumns: `minmax(120px, 0.5fr) repeat(${filteredKiosks.length}, minmax(200px, 1fr))` }}>
                    {/* Headers */}
                    <div className="sticky top-0 left-0 z-30 bg-card border-r border-b font-semibold p-2 flex items-center">Dia</div>
                    {filteredKiosks.map((kiosk, kioskIndex) => (
                        <div key={kiosk.id} className={cn("sticky top-0 font-semibold p-2 text-center border-b z-20 bg-card", kioskIndex < filteredKiosks.length - 1 && "border-r")}>
                            {kiosk.name}
                        </div>
                    ))}

                    {/* Rows for each day */}
                    {daysInMonth.map((day, dayIndex) => (
                        <React.Fragment key={format(day, 'yyyy-MM-dd')}>
                            {/* Day Cell */}
                            <div className={cn(
                                "sticky left-0 z-20 border-r p-2 font-medium text-sm bg-card",
                                dayIndex < daysInMonth.length - 1 && "border-b",
                                (day.getDay() === 0 || day.getDay() === 6) && 'bg-muted/50'
                            )}>
                                <p className={cn("font-bold", day.getDay() === 0 && 'text-red-500')}>{format(day, 'd')}</p>
                                <p className="text-muted-foreground text-xs uppercase">{format(day, 'EEEE', { locale: ptBR })}</p>
                            </div>

                            {/* Kiosk cells for the day */}
                            {filteredKiosks.map((kiosk, kioskIndex) => {
                                const dayISO = format(day, 'yyyy-MM-dd');
                                const dayData = scheduleMap.get(dayISO);
                                const dayCounts = workDayCounts.get(dayISO);
                                const isSunday = day?.getDay() === 0;

                                const t1Employee = dayData?.[`${kiosk.name} T1`];
                                const t2Employee = dayData?.[`${kiosk.name} T2`];
                                const t3Employee = dayData?.[`${kiosk.name} T3`];
                                const folgaEmployee = dayData?.[`${kiosk.name} Folga`];
                                
                                const t1Count = t1Employee ? dayCounts?.get(t1Employee) : undefined;
                                const t2Count = t2Employee ? dayCounts?.get(t2Employee) : undefined;
                                const t3Count = t3Employee ? dayCounts?.get(t3Employee) : undefined;
                                
                                const baseBg = (day.getDay() === 0 || day.getDay() === 6) ? 'bg-muted/50' : 'bg-card';

                                return (
                                    <div 
                                        key={kiosk.id} 
                                        onClick={() => handleEditClick(day, kiosk.id)}
                                        className={cn(
                                            "p-1.5 h-full flex items-center justify-center group z-10",
                                            baseBg,
                                            dayIndex < daysInMonth.length - 1 && "border-b",
                                            kioskIndex < filteredKiosks.length - 1 && "border-r",
                                            canManageSchedule && "cursor-pointer hover:bg-muted"
                                        )}
                                    >
                                        {dayData ? (
                                            <div className="w-full h-full rounded-md p-2 border text-xs flex flex-col justify-center bg-background/50">
                                                {isSunday ? (
                                                     <div className="flex items-center gap-1.5">
                                                        <span className="font-bold text-purple-600">U:</span>
                                                        {renderEmployee(t1Employee, t1Count, dayISO, selectedEmployee)}
                                                    </div>
                                                ) : (
                                                    <>
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="font-bold text-sky-600">T1:</span>
                                                            {renderEmployee(t1Employee, t1Count, dayISO, selectedEmployee)}
                                                        </div>
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="font-bold text-amber-600">T2:</span>
                                                            {renderEmployee(t2Employee, t2Count, dayISO, selectedEmployee)}
                                                        </div>
                                                        {t3Employee && (
                                                            <div className="flex items-center gap-1.5">
                                                                <span className="font-bold text-emerald-600">T3:</span>
                                                                {renderEmployee(t3Employee, t3Count, dayISO, selectedEmployee)}
                                                            </div>
                                                        )}
                                                    </>
                                                )}
                                                {folgaEmployee && (
                                                    <div className="flex items-center gap-1.5 mt-1 border-t pt-1 border-dashed">
                                                        <span className="font-bold text-muted-foreground">F:</span>
                                                        {renderEmployee(folgaEmployee, undefined, dayISO, selectedEmployee)}
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            <div className="text-center text-muted-foreground text-xs space-y-1 p-2 rounded-md bg-muted/30 w-full h-full flex flex-col items-center justify-center">
                                                <Bed className="h-4 w-4"/>
                                                <span>Sem dados</span>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </React.Fragment>
                    ))}
                </div>
            </div>
            )}
        </CardContent>
        <CardFooter className="flex justify-end pt-4 border-t">
            <Button variant="outline" onClick={handleExportPdf} disabled={selectedKiosk === 'all'}>
                <Download className="mr-2 h-4 w-4" />
                Exportar Escala do Quiosque
            </Button>
        </CardFooter>
      </Card>

        <div className="mt-6">
            <TransportationCostAnalysis 
                scheduleMap={scheduleMap}
                users={users}
                kiosksToDisplay={filteredKiosks}
            />
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
    </>
  );
}
