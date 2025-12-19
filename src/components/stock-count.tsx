
"use client";

import { useState, useMemo, useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { StockCountManagement } from '@/components/stock-audit-management';

export function StockCount() {
  const { permissions } = useAuth();
  const canManageRequests = permissions.itemRequests.approve;
  const canApproveCounts = permissions.stock.stockCount.approve;
  const showManagementTab = canManageRequests || canApproveCounts;

  return (
    <div className="space-y-6">
        <StockCountManagement showExportButton={false} />
    </div>
  );
}
