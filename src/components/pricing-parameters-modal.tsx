
"use client";

import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useCompanySettings } from '@/hooks/use-company-settings';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PlusCircle, Trash2, Palette } from 'lucide-react';
import { type PricingParameters } from '@/types';
import { useEffect } from 'react';
import { cn } from '@/lib/utils';

const profitRangeSchema = z.object({
  id: z.string(),
  from: z.coerce.number(),
  to: z.coerce.number(),
  color: z.string().min(1, "Selecione uma cor"),
});

const parametersSchema = z.object({
  defaultOperationPercentage: z.coerce.number().min(0, "Deve ser um valor positivo."),
  profitRanges: z.array(profitRangeSchema),
});

type ParametersFormValues = z.infer<typeof parametersSchema>;

const colorOptions = [
  { value: 'text-destructive', label: 'Vermelho (Destrutivo)' },
  { value: 'text-orange-500', label: 'Laranja' },
  { value: 'text-yellow-500', label: 'Amarelo' },
  { value: 'text-green-600', label: 'Verde' },
  { value: 'text-primary', label: 'Primária (Rosa)' },
  { value: 'text-blue-500', label: 'Azul' },
];

interface PricingParametersModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PricingParametersModal({ open, onOpenChange }: PricingParametersModalProps) {
  const { pricingParameters, updatePricingParameters } = useCompanySettings();

  const form = useForm<ParametersFormValues>({
    resolver: zodResolver(parametersSchema),
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'profitRanges',
  });

  useEffect(() => {
    if (open && pricingParameters) {
      form.reset({
        defaultOperationPercentage: pricingParameters.defaultOperationPercentage,
        profitRanges: pricingParameters.profitRanges,
      });
    }
  }, [open, pricingParameters, form]);

  const onSubmit = (values: ParametersFormValues) => {
    updatePricingParameters(values);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Configurar Parâmetros de Precificação</DialogTitle>
          <DialogDescription>
            Defina os valores padrão e as faixas de cores para a análise de lucratividade.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 pt-4 flex-1 flex flex-col overflow-hidden">
            <ScrollArea className="flex-1 pr-4">
              <div className="space-y-6">
                <FormField
                  control={form.control}
                  name="defaultOperationPercentage"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Percentual de Operação Padrão</FormLabel>
                      <div className="relative w-32">
                        <Input type="number" className="pr-8" {...field} />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div>
                  <FormLabel>Faixas de Lucratividade</FormLabel>
                  <div className="space-y-2 mt-2 p-3 border rounded-lg">
                    <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center text-sm text-muted-foreground">
                        <span>De (%)</span>
                        <span>Até (%)</span>
                        <span>Cor</span>
                        <div className="w-8 h-8"></div>
                    </div>
                    {fields.map((field, index) => (
                      <div key={field.id} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
                        <FormField
                          control={form.control}
                          name={`profitRanges.${index}.from`}
                          render={({ field }) => (
                            <FormItem><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`profitRanges.${index}.to`}
                          render={({ field }) => (
                            <FormItem><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`profitRanges.${index}.color`}
                          render={({ field }) => (
                            <FormItem>
                              <Select onValueChange={field.onChange} value={field.value}>
                                <FormControl><SelectTrigger><SelectValue placeholder="Cor" /></SelectTrigger></FormControl>
                                <SelectContent>
                                  {colorOptions.map(opt => (
                                    <SelectItem key={opt.value} value={opt.value}>
                                        <div className="flex items-center gap-2">
                                            <div className={cn("w-3 h-3 rounded-full", opt.value.replace('text-', 'bg-'))} />
                                            {opt.label}
                                        </div>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => remove(index)}>
                            <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-2"
                        onClick={() => append({ id: `range-${Date.now()}`, from: 0, to: 0, color: 'text-primary' })}
                        >
                        <PlusCircle className="mr-2 h-4 w-4" />
                        Adicionar Faixa
                    </Button>
                  </div>
                </div>
              </div>
            </ScrollArea>
            <DialogFooter className="pt-4 border-t mt-auto">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit">Salvar Parâmetros</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
