
"use client";

import React, { useEffect, useMemo } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { type ProductSimulation } from '@/types';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useProductSimulation } from '@/hooks/use-product-simulation';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PlusCircle, Trash2 } from 'lucide-react';

const simulationItemSchema = z.object({
  baseProductId: z.string().min(1, 'Selecione um insumo.'),
  quantity: z.coerce.number().min(0.001, 'Deve ser > 0'),
});

const simulationSchema = z.object({
  name: z.string().min(1, 'O nome da mercadoria é obrigatório.'),
  category: z.string().optional(),
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

const formatCurrency = (value: number | undefined) => {
    if (value === undefined || isNaN(value)) return 'R$ 0,00';
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

export function AddEditSimulationModal({ open, onOpenChange, simulationToEdit }: AddEditSimulationModalProps) {
  const { addSimulation, updateSimulation, simulationItems } = useProductSimulation();
  const { baseProducts } = useBaseProducts();

  const form = useForm<SimulationFormValues>({
    resolver: zodResolver(simulationSchema),
    defaultValues: { name: '', category: '', items: [], operationPercentage: 15, salePrice: 0, notes: '' },
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
        category: simulationToEdit.category,
        items: itemsForForm,
        operationPercentage: simulationToEdit.operationPercentage,
        salePrice: simulationToEdit.salePrice,
        notes: simulationToEdit.notes,
      });
    } else if (open) {
      form.reset({ name: '', category: '', items: [], operationPercentage: 15, salePrice: 0, notes: '' });
    }
  }, [open, simulationToEdit, simulationItems, form]);

  const { cmv, partialCosts, unitCosts } = useMemo(() => {
    let totalCmv = 0;
    const partials: Record<number, number> = {};
    const units: Record<number, number> = {};

    watchedItems.forEach((item, index) => {
      const baseProduct = baseProducts.find(bp => bp.id === item.baseProductId);
      if (!baseProduct || !baseProduct.lastEffectivePrice?.pricePerUnit || !item.quantity) {
        partials[index] = 0;
        units[index] = 0;
        return;
      }
      try {
        const pricePerBaseUnit = baseProduct.lastEffectivePrice.pricePerUnit;
        units[index] = pricePerBaseUnit;

        const partialCost = item.quantity * pricePerBaseUnit;
        partials[index] = partialCost;
        totalCmv += partialCost;
      } catch (e) {
        console.error("Error calculating CMV for item:", item, e);
        partials[index] = 0;
        units[index] = 0;
      }
    });

    return { cmv: totalCmv, partialCosts: partials, unitCosts: units };
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

  const handleAddItem = (baseProductId: string) => {
    const product = baseProducts.find(bp => bp.id === baseProductId);
    if (product) {
      append({ baseProductId: product.id, quantity: 1 });
    }
  };

  const onSubmit = async (values: SimulationFormValues) => {
    const finalData = {
      ...values,
      items: values.items.map(item => {
        const bp = baseProducts.find(b => b.id === item.baseProductId);
        return {
          ...item,
          unit: bp?.unit || '',
        };
      }),
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
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Nova análise de custo</DialogTitle>
          <DialogDescription>Construa a composição da sua mercadoria, defina preços e analise a lucratividade.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex-1 overflow-hidden flex flex-col">
            <ScrollArea className="flex-1 pr-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Composition Column */}
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                     <FormField control={form.control} name="name" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nome da mercadoria</FormLabel>
                        <FormControl><Input placeholder="Ex: Milkshake de Morango (P)" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}/>
                    <FormField control={form.control} name="category" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Categoria (Opcional)</FormLabel>
                        <FormControl><Input placeholder="Ex: Milkshakes" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}/>
                  </div>
                  
                  <div className="border-t pt-4">
                     <div className="flex justify-between items-start">
                        <h3 className="font-semibold text-lg">Composição (CMV)</h3>
                        <p className="text-xs text-muted-foreground text-right max-w-[200px]">A unidade de medida é travada na que foi configurada para cada insumo base.</p>
                     </div>
                  </div>
                  
                  <div className="rounded-md border p-2 space-y-2">
                    {fields.length > 0 && (
                        <div className="grid grid-cols-[1fr_80px_80px_90px_90px_auto] items-center gap-x-2 px-1 text-xs text-muted-foreground font-semibold">
                            <span>Insumo Base</span>
                            <span className="text-center">Qtd.</span>
                            <span className="text-center">Unidade</span>
                            <span className="text-right">Custo/Unid.</span>
                            <span className="text-right">Custo Total</span>
                            <span className="w-8"></span>
                        </div>
                    )}
                    {fields.map((field, index) => {
                      const baseProduct = baseProducts.find(bp => bp.id === watchedItems[index].baseProductId);
                      return (
                        <div key={field.id} className="grid grid-cols-[1fr_80px_80px_90px_90px_auto] items-center gap-x-2 p-2 rounded bg-muted/50">
                          <p className="font-medium truncate text-sm" title={baseProduct?.name}>{baseProduct?.name}</p>
                          <FormField control={form.control} name={`items.${index}.quantity`} render={({ field: qtyField }) => (
                            <FormItem><FormControl><Input type="number" {...qtyField} className="text-center" /></FormControl><FormMessage /></FormItem>
                          )}/>
                           <div className="flex items-center justify-center px-3 py-2 h-10 rounded-md border border-input bg-background">
                              <span className="text-sm font-medium">{baseProduct?.unit || '...'}</span>
                           </div>
                           <div className="font-semibold text-sm w-full text-right">
                            {formatCurrency(unitCosts[index])}
                           </div>
                           <div className="font-semibold text-primary text-sm w-full text-right">
                            {formatCurrency(partialCosts[index])}
                           </div>
                          <Button type="button" variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => remove(index)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )
                    })}
                  </div>

                  <Select onValueChange={handleAddItem}>
                      <SelectTrigger><SelectValue placeholder="Selecione um insumo para adicionar..." /></SelectTrigger>
                      <SelectContent>
                        {baseProducts.map(bp => <SelectItem key={bp.id} value={bp.id}>{bp.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                </div>

                {/* Analysis Column */}
                <div className="space-y-4">
                   <h3 className="font-semibold text-lg">Resultados da análise</h3>
                   <div className="rounded-lg border p-4 space-y-3">
                    <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">CMV total</span>
                        <span className="font-bold text-lg">{formatCurrency(cmv)}</span>
                    </div>
                    <FormField control={form.control} name="operationPercentage" render={({ field }) => (
                      <FormItem className="flex justify-between items-center">
                        <FormLabel>+ % operação</FormLabel>
                        <FormControl>
                            <div className="relative w-24">
                                <Input type="number" className="pr-8 text-right" {...field} value={field.value ?? ''} />
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                            </div>
                        </FormControl>
                      </FormItem>
                    )}/>
                     <div className="flex justify-between items-center text-primary font-bold">
                        <span>= Custo bruto</span>
                        <span className="text-xl">{formatCurrency(grossCost)}</span>
                    </div>
                     <FormField control={form.control} name="salePrice" render={({ field }) => (
                      <FormItem className="flex justify-between items-center">
                        <FormLabel>Preço de venda</FormLabel>
                        <FormControl>
                            <div className="relative w-32">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">R$</span>
                                <Input type="number" step="0.01" className="pl-8 font-semibold text-right" {...field} value={field.value ?? ''} />
                            </div>
                        </FormControl>
                      </FormItem>
                    )}/>
                      <div className="flex justify-between items-center text-green-600 font-bold">
                        <span>= Lucro bruto</span>
                        <div className="text-right">
                            <p className="text-xl">{formatCurrency(profitValue)}</p>
                            <p className="text-sm">({profitPercentage.toFixed(2)}%)</p>
                        </div>
                    </div>
                   </div>
                   <FormField control={form.control} name="notes" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Observações</FormLabel>
                        <FormControl><Textarea placeholder="Adicione notas sobre esta simulação (opcional)" {...field} value={field.value ?? ''} /></FormControl>
                      </FormItem>
                   )}/>
                </div>
              </div>
            </ScrollArea>
            <DialogFooter className="pt-4 border-t mt-auto">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit">Salvar Análise</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
    </>
  );
}
