// src/hooks/useValidatedConsumptionData.ts
import { useMemo } from 'react';
import { useConsumptionAnalysis } from './use-consumption-analysis';
import { useBaseProducts } from './use-base-products';

export function useValidatedConsumptionData() {
  const { history: rawReports, loading: loadingReports, addReport, deleteReport } = useConsumptionAnalysis();
  const { baseProducts: rawBaseProducts, loading: loadingBases } = useBaseProducts();

  const validatedData = useMemo(() => {
    // The validation logic is now handled at import time.
    // This hook just combines the data sources.
    return {
      reports: rawReports || [],
      baseProducts: rawBaseProducts || [],
    };
  }, [rawReports, rawBaseProducts]);

  return {
    ...validatedData,
    isLoading: loadingReports || loadingBases,
    error: null, // Placeholder for future error handling
    hasValidData: validatedData.reports.length > 0 && validatedData.baseProducts.length > 0,
    addReport,
    deleteReport,
  };
}
