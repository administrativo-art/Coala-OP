

"use client"

import { useEffect, useMemo } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { useBaseProducts } from '@/hooks/use-base-products';
import { useKiosks } from '@/hooks/use-kiosks';
import { units, unitCategories, type UnitCategory } from '@/lib/conversion';
import { type BaseProduct } from '@/types';


const baseProductSchema = z.object({
  name: z.string().min(1, 'O nome é obrigatório.'),
  category: z.enum(unitCategories),
  unit: z.string().min(1, 'A unidade de medida é obrigatória.'),
  stockLevels: z.array(z.object({
      kioskId: z.string(),
      min: z.coerce.number().min(0, "Deve ser um valor positivo.").optional(),
  }))
});

type BaseProductFormValues = z.infer<typeof baseProductSchema>;

interface AddEditBaseProductModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productToEdit: BaseProduct | null;
}

export function AddEditBaseProductModal({ open, onOpenChange, productToEdit }: AddEditBaseProductModalProps) {
  const { addBaseProduct, updateBaseProduct } = useBaseProducts();
  const { kiosks } = useKiosks();

  const sortedKiosks = useMemo(() => {
    return [...kiosks].sort((a,b) => {
        if (a.id === 'matriz') return -1;
        if (b.id === 'matriz') return 1;
        return a.name.localeCompare(b.name);
    });
  }, [kiosks]);

  const form = useForm<BaseProductFormValues>({
    resolver: zodResolver(baseProductSchema),
    defaultValues: { name: '', category: 'Massa', unit: 'g', stockLevels: [] }
  });

  const { fields } = useFieldArray({
    control: form.control,
    name: 'stockLevels'
  });

  const categoryWatch = form.watch('category');

  useEffect(() => {
    if (form.formState.isDirty || !productToEdit) {
        const availableUnits = Object.keys(units[categoryWatch]);
        form.setValue('unit', availableUnits[0] || '');
    }
  }, [categoryWatch, form, productToEdit]);

  useEffect(() => {
    if (open) {
      if (productToEdit) {
        form.reset({
          name: productToEdit.name,
          category: productToEdit.category,
          unit: productToEdit.unit,
          stockLevels: sortedKiosks.map(kiosk => ({
            kioskId: kiosk.id,
            min: productToEdit.stockLevels?.[kiosk.id]?.min ?? 0
          }))
        });
      } else {
        form.reset({
          name: '',
          category: 'Massa',
          unit: 'g',
          stockLevels: sortedKiosks.map(kiosk => ({ kioskId: kiosk.id, min: 0 }))
        });
      }
    }
  }, [productToEdit, open, form, sortedKiosks]);

  const onSubmit = (values: BaseProductFormValues) => {
    const stockLevelsObject: { [kioskId: string]: { min: number } } = {};
    values.stockLevels.forEach(sl => {
        if(sl.min !== undefined && sl.min > 0) {
            stockLevelsObject[sl.kioskId] = { min: sl.min };
        }
    });

    const finalValues = {
      name: values.name,
      category: values.category,
      unit: values.unit,
      stockLevels: stockLevelsObject
    };

    if (productToEdit) {
      updateBaseProduct({ ...productToEdit, ...finalValues });
    } else {
      addBaseProduct(finalValues);
    }
    onOpenChange(false);
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{productToEdit ? 'Editar produto base' : 'Novo produto base'}</DialogTitle>
          <DialogDescription>
            {productToEdit ? 'Edite as informações do produto base.' : 'Crie um novo produto base para agrupar insumos.'}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 flex-1 overflow-hidden flex flex-col">
            <ScrollArea className="flex-1 pr-6">
              <div className="space-y-4">
                 <FormField control={form.control} name="name" render={({ field }) => (
                    <FormItem>
                        <FormLabel>Nome do produto base</FormLabel>
                        <FormControl><Input placeholder="ex: Ovomaltine (Pó)" {...field} /></FormControl>
                        <FormMessage />
                    </FormItem>
                    )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="category" render={({ field }) => (
                        <FormItem><FormLabel>Categoria da unidade</FormLabel>
                            <Select onValueChange={(value) => field.onChange(value as UnitCategory)} value={field.value}>
                                <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                <SelectContent>{unitCategories.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}</SelectContent>
                            </Select>
                            <FormMessage />
                        </FormItem>
                    )}/>
                  <FormField control={form.control} name="unit" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Unidade de medida padrão</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                           <SelectContent>
                                {Object.keys(units[categoryWatch]).map(unit => (
                                    <SelectItem key={unit} value={unit}>{unit}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                  )}/>
                </div>
                
                <h3 className="text-md font-medium border-t pt-4">Níveis de estoque mínimo (opcional)</h3>

                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Quiosque</TableHead>
                                <TableHead className="text-right">Quantidade mínima</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {fields.map((field, index) => (
                                <TableRow key={field.id}>
                                <TableCell className="font-medium">
                                    {sortedKiosks.find(k => k.id === field.kioskId)?.name}
                                </TableCell>
                                <TableCell>
                                    <FormField
                                        control={form.control}
                                        name={`stockLevels.${index}.min`}
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormControl><Input type="number" className="text-right" {...field} /></FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
              </div>
            </ScrollArea>
            <DialogFooter className="pt-4 border-t mt-auto">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit">{productToEdit ? 'Salvar alterações' : 'Adicionar produto'}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
