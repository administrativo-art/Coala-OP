
"use client";

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useProducts } from '@/hooks/use-products';
import { PlusCircle } from 'lucide-react';

import { StockAnalysisConfigurator } from './stock-analysis-configurator';
import { ItemManagement } from './item-management';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export function RegistrationManagement() {
    const { baseProducts, addBaseProduct, deleteBaseProduct, loading } = useBaseProducts();
    const { products } = useProducts();
    const [newCategoryName, setNewCategoryName] = useState('');
    
    const handleAddCategory = () => {
        if (newCategoryName.trim() !== '') {
            addBaseProduct({ name: newCategoryName });
            setNewCategoryName('');
        }
    };
    
    const handleDeleteCategory = (categoryId: string) => {
        const isUsed = products.some(p => p.baseProductId === categoryId);
        if (isUsed) {
            alert('Esta categoria não pode ser excluída pois está sendo utilizada por um ou mais insumos.');
            return;
        }
        deleteBaseProduct(categoryId);
    };

    return (
        <div className="w-full space-y-6">
            <div className="mb-6">
                <h1 className="text-3xl font-bold">Cadastros</h1>
                <p className="text-muted-foreground">Gerencie o cadastro dos insumos do estoque.</p>
            </div>
            
            <Tabs defaultValue="items" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="items">Cadastro de insumos</TabsTrigger>
                    <TabsTrigger value="categories">Gerenciar produto base</TabsTrigger>
                </TabsList>
                <TabsContent value="items" className="mt-4">
                     <ItemManagement />
                </TabsContent>
                <TabsContent value="categories" className="mt-4">
                    <StockAnalysisConfigurator 
                        baseProducts={baseProducts}
                        loading={loading}
                        newCategoryName={newCategoryName}
                        setNewCategoryName={setNewCategoryName}
                        onAddCategory={handleAddCategory}
                        onDeleteCategory={handleDeleteCategory}
                    />
                </TabsContent>
            </Tabs>
        </div>
    )
}
