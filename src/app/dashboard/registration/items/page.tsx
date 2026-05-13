"use client";

import { BackButton } from '@/components/navigation/back-button';
import { ItemManagement } from '@/components/item-management';
import { Package, Box } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BaseProductManagement } from '@/components/base-product-management';
import { useAuth } from "@/hooks/use-auth";
import { PermissionGuard } from "@/components/permission-guard";

export default function RegistrationItemsPage() {
    const { permissions } = useAuth();

    return (
        <PermissionGuard allowed={permissions.registration.view}>
            <div className="space-y-4">
                <div className="flex items-center gap-4 mb-2">
                    <BackButton
                        fallbackHref="/dashboard/settings?department=operacional&tab=cadastros"
                        variant="ghost"
                        iconOnly
                        className="h-auto w-auto rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted"
                        ariaLabel="Voltar para configurações"
                    />
                    <div>
                        <h1 className="text-3xl font-bold">Gerenciar insumos</h1>
                        <p className="text-sm text-muted-foreground">Voltar para configurações</p>
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
