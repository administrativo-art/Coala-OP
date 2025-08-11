
"use client";

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import Papa from 'papaparse';
import { format, parse, startOfMonth, endOfMonth, eachDayOfInterval, getYear, getMonth, subMonths, endOfDay, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useMonthlySchedule } from '@/hooks/use-monthly-schedule';
import { useKiosks } from '@/hooks/use-kiosks';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { type DailySchedule, type Kiosk, type User, type AbsenceEntry } from '@/types';
import { Loader2, Upload, FileDown, AlertTriangle, Check, ChevronsUpDown } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { ScrollArea } from './ui/scroll-area';
import { ScheduleTableView } from './schedule-table';
import { cn } from '@/lib/utils';


const importSchema = z.object({
  month: z.string().min(1, 'Selecione o mês.'),
  year: z.string().min(4, 'Selecione o ano.'),
  file: z.any().refine(files => files?.length > 0, "Selecione um arquivo CSV."),
});

type ImportFormValues = z.infer<typeof importSchema>;

type ValidationResult = {
  isValid: boolean;
  errors: string[];
  data: DailySchedule[];
};

const lookupShift = (daySchedule: DailySchedule | undefined, kiosk: Kiosk, turn: 'T1' | 'T2' | 'T3' | 'Folga' | 'Ausencia'): string | AbsenceEntry[] => {
    if (!daySchedule) return turn === 'Ausencia' ? [] : '';
    const byId = daySchedule[`${kiosk.id} ${turn}`];
    if (byId !== undefined) return byId;
    const byName = daySchedule[`${kiosk.name} ${turn}`];
    if (byName !== undefined) return byName;
    return turn === 'Ausencia' ? [] : '';
};


