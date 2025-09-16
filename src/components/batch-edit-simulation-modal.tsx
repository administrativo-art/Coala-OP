
"use client";

import { useState } from 'react';
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


const batchEditSchema = z.object({
  target: z.enum(['selected', 'filtered']),
  lineAction: z.enum(['keep', 'set', 'clear']),
  lineId: z.string().optional(),
  categoryAction: z.enum(['keep', 'set', 'clear']),
  categoryId: z.string().optional(),
}).refine(data => {
    return data.lineAction !== 'keep' || data.categoryAction !== 'keep';
}, {
    message: "Selecione pelo menos uma alteração para Linha ou Categoria.",
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
        }
    });
    
    const lines = categories.filter(c => c.type === 'line');
    const mainCategories = categories.filter(c => c.type === 'category');

    const lineAction = form.watch('lineAction');
    const categoryAction = form.watch('categoryAction');

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

        const simulationIds = targetSimulations.map(sim => sim.id);
        const updates: Partial<Pick<ProductSimulation, 'linha' | 'categoria'>> = {};
        
        if (values.lineAction === 'set' && values.lineId) {
            updates.linha = values.lineId;
        } else if (values.lineAction === 'clear') {
            updates.linha = null;
        }
        
        if (values.categoryAction === 'set' && values.categoryId) {
            updates.categoria = values.categoryId;
        } else if (values.categoryAction === 'clear') {
            updates.categoria = null;
        }
        
        try {
            await bulkUpdateSimulations(simulationIds, updates);
            toast({ title: "Sucesso!", description: `${simulationIds.length} mercadorias foram atualizadas.` });
            onOpenChange(false);
        } catch (error) {
            toast({ variant: 'destructive', title: 'Erro ao atualizar', description: 'Não foi possível completar a operação.' });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-xl">
                <DialogHeader>
                    <DialogTitle>Alterar mercadorias em lote</DialogTitle>
                    <DialogDescription>
                        Aplique alterações de Linha ou Categoria a múltiplas mercadorias de uma só vez.
                    </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 pt-4">
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
                        </div>

                        <DialogFooter className="pt-4">
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
