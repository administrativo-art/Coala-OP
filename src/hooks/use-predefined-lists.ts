"use client";

import { useContext } from 'react';
import { PredefinedListsContext, type PredefinedListsContextType } from '@/components/predefined-lists-provider';

export const usePredefinedLists = (): PredefinedListsContextType => {
  const context = useContext(PredefinedListsContext);
  if (context === undefined) {
    throw new Error('usePredefinedLists must be used within a PredefinedListsProvider');
  }
  return context;
};
