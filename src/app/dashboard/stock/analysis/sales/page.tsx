"use client";

import { BackButton } from '@/components/navigation/back-button';
import { SalesAnalysisDashboard } from '@/components/sales-analysis-dashboard';

export default function SalesAnalysisPage() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 mb-2">
        <BackButton fallbackHref="/dashboard/stock" label="Voltar para gestão de estoque" />
      </div>
      <div className="space-y-1 mb-6">
        <h1 className="text-3xl font-bold">Análise de vendas</h1>
        <p className="text-sm text-muted-foreground">Visualize o ranking, tendências e comparativos de vendas brutas.</p>
      </div>
      <SalesAnalysisDashboard />
    </div>
  );
}
