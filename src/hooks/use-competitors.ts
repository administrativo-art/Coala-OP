
"use client";

import { useContext } from 'react';
import { CompetitorContext, type CompetitorContextType } from '@/components/competitor-provider';

export const useCompetitors = (): CompetitorContextType => {
  const context = useContext(CompetitorContext);
  if (context === undefined) {
    throw new Error('useCompetitors must be used within a CompetitorProvider');
  }
  return context;
};

