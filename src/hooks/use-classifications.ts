
"use client";

import { useContext } from 'react';
import { ClassificationsContext, type ClassificationsContextType } from '@/components/classifications-provider';

export const useClassifications = (): ClassificationsContextType => {
  const context = useContext(ClassificationsContext);
  if (context === undefined) {
    throw new Error('useClassifications must be used within a ClassificationsProvider');
  }
  return context;
};

    