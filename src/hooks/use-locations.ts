
"use client";

import { useContext } from 'react';
import { LocationsContext, type LocationsContextType } from '@/components/locations-provider';

export const useLocations = (): LocationsContextType => {
  const context = useContext(LocationsContext);
  if (context === undefined) {
    throw new Error('useLocations must be used within a LocationsProvider');
  }
  return context;
};
