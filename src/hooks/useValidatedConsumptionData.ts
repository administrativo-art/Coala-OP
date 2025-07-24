
// src/hooks/useValidatedConsumptionData.ts
import { useEffect, useMemo } from 'react';
import { useConsumptionAnalysis } from './use-consumption-analysis';
import { useBaseProducts } from './use-base-products';
import { useKiosks } from './use-kiosks';
import { validateConsumptionReports, validateBaseProducts, generateDataIntegrityReport } from '@/utils/dataValidation';
import { writeBatch, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

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
  
  const calculateAllMinimumStocks = async (updatedReports: any[]) => {
      const productsToUpdate: any[] = [];

      for (const bp of baseProducts) {
        const newStockLevels: { [kioskId: string]: { min: number } } = {};
        
        let totalNetworkConsumption = 0;
        let totalNetworkMonths = new Set();
        
        for (const k of kiosks) {
            if (k.id === 'matriz') continue;

            const kioskReports = updatedReports.filter(r => r.kioskId === k.id);
            if (kioskReports.length === 0) continue;
            
            const totalKioskConsumption = kioskReports.reduce((sum, r) => {
                const item = r.results.find((res: any) => res.baseProductId === bp.id);
                return sum + (item?.consumedQuantity || 0);
            }, 0);
            
            if (totalKioskConsumption > 0) {
              const avgMonthlyConsumption = totalKioskConsumption / kioskReports.length;
              const dailyAvg = avgMonthlyConsumption / 30;
              const kioskMinStock = Math.ceil((dailyAvg * 7) + (dailyAvg * 5));
              
              if (kioskMinStock > 0) {
                  newStockLevels[k.id] = { min: kioskMinStock };
                  totalNetworkConsumption += totalKioskConsumption;
                  kioskReports.forEach(r => totalNetworkMonths.add(`${r.year}-${r.month}`));
              }
            }
        }

        if (totalNetworkConsumption > 0 && totalNetworkMonths.size > 0) {
            const avgTotalMonthlyConsumption = totalNetworkConsumption / totalNetworkMonths.size;
             if (avgTotalMonthlyConsumption > 0) {
                newStockLevels['matriz'] = { min: Math.ceil(avgTotalMonthlyConsumption) };
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
  };
  
  const addReport = async (reportData: any) => {
    const reportId = await rawAddReport(reportData);
    if (reportId) {
        const newReportsList = [...reports, { ...reportData, id: reportId }];
        await calculateAllMinimumStocks(newReportsList);
    }
    return reportId;
  };


  useEffect(() => {
    // Initial calculation on load
    if(!loadingReports && !loadingBases && !loadingKiosks && reports.length > 0 && baseProducts.length > 0) {
        calculateAllMinimumStocks(reports);
    }
  }, [loadingReports, loadingBases, loadingKiosks]);


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
