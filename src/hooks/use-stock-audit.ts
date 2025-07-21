"use client";

import { useContext } from 'react';
import { StockAuditContext, type StockAuditContextType } from '@/components/stock-audit-provider';

// This is a temporary type extension until setActiveSession is formally added
type ExtendedStockAuditContextType = StockAuditContextType & {
  setActiveSession?: (session: any) => void;
};


export const useStockAudit = (): ExtendedStockAuditContextType => {
  const context = useContext(StockAuditContext);
  if (context === undefined) {
    throw new Error('useStockAudit must be used within a StockAuditProvider');
  }
  return context;
};
