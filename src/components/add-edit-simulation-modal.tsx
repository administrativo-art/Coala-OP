

"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { useForm, useFieldArray, useWatch, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { type ProductSimulation, type SimulationCategory } from '@/types';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useProductSimulation } from '@/hooks/use-product-simulation';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PlusCircle, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Switch } from './ui/switch';
import { cn } from '@/lib/utils';
import { useProductSimulationCategories } from '@/hooks/use-product-simulation-categories';
import { CategoryManagementModal } from './category-management-modal';
import { getUnitsForCategory, unitCategories, type UnitCategory } from '@/lib/conversion';

const simulationItemSchema = z.object({
  baseProductId: z.string().min(1, 'Selecione um insumo.'),
  quantity: z.coerce.number().min(0.001, 'Deve ser > 0'),
  useDefault: z.boolean(),
  overrideCostPerUnit: z.coerce.number().optional(),
  overrideUnit: z.string().optional(),
});

const simulationSchema = z.object({
  name: z.string().min(1, 'O nome da mercadoria é obrigatório.'),
  categoryId: z.string().nullable().optional(),
  lineId: z.string().nullable().optional(),
  items: z.array(simulationItemSchema).min(1, 'Adicione pelo menos um insumo.'),
  operationPercentage: z.coerce.number().min(0).optional(),
  salePrice: z.coerce.number().min(0).optional(),
  notes: z.string().optional(),
}).superRefine((data, ctx) => {
    data.items.forEach((item, index) => {
        if (!item.useDefault) {
            if (!item.overrideUnit) {
                ctx.addIssue({
                    path: [`items`, index, 'overrideUnit'],
                    message: "Unidade é obrigatória.",
                });
            }
             if (item.overrideCostPerUnit === undefined || item.overrideCostPerUnit <= 0) {
                ctx.addIssue({
                    path: [`items`, index, 'overrideCostPerUnit'],
                    message: "Custo deve ser > 0.",
                });
            }
        }
    });
});


type SimulationFormValues = z.infer<typeof simulationSchema>;

interface AddEditSimulationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  simulationToEdit: ProductSimulation | null;
}

