
"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useBaseProducts } from '@/hooks/use-base-products';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Trash2 } from 'lucide-react';
import { type BaseProduct } from '@/types';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';

const classificationSchema = z.object({
  newClassification: z.string().min(1, 'O nome da classificação não pode ser vazio.'),
});
type ClassificationFormValues = z.infer<typeof classificationSchema>;

interface ClassificationManagementModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ClassificationManagementModal({ open, onOpenChange }: ClassificationManagementModalProps) {
    const { baseProducts, updateMultipleBaseProducts } = useBaseProducts();
    const [classificationToDelete, setClassificationToDelete] = useState<string | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    const form = useForm<ClassificationFormValues>({
        resolver: zodResolver(classificationSchema),
        defaultValues: { newClassification: '' },
    });

    const classificationOptions = useMemo(() => {
        const classifications = new Set(baseProducts.map(p => p.classification).filter(Boolean));
        return Array.from(classifications).sort();
    }, [baseProducts]);

    const handleAddClassification = (values: ClassificationFormValues) => {
        if (!classificationOptions.includes(values.newClassification)) {
            // This doesn't actually "add" it to a list, it's just conceptual.
            // The classification is saved when a product uses it.
            // We can just clear the form for good UX.
            form.reset();
        }
    };

    const handleDeleteClick = (classification: string) => {
        setClassificationToDelete(classification);
    };

    const handleDeleteConfirm = async () => {
        if (!classificationToDelete) return;

        setIsDeleting(true);
        const productsToUpdate = baseProducts.filter(p => p.classification === classificationToDelete);
        const updatedProducts = productsToUpdate.map(p => ({
            ...p,
            classification: '',
        }));

        await updateMultipleBaseProducts(updatedProducts);
        
        setIsDeleting(false);
        setClassificationToDelete(null);
    };

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Gerenciar Classificações</DialogTitle>
                        <DialogDescription>
                            Adicione, renomeie ou exclua classificações de produtos base.
                        </DialogDescription>
                    </DialogHeader>
                     <ScrollArea className="h-72">
                        <div className="space-y-2 pr-4">
                            {classificationOptions.map(classification => (
                                <div key={classification} className="flex items-center justify-between rounded-md border p-3">
                                    <span className="font-medium">{classification}</span>
                                    <Button
                                        variant="ghost" size="icon"
                                        className="text-destructive hover:text-destructive h-8 w-8"
                                        onClick={() => handleDeleteClick(classification)}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </ScrollArea>
                    <DialogFooter>
                         <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            
            {classificationToDelete && (
                 <DeleteConfirmationDialog
                    open={!!classificationToDelete}
                    isDeleting={isDeleting}
                    onOpenChange={() => setClassificationToDelete(null)}
                    onConfirm={handleDeleteConfirm}
                    title="Excluir Classificação?"
                    description={`Isso removerá a classificação "${classificationToDelete}" de todos os produtos base associados. Esta ação não pode ser desfeita.`}
                    confirmButtonText="Sim, excluir"
                />
            )}
        </>
    );
}
