"use client";

import { useContext } from 'react';
import { DPContext, type DPContextType } from '@/components/dp-provider';

export const useDP = (): DPContextType => {
  const context = useContext(DPContext);
  if (context === undefined) {
    throw new Error('useDP must be used within a DPProvider');
  }
  return context;
};
