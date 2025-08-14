

      
"use client"

import { useEffect, useMemo, useState } from 'react';
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
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { useAuth } from '@/hooks/use-auth';
import { Tooltip, TooltipProvider, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { useBaseProducts } from '@/hooks/use-base-products';
import { useKiosks } from '@/hooks/use-kiosks';
import { units, unitCategories, type UnitCategory } from '@/lib/conversion';
import { type BaseProduct } from '@/types';
import { DollarSign, RefreshCw, Info, Lock, Unlock, Clock, Calendar, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Separator } from './ui/separator';


const stockLevelSchema = z.object({
    kioskId: z.string(),
    min: z.coerce.number().min(0, "Deve ser um valor positivo.").optional(),
    safetyStock: z.coerce.number().min(0, "Deve ser um valor positivo.").optional(),
    leadTime: z.coerce.number().min(0, "Deve ser um valor positivo.").optional(),
    override: z.boolean(),
});

const baseProductSchema = z.object({
  name: z.string().min(1, 'O nome é obrigatório.'),
  classification: z.string().optional(),
  category: z.enum(unitCategories),
  unit: z.string().min(1, 'A unidade de medida é obrigatória.'),
  initialCostPerUnit: z.coerce.number().optional(),
  stockLevels: z.array(stockLevelSchema),
  consumptionMonths: z.coerce.number().min(0, "Deve ser um valor positivo.").optional(),
});

type BaseProductFormValues = z.infer<typeof baseProductSchema>;

interface AddEditBaseProductModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productToEditId: string | null;
}

