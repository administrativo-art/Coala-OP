"use client";

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ExpiryControl } from '@/components/expiry-control';
import { ArrowLeft } from 'lucide-react';

export default function InventoryControlPage() {
    return (
        <div>
            <Link href="/dashboard/stock" className="inline-block mb-4">
                <Button variant="outline">
                    <ArrowLeft className="mr-2" />
                    Voltar para Gestão de Estoque
                </Button>
            </Link>
            <ExpiryControl />
        </div>
    );
}
