"use client";

import { useState } from 'react';
import { PageHero } from '@/components/patterns/page-hero';
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
                <PageHero
                    kicker="Gestão de estoque"
                    title="Gestão de Avarias"
                    subtitle="Chamados de produtos avariados ou com problema."
                    actions={permissions.stock.returns.add ? (
                        <Button type="button" variant="primary-page" size="md" onClick={() => setIsAddModalOpen(true)}>
                            <PlusCircle className="mr-2 h-4 w-4" /> Abrir chamado
                        </Button>
                    ) : null}
                />
                <ReturnRequestManagement />
                <AddReturnRequestModal open={isAddModalOpen} onOpenChange={setIsAddModalOpen} />
            </div>
        </PermissionGuard>
    );
}
