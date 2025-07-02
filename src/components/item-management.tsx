
"use client"

import { useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useProducts } from '@/hooks/use-products';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { usePredefinedLists } from '@/hooks/use-predefined-lists';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from './ui/skeleton';
import { StockAnalysisConfigurator } from './stock-analysis-configurator';
import { ProductManagementModal } from './product-management-modal';
import { type Product, type LotEntry, type PredefinedList } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';


interface ItemManagementProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ItemManagement({ open, onOpenChange }: ItemManagementProps) {
    const { permissions, loading: authLoading } = useAuth();
    const { products, loading: productsLoading, getProductFullName, addProduct, updateProduct, deleteProduct } = useProducts();
    const { lots, loading: lotsLoading } = useExpiryProducts();
    const { lists, loading: listsLoading } = usePredefinedLists();
    const [isProductModalOpen, setIsProductModalOpen] = useState(false);
    const [productToEdit, setProductToEdit] = useState<Product | null>(null);
    const [productToDelete, setProductToDelete] = useState<Product | null>(null);
    const { toast } = useToast();
    
    const loading = authLoading || productsLoading || lotsLoading || listsLoading;

    const handleOpenChangeAndReset = (isOpen: boolean) => {
        if (!isOpen) {
            setIsProductModalOpen(false);
            setProductToEdit(null);
            setProductToDelete(null);
        }
        onOpenChange(isOpen);
    };

    const handleAddNew = () => {
        setProductToEdit(null);
        setIsProductModalOpen(true);
    };

    const handleEdit = (product: Product) => {
        setProductToEdit(product);
        setIsProductModalOpen(true);
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
            await deleteProduct(productToDelete.id);
            setProductToDelete(null);
        }
    };


    if (!open) return null;

    return (
        <>
            <Dialog open={open} onOpenChange={handleOpenChangeAndReset}>
                <DialogContent className="max-w-5xl h-[90vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle>Gerenciar itens</DialogTitle>
                        <DialogDescription>
                            Defina os itens e seus níveis de estoque mínimo e máximo para cada quiosque. Estes dados são usados pela IA para analisar os relatórios.
                        </DialogDescription>
                    </DialogHeader>

                    {loading ? (
                         <div className="space-y-4 p-4 flex-1">
                            <Skeleton className="h-10 w-48 ml-auto" />
                            <Skeleton className="h-64 w-full" />
                        </div>
                    ) : (
                        <div className="flex-1 flex flex-col min-h-0">
                            <ScrollArea className="flex-1 pr-1">
                                <StockAnalysisConfigurator 
                                    onAddNew={permissions.products.add ? handleAddNew : undefined}
                                    onEdit={permissions.products.edit ? handleEdit : undefined}
                                    onDelete={permissions.products.delete ? handleDeleteClick : undefined}
                                />
                            </ScrollArea>
                        </div>
                    )}
                    
                    <DialogFooter className="pt-4 border-t">
                        <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <ProductManagementModal
                open={isProductModalOpen}
                onOpenChange={setIsProductModalOpen}
                addProduct={addProduct}
                updateProduct={updateProduct}
                productToEdit={productToEdit}
            />

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