const formatCurrency = (value: number | undefined | null) => {
    if (value === undefined || value === null || isNaN(value)) return 'R$ 0,00';
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

export function AddEditSimulationModal({ open, onOpenChange, simulationToEdit }: AddEditSimulationModalProps) {
  const { addSimulation, updateSimulation, simulationItems } = useProductSimulation();
  const { baseProducts } = useBaseProducts();
  const { categories } = useProductSimulationCategories();
  
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);

  const form = useForm<SimulationFormValues>({
    resolver: zodResolver(simulationSchema),
    defaultValues: { name: '', categoryId: null, lineId: null, items: [], operationPercentage: 15, salePrice: 0, notes: '' },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'items' });
  const watchedItems = useWatch({ control: form.control, name: 'items' });
  const watchedOperationPercentage = form.watch('operationPercentage');
  const watchedSalePrice = form.watch('salePrice');

  useEffect(() => {
    if (open) {
        if (simulationToEdit) {
            const itemsForForm = simulationItems
                .filter(item => item.simulationId === simulationToEdit.id)
                .map(item => ({
                    baseProductId: item.baseProductId,
                    quantity: item.quantity,
                    useDefault: item.useDefault,
                    overrideCostPerUnit: item.overrideCostPerUnit,
                    overrideUnit: item.overrideUnit,
                }));

            form.reset({
                name: simulationToEdit.name,
                categoryId: simulationToEdit.categoryId,
                lineId: simulationToEdit.lineId,
                items: itemsForForm,
                operationPercentage: simulationToEdit.operationPercentage,
                salePrice: simulationToEdit.salePrice,
                notes: simulationToEdit.notes,
            });
        } else {
            form.reset({ name: '', categoryId: null, lineId: null, items: [], operationPercentage: 15, salePrice: 0, notes: '' });
        }
    }
  }, [open, simulationToEdit, simulationItems, form]);
  
  const mainCategories = useMemo(() => categories.filter(c => c.parentId === null), [categories]);
  const lines = useMemo(() => categories.filter(c => c.parentId !== null), [categories]);
  
  const { cmv, partialCosts } = useMemo(() => {
    let totalCmv = 0;
    const partials: Record<number, number> = {};

    watchedItems.forEach((item, index) => {
      const baseProduct = baseProducts.find(bp => bp.id === item.baseProductId);
      if (!baseProduct || !item.quantity) {
        partials[index] = 0;
        return;
      }
      try {
        const pricePerUnit = item.useDefault 
          ? (baseProduct.lastEffectivePrice?.pricePerUnit || 0)
          : (item.overrideCostPerUnit || 0);
          
        const unit = item.useDefault ? baseProduct.unit : item.overrideUnit;

        if (!unit) {
             partials[index] = 0;
             return;
        }

        const partialCost = item.quantity * pricePerUnit;
        partials[index] = partialCost;
        totalCmv += partialCost;
      } catch (e) {
        console.error("Error calculating CMV for item:", item, e);
        partials[index] = 0;
      }
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

  const handleAddItem = (baseProductId: string) => {
    const product = baseProducts.find(bp => bp.id === baseProductId);
    if (product) {
      append({ 
          baseProductId: product.id,
          quantity: 1,
          useDefault: !!product.lastEffectivePrice,
          overrideCostPerUnit: product.lastEffectivePrice?.pricePerUnit || 0,
          overrideUnit: product.unit,
        });
    }
  };

  const onSubmit = async (values: SimulationFormValues) => {
    const finalData = {
      ...values,
      lineId: values.lineId || null,
      categoryId: values.categoryId || null,
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
                    <FormField control={form.control} name="name" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nome da mercadoria</FormLabel>
                        <FormControl><Input placeholder="Ex: Milkshake de Morango (P)" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}/>
                    
                    <div className="grid grid-cols-2 gap-2">
                        <FormField control={form.control} name="categoryId" render={({ field }) => (
                            <FormItem>
                                <FormLabel>Categoria</FormLabel>
                                <div className="flex items-center gap-1">
                                    <Select onValueChange={(v) => field.onChange(v === 'none' ? null : v)} value={field.value || 'none'}>
                                        <FormControl>
                                            <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            <SelectItem value="none">Nenhuma</SelectItem>
                                            {mainCategories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                    <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => setIsCategoryModalOpen(true)}><PlusCircle className="h-5 w-5" /></Button>
                                </div>
                                <FormMessage />
                            </FormItem>
                        )}/>
                        <FormField control={form.control} name="lineId" render={({ field }) => (
                            <FormItem>
                                <FormLabel>Linha</FormLabel>
                                <div className="flex items-center gap-1">
                                    <Select onValueChange={(v) => field.onChange(v === 'none' ? null : v)} value={field.value || 'none'}>
                                        <FormControl>
                                            <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            <SelectItem value="none">Nenhuma</SelectItem>
                                            {lines.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                    <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => setIsCategoryModalOpen(true)}><PlusCircle className="h-5 w-5" /></Button>
                                </div>
                                <FormMessage />
                            </FormItem>
                        )}/>
                    </div>

                  
                  <div className="border-t pt-4">
                     <div className="flex justify-between items-start">
                        <h3 className="font-semibold text-lg">Composição (CMV)</h3>
                     </div>
                  </div>
                  
                  <div className="rounded-md border p-2 space-y-2">
                    <div className="grid grid-cols-[1fr_80px_100px_100px_100px_auto] items-center gap-x-2 px-1 text-xs text-muted-foreground font-semibold">
                        <span>Insumo Base</span>
                        <span className="text-center">Qtd.</span>
                        <span className="text-center">Unid.</span>
                        <span className="text-right">Custo/Unid.</span>
                        <span className="text-right">Custo Total</span>
                        <span className="w-8"></span>
                    </div>
                    {fields.map((field, index) => {
                        if (!watchedItems[index]) return null;
                        const baseProduct = baseProducts.find(bp => bp.id === watchedItems[index].baseProductId);
                        const useDefault = watchedItems[index].useDefault;
                        const hasDefaultCost = !!baseProduct?.lastEffectivePrice;

                        return (
                            <div key={field.id} className="p-2 rounded bg-muted/50">
                            <div className="grid grid-cols-[1fr_80px_100px_100px_100px_auto] items-center gap-x-2">
                                <p className="font-medium truncate text-sm" title={baseProduct?.name}>{baseProduct?.name}</p>
                                <FormField control={form.control} name={`items.${index}.quantity`} render={({ field: qtyField }) => (
                                <FormItem><FormControl><Input type="number" {...qtyField} className="text-center" /></FormControl><FormMessage /></FormItem>
                                )}/>
                                
                                <FormField
                                    control={form.control}
                                    name={`items.${index}.overrideUnit`}
                                    render={({ field: unitField }) => (
                                        <FormItem>
                                            <Select onValueChange={unitField.onChange} value={useDefault ? baseProduct?.unit : unitField.value} disabled={useDefault}>
                                                <FormControl>
                                                    <SelectTrigger className={cn(useDefault && "bg-background border-none ring-0 focus-visible:ring-0 text-muted-foreground font-semibold")}>
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {unitCategories.map(cat => (
                                                        <React.Fragment key={cat}>
                                                            {getUnitsForCategory(cat as UnitCategory).map(unit => (
                                                                <SelectItem key={unit} value={unit}>{unit}</SelectItem>
                                                            ))}
                                                        </React.Fragment>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <FormMessage/>
                                        </FormItem>
                                    )}
                                />
                                
                                <FormField
                                    control={form.control}
                                    name={`items.${index}.overrideCostPerUnit`}
                                    render={({ field: costField }) => (
                                        <FormItem>
                                            <Input
                                                type="number"
                                                step="any"
                                                value={useDefault ? baseProduct?.lastEffectivePrice?.pricePerUnit?.toFixed(4) ?? '' : costField.value ?? ''}
                                                onChange={costField.onChange}
                                                disabled={useDefault}
                                                className={cn("text-right", useDefault && "bg-background border-none ring-0 focus-visible:ring-0 text-muted-foreground font-semibold")}
                                            />
                                            <FormMessage/>
                                        </FormItem>
                                    )}
                                />

                            <div className="font-semibold text-primary text-sm w-full text-right">
                                {formatCurrency(partialCosts[index])}
                            </div>
                                <Button type="button" variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => remove(index)}>
                                <Trash2 className="h-4 w-4" />
                                </Button>
                            </div>
                            <div className="flex justify-end mt-1">
                                <FormField
                                    control={form.control}
                                    name={`items.${index}.useDefault`}
                                    render={({ field: switchField }) => (
                                        <FormItem className="flex items-center gap-2">
                                            <FormControl>
                                                <Switch 
                                                    checked={switchField.value} 
                                                    onCheckedChange={switchField.onChange} 
                                                    disabled={!hasDefaultCost}
                                                />
                                            </FormControl>
                                            <FormLabel className="text-xs text-muted-foreground">
                                                {hasDefaultCost ? 'Usar custo/unidade padrão' : 'Sem custo padrão'}
                                            </FormLabel>
                                        </FormItem>
                                    )}
                                />
                            </div>
                            </div>
                        )
                    })}
                  </div>

                  <Select onValueChange={handleAddItem}>
                      <SelectTrigger><SelectValue placeholder="Selecione um insumo para adicionar..." /></SelectTrigger>
                      <SelectContent>
                        {baseProducts.map(bp => (
                          <SelectItem key={bp.id} value={bp.id}>
                            {bp.name}
                          </SelectItem>
                        ))}
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
    
    <CategoryManagementModal 
        open={isCategoryModalOpen}
        onOpenChange={setIsCategoryModalOpen}
    />
    </>
  );
}
