"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { useDP } from '@/components/dp-provider';
import type { DPCalendar } from '@/types';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { CalendarDays, Plus, MoreHorizontal, Pencil, Trash2, ChevronRight } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

// ─── Schema ───────────────────────────────────────────────────────────────────

const currentYear = new Date().getFullYear();

const calendarSchema = z.object({
  name: z.string().min(1, 'Informe o nome do calendário.'),
  year: z.coerce.number().min(2020),
  state: z.string().optional(),
  city: z.string().optional(),
});

type CalendarForm = z.infer<typeof calendarSchema>;

// ─── Dialog ───────────────────────────────────────────────────────────────────

function CalendarDialog({ calendar, open, onOpenChange, onCreated }: { calendar?: DPCalendar | null; open: boolean; onOpenChange: (v: boolean) => void; onCreated?: (id: string) => void }) {
  const { addCalendar, updateCalendar } = useDP();
  const { toast } = useToast();
  const router = useRouter();

  const form = useForm<CalendarForm>({
    resolver: zodResolver(calendarSchema),
    defaultValues: {
      name: calendar?.name ?? '',
      year: calendar?.year ?? currentYear,
      state: calendar?.state ?? '',
      city: calendar?.city ?? '',
    },
  });

  React.useEffect(() => {
    if (open) {
      form.reset({
        name: calendar?.name ?? '',
        year: calendar?.year ?? currentYear,
        state: calendar?.state ?? '',
        city: calendar?.city ?? '',
      });
    }
  }, [open, calendar]);

  async function onSubmit(values: CalendarForm) {
    try {
      const data = { ...values, state: values.state || undefined, city: values.city || undefined };
      if (calendar) {
        await updateCalendar({ ...calendar, ...data });
        toast({ title: 'Calendário atualizado.' });
        onOpenChange(false);
      } else {
        const id = await addCalendar(data);
        toast({ title: 'Calendário criado.' });
        onOpenChange(false);
        if (onCreated) onCreated(id);
        else router.push(`/dashboard/dp/settings/calendars/${id}`);
      }
    } catch {
      toast({ title: 'Erro ao salvar.', variant: 'destructive' });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{calendar ? 'Editar calendário' : 'Novo calendário'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-2">
            <div className="grid grid-cols-3 gap-3">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel>Nome</FormLabel>
                  <FormControl><Input placeholder="Ex: Nacional 2025" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="year" render={({ field }) => (
                <FormItem>
                  <FormLabel>Ano</FormLabel>
                  <FormControl><Input type="number" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="state" render={({ field }) => (
                <FormItem>
                  <FormLabel>UF (opcional)</FormLabel>
                  <FormControl><Input placeholder="Ex: MA" maxLength={2} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="city" render={({ field }) => (
                <FormItem>
                  <FormLabel>Cidade (opcional)</FormLabel>
                  <FormControl><Input placeholder="Ex: São Luís" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Salvando...' : calendar ? 'Salvar' : 'Criar e adicionar feriados'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function DPSettingsCalendars({ onSelect }: { onSelect?: (id: string) => void } = {}) {
  const { calendars, calendarsLoading, deleteCalendar } = useDP();
  const { toast } = useToast();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [editCalendar, setEditCalendar] = useState<DPCalendar | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DPCalendar | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteCalendar(deleteTarget.id);
      toast({ title: 'Calendário excluído.' });
    } catch {
      toast({ title: 'Erro ao excluir.', variant: 'destructive' });
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  // Group calendars by state → city, sorted by year desc within each group
  const groups = (() => {
    const map = new Map<string, { label: string; items: typeof calendars }>();
    [...calendars]
      .sort((a, b) => b.year - a.year)
      .forEach(cal => {
        const key = [cal.state || '—', cal.city || '—'].join('::');
        const label = [cal.state, cal.city].filter(Boolean).join(' · ') || 'Nacional';
        if (!map.has(key)) map.set(key, { label, items: [] });
        map.get(key)!.items.push(cal);
      });
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  })();

  if (calendarsLoading) return <p className="text-sm text-muted-foreground">Carregando...</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-sm">Calendários de feriados</h3>
          <Badge variant="secondary">{calendars.length}</Badge>
        </div>
        <Button size="sm" variant="outline" onClick={() => { setEditCalendar(null); setOpen(true); }}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Novo
        </Button>
      </div>

      {calendars.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Nenhum calendário cadastrado.</p>
      ) : (
        <div className="space-y-5">
          {groups.map(group => (
            <div key={group.label} className="space-y-1.5">
              {/* Group header */}
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
                {group.label}
              </p>
              <div className="rounded-md border divide-y">
                {group.items.map(cal => (
                  <div
                    key={cal.id}
                    className="flex items-center gap-3 px-3 py-3 cursor-pointer hover:bg-muted/40 transition-colors"
                    onClick={() => onSelect ? onSelect(cal.id) : router.push(`/dashboard/dp/settings/calendars/${cal.id}`)}
                  >
                    <div className="h-8 w-8 rounded bg-primary/10 flex items-center justify-center shrink-0">
                      <CalendarDays className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{cal.name}</p>
                      <p className="text-xs text-muted-foreground">{cal.year}</p>
                    </div>
                    <Badge variant="secondary" className="shrink-0 text-xs">
                      {cal.holidayCount ?? 0} feriados
                    </Badge>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={e => e.stopPropagation()}>
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={e => { e.stopPropagation(); setEditCalendar(cal); setOpen(true); }}>
                          <Pencil className="mr-2 h-3.5 w-3.5" />Editar
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={e => { e.stopPropagation(); setDeleteTarget(cal); }} className="text-destructive focus:text-destructive">
                          <Trash2 className="mr-2 h-3.5 w-3.5" />Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <CalendarDialog calendar={editCalendar} open={open} onOpenChange={setOpen} onCreated={onSelect} />

      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir calendário?</AlertDialogTitle>
            <AlertDialogDescription>
              O calendário <strong>{deleteTarget?.name}</strong> e todos os seus feriados serão excluídos.
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
