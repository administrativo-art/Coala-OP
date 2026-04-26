"use client";

import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useForm, useFieldArray, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { type ProductSimulation, type PPO } from '@/types';
import { useProductSimulation } from '@/hooks/use-product-simulation';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useToast } from '@/hooks/use-toast';
import Image from 'next/image';

import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHeader, TableHead, TableRow } from '@/components/ui/table';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Camera, Upload, Trash2, PlusCircle, Search, Check, Clock, Weight, ShieldAlert, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

const ALLERGENS_ANVISA = [
  'Leite', 'Ovos', 'Amendoim', 'Trigo (Glúten)', 'Soja',
  'Castanha de Caju', 'Castanha do Pará', 'Nozes', 'Peixes',
  'Crustáceos', 'Moluscos', 'Mostarda', 'Sésamo', 'Sulfitos'
];

const ingredientSchema = z.object({
  id: z.string().optional(),
  baseProductId: z.string(),
  quantity: z.coerce.number().min(0.001),
  useDefault: z.boolean().default(true),
  overrideCostPerUnit: z.coerce.number().optional(),
  overrideUnit: z.string().optional(),
});

const phaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  etapas: z.array(z.object({
    id: z.string(),
    text: z.string(),
  })),
});

const ppoSchema = z.object({
  sku: z.string().optional(),
  referenceImageUrl: z.string().optional(),
  ingredients: z.array(ingredientSchema),
  assemblyInstructions: z.array(phaseSchema),
  allergens: z.array(z.string()),
  preparationTime: z.coerce.number().optional(),
  portionWeight: z.coerce.number().optional(),
  portionTolerance: z.coerce.number().optional(),
});

type ProductSheetFormValues = z.infer<typeof ppoSchema>;

