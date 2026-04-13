"use client";

import { useContext } from 'react';
import { DPContext, type DPContextType } from '@/contexts/dp-context';

export const useDP = (): DPContextType => {
  const context = useContext(DPContext);
  if (context === undefined) {
    throw new Error('useDP must be used within a DPProvider');
  }
  return context;
};
