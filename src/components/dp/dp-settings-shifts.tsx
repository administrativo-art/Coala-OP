"use client";

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { useDP } from '@/components/dp-context';
import type { DPShiftDefinition } from '@/types';
import {
  getShiftDefinitionUnitIds,
  getShiftDefinitionUnitNames,
} from '@/lib/dp-shift-definitions';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { MultiSelect } from '@/components/ui/multi-select';
import { Plus, Pencil, Trash2, Clock3 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

// ─── Constants ────────────────────────────────────────────────────────────────

const DOW_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function getShiftAccent(name: string) {
  const normalized = name.toLowerCase();

  if (normalized.includes('intermedi')) {
    return {
      label: 'Intermediário',
      className:
        'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200',
    };
  }

  if (normalized.includes('manhã') || normalized.includes('manha')) {
    return {
      label: 'Manhã',
      className:
        'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200',
    };
  }

  if (normalized.includes('tarde')) {
    return {
      label: 'Tarde',
      className:
        'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200',
    };
  }

  if (normalized.includes('noite')) {
    return {
      label: 'Noite',
      className:
        'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-200',
    };
  }

  return {
    label: 'Turno',
    className:
      'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-500/20 dark:bg-slate-500/10 dark:text-slate-200',
  };
}

function getDisplayCode(def: DPShiftDefinition) {
  const raw = String(def.code ?? '').trim();
  if (!raw) return '—';
  return /^\d+$/.test(raw) ? `#${raw}` : raw;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const shiftDefSchema = z.object({
  code: z.string().min(1, 'Informe o código.').max(10),
  name: z.string().min(1, 'Informe o nome.'),
  startTime: z.string().min(1, 'Informe o horário de início.'),
  endTime: z.string().min(1, 'Informe o horário de fim.'),
  breakStart: z.string().optional(),
  breakEnd: z.string().optional(),
  unitIds: z.array(z.string()).optional(),
  daysOfWeek: z.array(z.number()).min(1, 'Selecione ao menos um dia.'),
  bizneoTemplateId: z.string().optional(),
});

type ShiftDefForm = z.infer<typeof shiftDefSchema>;

// ─── Dialog ───────────────────────────────────────────────────────────────────

function ShiftDefDialog({ def, open, onOpenChange, units }: {
  def?: DPShiftDefinition | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  units: Array<{ id: string; name: string }>;
}) {
  const { addShiftDefinition, updateShiftDefinition } = useDP();
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
      unitIds: getShiftDefinitionUnitIds(def),
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
        unitIds: getShiftDefinitionUnitIds(def),
        daysOfWeek: def?.daysOfWeek ?? [1, 2, 3, 4, 5],
        bizneoTemplateId: def?.bizneoTemplateId ?? '',
      });
    }
  }, [open, def]);

  async function onSubmit(values: ShiftDefForm) {
    try {
      const selectedUnits = units.filter(u => (values.unitIds ?? []).includes(u.id));
      const selectedUnitIds = selectedUnits.map(u => u.id);
      const selectedUnitNames = selectedUnits.map(u => u.name);
      const data = {
        ...values,
        unitIds: selectedUnitIds.length > 0 ? selectedUnitIds : undefined,
        unitNames: selectedUnitNames.length > 0 ? selectedUnitNames : undefined,
        unitId: selectedUnitIds[0],
        unitName: selectedUnitNames[0],
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{def ? 'Editar turno' : 'Novo turno'}</DialogTitle>
          <DialogDescription>
            Configure código, nome, horários e dias da semana do turno reutilizável.
          </DialogDescription>
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

            <FormField control={form.control} name="unitIds" render={({ field }) => (
              <FormItem>
                <FormLabel>Unidades vinculadas (opcional)</FormLabel>
                <FormControl>
                  <MultiSelect
                    options={units.map(unit => ({ value: unit.id, label: unit.name }))}
                    selected={field.value ?? []}
                    onChange={field.onChange}
                    placeholder="Selecione uma ou mais unidades"
                  />
                </FormControl>
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
  const {
    deleteShiftDefinition,
    shiftDefinitions,
    shiftDefsLoading,
    units,
    shiftDefsError,
  } = useDP();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [editDef, setEditDef] = useState<DPShiftDefinition | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DPShiftDefinition | null>(null);
  const [deleting, setDeleting] = useState(false);

  const resolveUnitLabels = (def: DPShiftDefinition) => {
    const linkedUnitIds = getShiftDefinitionUnitIds(def);
    const linkedUnitNames = getShiftDefinitionUnitNames(def);

    if (linkedUnitIds.length === 0) return linkedUnitNames;

    return linkedUnitIds.map((unitId, index) => units.find(unit => unit.id === unitId)?.name ?? linkedUnitNames[index] ?? unitId);
  };

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

  if (shiftDefsLoading && shiftDefinitions.length === 0) return <p className="text-sm text-muted-foreground">Carregando...</p>;
  if (shiftDefsError && shiftDefinitions.length === 0) return <p className="text-sm text-destructive">Erro ao carregar turnos: {shiftDefsError}</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-sm">Definições de turno</h3>
          <Badge variant="secondary">{shiftDefinitions.length}</Badge>
        </div>
        <Button size="sm" variant="outline" className="rounded-xl" onClick={() => { setEditDef(null); setOpen(true); }}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Novo
        </Button>
      </div>

      {shiftDefinitions.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Nenhum turno cadastrado.</p>
      ) : (
        <div className="space-y-3">
          {shiftDefinitions.map(def => (
            <div
              key={def.id}
              className="flex flex-col gap-4 rounded-2xl border border-border/70 bg-muted/30 px-5 py-4 shadow-sm transition-colors hover:bg-muted/40 md:flex-row md:items-center md:justify-between"
            >
              <div className="flex min-w-0 flex-1 items-start gap-4">
                <div
                  className={cn(
                    'inline-flex min-h-10 min-w-[112px] items-center justify-center rounded-2xl border px-4 py-2 text-sm font-semibold',
                    getShiftAccent(def.name).className
                  )}
                >
                  {getShiftAccent(def.name).label}
                </div>

                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-mono text-base font-semibold tracking-tight text-muted-foreground/70">
                      {getDisplayCode(def)}
                    </span>
                    <p className="truncate text-lg font-semibold leading-none tracking-tight">
                      {def.name}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      <Clock3 className="h-4 w-4" />
                      {def.startTime}–{def.endTime}
                    </span>
                    <span className="hidden text-muted-foreground/50 sm:inline">·</span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {def.daysOfWeek.map((day) => (
                        <span
                          key={`${def.id}-${day}`}
                          className="rounded-lg border border-border/60 bg-background/70 px-2 py-1 text-xs font-medium text-muted-foreground"
                        >
                          {DOW_LABELS[day]}
                        </span>
                      ))}
                    </div>
                  </div>

                  {resolveUnitLabels(def).length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Unidades vinculadas: {resolveUnitLabels(def).join(', ')}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 self-end md:self-center">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-11 w-11 rounded-2xl border-border/70 bg-background/80"
                  onClick={() => { setEditDef(def); setOpen(true); }}
                  aria-label={`Editar turno ${def.name}`}
                  title="Editar turno"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-11 w-11 rounded-2xl border-border/70 bg-background/80 text-destructive hover:text-destructive"
                  onClick={() => setDeleteTarget(def)}
                  aria-label={`Excluir turno ${def.name}`}
                  title="Excluir turno"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ShiftDefDialog def={editDef} open={open} onOpenChange={setOpen} units={units} />

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
