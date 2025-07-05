
"use client";

import { useContext } from 'react';
import { ReturnRequestContext, type ReturnRequestContextType } from '@/components/return-request-provider';

export const useReturnRequests = (): ReturnRequestContextType => {
  const context = useContext(ReturnRequestContext);
  if (context === undefined) {
    throw new Error('useReturnRequests must be used within a ReturnsProvider');
  }
  return context;
};
