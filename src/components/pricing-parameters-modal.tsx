

"use client";

import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useCompanySettings } from '@/hooks/use-company-settings';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PlusCircle, Trash2 } from 'lucide-react';
import { type PricingParameters, type PriceBand, type PriceCategory, type PriceCategoryRule } from '@/types';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Table, TableBody, TableCell, TableHeader, TableHead, TableRow } from './ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

const priceBandSchema = z.object({
  id: z.string(),
  name: z.string().min(1, 'O nome é obrigatório'),
  min: z.coerce.number(),
  max: z.coerce.number(),
  defaultCategoryId: z.string().min(1, 'Selecione uma categoria padrão'),
  status: z.enum(['active', 'inactive'])
});

const ruleSchema = z.object({
    field: z.enum(['lineId', 'volume', 'tags']),
    operator: z.enum(['equals', 'contains', 'gte', 'lte']),
    value: z.any()
});

const priceCategorySchema = z.object({
  id: z.string(),
  name: z.string().min(1, 'O nome é obrigatório'),
  priceBandId: z.string().min(1, 'Selecione uma faixa de preço'),
  priority: z.coerce.number().min(0, "A prioridade deve ser positiva."),
  rules: z.array(ruleSchema),
  status: z.enum(['active', 'inactive'])
});


const parametersSchema = z.object({
  defaultOperationPercentage: z.coerce.number().min(0, "Deve ser um valor positivo."),
  profitGoals: z.array(z.coerce.number().min(0).max(100)),
  priceBands: z.array(priceBandSchema),
  priceCategories: z.array(priceCategorySchema)
});

type ParametersFormValues = z.infer<typeof parametersSchema>;


interface PricingParametersModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PricingParametersModal({ open, onOpenChange }: PricingParametersModalProps) {
  const { pricingParameters, updatePricingParameters } = useCompanySettings();
  const [editingBand, setEditingBand] = useState<Partial<PriceBand> | null>(null);
  const [editingCategory, setEditingCategory] = useState<Partial<PriceCategory> | null>(null);
  
  const form = useForm<ParametersFormValues>({
    resolver: zodResolver(parametersSchema),
  });

  const { fields: goalFields, append: appendGoal, remove: removeGoal } = useFieldArray({ control: form.control, name: 'profitGoals' });
  const { fields: bandFields, append: appendBand, remove: removeBand, update: updateBand } = useFieldArray({ control: form.control, name: 'priceBands' });
  const { fields: categoryFields, append: appendCategory, remove: removeCategory, update: updateCategory } = useFieldArray({ control: form.control, name: 'priceCategories' });


  useEffect(() => {
    if (open && pricingParameters) {
      form.reset({
        defaultOperationPercentage: pricingParameters.defaultOperationPercentage,
        profitGoals: pricingParameters.profitGoals || [45, 50, 55, 60],
        priceBands: pricingParameters.priceBands || [],
        priceCategories: pricingParameters.priceCategories || [],
      });
    }
  }, [open, pricingParameters, form]);

  const onSubmit = (values: ParametersFormValues) => {
    const sortedGoals = [...values.profitGoals].sort((a,b) => a - b);
    updatePricingParameters({...values, profitGoals: sortedGoals });
    onOpenChange(false);
  };
  
  const handleAddBand = () => {
    appendBand({
      id: `band-${Date.now()}`,
      name: 'Nova Faixa',
      min: 0,
      max: 0,
      defaultCategoryId: '',
      status: 'active',
    });
  };
  
