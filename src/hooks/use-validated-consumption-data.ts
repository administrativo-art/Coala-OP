// src/hooks/useValidatedConsumptionData.ts
import { useEffect, useMemo, useCallback } from 'react';
import { useConsumptionAnalysis } from '@/hooks/use-consumption-analysis';
import { useBaseProducts } from './use-base-products';
import { useKiosks } from './use-kiosks';
import { validateConsumptionReports, validateBaseProducts, generateDataIntegrityReport } from '@/utils/dataValidation';
import { type ConsumptionReport, type BaseProduct } from '@/types';

export function useValidatedConsumptionData() {
  const { history: rawReports, loading: loadingReports, addReport: rawAddReport, deleteReport } = useConsumptionAnalysis();
  const { baseProducts: rawBaseProducts, loading: loadingBases } = useBaseProducts();
  const { kiosks, loading: loadingKiosks } = useKiosks();

  const { reports, baseProducts, integrityReport } = useMemo(() => {
    const validBaseProducts: BaseProduct[] = validateBaseProducts(rawBaseProducts || []);
    const validReports = validateConsumptionReports(rawReports || []);
    const report = generateDataIntegrityReport(validReports, validBaseProducts);
    
    const baseProductMap = new Map(validBaseProducts.map(bp => [bp.name.toLowerCase(), bp.id]));
    
    const enrichedReports: ConsumptionReport[] = validReports.map(r => {
      const newResults = r.results.map(item => {
        if (!item.baseProductId) {
          const foundId = baseProductMap.get(item.productName.toLowerCase());
          if (foundId) {
            return { ...item, baseProductId: foundId };
          }
        }
        return item;
      });

      return {
        ...r,
        results: newResults,
      };
    });

    return {
      reports: enrichedReports,
      baseProducts: validBaseProducts,
      integrityReport: report,
    };
  }, [rawReports, rawBaseProducts]);
  
  const addReport = useCallback(async (reportData: any) => {
    const reportId = await rawAddReport(reportData);
    return reportId;
  }, [rawAddReport]);

  return {
    reports,
    baseProducts,
    integrityReport,
    isLoading: loadingReports || loadingBases || loadingKiosks,
    error: null,
    hasValidData: reports.length > 0,
    addReport,
    deleteReport,
  };
}
