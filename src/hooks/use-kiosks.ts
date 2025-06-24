"use client";

import { useContext } from 'react';
import { KiosksContext, type KiosksContextType } from '@/components/kiosks-provider';

export const useKiosks = (): KiosksContextType => {
  const context = useContext(KiosksContext);
  if (context === undefined) {
    throw new Error('useKiosks must be used within a KiosksProvider');
  }
  return context;
};
