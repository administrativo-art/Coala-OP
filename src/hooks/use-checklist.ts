"use client";

import { useContext } from 'react';
import { ChecklistContext, type ChecklistContextType } from '@/components/checklist-provider';

export const useChecklist = (): ChecklistContextType => {
  const context = useContext(ChecklistContext);
  if (context === undefined) {
    throw new Error('useChecklist must be used within a ChecklistProvider');
  }
  return context;
};
