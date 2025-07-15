// src/hooks/useConsumptionReports.ts
"use client";

import { useConsumptionAnalysis } from './use-consumption-analysis';

// This is a simple adapter hook to match the new structure.
// It maps the output of the existing useConsumptionAnalysis hook
// to the expected { data, isLoading, error } format.
export const useConsumptionReports = () => {
  const { history, loading, addReport, deleteReport } = useConsumptionAnalysis();
  
  return {
    data: history,
    isLoading: loading,
    error: null, // Assuming no error state is currently exposed by useConsumptionAnalysis
    addReport,
    deleteReport,
  };
};
