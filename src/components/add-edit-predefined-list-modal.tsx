
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
import { Separator } from '@/components/ui/separator';
import { PlusCircle, Trash2 } from 'lucide-react';
import { type Product, type PredefinedList } from '@/types';
import { getUnitsForCategory } from '@/lib/conversion';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu';
import { Checkbox } from './ui/checkbox';
import { Label } from './ui/label';

const predefinedItemSchema = z.object({
  id: z.string(),
  productId: z.string().min(1, "Selecione um produto."),
  fromUnit: z.string().min(1, "Selecione a unidade de origem."),
  toUnit: z.string().min(1, "Selecione a unidade de destino."),
});

const predefinedListSchema = z.object({
  name: z.string().min(1, 'O nome do modelo é obrigatório.'),
  items: z.array(predefinedItemSchema).min(1, "O modelo precisa ter pelo menos um item."),
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
  const [isAddProductPopoverOpen, setIsAddProductPopoverOpen] = useState(false);
  const [productsToAdd, setProductsToAdd] = useState<Set<string>>(new Set());
  
  const form = useForm<ListFormValues>({
    resolver: zodResolver(predefinedListSchema),
    defaultValues: { name: '', items: [] }
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "items"
  });
  
  const activeProducts = useMemo(() => products.filter(p => !p.isArchived), [products]);
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
  
  const handleToggleProductToAdd = (productId: string) => {
    setProductsToAdd(prev => {
        const newSet = new Set(prev);
        if (newSet.has(productId)) {
            newSet.delete(productId);
        } else {
            newSet.add(productId);
        }
        return newSet;
    });
  };

  const handleAddSelectedProducts = () => {
    const sortedProductsToAdd = [...productsToAdd].sort((aId, bId) => {
        const productA = activeProducts.find(p => p.id === aId);
        const productB = activeProducts.find(p => p.id === bId);
        if (!productA || !productB) return 0;
        return getProductFullName(productA).localeCompare(getProductFullName(productB));
    });

    sortedProductsToAdd.forEach(productId => {
        append({
            id: 'item-' + new Date().getTime().toString(36) + Math.random().toString(36).slice(2),
            productId: productId,
            fromUnit: '',
            toUnit: '',
        });
    });

    setProductsToAdd(new Set());
    setIsAddProductPopoverOpen(false);
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{listToEdit ? 'Editar modelo de contagem' : 'Criar novo modelo de contagem'}</DialogTitle>
          <DialogDescription>
            {listToEdit ? 'Atualize o nome e os itens do modelo.' : 'Crie um modelo com conversões rápidas para usar no dia a dia.'}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome do modelo</FormLabel>
                  <FormControl><Input placeholder="ex: Contagem Semanal de Freezer" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Separator />
            <h3 className="text-md font-medium">Itens do modelo</h3>
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
                                  <SelectContent>{activeProducts.map(p => <SelectItem key={p.id} value={p.id}>{getProductFullName(p)}</SelectItem>)}</SelectContent>
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
             <Popover open={isAddProductPopoverOpen} onOpenChange={setIsAddProductPopoverOpen}>
                <PopoverTrigger asChild>
                    <Button type="button" variant="outline" className="w-full">
                        <PlusCircle className="mr-2" /> Adicionar item(s) ao modelo
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80">
                    <div className="grid gap-4">
                        <div className="space-y-2">
                            <h4 className="font-medium leading-none">Selecionar Produtos</h4>
                            <p className="text-sm text-muted-foreground">
                                Marque os produtos que deseja adicionar.
                            </p>
                        </div>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="sm">Opções</Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                                <DropdownMenuItem onSelect={() => setProductsToAdd(new Set(activeProducts.map(p => p.id)))}>
                                    Selecionar Todos
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => setProductsToAdd(new Set())}>
                                    Limpar Seleção
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <ScrollArea className="h-48">
                            <div className="space-y-2 p-1">
                                {activeProducts
                                    .sort((a,b) => getProductFullName(a).localeCompare(getProductFullName(b)))
                                    .map(product => (
                                    <div key={product.id} className="flex items-center space-x-2">
                                        <Checkbox
                                            id={`add-${product.id}`}
                                            checked={productsToAdd.has(product.id)}
                                            onCheckedChange={() => handleToggleProductToAdd(product.id)}
                                        />
                                        <Label htmlFor={`add-${product.id}`} className="font-normal w-full cursor-pointer">
                                            {getProductFullName(product)}
                                        </Label>
                                    </div>
                                ))}
                            </div>
                        </ScrollArea>
                        <Button onClick={handleAddSelectedProducts} disabled={productsToAdd.size === 0}>
                            Adicionar ({productsToAdd.size})
                        </Button>
                    </div>
                </PopoverContent>
            </Popover>
            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit">{listToEdit ? 'Salvar alterações' : 'Criar modelo'}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
