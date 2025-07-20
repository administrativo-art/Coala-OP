// src/hooks/useValidatedConsumptionData.ts
import { useMemo } from 'react';
import { useConsumptionAnalysis } from './use-consumption-analysis';
import { useBaseProducts } from './use-base-products';
import { validateConsumptionReports, validateBaseProducts, generateDataIntegrityReport, type ConsumptionReport, type BaseProduct } from '@/utils/dataValidation';

export function useValidatedConsumptionData() {
  const { history: rawReports, loading: loadingReports, addReport, deleteReport } = useConsumptionAnalysis();
  const { baseProducts: rawBaseProducts, loading: loadingBases } = useBaseProducts();

  const { reports, baseProducts, integrityReport } = useMemo(() => {
    const validBaseProducts = validateBaseProducts(rawBaseProducts || []);
    const validReports = validateConsumptionReports(rawReports || []);
    const report = generateDataIntegrityReport(validReports, validBaseProducts);
    
    // Enrich reports with baseProductId from productName if it's missing
    const baseProductMap = new Map(validBaseProducts.map(bp => [bp.name.toLowerCase(), bp.id]));
    const enrichedReports = validReports.map(r => ({
      ...r,
      results: r.results.map(item => {
        if (!item.baseProductId) {
            const foundId = baseProductMap.get(item.productName.toLowerCase());
            if (foundId) {
                return { ...item, baseProductId: foundId };
            }
        }
        return item;
      })
    }));

    return {
      reports: enrichedReports,
      baseProducts: validBaseProducts,
      integrityReport: report,
    };
  }, [rawReports, rawBaseProducts]);

  return {
    reports,
    baseProducts,
    integrityReport,
    isLoading: loadingReports || loadingBases,
    error: null, // Placeholder for future error handling
    hasValidData: reports.length > 0 && baseProducts.length > 0,
    addReport,
    deleteReport,
  };
}
