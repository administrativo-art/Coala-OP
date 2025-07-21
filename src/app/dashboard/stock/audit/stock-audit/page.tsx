
"use client";

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { StockAuditManagement } from '@/components/stock-audit-management';
import { ArrowLeft } from 'lucide-react';

export default function StockAuditPage() {
    return (
        <div>
            <Link href="/dashboard/stock/audit" className="inline-block mb-4">
                <Button variant="outline">
                    <ArrowLeft className="mr-2" />
                    Voltar para Auditoria
                </Button>
            </Link>
            <StockAuditManagement showExportButton={true} />
        </div>
    );
}
