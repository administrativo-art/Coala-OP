
"use client";

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useProducts } from '@/hooks/use-products';
import { PlusCircle } from 'lucide-react';

import { ItemManagement } from './item-management';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export function RegistrationManagement() {
    return (
        <div className="w-full space-y-6">
            <div className="mb-6">
                <h1 className="text-3xl font-bold">Cadastros</h1>
                <p className="text-muted-foreground">Adicione, edite ou exclua os insumos (itens físicos) do seu estoque.</p>
            </div>
            
            <ItemManagement />
        </div>
    )
}
