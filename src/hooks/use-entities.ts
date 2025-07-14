
"use client";

import { useContext } from 'react';
import { EntitiesContext, type EntitiesContextType } from '@/components/entities-provider';

export const useEntities = (): EntitiesContextType => {
  const context = useContext(EntitiesContext);
  if (context === undefined) {
    throw new Error('useEntities must be used within an EntitiesProvider');
  }
  return context;
};
