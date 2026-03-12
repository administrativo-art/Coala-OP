"use client";

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { StockValuation } from '@/components/stock-valuation';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from "@/hooks/use-auth";
import { PermissionGuard } from "@/components/permission-guard";

export default function StockValuationPage() {
    const router = useRouter();
    const { permissions } = useAuth();

    return (
        <PermissionGuard allowed={permissions.stock.analysis.valuation}>
            <div className="space-y-4">
                <div className="mb-4">
                    <Button 
                        onClick={() => router.push('/dashboard/stock')}
                        variant="outline"
                    >
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Voltar para gestão de estoque
                    </Button>
                </div>
                <div className="space-y-1 mb-6">
                    <h1 className="text-3xl font-bold">Avaliação Financeira</h1>
                    <p className="text-sm text-muted-foreground">Calcule o valor financeiro do seu estoque.</p>
                </div>
                <StockValuation />
            </div>
        </PermissionGuard>
    );
}