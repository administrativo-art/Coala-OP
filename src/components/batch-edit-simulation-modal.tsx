"use client";

import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useProductSimulationCategories } from '@/hooks/use-product-simulation-categories';
import { useProductSimulation } from '@/hooks/use-product-simulation';
import { useToast } from '@/hooks/use-toast';
import { type ProductSimulation } from '@/types';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from './ui/separator';
import { Loader2 } from 'lucide-react';
import { Input } from './ui/input';
import { ScrollArea } from './ui/scroll-area';


const batchEditSchema = z.object({
  target: z.enum(['selected', 'filtered']),
  lineAction: z.enum(['keep', 'set', 'clear']),
  lineId: z.string().optional(),
  categoryAction: z.enum(['keep', 'set', 'clear']),
  categoryId: z.string().optional(),
  groupAction: z.enum(['keep', 'set', 'clear']),
  groupId: z.string().optional(),
  priceAction: z.enum(['keep', 'increase', 'decrease']),
  priceAdjustmentType: z.enum(['percentage', 'fixed']),
  priceValue: z.coerce.number().optional(),
}).refine(data => {
    return data.lineAction !== 'keep' || data.categoryAction !== 'keep' || data.groupAction !== 'keep' || data.priceAction !== 'keep';
}, {
    message: "Selecione pelo menos uma alteração para aplicar.",
    path: ["target"], // Generic path
}).refine(data => {
    return data.lineAction !== 'set' || !!data.lineId;
}, {
    message: "Selecione uma linha.",
    path: ["lineId"],
}).refine(data => {
    return data.categoryAction !== 'set' || !!data.categoryId;
}, {
    message: "Selecione uma categoria.",
    path: ["categoryId"],
}).refine(data => {
    return data.groupAction !== 'set' || !!data.groupId;
}, {
    message: "Selecione um grupo.",
    path: ["groupId"],
}).refine(data => {
    return data.priceAction === 'keep' || (!!data.priceValue && data.priceValue > 0);
}, {
    message: "O valor deve ser positivo.",
    path: ["priceValue"],
});

type BatchEditFormValues = z.infer<typeof batchEditSchema>;

interface BatchEditSimulationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  simulations: ProductSimulation[];
  filteredSimulations: ProductSimulation[];
  selectedSimulationIds: Set<string>;
}

