"use client";

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { useDP } from '@/components/dp-provider';
import type { DPUnit, DPUnitGroup } from '@/types';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
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
import { Plus, MoreHorizontal, Pencil, Trash2, Building2, Layers } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

// ─── Unit Dialog ──────────────────────────────────────────────────────────────

const unitSchema = z.object({
  name: z.string().min(1, 'Informe o nome da unidade.'),
  groupId: z.string().optional(),
  bizneoTaxonId: z.string().optional(),
});
type UnitForm = z.infer<typeof unitSchema>;

function UnitDialog({ unit, open, onOpenChange }: { unit?: DPUnit | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { addUnit, updateUnit, unitGroups } = useDP();
  const { toast } = useToast();
  const form = useForm<UnitForm>({
    resolver: zodResolver(unitSchema),
    defaultValues: { name: unit?.name ?? '', groupId: unit?.groupId ?? '', bizneoTaxonId: unit?.bizneoTaxonId ? String(unit.bizneoTaxonId) : '' },
  });

  React.useEffect(() => {
    if (open) form.reset({ name: unit?.name ?? '', groupId: unit?.groupId ?? '', bizneoTaxonId: unit?.bizneoTaxonId ? String(unit.bizneoTaxonId) : '' });
  }, [open, unit]);

  async function onSubmit(values: UnitForm) {
    try {
      const bizneoTaxonId = values.bizneoTaxonId ? Number(values.bizneoTaxonId) : undefined;
      if (unit) {
        await updateUnit({ ...unit, name: values.name, groupId: values.groupId || undefined, bizneoTaxonId });
      } else {
        await addUnit({ name: values.name, groupId: values.groupId || undefined, bizneoTaxonId });
      }
      toast({ title: unit ? 'Unidade atualizada.' : 'Unidade criada.' });
      onOpenChange(false);
    } catch {
      toast({ title: 'Erro ao salvar unidade.', variant: 'destructive' });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{unit ? 'Editar unidade' : 'Nova unidade'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-2">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel>Nome</FormLabel>
                <FormControl><Input placeholder="Ex: Tirirical" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="groupId" render={({ field }) => (
              <FormItem>
                <FormLabel>Grupo (opcional)</FormLabel>
                <Select
                  value={field.value || '__none__'}
                  onValueChange={v => field.onChange(v === '__none__' ? '' : v)}
                >
                  <FormControl>
                    <SelectTrigger><SelectValue placeholder="Sem grupo" /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="__none__">— Sem grupo —</SelectItem>
                    {unitGroups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="bizneoTaxonId" render={({ field }) => (
              <FormItem>
                <FormLabel>ID Bizneo (taxon)</FormLabel>
                <FormControl><Input placeholder="Ex: 16098415" {...field} /></FormControl>
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

// ─── Group Dialog ─────────────────────────────────────────────────────────────

const groupSchema = z.object({ name: z.string().min(1, 'Informe o nome do grupo.') });
type GroupForm = z.infer<typeof groupSchema>;

function GroupDialog({ group, open, onOpenChange }: { group?: DPUnitGroup | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { addUnitGroup, updateUnitGroup } = useDP();
  const { toast } = useToast();
  const form = useForm<GroupForm>({
    resolver: zodResolver(groupSchema),
    defaultValues: { name: group?.name ?? '' },
  });

  React.useEffect(() => {
    if (open) form.reset({ name: group?.name ?? '' });
  }, [open, group]);

  async function onSubmit({ name }: GroupForm) {
    try {
      if (group) await updateUnitGroup({ ...group, name });
      else await addUnitGroup({ name });
      toast({ title: group ? 'Grupo atualizado.' : 'Grupo criado.' });
      onOpenChange(false);
    } catch {
      toast({ title: 'Erro ao salvar grupo.', variant: 'destructive' });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle>{group ? 'Editar grupo' : 'Novo grupo'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-2">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel>Nome</FormLabel>
                <FormControl><Input placeholder="Ex: Norte" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter>
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

export function DPSettingsUnits() {
  const { units, unitGroups, unitsLoading, deleteUnit, deleteUnitGroup } = useDP();
  const { toast } = useToast();

  const [unitDialog, setUnitDialog] = useState<DPUnit | null | 'new'>('new' as any);
  const [groupDialog, setGroupDialog] = useState<DPUnitGroup | null | 'new'>('new' as any);
  const [unitToDelete, setUnitToDelete] = useState<DPUnit | null>(null);
  const [groupToDelete, setGroupToDelete] = useState<DPUnitGroup | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Reset dialog states properly
  const [unitOpen, setUnitOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [editUnit, setEditUnit] = useState<DPUnit | null>(null);
  const [editGroup, setEditGroup] = useState<DPUnitGroup | null>(null);

  async function handleDeleteUnit() {
    if (!unitToDelete) return;
    setDeleting(true);
    try {
      await deleteUnit(unitToDelete.id);
      toast({ title: 'Unidade excluída.' });
    } catch {
      toast({ title: 'Erro ao excluir unidade.', variant: 'destructive' });
    } finally {
      setDeleting(false);
      setUnitToDelete(null);
    }
  }

  async function handleDeleteGroup() {
    if (!groupToDelete) return;
    setDeleting(true);
    try {
      await deleteUnitGroup(groupToDelete.id);
      toast({ title: 'Grupo excluído.' });
    } catch {
      toast({ title: 'Erro ao excluir grupo.', variant: 'destructive' });
    } finally {
      setDeleting(false);
      setGroupToDelete(null);
    }
  }

  if (unitsLoading) return <p className="text-sm text-muted-foreground">Carregando...</p>;

  return (
    <div className="space-y-8">
      {/* Unidades */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-medium text-sm">Unidades</h3>
            <Badge variant="secondary">{units.length}</Badge>
          </div>
          <Button size="sm" variant="outline" onClick={() => { setEditUnit(null); setUnitOpen(true); }}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Nova
          </Button>
        </div>

        <ScrollArea className="h-[200px] rounded-md border">
          {units.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Nenhuma unidade cadastrada.</p>
          ) : (
            <div className="divide-y">
              {units.map(unit => {
                const group = unitGroups.find(g => g.id === unit.groupId);
                return (
                  <div key={unit.id} className="flex items-center gap-3 px-3 py-2.5">
                    <p className="flex-1 text-sm truncate">{unit.name}</p>
                    {group && <Badge variant="outline" className="text-xs font-normal">{group.name}</Badge>}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => { setEditUnit(unit); setUnitOpen(true); }}>
                          <Pencil className="mr-2 h-3.5 w-3.5" />Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setUnitToDelete(unit)} className="text-destructive focus:text-destructive">
                          <Trash2 className="mr-2 h-3.5 w-3.5" />Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>

      <Separator />

      {/* Grupos */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-medium text-sm">Grupos de unidades</h3>
            <Badge variant="secondary">{unitGroups.length}</Badge>
          </div>
          <Button size="sm" variant="outline" onClick={() => { setEditGroup(null); setGroupOpen(true); }}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Novo
          </Button>
        </div>

        <ScrollArea className="h-[160px] rounded-md border">
          {unitGroups.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Nenhum grupo cadastrado.</p>
          ) : (
            <div className="divide-y">
              {unitGroups.map(group => (
                <div key={group.id} className="flex items-center gap-3 px-3 py-2.5">
                  <p className="flex-1 text-sm truncate">{group.name}</p>
                  <Badge variant="secondary" className="text-xs">
                    {units.filter(u => u.groupId === group.id).length} unidades
                  </Badge>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7">
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => { setEditGroup(group); setGroupOpen(true); }}>
                        <Pencil className="mr-2 h-3.5 w-3.5" />Editar
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setGroupToDelete(group)} className="text-destructive focus:text-destructive">
                        <Trash2 className="mr-2 h-3.5 w-3.5" />Excluir
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Dialogs */}
      <UnitDialog unit={editUnit} open={unitOpen} onOpenChange={setUnitOpen} />
      <GroupDialog group={editGroup} open={groupOpen} onOpenChange={setGroupOpen} />

      <AlertDialog open={!!unitToDelete} onOpenChange={open => { if (!open) setUnitToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir unidade?</AlertDialogTitle>
            <AlertDialogDescription>
              A unidade <strong>{unitToDelete?.name}</strong> será excluída permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteUnit} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? 'Excluindo...' : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!groupToDelete} onOpenChange={open => { if (!open) setGroupToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir grupo?</AlertDialogTitle>
            <AlertDialogDescription>
              O grupo <strong>{groupToDelete?.name}</strong> será excluído. As unidades do grupo não serão afetadas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteGroup} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? 'Excluindo...' : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
