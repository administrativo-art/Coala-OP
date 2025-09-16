
"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { useForm, useFieldArray, useWatch, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { type ProductSimulation, type SimulationCategory, type PriceHistoryEntry, type PPO } from '@/types';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useProductSimulation } from '@/hooks/use-product-simulation';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PlusCircle, Trash2, Wand2, Bot, Sparkles, Loader2, AlertCircle, Copy, ChevronsUpDown, Check, TrendingUp, Info } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Switch } from './ui/switch';
import { cn } from '@/lib/utils';
import { useProductSimulationCategories } from '@/hooks/use-product-simulation-categories';
import { getUnitsForCategory, unitCategories, type UnitCategory, convertValue } from '@/lib/conversion';
import { useProducts } from '@/hooks/use-products';
import { useCompanySettings } from '@/hooks/use-company-settings';
import { analyzePricing, type PricingAnalysisInput } from '@/ai/flows/pricing-analysis-flow';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './ui/command';
import { usePurchase } from '@/hooks/use-purchase';


const simulationItemSchema = z.object({
  id: z.string().optional(),
  baseProductId: z.string().min(1, 'Selecione um insumo.'),
  quantity: z.coerce.number().min(0.001, 'Deve ser > 0'),
  useDefault: z.boolean(),
  overrideCostPerUnit: z.coerce.number().optional(),
  overrideUnit: z.string().optional(),
});

