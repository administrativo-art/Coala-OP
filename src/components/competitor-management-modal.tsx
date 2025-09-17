"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useCompetitors } from '@/hooks/use-competitors';
import { 
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter
} from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PlusCircle, Edit, Trash2, Building } from 'lucide-react';
import { Skeleton } from './ui/skeleton';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { ScrollArea } from './ui/scroll-area';
import { type Competitor } from '@/types';

const competitorSchema = z.object({
  name: z.string().min(1, 'O nome é obrigatório.'),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
});

type CompetitorFormValues = z.infer<typeof competitorSchema>;

export function CompetitorManagementModal({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
  const { competitors, loading, addCompetitor, updateCompetitor, deleteCompetitor } = useCompetitors();
  const [editingCompetitor, setEditingCompetitor] = useState<Competitor | null>(null);
  const [competitorToDelete, setCompetitorToDelete] = useState<Competitor | null>(null);

  const form = useForm<CompetitorFormValues>({
    resolver: zodResolver(competitorSchema),
    defaultValues: { name: '', address: '', city: '', state: '' },
  });

  useEffect(() => {
    if (editingCompetitor) {
      form.reset(editingCompetitor);
    } else {
      form.reset({ name: '', address: '', city: '', state: '' });
    }
  }, [editingCompetitor, form]);

  const onSubmit = async (values: CompetitorFormValues) => {
    if (editingCompetitor) {
      await updateCompetitor(editingCompetitor.id, { ...editingCompetitor, ...values });
    } else {
      await addCompetitor({ ...values, active: true });
    }
    setEditingCompetitor(null);
    form.reset({ name: '', address: '', city: '', state: '' });
  };
  
  const handleStartEdit = (competitor: Competitor) => {
    setEditingCompetitor(competitor);
  };

  const handleCancelEdit = () => {
    setEditingCompetitor(null);
    form.reset({ name: '', address: '', city: '', state: '' });
  };

  const handleDeleteConfirm = () => {
    if (competitorToDelete) {
        deleteCompetitor(competitorToDelete.id);
        setCompetitorToDelete(null);
    }
  };

  if (loading) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <>
    <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-4xl h-[90vh] flex flex-col">
            <DialogHeader>
                <DialogTitle>Gerenciamento de Concorrência</DialogTitle>
                <DialogDescription>Adicione, edite e gerencie seus concorrentes.</DialogDescription>
            </DialogHeader>

            <div className="flex-1 flex flex-col overflow-hidden">
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 p-1">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                            <FormField
                                control={form.control}
                                name="name"
                                render={({ field }) => (
                                    <FormItem><FormLabel>Nome do Concorrente</FormLabel><FormControl><Input {...field} placeholder="Nome do concorrente" /></FormControl><FormMessage /></FormItem>
                                )}
                            />
                             <FormField
                                control={form.control}
                                name="address"
                                render={({ field }) => (
                                    <FormItem><FormLabel>Endereço</FormLabel><FormControl><Input {...field} value={field.value || ''} placeholder="Rua, Número, Bairro" /></FormControl><FormMessage /></FormItem>
                                )}
                            />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                            <FormField
                                control={form.control}
                                name="city"
                                render={({ field }) => (
                                    <FormItem><FormLabel>Cidade</FormLabel><FormControl><Input {...field} value={field.value || ''} placeholder="São Luís" /></FormControl><FormMessage /></FormItem>
                                )}
                            />
                             <FormField
                                control={form.control}
                                name="state"
                                render={({ field }) => (
                                    <FormItem><FormLabel>Estado</FormLabel><FormControl><Input {...field} value={field.value || ''} placeholder="MA" /></FormControl><FormMessage /></FormItem>
                                )}
                            />
                            <div className="flex gap-2">
                                {editingCompetitor ? (
                                    <>
                                        <Button type="submit" className="flex-1">Salvar</Button>
                                        <Button type="button" variant="outline" onClick={handleCancelEdit}>Cancelar</Button>
                                    </>
                                ) : (
                                    <Button type="submit" className="w-full"><PlusCircle className="mr-2 h-4 w-4" /> Adicionar</Button>
                                )}
                            </div>
                        </div>
                    </form>
                </Form>
            
                <div className="flex-1 overflow-auto mt-6">
                    <ScrollArea className="h-full pr-4">
                        <div className="space-y-2">
                            {competitors.map(c => (
                                <div key={c.id} className="flex items-center justify-between p-3 border rounded-lg">
                                    <div className="flex items-center gap-3">
                                        <Building className="h-5 w-5 text-muted-foreground" />
                                        <div>
                                            <p className="font-semibold">{c.name}</p>
                                            <p className="text-sm text-muted-foreground">{c.address}, {c.city} - {c.state}</p>
                                        </div>
                                    </div>
                                    <div className="flex gap-1">
                                        <Button variant="ghost" size="icon" onClick={() => handleStartEdit(c)}><Edit className="h-4 w-4" /></Button>
                                        <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setCompetitorToDelete(c)}><Trash2 className="h-4 w-4" /></Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </ScrollArea>
                </div>
            </div>
             <DialogFooter className="border-t pt-4">
                <Button variant="outline" onClick={onClose}>Fechar</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>

    <DeleteConfirmationDialog 
        open={!!competitorToDelete}
        onOpenChange={() => setCompetitorToDelete(null)}
        onConfirm={handleDeleteConfirm}
        itemName={`o concorrente "${competitorToDelete?.name}" e todos os seus produtos e preços`}
    />
    </>
  );
}
