// src/hooks/useConsumptionAggregation.ts
import { useMemo } from 'react';
import { useValidatedConsumptionData } from './useValidatedConsumptionData';

export interface AggregatedConsumption {
  baseProductId: string;
  baseProduct: string;
  unit: string;
  average: number;
  totalConsumption: number;
  monthsWithConsumption: number;
  maxMonthlyConsumption: number;
  minMonthlyConsumption: number;
}

export interface ConsumptionAggregationOptions {
  selectedBaseIds?: string[];
  excludeZeroConsumption?: boolean;
  groupByKiosk?: boolean;
}

export function useConsumptionAggregation(options: ConsumptionAggregationOptions = {}) {
  const { selectedBaseIds = [], excludeZeroConsumption = false } = options;
  const { reports, baseProducts, integrityReport, isLoading, error, hasValidData } = useValidatedConsumptionData();

  // Criar mapa de produtos base para lookup O(1)
  const baseProductMap = useMemo(() => {
    return new Map(baseProducts.map(bp => [bp.id, bp]));
  }, [baseProducts]);

  // Calcular agregação
  const aggregatedData = useMemo((): AggregatedConsumption[] => {
    if (!hasValidData) return [];

    // Determinar produtos base a processar
    const baseList = selectedBaseIds.length > 0 
      ? baseProducts.filter(bp => selectedBaseIds.includes(bp.id))
      : baseProducts;

    // Inicializar acumulador
    const consumption: Record<string, {
      total: number;
      monthsCount: number;
      monthlyValues: number[];
    }> = {};

    baseList.forEach(bp => {
      consumption[bp.id] = {
        total: 0,
        monthsCount: 0,
        monthlyValues: []
      };
    });

    // Processar relatórios
    reports.forEach(report => {
      const monthlyByBase: Record<string, number> = {};

      // Somar consumo por baseProductId neste relatório
      report.results.forEach(item => {
        if (consumption[item.baseProductId] !== undefined) {
          monthlyByBase[item.baseProductId] = (monthlyByBase[item.baseProductId] || 0) + item.consumedQuantity;
        }
      });

      // Atualizar acumulador
      Object.entries(monthlyByBase).forEach(([baseId, monthlyTotal]) => {
        if (consumption[baseId] && monthlyTotal > 0) {
          consumption[baseId].total += monthlyTotal;
          consumption[baseId].monthsCount += 1;
          consumption[baseId].monthlyValues.push(monthlyTotal);
        }
      });
    });

    // Construir resultado final
    const result = baseList.map(bp => {
      const data = consumption[bp.id];
      const average = data.monthsCount > 0 ? data.total / data.monthsCount : 0;
      const monthlyValues = data.monthlyValues;

      return {
        baseProductId: bp.id,
        baseProduct: `${bp.name} (${bp.unit})`,
        unit: bp.unit,
        average: parseFloat(average.toFixed(2)),
        totalConsumption: data.total,
        monthsWithConsumption: data.monthsCount,
        maxMonthlyConsumption: monthlyValues.length > 0 ? Math.max(...monthlyValues) : 0,
        minMonthlyConsumption: monthlyValues.length > 0 ? Math.min(...monthlyValues) : 0
      };
    });

    // Filtrar produtos sem consumo se solicitado
    return excludeZeroConsumption 
      ? result.filter(item => item.average > 0)
      : result;

  }, [reports, baseProducts, baseProductMap, selectedBaseIds, excludeZeroConsumption, hasValidData]);

  // Estatísticas adicionais
  const statistics = useMemo(() => {
    const totalProducts = aggregatedData.length;
    const productsWithConsumption = aggregatedData.filter(item => item.average > 0).length;
    const totalAverage = aggregatedData.reduce((sum, item) => sum + item.average, 0);
    const highestConsumption = aggregatedData.reduce((max, item) => 
      item.average > max.average ? item : max, aggregatedData[0] || { average: 0, baseProduct: '' });
    
    return {
      totalProducts,
      productsWithConsumption,
      productsWithoutConsumption: totalProducts - productsWithConsumption,
      overallAverage: totalProducts > 0 ? totalAverage / totalProducts : 0,
      highestConsumption: highestConsumption.average > 0 ? highestConsumption : null,
      dataIntegrityScore: integrityReport?.dataIntegrityScore || 0
    };
  }, [aggregatedData, integrityReport]);

  return {
    data: aggregatedData,
    statistics,
    integrityReport,
    isLoading,
    error,
    hasValidData: aggregatedData.length > 0
  };
}
