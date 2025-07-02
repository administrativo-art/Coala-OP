
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
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Skeleton } from './ui/skeleton';

export function ItemManagement() {
    const { permissions, loading: authLoading } = useAuth();
    const { products, loading: productsLoading, getProductFullName, addProduct, updateProduct, deleteProduct } = useProducts();
    const { lots, loading: lotsLoading } = useExpiryProducts();
    const { lists, loading: listsLoading } = usePredefinedLists();
    const [isModalOpen, setIsModalOpen] = useState(false);
    
    const loading = authLoading || productsLoading || lotsLoading || listsLoading;

    if (loading) {
        return (
            <div className="space-y-6">
                <div className="flex justify-between items-center">
                    <div className="space-y-2">
                        <Skeleton className="h-8 w-64" />
                        <Skeleton className="h-4 w-96" />
                    </div>
                    <Skeleton className="h-10 w-40" />
                </div>
                <Skeleton className="h-96 w-full" />
            </div>
        );
    }

    const canManageProducts = permissions.products.add || permissions.products.edit || permissions.products.delete;
    
    if (!canManageProducts) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Acesso Negado</CardTitle>
                </CardHeader>
                <CardContent>
                    <p>Você não tem permissão para gerenciar itens.</p>
                </CardContent>
            </Card>
        );
    }

    return (
        <>
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-3xl font-bold">Gerenciar Itens</h1>
                    <p className="text-muted-foreground">Defina os itens e seus níveis de estoque mínimo e máximo para cada quiosque.</p>
                </div>
                {permissions.products.add && (
                    <Button onClick={() => setIsModalOpen(true)}>
                        <PlusCircle className="mr-2" /> Adicionar Novo Item
                    </Button>
                )}
            </div>

            <StockAnalysisConfigurator />

            <ProductManagementModal
                open={isModalOpen}
                onOpenChange={setIsModalOpen}
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
