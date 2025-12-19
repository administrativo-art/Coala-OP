
"use client";

import { ItemAdditionRequestManagement } from '@/components/item-addition-request-management';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

export default function ItemRequestsPage() {
    return (
        <div className="space-y-4">
            <Link href="/dashboard/stock/count" className="inline-block">
                <Button variant="outline">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar para Contagem
                </Button>
            </Link>
            <ItemAdditionRequestManagement />
        </div>
    );
}
