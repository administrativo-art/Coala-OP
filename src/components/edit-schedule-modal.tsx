"use client"

import { useEffect, useMemo, useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useKiosks } from '@/hooks/use-kiosks';
import { useMonthlySchedule } from '@/hooks/use-monthly-schedule';
import { type DailySchedule, type User } from '@/types';
import { Switch } from './ui/switch';
import { Label } from './ui/label';
import { Separator } from './ui/separator';

type EditScheduleModalProps = {
  dayData: DailySchedule | null;
  kioskId: string | null;
  onOpenChange: (open: boolean) => void;
  users: User[];
};

const scheduleSchema = z.object({
  shifts: z.array(z.object({
    key: z.string(),
    value: z.string(),
  })),
  folga: z.string().optional(),
});

type FormValues = z.infer<typeof scheduleSchema>;

export function EditScheduleModal({ dayData, kioskId, onOpenChange, users }: EditScheduleModalProps) {
  const { kiosks } = useKiosks();
  const { updateDailySchedule, loading } = useMonthlySchedule();
  const [showThirdShift, setShowThirdShift] = useState(false);
  
  const form = useForm<FormValues>({
    resolver: zodResolver(scheduleSchema),
    defaultValues: {
      shifts: [],
      folga: '',
    },
  });

  const { fields, replace } = useFieldArray({
    control: form.control,
    name: "shifts",
  });
  
  const editingKiosk = useMemo(() => {
    if (!kioskId) return null;
    return kiosks.find(k => k.id === kioskId);
  }, [kioskId, kiosks]);

  const availableEmployees = useMemo(() => {
    if (!users || !kioskId) return [];
    return users.filter(u => u.operacional && u.assignedKioskIds.includes(kioskId!));
  }, [users, kioskId]);

  useEffect(() => {
    if (dayData && editingKiosk) {
      const hasT3Data = !!dayData[`${editingKiosk.name} T3`];
      setShowThirdShift(hasT3Data);

      const initialShifts = ['T1', 'T2', 'T3'].map(turn => ({
          key: `${editingKiosk.name} ${turn}`,
          value: dayData[`${editingKiosk.name} ${turn}`] || '',
      }));
      
      replace(initialShifts);
      form.setValue('folga', dayData[`${editingKiosk.name} Folga`] || '');
    }
  }, [dayData, editingKiosk, replace, form]);

  const onSubmit = async (values: FormValues) => {
    if (!dayData || !editingKiosk) return;
    
    const transformValue = (val: string) => (val === '_NONE_' ? '' : val);

    const isSunday = dayData.diaDaSemana.toLowerCase().includes('domingo');
    const updates: Partial<DailySchedule> = {};

    if (isSunday) {
        updates[`${editingKiosk.name} T1`] = transformValue(values.shifts[0].value);
        updates[`${editingKiosk.name} T2`] = ''; // Clear T2
        updates[`${editingKiosk.name} T3`] = ''; // Clear T3
    } else {
        values.shifts.forEach(shift => {
            updates[shift.key] = transformValue(shift.value);
        });
        if (!showThirdShift) {
            updates[`${editingKiosk.name} T3`] = '';
        }
    }
    
    updates[`${editingKiosk.name} Folga`] = transformValue(values.folga ?? ''); 

    await updateDailySchedule(dayData.id, updates);
    onOpenChange(false);
  };

  if (!dayData || !editingKiosk) return null;

  const isSunday = dayData.diaDaSemana.toLowerCase().includes('domingo');

  const renderSelect = (field: any) => (
    <Select onValueChange={field.onChange} value={field.value || ''}>
        <FormControl>
            <SelectTrigger>
                <SelectValue placeholder="Selecione..." />
            </SelectTrigger>
        </FormControl>
        <SelectContent>
            {availableEmployees.map(emp => (
                <SelectItem key={emp.id} value={emp.username}>{emp.username}</SelectItem>
            ))}
        </SelectContent>
    </Select>
  );

  return (
    <Dialog open={!!dayData} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Editar Escala - {editingKiosk.name}</DialogTitle>
          <DialogDescription>
            Alterando a escala para {format(new Date(dayData.id), "EEEE, dd 'de' MMMM", { locale: ptBR })}.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
            <div className="space-y-3 py-2">
              {isSunday ? (
                <FormField
                    control={form.control}
                    name={`shifts.0.value`} // Assumes T1 is at index 0
                    render={({ field }) => (
                        <FormItem>
                        <FormLabel>Turno Único</FormLabel>
                        {renderSelect(field)}
                        <FormMessage />
                        </FormItem>
                    )}
                />
              ) : (
                <>
                  {fields.map((field, index) => {
                    if (field.key.endsWith(' T3') && !showThirdShift) {
                        return null;
                    }
                    return (
                        <FormField
                        key={field.id}
                        control={form.control}
                        name={`shifts.${index}.value`}
                        render={({ field: controllerField }) => (
                            <FormItem>
                            <FormLabel>{
                                field.key.endsWith('T1') ? 'Turno 1' 
                                : field.key.endsWith('T2') ? 'Turno 2' 
                                : 'Turno 3'
                            }</FormLabel>
                            {renderSelect(controllerField)}
                            <FormMessage />
                            </FormItem>
                        )}
                        />
                    )
                  })}
                </>
              )}
            </div>

            {!isSunday && (
                <div className="flex items-center space-x-2">
                    <Switch id="third-shift-toggle" checked={showThirdShift} onCheckedChange={setShowThirdShift} />
                    <Label htmlFor="third-shift-toggle">Habilitar 3º turno</Label>
                </div>
            )}
            
            <Separator className="my-1" />
            
            <FormField
                control={form.control}
                name="folga"
                render={({ field }) => (
                    <FormItem>
                    <FormLabel>Folga</FormLabel>
                     <Select onValueChange={field.onChange} value={field.value || '_NONE_'}>
                        <FormControl>
                            <SelectTrigger>
                                <SelectValue placeholder="Selecione um colaborador..." />
                            </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                            <SelectItem value="_NONE_">Ninguém de folga</SelectItem>
                            {availableEmployees.map(emp => (
                                <SelectItem key={emp.id} value={emp.username}>{emp.username}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <FormMessage />
                    </FormItem>
                )}
            />

            <DialogFooter className="pt-3 border-t">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit" disabled={loading}>Salvar Alterações</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
