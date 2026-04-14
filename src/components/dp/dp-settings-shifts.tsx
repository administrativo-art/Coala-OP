"use client";

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { useDP } from '@/components/dp-provider';
import type { DPShiftDefinition } from '@/types';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Plus, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

// ─── Constants ────────────────────────────────────────────────────────────────

const DOW_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

// ─── Schema ───────────────────────────────────────────────────────────────────

const shiftDefSchema = z.object({
  code: z.string().min(1, 'Informe o código.').max(10),
  name: z.string().min(1, 'Informe o nome.'),
  startTime: z.string().min(1, 'Informe o horário de início.'),
  endTime: z.string().min(1, 'Informe o horário de fim.'),
  breakStart: z.string().optional(),
  breakEnd: z.string().optional(),
  unitId: z.string().optional(),
  daysOfWeek: z.array(z.number()).min(1, 'Selecione ao menos um dia.'),
  bizneoTemplateId: z.string().optional(),
});

type ShiftDefForm = z.infer<typeof shiftDefSchema>;

// ─── Dialog ───────────────────────────────────────────────────────────────────

function ShiftDefDialog({ def, open, onOpenChange }: { def?: DPShiftDefinition | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { addShiftDefinition, updateShiftDefinition, units } = useDP();
  const { toast } = useToast();

  const form = useForm<ShiftDefForm>({
    resolver: zodResolver(shiftDefSchema),
    defaultValues: {
      code: def?.code ?? '',
      name: def?.name ?? '',
      startTime: def?.startTime ?? '',
      endTime: def?.endTime ?? '',
      breakStart: def?.breakStart ?? '',
      breakEnd: def?.breakEnd ?? '',
      unitId: def?.unitId ?? '',
      daysOfWeek: def?.daysOfWeek ?? [1, 2, 3, 4, 5],
      bizneoTemplateId: def?.bizneoTemplateId ?? '',
    },
  });

  React.useEffect(() => {
    if (open) {
      form.reset({
        code: def?.code ?? '',
        name: def?.name ?? '',
        startTime: def?.startTime ?? '',
        endTime: def?.endTime ?? '',
        breakStart: def?.breakStart ?? '',
        breakEnd: def?.breakEnd ?? '',
        unitId: def?.unitId ?? '',
        daysOfWeek: def?.daysOfWeek ?? [1, 2, 3, 4, 5],
        bizneoTemplateId: def?.bizneoTemplateId ?? '',
      });
    }
  }, [open, def]);

  async function onSubmit(values: ShiftDefForm) {
    try {
      const data = {
        ...values,
        unitId: values.unitId || undefined,
        unitName: units.find(u => u.id === values.unitId)?.name,
        bizneoTemplateId: values.bizneoTemplateId || undefined,
        breakStart: values.breakStart || undefined,
        breakEnd: values.breakEnd || undefined,
      };
      if (def) {
        await updateShiftDefinition({ ...def, ...data });
        toast({ title: 'Turno atualizado.' });
      } else {
        await addShiftDefinition(data);
        toast({ title: 'Turno criado.' });
      }
      onOpenChange(false);
    } catch {
      toast({ title: 'Erro ao salvar.', variant: 'destructive' });
    }
  }

  const selectedDays = form.watch('daysOfWeek') ?? [];

  function toggleDay(day: number) {
    const current = form.getValues('daysOfWeek') ?? [];
    form.setValue('daysOfWeek', current.includes(day) ? current.filter(d => d !== day) : [...current, day].sort());
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{def ? 'Editar turno' : 'Novo turno'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-2">
            <div className="grid grid-cols-3 gap-3">
              <FormField control={form.control} name="code" render={({ field }) => (
                <FormItem>
                  <FormLabel>Código</FormLabel>
                  <FormControl><Input placeholder="Ex: T1" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel>Nome</FormLabel>
                  <FormControl><Input placeholder="Ex: Turno da manhã" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="startTime" render={({ field }) => (
                <FormItem>
                  <FormLabel>Início</FormLabel>
                  <FormControl><Input type="time" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="endTime" render={({ field }) => (
                <FormItem>
                  <FormLabel>Fim</FormLabel>
                  <FormControl><Input type="time" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="breakStart" render={({ field }) => (
                <FormItem>
                  <FormLabel>Início intervalo</FormLabel>
                  <FormControl><Input type="time" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="breakEnd" render={({ field }) => (
                <FormItem>
                  <FormLabel>Fim intervalo</FormLabel>
                  <FormControl><Input type="time" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="unitId" render={({ field }) => (
              <FormItem>
                <FormLabel>Unidade padrão (opcional)</FormLabel>
                <Select
                  value={field.value || '__none__'}
                  onValueChange={v => field.onChange(v === '__none__' ? '' : v)}
                >
                  <FormControl>
                    <SelectTrigger><SelectValue placeholder="Nenhuma" /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="__none__">— Nenhuma —</SelectItem>
                    {units.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="bizneoTemplateId" render={({ field }) => (
              <FormItem>
                <FormLabel>ID do modelo no Bizneo</FormLabel>
                <FormControl><Input placeholder="Ex: 15693788" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="daysOfWeek" render={() => (
              <FormItem>
                <FormLabel>Dias da semana</FormLabel>
                <div className="flex gap-2 flex-wrap">
                  {DOW_LABELS.map((label, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => toggleDay(i)}
                      className={`h-8 w-10 rounded text-xs font-medium transition-colors ${
                        selectedDays.includes(i)
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground hover:bg-muted/80'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <FormMessage />
              </FormItem>
            )} />

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Salvando...' : 'Salvar'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function DPSettingsShifts() {
  const { shiftDefinitions, shiftDefsLoading, deleteShiftDefinition } = useDP();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [editDef, setEditDef] = useState<DPShiftDefinition | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DPShiftDefinition | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteShiftDefinition(deleteTarget.id);
      toast({ title: 'Turno excluído.' });
    } catch {
      toast({ title: 'Erro ao excluir.', variant: 'destructive' });
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  if (shiftDefsLoading) return <p className="text-sm text-muted-foreground">Carregando...</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-sm">Definições de turno</h3>
          <Badge variant="secondary">{shiftDefinitions.length}</Badge>
        </div>
        <Button size="sm" variant="outline" onClick={() => { setEditDef(null); setOpen(true); }}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Novo
        </Button>
      </div>

      <ScrollArea className="h-[320px] rounded-md border">
        {shiftDefinitions.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Nenhum turno cadastrado.</p>
        ) : (
          <div className="divide-y">
            {shiftDefinitions.map(def => (
              <div key={def.id} className="flex items-center gap-3 px-3 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono text-xs">{def.code}</Badge>
                    <p className="text-sm font-medium truncate">{def.name}</p>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {def.startTime}–{def.endTime}
                    {' · '}
                    {def.daysOfWeek.map(d => DOW_LABELS[d]).join(', ')}
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7">
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => { setEditDef(def); setOpen(true); }}>
                      <Pencil className="mr-2 h-3.5 w-3.5" />Editar
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setDeleteTarget(def)} className="text-destructive focus:text-destructive">
                      <Trash2 className="mr-2 h-3.5 w-3.5" />Excluir
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      <ShiftDefDialog def={editDef} open={open} onOpenChange={setOpen} />

      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir turno?</AlertDialogTitle>
            <AlertDialogDescription>
              O turno <strong>{deleteTarget?.name}</strong> será excluído.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? 'Excluindo...' : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
