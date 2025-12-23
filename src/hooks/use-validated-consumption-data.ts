// src/hooks/useValidatedConsumptionData.ts
import { useEffect, useMemo, useCallback } from 'react';
import { useConsumptionAnalysis } from '@/hooks/use-consumption-analysis';
import { useBaseProducts } from './use-base-products';
import { useKiosks } from './use-kiosks';
import { validateConsumptionReports, validateBaseProducts, generateDataIntegrityReport } from '@/utils/dataValidation';
import { writeBatch, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { type BaseProductStockLevel, type ConsumptionReport } from '@/types';

export function useValidatedConsumptionData() {
  const { history: rawReports, loading: loadingReports, addReport: rawAddReport, deleteReport } = useConsumptionAnalysis();
  const { baseProducts: rawBaseProducts, loading: loadingBases, updateMultipleBaseProducts } = useBaseProducts();
  const { kiosks, loading: loadingKiosks } = useKiosks();

  const { reports, baseProducts, integrityReport } = useMemo(() => {
    const validBaseProducts = validateBaseProducts(rawBaseProducts || []);
    // Directly use the validated and complete reports.
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

      // Ensure all properties of ConsumptionReport are present
      return {
        id: r.id,
        reportName: r.reportName,
        month: r.month,
        year: r.year,
        kioskId: r.kioskId,
        kioskName: r.kioskName,
        createdAt: r.createdAt,
        status: r.status,
        results: newResults,
      };
    });

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
      const networkMonthsWithConsumption = new Set<string>();

      // 1. Kiosk calculation (12 days)
      for (const k of kioskList) {
          if (newStockLevels[k.id]?.override) {
              // If override is on, we still need to calculate its consumption for the network total
              const kioskReportsForNetwork = allReports.filter(r => r.kioskId === k.id);
              const kioskConsumptionForNetwork = kioskReportsForNetwork.reduce((sum, r) => {
                  const item = r.results.find((res: any) => res.baseProductId === bp.id);
                  return sum + (item?.consumedQuantity || 0);
              }, 0);
              
              if (kioskConsumptionForNetwork > 0) {
                  totalNetworkConsumption += kioskConsumptionForNetwork;
                  kioskReportsForNetwork.forEach(r => networkMonthsWithConsumption.add(`${r.year}-${r.month}`));
              }
              continue; // Skip auto-calculation for this kiosk
          };

          const kioskReports = allReports.filter(r => r.kioskId === k.id);
          if (kioskReports.length === 0) continue;
          
          const totalKioskConsumption = kioskReports.reduce((sum, r) => {
              const item = r.results.find((res: any) => res.baseProductId === bp.id);
              return sum + (item?.consumedQuantity || 0);
          }, 0);

          totalNetworkConsumption += totalKioskConsumption;
          
          if (totalKioskConsumption > 0) {
            kioskReports.forEach(r => networkMonthsWithConsumption.add(`${r.year}-${r.month}`));
            
            const avgMonthlyConsumption = totalKioskConsumption / kioskReports.length;
            const dailyAvg = avgMonthlyConsumption / 30;
            const kioskMinStock = Math.ceil((dailyAvg * 12)); // 12 days coverage
            
            if (kioskMinStock > 0) {
                newStockLevels[k.id] = { 
                    ...(newStockLevels[k.id] || {}),
                    min: kioskMinStock, 
                    override: false 
                };
            }
          }
      }

      // 2. Matriz calculation (30 days of network consumption)
      if (!newStockLevels['matriz']?.override) {
          if (totalNetworkConsumption > 0 && networkMonthsWithConsumption.size > 0) {
              const avgTotalMonthlyConsumption = totalNetworkConsumption / networkMonthsWithConsumption.size;
              const matrizMinStock = Math.ceil(avgTotalMonthlyConsumption);
               if (matrizMinStock > 0) {
                  newStockLevels['matriz'] = { 
                      ...(newStockLevels['matriz'] || {}),
                      min: matrizMinStock, 
                      override: false 
                  };
              }
          }
      }
      
      // Only stage for update if stockLevels actually changed
      if (JSON.stringify(newStockLevels) !== JSON.stringify(bp.stockLevels)) {
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
