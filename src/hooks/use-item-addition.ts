

"use client";

import { useContext } from 'react';
import { ItemAdditionContext, type ItemAdditionContextType } from '@/components/item-addition-provider';

export const useItemAddition = (): ItemAdditionContextType => {
  const context = useContext(ItemAdditionContext);
  if (context === undefined) {
    throw new Error('useItemAddition must be used within a ItemAdditionProvider');
  }
  return context;
};
