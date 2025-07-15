
"use client";

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ItemAdditionRequestManagement } from '@/components/item-addition-request-management';
import { ArrowLeft } from 'lucide-react';

export default function ItemRequestsPage() {
    return (
        <div>
            <Link href="/dashboard/stock" className="inline-block mb-4">
                <Button variant="outline">
                    <ArrowLeft className="mr-2" />
                    Voltar para Gestão de Estoque
                </Button>
            </Link>
            <ItemAdditionRequestManagement />
        </div>
    );
}
