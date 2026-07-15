
"use client";

import { ItemAdditionRequestManagement } from '@/components/item-addition-request-management';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { BackButton } from '@/components/navigation/back-button';

export default function ItemRequestsPage() {
    return (
        <div className="space-y-4">
            <BackButton fallbackHref="/dashboard/stock/count" label="Voltar para Contagem" />
            <ItemAdditionRequestManagement />
        </div>
    );
}
