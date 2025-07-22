

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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PlusCircle, Trash2, Wand2, Bot, Sparkles, Loader2, AlertCircle, Copy, ChevronsUpDown, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Switch } from './ui/switch';
import { cn } from '@/lib/utils';
import { useProductSimulationCategories } from '@/hooks/use-product-simulation-categories';
import { CategoryManagementModal } from './category-management-modal';
import { getUnitsForCategory, unitCategories, type UnitCategory, convertValue } from '@/lib/conversion';
import { useProducts } from '@/hooks/use-products';
import { useCompanySettings } from '@/hooks/use-company-settings';
import { analyzePricing, type PricingAnalysisInput } from '@/ai/flows/pricing-analysis-flow';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './ui/command';


const simulationItemSchema = z.object({
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

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="relative my-4">
    <div className="absolute inset-0 flex items-center" aria-hidden="true">
      <div className="w-full border-t border-border/60 border-dashed" />
    </div>
    <div className="relative flex justify-center">
      <span className="bg-background px-3 font-semibold text-muted-foreground tracking-wider uppercase text-xs">{children}</span>
    </div>
  </div>
);


export function AddEditSimulationModal({ open, onOpenChange, simulationToEdit, onDelete }: AddEditSimulationModalProps) {
  const { simulations, addSimulation, updateSimulation, simulationItems } = useProductSimulation();
  const { baseProducts } = useBaseProducts();
  const { products } = useProducts();
  const { categories } = useProductSimulationCategories();
  const { pricingParameters } = useCompanySettings();
  
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isCopyPopoverOpen, setIsCopyPopoverOpen] = useState(false);
  
  const { toast } = useToast();

  const form = useForm<SimulationFormValues>({
    resolver: zodResolver(simulationSchema),
    defaultValues: { name: '', categoryIds: [], lineId: null, items: [], operationPercentage: pricingParameters?.defaultOperationPercentage ?? 15, salePrice: 0, profitGoal: 0, notes: '' },
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
                categoryIds: simulationToEdit.categoryIds || [],
                lineId: simulationToEdit.lineId,
                items: itemsForForm,
                operationPercentage: simulationToEdit.operationPercentage,
                salePrice: simulationToEdit.salePrice,
                profitGoal: simulationToEdit.profitGoal,
                notes: simulationToEdit.notes,
            });
        } else {
            form.reset({ name: '', categoryIds: [], lineId: null, items: [], operationPercentage: pricingParameters?.defaultOperationPercentage ?? 15, salePrice: 0, profitGoal: null, notes: '' });
        }
    }
  }, [open, simulationToEdit, simulationItems, form, pricingParameters]);
  
  const handleCopyFrom = (simulationId: string) => {
    const sourceSimulation = simulations.find(s => s.id === simulationId);
    if (!sourceSimulation) return;

    const sourceItems = simulationItems
        .filter(item => item.simulationId === sourceSimulation.id)
        .map(item => ({
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
        items: sourceItems,
        operationPercentage: sourceSimulation.operationPercentage,
        salePrice: sourceSimulation.salePrice,
        profitGoal: sourceSimulation.profitGoal,
        notes: sourceSimulation.notes,
    });
    setIsCopyPopoverOpen(false);
  };
  
  const mainCategories = useMemo(() => categories.filter(c => c.type === 'category'), [categories]);
  const lines = useMemo(() => categories.filter(c => c.type === 'line'), [categories]);
  
   const { cmv, partialCosts } = useMemo(() => {
    let totalCmv = 0;
    const partials: Record<number, number> = {};
    const itemDetails: { name: string; cost: number }[] = [];

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
            itemDetails.push({ name: baseProduct.name, cost: partialCost });

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
                       <Popover open={isCopyPopoverOpen} onOpenChange={setIsCopyPopoverOpen}>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="outline"
                                    role="combobox"
                                    aria-expanded={isCopyPopoverOpen}
                                    className="w-full justify-between font-normal"
                                >
                                   Selecione uma mercadoria para copiar...
                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                                <Command>
                                    <CommandInput placeholder="Buscar mercadoria..." />
                                    <CommandList>
                                        <CommandEmpty>Nenhuma mercadoria encontrada.</CommandEmpty>
                                        <CommandGroup>
                                            {simulations.map((sim) => (
                                                <CommandItem
                                                    key={sim.id}
                                                    value={sim.id}
                                                    onSelect={handleCopyFrom}
                                                >
                                                    <Check className={cn("mr-2 h-4 w-4", form.getValues('name').includes(sim.name) ? "opacity-100" : "opacity-0")} />
                                                    {sim.name}
                                                </CommandItem>
                                            ))}
                                        </CommandGroup>
                                    </CommandList>
                                </Command>
                            </PopoverContent>
                        </Popover>
                      <FormDescription>
                          Use uma mercadoria existente como modelo para acelerar o cadastro.
                      </FormDescription>
                  </FormItem>
                )}
                
                <SectionTitle>Organização</SectionTitle>

                <div className="grid grid-cols-2 gap-4">
                    <FormField
                        control={form.control}
                        name="categoryIds"
                        render={({ field }) => (
                            <FormItem>
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
                        <FormItem>
                            <FormLabel>Linha</FormLabel>
                            <div className="flex items-center gap-1">
                                 <Select onValueChange={(v) => field.onChange(v === 'none' ? null : v)} value={String(field.value ?? 'none')}>
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
                
                <div className="grid grid-cols-2 gap-12">
                    {/* Composition Column */}
                    <div className="space-y-4">
                      <SectionTitle>Composição (CMV)</SectionTitle>
                      
                      <div className="rounded-md border p-2 space-y-2">
                        <div className="grid grid-cols-[minmax(0,3.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1.5fr)_auto] items-center gap-x-2 px-1 text-xs text-muted-foreground font-semibold">
                            <span className="col-span-1">Insumo base</span>
                            <span className="text-center">Qtd.</span>
                            <span className="text-center">Unid.</span>
                            <span className="text-right">Custo/unid.</span>
                            <span className="text-right">Custo total</span>
                            <span className="w-8"></span>
                        </div>
                        {fields.map((item, index) => {
                            if (!watchedItems || !watchedItems[index]) return null;
                            const baseProduct = baseProducts.find(bp => bp.id === watchedItems[index].baseProductId);
                            const useDefault = watchedItems[index].useDefault;
                            const hasDefaultCost = !!(baseProduct?.lastEffectivePrice || baseProduct?.initialCostPerUnit);

                            return (
                                <div key={item.id} className="p-2 rounded bg-muted/50">
                                <div className="grid grid-cols-[minmax(0,3.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1.5fr)_auto] items-start gap-x-2">
                                    <p className="font-medium text-sm" title={baseProduct?.name}>{baseProduct?.name}</p>
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
                                                    value={useDefault ? (baseProduct?.lastEffectivePrice?.pricePerUnit ?? baseProduct?.initialCostPerUnit)?.toFixed(4) ?? '' : costField.value ?? ''}
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

                    {/* Analysis Section */}
                    <div className="space-y-4">
                       <SectionTitle>Resultados da análise</SectionTitle>
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
                       
                       <SectionTitle>Observações</SectionTitle>

                       <FormField control={form.control} name="notes" render={({ field }) => (
                          <FormItem>
                            <FormControl><Textarea placeholder="Adicione notas sobre esta simulação (opcional)" {...field} value={field.value ?? ''} /></FormControl>
                          </FormItem>
                       )}/>
                    </div>
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
    
    <CategoryManagementModal 
        open={isCategoryModalOpen}
        onOpenChange={setIsCategoryModalOpen}
    />
    {simulationToEdit && (
        <DeleteConfirmationDialog
            open={isDeleteConfirmOpen}
            onOpenChange={setIsDeleteConfirmOpen}
            onConfirm={handleDeleteConfirm}
            itemName={`a simulação "${simulationToEdit.name}"`}
        />
    )}
    </>
  );
}
