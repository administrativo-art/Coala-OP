
"use client";

import { useMemo, useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChevronsUpDown, Loader2 } from 'lucide-react';
import { useKiosks } from '@/hooks/use-kiosks';
import { useAuth } from '@/hooks/use-auth';
import { useMonthlySchedule } from '@/hooks/use-monthly-schedule';
import { useToast } from '@/hooks/use-toast';

interface BulkEditScheduleModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedKeys: Set<string>;
  onConfirm: () => void;
}

const bulkEditSchema = z.object({
  turn: z.string().min(1, "Selecione um turno."),
  employeeNames: z.array(z.string()).min(1, 'Selecione pelo menos um colaborador.'),
  action: z.enum(['replace', 'add'], { required_error: "Selecione uma ação."}),
});

type FormValues = z.infer<typeof bulkEditSchema>;

export function BulkEditScheduleModal({ open, onOpenChange, selectedKeys, onConfirm }: BulkEditScheduleModalProps) {
  const { kiosks } = useKiosks();
  const { users } = useAuth();
  const { bulkUpdateSchedules, loading } = useMonthlySchedule();
  const { toast } = useToast();

  const form = useForm<FormValues>({
    resolver: zodResolver(bulkEditSchema),
    defaultValues: { turn: 'T1', employeeNames: [], action: 'replace' },
  });
  
  const { dayIds, kioskId } = useMemo(() => {
    const ids = new Set<string>();
    let kId = '';
    selectedKeys.forEach(key => {
        const [day, kiosk] = key.split('::');
        ids.add(day);
        if (!kId) kId = kiosk;
    });
    return { dayIds: Array.from(ids), kioskId: kId };
  }, [selectedKeys]);

  const kioskName = kiosks.find(k => k.id === kioskId)?.name || 'Quiosque';
  
  const availableEmployees = useMemo(() => {
    if (!users || !kioskId) return [];
    return users.filter(u => u.operacional && u.assignedKioskIds.includes(kioskId!));
  }, [users, kioskId]);


  const onSubmit = async (values: FormValues) => {
    try {
        await bulkUpdateSchedules(dayIds, kioskId, values.turn, values.employeeNames, values.action);
        toast({ title: "Sucesso!", description: "A escala foi atualizada para os dias selecionados." });
        onConfirm();
        onOpenChange(false);
    } catch (e) {
        toast({ variant: 'destructive', title: "Erro", description: "Não foi possível atualizar a escala." });
    }
  };

  if (!open) return null;
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar {selectedKeys.size} dias em lote para {kioskName}</DialogTitle>
          <DialogDescription>
            As alterações serão aplicadas a todos os dias selecionados.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                 <FormField control={form.control} name="turn" render={({ field }) => (
                    <FormItem><FormLabel>Turno a alterar</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl>
                            <SelectContent>
                                <SelectItem value="T1">Turno 1</SelectItem>
                                <SelectItem value="T2">Turno 2</SelectItem>
                                <SelectItem value="T3">Turno 3</SelectItem>
                                <SelectItem value="Folga">Folga</SelectItem>
                            </SelectContent>
                        </Select><FormMessage />
                    </FormItem>
                )}/>

                <FormField
                    control={form.control}
                    name="employeeNames"
                    render={({ field }) => (
                        <FormItem>
                        <FormLabel>Colaboradores</FormLabel>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                            <FormControl>
                                <Button variant="outline" className="w-full justify-between font-normal">
                                {field.value?.length > 0 ? field.value.join(', ') : "Selecione..."}
                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                            </FormControl>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
                            <DropdownMenuLabel>Colaboradores do Quiosque</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                                <ScrollArea className="h-48">
                                    {availableEmployees.map((emp) => (
                                    <DropdownMenuCheckboxItem
                                        key={emp.id}
                                        checked={field.value?.includes(emp.username)}
                                        onCheckedChange={(checked) => {
                                        const currentSelection = field.value || [];
                                        return checked
                                            ? field.onChange([...currentSelection, emp.username])
                                            : field.onChange(currentSelection.filter((name) => name !== emp.username));
                                        }}
                                        onSelect={(e) => e.preventDefault()}
                                    >
                                        {emp.username}
                                    </DropdownMenuCheckboxItem>
                                    ))}
                                </ScrollArea>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <FormMessage />
                        </FormItem>
                    )}
                />
                
                 <FormField
                    control={form.control}
                    name="action"
                    render={({ field }) => (
                        <FormItem className="space-y-3">
                        <FormLabel>Ação</FormLabel>
                        <FormControl>
                            <RadioGroup onValueChange={field.onChange} value={field.value} className="flex gap-4">
                                <FormItem className="flex items-center space-x-2"><FormControl><RadioGroupItem value="replace" /></FormControl><FormLabel className="font-normal">Substituir</FormLabel></FormItem>
                                <FormItem className="flex items-center space-x-2"><FormControl><RadioGroupItem value="add" /></FormControl><FormLabel className="font-normal">Adicionar</FormLabel></FormItem>
                            </RadioGroup>
                        </FormControl>
                        </FormItem>
                    )}
                />

                <DialogFooter className="pt-4">
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button type="submit" disabled={loading}>
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}
                        Aplicar Alterações
                    </Button>
                </DialogFooter>
            </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

