"use client";

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ItemManagement } from '@/components/item-management';
import { ArrowLeft, Package, Box } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BaseProductManagement } from '@/components/base-product-management';
import { useAuth } from "@/hooks/use-auth";
import { PermissionGuard } from "@/components/permission-guard";

export default function RegistrationItemsPage() {
    const router = useRouter();
    const { permissions } = useAuth();

    return (
        <PermissionGuard allowed={permissions.registration.view}>
            <div className="space-y-4">
                <div className="flex items-center gap-4 mb-2">
                    <Button 
                        onClick={() => router.push('/dashboard/registration')}
                        variant="ghost"
                        className="p-2 rounded-full h-auto w-auto text-muted-foreground transition-colors hover:bg-muted"
                        aria-label="Voltar para cadastros"
                    >
                        <ArrowLeft className="w-6 h-6" />
                    </Button>
                    <div>
                        <h1 className="text-3xl font-bold">Gerenciar insumos</h1>
                        <p className="text-sm text-muted-foreground">Voltar para cadastros</p>
                    </div>
                </div>

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
        </PermissionGuard>
    );
}