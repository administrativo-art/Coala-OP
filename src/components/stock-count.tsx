"use client"

import { useState, useMemo } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { StockCountManagement } from '@/components/stock-count-management';
import { useItemAddition } from '@/hooks/use-item-addition';
import { ItemAdditionRequestManagement } from './item-addition-request-management';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { Badge } from './ui/badge';


export function StockCount() {
  const { permissions } = useAuth();
  const { requests, loading } = useItemAddition();
  const [activeTab, setActiveTab] = useState('count');
  
  const canManageRequests = permissions.itemRequests?.approve;
  const pendingRequestsCount = useMemo(() => {
    return requests.filter(r => r.status === 'pending').length;
  }, [requests]);

  return (
      <Tabs defaultValue="count" value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="count">Contagem e Auditoria</TabsTrigger>
            <TabsTrigger value="requests" disabled={!canManageRequests}>
                Solicitações
                {pendingRequestsCount > 0 && <Badge className="ml-2">{pendingRequestsCount}</Badge>}
            </TabsTrigger>
        </TabsList>
        <TabsContent value="count" className="mt-4">
            <StockCountManagement showExportButton={false} />
        </TabsContent>
        <TabsContent value="requests" className="mt-4">
            {canManageRequests ? <ItemAdditionRequestManagement /> : <p>Você não tem permissão para gerenciar solicitações.</p>}
        </TabsContent>
    </Tabs>
  );
}
