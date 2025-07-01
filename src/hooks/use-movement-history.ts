
"use client";

import { useContext } from 'react';
import { MovementHistoryContext, type MovementHistoryContextType } from '@/components/movement-history-provider';

export const useMovementHistory = (): MovementHistoryContextType => {
  const context = useContext(MovementHistoryContext);
  if (context === undefined) {
    throw new Error('useMovementHistory must be used within a MovementHistoryProvider');
  }
  return context;
};
