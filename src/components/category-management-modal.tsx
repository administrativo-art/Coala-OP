
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
import { PlusCircle, Edit, Trash2 } from 'lucide-react';
import { type SimulationCategory } from '@/types';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { ScrollArea } from './ui/scroll-area';
import { cn } from '@/lib/utils';
import { useProductSimulation } from '@/hooks/use-product-simulation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';


const categorySchema = z.object({
  name: z.string().min(1, 'O nome é obrigatório.'),
  color: z.string(),
});
type CategoryFormValues = z.infer<typeof categorySchema>;

const groupSchema = z.object({
  name: z.string().min(1, 'O nome é obrigatório.'),
});
type GroupFormValues = z.infer<typeof groupSchema>;


const lineSchema = z.object({
  name: z.string().min(1, 'O nome é obrigatório.'),
});
type LineFormValues = z.infer<typeof lineSchema>;

const defaultColors = ['#F87171', '#FBBF24', '#34D399', '#60A5FA', '#A78BFA', '#F472B6', '#FCA5A5', '#818CF8'];

export function CategoryManagementModal({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) {
    const { categories, addCategory, updateCategory, deleteCategory } = useProductSimulationCategories();
    const { simulations } = useProductSimulation();
    
    const [editingCategory, setEditingCategory] = useState<SimulationCategory | null>(null);
    const [editingLine, setEditingLine] = useState<SimulationCategory | null>(null);
    const [editingGroup, setEditingGroup] = useState<SimulationCategory | null>(null);
    const [categoryToDelete, setCategoryToDelete] = useState<SimulationCategory | null>(null);

    const categoryForm = useForm<CategoryFormValues>({
        resolver: zodResolver(categorySchema),
        defaultValues: { name: '', color: '#F87171' },
    });
    
    const lineForm = useForm<LineFormValues>({
        resolver: zodResolver(lineSchema),
        defaultValues: { name: '' },
    });
    
    const groupForm = useForm<GroupFormValues>({
        resolver: zodResolver(groupSchema),
        defaultValues: { name: '' },
    });

    useEffect(() => {
        if(editingCategory) {
            categoryForm.reset({ name: editingCategory.name, color: editingCategory.color || '#F87171' });
        } else {
            categoryForm.reset({ name: '', color: '#F87171' });
        }
    }, [editingCategory, categoryForm]);
    
     useEffect(() => {
        if(editingLine) {
            lineForm.reset({ name: editingLine.name });
        } else {
            lineForm.reset({ name: '' });
        }
    }, [editingLine, lineForm]);

    useEffect(() => {
        if(editingGroup) {
            groupForm.reset({ name: editingGroup.name });
        } else {
            groupForm.reset({ name: '' });
        }
    }, [editingGroup, groupForm]);

    const handleDeleteClick = (category: SimulationCategory) => {
        const isUsed = simulations.some(s => s.categoryIds.includes(category.id) || s.lineId === category.id || s.groupId === category.id);
        if (isUsed) {
            alert(`Não é possível excluir "${category.name}". Ela está sendo usada por uma ou mais mercadorias.`);
            return;
        }
        setCategoryToDelete(category);
    };

    const onCategorySubmit = async (values: CategoryFormValues) => {
        if (editingCategory) {
            await updateCategory({ ...editingCategory, ...values });
        } else {
            await addCategory({ ...values, type: 'category' });
        }
        setEditingCategory(null);
        categoryForm.reset({ name: '', color: '#F87171' });
    };
    
    const onLineSubmit = async (values: LineFormValues) => {
        if (editingLine) {
            await updateCategory({ ...editingLine, name: values.name });
        } else {
            await addCategory({ name: values.name, color: '', type: 'line' });
        }
        setEditingLine(null);
        lineForm.reset({ name: '' });
    };

    const onGroupSubmit = async (values: GroupFormValues) => {
        if (editingGroup) {
            await updateCategory({ ...editingGroup, name: values.name });
        } else {
            await addCategory({ name: values.name, type: 'group' });
        }
        setEditingGroup(null);
        groupForm.reset({ name: '' });
    };

    const mainCategories = useMemo(() => categories.filter(c => c.type === 'category'), [categories]);
    const lines = useMemo(() => categories.filter(c => c.type === 'line'), [categories]);
    const groups = useMemo(() => categories.filter(c => c.type === 'group'), [categories]);

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="max-w-4xl">
                    <DialogHeader>
                        <DialogTitle>Gerenciar Categorias, Linhas e Grupos</DialogTitle>
                        <DialogDescription>Crie, edite e organize os agrupadores para suas mercadorias.</DialogDescription>
                    </DialogHeader>
                    <Tabs defaultValue="categories" className="py-4">
                        <TabsList className="grid w-full grid-cols-3">
                            <TabsTrigger value="categories">Categorias</TabsTrigger>
                            <TabsTrigger value="lines">Linhas</TabsTrigger>
                            <TabsTrigger value="groups">Grupos por Insumo</TabsTrigger>
                        </TabsList>
                        <TabsContent value="categories" className="mt-4">
                            <div className="p-4 border rounded-lg">
                                <Form {...categoryForm}>
                                    <form onSubmit={categoryForm.handleSubmit(onCategorySubmit)} className="space-y-4 mb-4">
                                        <FormField control={categoryForm.control} name="name" render={({ field }) => (
                                            <FormItem><FormLabel>Nome da Categoria</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                                        )}/>
                                        <FormField control={categoryForm.control} name="color" render={({ field }) => (
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
                                        <div className="flex justify-end gap-2">
                                            {editingCategory && <Button type="button" variant="outline" onClick={() => setEditingCategory(null)}>Cancelar</Button>}
                                            <Button type="submit"><PlusCircle className="mr-2 h-4 w-4" />{editingCategory ? "Salvar" : "Adicionar"}</Button>
                                        </div>
                                    </form>
                                </Form>
                                <ScrollArea className="h-40 mt-4">
                                    <div className="space-y-2 pr-4">
                                        {mainCategories.map(item => (
                                            <div key={item.id} className="flex items-center justify-between rounded-md border p-2">
                                                <div className="flex items-center gap-2">
                                                    <div className="h-4 w-4 rounded-full" style={{backgroundColor: item.color}}></div>
                                                    <span className="font-medium">{item.name}</span>
                                                </div>
                                                <div className="flex gap-1">
                                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingCategory(item)}><Edit className="h-4 w-4"/></Button>
                                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDeleteClick(item)}><Trash2 className="h-4 w-4"/></Button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </ScrollArea>
                            </div>
                        </TabsContent>
                        <TabsContent value="lines" className="mt-4">
                             <div className="p-4 border rounded-lg">
                                <Form {...lineForm}>
                                    <form onSubmit={lineForm.handleSubmit(onLineSubmit)} className="space-y-4 mb-4">
                                        <FormField control={lineForm.control} name="name" render={({ field }) => (
                                            <FormItem><FormLabel>Nome da Linha</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                                        )}/>
                                        <div className="flex justify-end gap-2">
                                            {editingLine && <Button type="button" variant="outline" onClick={() => setEditingLine(null)}>Cancelar</Button>}
                                            <Button type="submit"><PlusCircle className="mr-2 h-4 w-4" />{editingLine ? "Salvar" : "Adicionar"}</Button>
                                        </div>
                                    </form>
                                </Form>
                                <ScrollArea className="h-40 mt-4">
                                    <div className="space-y-2 pr-4">
                                        {lines.map(item => (
                                            <div key={item.id} className="flex items-center justify-between rounded-md border p-2">
                                                <span className="font-medium">{item.name}</span>
                                                <div className="flex gap-1">
                                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingLine(item)}><Edit className="h-4 w-4"/></Button>
                                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDeleteClick(item)}><Trash2 className="h-4 w-4"/></Button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </ScrollArea>
                            </div>
                        </TabsContent>
                        <TabsContent value="groups" className="mt-4">
                             <div className="p-4 border rounded-lg">
                                <Form {...groupForm}>
                                    <form onSubmit={groupForm.handleSubmit(onGroupSubmit)} className="space-y-4 mb-4">
                                        <FormField control={groupForm.control} name="name" render={({ field }) => (
                                            <FormItem><FormLabel>Nome do Grupo</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                                        )}/>
                                        <div className="flex justify-end gap-2">
                                            {editingGroup && <Button type="button" variant="outline" onClick={() => setEditingGroup(null)}>Cancelar</Button>}
                                            <Button type="submit"><PlusCircle className="mr-2 h-4 w-4" />{editingGroup ? "Salvar" : "Adicionar"}</Button>
                                        </div>
                                    </form>
                                </Form>
                                <ScrollArea className="h-40 mt-4">
                                    <div className="space-y-2 pr-4">
                                        {groups.map(item => (
                                            <div key={item.id} className="flex items-center justify-between rounded-md border p-2">
                                                <span className="font-medium">{item.name}</span>
                                                <div className="flex gap-1">
                                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingGroup(item)}><Edit className="h-4 w-4"/></Button>
                                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDeleteClick(item)}><Trash2 className="h-4 w-4"/></Button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </ScrollArea>
                            </div>
                        </TabsContent>
                    </Tabs>
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
                    itemName={`o item "${categoryToDelete.name}"`}
                />
            )}
        </>
    );
}

    