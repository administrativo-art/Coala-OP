
"use client"

import { useState, useMemo, useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { StockCountManagement } from '@/components/stock-count-management';
import { useItemAddition } from '@/hooks/use-item-addition';
import { ItemAdditionRequestManagement } from './item-addition-request-management';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';


export function StockCount() {
  const { permissions } = useAuth();
  const { requests, loading } = useItemAddition();
  const [activeTab, setActiveTab] = useState('count');
  
  const canManageRequests = permissions.itemRequests?.approve;
  const pendingRequestsCount = useMemo(() => {
    return requests.filter(r => r.status === 'pending').length;
  }, [requests]);

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="count">Contagem de Estoque</TabsTrigger>
            {canManageRequests && (
                <TabsTrigger value="requests">
                    Solicitações de Cadastro 
                    {pendingRequestsCount > 0 && <span className="ml-2 inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-destructive rounded-full">{pendingRequestsCount}</span>}
                </TabsTrigger>
            )}
        </TabsList>
        <TabsContent value="count" className="mt-6">
            <StockCountManagement showExportButton={false} />
        </TabsContent>
        {canManageRequests && (
            <TabsContent value="requests" className="mt-6">
                <ItemAdditionRequestManagement />
            </TabsContent>
        )}
    </Tabs>
  );
}
