

"use client";

import { useContext } from 'react';
import { StockAuditContext, type StockAuditContextType } from '@/components/stock-audit-provider';

export const useStockAudit = (): StockAuditContextType => {
  const context = useContext(StockAuditContext);
  if (context === undefined) {
    throw new Error('useStockAudit must be used within a StockAuditProvider');
  }
  return context;
};
