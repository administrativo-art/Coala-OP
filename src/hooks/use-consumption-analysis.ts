
      "use client";

import { useContext } from 'react';
import { ConsumptionAnalysisContext, type ConsumptionAnalysisContextType } from '@/components/consumption-analysis-provider';

// This hook has been deprecated. useValidatedConsumptionData should be used instead.
export const useConsumptionAnalysis = (): ConsumptionAnalysisContextType => {
  const context = useContext(ConsumptionAnalysisContext);
  if (context === undefined) {
    throw new Error('useConsumptionAnalysis must be used within a ConsumptionAnalysisProvider');
  }
  return context;
};

    