
"use client";

import React, { useState, useMemo } from 'react';
import { useClassifications } from '@/hooks/use-classifications';
import { useBaseProducts } from '@/hooks/use-base-products';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Trash2, Edit, Save, Loader2, Info } from 'lucide-react';
import { type Classification } from '@/types';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { Input } from './ui/input';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';

interface ClassificationManagementModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function normalizeName(s: string): string {
  if (!s) return "";
  return s.trim().replace(/\s+/g, " ");
}

export function ClassificationManagementModal({ open, onOpenChange }: ClassificationManagementModalProps) {
    const { classifications, loading, addClassification, renameClassification, deleteClassification } = useClassifications();
    const { baseProducts, updateMultipleBaseProducts } = useBaseProducts();
    const { toast } = useToast();

    const [editingClassificationId, setEditingClassificationId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    const [newClassificationName, setNewClassificationName] = useState('');
    const [itemToDelete, setItemToDelete] = useState<Classification | null>(null);
    
    const [isLoading, setIsLoading] = useState(false);

    const getProductsByClassification = (classificationName: string) => {
        const key = normalizeName(classificationName);
        return baseProducts.filter(p => normalizeName(p.classification || "") === key);
    };

    const handleAdd = async () => {
        const cleanName = normalizeName(newClassificationName);
        if (!cleanName) return;
        setIsLoading(true);
        try {
            await addClassification(cleanName);
            toast({ title: "Sucesso!", description: `Classificação "${cleanName}" criada.` });
            setNewClassificationName('');
        } catch (error: any) {
            toast({ variant: 'destructive', title: "Erro ao adicionar", description: error.message });
        } finally {
            setIsLoading(false);
        }
    };

    const handleStartEdit = (classification: Classification) => {
        setEditingClassificationId(classification.id);
        setEditValue(classification.name);
    };

    const handleSaveEdit = async () => {
        if (!editingClassificationId || !normalizeName(editValue)) return;
        
        const originalClassification = classifications.find(c => c.id === editingClassificationId);
        if (!originalClassification) return;

        setIsLoading(true);
        try {
            await renameClassification(editingClassificationId, editValue);
            
            const productsToUpdate = getProductsByClassification(originalClassification.name).map(p => ({
                ...p,
                classification: normalizeName(editValue)
            }));
            
            if (productsToUpdate.length > 0) {
                await updateMultipleBaseProducts(productsToUpdate);
            }

            toast({ title: "Sucesso!", description: "Classificação renomeada." });
            setEditingClassificationId(null);
            setEditValue('');
        } catch (error: any) {
            toast({ variant: 'destructive', title: "Erro ao renomear", description: error.message });
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleDelete = (item: Classification) => {
        setItemToDelete(item);
    };

    const handleDeleteConfirm = async () => {
        if (!itemToDelete) return;
        
        setIsLoading(true);
        try {
            const productsToClear = getProductsByClassification(itemToDelete.name).map(p => ({
                ...p,
                classification: ''
            }));
            
            if (productsToClear.length > 0) {
                await updateMultipleBaseProducts(productsToClear);
            }

            await deleteClassification(itemToDelete.id);
            toast({ title: "Sucesso!", description: `Classificação "${itemToDelete.name}" excluída.` });
        } catch (error: any) {
             toast({ variant: 'destructive', title: "Erro ao excluir", description: error.message });
        } finally {
            setIsLoading(false);
            setItemToDelete(null);
        }
    }
    
    const usageCount = useMemo(() => {
        const counts = new Map<string, number>();
        baseProducts.forEach(p => {
            const key = normalizeName(p.classification || "");
            if (key) {
                counts.set(key, (counts.get(key) || 0) + 1);
            }
        });
        return counts;
    }, [baseProducts]);

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Gerenciar Classificações</DialogTitle>
                        <DialogDescription>
                            Adicione, edite ou exclua as classificações dos produtos base.
                        </DialogDescription>
                    </DialogHeader>
                     <div className="py-4 space-y-4">
                        <div className="p-4 border rounded-lg space-y-2">
                           <h3 className="font-semibold text-md">Adicionar nova classificação</h3>
                            <div className="flex gap-2">
                                <Input
                                    placeholder="Nome da nova classificação"
                                    value={newClassificationName}
                                    onChange={(e) => setNewClassificationName(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                                    disabled={isLoading}
                                />
                                <Button onClick={handleAdd} disabled={isLoading || !newClassificationName.trim()}>
                                    {isLoading ? <Loader2 className="animate-spin" /> : "Adicionar"}
                                </Button>
                            </div>
                        </div>

                        <ScrollArea className="h-72">
                            <div className="space-y-2 pr-4">
                                {loading ? <Loader2 className="mx-auto my-10 animate-spin"/> :
                                classifications.map(classification => {
                                    const count = usageCount.get(normalizeName(classification.name)) || 0;
                                    return (
                                        <div key={classification.id} className="flex items-center justify-between rounded-md border p-3">
                                            {editingClassificationId === classification.id ? (
                                                <Input
                                                    value={editValue}
                                                    onChange={(e) => setEditValue(e.target.value)}
                                                    className="h-8"
                                                    disabled={isLoading}
                                                    onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit()}
                                                />
                                            ) : (
                                                <div>
                                                    <span className="font-medium">{classification.name}</span>
                                                    <p className="text-xs text-muted-foreground">{count} produto(s) vinculado(s)</p>
                                                </div>
                                            )}
                                            <div className="flex items-center gap-1">
                                                {editingClassificationId === classification.id ? (
                                                     <Button variant="secondary" size="sm" onClick={handleSaveEdit} disabled={isLoading}>
                                                        {isLoading ? <Loader2 className="h-4 w-4 animate-spin"/> : <Save className="h-4 w-4" />}
                                                     </Button>
                                                ) : (
                                                     <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleStartEdit(classification)} disabled={isLoading}>
                                                        <Edit className="h-4 w-4" />
                                                     </Button>
                                                )}
                                               
                                                <Button
                                                    variant="ghost" size="icon"
                                                    className="text-destructive hover:text-destructive h-8 w-8"
                                                    onClick={() => handleDelete(classification)}
                                                    disabled={isLoading}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </ScrollArea>
                     </div>
                    <DialogFooter>
                         <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            
            {itemToDelete && (
                 <DeleteConfirmationDialog
                    open={!!itemToDelete}
                    isDeleting={isLoading}
                    onOpenChange={() => setItemToDelete(null)}
                    onConfirm={handleDeleteConfirm}
                    title="Excluir Classificação?"
                    description={
                        <div>
                            <p>Você tem certeza que quer excluir a classificação <strong>"{itemToDelete.name}"</strong>?</p>
                            <p className="mt-2 text-sm text-muted-foreground">Esta ação irá remover a classificação de <strong>{usageCount.get(normalizeName(itemToDelete.name)) || 0}</strong> produto(s) base.</p>
                            <Alert variant="destructive" className="mt-4">
                                <AlertTriangle className="h-4 w-4" />
                                <AlertTitle>Ação Irreversível</AlertTitle>
                                <AlertDescription>
                                Esta ação não pode ser desfeita.
                                </AlertDescription>
                            </Alert>
                        </div>
                    }
                    confirmButtonText="Sim, excluir"
                />
            )}
        </>
    );
}

    