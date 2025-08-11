
      // src/hooks/useValidatedConsumptionData.ts
import { useEffect, useMemo, useCallback } from 'react';
import { useConsumptionAnalysis } from '@/hooks/use-consumption-analysis';
import { useBaseProducts } from './use-base-products';
import { useKiosks } from './use-kiosks';
import { validateConsumptionReports, validateBaseProducts, generateDataIntegrityReport } from '@/utils/dataValidation';
import { writeBatch, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { type BaseProductStockLevel } from '@/types';

export function useValidatedConsumptionData() {
  const { history: rawReports, loading: loadingReports, addReport: rawAddReport, deleteReport } = useConsumptionAnalysis();
  const { baseProducts: rawBaseProducts, loading: loadingBases, updateMultipleBaseProducts } = useBaseProducts();
  const { kiosks, loading: loadingKiosks } = useKiosks();

  const { reports, baseProducts, integrityReport } = useMemo(() => {
    const validBaseProducts = validateBaseProducts(rawBaseProducts || []);
    const validReports = validateConsumptionReports(rawReports || []);
    const report = generateDataIntegrityReport(validReports, validBaseProducts);
    
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
  
  const calculateAndApplyAllMinimumStocks = useCallback(async (allReports: any[]) => {
      const productsToUpdate: any[] = [];
      const kioskList = kiosks.filter(k => k.id !== 'matriz');

      for (const bp of baseProducts) {
        const newStockLevels: { [kioskId: string]: BaseProductStockLevel } = { ...(bp.stockLevels || {}) };
        
        let totalNetworkConsumption = 0;
        let totalNetworkMonths = new Set<string>();
        
        for (const k of kioskList) {
            const kioskReports = allReports.filter(r => r.kioskId === k.id);
            if (kioskReports.length === 0) continue;

            const isOverridden = newStockLevels[k.id]?.override === true;
            if (isOverridden) continue;
            
            const totalKioskConsumption = kioskReports.reduce((sum, r) => {
                const item = r.results.find((res: any) => res.baseProductId === bp.id);
                return sum + (item?.consumedQuantity || 0);
            }, 0);
            
            if (totalKioskConsumption > 0) {
              const avgMonthlyConsumption = totalKioskConsumption / kioskReports.length;
              const dailyAvg = avgMonthlyConsumption / 30;
              const kioskMinStock = Math.ceil((dailyAvg * 7) + (dailyAvg * 5));
              
              if (kioskMinStock > 0) {
                  newStockLevels[k.id] = { min: kioskMinStock, override: false };
                  totalNetworkConsumption += totalKioskConsumption;
                  kioskReports.forEach(r => totalNetworkMonths.add(`${r.year}-${r.month}`));
              }
            }
        }

        const isMatrizOverridden = newStockLevels['matriz']?.override === true;
        if (!isMatrizOverridden && totalNetworkConsumption > 0 && totalNetworkMonths.size > 0) {
            const avgTotalMonthlyConsumption = totalNetworkConsumption / totalNetworkMonths.size;
             if (avgTotalMonthlyConsumption > 0) {
                newStockLevels['matriz'] = { min: Math.ceil(avgTotalMonthlyConsumption), override: false };
            }
        }
        
        if (Object.keys(newStockLevels).length > 0) {
            productsToUpdate.push({
                ...bp,
                stockLevels: newStockLevels,
            });
        }
      }

      if (productsToUpdate.length > 0) {
        await updateMultipleBaseProducts(productsToUpdate);
      }
  }, [kiosks, baseProducts, updateMultipleBaseProducts]);
  
  const addReport = useCallback(async (reportData: any) => {
    const reportId = await rawAddReport(reportData);
    if (reportId) {
        const newReportsList = [...reports, { ...reportData, id: reportId }];
        await calculateAndApplyAllMinimumStocks(newReportsList);
    }
    return reportId;
  }, [rawAddReport, reports, calculateAndApplyAllMinimumStocks]);

  return {
    reports,
    baseProducts,
    integrityReport,
    isLoading: loadingReports || loadingBases || loadingKiosks,
    error: null,
    hasValidData: reports.length > 0 && baseProducts.length > 0,
    addReport,
    deleteReport,
  };
}
