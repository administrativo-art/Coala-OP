
"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { type ProductSimulation, type ProductSimulationItem } from '@/types';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useProductSimulation } from '@/hooks/use-product-simulation';
import { convertValue, getUnitsForCategory } from '@/lib/conversion';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PlusCircle, Trash2, ArrowRight } from 'lucide-react';
import { Separator } from './ui/separator';

const simulationItemSchema = z.object({
  baseProductId: z.string().min(1, 'Selecione um insumo.'),
  quantity: z.coerce.number().min(0.001, 'Deve ser > 0'),
  unit: z.string().min(1, 'Obrigatório'),
});

const simulationSchema = z.object({
  name: z.string().min(1, 'O nome da simulação é obrigatório.'),
  items: z.array(simulationItemSchema).min(1, 'Adicione pelo menos um insumo.'),
  operationPercentage: z.coerce.number().min(0).optional(),
  salePrice: z.coerce.number().min(0).optional(),
  notes: z.string().optional(),
});

type SimulationFormValues = z.infer<typeof simulationSchema>;

interface AddEditSimulationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  simulationToEdit: ProductSimulation | null;
}

const formatCurrency = (value: number) => {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

export function AddEditSimulationModal({ open, onOpenChange, simulationToEdit }: AddEditSimulationModalProps) {
  const { addSimulation, updateSimulation, simulationItems } = useProductSimulation();
  const { baseProducts } = useBaseProducts();
  const [selectedBaseProduct, setSelectedBaseProduct] = useState('');

  const form = useForm<SimulationFormValues>({
    resolver: zodResolver(simulationSchema),
    defaultValues: { name: '', items: [], operationPercentage: 15, salePrice: 0, notes: '' },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'items' });
  const watchedItems = form.watch('items');
  const watchedOperationPercentage = form.watch('operationPercentage');
  const watchedSalePrice = form.watch('salePrice');

  useEffect(() => {
    if (open && simulationToEdit) {
      const itemsForForm = simulationItems
        .filter(item => item.simulationId === simulationToEdit.id)
        .map(item => ({
          baseProductId: item.baseProductId,
          quantity: item.quantity,
          unit: item.unit,
        }));

      form.reset({
        name: simulationToEdit.name,
        items: itemsForForm,
        operationPercentage: simulationToEdit.operationPercentage,
        salePrice: simulationToEdit.salePrice,
        notes: simulationToEdit.notes,
      });
    } else if (open) {
      form.reset({ name: '', items: [], operationPercentage: 15, salePrice: 0, notes: '' });
    }
  }, [open, simulationToEdit, simulationItems, form]);

  const { cmv, partialCosts } = useMemo(() => {
    let totalCmv = 0;
    const partials: Record<number, number> = {};

    watchedItems.forEach((item, index) => {
      const baseProduct = baseProducts.find(bp => bp.id === item.baseProductId);
      if (!baseProduct || !baseProduct.lastEffectivePrice || !item.quantity || !item.unit) {
        partials[index] = 0;
        return;
      }
      const convertedQuantity = convertValue(item.quantity, item.unit, baseProduct.unit, baseProduct.category);
      const partialCost = convertedQuantity * baseProduct.lastEffectivePrice.pricePerUnit;
      partials[index] = partialCost;
      totalCmv += partialCost;
    });

    return { cmv: totalCmv, partialCosts: partials };
  }, [watchedItems, baseProducts]);

  const grossCost = useMemo(() => {
    const percentage = watchedOperationPercentage || 0;
    return cmv + (cmv * (percentage / 100));
  }, [cmv, watchedOperationPercentage]);

  const profitValue = useMemo(() => {
    const price = watchedSalePrice || 0;
    return price - grossCost;
  }, [grossCost, watchedSalePrice]);

  const profitPercentage = useMemo(() => {
    const price = watchedSalePrice || 0;
    if (price === 0) return 0;
    return (profitValue / price) * 100;
  }, [profitValue, watchedSalePrice]);

  const handleAddItem = () => {
    const product = baseProducts.find(bp => bp.id === selectedBaseProduct);
    if (product) {
      append({ baseProductId: product.id, quantity: 1, unit: product.unit });
      setSelectedBaseProduct('');
    }
  };

  const onSubmit = async (values: SimulationFormValues) => {
    const finalData = {
      ...values,
      totalCmv: cmv,
      grossCost,
      profitValue,
      profitPercentage,
    };

    if (simulationToEdit) {
      await updateSimulation({ ...simulationToEdit, ...finalData });
    } else {
      await addSimulation(finalData);
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{simulationToEdit ? 'Editar análise de custo' : 'Nova análise de custo'}</DialogTitle>
          <DialogDescription>Construa a composição da sua mercadoria, defina preços e analise a lucratividade.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex-1 overflow-hidden flex flex-col">
            <ScrollArea className="flex-1 pr-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Composition Column */}
                <div className="space-y-4">
                  <FormField control={form.control} name="name" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nome da mercadoria</FormLabel>
                        <FormControl><Input placeholder="Ex: Milkshake de Morango (P)" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                  )}/>
                  
                  <h3 className="font-semibold text-lg border-t pt-4">Composição (CMV)</h3>
                  
                  <div className="rounded-md border p-2 space-y-2">
                    {fields.map((field, index) => {
                      const baseProduct = baseProducts.find(bp => bp.id === watchedItems[index].baseProductId);
                      const availableUnits = baseProduct ? getUnitsForCategory(baseProduct.category) : [];
                      return (
                        <div key={field.id} className="grid grid-cols-[1fr_80px_100px_auto] items-center gap-2 p-2 rounded bg-muted/50">
                          <p className="font-medium truncate" title={baseProduct?.name}>{baseProduct?.name}</p>
                          <FormField control={form.control} name={`items.${index}.quantity`} render={({ field }) => (
                            <FormItem><FormControl><Input type="number" {...field} /></FormControl></FormItem>
                          )}/>
                           <FormField control={form.control} name={`items.${index}.unit`} render={({ field }) => (
                            <FormItem><FormControl>
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <SelectTrigger><SelectValue/></SelectTrigger>
                                    <SelectContent>{availableUnits.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                                </Select>
                            </FormControl></FormItem>
                          )}/>
                          <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => remove(index)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )
                    })}
                  </div>

                  <div className="flex gap-2">
                    <Select value={selectedBaseProduct} onValueChange={setSelectedBaseProduct}>
                      <SelectTrigger><SelectValue placeholder="Selecione um insumo para adicionar..." /></SelectTrigger>
                      <SelectContent>
                        {baseProducts.map(bp => <SelectItem key={bp.id} value={bp.id}>{bp.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button type="button" onClick={handleAddItem} disabled={!selectedBaseProduct}><PlusCircle className="mr-2"/>Adicionar</Button>
                  </div>
                </div>

                {/* Analysis Column */}
                <div className="space-y-4">
                   <h3 className="font-semibold text-lg">Resultados da Análise</h3>
                   <div className="rounded-lg border p-4 space-y-3">
                    <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">CMV Total</span>
                        <span className="font-bold text-lg">{formatCurrency(cmv)}</span>
                    </div>
                    <Separator />
                     <FormField control={form.control} name="operationPercentage" render={({ field }) => (
                      <FormItem className="flex justify-between items-center">
                        <FormLabel>+ % Operação</FormLabel>
                        <FormControl>
                            <div className="relative w-24">
                                <Input type="number" className="pr-8" {...field} />
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                            </div>
                        </FormControl>
                      </FormItem>
                    )}/>
                     <div className="flex justify-between items-center text-primary font-bold">
                        <span>= Custo Bruto</span>
                        <span className="text-xl">{formatCurrency(grossCost)}</span>
                    </div>
                     <Separator />
                     <FormField control={form.control} name="salePrice" render={({ field }) => (
                      <FormItem className="flex justify-between items-center">
                        <FormLabel>Preço de Venda</FormLabel>
                        <FormControl>
                            <div className="relative w-32">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">R$</span>
                                <Input type="number" className="pl-8 font-semibold" {...field} />
                            </div>
                        </FormControl>
                      </FormItem>
                    )}/>
                     <Separator />
                      <div className="flex justify-between items-center text-green-600 font-bold">
                        <span>= Lucro Bruto</span>
                        <div className="text-right">
                            <p className="text-xl">{formatCurrency(profitValue)}</p>
                            <p className="text-sm">({profitPercentage.toFixed(2)}%)</p>
                        </div>
                    </div>
                   </div>
                   <FormField control={form.control} name="notes" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Observações</FormLabel>
                        <FormControl><Textarea placeholder="Adicione notas sobre esta simulação (opcional)" {...field} /></FormControl>
                      </FormItem>
                   )}/>
                </div>
              </div>
            </ScrollArea>
            <DialogFooter className="pt-4 border-t mt-auto">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit">{simulationToEdit ? 'Salvar Alterações' : 'Criar Simulação'}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