export function BatchEditSimulationModal({ open, onOpenChange, simulations, filteredSimulations, selectedSimulationIds }: BatchEditSimulationModalProps) {
    const { categories } = useProductSimulationCategories();
    const { bulkUpdateSimulations } = useProductSimulation();
    const { toast } = useToast();
    const [isSubmitting, setIsSubmitting] = useState(false);
    
    const form = useForm<BatchEditFormValues>({
        resolver: zodResolver(batchEditSchema),
        defaultValues: {
            target: selectedSimulationIds.size > 0 ? 'selected' : 'filtered',
            lineAction: 'keep',
            categoryAction: 'keep',
            groupAction: 'keep',
            priceAction: 'keep',
            priceAdjustmentType: 'percentage',
        }
    });
    
    const lines = useMemo(() => categories.filter(c => c.type === 'line'), [categories]);
    const mainCategories = useMemo(() => categories.filter(c => c.type === 'category'), [categories]);
    const groups = useMemo(() => categories.filter(c => c.type === 'group'), [categories]);

    const lineAction = form.watch('lineAction');
    const categoryAction = form.watch('categoryAction');
    const groupAction = form.watch('groupAction');
    const priceAction = form.watch('priceAction');
    const priceAdjustmentType = form.watch('priceAdjustmentType');

    const onSubmit = async (values: BatchEditFormValues) => {
        setIsSubmitting(true);
        
        const targetSimulations = values.target === 'selected'
            ? simulations.filter(sim => selectedSimulationIds.has(sim.id))
            : filteredSimulations;

        if (targetSimulations.length === 0) {
            toast({ variant: 'destructive', title: 'Nenhum item para atualizar.' });
            setIsSubmitting(false);
            return;
        }

        try {
            await bulkUpdateSimulations(targetSimulations, {
                line: { action: values.lineAction, id: values.lineId },
                category: { action: values.categoryAction, id: values.categoryId },
                group: { action: values.groupAction, id: values.groupId },
                price: { action: values.priceAction, type: values.priceAdjustmentType, value: values.priceValue || 0 }
            });
            toast({ title: "Sucesso!", description: `${targetSimulations.length} mercadorias foram atualizadas.` });
            onOpenChange(false);
        } catch (error) {
            toast({ variant: 'destructive', title: 'Erro ao atualizar', description: 'Não foi possível completar a operação.' });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-xl h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Alterar mercadorias em lote</DialogTitle>
                    <DialogDescription>
                        Aplique alterações a múltiplas mercadorias de uma só vez.
                    </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="flex-1 overflow-hidden flex flex-col">
                        <ScrollArea className="flex-1 pr-6 -mr-6">
                            <div className="space-y-6 pt-4">
                                <FormField
                                    control={form.control}
                                    name="target"
                                    render={({ field }) => (
                                        <FormItem className="space-y-3">
                                            <FormLabel>Quais itens você quer alterar?</FormLabel>
                                            <FormControl>
                                                <RadioGroup
                                                    onValueChange={field.onChange}
                                                    value={field.value}
                                                    className="flex gap-4"
                                                >
                                                    <FormItem className="flex items-center space-x-2 space-y-0">
                                                        <FormControl><RadioGroupItem value="selected" disabled={selectedSimulationIds.size === 0} /></FormControl>
                                                        <FormLabel className="font-normal">Itens selecionados ({selectedSimulationIds.size})</FormLabel>
                                                    </FormItem>
                                                    <FormItem className="flex items-center space-x-2 space-y-0">
                                                        <FormControl><RadioGroupItem value="filtered" /></FormControl>
                                                        <FormLabel className="font-normal">Resultado filtrado ({filteredSimulations.length})</FormLabel>
                                                    </FormItem>
                                                </RadioGroup>
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />

                                <Separator />

                                <div className="space-y-4">
                                    <h3 className="font-medium">Alterações</h3>
                                    {/* Linha */}
                                    <div className="p-4 border rounded-lg space-y-4">
                                        <FormLabel>Linha</FormLabel>
                                        <FormField control={form.control} name="lineAction" render={({ field }) => (
                                            <FormItem><FormControl>
                                                <Select onValueChange={field.onChange} value={field.value}>
                                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="keep">Não alterar</SelectItem>
                                                        <SelectItem value="set">Definir como:</SelectItem>
                                                        <SelectItem value="clear">Limpar valor</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </FormControl></FormItem>
                                        )}/>
                                        {lineAction === 'set' && (
                                            <FormField control={form.control} name="lineId" render={({ field }) => (
                                                <FormItem><FormControl>
                                                    <Select onValueChange={field.onChange} value={field.value}>
                                                        <SelectTrigger><SelectValue placeholder="Selecione uma linha..." /></SelectTrigger>
                                                        <SelectContent>
                                                            {lines.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                                                        </SelectContent>
                                                    </Select>
                                                </FormControl><FormMessage /></FormItem>
                                            )}/>
                                        )}
                                    </div>
                                    {/* Categoria */}
                                    <div className="p-4 border rounded-lg space-y-4">
                                        <FormLabel>Categoria</FormLabel>
                                        <FormField control={form.control} name="categoryAction" render={({ field }) => (
                                            <FormItem><FormControl>
                                                <Select onValueChange={field.onChange} value={field.value}>
                                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="keep">Não alterar</SelectItem>
                                                        <SelectItem value="set">Definir como:</SelectItem>
                                                        <SelectItem value="clear">Limpar valor</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </FormControl></FormItem>
                                        )}/>
                                        {categoryAction === 'set' && (
                                            <FormField control={form.control} name="categoryId" render={({ field }) => (
                                                <FormItem><FormControl>
                                                    <Select onValueChange={field.onChange} value={field.value}>
                                                        <SelectTrigger><SelectValue placeholder="Selecione uma categoria..." /></SelectTrigger>
                                                        <SelectContent>
                                                            {mainCategories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                                        </SelectContent>
                                                    </Select>
                                                </FormControl><FormMessage /></FormItem>
                                            )}/>
                                        )}
                                    </div>
                                    {/* Grupo */}
                                    <div className="p-4 border rounded-lg space-y-4">
                                        <FormLabel>Grupo por Insumo</FormLabel>
                                        <FormField control={form.control} name="groupAction" render={({ field }) => (
                                            <FormItem><FormControl>
                                                <Select onValueChange={field.onChange} value={field.value}>
                                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="keep">Não alterar</SelectItem>
                                                        <SelectItem value="set">Definir como:</SelectItem>
                                                        <SelectItem value="clear">Limpar valor</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </FormControl></FormItem>
                                        )}/>
                                        {groupAction === 'set' && (
                                            <FormField control={form.control} name="groupId" render={({ field }) => (
                                                <FormItem><FormControl>
                                                    <Select onValueChange={field.onChange} value={field.value}>
                                                        <SelectTrigger><SelectValue placeholder="Selecione um grupo..." /></SelectTrigger>
                                                        <SelectContent>
                                                            {groups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                                                        </SelectContent>
                                                    </Select>
                                                </FormControl><FormMessage /></FormItem>
                                            )}/>
                                        )}
                                    </div>
                                    {/* Preço de Venda */}
                                    <div className="p-4 border rounded-lg space-y-4">
                                        <FormLabel>Preço de Venda</FormLabel>
                                        <FormField control={form.control} name="priceAction" render={({ field }) => (
                                            <FormItem><FormControl>
                                                <Select onValueChange={field.onChange} value={field.value}>
                                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="keep">Não alterar</SelectItem>
                                                        <SelectItem value="increase">Aumentar valor</SelectItem>
                                                        <SelectItem value="decrease">Diminuir valor</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </FormControl></FormItem>
                                        )}/>
                                        {priceAction !== 'keep' && (
                                            <div className="flex gap-4 items-center">
                                                <FormField control={form.control} name="priceAdjustmentType" render={({ field }) => (
                                                    <FormItem className="flex-grow"><FormControl>
                                                        <RadioGroup onValueChange={field.onChange} value={field.value} className="flex gap-4">
                                                            <FormItem className="flex items-center space-x-2"><FormControl><RadioGroupItem value="percentage" /></FormControl><FormLabel className="font-normal">Percentual (%)</FormLabel></FormItem>
                                                            <FormItem className="flex items-center space-x-2"><FormControl><RadioGroupItem value="fixed" /></FormControl><FormLabel className="font-normal">Fixo (R$)</FormLabel></FormItem>
                                                        </RadioGroup>
                                                    </FormControl></FormItem>
                                                )}/>
                                                <FormField control={form.control} name="priceValue" render={({ field }) => (
                                                    <FormItem className="w-24"><FormControl><Input type="number" step="0.01" {...field} value={field.value || ''} /></FormControl><FormMessage /></FormItem>
                                                )}/>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </ScrollArea>
                        <DialogFooter className="pt-4 border-t mt-auto">
                            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                            <Button type="submit" disabled={isSubmitting}>
                                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Aplicar alterações
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}
