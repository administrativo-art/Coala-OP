
"use client";

import { useEffect, useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { type ProductSimulation, type PPO } from '@/types';
import { useProductSimulation } from '@/hooks/use-product-simulation';
import { useToast } from '@/hooks/use-toast';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PlusCircle, Trash2, Loader2 } from 'lucide-react';

const ppoSchema = z.object({
  sku: z.string().min(1, 'SKU é obrigatório.'),
  assemblyInstructions: z.array(z.object({ id: z.string(), text: z.string().min(1, "A instrução não pode ser vazia.") })),
  qualityStandard: z.string().optional(),
  allergens: z.string().optional(),
  preparationTime: z.coerce.number().optional(),
  portionWeight: z.coerce.number().optional(),
  portionTolerance: z.coerce.number().optional(),
  referenceImageUrl: z.string().optional(),
});

type PpoFormValues = z.infer<typeof ppoSchema>;

interface PpoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  simulation: ProductSimulation | null;
}

export function PpoModal({ open, onOpenChange, simulation }: PpoModalProps) {
  const { updateSimulation, simulationItems } = useProductSimulation();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<PpoFormValues>({
    resolver: zodResolver(ppoSchema),
    defaultValues: {
      sku: '',
      assemblyInstructions: [],
      qualityStandard: '',
      allergens: '',
      preparationTime: 0,
      portionWeight: 0,
      portionTolerance: 0,
      referenceImageUrl: '',
    },
  });

  const { fields: instructionFields, append, remove } = useFieldArray({
    control: form.control,
    name: 'assemblyInstructions',
  });

  useEffect(() => {
    if (simulation) {
      form.reset({
        sku: simulation.ppo?.sku || '',
        assemblyInstructions: simulation.ppo?.assemblyInstructions || [],
        qualityStandard: simulation.ppo?.qualityStandard || '',
        allergens: simulation.ppo?.allergens || '',
        preparationTime: simulation.ppo?.preparationTime || 0,
        portionWeight: simulation.ppo?.portionWeight || 0,
        portionTolerance: simulation.ppo?.portionTolerance || 0,
        referenceImageUrl: simulation.ppo?.referenceImageUrl || '',
      });
    }
  }, [simulation, form]);

  const onSubmit = async (values: PpoFormValues) => {
    if (!simulation) return;

    setIsLoading(true);
    const updatedSimulationData = {
      ...simulation,
      ppo: values,
      // We need to pass the items again, although they are not being edited here
      items: simulationItems.filter(item => item.simulationId === simulation.id),
    };
    
    await updateSimulation(updatedSimulationData);
    setIsLoading(false);
    toast({ title: 'PPO salvo com sucesso!' });
    onOpenChange(false);
  };

  if (!simulation) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Procedimento Padrão Operacional (PPO)</DialogTitle>
          <DialogDescription>
            Defina os padrões de produção para: {simulation.name}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex-1 overflow-hidden flex flex-col">
            <ScrollArea className="flex-1 pr-6">
              <div className="space-y-6 py-4">
                <FormField control={form.control} name="sku" render={({ field }) => (
                    <FormItem><FormLabel>SKU (Código do Produto)</FormLabel><FormControl><Input placeholder="Ex: MSK-MOR-P" {...field} /></FormControl><FormMessage /></FormItem>
                )}/>
                
                <div className="space-y-2">
                  <FormLabel>Modo de Montagem</FormLabel>
                  {instructionFields.map((field, index) => (
                    <div key={field.id} className="flex items-center gap-2">
                        <span className="font-semibold text-muted-foreground">{index + 1}.</span>
                        <FormField control={form.control} name={`assemblyInstructions.${index}.text`} render={({ field: stepField }) => (
                            <FormItem className="flex-grow"><FormControl><Input {...stepField} /></FormControl><FormMessage /></FormItem>
                        )}/>
                        <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => remove(index)}><Trash2 className="h-4 w-4"/></Button>
                    </div>
                  ))}
                    <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => append({ id: `instr-${Date.now()}`, text: '' })}>
                      <PlusCircle className="mr-2 h-4 w-4"/> Adicionar Passo
                  </Button>
                </div>

                <FormField control={form.control} name="qualityStandard" render={({ field }) => (
                    <FormItem><FormLabel>Padrão de Qualidade</FormLabel><FormControl><Textarea placeholder="Ex: Borda do copo limpa, cobertura uniforme..." {...field} /></FormControl><FormMessage /></FormItem>
                )}/>
                
                <FormField control={form.control} name="allergens" render={({ field }) => (
                    <FormItem><FormLabel>Alergênicos</FormLabel><FormControl><Textarea placeholder="Ex: Contém lactose, glúten." {...field} /></FormControl><FormMessage /></FormItem>
                )}/>

                <div className="grid grid-cols-3 gap-4">
                    <FormField control={form.control} name="preparationTime" render={({ field }) => (
                        <FormItem><FormLabel>Tempo de Preparo (segundos)</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
                    )}/>
                    <FormField control={form.control} name="portionWeight" render={({ field }) => (
                        <FormItem><FormLabel>Peso da Porção (g)</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
                    )}/>
                    <FormField control={form.control} name="portionTolerance" render={({ field }) => (
                        <FormItem><FormLabel>Tolerância (±g)</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
                    )}/>
                </div>
              </div>
            </ScrollArea>
            <DialogFooter className="pt-4 border-t mt-auto">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar PPO
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
