
"use client";

import { useState } from 'react';
import { ItemManagement } from './item-management';
import { BaseProductManagement } from './base-product-management';
import { EntityManagement } from './entity-management';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useBaseProducts } from '@/hooks/use-base-products';

export function RegistrationManagement() {

    return (
        <div className="w-full space-y-6">
            <div className="mb-6">
                <h1 className="text-3xl font-bold">Cadastros</h1>
                <p className="text-muted-foreground">Adicione, edite ou exclua os insumos, produtos base e outras entidades do sistema.</p>
            </div>
            
             <Tabs defaultValue="items" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="items">Gerenciar insumos</TabsTrigger>
                    <TabsTrigger value="baseProducts">Gerenciar produto base</TabsTrigger>
                    <TabsTrigger value="entities">Pessoas e Empresas</TabsTrigger>
                </TabsList>
                <TabsContent value="items" className="mt-4">
                    <ItemManagement />
                </TabsContent>
                <TabsContent value="baseProducts" className="mt-4">
                    <BaseProductManagement />
                </TabsContent>
                 <TabsContent value="entities" className="mt-4">
                    <EntityManagement />
                </TabsContent>
            </Tabs>
        </div>
    )
}
