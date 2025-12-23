
// src/hooks/useConsumptionFilters.ts
import { useState, useCallback, useMemo } from 'react';
import { type BaseProduct } from '@/types';

export interface FilterState {
  selectedBaseIds: string[];
  excludeZeroConsumption: boolean;
  searchTerm: string;
  sortBy: 'name' | 'average' | 'total';
  sortOrder: 'asc' | 'desc';
}

export function useConsumptionFilters(baseProducts: BaseProduct[]) {
  const [filters, setFilters] = useState<FilterState>({
    selectedBaseIds: [],
    excludeZeroConsumption: false,
    searchTerm: '',
    sortBy: 'name',
    sortOrder: 'asc'
  });

  // Filtrar produtos base baseado na busca
  const filteredBaseProducts = useMemo(() => {
    if (!filters.searchTerm) return baseProducts;
    
    const searchLower = filters.searchTerm.toLowerCase();
    return baseProducts.filter(bp => 
      bp.name.toLowerCase().includes(searchLower) ||
      bp.unit.toLowerCase().includes(searchLower)
    );
  }, [baseProducts, filters.searchTerm]);

  // Handlers
  const updateSelectedBaseIds = useCallback((ids: string[]) => {
    setFilters(prev => ({ ...prev, selectedBaseIds: ids }));
  }, []);

  const toggleExcludeZeroConsumption = useCallback(() => {
    setFilters(prev => ({ ...prev, excludeZeroConsumption: !prev.excludeZeroConsumption }));
  }, []);

  const updateSearchTerm = useCallback((term: string) => {
    setFilters(prev => ({ ...prev, searchTerm: term }));
  }, []);

  const updateSorting = useCallback((sortBy: FilterState['sortBy'], sortOrder: FilterState['sortOrder']) => {
    setFilters(prev => ({ ...prev, sortBy, sortOrder }));
  }, []);

  const selectAll = useCallback(() => {
    const allIds = filteredBaseProducts.map(bp => bp.id);
    updateSelectedBaseIds(allIds);
  }, [filteredBaseProducts, updateSelectedBaseIds]);

  const clearSelection = useCallback(() => {
    updateSelectedBaseIds([]);
  }, [updateSelectedBaseIds]);

  const resetFilters = useCallback(() => {
    setFilters({
      selectedBaseIds: [],
      excludeZeroConsumption: false,
      searchTerm: '',
      sortBy: 'name',
      sortOrder: 'asc'
    });
  }, []);

  return {
    filters,
    filteredBaseProducts,
    updateSelectedBaseIds,
    toggleExcludeZeroConsumption,
    updateSearchTerm,
    updateSorting,
    selectAll,
    clearSelection,
    resetFilters
  };
}
