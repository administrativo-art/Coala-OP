
"use client";

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ReturnRequestManagement } from '@/components/return-request-management';
import { AddReturnRequestModal } from '@/components/add-return-request-modal';
import { useAuth } from '@/hooks/use-auth';
import { ArrowLeft, PlusCircle } from 'lucide-react';

export default function ReturnsPage() {
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const { permissions } = useAuth();

    return (
        <div>
            <div className="flex justify-between items-center mb-4">
                <Link href="/dashboard/stock">
                    <Button variant="outline">
                        <ArrowLeft className="mr-2" />
                        Voltar para Gestão de Estoque
                    </Button>
                </Link>
                {permissions.returns.add && (
                    <Button onClick={() => setIsAddModalOpen(true)}>
                        <PlusCircle className="mr-2" /> Abrir Chamado
                    </Button>
                )}
            </div>
            <ReturnRequestManagement />
            <AddReturnRequestModal open={isAddModalOpen} onOpenChange={setIsAddModalOpen} />
        </div>
    );
}
