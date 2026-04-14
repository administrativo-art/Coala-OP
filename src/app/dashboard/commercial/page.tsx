"use client";

import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PricingDashboard } from "@/components/pricing-dashboard";
import { TechnicalSheetDashboard } from "@/components/technical-sheet-dashboard";
import { useProductSimulation } from "@/hooks/use-product-simulation";
import { useProductSimulationCategories } from "@/hooks/use-product-simulation-categories";
import { useCompanySettings } from "@/hooks/use-company-settings";
import { DollarSign, FileText, Target } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { type ProductSimulation } from "@/types";

// ─── Pricing Component ────────────────────────────────────────────────────────

function PricingReportDashboard() {
  const { simulations, loading: loadingSimulations } = useProductSimulation();
  const { categories, loading: loadingCategories } = useProductSimulationCategories();
  const { pricingParameters, loading: loadingParams } = useCompanySettings();

  const [chartFilter, setChartFilter] = useState('all');

  const activeSimulations = useMemo(() => simulations, [simulations]);

  const getProfitColorClass = (percentage: number) => {
    if (!pricingParameters?.profitRanges) return 'text-primary';
    const sortedRanges = [...pricingParameters.profitRanges].sort((a, b) => a.from - b.from);
    for (const range of sortedRanges) {
      if (percentage >= range.from && (range.to === Infinity || percentage < range.to)) {
        return range.color;
      }
    }
    return 'text-primary';
  };

  const { kpis, profitChartData } = useMemo(() => {
    if (!activeSimulations || activeSimulations.length === 0) {
        return { kpis: {}, profitChartData: [] };
    }

    const filteredSimulations = activeSimulations.filter(s => {
        if (chartFilter === 'all') return true;
        const [type, id] = chartFilter.split(':');
        if (type === 'category') return s.categoryIds.includes(id);
        if (type === 'line') return s.lineId === id;
        return false;
    });

    const totalSimulations = activeSimulations.length;
    const totalProfitPercentage = filteredSimulations.reduce((acc, s) => acc + s.profitPercentage, 0);
    const averageProfitPercentage = filteredSimulations.length > 0 ? totalProfitPercentage / filteredSimulations.length : 0;

    const itemsWithGoal = filteredSimulations.filter(s => s.profitGoal != null && s.profitGoal > 0);
    const itemsMeetingGoal = itemsWithGoal.filter(s => s.profitPercentage >= s.profitGoal!);
    const itemsBelowGoal = itemsWithGoal.filter(s => s.profitPercentage < s.profitGoal!);

    let highestMarginItem: ProductSimulation | undefined = filteredSimulations[0];
    let lowestMarginItem: ProductSimulation | undefined = filteredSimulations[0];

    for (const s of filteredSimulations) {
        if (s.profitPercentage > (highestMarginItem?.profitPercentage || -Infinity)) highestMarginItem = s;
        if (s.profitPercentage < (lowestMarginItem?.profitPercentage || Infinity)) lowestMarginItem = s;
    }

    const totalMarkup = filteredSimulations.reduce((acc, s) => acc + s.markup, 0);

    const priceDeltas = itemsBelowGoal.map(s => {
        const priceForGoal = s.totalCmv / (1 - ((pricingParameters?.averageTaxPercentage || 0) / 100) - ((pricingParameters?.averageCardFeePercentage || 0) / 100) - (s.profitGoal! / 100));
        return priceForGoal - s.salePrice;
    });

    const averagePriceDelta = priceDeltas.length > 0 ? priceDeltas.reduce((acc, delta) => acc + delta, 0) / priceDeltas.length : 0;
    
    const categoryCounts: { [name: string]: number } = {};
    const lineCounts: { [name: string]: number } = {};

    activeSimulations.forEach(s => { 
        s.categoryIds.forEach(catId => {
            const category = categories.find(c => c.id === catId);
            if (category && category.type === 'category') {
                categoryCounts[category.name] = (categoryCounts[category.name] || 0) + 1;
            }
        });
        if (s.lineId) {
            const line = categories.find(c => c.id === s.lineId);
            if (line && line.type === 'line') {
                lineCounts[line.name] = (lineCounts[line.name] || 0) + 1;
            }
        }
    });

    const kpisResult = {
        totalSimulations,
        averageProfitPercentage,
        itemsMeetingGoal,
        itemsBelowGoal,
        highestMarginItem,
        lowestMarginItem,
        averageMarkup: filteredSimulations.length > 0 ? totalMarkup / filteredSimulations.length : 0,
        averagePriceDelta: averagePriceDelta,
        categoryCounts,
        lineCounts
    };

    const profitChartDataResult = filteredSimulations
        .map(s => ({
            id: s.id,
            name: s.name,
            'Lucro %': s.profitPercentage,
        }))
        .sort((a, b) => a['Lucro %'] - b['Lucro %']);

    return { kpis: kpisResult, profitChartData: profitChartDataResult };
  }, [activeSimulations, categories, chartFilter, pricingParameters]);

  const activeFilters = {
    categoryName: null,
    lineName: null,
    profitGoalFilter: 'all',
    statusFilter: 'all'
  };

  return (
    <PricingDashboard 
      simulations={activeSimulations} 
      categories={categories}
      isLoading={loadingSimulations || loadingParams || loadingCategories}
      getProfitColorClass={getProfitColorClass}
      pricingParameters={pricingParameters}
      activeFilters={activeFilters}
      kpis={kpis}
      profitChartData={profitChartData}
      chartFilter={chartFilter}
      setChartFilter={setChartFilter}
    />
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CommercialPage() {
  const { permissions } = useAuth();

  if (!permissions.dashboard?.view) {
    return <p className="text-muted-foreground p-6">Sem permissão para acessar o Painel Comercial.</p>;
  }

  const getDefaultTab = () => {
    if (permissions.dashboard.pricing) return 'pricing';
    if (permissions.dashboard.technicalSheets) return 'technical-sheets';
    return 'pricing';
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Painel Comercial</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gestão de preços, rentabilidade, simulações e metas de venda.
          </p>
        </div>
        {permissions.goals?.view && (
          <Link 
            href="/dashboard/goals/tracking" 
            className="flex items-center gap-2 rounded-lg border bg-card px-4 py-2.5 text-sm font-medium shadow-sm transition-colors hover:bg-muted"
          >
            <Target className="h-4 w-4 text-emerald-500" /> Consultar Metas Mês a Mês
          </Link>
        )}
      </div>

      {/* Tabs */}
      <Tabs defaultValue={getDefaultTab()} className="w-full">
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 lg:grid-cols-6">
          {permissions.dashboard.pricing && (
            <TabsTrigger value="pricing" className="gap-2">
              <DollarSign className="h-4 w-4" /> Gestão de Preços
            </TabsTrigger>
          )}
          {permissions.dashboard.technicalSheets && (
            <TabsTrigger value="technical-sheets" className="gap-2">
              <FileText className="h-4 w-4" /> Fichas Técnicas
            </TabsTrigger>
          )}
        </TabsList>

        {permissions.dashboard.pricing && (
          <TabsContent value="pricing" className="mt-6">
            <PricingReportDashboard />
          </TabsContent>
        )}
        
        {permissions.dashboard.technicalSheets && (
          <TabsContent value="technical-sheets" className="mt-6">
            <TechnicalSheetDashboard />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
