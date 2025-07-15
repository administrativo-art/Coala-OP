// src/hooks/useValidatedConsumptionData.ts
import { useMemo } from 'react';
import { useConsumptionAnalysis } from './use-consumption-analysis';
import { useBaseProducts } from './use-base-products';

export function useValidatedConsumptionData() {
  const { history: rawReports, loading: loadingReports, addReport, deleteReport } = useConsumptionAnalysis();
  const { baseProducts: rawBaseProducts, loading: loadingBases } = useBaseProducts();

  // A validação agora é feita no momento da importação.
  // Este hook agora serve para combinar as fontes de dados.
  const validatedData = useMemo(() => {
    return {
      reports: rawReports || [],
      baseProducts: rawBaseProducts || [],
      integrityReport: null // A validação de integridade foi movida para a importação.
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
