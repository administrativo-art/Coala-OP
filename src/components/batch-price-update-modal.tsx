
"use client";

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Loader2, ArrowUp, ArrowDown, Filter } from 'lucide-react';
import { type ProductSimulation, type SimulationCategory } from '@/types';
import { Alert, AlertTitle, AlertDescription } from './ui/alert';
import { Label } from './ui/label';

const updateSchema = z.object({
  adjustmentType: z.enum(['increase', 'decrease']),
  valueType: z.enum(['percentage', 'fixed']),
  value: z.coerce.number().positive("O valor deve ser maior que zero."),
});

type UpdateFormValues = z.infer<typeof updateSchema>;

interface BatchPriceUpdateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  simulationsToUpdate: ProductSimulation[];
  onConfirm: (
    simulations: ProductSimulation[],
    adjustmentType: 'increase' | 'decrease',
    valueType: 'percentage' | 'fixed',
    value: number
  ) => Promise<void>;
  activeFilters: {
    categoryName: string | null;
    lineName: string | null;
  }
}

export function BatchPriceUpdateModal({
  open,
  onOpenChange,
  simulationsToUpdate,
  onConfirm,
  activeFilters
}: BatchPriceUpdateModalProps) {
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<UpdateFormValues>({
    resolver: zodResolver(updateSchema),
    defaultValues: {
      adjustmentType: 'increase',
      valueType: 'percentage',
      value: undefined,
    },
  });

  const handleSubmit = async (values: UpdateFormValues) => {
    setIsLoading(true);
    await onConfirm(simulationsToUpdate, values.adjustmentType, values.valueType, values.value);
    setIsLoading(false);
    onOpenChange(false);
    form.reset();
  };
  
  const valueType = form.watch("valueType");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Alteração de Preço em Lote</DialogTitle>
          <DialogDescription>
            Aplique um reajuste de preço a todos os {simulationsToUpdate.length} itens que correspondem aos filtros atuais.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border bg-muted/50 p-3 space-y-1">
            <h4 className="flex items-center gap-2 text-sm font-semibold">
                <Filter className="h-4 w-4" />
                Filtros Ativos
            </h4>
            <p className="text-xs text-muted-foreground">
                <strong>Categoria:</strong> {activeFilters.categoryName || 'Todas'}
            </p>
             <p className="text-xs text-muted-foreground">
                <strong>Linha:</strong> {activeFilters.lineName || 'Todas'}
            </p>
        </div>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="adjustmentType"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <FormLabel>Tipo de Reajuste</FormLabel>
                  <FormControl>
                    <ToggleGroup
                      type="single"
                      onValueChange={field.onChange}
                      value={field.value}
                      className="w-full grid grid-cols-2"
                    >
                      <ToggleGroupItem value="increase" aria-label="Aumentar" className="h-12">
                        <ArrowUp className="mr-2 h-5 w-5 text-green-600" /> Aumentar
                      </ToggleGroupItem>
                      <ToggleGroupItem value="decrease" aria-label="Reduzir" className="h-12">
                        <ArrowDown className="mr-2 h-5 w-5 text-destructive" /> Reduzir
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="valueType"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <FormLabel>Método de Cálculo</FormLabel>
                  <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      value={field.value}
                      className="flex gap-4"
                    >
                      <FormItem className="flex items-center space-x-2">
                        <RadioGroupItem value="percentage" id="percentage" />
                        <Label htmlFor="percentage">Percentual (%)</Label>
                      </FormItem>
                      <FormItem className="flex items-center space-x-2">
                        <RadioGroupItem value="fixed" id="fixed" />
                        <Label htmlFor="fixed">Valor Fixo (R$)</Label>
                      </FormItem>
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="value"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Valor do Reajuste</FormLabel>
                   <div className="relative">
                    {valueType === 'fixed' && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">R$</span>}
                    <FormControl>
                      <Input 
                        type="number"
                        step="0.01"
                        placeholder="Ex: 10 para 10% ou 1.50 para R$ 1,50"
                        className={valueType === 'fixed' ? "pl-8" : "pr-8"}
                        {...field}
                       />
                    </FormControl>
                    {valueType === 'percentage' && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Alert>
                <AlertTitle>Atenção</AlertTitle>
                <AlertDescription>
                    Esta ação é irreversível. Os preços de venda dos {simulationsToUpdate.length} itens filtrados serão permanentemente alterados.
                </AlertDescription>
            </Alert>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Confirmar Alteração
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
