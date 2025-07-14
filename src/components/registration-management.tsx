
"use client";

import { useState } from 'react';
import { ItemManagement } from './item-management';
import { BaseProductManagement } from './base-product-management';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useBaseProducts } from '@/hooks/use-base-products';

export function RegistrationManagement() {
    const { addBaseProduct } = useBaseProducts();
    const [newBaseProductName, setNewBaseProductName] = useState('');

    const handleAddBaseProduct = () => {
        if (newBaseProductName.trim()) {
            addBaseProduct({ 
                name: newBaseProductName.trim(),
                unit: 'g', // Default unit
                stockLevels: {}
            });
            setNewBaseProductName('');
        }
    };

    return (
        <div className="w-full space-y-6">
            <div className="mb-6">
                <h1 className="text-3xl font-bold">Cadastros</h1>
                <p className="text-muted-foreground">Adicione, edite ou exclua os insumos (itens físicos) do seu estoque e os produtos base para agrupamento.</p>
            </div>
            
             <Tabs defaultValue="items" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="items">Gerenciar insumos</TabsTrigger>
                    <TabsTrigger value="baseProducts">Gerenciar produto base</TabsTrigger>
                </TabsList>
                <TabsContent value="items" className="mt-4">
                    <ItemManagement />
                </TabsContent>
                <TabsContent value="baseProducts" className="mt-4">
                    <BaseProductManagement 
                        newBaseProductName={newBaseProductName}
                        setNewBaseProductName={setNewBaseProductName}
                        onAddBaseProduct={handleAddBaseProduct}
                    />
                </TabsContent>
            </Tabs>
        </div>
    )
}