const simulationSchema = z.object({
  name: z.string().min(1, 'O nome da mercadoria é obrigatório.'),
  categoryIds: z.array(z.string()),
  lineId: z.string().nullable().optional(),
  groupIds: z.array(z.string()),
  items: z.array(simulationItemSchema).min(1, 'Adicione pelo menos um insumo.'),
  operationPercentage: z.coerce.number().min(0).optional(),
  salePrice: z.coerce.number().min(0).optional(),
  profitGoal: z.coerce.number().nullable().optional(),
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
  onDelete: (simulationId: string) => void;
}

const formatCurrency = (value: number | undefined | null) => {
    if (value === undefined || value === null || isNaN(value)) return 'R$ 0,00';
    const isNegative = value < 0;
    const formatted = Math.abs(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    return isNegative ? `- ${formatted}` : formatted;
};

export function AddEditSimulationModal({ open, onOpenChange, simulationToEdit, onDelete }: AddEditSimulationModalProps) {
  const { simulations, addSimulation, updateSimulation, simulationItems } = useProductSimulation();
  const { baseProducts } = useBaseProducts();
  const { products } = useProducts();
  const { priceHistory } = usePurchase();
  const { categories } = useProductSimulationCategories();
  const { pricingParameters } = useCompanySettings();
  
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  
  const { toast } = useToast();

  const form = useForm<SimulationFormValues>({
    resolver: zodResolver(simulationSchema),
    defaultValues: { 
        name: '', 
        categoryIds: [], 
        lineId: null, 
        groupIds: [],
        items: [], 
        operationPercentage: pricingParameters?.defaultOperationPercentage ?? 15, 
        salePrice: 0, 
        profitGoal: 0, 
        notes: '',
    },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'items' });
  
  const watchedItems = useWatch({ control: form.control, name: 'items' });
  const watchedOperationPercentage = form.watch('operationPercentage');
  const watchedSalePrice = form.watch('salePrice');
  
  const [simulatedPrice, setSimulatedPrice] = useState<number | null>(null);
  const [simulatedProfitGoal, setSimulatedProfitGoal] = useState<number | null>(null);
  
  useEffect(() => {
    if(open) {
      setSimulatedPrice(null);
      setSimulatedProfitGoal(null);
    }
  }, [open]);

  useEffect(() => {
    if (open) {
        if (simulationToEdit) {
            const itemsForForm = simulationItems
                .filter(item => item.simulationId === simulationToEdit.id)
                .map(item => ({
                    id: item.id,
                    baseProductId: item.baseProductId,
                    quantity: item.quantity,
                    useDefault: item.useDefault,
                    overrideCostPerUnit: item.overrideCostPerUnit,
                    overrideUnit: item.overrideUnit,
                }));

            form.reset({
                name: simulationToEdit.name,
                categoryIds: simulationToEdit.categoryIds || [],
                lineId: simulationToEdit.lineId,
                groupIds: simulationToEdit.groupIds || [],
                items: itemsForForm,
                operationPercentage: simulationToEdit.operationPercentage,
                salePrice: simulationToEdit.salePrice,
                profitGoal: simulationToEdit.profitGoal,
                notes: simulationToEdit.notes,
            });
            setSimulatedPrice(simulationToEdit.salePrice);
            setSimulatedProfitGoal(simulationToEdit.profitGoal);
        } else {
            form.reset({ 
                name: '', 
                categoryIds: [], 
                lineId: null, 
                groupIds: [],
                items: [], 
                operationPercentage: pricingParameters?.defaultOperationPercentage ?? 15, 
                salePrice: 0, 
                profitGoal: null, 
                notes: '',
            });
        }
    }
  }, [open, simulationToEdit, simulationItems, form, pricingParameters]);
  
  const handleCopyFrom = (simulationId: string) => {
    if (!simulationId) return;
    const sourceSimulation = simulations.find(s => s.id === simulationId);
    if (!sourceSimulation) return;

    const sourceItems = simulationItems
        .filter(item => item.simulationId === sourceSimulation.id)
        .map(item => ({
            id: item.id,
            baseProductId: item.baseProductId,
            quantity: item.quantity,
            useDefault: item.useDefault,
            overrideCostPerUnit: item.overrideCostPerUnit,
            overrideUnit: item.overrideUnit,
        }));

    form.reset({
        name: `${sourceSimulation.name} (cópia)`,
        categoryIds: sourceSimulation.categoryIds || [],
        lineId: sourceSimulation.lineId,
        groupIds: sourceSimulation.groupIds || [],
        items: sourceItems,
        operationPercentage: sourceSimulation.operationPercentage,
        salePrice: sourceSimulation.salePrice,
        profitGoal: sourceSimulation.profitGoal,
        notes: sourceSimulation.notes,
    });
  };
  
  const mainCategories = useMemo(() => categories.filter(c => c.type === 'category'), [categories]);
  const lines = useMemo(() => categories.filter(c => c.type === 'line'), [categories]);
  const groups = useMemo(() => categories.filter(c => c.type === 'group'), [categories]);
  
   const { cmv, partialCosts, itemImpacts, top3Impacts } = useMemo(() => {
    let totalCmv = 0;
    const partials: Record<number, number> = {};
    const impacts: { index: number; name: string; cost: number; percentage: number }[] = [];

    watchedItems.forEach((item, index) => {
        const baseProduct = baseProducts.find(bp => bp.id === item.baseProductId);
        if (!baseProduct || !item.quantity) {
            partials[index] = 0;
            return;
        }

        try {
            let partialCost = 0;
            
            const costSource = baseProduct.lastEffectivePrice?.pricePerUnit ?? baseProduct.initialCostPerUnit ?? 0;
            
            if (item.useDefault) {
                if(costSource > 0) {
                    partialCost = item.quantity * costSource;
                }
            } else if (item.overrideCostPerUnit && item.overrideUnit) {
                const valueInBase = convertValue(1, item.overrideUnit, baseProduct.unit, baseProduct.category);
                if (valueInBase > 0) {
                     partialCost = item.quantity * (item.overrideCostPerUnit / valueInBase);
                }
            }
            
            partials[index] = partialCost;
            totalCmv += partialCost;
            impacts.push({ index, name: baseProduct.name, cost: partialCost, percentage: 0 });

        } catch (e) {
            console.error("Error calculating CMV for item:", item, e);
            partials[index] = 0;
        }
    });

    if (totalCmv > 0) {
        impacts.forEach(impact => {
            impact.percentage = (impact.cost / totalCmv) * 100;
        });
    }
    
    const sortedImpacts = [...impacts].sort((a,b) => b.cost - a.cost);

    return { 
        cmv: totalCmv,
        partialCosts: partials,
        itemImpacts: new Map(impacts.map(i => [i.index, i.percentage])),
        top3Impacts: sortedImpacts.slice(0, 3)
    };
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

  const markup = useMemo(() => {
    if (grossCost === 0) return 0;
    return (watchedSalePrice || 0) / grossCost -1;
  }, [grossCost, watchedSalePrice]);

  const handleAddItem = (baseProductId: string) => {
    const product = baseProducts.find(bp => bp.id === baseProductId);
    if (product) {
        const costSource = product.lastEffectivePrice?.pricePerUnit ?? product.initialCostPerUnit ?? 0;
        append({ 
            baseProductId: product.id,
            quantity: 1,
            useDefault: !!costSource,
            overrideCostPerUnit: costSource,
            overrideUnit: product.unit,
        });
    }
  };

  const onSubmit = async (values: SimulationFormValues) => {
    if (simulationToEdit) {
      const simulationData = { 
        ...simulationToEdit, 
        ...values,
        totalCmv: cmv,
        grossCost,
        profitValue,
        profitPercentage,
        markup
      };
      const items = values.items;
      await updateSimulation(simulationData, items);
    } else {
       const finalData = {
        ...values,
        lineId: values.lineId || null,
        groupIds: values.groupIds || [],
        categoryIds: values.categoryIds || [],
        totalCmv: cmv,
        grossCost,
        profitValue,
        profitPercentage,
        markup,
      };
      await addSimulation(finalData);
    }
    onOpenChange(false);
  };
  
  const handleDeleteConfirm = () => {
      if (simulationToEdit) {
          onDelete(simulationToEdit.id);
      }
      setIsDeleteConfirmOpen(false);
  }

  const handleSimulatedPriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      if (value === '') {
          setSimulatedPrice(null);
          setSimulatedProfitGoal(null);
          return;
      }
      const price = parseFloat(value);
      setSimulatedPrice(price);
      if (!isNaN(price) && price > 0 && grossCost > 0) {
          const profit = price - grossCost;
          const newMargin = (profit / price) * 100;
          setSimulatedProfitGoal(newMargin);
      } else {
          setSimulatedProfitGoal(null);
      }
  };

  const handleSimulatedGoalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      if (value === '') {
          setSimulatedPrice(null);
          setSimulatedProfitGoal(null);
          return;
      }
      const goal = parseFloat(value);
      setSimulatedProfitGoal(goal);
      if (!isNaN(goal) && goal < 100 && grossCost > 0) {
          const newPrice = grossCost / (1 - (goal / 100));
          setSimulatedPrice(newPrice);
      } else {
          setSimulatedPrice(null);
      }
  };

  const applySimulation = () => {
    if (simulatedPrice !== null) {
      form.setValue('salePrice', simulatedPrice, { shouldValidate: true });
    }
    if (simulatedProfitGoal !== null) {
        form.setValue('profitGoal', simulatedProfitGoal, { shouldValidate: true });
    }
    toast({ title: "Valores simulados aplicados!", description: "Não se esqueça de salvar a análise." });
  };
  
  const effectiveSimulatedPrice = simulatedPrice ?? watchedSalePrice ?? 0;
  const simulatedProfitValue = effectiveSimulatedPrice - grossCost;
  const simulatedProfitPercentage = effectiveSimulatedPrice > 0 ? (simulatedProfitValue / effectiveSimulatedPrice) * 100 : 0;

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{simulationToEdit ? 'Editar análise de custo' : 'Nova análise de custo'}</DialogTitle>
          <DialogDescription>Construa a composição da sua mercadoria, defina preços e analise a lucratividade.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex-1 overflow-hidden flex flex-col">
            <ScrollArea className="flex-1 pr-6">
              <div className="space-y-4">
                 <FormField control={form.control} name="name" render={({ field }) => (
                    <FormItem>
                        <FormLabel>Nome da mercadoria</FormLabel>
                        <FormControl><Input placeholder="Ex: Milkshake de Morango (P)" {...field} /></FormControl>
                        <FormMessage />
                    </FormItem>
                 )}/>

                {!simulationToEdit && (
                  <FormItem>
                      <FormLabel>Copiar de (Opcional)</FormLabel>
                        <Select onValueChange={handleCopyFrom}>
                            <SelectTrigger>
                                <SelectValue placeholder="Selecione uma mercadoria para copiar..."/>
                            </SelectTrigger>
                            <SelectContent>
                                {simulations.map((sim) => (
                                    <SelectItem key={sim.id} value={sim.id}>
                                        {sim.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                      <FormDescription>
                          Use uma mercadoria existente como modelo para acelerar o cadastro.
                      </FormDescription>
                  </FormItem>
                )}
                
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                      <FormField
                          control={form.control}
                          name="categoryIds"
                          render={({ field }) => (
                              <FormItem className="flex-1">
                              <FormLabel>Categorias</FormLabel>
                              <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                  <FormControl>
                                      <Button variant="outline" className="w-full justify-between font-normal">
                                          {field.value?.length > 0 ? `${field.value.length} selecionada(s)` : "Selecione categorias"}
                                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                      </Button>
                                  </FormControl>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
                                  <DropdownMenuLabel>Categorias disponíveis</DropdownMenuLabel>
                                  <DropdownMenuSeparator />
                                  {mainCategories.map((cat) => (
                                      <DropdownMenuCheckboxItem
                                          key={cat.id}
                                          checked={field.value?.includes(cat.id)}
                                          onCheckedChange={(checked) => {
                                              const currentSelection = field.value || [];
                                              return checked
                                                  ? field.onChange([...currentSelection, cat.id])
                                                  : field.onChange(currentSelection.filter((id) => id !== cat.id));
                                          }}
                                          onSelect={(e) => e.preventDefault()}
                                      >
                                          {cat.name}
                                      </DropdownMenuCheckboxItem>
                                  ))}
                                  </DropdownMenuContent>
                              </DropdownMenu>
                              <FormMessage />
                              </FormItem>
                          )}
                      />
                      <FormField control={form.control} name="lineId" render={({ field }) => (
                          <FormItem className="flex-1">
                              <FormLabel>Linha</FormLabel>
                               <Select onValueChange={(v) => field.onChange(v === 'none' ? null : v)} value={String(field.value ?? 'none')}>
                                  <FormControl>
                                      <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                      <SelectItem value="none">Nenhuma</SelectItem>
                                      {lines.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                  </SelectContent>
                              </Select>
                              <FormMessage />
                          </FormItem>
                      )}/>
                       <FormField
                          control={form.control}
                          name="groupIds"
                          render={({ field }) => (
                            <FormItem className="flex-1">
                                <FormLabel>Grupo por Insumo</FormLabel>
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="outline" className="w-full justify-between font-normal">
                                            {field.value?.length > 0 ? `${field.value.length} selecionado(s)` : "Selecione grupos"}
                                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
                                        <DropdownMenuLabel>Grupos disponíveis</DropdownMenuLabel>
                                        <DropdownMenuSeparator />
                                        {groups.map(group => (
                                            <DropdownMenuCheckboxItem
                                                key={group.id}
                                                checked={field.value?.includes(group.id)}
                                                onCheckedChange={(checked) => {
                                                    const currentSelection = field.value || [];
                                                    return checked
                                                        ? field.onChange([...currentSelection, group.id])
                                                        : field.onChange(currentSelection.filter(id => id !== group.id));
                                                }}
                                                onSelect={(e) => e.preventDefault()}
                                            >
                                                {group.name}
                                            </DropdownMenuCheckboxItem>
                                        ))}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                                <FormMessage />
                            </FormItem>
                          )}
                        />
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Composição (CMV)</h3>
                  <div className="rounded-md border">
                      <div className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-x-2 px-3 py-2 text-xs text-muted-foreground font-semibold border-b">
                          <span>Insumo base</span>
                          <span className="w-8"></span>
                          <div className="grid grid-cols-[1fr_1fr_auto] gap-x-2 items-center">
                            <span className="text-center">Qtd.</span>
                            <span className="text-right">Custo/unid.</span>
                            <div className="grid grid-cols-[1fr_1fr] items-center gap-2">
                                <span className="text-right">Custo</span>
                                <span className="text-center">Impacto</span>
                            </div>
                          </div>
                      </div>
                      {fields.map((item, index) => {
                          if (!watchedItems || !watchedItems[index]) return null;
                          const baseProduct = baseProducts.find(bp => bp.id === watchedItems[index].baseProductId);
                          const useDefault = watchedItems[index].useDefault;
                          
                          const effectiveCost = baseProduct?.lastEffectivePrice?.pricePerUnit ?? baseProduct?.initialCostPerUnit ?? 0;
                          const hasDefaultCost = effectiveCost > 0;
                          const impactPercentage = itemImpacts.get(index) ?? 0;

                          return (
                              <div key={item.id} className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-x-2 p-2 border-b last:border-b-0">
                                  <div className="space-y-1 self-center">
                                      <p className="font-medium text-sm break-words">{baseProduct?.name}</p>
                                      <div className="flex justify-start">
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
                                                      {hasDefaultCost ? 'Usar custo padrão' : 'Sem custo padrão'}
                                                  </FormLabel>
                                              </FormItem>
                                          )}
                                      />
                                  </div>
                                  </div>
                                  <Button type="button" variant="ghost" size="icon" className="text-destructive h-8 w-8 self-center" onClick={() => remove(index)}>
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                  <div className="grid grid-cols-[1fr_1fr_auto] gap-x-2">
                                      <div className="flex items-start gap-1">
                                          <FormField control={form.control} name={`items.${index}.quantity`} render={({ field: qtyField }) => (
                                          <FormItem className="flex-grow"><FormControl><Input type="number" {...qtyField} className="text-center" /></FormControl><FormMessage /></FormItem>
                                          )}/>
                                          
                                          <FormField
                                              control={form.control}
                                              name={`items.${index}.overrideUnit`}
                                              render={({ field: unitField }) => (
                                                  <FormItem className="w-24">
                                                      <Select onValueChange={unitField.onChange} value={useDefault ? baseProduct?.unit : unitField.value} disabled={useDefault}>
                                                          <FormControl>
                                                              <SelectTrigger className={cn("bg-background/0 text-xs", useDefault && "border-none ring-0 focus-visible:ring-0 text-muted-foreground font-semibold")}>
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
                                      </div>
                                      <FormField
                                          control={form.control}
                                          name={`items.${index}.overrideCostPerUnit`}
                                          render={({ field: costField }) => (
                                              <FormItem>
                                                  <Input
                                                      type="number"
                                                      step="any"
                                                      value={useDefault ? effectiveCost.toFixed(4) : costField.value ?? ''}
                                                      onChange={costField.onChange}
                                                      disabled={useDefault}
                                                      className={cn("text-right bg-background/0", useDefault && "border-none ring-0 focus-visible:ring-0 text-muted-foreground font-semibold")}
                                                  />
                                                  <FormMessage/>
                                              </FormItem>
                                          )}
                                      />
                                    <div className="grid grid-cols-[1fr_1fr] items-center gap-2">
                                        <div className="font-semibold text-primary text-sm w-full text-right self-center">
                                            {formatCurrency(partialCosts[index])}
                                        </div>
                                        <div className="font-medium text-xs w-full text-center self-center text-muted-foreground">
                                            {impactPercentage.toFixed(1)}%
                                        </div>
                                    </div>
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

                  {top3Impacts.length > 0 && (
                      <div className="p-3 border rounded-lg space-y-1">
                          <h4 className="font-semibold text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary"/>Top 3 Insumos por Impacto</h4>
                          <ul className="text-xs text-muted-foreground space-y-0.5">
                              {top3Impacts.map(item => (
                                  <li key={item.index} className="flex justify-between">
                                      <span>{item.name}</span>
                                      <span className="font-medium">{item.percentage.toFixed(1)}%</span>
                                  </li>
                              ))}
                          </ul>
                      </div>
                  )}
                </div>

                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Resultados da análise</h3>
                  <div className="rounded-lg border p-4 space-y-4">
                      <FormField control={form.control} name="operationPercentage" render={({ field }) => (
                      <div className="flex justify-between items-center">
                          <FormLabel>Operacional (%)</FormLabel>
                          <FormControl>
                              <div className="relative w-32">
                                  <Input type="number" className="pr-8 text-right" {...field} value={field.value ?? ''}/>
                                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                              </div>
                          </FormControl>
                      </div>
                      )}/>
                      <div className="flex justify-between items-center">
                          <FormLabel className="text-destructive font-bold">= Custo bruto</FormLabel>
                          <span className="text-xl font-bold text-destructive">{formatCurrency(grossCost)}</span>
                      </div>
                      <FormField control={form.control} name="salePrice" render={({ field }) => (
                      <div className="flex justify-between items-center">
                          <FormLabel>Preço de venda</FormLabel>
                          <FormControl>
                              <div className="relative w-32">
                                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">R$</span>
                                  <Input type="number" step="0.01" className="pl-8 font-semibold text-right" {...field} value={field.value ?? ''} />
                              </div>
                          </FormControl>
                      </div>
                      )}/>
                      <FormField control={form.control} name="profitGoal" render={({ field }) => (
                          <div className="flex justify-between items-center">
                              <FormLabel>Meta de Lucro</FormLabel>
                              <FormControl>
                                  <Select onValueChange={(v) => field.onChange(v === 'none' ? null : Number(v))} value={String(field.value ?? 'none')}>
                                      <SelectTrigger className="w-32">
                                          <SelectValue placeholder="Meta..." />
                                      </SelectTrigger>
                                      <SelectContent>
                                          <SelectItem value="none">Nenhuma</SelectItem>
                                          {(pricingParameters?.profitGoals || []).map(goal => (
                                              <SelectItem key={goal} value={String(goal)}>{goal}%</SelectItem>
                                          ))}
                                      </SelectContent>
                                  </Select>
                              </FormControl>
                          </div>
                      )}/>
                      <div className="flex justify-between items-center text-green-600 font-bold">
                      <span>= Lucro bruto</span>
                      <div className="text-right">
                          <p className="text-xl">{formatCurrency(profitValue)}</p>
                          <p className="text-sm">({profitPercentage.toFixed(2)}%)</p>
                      </div>
                  </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Ferramentas</h3>
                  <div className="rounded-lg border bg-blue-500/5 p-4 space-y-4">
                      <h4 className="font-semibold flex items-center gap-2 text-blue-800 dark:text-blue-300"><Wand2/> Simulador "What-If"</h4>
                      <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1">
                              <Label htmlFor="sim-price">Simular Preço (R$)</Label>
                              <Input id="sim-price" type="number" placeholder="Ex: 19.90" value={simulatedPrice ?? ''} onChange={handleSimulatedPriceChange} />
                          </div>
                          <div className="space-y-1">
                              <Label htmlFor="sim-goal">Simular Meta (%)</Label>
                              <Input id="sim-goal" type="number" placeholder="Ex: 65" value={simulatedProfitGoal ?? ''} onChange={handleSimulatedGoalChange} />
                          </div>
                      </div>
                      <div className="p-3 bg-background/50 rounded-md space-y-2">
                          <p className="text-sm font-semibold">Resultados da Simulação:</p>
                          <div className="flex justify-between items-center">
                              <span className="text-sm">Novo Lucro (R$):</span>
                              <span className="font-bold">{formatCurrency(simulatedProfitValue)}</span>
                          </div>
                          <div className="flex justify-between items-center">
                              <span className="text-sm">Nova Margem (%):</span>
                              <span className="font-bold">{simulatedProfitPercentage.toFixed(2)}%</span>
                          </div>
                      </div>
                      <Button type="button" className="w-full" onClick={applySimulation} disabled={simulatedPrice === null}>Aplicar valores simulados</Button>
                  </div>
                </div>
                
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Observações</h3>
                  <FormField control={form.control} name="notes" render={({ field }) => (
                      <FormItem>
                      <FormControl><Textarea placeholder="Adicione notas sobre esta simulação (opcional)" {...field} value={field.value ?? ''} /></FormControl>
                      </FormItem>
                  )}/>
                </div>

              </div>
            </ScrollArea>
            <DialogFooter className="pt-4 border-t mt-auto flex justify-between w-full">
              <div>
                {simulationToEdit && (
                  <Button type="button" variant="destructive" onClick={() => setIsDeleteConfirmOpen(true)}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Excluir
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cancelar
                </Button>
                <Button type="submit">Salvar análise</Button>
              </div>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
    
    {simulationToEdit && (
        <DeleteConfirmationDialog
            open={isDeleteConfirmOpen}
            onOpenChange={() => setIsDeleteConfirmOpen(false)}
            onConfirm={handleDeleteConfirm}
            itemName={`a simulação "${simulationToEdit.name}"`}
        />
    )}
    </>
  );
}
