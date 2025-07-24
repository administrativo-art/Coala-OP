
"use client";

import { useContext } from 'react';
import { ConsumptionAnalysisContext, type ConsumptionAnalysisContextType } from '@/components/consumption-analysis-provider';
import { useKiosks } from '@/hooks/use-kiosks';
import { useBaseProducts } from '@/hooks/use-base-products';
import { writeBatch, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

type EnrichedContextType = ConsumptionAnalysisContextType & {
  // A função original foi enriquecida, mas a assinatura base não precisa mudar aqui
  // A lógica de negócio será aplicada no hook que consome este.
};

export const useConsumptionAnalysis = (): EnrichedContextType => {
  const context = useContext(ConsumptionAnalysisContext);
  const { kiosks } = useKiosks();
  const { baseProducts, updateMultipleBaseProducts } = useBaseProducts();

  if (context === undefined) {
    throw new Error('useConsumptionAnalysis must be used within a ConsumptionAnalysisProvider');
  }

  // A lógica de cálculo foi movida para um hook de validação e agregação,
  // tornando este hook mais simples e focado no acesso aos dados brutos.

  return {
    ...context,
  };
};
