"use client";

import { useContext } from 'react';
import { DPContext, type DPContextType } from '@/contexts/dp-context';

export const useDP = (): DPContextType => {
  const context = useContext(DPContext);
  if (context === undefined) {
    throw new Error(
      'useDP must be used within a DPProvider. If this happens in dashboard/settings, check for duplicated DPContext chunks and prefer next/dynamic({ ssr: false }) for DP-dependent modules.'
    );
  }
  return context;
};
