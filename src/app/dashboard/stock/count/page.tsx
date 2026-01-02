"use client"

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ItemAdditionRequestManagement } from "@/components/item-addition-request-management";
import { useAuth } from "@/hooks/use-auth";
import { useItemAddition } from "@/hooks/use-item-addition";
import { Badge } from "@/components/ui/badge";
import { useMemo, useState } from "react";
import { StockSessionManagement } from "@/components/stock-session-management";
import { useRouter } from 'next/navigation';


export default function StockCountPage() {
    const { permissions } = useAuth();
    const { requests, loading } = useItemAddition();
    const [activeTab, setActiveTab] = useState('count');
    const router = useRouter();
    
    const canManageRequests = permissions.stock.stockCount.approve;
    const pendingRequestsCount = useMemo(() => {
        if (loading) return 0;
        return requests.filter(r => r.status === 'pending').length;
    }, [requests, loading]);

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-4 mb-2">
              <Button 
                onClick={() => router.push('/dashboard/stock')}
                variant="ghost"
                className="p-2 rounded-full h-auto w-auto text-muted-foreground transition-colors hover:bg-muted"
                aria-label="Voltar para gestão de estoque"
              >
                <ArrowLeft className="w-6 h-6" />
              </Button>

              <div>
                <h1 className="text-3xl font-bold">Contagem de estoque</h1>
                <p className="text-sm text-muted-foreground">Voltar para gestão de estoque</p>
              </div>
            </div>
            
            <Tabs defaultValue="count" value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="grid w-full grid-cols-1">
                    <TabsTrigger value="count">Contagem e Auditoria</TabsTrigger>
                </TabsList>
                <TabsContent value="count" className="mt-4">
                    <StockSessionManagement />
                </TabsContent>
            </Tabs>
        </div>
    )
}
