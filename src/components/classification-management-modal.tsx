
"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { useBaseProducts } from '@/hooks/use-base-products';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Trash2, Edit, PlusCircle, Loader2 } from 'lucide-react';
import { type BaseProduct } from '@/types';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { Input } from './ui/input';

interface ClassificationManagementModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ClassificationManagementModal({ open, onOpenChange }: ClassificationManagementModalProps) {
    const { baseProducts, updateMultipleBaseProducts } = useBaseProducts();
    const [classificationToDelete, setClassificationToDelete] = useState<string | null>(null);
    const [editingClassification, setEditingClassification] = useState<{ oldName: string; newName: string } | null>(null);
    const [newClassificationName, setNewClassificationName] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const classificationOptions = useMemo(() => {
        const classifications = new Set(baseProducts.map(p => p.classification).filter(Boolean));
        return Array.from(classifications).sort();
    }, [baseProducts]);
    
    useEffect(() => {
        if (!open) {
            setEditingClassification(null);
            setNewClassificationName('');
        }
    }, [open]);

    const handleUpdate = async () => {
        if (!editingClassification || !editingClassification.newName.trim()) return;
        setIsLoading(true);

        const productsToUpdate = baseProducts.filter(p => p.classification === editingClassification.oldName);
        const updatedProducts = productsToUpdate.map(p => ({
            ...p,
            classification: editingClassification.newName.trim(),
        }));

        await updateMultipleBaseProducts(updatedProducts);
        setIsLoading(false);
        setEditingClassification(null);
    };

    const handleDeleteClick = (classification: string) => {
        setClassificationToDelete(classification);
    };

    const handleDeleteConfirm = async () => {
        if (!classificationToDelete) return;

        setIsLoading(true);
        const productsToUpdate = baseProducts.filter(p => p.classification === classificationToDelete);
        const updatedProducts = productsToUpdate.map(p => ({
            ...p,
            classification: '',
        }));

        await updateMultipleBaseProducts(updatedProducts);
        
        setIsLoading(false);
        setClassificationToDelete(null);
    };

    const handleAddClick = async () => {
        if (!newClassificationName.trim() || classificationOptions.includes(newClassificationName.trim())) {
             alert("Esta classificação já existe ou o nome é inválido.");
            return;
        }
        // This is a conceptual add. Since classifications only exist on products,
        // we can't truly "add" one here. We'll add it to the list visually
        // and it will be saved if/when a user assigns it to a product.
        // For a better UX, we'll just inform the user how to use it.
        alert(`Para usar a nova classificação "${newClassificationName.trim()}", digite-a no campo de classificação ao editar ou criar um produto base.`);
        setNewClassificationName('');
    }

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Gerenciar Classificações</DialogTitle>
                        <DialogDescription>
                            Adicione, edite e exclua as classificações dos produtos base.
                        </DialogDescription>
                    </DialogHeader>
                     <div className="py-4 space-y-4">
                        <div className="p-4 border rounded-lg">
                           <h3 className="font-semibold text-md mb-2">Adicionar nova classificação</h3>
                            <div className="flex gap-2">
                                <Input
                                placeholder="Nome da nova classificação"
                                value={newClassificationName}
                                onChange={(e) => setNewClassificationName(e.target.value)}
                                disabled={isLoading}
                                />
                                <Button onClick={handleAddClick} disabled={isLoading || !newClassificationName.trim()}>
                                    <PlusCircle className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>

                        <ScrollArea className="h-72">
                            <div className="space-y-2 pr-4">
                                {classificationOptions.map(classification => (
                                    <div key={classification} className="flex items-center justify-between rounded-md border p-3">
                                        {editingClassification?.oldName === classification ? (
                                            <Input
                                                value={editingClassification.newName}
                                                onChange={(e) => setEditingClassification({...editingClassification, newName: e.target.value})}
                                                className="h-8"
                                                disabled={isLoading}
                                            />
                                        ) : (
                                            <span className="font-medium">{classification}</span>
                                        )}
                                        <div className="flex items-center gap-1">
                                            {editingClassification?.oldName === classification ? (
                                                 <Button variant="secondary" size="sm" onClick={handleUpdate} disabled={isLoading}>
                                                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin"/> : "Salvar"}
                                                 </Button>
                                            ) : (
                                                 <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditingClassification({ oldName: classification, newName: classification })} disabled={isLoading}>
                                                    <Edit className="h-4 w-4" />
                                                 </Button>
                                            )}
                                           
                                            <Button
                                                variant="ghost" size="icon"
                                                className="text-destructive hover:text-destructive h-8 w-8"
                                                onClick={() => handleDeleteClick(classification)}
                                                disabled={isLoading}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </ScrollArea>
                     </div>
                    <DialogFooter>
                         <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            
            {classificationToDelete && (
                 <DeleteConfirmationDialog
                    open={!!classificationToDelete}
                    isDeleting={isLoading}
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
