"use client";

import { useContext } from 'react';

import { OperationalItemCategoriesContext } from '@/components/operational-item-categories-provider';

export function useOperationalItemCategories() {
  const context = useContext(OperationalItemCategoriesContext);
  if (!context) {
    throw new Error('useOperationalItemCategories must be used within an OperationalItemCategoriesProvider');
  }
  return context;
}
