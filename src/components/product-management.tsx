
"use client"

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

import { useProducts } from '@/hooks/use-products';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { usePredefinedLists } from '@/hooks/use-predefined-lists';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { PlusCircle, Edit, Trash2 } from 'lucide-react';
import { type Product, unitCategories, type UnitCategory } from '@/types';
import { getUnitsForCategory } from '@/lib/conversion';
import { useToast } from '@/hooks/use-toast';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';


const productFormSchema = z.object({
  baseName: z.string().min(1, 'O nome base é obrigatório.'),
  category: z.enum(unitCategories),
  packageSize: z.coerce.number().min(0.001, 'O tamanho do pacote deve ser positivo.'),
  unit: z.string().min(1, 'A unidade é obrigatória.'),
});

type ProductFormValues = z.infer<typeof productFormSchema>;


interface ProductManagementProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProductManagement({ open, onOpenChange }: ProductManagementProps) {
    const { products, loading: productsLoading, getProductFullName, addProduct, updateProduct, deleteProduct } = useProducts();
    const { lots, loading: lotsLoading } = useExpiryProducts();
    const { lists, loading: listsLoading } = usePredefinedLists();
    const { toast } = useToast();

    const [editingProduct, setEditingProduct] = useState<Product | null>(null);
    const [showForm, setShowForm] = useState(false);
    const [productToDelete, setProductToDelete] = useState<Product | null>(null);

    const form = useForm<ProductFormValues>({
        resolver: zodResolver(productFormSchema),
        defaultValues: {
            baseName: '',
            category: 'Massa',
            packageSize: undefined,
            unit: 'g',
        }
    });
    
    const categoryWatch = form.watch('category');
    
    useEffect(() => {
        if (!form.formState.isDirty) {
            form.setValue('unit', getUnitsForCategory(categoryWatch)[0]);
        }
    }, [categoryWatch, form]);

    const handleOpenChangeAndReset = (isOpen: boolean) => {
        if (!isOpen) {
            setShowForm(false);
            setEditingProduct(null);
            setProductToDelete(null);
        }
        onOpenChange(isOpen);
    };

    const handleAddNew = () => {
        setEditingProduct(null);
        form.reset({
            baseName: '',
            category: 'Massa',
            packageSize: undefined,
            unit: 'g',
        });
        setShowForm(true);
    };

    const handleEdit = (product: Product) => {
        setEditingProduct(product);
        form.reset({
            baseName: product.baseName,
            category: product.category,
            packageSize: product.packageSize,
            unit: product.unit
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
            messages.push(`está nas listas predefinidas: ${usedInLists.map(l => `"${l.name}"`).join(', ')}`);
        }

        if (messages.length > 0) {
            toast({
                variant: "destructive",
                title: "Não é possível excluir o insumo",
                description: `Este insumo não pode ser excluído pois ${messages.join(' e ')}.`,
                duration: 8000,
            });
            return;
        }
        setProductToDelete(product);
    };
    
    const handleDeleteConfirm = async () => {
        if (productToDelete) {
            await deleteProduct(productToDelete.id);
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
    
    if (!open) return null;

    return (
        <>
            <Dialog open={open} onOpenChange={handleOpenChangeAndReset}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Gerenciar Insumos</DialogTitle>
                        <DialogDescription>
                            Adicione, edite ou exclua os insumos usados no controle de estoque e validade.
                        </DialogDescription>
                    </DialogHeader>

                    {showForm ? (
                        <Form {...form}>
                            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
                                <h3 className="text-lg font-medium">{editingProduct ? `Editando ${getProductFullName(editingProduct)}` : 'Adicionar novo insumo'}</h3>
                                <FormField control={form.control} name="baseName" render={({ field }) => (
                                    <FormItem><FormLabel>Nome base</FormLabel><FormControl><Input placeholder="ex: Ovomaltine" {...field} /></FormControl><FormMessage /></FormItem>
                                )}/>
                                <div className="grid grid-cols-3 gap-4">
                                    <FormField control={form.control} name="category" render={({ field }) => (
                                        <FormItem><FormLabel>Categoria</FormLabel>
                                            <Select onValueChange={(value) => field.onChange(value as UnitCategory)} value={field.value}>
                                                <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                                <SelectContent>{unitCategories.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}</SelectContent>
                                            </Select><FormMessage />
                                        </FormItem>
                                    )}/>
                                    <FormField control={form.control} name="packageSize" render={({ field }) => (
                                        <FormItem><FormLabel>Tamanho</FormLabel><FormControl><Input type="number" step="any" placeholder="ex: 250" {...field} /></FormControl><FormMessage /></FormItem>
                                    )}/>
                                    <FormField control={form.control} name="unit" render={({ field }) => (
                                        <FormItem><FormLabel>Unidade</FormLabel>
                                            <Select onValueChange={field.onChange} value={field.value}>
                                                <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                                <SelectContent>{getUnitsForCategory(categoryWatch).map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                                            </Select><FormMessage />
                                        </FormItem>
                                    )}/>
                                </div>
                                <DialogFooter className="pt-4 border-t">
                                    <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
                                    <Button type="submit">{editingProduct ? 'Salvar alterações' : 'Adicionar insumo'}</Button>
                                </DialogFooter>
                            </form>
                        </Form>
                    ) : (
                       <>
                            <Button onClick={handleAddNew} className="w-full mt-4"><PlusCircle className="mr-2 h-4 w-4" /> Adicionar novo insumo</Button>
                            <Separator className="my-4" />
                            <ScrollArea className="h-72">
                                <div className="space-y-2 pr-4">
                                    {products.map(product => (
                                        <div key={product.id} className="flex items-center justify-between rounded-md border p-3">
                                            <span className="font-medium">{getProductFullName(product)}</span>
                                            <div className="flex gap-2">
                                                <Button variant="ghost" size="icon" onClick={() => handleEdit(product)}><Edit className="h-4 w-4" /></Button>
                                                <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => handleDeleteClick(product)}><Trash2 className="h-4 w-4" /></Button>
                                            </div>
                                        </div>
                                    ))}
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
                    itemName={`o insumo "${getProductFullName(productToDelete)}"`}
                />
            )}
        </>
    );
}
