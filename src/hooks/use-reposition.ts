
"use client";

import { useContext } from 'react';
import { RepositionContext, type RepositionContextType } from '@/components/reposition-provider';

export const useReposition = (): RepositionContextType => {
  const context = useContext(RepositionContext);
  if (context === undefined) {
    throw new Error('useReposition must be used within a RepositionProvider');
  }
  return context;
};
