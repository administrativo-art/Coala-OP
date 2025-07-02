
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
import { type Product, unitCategories, UnitCategory } from '@/types';
import { units } from '@/lib/conversion';

const productSchema = z.object({
  baseName: z.string().min(1, 'O nome do insumo é obrigatório.'),
  category: z.enum(unitCategories),
  unit: z.string().min(1, 'A unidade é obrigatória.'),
});

type ProductFormValues = z.infer<typeof productSchema>;

type ProductManagementModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  addProduct: (product: Omit<Product, 'id'>) => void;
  updateProduct: (updatedProduct: Product) => void;
  productToEdit: Product | null;
};

export function ProductManagementModal({ 
  open, 
  onOpenChange,
  addProduct,
  updateProduct,
  productToEdit
}: ProductManagementModalProps) {

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      baseName: '',
      category: 'Volume',
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
          unit: productToEdit.unit,
        });
      } else {
        form.reset({ baseName: '', category: 'Volume', unit: 'L' });
      }
    }
  }, [open, productToEdit, form]);

  useEffect(() => {
      const isDirty = form.formState.isDirty;
      if (category && (isDirty || !productToEdit)) {
          form.setValue('unit', Object.keys(units[category])[0]);
      }
  }, [category, form, productToEdit]);


  const onSubmit = (values: ProductFormValues) => {
    const dataToSave = { ...values, packageSize: 1 };
    if (productToEdit) {
      updateProduct({ ...productToEdit, ...dataToSave });
    } else {
      addProduct(dataToSave);
    }
    onOpenChange(false);
  };

  return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{productToEdit ? 'Editar insumo' : 'Adicionar novo insumo'}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
                <FormField
                  control={form.control}
                  name="baseName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nome do insumo</FormLabel>
                      <FormControl><Input placeholder="ex: Ovomaltine" {...field} /></FormControl>
                      <FormDescription>Este nome deve ser idêntico ao nome do insumo nos relatórios de estoque para que a IA possa identificá-lo.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                 <FormField
                    control={form.control}
                    name="category"
                    render={({ field }) => (
                    <FormItem>
                        <FormLabel>Categoria</FormLabel>
                        <Select onValueChange={(value) => field.onChange(value as UnitCategory)} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Selecione uma categoria" /></SelectTrigger></FormControl>
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
                    name="unit"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Unidade de Medida</FormLabel>
                         <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Selecione uma unidade" /></SelectTrigger></FormControl>
                          <SelectContent>
                             {Object.keys(units[category]).map(unit => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormDescription>Esta é a unidade base que será usada para os cálculos de estoque mínimo e máximo.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                <DialogFooter className="pt-4">
                  <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                  <Button type="submit">{productToEdit ? 'Salvar alterações' : 'Adicionar insumo'}</Button>
                </DialogFooter>
              </form>
            </Form>
        </DialogContent>
      </Dialog>
  );
}
