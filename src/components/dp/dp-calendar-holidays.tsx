"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Timestamp } from 'firebase/firestore';
import { useDP } from '@/components/dp-provider';
import { useDPHolidays } from '@/hooks/use-dp-holidays';
import type { DPCalendar, DPHoliday, DPHolidayType } from '@/types';

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ArrowLeft, Plus, MoreHorizontal, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

// ─── Holiday type labels ──────────────────────────────────────────────────────

const HOLIDAY_TYPE_LABELS: Record<DPHolidayType, string> = {
  national:   'Nacional',
  state:      'Estadual',
  municipal:  'Municipal',
  optional:   'Facultativo',
};

const HOLIDAY_TYPE_VARIANTS: Record<DPHolidayType, 'default' | 'secondary' | 'outline'> = {
  national:  'default',
  state:     'secondary',
  municipal: 'outline',
  optional:  'outline',
};

// ─── Schema ───────────────────────────────────────────────────────────────────

const holidaySchema = z.object({
  name: z.string().min(1, 'Informe o nome do feriado.'),
  date: z.string().min(1, 'Informe a data.'),
  type: z.enum(['national', 'state', 'municipal', 'optional']),
});

type HolidayForm = z.infer<typeof holidaySchema>;

// ─── Dialog ───────────────────────────────────────────────────────────────────

function HolidayDialog({ calendarId, open, onOpenChange }: { calendarId: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { addHoliday } = useDP();
  const { toast } = useToast();

  const form = useForm<HolidayForm>({
    resolver: zodResolver(holidaySchema),
    defaultValues: { name: '', date: '', type: 'national' },
  });

  React.useEffect(() => {
    if (open) form.reset({ name: '', date: '', type: 'national' });
  }, [open]);

  async function onSubmit(values: HolidayForm) {
    try {
      await addHoliday(calendarId, {
        name: values.name,
        date: Timestamp.fromDate(new Date(values.date + 'T12:00:00')),
        type: values.type,
      });
      toast({ title: 'Feriado adicionado.' });
      onOpenChange(false);
    } catch {
      toast({ title: 'Erro ao adicionar feriado.', variant: 'destructive' });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Adicionar feriado</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-2">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel>Nome</FormLabel>
                <FormControl><Input placeholder="Ex: Natal" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="date" render={({ field }) => (
                <FormItem>
                  <FormLabel>Data</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="type" render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {Object.entries(HOLIDAY_TYPE_LABELS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Salvando...' : 'Adicionar'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface DPCalendarHolidaysProps {
  calendar: DPCalendar;
  onBack?: () => void;
}

export function DPCalendarHolidays({ calendar, onBack }: DPCalendarHolidaysProps) {
  const router = useRouter();
  const { deleteHoliday } = useDP();
  const { holidays, loading } = useDPHolidays(calendar.id);
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DPHoliday | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteHoliday(calendar.id, deleteTarget.id);
      toast({ title: 'Feriado removido.' });
    } catch {
      toast({ title: 'Erro ao remover.', variant: 'destructive' });
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  const sorted = [...holidays].sort((a, b) => {
    try {
      return a.date.toDate().getTime() - b.date.toDate().getTime();
    } catch { return 0; }
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => onBack ? onBack() : router.push('/dashboard/dp/settings/calendars')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold truncate">{calendar.name}</h1>
          <p className="text-sm text-muted-foreground">
            {calendar.year}
            {calendar.state && ` · ${calendar.state}`}
            {calendar.city && ` · ${calendar.city}`}
            {' · '}{holidays.length} feriado{holidays.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Adicionar feriado
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground py-4">Carregando feriados...</p>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          Nenhum feriado cadastrado. Clique em "Adicionar feriado" para começar.
        </p>
      ) : (
        <div className="rounded-md border divide-y">
          {sorted.map(holiday => {
            let dateStr = '—';
            try { dateStr = format(holiday.date.toDate(), "dd 'de' MMMM", { locale: ptBR }); } catch {}

            return (
              <div key={holiday.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{holiday.name}</p>
                    <Badge variant={HOLIDAY_TYPE_VARIANTS[holiday.type]} className="text-xs">
                      {HOLIDAY_TYPE_LABELS[holiday.type]}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{dateStr}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => setDeleteTarget(holiday)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <HolidayDialog calendarId={calendar.id} open={open} onOpenChange={setOpen} />

      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover feriado?</AlertDialogTitle>
            <AlertDialogDescription>
              O feriado <strong>{deleteTarget?.name}</strong> será removido deste calendário.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? 'Removendo...' : 'Remover'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
