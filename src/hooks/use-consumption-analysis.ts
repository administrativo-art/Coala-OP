
"use client";

import { useContext } from 'react';
import { ConsumptionAnalysisContext, type ConsumptionAnalysisContextType } from '@/components/consumption-analysis-provider';

export const useConsumptionAnalysis = (): ConsumptionAnalysisContextType => {
  const context = useContext(ConsumptionAnalysisContext);
  if (context === undefined) {
    throw new Error('useConsumptionAnalysis must be used within a ConsumptionAnalysisProvider');
  }
  return context;
};
