"use client";

import { useContext } from 'react';

import { AssetsContext, type AssetsContextType } from '@/components/assets-provider';

export function useAssets(): AssetsContextType {
  const context = useContext(AssetsContext);
  if (!context) throw new Error('useAssets must be used within an AssetsProvider');
  return context;
}
