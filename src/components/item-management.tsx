
"use client"

import { useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useProducts } from '@/hooks/use-products';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { usePredefinedLists } from '@/hooks/use-predefined-lists';
import { Button } from '@/components/ui/button';
import { PlusCircle } from 'lucide-react';
import { StockAnalysisConfigurator } from './stock-analysis-configurator';
import { ProductManagementModal } from './product-management-modal';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from './ui/skeleton';

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
    
    const loading = authLoading || productsLoading || lotsLoading || listsLoading;

    const handleOpenChangeAndReset = (isOpen: boolean) => {
        if (!isOpen) {
            setIsProductModalOpen(false);
        }
        onOpenChange(isOpen);
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
                             <div className="px-1 pb-4">
                                <div className="flex justify-end">
                                    {permissions.products.add && (
                                        <Button onClick={() => setIsProductModalOpen(true)}>
                                            <PlusCircle className="mr-2" /> Adicionar Novo Item
                                        </Button>
                                    )}
                                </div>
                            </div>
                            <ScrollArea className="flex-1 pr-1">
                                <StockAnalysisConfigurator />
                            </ScrollArea>
                        </div>
                    )}
                    
                    <DialogFooter className="pt-4 border-t">
                        <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* This nested modal is rendered separately to avoid z-index issues */}
            <ProductManagementModal
                open={isProductModalOpen}
                onOpenChange={setIsProductModalOpen}
                products={products}
                addProduct={addProduct}
                updateProduct={updateProduct}
                deleteProduct={deleteProduct}
                getProductFullName={getProductFullName}
                permissions={permissions.products}
                lots={lots}
                lists={lists}
            />
        </>
    );
}
