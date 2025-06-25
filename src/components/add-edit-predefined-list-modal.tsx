"use client"

import { useEffect } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { PlusCircle, Trash2 } from 'lucide-react';
import { type Product, type PredefinedList } from '@/types';
import { getUnitsForCategory } from '@/lib/conversion';

const predefinedItemSchema = z.object({
  id: z.string(),
  productId: z.string().min(1, "Selecione um produto."),
  fromUnit: z.string().min(1, "Selecione a unidade de origem."),
  toUnit: z.string().min(1, "Selecione a unidade de destino."),
});

const predefinedListSchema = z.object({
  name: z.string().min(1, 'O nome da lista é obrigatório.'),
  items: z.array(predefinedItemSchema).min(1, "A lista precisa ter pelo menos um item."),
});

type ListFormValues = z.infer<typeof predefinedListSchema>;

type AddEditPredefinedListModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  listToEdit: PredefinedList | null;
  products: Product[];
  addList: (list: Omit<PredefinedList, 'id'>) => void;
  updateList: (list: PredefinedList) => void;
  getProductFullName: (product: Product) => string;
};

export function AddEditPredefinedListModal({ open, onOpenChange, listToEdit, products, addList, updateList, getProductFullName }: AddEditPredefinedListModalProps) {
  const form = useForm<ListFormValues>({
    resolver: zodResolver(predefinedListSchema),
    defaultValues: { name: '', items: [] }
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "items"
  });
  
  const watchedItems = form.watch('items');

  useEffect(() => {
    if (open) {
      if (listToEdit) {
        form.reset({
          name: listToEdit.name,
          items: listToEdit.items,
        });
      } else {
        form.reset({ name: '', items: [] });
      }
    }
  }, [listToEdit, open, form]);

  const onSubmit = (values: ListFormValues) => {
    if (listToEdit) {
      updateList({ ...listToEdit, ...values });
    } else {
      addList(values);
    }
    onOpenChange(false);
  };
  
  const handleAddItem = () => {
    append({ id: new Date().toISOString(), productId: '', fromUnit: '', toUnit: '' });
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{listToEdit ? 'Editar Lista' : 'Criar Nova Lista Predefinida'}</DialogTitle>
          <DialogDescription>
            {listToEdit ? 'Atualize o nome e os itens da lista.' : 'Crie uma lista com conversões rápidas para usar no dia a dia.'}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome da Lista</FormLabel>
                  <FormControl><Input placeholder="ex: Receitas de Milkshake" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Separator />
            <h3 className="text-md font-medium">Itens da Lista</h3>
            <ScrollArea className="h-60">
              <div className="space-y-4 pr-4">
                {fields.map((field, index) => {
                  const selectedProduct = products.find(p => p.id === watchedItems[index]?.productId);
                  const availableUnits = selectedProduct ? ['Pacote(s)', ...getUnitsForCategory(selectedProduct.category)] : [];
                  
                  return (
                    <div key={field.id} className="flex items-start gap-2 p-3 border rounded-lg">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 flex-grow">
                          <FormField
                            control={form.control}
                            name={`items.${index}.productId`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Produto</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                  <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
                                  <SelectContent>{products.map(p => <SelectItem key={p.id} value={p.id}>{getProductFullName(p)}</SelectItem>)}</SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name={`items.${index}.fromUnit`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>De</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value} disabled={!selectedProduct}>
                                  <FormControl><SelectTrigger><SelectValue placeholder="Unidade" /></SelectTrigger></FormControl>
                                  <SelectContent>{availableUnits.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name={`items.${index}.toUnit`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Para</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value} disabled={!selectedProduct}>
                                  <FormControl><SelectTrigger><SelectValue placeholder="Unidade" /></SelectTrigger></FormControl>
                                  <SelectContent>{availableUnits.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                      </div>
                      <Button type="button" variant="ghost" size="icon" className="text-destructive hover:text-destructive mt-8" onClick={() => remove(index)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
                 {fields.length === 0 && (
                    <p className="text-center text-muted-foreground py-4">Nenhum item adicionado ainda.</p>
                 )}
              </div>
            </ScrollArea>
             <Button type="button" variant="outline" className="w-full" onClick={handleAddItem}>
                <PlusCircle className="mr-2" /> Adicionar Item à Lista
            </Button>
            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit">{listToEdit ? 'Salvar Alterações' : 'Criar Lista'}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
