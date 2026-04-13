"use client";

import React, { useState, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Timestamp } from 'firebase/firestore';

import { useAuth } from '@/hooks/use-auth';
import { useDP } from '@/hooks/use-dp';
import type { User } from '@/types';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { Search, MoreHorizontal, Pencil, UserX, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

// ─── Schema ───────────────────────────────────────────────────────────────────

const collaboratorSchema = z.object({
  registrationIdBizneo: z.string().optional(),
  registrationIdPdv: z.string().optional(),
  admissionDate: z.string().optional(),
  birthDate: z.string().optional(),
  shiftDefinitionId: z.string().optional(),
  needsTransportVoucher: z.boolean().optional(),
  transportVoucherValue: z.coerce.number().nonnegative().optional(),
});

type CollaboratorFormValues = z.infer<typeof collaboratorSchema>;

const terminationSchema = z.object({
  terminationReason: z.enum(['Sem Justa Causa', 'Pedido de Demissão', 'Acordo', 'Justa Causa'], {
    required_error: 'Selecione o motivo do desligamento.',
  }),
  terminationCause: z.string().optional(),
  terminationNotes: z.string().optional(),
  terminationDate: z.string().min(1, 'Informe a data do desligamento.'),
});

type TerminationFormValues = z.infer<typeof terminationSchema>;

// ─── Helper ───────────────────────────────────────────────────────────────────

function timestampToDateInput(ts: Timestamp | undefined): string {
  if (!ts) return '';
  try {
    return format(ts.toDate(), 'yyyy-MM-dd');
  } catch {
    return '';
  }
}

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(n => n[0])
    .join('')
    .toUpperCase();
}

// ─── Edit Sheet ───────────────────────────────────────────────────────────────

