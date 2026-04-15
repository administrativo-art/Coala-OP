"use client";

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format, differenceInCalendarDays, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { useDP } from '@/components/dp-context';
import { useAuth } from '@/hooks/use-auth';
import { useDPBootstrap } from '@/hooks/use-dp-bootstrap';
import type { DPVacationRecord } from '@/types';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { Input } from '@/components/ui/input';
import {
  ArrowLeft, CalendarDays, CheckCircle, MoreHorizontal,
  Pencil, Plus, Trash2, XCircle,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

import {
  calculateVacationHealth,
  getVacationCycleHistory,
  RISK_PROGRESS_CLASS,
  CYCLE_STATUS_CONFIG,
  type VacationCycle,
  type VacationRisk,
} from '@/lib/utils/vacation-logic';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase();
}

function toDate(ts: unknown): Date | undefined {
  if (!ts) return undefined;
  if (ts instanceof Date) return ts;
  if (typeof (ts as any).toDate === 'function') return (ts as any).toDate();
  if (typeof ts === 'string') return new Date(ts);
  return undefined;
}

function fmtDate(d?: string | Date) {
  if (!d) return '—';
  try {
    const dt = typeof d === 'string' ? parseISO(d) : d;
    return format(dt, 'dd/MM/yyyy');
  } catch { return String(d); }
}

// ─── Risk config ──────────────────────────────────────────────────────────────

const RISK_CONFIG: Record<VacationRisk, { label: string; text: string; bg: string }> = {
  VENCIDA:  { label: 'Vencida',   text: 'text-red-700 dark:text-red-300',      bg: 'bg-red-100 dark:bg-red-900/30'      },
  CRITICA:  { label: 'Crítica',   text: 'text-orange-700 dark:text-orange-300', bg: 'bg-orange-100 dark:bg-orange-900/30' },
  ATENCAO:  { label: 'Atenção',   text: 'text-yellow-700 dark:text-yellow-300', bg: 'bg-yellow-100 dark:bg-yellow-900/30' },
  EM_DIA:   { label: 'Em dia',    text: 'text-green-700 dark:text-green-300',   bg: 'bg-green-100 dark:bg-green-900/30'   },
};

// ─── Vacation record status config ────────────────────────────────────────────

const STATUS_CONFIG = {
  PENDING:  { label: 'Pendente',  bg: 'bg-amber-100 dark:bg-amber-900/30',  text: 'text-amber-700 dark:text-amber-300'  },
  PLANNED:  { label: 'Planejado', bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-700 dark:text-purple-300' },
  APPROVED: { label: 'Aprovado',  bg: 'bg-green-100 dark:bg-green-900/30',  text: 'text-green-700 dark:text-green-300'  },
  REJECTED: { label: 'Rejeitado', bg: 'bg-red-100 dark:bg-red-900/30',      text: 'text-red-700 dark:text-red-300'      },
} as const;

// ─── Schema ───────────────────────────────────────────────────────────────────

const vacationSchema = z.object({
  cycleId: z.string().min(1, 'Informe o ciclo (ex: 2024-2025).'),
  recordType: z.enum(['gozo', 'venda']),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  days: z.coerce.number().min(1).max(60),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'PLANNED']),
  paymentDate: z.string().optional(),
  returnDate: z.string().optional(),
}).refine(d => {
  if (d.startDate && d.endDate) return d.endDate >= d.startDate;
  return true;
}, { message: 'Data fim deve ser após data início.', path: ['endDate'] });

type VacationFormValues = z.infer<typeof vacationSchema>;

// ─── Vacation Form Dialog ─────────────────────────────────────────────────────

