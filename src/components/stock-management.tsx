"use client"
import { useAuth } from "@/hooks/use-auth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StockAnalyzer } from "@/components/stock-importer"; 
import { ExpiryControl } from "@/components/expiry-control"; 
import { BarChart3, ClipboardCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function StockManagement() {
    const { permissions, loading } = useAuth();
    
    if (loading) {
        return (
             <Card>
                <CardHeader><CardTitle>Carregando...</CardTitle></CardHeader>
            </Card>
        )
    }
    
    const canManageLots = permissions.lots.add || permissions.lots.edit || permissions.lots.move || permissions.lots.delete || permissions.lots.viewMovementHistory;
    const canAnalyzeStock = permissions.stockAnalysis.upload || permissions.stockAnalysis.configure || permissions.stockAnalysis.viewHistory || permissions.consumptionAnalysis.upload || permissions.consumptionAnalysis.viewHistory;

    const defaultTab = canManageLots ? "lot-control" : "stock-analysis";

    if (!canManageLots && !canAnalyzeStock) {
        return (
            <Card>
                <CardHeader><CardTitle>Acesso Negado</CardTitle></CardHeader>
                <CardContent><p>Você não tem permissão para acessar este módulo.</p></CardContent>
            </Card>
        )
    }

    const gridColsClass = (canManageLots && canAnalyzeStock) ? "grid-cols-2" : "grid-cols-1";

    return (
        <div className="w-full">
            <div className="mb-6">
                <h1 className="text-3xl font-bold">Gestão de Estoque</h1>
                <p className="text-muted-foreground">Gerencie lotes, vencimentos, reposição e consumo do seu estoque em um só lugar.</p>
            </div>
            <Tabs defaultValue={defaultTab} className="w-full">
                <TabsList className={`grid w-full max-w-lg ${gridColsClass}`}>
                    {canManageLots && <TabsTrigger value="lot-control"><ClipboardCheck className="mr-2 h-4 w-4" />Controle de Lote</TabsTrigger>}
                    {canAnalyzeStock && <TabsTrigger value="stock-analysis"><BarChart3 className="mr-2 h-4 w-4" />Análise de Reposição</TabsTrigger>}
                </TabsList>

                {canManageLots && <TabsContent value="lot-control" className="mt-4"><ExpiryControl /></TabsContent>}
                {canAnalyzeStock && <TabsContent value="stock-analysis" className="mt-4"><StockAnalyzer /></TabsContent>}
            </Tabs>
        </div>
    );
}
