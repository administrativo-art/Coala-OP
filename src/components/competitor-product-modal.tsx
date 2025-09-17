"use client";

import { useEffect, useMemo, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useCompetitors } from '@/hooks/use-competitors';
import { useProductSimulation } from '@/hooks/use-product-simulation';
import { useToast } from '@/hooks/use-toast';
import { type CompetitorProduct } from '@/types';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Search } from 'lucide-react';
import { Switch } from './ui/switch';
import { ScrollArea } from './ui/scroll-area';

const productSchema = z.object({
  competitorId: z.string().min(1, 'Selecione um concorrente.'),
  itemName: z.string().min(1, 'O nome da mercadoria é obrigatório.'),
  unit: z.string().min(1, 'A unidade de venda é obrigatória (ex: 300ml, 1un).'),
  ksProductId: z.string().nullable().optional(),
  active: z.boolean(),
});

type FormValues = z.infer<typeof productSchema>;

interface CompetitorProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  productToEdit: CompetitorProduct | null;
}

export function CompetitorProductModal({ isOpen, onClose, productToEdit }: CompetitorProductModalProps) {
  const { competitors, addProduct, updateProduct } = useCompetitors();
  const { simulations } = useProductSimulation();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const form = useForm<FormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      competitorId: '',
      itemName: '',
      unit: '',
      ksProductId: null,
      active: true,
    }
  });
  
  const filteredSimulations = useMemo(() => {
    if (!searchTerm) return simulations;
    return simulations.filter(sim =>
      sim.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [simulations, searchTerm]);


  useEffect(() => {
    if (isOpen) {
      if (productToEdit) {
        form.reset({
          competitorId: productToEdit.competitorId,
          itemName: productToEdit.itemName,
          unit: productToEdit.unit,
          ksProductId: productToEdit.ksProductId,
          active: productToEdit.active,
        });
      } else {
        form.reset({
          competitorId: '',
          itemName: '',
          unit: '',
          ksProductId: null,
          active: true,
        });
      }
    }
  }, [isOpen, productToEdit, form]);

  const processSubmit = async (values: FormValues) => {
    setIsSubmitting(true);
    try {
        if (productToEdit) {
          await updateProduct(productToEdit.id, values);
          toast({ title: 'Mercadoria atualizada com sucesso!' });
        } else {
          await addProduct(values);
          toast({ title: 'Mercadoria adicionada com sucesso!' });
        }
        return true;
    } catch (error) {
        toast({ variant: 'destructive', title: 'Erro ao salvar', description: 'Não foi possível salvar a mercadoria.' });
        return false;
    } finally {
        setIsSubmitting(false);
    }
  };
  
  const handleSaveAndClose = async (values: FormValues) => {
    const success = await processSubmit(values);
    if(success) {
        onClose();
    }
  };

  const handleSaveAndAddAnother = async (values: FormValues) => {
    const success = await processSubmit(values);
    if(success) {
        form.reset({
            ...values,
            itemName: '',
            unit: '',
            ksProductId: null,
            active: true,
        });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar mercadoria do concorrente</DialogTitle>
          <DialogDescription>
            Preencha os detalhes da mercadoria como ela é vendida pelo concorrente.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form className="space-y-4">
            <ScrollArea className="h-[60vh] -mx-6 px-6">
             <div className="space-y-4 py-4">
                 <FormField
                    control={form.control}
                    name="competitorId"
                    render={({ field }) => (
                        <FormItem>
                        <FormLabel>Concorrente</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value} disabled={!!productToEdit}>
                            <FormControl>
                                <SelectTrigger>
                                    <SelectValue placeholder="Selecione o concorrente" />
                                </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                                {competitors.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <FormMessage />
                        </FormItem>
                    )}
                 />
                <FormField
                  control={form.control}
                  name="itemName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nome da mercadoria</FormLabel>
                      <FormControl><Input placeholder="Ex: Milkshake Morango P" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="unit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Unidade de venda</FormLabel>
                      <FormControl><Input placeholder="Ex: 300ml, 500g, 1un" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="ksProductId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Correlacionar com sua mercadoria (opcional)</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || ''}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione uma mercadoria..." />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                           <div className="p-2">
                             <div className="relative">
                               <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                               <Input
                                 placeholder="Buscar mercadoria..."
                                 className="pl-8"
                                 value={searchTerm}
                                 onChange={(e) => setSearchTerm(e.target.value)}
                               />
                             </div>
                           </div>
                          <SelectItem value="">Nenhuma</SelectItem>
                          <ScrollArea className="h-48">
                            {filteredSimulations.map((sim) => (
                              <SelectItem key={sim.id} value={sim.id}>
                                {sim.name}
                              </SelectItem>
                            ))}
                          </ScrollArea>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                 <FormField
                  control={form.control}
                  name="active"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                      <div className="space-y-0.5">
                        <FormLabel>Mercadoria ativa</FormLabel>
                        <DialogDescription className="text-xs">
                            Desmarque para ocultar esta mercadoria das análises.
                        </DialogDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
             </div>
            </ScrollArea>
             <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>Cancelar</Button>
              <Button type="button" variant="secondary" onClick={form.handleSubmit(handleSaveAndClose)} disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar e fechar
              </Button>
               <Button type="button" onClick={form.handleSubmit(handleSaveAndAddAnother)} disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar e adicionar outra
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
