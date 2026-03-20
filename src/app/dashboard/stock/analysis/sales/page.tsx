"use client";

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { SalesAnalysisDashboard } from '@/components/sales-analysis-dashboard';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from "@/hooks/use-auth";
import { PermissionGuard } from "@/components/permission-guard";

export default function SalesAnalysisPage() {
    const router = useRouter();
    const { permissions } = useAuth();

    return (
        <PermissionGuard allowed={permissions.stock.analysis.consumption}>
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
                    <h1 className="text-3xl font-bold">Análise de vendas</h1>
                    <p className="text-sm text-muted-foreground">Visualize o ranking e a evolução das vendas de produtos baseadas nos relatórios importados.</p>
                </div>
                <SalesAnalysisDashboard />
            </div>
        </PermissionGuard>
    );
}
