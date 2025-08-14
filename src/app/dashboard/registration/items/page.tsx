
"use client";

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ItemManagement } from '@/components/item-management';
import { ArrowLeft } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BaseProductManagement } from '@/components/base-product-management';
import { Package, Box } from 'lucide-react';

export default function RegistrationItemsPage() {
    return (
        <div className="space-y-4">
            <Link href="/dashboard/registration" className="inline-block mb-4">
                <Button variant="outline">
                    <ArrowLeft className="mr-2" />
                    Voltar para cadastros
                </Button>
            </Link>

            <Tabs defaultValue="items" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="items"><Package className="mr-2 h-4 w-4"/>Insumos</TabsTrigger>
                    <TabsTrigger value="base-products"><Box className="mr-2 h-4 w-4"/>Produtos Base</TabsTrigger>
                </TabsList>
                <TabsContent value="items" className="mt-4">
                    <ItemManagement />
                </TabsContent>
                <TabsContent value="base-products" className="mt-4">
                   <BaseProductManagement />
                </TabsContent>
            </Tabs>
        </div>
    );
}
