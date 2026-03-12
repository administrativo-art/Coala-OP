"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ReturnRequestManagement } from '@/components/return-request-management';
import { AddReturnRequestModal } from '@/components/add-return-request-modal';
import { useAuth } from '@/hooks/use-auth';
import { ArrowLeft, PlusCircle } from 'lucide-react';
import { PermissionGuard } from "@/components/permission-guard";

export default function ReturnsPage() {
    const router = useRouter();
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const { permissions } = useAuth();

    return (
        <PermissionGuard allowed={permissions.stock.returns.view}>
            <div className="space-y-4">
                <div className="flex items-center gap-4 mb-2">
                    <Button 
                        onClick={() => router.push('/dashboard/stock')}
                        variant="ghost"
                        className="p-2 rounded-full h-auto w-auto text-muted-foreground transition-colors hover:bg-muted"
                        aria-label="Voltar para gestão de estoque"
                    >
                        <ArrowLeft className="w-6 h-6" />
                    </Button>
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