const formatCurrency = (value: number) => {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

export function ProductSheetTab({ simulation, onOpenChange }: { simulation: ProductSimulation, onOpenChange: (open: boolean) => void }) {
  const { updateSimulation, simulationItems } = useProductSimulation();
  const { baseProducts } = useBaseProducts();
  const { toast } = useToast();
  const [comboOpen, setComboOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const initialIngredients = useMemo(() => {
    return simulationItems
      .filter(item => item.simulationId === simulation.id)
      .map(item => ({
        id: item.id,
        baseProductId: item.baseProductId,
        quantity: item.quantity,
        useDefault: item.useDefault,
        overrideCostPerUnit: item.overrideCostPerUnit,
        overrideUnit: item.overrideUnit,
      }));
  }, [simulation.id, simulationItems]);

  const form = useForm<ProductSheetFormValues>({
    resolver: zodResolver(ppoSchema),
    defaultValues: {
      sku: simulation.ppo?.sku || '',
      referenceImageUrl: simulation.ppo?.referenceImageUrl || '',
      ingredients: initialIngredients,
      assemblyInstructions: (simulation.ppo?.assemblyInstructions?.length ? simulation.ppo.assemblyInstructions : [{ id: 'default', name: 'Preparo', etapas: [{ id: '1', text: '' }] }]) as any,
      allergens: (simulation.ppo?.allergens || []).map((a: any) => typeof a === 'string' ? a : a.text),
      preparationTime: simulation.ppo?.preparationTime || 0,
      portionWeight: simulation.ppo?.portionWeight || 0,
      portionTolerance: simulation.ppo?.portionTolerance || 0,
    },
  });

  const { fields: ingredientFields, append: appendIngredient, remove: removeIngredient } = useFieldArray({
    control: form.control,
    name: 'ingredients',
  });

  const { fields: phaseFields, append: appendPhase, remove: removePhase } = useFieldArray({
    control: form.control,
    name: 'assemblyInstructions',
  });

  const watchedIngredients = useWatch({ control: form.control, name: 'ingredients' }) || [];
  const watchedAllergens = useWatch({ control: form.control, name: 'allergens' }) || [];

  const totalCmv = useMemo(() => {
    return watchedIngredients.reduce((acc, item) => {
      const bp = baseProducts.find(b => b.id === item.baseProductId);
      if (!bp) return acc;
      const cost = item.useDefault 
        ? (bp.lastEffectivePrice?.pricePerUnit || bp.initialCostPerUnit || 0)
        : (item.overrideCostPerUnit || 0);
      return acc + (item.quantity * cost);
    }, 0);
  }, [watchedIngredients, baseProducts]);

  const handleAddItem = (baseProductId: string) => {
    const bp = baseProducts.find(b => b.id === baseProductId);
    if (bp) {
      appendIngredient({
        baseProductId: bp.id,
        quantity: 1,
        useDefault: true,
        overrideCostPerUnit: bp.lastEffectivePrice?.pricePerUnit || bp.initialCostPerUnit || 0,
        overrideUnit: bp.unit,
      });
      setComboOpen(false);
    }
  };

  const toggleAllergen = (allergen: string) => {
    const current = form.getValues('allergens');
    if (current.includes(allergen)) {
      form.setValue('allergens', current.filter(a => a !== allergen));
    } else {
      form.setValue('allergens', [...current, allergen]);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        form.setValue('referenceImageUrl', reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const onSubmit = async (values: ProductSheetFormValues) => {
    try {
      await updateSimulation({
        ...simulation,
        ppo: {
          ...simulation.ppo,
          sku: values.sku,
          referenceImageUrl: values.referenceImageUrl,
          assemblyInstructions: values.assemblyInstructions,
          allergens: values.allergens.map(a => ({ id: a, text: a })),
          preparationTime: values.preparationTime,
          portionWeight: values.portionWeight,
          portionTolerance: values.portionTolerance,
        } as any,
        items: values.ingredients as any,
        totalCmv: totalCmv,
      });
      toast({ title: "Ficha técnica salva com sucesso!" });
      onOpenChange(false);
    } catch (error) {
      toast({ variant: "destructive", title: "Erro ao salvar", description: "Ocorreu um erro ao salvar a ficha técnica." });
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="h-full flex flex-col">
        <ScrollArea className="flex-1 p-6">
          <div className="space-y-8 pb-10">
            
            {/* Foto e SKU */}
            <div className="grid grid-cols-[auto_1fr] gap-8">
              <div className="space-y-2">
                <FormLabel className="text-xs font-bold text-gray-500 uppercase">Foto de Referência</FormLabel>
                <div className="flex items-center gap-4">
                  <div className="w-24 h-24 rounded-2xl bg-gray-50 border-2 border-dashed border-gray-200 flex items-center justify-center overflow-hidden">
                    {form.watch('referenceImageUrl') ? (
                      <img src={form.watch('referenceImageUrl')} className="w-full h-full object-cover" />
                    ) : (
                      <Camera className="h-8 w-8 text-gray-300" />
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <Button 
                      type="button" 
                      variant="outline" 
                      size="sm" 
                      className="text-xs"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload className="mr-2 h-3 w-3" /> Upload
                    </Button>
                    <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileUpload} accept="image/*" />
                    {form.watch('referenceImageUrl') && (
                      <Button 
                        type="button" 
                        variant="ghost" 
                        size="sm" 
                        className="text-xs text-red-500 hover:text-red-600"
                        onClick={() => form.setValue('referenceImageUrl', '')}
                      >
                        <Trash2 className="mr-2 h-3 w-3" /> Remover
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              <FormField
                control={form.control}
                name="sku"
                render={({ field }) => (
                  <FormItem className="max-w-[200px]">
                    <FormLabel className="text-xs font-bold text-gray-500 uppercase">SKU (Código do Produto)</FormLabel>
                    <FormControl>
                      <Input {...field} className="font-mono text-sm uppercase" placeholder="EX: SKU-001" />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            {/* Composição CMV */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-gray-800">Composição (CMV)</h3>
                  <Badge variant="outline" className="bg-pink-50 text-pink-600 border-pink-100 text-[10px] py-0">Editável</Badge>
                </div>
                <div className="text-xs text-gray-400">
                  Total calculado: <strong className="text-gray-700">{formatCurrency(totalCmv)}</strong>
                </div>
              </div>

              <div className="border rounded-xl overflow-hidden bg-white shadow-sm">
                <Table>
                  <TableHeader className="bg-gray-50/50">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-[10px] font-bold uppercase text-gray-400 h-10">Insumo</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase text-gray-400 h-10 text-center">Quantidade</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase text-gray-400 h-10 text-right">Custo</TableHead>
                      <TableHead className="w-10 h-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ingredientFields.map((field, index) => {
                      const bp = baseProducts.find(b => b.id === watchedIngredients[index].baseProductId);
                      if (!bp) return null;
                      const cost = watchedIngredients[index].useDefault 
                        ? (bp.lastEffectivePrice?.pricePerUnit || bp.initialCostPerUnit || 0)
                        : (watchedIngredients[index].overrideCostPerUnit || 0);
                      const impact = totalCmv > 0 ? (watchedIngredients[index].quantity * cost / totalCmv * 100) : 0;

                      return (
                        <TableRow key={field.id} className="group">
                          <TableCell className="py-3">
                            <p className="text-sm font-semibold text-gray-800">{bp.name}</p>
                            <p className="text-[10px] text-gray-400 uppercase">{formatCurrency(cost)} / {bp.unit}</p>
                          </TableCell>
                          <TableCell className="py-3">
                            <div className="flex items-center justify-center gap-1.5">
                              <Input 
                                type="number" 
                                step="any"
                                {...form.register(`ingredients.${index}.quantity`)}
                                className="w-16 h-8 text-center text-xs font-bold"
                              />
                              <span className="text-[10px] font-bold text-gray-400">{bp.unit}</span>
                            </div>
                          </TableCell>
                          <TableCell className="py-3 text-right">
                            <p className="text-sm font-bold text-pink-500">{formatCurrency(watchedIngredients[index].quantity * cost)}</p>
                            <p className="text-[10px] text-gray-300 font-bold">{impact.toFixed(0)}%</p>
                          </TableCell>
                          <TableCell className="py-3 text-right">
                            <Button 
                              type="button" 
                              variant="ghost" 
                              size="icon" 
                              className="h-7 w-7 text-gray-200 hover:text-red-500 transition-colors"
                              onClick={() => removeIngredient(index)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Combobox Search */}
              <Popover open={comboOpen} onOpenChange={setComboOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-between h-10 text-xs text-gray-500 border-dashed hover:border-pink-300 hover:bg-pink-50/30 transition-all">
                    <div className="flex items-center gap-2">
                      <Search className="h-3.5 w-3.5" />
                      Buscar insumo pelo nome para adicionar...
                    </div>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Digite para buscar..." />
                    <CommandList>
                      <CommandEmpty>Nenhum insumo encontrado.</CommandEmpty>
                      <CommandGroup>
                        {baseProducts.map(bp => (
                          <CommandItem 
                            key={bp.id} 
                            onSelect={() => handleAddItem(bp.id)}
                            className="flex justify-between items-center py-2"
                          >
                            <div>
                              <p className="text-sm font-semibold">{bp.name}</p>
                              <p className="text-[10px] text-gray-400">{bp.category} · {bp.unit}</p>
                            </div>
                            <span className="text-xs font-bold text-gray-600">
                              {formatCurrency(bp.lastEffectivePrice?.pricePerUnit || bp.initialCostPerUnit || 0)}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <Separator className="bg-gray-100" />

            {/* Modo de Montagem */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-gray-800">Modo de Montagem</h3>
                  <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 border-none text-[10px]">Fase padrão automática</Badge>
                </div>
                <Button 
                  type="button" 
                  variant="ghost" 
                  size="sm" 
                  className="text-pink-600 text-xs font-bold hover:text-pink-700 hover:bg-pink-50"
                  onClick={() => appendPhase({ id: Math.random().toString(), name: 'Nova Fase', etapas: [{ id: '1', text: '' }] })}
                >
                  + Nova fase
                </Button>
              </div>

              <div className="space-y-4">
                {phaseFields.map((phase, phaseIndex) => (
                  <div key={phase.id} className="border rounded-xl overflow-hidden bg-white shadow-sm">
                    <div className="flex items-center gap-3 bg-gray-50 px-4 py-2 border-b">
                      <span className="text-[10px] font-black text-gray-300 uppercase">Fase {phaseIndex + 1}</span>
                      <Input 
                        {...form.register(`assemblyInstructions.${phaseIndex}.name`)}
                        className="h-7 border-none bg-transparent font-bold text-sm text-gray-700 p-0 focus-visible:ring-0"
                      />
                      {phaseFields.length > 1 && (
                        <Button 
                          type="button" 
                          variant="ghost" 
                          size="icon" 
                          className="h-6 w-6 text-gray-300 hover:text-red-500"
                          onClick={() => removePhase(phaseIndex)}
                        >
                          <Trash2 className="h-3 h-3" />
                        </Button>
                      )}
                    </div>
                    <div className="p-4 space-y-3">
                      <PhaseSteps control={form.control} phaseIndex={phaseIndex} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <Separator className="bg-gray-100" />

            {/* Tempos e Pesos */}
            <div className="grid grid-cols-3 gap-6">
              <FormField
                control={form.control}
                name="preparationTime"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[10px] font-bold text-gray-500 uppercase flex items-center gap-1.5">
                      <Clock className="h-3 w-3" /> Tempo de preparo (s)
                    </FormLabel>
                    <FormControl>
                      <Input type="number" {...field} className="h-10 text-sm font-bold" />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="portionWeight"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[10px] font-bold text-gray-500 uppercase flex items-center gap-1.5">
                      <Weight className="h-3 w-3" /> Peso da porção (g)
                    </FormLabel>
                    <FormControl>
                      <Input type="number" {...field} className="h-10 text-sm font-bold" />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="portionTolerance"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[10px] font-bold text-gray-500 uppercase">Tolerância (±g)</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} className="h-10 text-sm font-bold" />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            <Separator className="bg-gray-100" />

            {/* Alergênicos */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-orange-500" />
                <h3 className="text-sm font-bold text-gray-800">Alergênicos</h3>
                <Badge variant="outline" className="text-orange-600 border-orange-100 text-[10px]">Chips ANVISA</Badge>
              </div>
              <p className="text-xs text-gray-400">Selecione os alergênicos presentes conforme RDC 26/2015.</p>
              
              <div className="flex flex-wrap gap-2">
                {ALLERGENS_ANVISA.map(allergen => {
                  const isSelected = watchedAllergens.includes(allergen);
                  return (
                    <button
                      key={allergen}
                      type="button"
                      onClick={() => toggleAllergen(allergen)}
                      className={cn(
                        "px-3 py-1.5 rounded-full text-xs font-semibold border-2 transition-all flex items-center gap-1.5",
                        isSelected 
                          ? "bg-pink-50 border-pink-500 text-pink-600" 
                          : "bg-white border-gray-100 text-gray-500 hover:border-gray-200"
                      )}
                    >
                      {isSelected && <Check className="h-3 w-3" />}
                      {allergen}
                    </button>
                  );
                })}
              </div>
            </div>

          </div>
        </ScrollArea>
        <button type="submit" id="product-modal-submit-btn" className="hidden" />
      </form>
    </Form>
  );
}

function PhaseSteps({ control, phaseIndex }: { control: any, phaseIndex: number }) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: `assemblyInstructions.${phaseIndex}.etapas`,
  });

  return (
    <div className="space-y-3">
      {fields.map((field, index) => (
        <div key={field.id} className="flex items-center gap-3">
          <span className="text-[10px] font-black text-gray-300 w-4 text-right">{index + 1}.</span>
          <div className="flex-1 relative">
            <Input 
              {...control.register(`assemblyInstructions.${phaseIndex}.etapas.${index}.text`)}
              placeholder="Descreva a etapa de montagem..."
              className="text-xs h-9 bg-gray-50 border-gray-100 focus:bg-white transition-colors"
            />
          </div>
          <Button 
            type="button" 
            variant="ghost" 
            size="icon" 
            className="h-8 w-8 text-gray-200 hover:text-red-500"
            onClick={() => remove(index)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <Button 
        type="button" 
        variant="ghost" 
        size="sm" 
        className="text-[10px] font-bold text-gray-400 hover:text-gray-600 h-7 px-2 ml-7"
        onClick={() => append({ id: Math.random().toString(), text: '' })}
      >
        + Adicionar etapa
      </Button>
    </div>
  );
}
