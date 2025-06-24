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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { PlusCircle, Edit, Trash2 } from 'lucide-react';

import { useProducts } from '@/hooks/use-products';
import { type Product, unitCategories, UnitCategory } from '@/types';
import { units } from '@/lib/conversion';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';

const productSchema = z.object({
  baseName: z.string().min(1, 'O nome do produto é obrigatório.'),
  category: z.enum(unitCategories),
  packageSize: z.coerce.number().min(0.001, 'O tamanho do pacote deve ser positivo.'),
  unit: z.string().min(1, 'A unidade é obrigatória.'),
});

type ProductFormValues = z.infer<typeof productSchema>;

type ProductManagementModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ProductManagementModal({ open, onOpenChange }: ProductManagementModalProps) {
  const { products, addProduct, updateProduct, deleteProduct, getProductFullName } = useProducts();
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      baseName: '',
      category: 'Volume',
      packageSize: 1,
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
    form.reset({ baseName: '', category: 'Volume', packageSize: 1, unit: 'L' });
    setShowForm(true);
  };

  const handleEdit = (product: Product) => {
    setEditingProduct(product);
    form.reset({
      baseName: product.baseName,
      category: product.category,
      packageSize: product.packageSize,
      unit: product.unit,
    });
    setShowForm(true);
  };
  
  const handleDeleteClick = (product: Product) => {
    setProductToDelete(product);
  };

  const handleDeleteConfirm = () => {
    if (productToDelete) {
      deleteProduct(productToDelete.id);
      setProductToDelete(null);
    }
  };

  const onSubmit = (values: ProductFormValues) => {
    if (editingProduct) {
      updateProduct({ ...editingProduct, ...values });
    } else {
      addProduct(values);
    }
    setShowForm(false);
    setEditingProduct(null);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Gerenciar Produtos</DialogTitle>
            <DialogDescription>Adicione, edite ou exclua seus produtos de inventário.</DialogDescription>
          </DialogHeader>
          
          {showForm ? (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <h3 className="text-lg font-medium">{editingProduct ? 'Editar Produto' : 'Adicionar Novo Produto'}</h3>
                <FormField
                  control={form.control}
                  name="baseName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nome do Produto</FormLabel>
                      <FormControl><Input placeholder="ex: Leite Integral" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                    name="packageSize"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tamanho do Pacote</FormLabel>
                        <FormControl><Input type="number" step="any" {...field} /></FormControl>
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
                             {Object.keys(units[category]).map(unit => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <DialogFooter className="pt-4">
                  <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
                  <Button type="submit">{editingProduct ? 'Salvar Alterações' : 'Adicionar Produto'}</Button>
                </DialogFooter>
              </form>
            </Form>
          ) : (
            <>
              <Button onClick={handleAddNew} className="w-full">
                <PlusCircle className="mr-2 h-4 w-4" /> Adicionar Novo Produto
              </Button>
              <Separator className="my-4" />
              <ScrollArea className="h-72">
                <div className="space-y-2 pr-4">
                  {products.length > 0 ? products.map(product => (
                    <div key={product.id} className="flex items-center justify-between rounded-md border p-3">
                      <span className="font-medium">{getProductFullName(product)}</span>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(product)}><Edit className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => handleDeleteClick(product)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </div>
                  )) : (
                    <p className="text-center text-muted-foreground py-8">Nenhum produto ainda. Adicione um para começar!</p>
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
