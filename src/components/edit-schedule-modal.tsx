"use client"

import { useEffect } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/hooks/use-auth';
import { useKiosks } from '@/hooks/use-kiosks';
import { useMonthlySchedule } from '@/hooks/use-monthly-schedule';
import { type DailySchedule } from '@/types';

type EditScheduleModalProps = {
  dayData: DailySchedule | null;
  onOpenChange: (open: boolean) => void;
  onSaveSuccess: (updatedDay: DailySchedule) => void;
};

const scheduleSchema = z.object({
  shifts: z.array(z.object({
    key: z.string(),
    value: z.string(),
  })),
});

type FormValues = z.infer<typeof scheduleSchema>;

export function EditScheduleModal({ dayData, onOpenChange, onSaveSuccess }: EditScheduleModalProps) {
  const { users } = useAuth();
  const { kiosks } = useKiosks();
  const { updateDailySchedule, loading } = useMonthlySchedule();
  
  const form = useForm<FormValues>({
    resolver: zodResolver(scheduleSchema),
    defaultValues: {
      shifts: [],
    },
  });

  const { fields, replace } = useFieldArray({
    control: form.control,
    name: "shifts",
  });

  useEffect(() => {
    if (dayData) {
      const initialShifts = kiosks
        .filter(k => k.id !== 'matriz')
        .flatMap(kiosk => ['T1', 'T2'].map(turn => ({
          key: `${kiosk.name} ${turn}`,
          value: dayData[`${kiosk.name} ${turn}`] || '',
        })));
      
      replace(initialShifts);
    }
  }, [dayData, kiosks, replace, form]);

  const onSubmit = async (values: FormValues) => {
    if (!dayData) return;
    
    const updates: Partial<DailySchedule> = {};
    values.shifts.forEach(shift => {
      updates[shift.key] = shift.value;
    });

    await updateDailySchedule(dayData.id, updates);
    onSaveSuccess(dayData);
    onOpenChange(false);
  };

  if (!dayData) return null;

  return (
    <Dialog open={!!dayData} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Editar Escala</DialogTitle>
          <DialogDescription>
            Alterando a escala para {format(new Date(dayData.id), "EEEE, dd 'de' MMMM", { locale: ptBR })}.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <ScrollArea className="h-96 pr-4">
              <div className="space-y-4">
                {fields.map((field, index) => (
                  <FormField
                    key={field.id}
                    control={form.control}
                    name={`shifts.${index}.value`}
                    render={({ field: controllerField }) => (
                      <FormItem>
                        <FormLabel>{field.key}</FormLabel>
                        <FormControl>
                          <Input placeholder="Nome do colaborador ou 'FOLGA'" {...controllerField} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ))}
              </div>
            </ScrollArea>
            <DialogFooter className="pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit" disabled={loading}>Salvar Alterações</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
