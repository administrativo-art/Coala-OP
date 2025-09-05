
"use client";

import { useContext } from 'react';
import { RepositionContext, type RepositionContextType } from '@/components/reposition-provider';

export const useReposition = (): Omit<RepositionContextType, 'deleteRepositionActivity'> & { cancelRepositionActivity: (activityId: string) => Promise<void> } => {
  const context = useContext(RepositionContext);
  if (context === undefined) {
    throw new Error('useReposition must be used within a RepositionProvider');
  }
  // This is a bit of a hack to satisfy TypeScript while the refactor is in progress
  // We are removing `deleteRepositionActivity` from the type and adding `cancelRepositionActivity`.
  const { deleteRepositionActivity, ...rest } = context as any;
  return rest;
};
