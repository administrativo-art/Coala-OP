"use client"

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { type Product, unitCategories, type UnitCategory } from '@/types';
import { getUnitsForCategory } from '@/lib/conversion';

const productSchema = z.object({
  baseName: z.string().min(1, 'O nome do insumo é obrigatório.'),
  category: z.enum(unitCategories),
  packageSize: z.coerce.number().min(0.001, 'O tamanho deve ser positivo.'),
  unit: z.string().min(1, 'A unidade é obrigatória.'),
});

type ProductFormValues = z.infer<typeof productSchema>;

type AnalysisItemFormModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  addProduct: (product: Omit<Product, 'id'>) => void;
  updateProduct: (updatedProduct: Product) => void;
  productToEdit: Product | null;
};

export function AnalysisItemFormModal({ 
  open, 
  onOpenChange,
  addProduct,
  updateProduct,
  productToEdit
}: AnalysisItemFormModalProps) {

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      baseName: '',
      category: 'Volume',
      packageSize: undefined,
      unit: 'L',
    },
  });

  const category = form.watch('category');

  useEffect(() => {
    if (open) {
      if (productToEdit) {
        form.reset({
          baseName: productToEdit.baseName,
          category: productToEdit.category,
          packageSize: productToEdit.packageSize,
          unit: productToEdit.unit,
        });
      } else {
        form.reset({ baseName: '', category: 'Volume', packageSize: undefined, unit: 'L' });
      }
    }
  }, [open, productToEdit, form]);

  useEffect(() => {
      const isDirty = form.formState.isDirty;
      if (category && (isDirty || !productToEdit)) {
          form.setValue('unit', getUnitsForCategory(category)[0]);
      }
  }, [category, form, productToEdit]);


  const onSubmit = (values: ProductFormValues) => {
    if (productToEdit) {
      updateProduct({ ...productToEdit, ...values });
    } else {
      addProduct(values);
    }
    onOpenChange(false);
  };

  return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{productToEdit ? 'Editar item de análise' : 'Adicionar novo item de análise'}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
                <FormField
                  control={form.control}
                  name="baseName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nome do item</FormLabel>
                      <FormControl><Input placeholder="ex: Ovomaltine" {...field} /></FormControl>
                      <FormDescription>Este nome deve ser idêntico ao nome do item nos relatórios de estoque para que a IA possa identificá-lo.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                 <div className="grid grid-cols-3 gap-4">
                    <FormField
                      control={form.control}
                      name="category"
                      render={({ field }) => (
                      <FormItem>
                          <FormLabel>Categoria</FormLabel>
                          <Select onValueChange={(value) => field.onChange(value as UnitCategory)} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger></FormControl>
                          <SelectContent>
                              {unitCategories.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
                          </SelectContent>
                          </Select>
                          <FormMessage />
                      </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="packageSize"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Tamanho</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              step="any"
                              placeholder="ex: 250"
                              {...field}
                              value={field.value ?? ''}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="unit"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Unidade</FormLabel>
                           <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl><SelectTrigger><SelectValue placeholder="Selecione uma unidade" /></SelectTrigger></FormControl>
                            <SelectContent>
                               {getUnitsForCategory(category).map(unit => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                </div>
                <FormDescription>
                    O tamanho e a unidade definem a embalagem base para os cálculos de estoque mínimo e máximo.
                </FormDescription>

                <DialogFooter className="pt-4">
                  <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                  <Button type="submit">{productToEdit ? 'Salvar alterações' : 'Adicionar item'}</Button>
                </DialogFooter>
              </form>
            </Form>
        </DialogContent>
      </Dialog>
  );
}
