"use client";

import { calculateProductCompositionCmv } from "@/lib/product-composition-cmv";
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
import { Camera, Upload, Trash2, PlusCircle, Search, Check, Clock, Weight, ShieldAlert, ChevronDown, ChevronUp, Video } from 'lucide-react';
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
  assemblyVideoUrl: z.string().optional(),
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
      assemblyVideoUrl: simulation.ppo?.assemblyVideoUrl || '',
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

  const compositionCmv = useMemo(() => calculateProductCompositionCmv(
    watchedIngredients.map((item, index) => ({ ...item, quantity: Number(item.quantity), overrideCostPerUnit: item.overrideCostPerUnit == null ? undefined : Number(item.overrideCostPerUnit), id: `draft-${index}`, simulationId: simulation.id })),
    new Map(baseProducts.map(base => [base.id, base])),
  ), [watchedIngredients, baseProducts, simulation.id]);
  const totalCmv = compositionCmv.totalCmv ?? 0;

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
          assemblyVideoUrl: values.assemblyVideoUrl || '',
          assemblyInstructions: values.assemblyInstructions,
          allergens: values.allergens.map(a => ({ id: a, text: a })),
          preparationTime: values.preparationTime,
          portionWeight: values.portionWeight,
          portionTolerance: values.portionTolerance,
        } as any,
        items: values.ingredients as any,
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
                <FormLabel className="text-xs font-bold text-ds-ink-muted uppercase">Foto de Referência</FormLabel>
                <div className="flex items-center gap-4">
                  <div className="w-24 h-24 rounded-ds-card bg-ds-warm border-2 border-dashed border-gray-200 flex items-center justify-center overflow-hidden">
                    {form.watch('referenceImageUrl') ? (
                      <img src={form.watch('referenceImageUrl')} className="w-full h-full object-contain p-2" />
                    ) : (
                      <Camera className="h-8 w-8 text-ds-ink-faint" />
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
                        className="text-xs text-ds-danger hover:text-ds-danger"
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
                    <FormLabel className="text-xs font-bold text-ds-ink-muted uppercase">SKU (Código do Produto)</FormLabel>
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
                  <h3 className="text-sm font-bold text-ds-ink">Composição (CMV)</h3>
                  <Badge variant="outline" className="bg-pink-50 text-ds-accent-ink border-pink-100 text-[10px] py-0">Editável</Badge>
                </div>
                <div className="text-xs text-ds-ink-faint">
                  Total calculado: <strong className="text-ds-ink-2">{compositionCmv.complete ? formatCurrency(totalCmv) : "Incompleto"}</strong>
                </div>
              </div>

              <div className="border rounded-ds-md overflow-hidden bg-ds-surface shadow-sm">
                <Table>
                  <TableHeader className="bg-ds-warm">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-[10px] font-bold uppercase text-ds-ink-faint h-10">Insumo</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase text-ds-ink-faint h-10 text-center">Quantidade</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase text-ds-ink-faint h-10 text-right">Custo</TableHead>
                      <TableHead className="w-10 h-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ingredientFields.map((field, index) => {
                      const bp = baseProducts.find(b => b.id === watchedIngredients[index].baseProductId);
                      if (!bp) return null;
                      const cost = compositionCmv.lines.find(line => line.itemId === `draft-${index}`)?.costPerBaseUnit ?? 0;
                      const impact = totalCmv > 0 ? (watchedIngredients[index].quantity * cost / totalCmv * 100) : 0;

                      return (
                        <TableRow key={field.id} className="group">
                          <TableCell className="py-3">
                            <p className="text-sm font-semibold text-ds-ink">{bp.name}</p>
                            <p className="text-[10px] text-ds-ink-faint uppercase">{formatCurrency(cost)} / {bp.unit}</p>
                          </TableCell>
                          <TableCell className="py-3">
                            <div className="flex items-center justify-center gap-1.5">
                              <Input 
                                type="number" 
                                step="any"
                                {...form.register(`ingredients.${index}.quantity`)}
                                className="w-16 h-8 text-center text-xs font-bold"
                              />
                              <span className="text-[10px] font-bold text-ds-ink-faint">{bp.unit}</span>
                            </div>
                          </TableCell>
                          <TableCell className="py-3 text-right">
                            <p className="text-sm font-bold text-ds-accent-ink">{formatCurrency(watchedIngredients[index].quantity * cost)}</p>
                            <p className="text-[10px] text-ds-ink-faint font-bold">{impact.toFixed(0)}%</p>
                          </TableCell>
                          <TableCell className="py-3 text-right">
                            <Button 
                              type="button" 
                              variant="ghost" 
                              size="icon" 
                              className="h-7 w-7 text-gray-200 hover:text-ds-danger transition-colors"
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
                  <Button variant="outline" className="w-full justify-between h-10 text-xs text-ds-ink-muted border-dashed hover:border-pink-300 hover:bg-pink-50/30 transition-all">
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
                              <p className="text-[10px] text-ds-ink-faint">{bp.category} · {bp.unit}</p>
                            </div>
                            <span className="text-xs font-bold text-ds-ink-2">
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

            <Separator className="bg-ds-muted" />

            {/* Modo de Montagem */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-ds-ink">Modo de Montagem</h3>
                  <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 border-none text-[10px]">Fase padrão automática</Badge>
                </div>
                <Button 
                  type="button" 
                  variant="ghost" 
                  size="sm" 
                  className="text-ds-accent-ink text-xs font-bold hover:text-pink-700 hover:bg-pink-50"
                  onClick={() => appendPhase({ id: Math.random().toString(), name: 'Nova Fase', etapas: [{ id: '1', text: '' }] })}
                >
                  + Nova fase
                </Button>
              </div>

              <div className="space-y-4">
                {phaseFields.map((phase, phaseIndex) => (
                  <div key={phase.id} className="border rounded-ds-md overflow-hidden bg-ds-surface shadow-sm">
                    <div className="flex items-center gap-3 bg-ds-warm px-4 py-2 border-b">
                      <span className="text-[10px] font-black text-ds-ink-faint uppercase">Fase {phaseIndex + 1}</span>
                      <Input 
                        {...form.register(`assemblyInstructions.${phaseIndex}.name`)}
                        className="h-7 border-none bg-transparent font-bold text-sm text-ds-ink-2 p-0 focus-visible:ring-0"
                      />
                      {phaseFields.length > 1 && (
                        <Button 
                          type="button" 
                          variant="ghost" 
                          size="icon" 
                          className="h-6 w-6 text-ds-ink-faint hover:text-ds-danger"
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

            <Separator className="bg-ds-muted" />

            {/* Tempos e Pesos */}
            <div className="grid grid-cols-3 gap-6">
              <FormField
                control={form.control}
                name="preparationTime"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[10px] font-bold text-ds-ink-muted uppercase flex items-center gap-1.5">
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
                    <FormLabel className="text-[10px] font-bold text-ds-ink-muted uppercase flex items-center gap-1.5">
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
                    <FormLabel className="text-[10px] font-bold text-ds-ink-muted uppercase">Tolerância (±g)</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} className="h-10 text-sm font-bold" />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            <Separator className="bg-ds-muted" />

            {/* Alergênicos */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-ds-warn" />
                <h3 className="text-sm font-bold text-ds-ink">Alergênicos</h3>
                <Badge variant="outline" className="text-orange-600 border-orange-100 text-[10px]">Chips ANVISA</Badge>
              </div>
              <p className="text-xs text-ds-ink-faint">Selecione os alergênicos presentes conforme RDC 26/2015.</p>
              
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
                          ? "bg-pink-50 border-pink-500 text-ds-accent-ink" 
                          : "bg-ds-surface border-gray-100 text-ds-ink-muted hover:border-gray-200"
                      )}
                    >
                      {isSelected && <Check className="h-3 w-3" />}
                      {allergen}
                    </button>
                  );
                })}
              </div>
            </div>

            <Separator className="bg-ds-muted" />

            {/* Vídeo de Montagem */}
            <FormField
              control={form.control}
              name="assemblyVideoUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[10px] font-bold text-ds-ink-muted uppercase flex items-center gap-1.5">
                    <Video className="h-3 w-3" /> URL do Vídeo de Montagem (opcional)
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      value={field.value ?? ''}
                      placeholder="https://www.youtube.com/watch?v=..."
                      className="h-10 text-sm"
                    />
                  </FormControl>
                  <p className="text-[10px] text-ds-ink-faint">Aceita YouTube, YouTube Shorts, Vimeo ou link direto de vídeo (.mp4)</p>
                </FormItem>
              )}
            />

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
          <span className="text-[10px] font-black text-ds-ink-faint w-4 text-right">{index + 1}.</span>
          <div className="flex-1 relative">
            <Input 
              {...control.register(`assemblyInstructions.${phaseIndex}.etapas.${index}.text`)}
              placeholder="Descreva a etapa de montagem..."
              className="text-xs h-9 bg-ds-warm border-gray-100 focus:bg-ds-surface transition-colors"
            />
          </div>
          <Button 
            type="button" 
            variant="ghost" 
            size="icon" 
            className="h-8 w-8 text-gray-200 hover:text-ds-danger"
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
        className="text-[10px] font-bold text-ds-ink-faint hover:text-ds-ink-2 h-7 px-2 ml-7"
        onClick={() => append({ id: Math.random().toString(), text: '' })}
      >
        + Adicionar etapa
      </Button>
    </div>
  );
}
