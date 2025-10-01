
"use client"

import { useEffect, useMemo, useState } from 'react';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
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
import { type DailySchedule, type User, absenceReasons, type AbsenceReason, type Kiosk, type AbsenceEntry } from '@/types';
import { Switch } from './ui/switch';
import { Label } from './ui/label';
import { Separator } from './ui/separator';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuGroup } from "@/components/ui/dropdown-menu";
import { ChevronsUpDown, PlusCircle, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import { ScrollArea } from './ui/scroll-area';
import { Textarea } from './ui/textarea';

type EditScheduleModalProps = {
  dayData: DailySchedule | null;
  kioskId: string | null;
  onOpenChange: (open: boolean) => void;
  users: User[];
};

const absenceSchema = z.object({
  userId: z.string().min(1, "Selecione um colaborador."),
  reason: z.enum(absenceReasons, { required_error: 'Selecione um motivo.'}),
  notes: z.string().optional(),
});

const scheduleSchema = z.object({
  shifts: z.array(z.object({
    key: z.string(),
    value: z.array(z.string()),
  })),
  folga: z.array(z.string()),
  ausencias: z.array(absenceSchema).optional(),
});

type FormValues = z.infer<typeof scheduleSchema>;

const lookupShift = (daySchedule: DailySchedule | undefined, kiosk: Kiosk, turn: 'T1' | 'T2' | 'T3' | 'Folga' | 'Ausencia'): string | AbsenceEntry[] => {
    if (!daySchedule) return turn === 'Ausencia' ? [] : '';
    const byId   = daySchedule[`${kiosk.id} ${turn}`];
    const byName = daySchedule[`${kiosk.name} ${turn}`];
    
    const result = byId ?? byName;
    if (result !== undefined) {
        return result;
    }

    return turn === 'Ausencia' ? [] : '';
};

function ConflictResolutionModal({ conflicts, onResolve, onCancel }: { conflicts: any[], onResolve: () => void, onCancel: () => void }) {
    return (
        <Dialog open={true} onOpenChange={onCancel}>
            <DialogContent className="max-w-xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2"><AlertTriangle className="text-destructive"/> Conflitos de Folga e Turno</DialogTitle>
                    <DialogDescription>
                        Os colaboradores abaixo estão em folga manual e também escalados para trabalhar no mesmo dia. A folga manual será removida para manter a consistência.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4">
                    <ScrollArea className="h-48">
                        <div className="space-y-2 pr-4">
                            {conflicts.map((c, i) => (
                                <div key={i} className="p-3 border rounded-lg bg-muted/50">
                                    <p className="font-semibold">{c.name}</p>
                                    <p className="text-sm">Folga manual em: <span className="font-medium text-muted-foreground">{c.folgaEm.join(', ')}</span></p>
                                    <p className="text-sm">Trabalha em: <span className="font-medium text-muted-foreground">{c.trabalhaEm.join(', ')}</span></p>
                                </div>
                            ))}
                        </div>
                    </ScrollArea>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onCancel}>Cancelar</Button>
                    <Button onClick={onResolve}>Corrigir e Salvar</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export function EditScheduleModal({ dayData, kioskId, onOpenChange, users }: EditScheduleModalProps) {
  const { kiosks } = useKiosks();
  const { schedule, updateDailySchedule, loading } = useMonthlySchedule();
  const [showThirdShift, setShowThirdShift] = useState(false);
  const [conflicts, setConflicts] = useState<any[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const form = useForm<FormValues>({
    resolver: zodResolver(scheduleSchema),
    defaultValues: {
      shifts: [],
      folga: [],
      ausencias: [],
    },
  });

  const { fields, replace } = useFieldArray({
    control: form.control,
    name: "shifts",
  });
  
  const { fields: absenceFields, append: appendAbsence, remove: removeAbsence } = useFieldArray({
    control: form.control,
    name: "ausencias",
  });
  
  const editingKiosk = useMemo(() => {
    if (!kioskId) return null;
    return kiosks.find(k => k.id === kioskId);
  }, [kioskId, kiosks]);

  const { kioskEmployees, otherEmployees } = useMemo(() => {
    if (!users || !kioskId) return { kioskEmployees: [], otherEmployees: [] };
    const kioskEmp = users.filter(u => u.operacional && u.assignedKioskIds.includes(kioskId!));
    const otherEmp = users.filter(u => u.operacional && !u.assignedKioskIds.includes(kioskId!));
    return { kioskEmployees: kioskEmp, otherEmployees: otherEmp };
  }, [users, kioskId]);


  useEffect(() => {
    if (dayData && editingKiosk) {
      const hasT3Data = !!lookupShift(dayData, editingKiosk, 'T3');
      setShowThirdShift(hasT3Data);
      
      const parseValue = (val: string | undefined): string[] => val ? val.split(' + ').filter(Boolean) : [];

      const initialShifts = ['T1', 'T2', 'T3'].map(turn => ({
          key: `${editingKiosk.id} ${turn}`,
          value: parseValue(lookupShift(dayData, editingKiosk, turn as any) as string),
      }));
      
      const folgaValue = lookupShift(dayData, editingKiosk, 'Folga') as string || '';
      const folgaArray = folgaValue ? folgaValue.split(' + ').filter(Boolean) : [];
      
      const ausenciasValue = lookupShift(dayData, editingKiosk, 'Ausencia') as AbsenceEntry[] || [];

      replace(initialShifts);
      form.setValue('folga', folgaArray);
      form.setValue('ausencias', ausenciasValue);

    }
  }, [dayData, editingKiosk, replace, form]);

  const performSave = async (values: FormValues) => {
    if (!dayData || !editingKiosk) return;
    setIsProcessing(true);

    const updates: Partial<DailySchedule> = {};
    const isSunday = dayData.diaDaSemana.toLowerCase().includes('domingo');

    if (isSunday) {
        updates[`${editingKiosk.id} T1`] = values.shifts[0].value.join(' + ');
        updates[`${editingKiosk.id} T2`] = '';
        updates[`${editingKiosk.id} T3`] = '';
    } else {
        values.shifts.forEach(shift => {
            updates[shift.key] = shift.value.join(' + ');
        });
        if (!showThirdShift) {
            updates[`${editingKiosk.id} T3`] = '';
        }
    }
    
    // Auto-remove employees from "Folga" if they are in a working shift
    const workingEmployeesToday = new Set<string>();
    values.shifts.forEach(shift => {
        shift.value.forEach(name => workingEmployeesToday.add(name));
    });
    
    const finalFolga = values.folga.filter(name => !workingEmployeesToday.has(name));

    updates[`${editingKiosk.id} Folga`] = finalFolga.join(' + '); 
    updates[`${editingKiosk.id} Ausencia`] = values.ausencias;

    await updateDailySchedule(dayData.id, updates);
    setIsProcessing(false);
    onOpenChange(false);
    setConflicts([]);
  };

  const onSubmit = async (values: FormValues) => {
    if (!dayData) return;

    const dayScheduleInContext = schedule.find(d => d.id === dayData.id);
    if (!dayScheduleInContext) {
        performSave(values); // No context to check against, save directly
        return;
    }
    
    // Simulate the state after this edit
    const simulatedDaySchedule = { ...dayScheduleInContext, [`${editingKiosk!.id} Folga`]: values.folga.join(' + ') };
    ['T1', 'T2', 'T3'].forEach((turn, index) => {
        simulatedDaySchedule[`${editingKiosk!.id} ${turn}`] = values.shifts[index].value.join(' + ');
    });


    // --- Conflict Detection Logic ---
    const workingToday = new Set<string>();
    kiosks.forEach(kiosk => {
        ['T1', 'T2', 'T3'].forEach(turn => {
            const shiftValue = lookupShift(simulatedDaySchedule as DailySchedule, kiosk, turn as any) as string;
            if (shiftValue) {
                shiftValue.split(' + ').forEach(name => workingToday.add(name.trim()));
            }
        });
    });

    const foundConflicts: any[] = [];
    workingToday.forEach(name => {
        const folgaEm = [];
        const trabalhaEm = [];

        for (const kiosk of kiosks) {
            const manualFolgas = (lookupShift(simulatedDaySchedule as DailySchedule, kiosk, 'Folga') as string || '').split(' + ').map(n => n.trim());
            if (manualFolgas.includes(name)) {
                folgaEm.push(kiosk.name);
            }
             ['T1', 'T2', 'T3'].forEach(turn => {
                const shiftWorkers = (lookupShift(simulatedDaySchedule as DailySchedule, kiosk, turn as any) as string || '').split(' + ').map(n => n.trim());
                if (shiftWorkers.includes(name)) {
                    trabalhaEm.push(`${kiosk.name} (${turn})`);
                }
            });
        }
        
        if (folgaEm.length > 0) {
            foundConflicts.push({ name, folgaEm, trabalhaEm });
        }
    });

    if (foundConflicts.length > 0) {
      setConflicts(foundConflicts);
    } else {
      performSave(values);
    }
  };

  if (!dayData || !editingKiosk) return null;

  const isSunday = dayData.diaDaSemana.toLowerCase().includes('domingo');

  const renderMultiSelect = (field: any, placeholder: string) => (
    <DropdownMenu>
        <DropdownMenuTrigger asChild>
            <FormControl>
                <Button variant="outline" className="w-full justify-between font-normal">
                    {field.value?.length > 0 ? field.value.join(', ') : placeholder}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </FormControl>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
            <ScrollArea className="h-60">
                <DropdownMenuGroup>
                    <DropdownMenuLabel>Colaboradores do quiosque</DropdownMenuLabel>
                    {kioskEmployees.map((emp) => (
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
                </DropdownMenuGroup>
                {otherEmployees.length > 0 && (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                             <DropdownMenuLabel>Outros colaboradores</DropdownMenuLabel>
                            {otherEmployees.map((emp) => (
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
                        </DropdownMenuGroup>
                    </>
                )}
            </ScrollArea>
        </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <>
    <Dialog open={!!dayData && conflicts.length === 0} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editar escala - {editingKiosk.name}</DialogTitle>
          <DialogDescription>
            Alterando a escala para {format(new Date(dayData.id), "EEEE, dd 'de' MMMM", { locale: ptBR })}.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <ScrollArea className="h-[60vh] pr-4 -mr-4">
            <div className="space-y-4">
            <h4 className="font-medium text-muted-foreground">Turnos</h4>
            <div className="space-y-3 py-2">
              {isSunday ? (
                <FormField
                    control={form.control}
                    name={`shifts.0.value`}
                    render={({ field }) => (
                        <FormItem>
                        <FormLabel>Turno único</FormLabel>
                        {renderMultiSelect(field, "Selecione...")}
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
                            {renderMultiSelect(controllerField, "Selecione...")}
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
            
             <Controller
                control={form.control}
                name="folga"
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>Folga</FormLabel>
                        {renderMultiSelect(field, "Ninguém de folga")}
                        <FormMessage />
                    </FormItem>
                )}
            />

            <Separator className="my-1" />
            
            <div>
              <Label>Ausências</Label>
              <div className="space-y-2 mt-2">
                {absenceFields.map((field, index) => (
                  <div key={field.id} className="p-3 border rounded-lg space-y-2">
                    <div className="flex justify-end">
                      <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeAbsence(index)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <FormField control={form.control} name={`ausencias.${index}.userId`} render={({ field }) => (
                        <FormItem>
                          <FormLabel>Colaborador</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
                            <SelectContent>{users.filter(u => u.operacional).map(u => <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>)}</SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                    )}/>
                     <FormField control={form.control} name={`ausencias.${index}.reason`} render={({ field }) => (
                        <FormItem>
                          <FormLabel>Motivo</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
                            <SelectContent>{absenceReasons.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                    )}/>
                     <FormField control={form.control} name={`ausencias.${index}.notes`} render={({ field }) => (
                        <FormItem>
                          <FormLabel>Observações (opcional)</FormLabel>
                          <FormControl><Textarea {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                    )}/>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => appendAbsence({ userId: '', reason: 'Falta Injustificada', notes: '' })}>
                  <PlusCircle className="mr-2 h-4 w-4" /> Adicionar ausência
                </Button>
              </div>
            </div>

            </div>
            </ScrollArea>
            <DialogFooter className="pt-3 border-t">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit" disabled={loading || isProcessing}>
                {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}
                Salvar alterações
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
    
    {conflicts.length > 0 && (
      <ConflictResolutionModal
        conflicts={conflicts}
        onResolve={() => performSave(form.getValues())}
        onCancel={() => setConflicts([])}
      />
    )}
    </>
  );
}
