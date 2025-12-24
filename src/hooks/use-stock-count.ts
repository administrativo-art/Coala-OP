
"use client";

import { useContext } from 'react';

// This context and provider are deprecated and will be removed.
// The new system uses useStockAudit.
const StockCountContext: any = {
    counts: [],
    loading: false,
    addStockCount: () => Promise.resolve(),
    updateStockCount: () => Promise.resolve(),
    deleteStockCount: () => Promise.resolve(),
};


export const useStockCount = (): any => {
  return useContext(StockCountContext);
};

    