interface VacationDialogProps {
  userId: string;
  defaultCycleId?: string;
  vacation?: DPVacationRecord | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

function VacationDialog({ userId, defaultCycleId, vacation, open, onOpenChange }: VacationDialogProps) {
  const { addVacation, updateVacation } = useDP();
  const { toast } = useToast();
  const isEdit = !!vacation;

  const form = useForm<VacationFormValues>({
    resolver: zodResolver(vacationSchema),
    defaultValues: {
      cycleId: vacation?.cycleId ?? defaultCycleId ?? '',
      recordType: vacation?.recordType ?? 'gozo',
      startDate: vacation?.startDate ?? '',
      endDate: vacation?.endDate ?? '',
      days: vacation?.days ?? 30,
      status: vacation?.status ?? 'PLANNED',
      paymentDate: vacation?.paymentDate ?? '',
      returnDate: vacation?.returnDate ?? '',
    },
  });

  React.useEffect(() => {
    if (open) {
      form.reset({
        cycleId: vacation?.cycleId ?? defaultCycleId ?? '',
        recordType: vacation?.recordType ?? 'gozo',
        startDate: vacation?.startDate ?? '',
        endDate: vacation?.endDate ?? '',
        days: vacation?.days ?? 30,
        status: vacation?.status ?? 'PLANNED',
        paymentDate: vacation?.paymentDate ?? '',
        returnDate: vacation?.returnDate ?? '',
      });
    }
  }, [open, vacation, defaultCycleId]);

  const startDate = form.watch('startDate');
  const endDate = form.watch('endDate');
  const recordType = form.watch('recordType');

  React.useEffect(() => {
    if (startDate && endDate && endDate >= startDate) {
      const diff = differenceInCalendarDays(parseISO(endDate), parseISO(startDate)) + 1;
      form.setValue('days', diff);
    }
  }, [startDate, endDate]);

  async function onSubmit(values: VacationFormValues) {
    try {
      const data = {
        ...values,
        userId,
        startDate: values.startDate || undefined,
        endDate: values.endDate || undefined,
        paymentDate: values.paymentDate || undefined,
        returnDate: values.returnDate || undefined,
        warnings: vacation?.warnings ?? [],
      };
      if (isEdit && vacation) {
        await updateVacation({ ...vacation, ...data });
        toast({ title: 'Férias atualizadas.' });
      } else {
        await addVacation(data as any);
        toast({ title: 'Férias registradas.' });
      }
      onOpenChange(false);
    } catch {
      toast({ title: 'Erro ao salvar.', variant: 'destructive' });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar férias' : 'Agendar férias'}</DialogTitle>
          <DialogDescription>
            Registre o ciclo, o tipo e o período do lançamento de férias.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-2">

            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="cycleId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Ciclo</FormLabel>
                  <FormControl><Input placeholder="Ex: 2024-2025" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="recordType" render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="gozo">Gozo</SelectItem>
                      <SelectItem value="venda">Venda (abono)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            {recordType === 'gozo' && (
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="startDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Início</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="endDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fim</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="days" render={({ field }) => (
                <FormItem>
                  <FormLabel>Dias</FormLabel>
                  <FormControl><Input type="number" min={1} max={60} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="status" render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="paymentDate" render={({ field }) => (
                <FormItem>
                  <FormLabel>Pagamento</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              {recordType === 'gozo' && (
                <FormField control={form.control} name="returnDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Retorno</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              )}
            </div>

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

// ─── Vacation Record Row ──────────────────────────────────────────────────────

interface VacationRecordRowProps {
  record: DPVacationRecord;
  canEdit: boolean;
  canApprove: boolean;
  onEdit: (r: DPVacationRecord) => void;
  onDelete: (r: DPVacationRecord) => void;
  onApprove: (r: DPVacationRecord) => void;
  onReject: (r: DPVacationRecord) => void;
}

function VacationRecordRow({ record, canEdit, canApprove, onEdit, onDelete, onApprove, onReject }: VacationRecordRowProps) {
  const cfg = STATUS_CONFIG[record.status] ?? STATUS_CONFIG.PENDING;
  const isGozo = record.recordType === 'gozo';

  return (
    <div className="flex items-center gap-3 py-2.5 px-1 rounded-lg hover:bg-muted/30 transition-colors group">
      <div className="h-8 w-8 rounded-lg bg-muted/50 flex items-center justify-center shrink-0">
        <CalendarDays className="h-4 w-4 text-muted-foreground" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`}>
            {cfg.label}
          </span>
          <span className="text-xs text-muted-foreground">
            {isGozo ? 'Gozo' : 'Venda'} · {record.days}d
          </span>
        </div>
        {isGozo && record.startDate && (
          <p className="text-xs text-muted-foreground mt-0.5">
            {fmtDate(record.startDate)} → {fmtDate(record.endDate)}
          </p>
        )}
      </div>

      {(canEdit || canApprove) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canEdit && (
              <DropdownMenuItem onClick={() => onEdit(record)}>
                <Pencil className="mr-2 h-3.5 w-3.5" />Editar
              </DropdownMenuItem>
            )}
            {canApprove && record.status === 'PENDING' && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onApprove(record)}>
                  <CheckCircle className="mr-2 h-3.5 w-3.5 text-green-600" />Aprovar
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onReject(record)} className="text-destructive focus:text-destructive">
                  <XCircle className="mr-2 h-3.5 w-3.5" />Rejeitar
                </DropdownMenuItem>
              </>
            )}
            {canEdit && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onDelete(record)} className="text-destructive focus:text-destructive">
                  <Trash2 className="mr-2 h-3.5 w-3.5" />Excluir
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

// ─── Cycle Card ───────────────────────────────────────────────────────────────

interface CycleCardProps {
  cycle: VacationCycle;
  canEdit: boolean;
  canApprove: boolean;
  onAdd: (cycleId: string) => void;
  onEdit: (r: DPVacationRecord) => void;
  onDelete: (r: DPVacationRecord) => void;
  onApprove: (r: DPVacationRecord) => void;
  onReject: (r: DPVacationRecord) => void;
}

function CycleCard({ cycle, canEdit, canApprove, onAdd, onEdit, onDelete, onApprove, onReject }: CycleCardProps) {
  const cfg = CYCLE_STATUS_CONFIG[cycle.status];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Ciclo {cycle.id}</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Aquisitivo: {fmtDate(cycle.acquisitivePeriod.start)} → {fmtDate(cycle.acquisitivePeriod.end)}
            </p>
            <p className="text-xs text-muted-foreground">
              Concessivo: {fmtDate(cycle.concessivePeriod.start)} → {fmtDate(cycle.concessivePeriod.end)}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`}>
              {cfg.label}
            </span>
            <span className="text-xs text-muted-foreground">
              {cycle.takenDays}/30 dias
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="flex items-center gap-2 mt-2">
          <Progress
            value={Math.min(100, (cycle.takenDays / 30) * 100)}
            className="h-1.5 flex-1"
          />
          <span className="text-xs text-muted-foreground shrink-0">
            {Math.round(Math.min(100, (cycle.takenDays / 30) * 100))}%
          </span>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {cycle.records.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">Nenhum registro neste ciclo.</p>
        ) : (
          <div className="divide-y">
            {cycle.records.map(r => (
              <VacationRecordRow
                key={r.id}
                record={r}
                canEdit={canEdit}
                canApprove={canApprove}
                onEdit={onEdit}
                onDelete={onDelete}
                onApprove={onApprove}
                onReject={onReject}
              />
            ))}
          </div>
        )}
        {canEdit && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 w-full text-muted-foreground hover:text-foreground gap-1.5"
            onClick={() => onAdd(cycle.id)}
          >
            <Plus className="h-3.5 w-3.5" />
            Adicionar registro
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Profile Component ───────────────────────────────────────────────────

interface DPFeriasProfileProps {
  userId: string;
}

export function DPFeriasProfile({ userId }: DPFeriasProfileProps) {
  const router = useRouter();
  const { users, permissions } = useAuth();
  const { updateVacation, deleteVacation } = useDP();
  const { vacations, loading: vacationsLoading, error } = useDPBootstrap();
  const { toast } = useToast();

  const canEdit    = permissions.dp?.vacation?.request ?? false;
  const canApprove = permissions.dp?.vacation?.approve ?? false;

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [editVacation, setEditVacation] = useState<DPVacationRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DPVacationRecord | null>(null);
  const [selectedCycleId, setSelectedCycleId] = useState<string | undefined>();
  const [deleting, setDeleting] = useState(false);

  const user = users.find(u => u.id === userId);
  const admDate = toDate(user?.admissionDate);
  const userVacations = useMemo(() =>
    vacations.filter(v => v.userId === userId),
    [vacations, userId]
  );

  const health = useMemo(() =>
    calculateVacationHealth(admDate, userVacations),
    [admDate, userVacations]
  );

  const cycles = useMemo(() =>
    admDate ? getVacationCycleHistory(admDate, userVacations) : [],
    [admDate, userVacations]
  );

  async function handleApprove(v: DPVacationRecord) {
    try { await updateVacation({ ...v, status: 'APPROVED' }); toast({ title: 'Aprovado.' }); }
    catch { toast({ title: 'Erro.', variant: 'destructive' }); }
  }

  async function handleReject(v: DPVacationRecord) {
    try { await updateVacation({ ...v, status: 'REJECTED' }); toast({ title: 'Rejeitado.' }); }
    catch { toast({ title: 'Erro.', variant: 'destructive' }); }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteVacation(deleteTarget.id);
      toast({ title: 'Registro excluído.' });
    } catch {
      toast({ title: 'Erro ao excluir.', variant: 'destructive' });
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
        <p className="text-sm">Colaborador não encontrado.</p>
        <Button variant="ghost" size="sm" onClick={() => router.push('/dashboard/dp/ferias')}>
          <ArrowLeft className="mr-2 h-4 w-4" />Voltar
        </Button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <p className="text-sm text-destructive">Erro ao carregar férias: {error}</p>
        <Button variant="ghost" size="sm" onClick={() => router.push('/dashboard/dp/ferias')}>
          <ArrowLeft className="mr-2 h-4 w-4" />Voltar
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push('/dashboard/dp/ferias')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <Avatar className="h-10 w-10 shrink-0">
            <AvatarImage src={user.avatarUrl} />
            <AvatarFallback>{initials(user.username)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold truncate">{user.username}</h1>
            {admDate && (
              <p className="text-sm text-muted-foreground">
                Admissão: {fmtDate(admDate)}
              </p>
            )}
          </div>
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => { setSelectedCycleId(undefined); setScheduleOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" />
            Registrar férias
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left: Health Summary */}
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardContent className="p-5 space-y-4">
              {health.status === 'INVALIDO' && (
                <p className="text-sm text-muted-foreground">
                  Data de admissão não cadastrada. Configure o perfil do colaborador.
                </p>
              )}

              {health.status === 'CONCESSIVO' && (() => {
                const risk = health.details.risk;
                const rcfg = RISK_CONFIG[risk];
                return (
                  <>
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-muted-foreground">Período Concessivo</p>
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${rcfg.bg} ${rcfg.text}`}>
                        {rcfg.label}
                      </span>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Prazo</span>
                        <span className="font-medium">{fmtDate(health.details.deadline)}</span>
                      </div>
                      <Progress
                        value={health.details.progress}
                        className={`h-2 ${RISK_PROGRESS_CLASS[risk]}`}
                      />
                    </div>

                    <div className="text-xs text-muted-foreground space-y-1">
                      <p>Aquisitivo: {fmtDate(health.details.acquisitivePeriod.start)} → {fmtDate(health.details.acquisitivePeriod.end)}</p>
                    </div>

                    <Badge variant="secondary" className="text-xs">
                      {CYCLE_STATUS_CONFIG[health.cycleStatus]?.label ?? health.cycleStatus}
                    </Badge>
                  </>
                );
              })()}

              {health.status === 'AQUISITIVO' && (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-muted-foreground">Período Aquisitivo</p>
                    <Badge variant="secondary" className="text-xs">Em Aquisição</Badge>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Progresso</span>
                      <span>{Math.round(health.details.progress)}%</span>
                    </div>
                    <Progress value={health.details.progress} className="h-2" />
                  </div>

                  <p className="text-xs text-muted-foreground">
                    {fmtDate(health.details.start)} → {fmtDate(health.details.end)}
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          {/* Summary stats */}
          <Card>
            <CardContent className="p-4 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Resumo</p>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total de ciclos</span>
                <span className="font-medium">{cycles.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total de registros</span>
                <span className="font-medium">{userVacations.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Dias registrados</span>
                <span className="font-medium">{userVacations.reduce((t, v) => t + v.days, 0)}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: Cycle History */}
        <div className="lg:col-span-2 space-y-4">
          <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Histórico de Ciclos
          </p>

          {vacationsLoading ? (
            <div className="space-y-3">
              {[...Array(2)].map((_, i) => (
                <div key={i} className="h-32 rounded-xl border bg-muted/20 animate-pulse" />
              ))}
            </div>
          ) : cycles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2 rounded-xl border border-dashed">
              <CalendarDays className="h-8 w-8 opacity-30" />
              <p className="text-sm">Data de admissão necessária para calcular ciclos.</p>
            </div>
          ) : (
            cycles.map(cycle => (
              <CycleCard
                key={cycle.id}
                cycle={cycle}
                canEdit={canEdit}
                canApprove={canApprove}
                onAdd={(cycleId) => { setSelectedCycleId(cycleId); setScheduleOpen(true); }}
                onEdit={setEditVacation}
                onDelete={setDeleteTarget}
                onApprove={handleApprove}
                onReject={handleReject}
              />
            ))
          )}
        </div>
      </div>

      {/* Dialogs */}
      <VacationDialog
        userId={userId}
        defaultCycleId={selectedCycleId}
        open={scheduleOpen}
        onOpenChange={open => { if (!open) setScheduleOpen(false); }}
      />

      <VacationDialog
        userId={userId}
        vacation={editVacation}
        open={!!editVacation}
        onOpenChange={open => { if (!open) setEditVacation(null); }}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir registro?</AlertDialogTitle>
            <AlertDialogDescription>
              O registro de {deleteTarget?.days} dias será excluído permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? 'Excluindo...' : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