interface EditSheetProps {
  user: User | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

function EditSheet({ user, open, onOpenChange }: EditSheetProps) {
  const { updateUser } = useAuth();
  const { shiftDefinitions } = useDP();
  const { toast } = useToast();

  const form = useForm<CollaboratorFormValues>({
    resolver: zodResolver(collaboratorSchema),
    defaultValues: {
      registrationIdBizneo: '',
      registrationIdPdv: '',
      admissionDate: '',
      birthDate: '',
      shiftDefinitionId: '',
      needsTransportVoucher: false,
      transportVoucherValue: undefined,
    },
  });

  // Reset form when user changes
  React.useEffect(() => {
    if (user && open) {
      form.reset({
        registrationIdBizneo: user.registrationIdBizneo ?? '',
        registrationIdPdv: user.registrationIdPdv ?? '',
        admissionDate: timestampToDateInput(user.admissionDate),
        birthDate: timestampToDateInput(user.birthDate),
        shiftDefinitionId: user.shiftDefinitionId ?? '',
        needsTransportVoucher: user.needsTransportVoucher ?? false,
        transportVoucherValue: user.transportVoucherValue,
      });
    }
  }, [user, open, form]);

  async function onSubmit(values: CollaboratorFormValues) {
    if (!user) return;
    try {
      const updates: Partial<User> = {
        ...user,
        registrationIdBizneo: values.registrationIdBizneo || undefined,
        registrationIdPdv: values.registrationIdPdv || undefined,
        shiftDefinitionId: values.shiftDefinitionId || undefined,
        needsTransportVoucher: values.needsTransportVoucher,
        transportVoucherValue: values.needsTransportVoucher ? values.transportVoucherValue : undefined,
      };

      if (values.admissionDate) {
        updates.admissionDate = Timestamp.fromDate(new Date(values.admissionDate + 'T12:00:00'));
      }
      if (values.birthDate) {
        updates.birthDate = Timestamp.fromDate(new Date(values.birthDate + 'T12:00:00'));
      }

      await updateUser(updates as User);
      toast({ title: 'Colaborador atualizado com sucesso.' });
      onOpenChange(false);
    } catch {
      toast({ title: 'Erro ao atualizar colaborador.', variant: 'destructive' });
    }
  }

  const needsVoucher = form.watch('needsTransportVoucher');

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[420px] sm:max-w-[420px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Editar colaborador</SheetTitle>
          <SheetDescription>{user?.username}</SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="registrationIdBizneo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Matrícula Bizneo</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex: 18043422" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="admissionDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Admissão</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="birthDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nascimento</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="shiftDefinitionId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Turno padrão</FormLabel>
                  <Select
                    value={field.value || '__none__'}
                    onValueChange={v => field.onChange(v === '__none__' ? '' : v)}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione um turno" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="__none__">— Nenhum —</SelectItem>
                      {shiftDefinitions.map(def => (
                        <SelectItem key={def.id} value={def.id}>
                          {def.name} ({def.startTime}–{def.endTime})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Separator />

            <FormField
              control={form.control}
              name="needsTransportVoucher"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between">
                  <FormLabel>Vale-transporte</FormLabel>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />

            {needsVoucher && (
              <FormField
                control={form.control}
                name="transportVoucherValue"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Valor mensal (R$)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0,00"
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <SheetFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Salvando...' : 'Salvar'}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}

// ─── Termination Dialog ───────────────────────────────────────────────────────

interface TerminationDialogProps {
  user: User | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

function TerminationDialog({ user, open, onOpenChange }: TerminationDialogProps) {
  const { terminateUser } = useAuth();
  const { toast } = useToast();

  const form = useForm<TerminationFormValues>({
    resolver: zodResolver(terminationSchema),
    defaultValues: {
      terminationReason: undefined,
      terminationCause: '',
      terminationNotes: '',
      terminationDate: format(new Date(), 'yyyy-MM-dd'),
    },
  });

  React.useEffect(() => {
    if (open) {
      form.reset({
        terminationReason: undefined,
        terminationCause: '',
        terminationNotes: '',
        terminationDate: format(new Date(), 'yyyy-MM-dd'),
      });
    }
  }, [open, form]);

  async function onSubmit(values: TerminationFormValues) {
    if (!user) return;
    try {
      await terminateUser({
        uid: user.id,
        terminationReason: values.terminationReason,
        terminationCause: values.terminationCause,
        terminationNotes: values.terminationNotes,
        terminationDate: values.terminationDate,
      });
      toast({ title: `${user.username} foi desligado(a).` });
      onOpenChange(false);
    } catch {
      toast({ title: 'Erro ao desligar colaborador.', variant: 'destructive' });
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Desligar colaborador</AlertDialogTitle>
          <AlertDialogDescription>
            Esta ação removerá o acesso de <strong>{user?.username}</strong> ao sistema.
            O histórico será mantido na lista de desligados.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <Form {...form}>
          <form id="termination-form" onSubmit={form.handleSubmit(onSubmit)} className="space-y-3 py-2">

            <FormField
              control={form.control}
              name="terminationDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Data do desligamento</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="terminationReason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Motivo</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o motivo" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="Sem Justa Causa">Sem Justa Causa</SelectItem>
                      <SelectItem value="Pedido de Demissão">Pedido de Demissão</SelectItem>
                      <SelectItem value="Acordo">Acordo</SelectItem>
                      <SelectItem value="Justa Causa">Justa Causa</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="terminationCause"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Causa (opcional)</FormLabel>
                  <FormControl>
                    <Input placeholder="Ex: Abandono de emprego" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="terminationNotes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Observações (opcional)</FormLabel>
                  <FormControl>
                    <Textarea rows={2} placeholder="Detalhes adicionais..." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <Button
            form="termination-form"
            type="submit"
            variant="destructive"
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting ? 'Desligando...' : 'Confirmar desligamento'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────

interface CollaboratorRowProps {
  user: User;
  onEdit: (user: User) => void;
  onTerminate: (user: User) => void;
  canEdit: boolean;
  canTerminate: boolean;
}

function CollaboratorRow({ user, onEdit, onTerminate, canEdit, canTerminate }: CollaboratorRowProps) {
  const { shiftDefinitions } = useDP();

  const shiftDef = useMemo(
    () => shiftDefinitions.find(d => d.id === user.shiftDefinitionId),
    [user.shiftDefinitionId, shiftDefinitions]
  );

  return (
    <div className="flex items-center gap-3 py-3 px-1">
      <Avatar className="h-9 w-9 shrink-0">
        <AvatarFallback className="text-xs">{initials(user.username)}</AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{user.username}</p>
        <p className="text-xs text-muted-foreground truncate">
          {[
            user.registrationIdBizneo && `Bizneo: ${user.registrationIdBizneo}`,
            user.registrationIdPdv && `PDV: ${user.registrationIdPdv}`,
            shiftDef ? shiftDef.name : null,
          ].filter(Boolean).join(' · ') || 'Sem dados DP'}
        </p>
      </div>

      {user.admissionDate && (
        <span className="text-xs text-muted-foreground shrink-0 hidden sm:block">
          {format(user.admissionDate.toDate(), 'dd/MM/yyyy', { locale: ptBR })}
        </span>
      )}

      {(canEdit || canTerminate) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canEdit && (
              <DropdownMenuItem onClick={() => onEdit(user)}>
                <Pencil className="mr-2 h-4 w-4" />
                Editar dados DP
              </DropdownMenuItem>
            )}
            {canEdit && canTerminate && <DropdownMenuSeparator />}
            {canTerminate && (
              <DropdownMenuItem
                onClick={() => onTerminate(user)}
                className="text-destructive focus:text-destructive"
              >
                <UserX className="mr-2 h-4 w-4" />
                Desligar
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function DPCollaboratorsManager() {
  const { activeUsers, permissions, updateUser } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [editUser, setEditUser] = useState<User | null>(null);
  const [terminateUser, setTerminateUser] = useState<User | null>(null);
  const [syncing, setSyncing] = useState(false);

  const canEdit = permissions.dp?.collaborators?.edit ?? false;
  const canTerminate = permissions.dp?.collaborators?.terminate ?? false;

  async function handleBizneoSync() {
    setSyncing(true);
    try {
      // 1. Busca usuários do Bizneo via rota server-side (que tem o token da API)
      const res = await fetch('/api/integrations/bizneo/sync-users');
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? 'Erro ao buscar usuários do Bizneo.');

      // 2. Cruza por email e atualiza cada usuário Coala via Firestore client
      const bizneoByEmail = new Map<string, number>(
        (data.users as { id: number; email: string }[]).map(u => [u.email.toLowerCase(), u.id])
      );

      let matched = 0;
      const unmatched: string[] = [];
      const updates: Promise<void>[] = [];

      for (const user of activeUsers) {
        const bizneoId = bizneoByEmail.get((user.email ?? '').toLowerCase());
        if (bizneoId) {
          updates.push(updateUser({ ...user, registrationIdBizneo: String(bizneoId) }));
          matched++;
        } else {
          unmatched.push(user.username);
        }
      }

      await Promise.all(updates);

      toast({
        title: 'Matrículas Bizneo sincronizadas',
        description: `${matched} vinculado(s) · ${unmatched.length} sem correspondência.`,
      });
    } catch (e: any) {
      toast({ title: 'Erro ao sincronizar com Bizneo.', description: e.message, variant: 'destructive' });
    } finally {
      setSyncing(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return activeUsers.filter(u =>
      u.username.toLowerCase().includes(q) ||
      (u.registrationIdBizneo ?? '').includes(q) ||
      (u.registrationIdPdv ?? '').includes(q)
    );
  }, [activeUsers, search]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou matrícula..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Badge variant="outline">{filtered.length}</Badge>
        {canEdit && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleBizneoSync}
            disabled={syncing}
            className="gap-1.5 shrink-0"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Sincronizando...' : 'Sincronizar Bizneo'}
          </Button>
        )}
      </div>

      <ScrollArea className="h-[calc(100vh-280px)]">
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            {search ? 'Nenhum resultado encontrado.' : 'Nenhum colaborador ativo.'}
          </p>
        ) : (
          <div className="divide-y">
            {filtered.map(user => (
              <CollaboratorRow
                key={user.id}
                user={user}
                onEdit={setEditUser}
                onTerminate={setTerminateUser}
                canEdit={canEdit}
                canTerminate={canTerminate}
              />
            ))}
          </div>
        )}
      </ScrollArea>

      <EditSheet
        user={editUser}
        open={!!editUser}
        onOpenChange={open => { if (!open) setEditUser(null); }}
      />

      <TerminationDialog
        user={terminateUser}
        open={!!terminateUser}
        onOpenChange={open => { if (!open) setTerminateUser(null); }}
      />
    </div>
  );
}
