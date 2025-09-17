
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
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './ui/command';
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Switch } from './ui/switch';


const productSchema = z.object({
  competitorId: z.string().min(1, 'Selecione um concorrente.'),
  itemName: z.string().min(1, 'O nome é obrigatório.'),
  unit: z.string().min(1, 'A unidade é obrigatória (ex: 300ml, 1un).'),
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
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
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
          toast({ title: 'Produto atualizado com sucesso!' });
        } else {
          await addProduct(values);
          toast({ title: 'Produto adicionado com sucesso!' });
        }
        return true;
    } catch (error) {
        toast({ variant: 'destructive', title: 'Erro ao salvar', description: 'Não foi possível salvar o produto.' });
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
            ...values, // Mantém o concorrente selecionado
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
          <DialogTitle>{productToEdit ? 'Editar Produto do Concorrente' : 'Adicionar Produto do Concorrente'}</DialogTitle>
          <DialogDescription>
            Preencha os detalhes do produto como ele é vendido pelo concorrente.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form className="space-y-4">
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
                  <FormLabel>Nome do Item</FormLabel>
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
                  <FormLabel>Unidade de Venda</FormLabel>
                  <FormControl><Input placeholder="Ex: 300ml, 500g, 1un" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
                control={form.control}
                name="ksProductId"
                render={({ field }) => (
                    <FormItem className="flex flex-col">
                    <FormLabel>Correlacionar com Produto KS (Opcional)</FormLabel>
                    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                        <PopoverTrigger asChild>
                        <FormControl>
                            <Button
                            variant="outline"
                            role="combobox"
                            className={cn(
                                "w-full justify-between",
                                !field.value && "text-muted-foreground"
                            )}
                            >
                            {field.value
                                ? simulations.find(
                                    (sim) => sim.id === field.value
                                )?.name
                                : "Selecione um produto seu..."}
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                        </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                        <Command>
                            <CommandInput placeholder="Buscar produto..." />
                            <CommandEmpty>Nenhum produto encontrado.</CommandEmpty>
                            <CommandGroup>
                                <CommandList>
                                <CommandItem
                                    onSelect={() => {
                                        field.onChange(null);
                                        setPopoverOpen(false);
                                    }}
                                >
                                    Nenhum
                                </CommandItem>
                                {simulations.map((sim) => (
                                    <CommandItem
                                    value={sim.name}
                                    key={sim.id}
                                    onSelect={() => {
                                        field.onChange(sim.id);
                                        setPopoverOpen(false);
                                    }}
                                    >
                                    <Check
                                        className={cn(
                                        "mr-2 h-4 w-4",
                                        sim.id === field.value
                                            ? "opacity-100"
                                            : "opacity-0"
                                        )}
                                    />
                                    {sim.name}
                                    </CommandItem>
                                ))}
                                </CommandList>
                            </CommandGroup>
                        </Command>
                        </PopoverContent>
                    </Popover>
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
                    <FormLabel>Ativo</FormLabel>
                     <DialogDescription className="text-xs">
                        Desmarque para ocultar este produto das análises.
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
             <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>Cancelar</Button>
              <Button type="button" variant="secondary" onClick={form.handleSubmit(handleSaveAndClose)} disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar e Fechar
              </Button>
               <Button type="button" onClick={form.handleSubmit(handleSaveAndAddAnother)} disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar e Adicionar Outro
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
