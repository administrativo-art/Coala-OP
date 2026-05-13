"use client";

import { useState } from 'react';
import { BackButton } from '@/components/navigation/back-button';
import { Button } from '@/components/ui/button';
import { ReturnRequestManagement } from '@/components/return-request-management';
import { AddReturnRequestModal } from '@/components/add-return-request-modal';
import { useAuth } from '@/hooks/use-auth';
import { PlusCircle } from 'lucide-react';
import { PermissionGuard } from "@/components/permission-guard";

export default function ReturnsPage() {
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const { permissions } = useAuth();

    return (
        <PermissionGuard allowed={permissions.stock.returns.view}>
            <div className="space-y-4">
                <div className="flex items-center gap-4 mb-2">
                    <BackButton
                        fallbackHref="/dashboard/stock"
                        variant="ghost"
                        iconOnly
                        className="h-auto w-auto rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted"
                        ariaLabel="Voltar para gestão de estoque"
                    />
                    <div>
                        <h1 className="text-3xl font-bold">Gestão de Avarias</h1>
                        <p className="text-sm text-muted-foreground">Voltar para gestão de estoque</p>
                    </div>
                </div>
                {permissions.stock.returns.add && (
                    <div className="flex justify-end">
                        <Button onClick={() => setIsAddModalOpen(true)}>
                            <PlusCircle className="mr-2" /> Abrir chamado
                        </Button>
                    </div>
                )}
                <ReturnRequestManagement />
                <AddReturnRequestModal open={isAddModalOpen} onOpenChange={setIsAddModalOpen} />
            </div>
        </PermissionGuard>
    );
}
