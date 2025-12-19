
"use client"

import { useState, useMemo } from 'react';
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

  // The new page for requests is at /dashboard/stock/item-requests, 
  // so the tab logic here is removed to simplify the component.
  // The StockCountManagement now contains the button to open the request modal.

  return (
    <StockCountManagement showExportButton={false} />
  );
}