   const handleAddCategory = () => {
    appendCategory({
      id: `cat-${Date.now()}`,
      name: 'Nova Categoria',
      priceBandId: '',
      priority: 10,
      rules: [],
      status: 'active',
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Configurar parâmetros de precificação</DialogTitle>
          <DialogDescription>
            Defina os valores padrão, faixas de preço e as categorias para classificação automática.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 pt-4 flex-1 flex flex-col overflow-hidden">
             <Tabs defaultValue="general" className="flex-1 flex flex-col overflow-hidden">
                <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="general">Geral</TabsTrigger>
                    <TabsTrigger value="bands">Faixas de Preço</TabsTrigger>
                    <TabsTrigger value="categories">Categorias de Preço</TabsTrigger>
                </TabsList>

                <TabsContent value="general" className="flex-1 overflow-y-auto pr-2">
                   <div className="space-y-6 py-4">
                     <FormField
                        control={form.control}
                        name="defaultOperationPercentage"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Percentual de operação padrão</FormLabel>
                            <div className="relative w-32">
                              <Input type="number" className="pr-8" {...field} />
                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      
                      <div>
                        <FormLabel>Metas de Lucro Disponíveis (%)</FormLabel>
                        <div className="space-y-2 mt-2 p-3 border rounded-lg">
                            {goalFields.map((field, index) => (
                                <div key={field.id} className="flex items-center gap-2">
                                  <FormField control={form.control} name={`profitGoals.${index}`} render={({ field: inputField }) => (
                                      <FormItem className="flex-grow"><FormControl><Input type="number" {...inputField} value={inputField.value ?? ''} onChange={e => inputField.onChange(e.target.value === '' ? '' : parseInt(e.target.value, 10))} /></FormControl><FormMessage /></FormItem>
                                  )}/>
                                  <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => removeGoal(index)}><Trash2 className="h-4 w-4" /></Button>
                                </div>
                            ))}
                            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => appendGoal(50)}><PlusCircle className="mr-2 h-4 w-4" /> Adicionar Meta</Button>
                        </div>
                      </div>
                   </div>
                </TabsContent>
                
                 <TabsContent value="bands" className="flex-1 overflow-y-auto pr-2">
                    <div className="space-y-4 py-4">
                        <Button type="button" onClick={handleAddBand}><PlusCircle className="mr-2" /> Nova Faixa de Preço</Button>
                        <div className="rounded-md border">
                            <Table>
                                <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Mín (R$)</TableHead><TableHead>Máx (R$)</TableHead><TableHead>Cat. Padrão</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
                                <TableBody>
                                    {bandFields.map((field, index) => (
                                        <TableRow key={field.id}>
                                            <TableCell><FormField control={form.control} name={`priceBands.${index}.name`} render={({field}) => <Input {...field} />} /></TableCell>
                                            <TableCell><FormField control={form.control} name={`priceBands.${index}.min`} render={({field}) => <Input type="number" {...field} />} /></TableCell>
                                            <TableCell><FormField control={form.control} name={`priceBands.${index}.max`} render={({field}) => <Input type="number" {...field} />} /></TableCell>
                                            <TableCell>
                                                <FormField control={form.control} name={`priceBands.${index}.defaultCategoryId`} render={({field}) => (
                                                    <Select onValueChange={field.onChange} value={field.value}>
                                                        <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                                                        <SelectContent>
                                                            {categoryFields.filter(c => c.priceBandId === field.id).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                                        </SelectContent>
                                                    </Select>
                                                )} />
                                            </TableCell>
                                            <TableCell>
                                                <FormField control={form.control} name={`priceBands.${index}.status`} render={({field}) => (
                                                    <Select onValueChange={field.onChange} value={field.value}>
                                                        <SelectTrigger><SelectValue/></SelectTrigger>
                                                        <SelectContent><SelectItem value="active">Ativa</SelectItem><SelectItem value="inactive">Inativa</SelectItem></SelectContent>
                                                    </Select>
                                                )} />
                                            </TableCell>
                                            <TableCell><Button type="button" variant="ghost" size="icon" onClick={() => removeBand(index)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </div>
                 </TabsContent>

                 <TabsContent value="categories" className="flex-1 overflow-y-auto pr-2">
                    <div className="space-y-4 py-4">
                        <Button type="button" onClick={handleAddCategory}><PlusCircle className="mr-2" /> Nova Categoria de Preço</Button>
                         <div className="rounded-md border">
                            <Table>
                                <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Faixa de Preço</TableHead><TableHead>Prioridade</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
                                <TableBody>
                                    {categoryFields.map((field, index) => (
                                        <TableRow key={field.id}>
                                            <TableCell><FormField control={form.control} name={`priceCategories.${index}.name`} render={({field}) => <Input {...field} />} /></TableCell>
                                            <TableCell>
                                                 <FormField control={form.control} name={`priceCategories.${index}.priceBandId`} render={({field}) => (
                                                    <Select onValueChange={field.onChange} value={field.value}>
                                                        <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                                                        <SelectContent>
                                                            {bandFields.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                                                        </SelectContent>
                                                    </Select>
                                                )} />
                                            </TableCell>
                                            <TableCell><FormField control={form.control} name={`priceCategories.${index}.priority`} render={({field}) => <Input type="number" {...field} />} /></TableCell>
                                            <TableCell>
                                                 <FormField control={form.control} name={`priceCategories.${index}.status`} render={({field}) => (
                                                    <Select onValueChange={field.onChange} value={field.value}>
                                                        <SelectTrigger><SelectValue/></SelectTrigger>
                                                        <SelectContent><SelectItem value="active">Ativa</SelectItem><SelectItem value="inactive">Inativa</SelectItem></SelectContent>
                                                    </Select>
                                                )} />
                                            </TableCell>
                                            <TableCell><Button type="button" variant="ghost" size="icon" onClick={() => removeCategory(index)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </div>
                 </TabsContent>

            </Tabs>
            <DialogFooter className="pt-4 border-t mt-auto">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit">Salvar parâmetros</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
