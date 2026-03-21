"use client";

import { SalesAnalysisDashboard } from '@/components/sales-analysis-dashboard';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function SalesAnalysisPage() {
  const router = useRouter();
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 mb-2">
        <Button 
          variant="outline" 
          onClick={() => router.push('/dashboard/stock')}
        >
          <ArrowLeft className="mr-2 h-4 w-4" /> Voltar para gestão de estoque
        </Button>
      </div>
      <div className="space-y-1 mb-6">
        <h1 className="text-3xl font-bold">Análise de vendas</h1>
        <p className="text-sm text-muted-foreground">Visualize o ranking, tendências e comparativos de vendas brutas.</p>
      </div>
      <SalesAnalysisDashboard />
    </div>
  );
}
