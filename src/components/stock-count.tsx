

"use client";

import { useState, useMemo, useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { StockAuditManagement } from '@/components/stock-audit-management';

export function StockCount() {
  const { permissions } = useAuth();
  const canManageRequests = permissions.itemRequests.approve;
  const canApproveCounts = permissions.stock.stockCount.approve;
  const showManagementTab = canManageRequests || canApproveCounts;

  return (
    <div className="space-y-6">
        <StockAuditManagement showExportButton={false} />
    </div>
  );
}