export function AddEditBaseProductModal({ open, onOpenChange, productToEditId }: AddEditBaseProductModalProps) {
  const { baseProducts, updateBaseProduct, addBaseProduct } = useBaseProducts();
  const { kiosks } = useKiosks();
  const { permissions } = useAuth();
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  
  const productToEdit = useMemo(() => {
    if (!productToEditId) return null;
    return baseProducts.find(p => p.id === productToEditId) || null;
  }, [productToEditId, baseProducts]);

  const sortedKiosks = useMemo(() => {
    return [...kiosks].sort((a,b) => {
        if (a.id === 'matriz') return -1;
        if (b.id === 'matriz') return 1;
        return a.name.localeCompare(b.name);
    });
  }, [kiosks]);

  const classificationOptions = useMemo(() => {
    const classifications = new Set(baseProducts.map(p => p.classification).filter(Boolean));
    return Array.from(classifications).sort();
  }, [baseProducts]);

  const form = useForm<BaseProductFormValues>({
    resolver: zodResolver(baseProductSchema),
    defaultValues: { name: '', classification: '', category: 'Massa', unit: 'g', initialCostPerUnit: 0, stockLevels: [], consumptionMonths: 0 }
  });

  const { fields, update } = useFieldArray({
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
          classification: productToEdit.classification || '',
          category: productToEdit.category,
          unit: productToEdit.unit,
          initialCostPerUnit: productToEdit.lastEffectivePrice?.pricePerUnit ?? productToEdit.initialCostPerUnit ?? 0,
          stockLevels: sortedKiosks.map(kiosk => {
            const level = productToEdit.stockLevels?.[kiosk.id];
            return {
                kioskId: kiosk.id,
                min: level?.min ?? 0,
                safetyStock: level?.safetyStock ?? 0,
                leadTime: level?.leadTime ?? 0,
                override: level?.override ?? false,
            };
          }),
          consumptionMonths: productToEdit.consumptionMonths,
        });
      } else {
        form.reset({
          name: '',
          classification: '',
          category: 'Massa',
          unit: 'g',
          initialCostPerUnit: 0,
          stockLevels: sortedKiosks.map(kiosk => ({ kioskId: kiosk.id, min: 0, safetyStock: 0, leadTime: 0, override: false })),
          consumptionMonths: 0,
        });
      }
    }
  }, [productToEdit, open, form, sortedKiosks]);

  const onSubmit = (values: BaseProductFormValues) => {
    const stockLevelsObject: { [kioskId: string]: { min: number, safetyStock: number, leadTime: number, override: boolean } } = {};
    values.stockLevels.forEach(sl => {
        stockLevelsObject[sl.kioskId] = { 
            min: sl.min ?? 0,
            safetyStock: sl.safetyStock ?? 0,
            leadTime: sl.leadTime ?? 0,
            override: sl.override 
        };
    });

    const dataPayload = {
      name: values.name,
      classification: values.classification,
      category: values.category,
      unit: values.unit,
      stockLevels: stockLevelsObject,
      consumptionMonths: values.consumptionMonths,
    };

    if (productToEdit) {
      const updatedProduct: any = { 
        ...productToEdit,
        ...dataPayload
      };
      
      if (!productToEdit.lastEffectivePrice) {
          updatedProduct.initialCostPerUnit = values.initialCostPerUnit;
      }
      
      updateBaseProduct(updatedProduct);

    } else {
       const newProduct = {
        ...dataPayload,
        initialCostPerUnit: values.initialCostPerUnit,
      };
      addBaseProduct(newProduct);
    }
    onOpenChange(false);
  };
  
  const handleResetPrice = () => {
    if (!productToEdit) return;
    
    const updatedProduct = {
      ...productToEdit,
      lastEffectivePrice: null
    };

    updateBaseProduct(updatedProduct);
    setIsResetConfirmOpen(false);
  };
  
  const hasEffectivePrice = !!productToEdit?.lastEffectivePrice;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl h-[90vh] flex flex-col">
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
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="name" render={({ field }) => (
                      <FormItem>
                          <FormLabel>Nome do produto base</FormLabel>
                          <FormControl><Input placeholder="ex: Ovomaltine (Pó)" {...field} /></FormControl>
                          <FormMessage />
                      </FormItem>
                      )}
                    />
                    <FormField control={form.control} name="classification" render={({ field }) => (
                      <FormItem>
                          <FormLabel>Classificação (opcional)</FormLabel>
                           <Select onValueChange={field.onChange} value={field.value ?? ''}>
                                <FormControl><SelectTrigger><SelectValue placeholder="Selecione a classificação" /></SelectTrigger></FormControl>
                                <SelectContent>
                                    {classificationOptions.map(option => (
                                        <SelectItem key={option} value={option}>{option}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                          <FormMessage />
                      </FormItem>
                      )}
                    />
                   </div>
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

                  <FormField
                      control={form.control}
                      name="initialCostPerUnit"
                      render={({ field }) => (
                          <FormItem>
                              <FormLabel>Custo por Unidade (R$)</FormLabel>
                              <div className="flex items-center gap-2">
                                <div className="relative flex-grow">
                                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        type="number"
                                        step="0.01"
                                        placeholder="0,00"
                                        className="pl-8"
                                        {...field}
                                        value={field.value ?? ''}
                                        disabled={hasEffectivePrice}
                                    />
                                </div>
                                {hasEffectivePrice && permissions.pricing.manageParameters && (
                                  <Button type="button" variant="outline" size="icon" onClick={() => setIsResetConfirmOpen(true)}>
                                    <RefreshCw className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                              <FormMessage />
                              <p className="text-xs text-muted-foreground pt-1">
                                  {hasEffectivePrice 
                                      ? "Custo efetivado por uma compra. Para editar, um admin deve resetar o preço."
                                      : "Este custo é usado como fallback até que uma compra seja efetivada."
                                  }
                              </p>
                          </FormItem>
                      )}
                  />

                  <Separator />
                  <FormField control={form.control} name="consumptionMonths" render={({ field }) => (
                    <FormItem>
                        <FormLabel className="flex items-center gap-1.5"><Calendar className="h-4 w-4 text-muted-foreground"/>Sugerir Pedido para (meses)</FormLabel>
                        <FormControl><Input type="number" placeholder="Ex: 2" {...field} value={field.value ?? ''} /></FormControl>
                        <FormMessage />
                    </FormItem>
                    )}/>
                  
                  <Separator />
                  <h3 className="text-md font-medium pt-2">Parâmetros por quiosque (opcional)</h3>

                  <div className="rounded-md border">
                      <Table>
                          <TableHeader>
                              <TableRow>
                                  <TableHead>Quiosque</TableHead>
                                  <TableHead className="text-center">Estoque Mínimo</TableHead>
                                  <TableHead className="text-center">Estoque Segurança</TableHead>
                                  <TableHead className="text-center">Lead Time (dias)</TableHead>
                              </TableRow>
                          </TableHeader>
                          <TableBody>
                              {fields.map((field, index) => {
                                const kiosk = sortedKiosks.find(k => k.id === field.kioskId);
                                return (
                                  <TableRow key={field.id}>
                                    <TableCell className="font-medium">
                                      {kiosk?.name}
                                    </TableCell>
                                    <TableCell>
                                       <FormField control={form.control} name={`stockLevels.${index}.min`} render={({ field: minField }) => (
                                            <FormItem><FormControl><Input type="number" className="text-right w-full" {...minField} value={minField.value ?? ''} /></FormControl><FormMessage /></FormItem>
                                        )}/>
                                    </TableCell>
                                     <TableCell>
                                       <FormField control={form.control} name={`stockLevels.${index}.safetyStock`} render={({ field: safetyField }) => (
                                            <FormItem><FormControl><Input type="number" className="text-right w-full" {...safetyField} value={safetyField.value ?? ''} /></FormControl><FormMessage /></FormItem>
                                        )}/>
                                    </TableCell>
                                     <TableCell>
                                       <FormField control={form.control} name={`stockLevels.${index}.leadTime`} render={({ field: leadTimeField }) => (
                                            <FormItem><FormControl><Input type="number" className="text-right w-full" {...leadTimeField} value={leadTimeField.value ?? ''} /></FormControl><FormMessage /></FormItem>
                                        )}/>
                                    </TableCell>
                                  </TableRow>
                                )}
                              )}
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
      {productToEdit && <DeleteConfirmationDialog 
        open={isResetConfirmOpen}
        onOpenChange={setIsResetConfirmOpen}
        onConfirm={handleResetPrice}
        title="Resetar Preço Efetivado?"
        description={`Esta ação fará com que o sistema volte a usar o custo inicial para "${productToEdit.name}". O campo de custo voltará a ser editável até a próxima compra efetivada. Deseja continuar?`}
        confirmButtonText="Sim, resetar"
        confirmButtonVariant="destructive"
      />}
    </>
  );
}
