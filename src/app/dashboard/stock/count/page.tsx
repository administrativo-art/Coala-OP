"use client"

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StockCountManagement } from "@/components/stock-count-management";
import { ItemAdditionRequestManagement } from "@/components/item-addition-request-management";
import { useAuth } from "@/hooks/use-auth";
import { useItemAddition } from "@/hooks/use-item-addition";
import { Badge } from "@/components/ui/badge";
import { useMemo, useState } from "react";
import { AuditHistory } from '@/components/stock-audit-management';


export default function StockCountPage() {
    const { permissions } = useAuth();
    const { requests, loading } = useItemAddition();
    const [activeTab, setActiveTab] = useState('count');
    
    const canManageRequests = permissions.itemRequests?.approve;
    const pendingRequestsCount = useMemo(() => {
        if (loading) return 0;
        return requests.filter(r => r.status === 'pending').length;
    }, [requests, loading]);

    return (
        <div className="space-y-4">
            <Link href="/dashboard/stock" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                <ArrowLeft className="h-4 w-4" />
                Voltar para gestão de estoque
            </Link>
            
            <div className="mb-6">
                <h1 className="text-3xl font-bold">Contagem e Auditoria</h1>
                <p className="text-muted-foreground">Realize contagens de estoque, aprove divergências e gerencie solicitações de cadastro.</p>
            </div>

            <Tabs defaultValue="count" value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="grid w-full grid-cols-2 md:w-auto md:grid-cols-3">
                    <TabsTrigger value="count">Contagem e Auditoria</TabsTrigger>
                    <TabsTrigger value="history">Histórico</TabsTrigger>
                    {canManageRequests && (
                        <TabsTrigger value="requests">
                            Solicitações
                            {pendingRequestsCount > 0 && <Badge className="ml-2">{pendingRequestsCount}</Badge>}
                        </TabsTrigger>
                    )}
                </TabsList>
                <TabsContent value="count" className="mt-4">
                    <StockCountManagement />
                </TabsContent>
                <TabsContent value="history" className="mt-4">
                    <AuditHistory />
                </TabsContent>
                {canManageRequests && (
                    <TabsContent value="requests" className="mt-4">
                        <ItemAdditionRequestManagement />
                    </TabsContent>
                )}
            </Tabs>
        </div>
    )
}
