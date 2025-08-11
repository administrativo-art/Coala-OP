
"use client";

import React, { useState, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import Papa from 'papaparse';
import { format, parse } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useMonthlySchedule } from '@/hooks/use-monthly-schedule';
import { useKiosks } from '@/hooks/use-kiosks';
import { useUsers } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { type DailySchedule } from '@/types';
import { Loader2, Upload, FileDown, AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { ScrollArea } from './ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

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

export function ScheduleImportModal({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) {
  const { createFullMonthSchedule, fetchSchedule } = useMonthlySchedule();
  const { kiosks } = useKiosks();
  const { users } = useUsers();
  const { toast } = useToast();

  const [isLoading, setIsLoading] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);

  const form = useForm<ImportFormValues>({
    resolver: zodResolver(importSchema),
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
      
      return {
          isValid: errors.length === 0,
          errors,
          data: Object.values(scheduleByDay) as DailySchedule[],
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
        await createFullMonthSchedule(scheduleToSave);
        await fetchSchedule(parseInt(year), parseInt(month));
        toast({ title: "Sucesso!", description: `A escala para ${month}/${year} foi importada.` });
        onOpenChange(false);
    } catch(e) {
        toast({ variant: 'destructive', title: "Erro ao salvar", description: "Não foi possível salvar a escala." });
    } finally {
        setIsLoading(false);
    }
  };

  const handleClose = () => {
    form.reset();
    setValidationResult(null);
    onOpenChange(false);
  }

  const years = Array.from({ length: 5 }, (_, i) => (new Date().getFullYear() - 2 + i).toString());
  const months = Array.from({ length: 12 }, (_, i) => ({
    value: (i + 1).toString(),
    label: format(new Date(0, i), 'MMMM', { locale: ptBR }),
  }));

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl h-[90vh] flex flex-col">
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
                <FormField control={form.control} name="month" render={({ field }) => (
                  <FormItem><FormLabel>Mês</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl><SelectContent>{months.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>
                )}/>
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
                    <AlertDescription>{validationResult.data.length} dias da escala serão atualizados.</AlertDescription>
                </Alert>
                <ScrollArea className="flex-1">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Data</TableHead>
                                <TableHead>Quiosque</TableHead>
                                <TableHead>Turno</TableHead>
                                <TableHead>Colaborador(es)</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {validationResult.data.flatMap(day => 
                                Object.keys(day).filter(key => key.includes(' ')).map(key => {
                                    const [kioskId, turno] = key.split(' ');
                                    const kiosk = kiosks.find(k => k.id === kioskId);
                                    return (
                                        <TableRow key={`${day.id}-${key}`}>
                                            <TableCell>{format(parseISO(day.id), 'dd/MM/yyyy')}</TableCell>
                                            <TableCell>{kiosk?.name}</TableCell>
                                            <TableCell>{turno}</TableCell>
                                            <TableCell className="font-semibold">{day[key]}</TableCell>
                                        </TableRow>
                                    );
                                })
                            )}
                        </TableBody>
                    </Table>
                </ScrollArea>
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

// Helper hook
function useUsers() {
  const { users } = useAuth();
  return { users };
}
