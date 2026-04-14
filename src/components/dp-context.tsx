"use client";

import { useDPStore, type DPStoreState } from '@/store/use-dp-store';

/**
 * useDP Hook - Bridging to Zustand store.
 * This ensures compatibility with existing components while fixing context duplication issues permanently.
 */
export const useDP = (): DPStoreState => {
  return useDPStore();
};
