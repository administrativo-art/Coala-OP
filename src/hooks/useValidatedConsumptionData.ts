
// src/hooks/useValidatedConsumptionData.ts
import { useMemo } from 'react';
import { useConsumptionAnalysis } from './use-consumption-analysis';
import { useBaseProducts } from './use-base-products';
import { 
  validateConsumptionReports, 
  validateBaseProducts, 
  generateDataIntegrityReport,
  type ConsumptionReport,
  type BaseProduct
} from '@/utils/dataValidation';

export function useValidatedConsumptionData() {
  const { history: rawReports, loading: loadingReports } = useConsumptionAnalysis();
  const { baseProducts: rawBaseProducts, loading: loadingBases } = useBaseProducts();

  // Validar e normalizar dados
  const validatedData = useMemo(() => {
    const reports = rawReports ? validateConsumptionReports(rawReports) : [];
    const baseProducts = rawBaseProducts ? validateBaseProducts(rawBaseProducts) : [];
    
    const integrityReport = reports.length > 0 && baseProducts.length > 0 
      ? generateDataIntegrityReport(reports, baseProducts)
      : null;

    return {
      reports,
      baseProducts,
      integrityReport
    };
  }, [rawReports, rawBaseProducts]);

  return {
    ...validatedData,
    isLoading: loadingReports || loadingBases,
    hasValidData: validatedData.reports.length > 0 && validatedData.baseProducts.length > 0
  };
}
