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
      if (!allReports.length || !baseProducts.length || !kiosks.length) return;
  
      const productsToUpdate: any[] = [];
      const kioskList = kiosks.filter(k => k.id !== 'matriz');

      for (const bp of baseProducts) {
        const newStockLevels: { [kioskId: string]: BaseProductStockLevel } = { ...(bp.stockLevels || {}) };
        
        let totalNetworkConsumption = 0;
        const networkMonths = new Set<string>();
        
        // 1. Kiosk calculation (12 days)
        for (const k of kioskList) {
            if (newStockLevels[k.id]?.override) continue;

            const kioskReports = allReports.filter(r => r.kioskId === k.id);
            if (kioskReports.length === 0) continue;
            
            const totalKioskConsumption = kioskReports.reduce((sum, r) => {
                const item = r.results.find((res: any) => res.baseProductId === bp.id);
                return sum + (item?.consumedQuantity || 0);
            }, 0);
            
            if (totalKioskConsumption > 0) {
              const avgMonthlyConsumption = totalKioskConsumption / kioskReports.length;
              const dailyAvg = avgMonthlyConsumption / 30;
              // Rule: 7 days of consumption + 5 days of safety stock = 12 days
              const kioskMinStock = Math.ceil((dailyAvg * 7) + (dailyAvg * 5));
              
              if (kioskMinStock > 0) {
                  newStockLevels[k.id] = { 
                      ...(newStockLevels[k.id] || {}), // preserve leadTime/safety if exists
                      min: kioskMinStock, 
                      override: false 
                    };
              }

              // Sum up for Matriz calculation
              totalNetworkConsumption += totalKioskConsumption;
              kioskReports.forEach(r => networkMonths.add(`${r.year}-${r.month}`));
            }
        }

        // 2. Matriz calculation (30 days of network consumption)
        if (!newStockLevels['matriz']?.override) {
            if (totalNetworkConsumption > 0 && networkMonths.size > 0) {
                const avgTotalMonthlyConsumption = totalNetworkConsumption / networkMonths.size;
                const matrizMinStock = Math.ceil(avgTotalMonthlyConsumption);
                 if (matrizMinStock > 0) {
                    newStockLevels['matriz'] = { 
                        ...(newStockLevels['matriz'] || {}), // preserve leadTime/safety if exists
                        min: matrizMinStock, 
                        override: false 
                    };
                }
            }
        }
        
        productsToUpdate.push({
            ...bp,
            stockLevels: newStockLevels,
        });
      }

      if (productsToUpdate.length > 0) {
        await updateMultipleBaseProducts(productsToUpdate);
      }
  }, [kiosks, baseProducts, updateMultipleBaseProducts]);
  
  const addReport = useCallback(async (reportData: any) => {
    const reportId = await rawAddReport(reportData);
    // This calculation is moved to be called only when a new report is added.
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
