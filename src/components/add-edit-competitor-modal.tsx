
"use client";

import React, { useEffect } from 'react';
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
import { PlusCircle } from 'lucide-react';
import { type Competitor } from '@/types';

const competitorSchema = z.object({
  name: z.string().min(1, 'O nome é obrigatório.'),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
});

type CompetitorFormValues = z.infer<typeof competitorSchema>;

interface AddEditCompetitorModalProps {
  isOpen: boolean;
  onClose: () => void;
  competitorToEdit: Competitor | null;
}

export function AddEditCompetitorModal({ isOpen, onClose, competitorToEdit }: AddEditCompetitorModalProps) {
  const { addCompetitor, updateCompetitor } = useCompetitors();

  const form = useForm<CompetitorFormValues>({
    resolver: zodResolver(competitorSchema),
    defaultValues: { name: '', address: '', city: '', state: '' },
  });

  useEffect(() => {
    if (competitorToEdit) {
      form.reset(competitorToEdit);
    } else {
      form.reset({ name: '', address: '', city: '', state: '' });
    }
  }, [competitorToEdit, form, isOpen]);

  const onSubmit = async (values: CompetitorFormValues) => {
    if (competitorToEdit) {
      await updateCompetitor(competitorToEdit.id, { ...competitorToEdit, ...values });
    } else {
      await addCompetitor({ ...values, active: true });
    }
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>{competitorToEdit ? 'Editar Concorrente' : 'Adicionar Novo Concorrente'}</DialogTitle>
                <DialogDescription>
                    {competitorToEdit ? 'Altere os dados do concorrente abaixo.' : 'Preencha os dados do novo concorrente.'}
                </DialogDescription>
            </DialogHeader>
             <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
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
                    <div className="grid grid-cols-2 gap-4">
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
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
                        <Button type="submit">Salvar</Button>
                    </DialogFooter>
                </form>
            </Form>
        </DialogContent>
    </Dialog>
  );
}
