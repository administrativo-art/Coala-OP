
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
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { PlusCircle, Edit, Trash2 } from 'lucide-react';
import { type Product, unitCategories, UnitCategory, type LotEntry, type PredefinedList } from '@/types';
import { units } from '@/lib/conversion';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { useToast } from '@/hooks/use-toast';

const productSchema = z.object({
  baseName: z.string().min(1, 'O nome do item é obrigatório.'),
  category: z.enum(unitCategories),
  unit: z.string().min(1, 'A unidade é obrigatória.'),
});

type ProductFormValues = z.infer<typeof productSchema>;

type ProductManagementModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  addProduct: (product: Omit<Product, 'id'>) => void;
  updateProduct: (updatedProduct: Product) => void;
  deleteProduct: (productId: string) => void;
  getProductFullName: (product: Product) => string;
  permissions: { add: boolean; edit: boolean; delete: boolean };
  lots: LotEntry[];
  lists: PredefinedList[];
};

export function ProductManagementModal({ 
  open, 
  onOpenChange,
  products,
  addProduct,
  updateProduct,
  deleteProduct,
  getProductFullName,
  permissions,
  lots,
  lists
}: ProductManagementModalProps) {
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  const { toast } = useToast();

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
      setShowForm(false);
      setEditingProduct(null);
    }
  }, [open]);

  useEffect(() => {
      if (category) {
          form.setValue('unit', Object.keys(units[category])[0]);
      }
  }, [category, form]);

  const handleAddNew = () => {
    setEditingProduct(null);
    form.reset({ baseName: '', category: 'Volume', unit: 'L' });
    setShowForm(true);
  };

  const handleEdit = (product: Product) => {
    setEditingProduct(product);
    form.reset({
      baseName: product.baseName,
      category: product.category,
      unit: product.unit,
    });
    setShowForm(true);
  };
  
  const handleDeleteClick = (product: Product) => {
    const usedInLotsCount = lots.filter(lot => lot.productId === product.id).length;
    const usedInLists = lists.filter(list => list.items.some(item => item.productId === product.id));

    let messages = [];
    if (usedInLotsCount > 0) {
        messages.push(`está sendo usado em ${usedInLotsCount} lote(s)`);
    }
    if (usedInLists.length > 0) {
        messages.push(`está nas listas: ${usedInLists.map(l => `"${l.name}"`).join(', ')}`);
    }

    if (messages.length > 0) {
        toast({
            variant: "destructive",
            title: "Não é possível excluir o item",
            description: `Este item não pode ser excluído pois ${messages.join(' e ')}.`,
            duration: 8000,
        });
        return;
    }
    setProductToDelete(product);
  };

  const handleDeleteConfirm = async () => {
    if (productToDelete) {
      try {
        await deleteProduct(productToDelete.id);
        setProductToDelete(null);
      } catch (error) {
        console.error("Deletion failed", error)
      }
    }
  };

  const onSubmit = (values: ProductFormValues) => {
    const dataToSave = { ...values, packageSize: 1 };
    if (editingProduct) {
      updateProduct({ ...editingProduct, ...dataToSave });
    } else {
      addProduct(dataToSave);
    }
    setShowForm(false);
    setEditingProduct(null);
  };

  const canManageAnything = permissions.add || permissions.edit || permissions.delete;
  if (!canManageAnything) {
    return null;
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Gerenciar itens</DialogTitle>
            <DialogDescription>Adicione ou edite os itens genéricos para a Análise de Estoque. Esta lista de itens servirá para o sistema identificar os itens nos relatórios.</DialogDescription>
          </DialogHeader>
          
          {showForm ? (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <h3 className="text-lg font-medium">{editingProduct ? 'Editar item' : 'Adicionar novo item'}</h3>
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
                  <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
                  <Button type="submit">{editingProduct ? 'Salvar alterações' : 'Adicionar item'}</Button>
                </DialogFooter>
              </form>
            </Form>
          ) : (
            <>
              {permissions.add && (
                <Button onClick={handleAddNew} className="w-full">
                  <PlusCircle className="mr-2 h-4 w-4" /> Adicionar novo item
                </Button>
              )}
              <Separator className="my-4" />
              <ScrollArea className="h-72">
                <div className="space-y-2 pr-4">
                  {products.length > 0 ? products.map(product => (
                    <div key={product.id} className="flex items-center justify-between rounded-md border p-3">
                      <span className="font-medium">{getProductFullName(product)}</span>
                      <div className="flex gap-2">
                        {permissions.edit && <Button variant="ghost" size="icon" onClick={() => handleEdit(product)}><Edit className="h-4 w-4" /></Button>}
                        {permissions.delete && <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => handleDeleteClick(product)}><Trash2 className="h-4 w-4" /></Button>}
                      </div>
                    </div>
                  )) : (
                    <p className="text-center text-muted-foreground py-8">Nenhum item ainda. Adicione um para começar!</p>
                  )}
                </div>
              </ScrollArea>
            </>
          )}
        </DialogContent>
      </Dialog>
      {productToDelete && (
        <DeleteConfirmationDialog
          open={!!productToDelete}
          onOpenChange={() => setProductToDelete(null)}
          onConfirm={handleDeleteConfirm}
          itemName={getProductFullName(productToDelete)}
        />
      )}
    </>
  );
}