export function ScheduleImportModal({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) {
  const { createFullMonthSchedule, fetchSchedule, previousMonthSchedule } = useMonthlySchedule();
  const { kiosks } = useKiosks();
  const { users } = useAuth();
  const { toast } = useToast();

  const [isLoading, setIsLoading] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);

  const form = useForm<ImportFormValues>({
    resolver: zodResolver(importSchema),
    defaultValues: {
        year: new Date().getFullYear().toString(),
        month: (new Date().getMonth() + 1).toString(),
    }
  });

  const handleDownloadTemplate = () => {
    const csvContent = "data:text/csv;charset=utf-8," 
        + "data,quiosque,turno,colaborador\n"
        + "01/08/2024,Quiosque Tirirical,T1,Edna\n"
        + "01/08/2024,Quiosque Tirirical,T1,Carliane\n"
        + "01/08/2024,Quiosque João Paulo,T2,Maria\n";
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "modelo_escala.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  
  const onSubmit = async (values: ImportFormValues) => {
    setIsLoading(true);
    setValidationResult(null);

    Papa.parse(values.file[0], {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const validation = validateCSV(results.data, values.month, values.year);
        setValidationResult(validation);
        setIsLoading(false);
      },
      error: (error) => {
        toast({
          variant: "destructive",
          title: "Erro ao ler o arquivo",
          description: error.message,
        });
        setIsLoading(false);
      }
    });
  };

  const validateCSV = (data: any[], month: string, year: string): ValidationResult => {
      const errors: string[] = [];
      const scheduleByDay: Record<string, Partial<DailySchedule>> = {};
      const kioskNameMap = new Map(kiosks.map(k => [k.name.toLowerCase(), k.id]));
      const userNameSet = new Set(users.map(u => u.username.toLowerCase()));

      data.forEach((row, index) => {
          const { data: dateStr, quiosque, turno, colaborador } = row;

          if (!dateStr || !quiosque || !turno || !colaborador) {
              errors.push(`Linha ${index + 2}: Todos os campos são obrigatórios.`);
              return;
          }

          const parsedDate = parse(dateStr, 'dd/MM/yyyy', new Date());
          if (isNaN(parsedDate.getTime())) {
              errors.push(`Linha ${index + 2}: Data '${dateStr}' em formato inválido. Use DD/MM/AAAA.`);
              return;
          }

          if (parsedDate.getMonth() + 1 !== parseInt(month) || parsedDate.getFullYear() !== parseInt(year)) {
              errors.push(`Linha ${index + 2}: A data '${dateStr}' não pertence ao mês/ano selecionado.`);
              return;
          }

          const kioskId = kioskNameMap.get(quiosque.toLowerCase());
          if (!kioskId) {
              errors.push(`Linha ${index + 2}: Quiosque '${quiosque}' não encontrado.`);
              return;
          }

          if (!['T1', 'T2', 'T3', 'Folga'].includes(turno)) {
              errors.push(`Linha ${index + 2}: Turno '${turno}' inválido. Use T1, T2, T3 ou Folga.`);
              return;
          }
          
          if (!userNameSet.has(colaborador.toLowerCase())) {
              errors.push(`Linha ${index + 2}: Colaborador '${colaborador}' não encontrado.`);
              return;
          }

          const dayISO = format(parsedDate, 'yyyy-MM-dd');
          if (!scheduleByDay[dayISO]) {
              scheduleByDay[dayISO] = {
                  id: dayISO,
                  diaDaSemana: format(parsedDate, 'EEEE', { locale: ptBR }),
              };
          }

          const key = `${kioskId} ${turno}`;
          if (scheduleByDay[dayISO][key]) {
              scheduleByDay[dayISO][key] += ` + ${colaborador}`;
          } else {
              scheduleByDay[dayISO][key] = colaborador;
          }
      });
      
      const importedDates = Object.values(scheduleByDay) as DailySchedule[];
      const fullMonthSchedule: DailySchedule[] = [];
      const monthDate = new Date(parseInt(year), parseInt(month) - 1);
      const daysInMonth = eachDayOfInterval({ start: startOfMonth(monthDate), end: endOfMonth(monthDate) });

      daysInMonth.forEach(day => {
          const dayISO = format(day, 'yyyy-MM-dd');
          const existingDay = importedDates.find(d => d.id === dayISO);
          if (existingDay) {
              fullMonthSchedule.push(existingDay);
          } else {
              fullMonthSchedule.push({
                  id: dayISO,
                  diaDaSemana: format(day, 'EEEE', { locale: ptBR }),
              });
          }
      });


      return {
          isValid: errors.length === 0,
          data: fullMonthSchedule,
      };
  };
  
  const handleConfirmImport = async () => {
    if (!validationResult || !validationResult.isValid) return;
    setIsLoading(true);
    
    const { month, year } = form.getValues();
    const scheduleToSave = validationResult.data.reduce((acc, day) => {
        acc[day.id] = day;
        return acc;
    }, {} as Record<string, DailySchedule>);
    
    try {
        await createFullMonthSchedule(scheduleToSave, parseInt(year, 10), parseInt(month, 10));
        await fetchSchedule(parseInt(year, 10), parseInt(month, 10));
        toast({ title: "Sucesso!", description: `A escala para ${month}/${year} foi importada.` });
        handleClose();
    } catch(e) {
        toast({ variant: 'destructive', title: "Erro ao salvar", description: "Não foi possível salvar a escala." });
    } finally {
        setIsLoading(false);
    }
  };

  const handleClose = () => {
    form.reset({ year: new Date().getFullYear().toString(), month: (new Date().getMonth() + 1).toString() });
    setValidationResult(null);
    onOpenChange(false);
  }

  const years = Array.from({ length: 5 }, (_, i) => (new Date().getFullYear() - 2 + i).toString());
  const months = Array.from({ length: 12 }, (_, i) => ({
    value: (i + 1).toString(),
    label: format(new Date(0, i), 'MMMM', { locale: ptBR }),
  }));

  const validationScheduleMap = useMemo(() => {
    const map = new Map<string, DailySchedule>();
    if (validationResult?.data) {
        validationResult.data.forEach(day => map.set(day.id, day));
    }
    return map;
  }, [validationResult]);

  const { workDayCounts, warnings, todaysWorkersMap } = useMemo(() => {
    const counts = new Map<string, number>();
    const warningsMap = new Map<string, { type: 'overwork' | 'conflict'; message: string }>();
    const dailyWorkers = new Map<string, Set<string>>();
    const { month, year } = form.getValues();
    
    if (!month || !year || !validationResult?.isValid) {
         return { workDayCounts: counts, warnings: warningsMap, todaysWorkersMap: dailyWorkers };
    }

    const monthDate = new Date(parseInt(year), parseInt(month) - 1);
    if (isNaN(monthDate.getTime())) {
        return { workDayCounts: counts, warnings: warningsMap, todaysWorkersMap: dailyWorkers };
    }

    const daysInMonth = eachDayOfInterval({ start: startOfMonth(monthDate), end: endOfMonth(monthDate) });
    const previousScheduleMap = new Map<string, DailySchedule>();
    previousMonthSchedule.forEach(daySchedule => {
        previousScheduleMap.set(daySchedule.id, daySchedule);
    });

    if (users.length === 0 || kiosks.length === 0) {
        return { workDayCounts: counts, warnings: warningsMap, todaysWorkersMap: dailyWorkers };
    }
    
    const initialCounts = new Map<string, number>();
    const lastDayOfPrevMonth = endOfMonth(subMonths(monthDate, 1));
    const lastDayISO = format(lastDayOfPrevMonth, 'yyyy-MM-dd');
    const lastDaySchedule = previousScheduleMap.get(lastDayISO);

    users.forEach(user => {
        let workedLastDay = false;
        if (lastDaySchedule) {
            kiosks.forEach(kiosk => {
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
        const daySchedule = validationScheduleMap.get(dayISO);
        const todaysAssignments = new Map<string, string>();
        const prevDayISO = format(subDays(day, 1), 'yyyy-MM-dd');
        
        const workersToday = new Set<string>();
        if (daySchedule) {
            kiosks.forEach(kiosk => {
                ['T1', 'T2', 'T3'].forEach(turn => {
                    const shiftWorkers = (lookupShift(daySchedule, kiosk, turn as any) as string || '').split(' + ').map(s => s.trim());
                    shiftWorkers.forEach(name => workersToday.add(name));
                });
            });
        }
        dailyWorkers.set(dayISO, workersToday);

        users.forEach(user => {
            let workedToday = false;
            let isOnFolga = false;

            if (daySchedule) {
                kiosks.forEach(kiosk => {
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

    return { workDayCounts: counts, warnings: warningsMap, todaysWorkersMap: dailyWorkers };
}, [validationScheduleMap, users, kiosks, form, previousMonthSchedule, validationResult]);


  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-6xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Importar Escala de Trabalho via CSV</DialogTitle>
          <DialogDescription>
            Selecione o mês, o ano e faça o upload de um arquivo CSV para preencher a escala.
          </DialogDescription>
        </DialogHeader>

        {!validationResult ? (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="month"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Mês</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione o mês" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {months.map(month => (
                            <SelectItem key={month.value} value={month.value}>
                              {month.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField control={form.control} name="year" render={({ field }) => (
                  <FormItem><FormLabel>Ano</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl><SelectContent>{years.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>
                )}/>
              </div>
              <FormField control={form.control} name="file" render={({ field }) => (
                <FormItem><FormLabel>Arquivo CSV</FormLabel><FormControl><Input type="file" accept=".csv" onChange={(e) => field.onChange(e.target.files)} /></FormControl><FormMessage /></FormItem>
              )}/>
               <Button type="button" variant="link" onClick={handleDownloadTemplate} className="p-0 h-auto">
                 <FileDown className="mr-2 h-4 w-4" /> Baixar modelo de preenchimento
               </Button>
               <DialogFooter>
                 <Button type="button" variant="outline" onClick={handleClose}>Cancelar</Button>
                 <Button type="submit" disabled={isLoading}>{isLoading ? <Loader2 className="animate-spin mr-2"/> : <Upload className="mr-2"/>}Validar arquivo</Button>
               </DialogFooter>
            </form>
          </Form>
        ) : (
          <div className="flex-1 overflow-hidden flex flex-col space-y-4">
            {validationResult.isValid ? (
              <>
                <Alert variant="default" className="bg-green-50 border-green-200 text-green-800 [&>svg]:text-green-600">
                    <AlertTitle>Validação Concluída com Sucesso!</AlertTitle>
                    <AlertDescription>{validationResult.data.length} dias da escala serão criados ou atualizados.</AlertDescription>
                </Alert>
                <div className="flex-1 overflow-auto">
                    <ScheduleTableView
                        kiosks={kiosks}
                        scheduleMap={validationScheduleMap}
                        dates={validationResult.data.map(d => parseISO(d.id))}
                        onEditDay={() => {}}
                        canManage={false}
                        users={users}
                        workDayCounts={workDayCounts}
                        warnings={warnings}
                        todaysWorkersMap={todaysWorkersMap}
                    />
                </div>
              </>
            ) : (
                <>
                <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Erros de Validação Encontrados</AlertTitle>
                    <AlertDescription>Corrija os seguintes erros no seu arquivo CSV e tente novamente.</AlertDescription>
                </Alert>
                <ScrollArea className="h-64">
                    <ul className="list-disc list-inside space-y-1 text-sm text-destructive">
                        {validationResult.errors.map((error, i) => <li key={i}>{error}</li>)}
                    </ul>
                </ScrollArea>
              </>
            )}
             <DialogFooter>
                <Button variant="outline" onClick={() => setValidationResult(null)}>Voltar</Button>
                {validationResult.isValid && (
                    <Button onClick={handleConfirmImport} disabled={isLoading}>{isLoading ? 'Importando...' : 'Confirmar e Importar'}</Button>
                )}
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
