

"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useProductSimulationCategories } from '@/hooks/use-product-simulation-categories';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PlusCircle, Edit, Trash2 } from 'lucide-react';
import { type ProductSimulationCategory } from '@/types';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { ScrollArea } from './ui/scroll-area';
import { cn } from '@/lib/utils';
import { useProductSimulation } from '@/hooks/use-product-simulation';

const categorySchema = z.object({
  name: z.string().min(1, 'O nome é obrigatório.'),
  color: z.string().optional(),
  parentId: z.string().nullable(),
}).superRefine((data, ctx) => {
    if (!data.parentId) {
        if (!data.color || !/^#[0-9a-fA-F]{6}$/.test(data.color)) {
             ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "A cor é obrigatória para categorias principais e deve estar no formato hexadecimal.",
                path: ["color"],
            });
        }
    }
    return true;
});


type CategoryFormValues = z.infer<typeof categorySchema>;

const defaultColors = ['#F87171', '#FBBF24', '#34D399', '#60A5FA', '#A78BFA', '#F472B6', '#FCA5A5', '#818CF8'];

export function CategoryManagementModal({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) {
    const { categories, addCategory, updateCategory, deleteCategory } = useProductSimulationCategories();
    const { simulations } = useProductSimulation();
    const [editingCategory, setEditingCategory] = useState<ProductSimulationCategory | null>(null);
    const [categoryToDelete, setCategoryToDelete] = useState<ProductSimulationCategory | null>(null);

    const form = useForm<CategoryFormValues>({
        resolver: zodResolver(categorySchema),
        defaultValues: { name: '', color: '#F87171', parentId: null },
    });
    
    const parentIdWatch = form.watch('parentId');
    
    useEffect(() => {
        if(open && !editingCategory) {
            form.setValue('parentId', null);
        }
    }, [open, editingCategory, form]);

    const mainCategories = useMemo(() => categories.filter(c => c.parentId === null), [categories]);

    const handleEditClick = (category: ProductSimulationCategory) => {
        setEditingCategory(category);
        form.reset({
            name: category.name,
            color: category.color || '#F87171',
            parentId: category.parentId || null
        });
    };

    const handleCancelEdit = () => {
        setEditingCategory(null);
        form.reset({ name: '', color: '#F87171', parentId: null });
    };
    
    const handleDeleteClick = (category: ProductSimulationCategory) => {
        const isUsed = simulations.some(s => s.categoryId === category.id || s.subcategoryId === category.id);
        const hasChildren = categories.some(c => c.parentId === category.id);
        
        if (isUsed || hasChildren) {
            alert(`Não é possível excluir "${category.name}". Ela está sendo usada por mercadorias ou possui subcategorias.`);
            return;
        }
        setCategoryToDelete(category);
    };

    const onSubmit = async (values: CategoryFormValues) => {
        if (editingCategory) {
            await updateCategory({ ...editingCategory, ...values });
        } else {
            await addCategory({
                ...values,
                color: values.parentId ? '' : values.color!, // Subcategories have no color
            });
        }
        handleCancelEdit();
    };
    
    const isSubcategoryMode = !!parentIdWatch;

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="max-w-3xl">
                    <DialogHeader>
                        <DialogTitle>Gerenciar Categorias</DialogTitle>
                        <DialogDescription>Crie, edite e organize as categorias e subcategorias para suas mercadorias.</DialogDescription>
                    </DialogHeader>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-4">
                        {/* Form Section */}
                        <div className="p-4 border rounded-lg">
                            <h3 className="font-semibold text-lg mb-4">
                                {editingCategory 
                                    ? "Editar" 
                                    : "Nova"} {isSubcategoryMode ? 'Subcategoria' : 'Categoria'}
                            </h3>
                            <Form {...form}>
                                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                                    <FormField control={form.control} name="name" render={({ field }) => (
                                        <FormItem><FormLabel>Nome</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                                    )}/>
                                    <FormField control={form.control} name="parentId" render={({ field }) => (
                                        <FormItem><FormLabel>Categoria Pai (para subcategorias)</FormLabel>
                                            <Select onValueChange={(v) => field.onChange(v === 'none' ? null : v)} value={field.value || 'none'}>
                                                <FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl>
                                                <SelectContent>
                                                    <SelectItem value="none">Nenhuma (Será uma Categoria Principal)</SelectItem>
                                                    {mainCategories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                                </SelectContent>
                                            </Select><FormMessage />
                                        </FormItem>
                                    )}/>
                                    {!parentIdWatch && (
                                        <FormField control={form.control} name="color" render={({ field }) => (
                                            <FormItem><FormLabel>Cor</FormLabel>
                                                <FormControl>
                                                    <div className="flex flex-wrap gap-2">
                                                        {defaultColors.map(color => (
                                                            <button type="button" key={color} onClick={() => field.onChange(color)}
                                                                className={cn("h-8 w-8 rounded-full border-2", field.value === color ? 'border-primary ring-2 ring-ring' : 'border-transparent')}
                                                                style={{ backgroundColor: color }} />
                                                        ))}
                                                        <Input type="color" value={field.value || '#000000'} onChange={field.onChange} className="w-12 h-8 p-1" />
                                                    </div>
                                                </FormControl><FormMessage /></FormItem>
                                        )}/>
                                    )}
                                    <div className="flex justify-end gap-2 pt-4">
                                        {editingCategory && <Button type="button" variant="outline" onClick={handleCancelEdit}>Cancelar</Button>}
                                        <Button type="submit"><PlusCircle className="mr-2 h-4 w-4" />{editingCategory ? "Salvar" : "Adicionar"}</Button>
                                    </div>
                                </form>
                            </Form>
                        </div>
                        {/* List Section */}
                        <div className="p-4 border rounded-lg">
                            <h3 className="font-semibold text-lg mb-4">Categorias existentes</h3>
                            <ScrollArea className="h-72">
                                <div className="space-y-2 pr-4">
                                    {mainCategories.map(cat => (
                                        <div key={cat.id}>
                                            <div className="flex items-center justify-between rounded-md border p-2 bg-muted/50">
                                                <div className="flex items-center gap-2">
                                                    <div className="h-4 w-4 rounded-full" style={{backgroundColor: cat.color}}></div>
                                                    <span className="font-medium">{cat.name}</span>
                                                </div>
                                                <div className="flex gap-1">
                                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEditClick(cat)}><Edit className="h-4 w-4"/></Button>
                                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDeleteClick(cat)}><Trash2 className="h-4 w-4"/></Button>
                                                </div>
                                            </div>
                                            {categories.filter(sub => sub.parentId === cat.id).map(subCat => (
                                                <div key={subCat.id} className="flex items-center justify-between rounded-md border p-2 pl-6 ml-4 mt-1">
                                                     <div className="flex items-center gap-2">
                                                        <span className="font-medium">{subCat.name}</span>
                                                    </div>
                                                    <div className="flex gap-1">
                                                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEditClick(subCat)}><Edit className="h-4 w-4"/></Button>
                                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDeleteClick(subCat)}><Trash2 className="h-4 w-4"/></Button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            </ScrollArea>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {categoryToDelete && (
                <DeleteConfirmationDialog 
                    open={!!categoryToDelete}
                    onOpenChange={() => setCategoryToDelete(null)}
                    onConfirm={async () => {
                        await deleteCategory(categoryToDelete.id);
                        setCategoryToDelete(null);
                    }}
                    itemName={`a categoria "${categoryToDelete.name}"`}
                />
            )}
        </>
    );
}
