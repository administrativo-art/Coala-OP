
"use client";

import React, { createContext } from 'react';

// This provider is deprecated and will be removed.
// All logic has been migrated to the StockAuditProvider.
export const StockCountContext = createContext<any | undefined>(undefined);

export function StockCountProvider({ children }: { children: React.ReactNode }) {
  const value = {
    counts: [],
    loading: false,
    addStockCount: async () => {},
    updateStockCount: async () => {},
    deleteStockCount: async () => {},
  };

  return (
    <StockCountContext.Provider value={value}>
      {children}
    </StockCountContext.Provider>
  );
}

    