
"use client"

import { useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { AverageConsumptionChart } from "./average-consumption-chart";
import { ConsumptionHistoryModal } from './consumption-history-modal';
import { ConsumptionImportModal } from './consumption-import-modal';
import { Button } from './ui/button';
import { useValidatedConsumptionData } from '@/hooks/useValidatedConsumptionData';
import { useKiosks } from '@/hooks/use-kiosks';
import { FileClock, Upload, Wand2, Download, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { format, parseISO, isWithinInterval, startOfMonth, endOfMonth, addMonths } from 'date-fns';
import { z } from 'zod';
import { useToast } from '@/hooks/use-toast';
import { type ConsumptionAnalysisOutputSchema } from '@/ai/flows/consumption-schemas';
import { AiAnalysisModal } from './ai-analysis-modal';
import { AiAnalysisSetupModal } from './ai-analysis-setup-modal';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';

const stdDev = (arr: number[]): number => {
    if (arr.length === 0) return 0;
    const mean = arr.reduce((a, b) => a + b) / arr.length;
    return Math.sqrt(arr.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / arr.length);
};

export function ConsumptionAnalysisDashboard() {
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const { reports, baseProducts, isLoading, addReport, deleteReport } = useValidatedConsumptionData();
  const { kiosks } = useKiosks();
  const { permissions } = useAuth();
  const { toast } = useToast();

  // AI-related state moved from AverageConsumptionChart
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [isAiSetupModalOpen, setIsAiSetupModalOpen] = useState(false);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiAnalysisResult, setAiAnalysisResult] = useState<z.infer<typeof ConsumptionAnalysisOutputSchema> | null>(null);
  const [lastAnalysisParams, setLastAnalysisParams] = useState<{kioskName: string, period: string} | null>(null);
  
  const handleTriggerAiAnalysis = async (params: { kioskId: string; startPeriod: string; endPeriod: string }) => {
        const { kioskId, startPeriod, endPeriod } = params;

        setIsAiSetupModalOpen(false); // Close setup modal
        setIsAiLoading(true);
        setIsAiModalOpen(true);
        setAiAnalysisResult(null);

        const kioskFilteredReports = kioskId === 'all' 
            ? reports 
            : reports.filter(r => r.kioskId === kioskId);
        
        const kioskName = kioskId === 'all' ? 'Todas as Unidades' : (kiosks.find(k => k.id === kioskId)?.name || 'N/A');
        const period = `${startPeriod} a ${endPeriod}`;
        setLastAnalysisParams({ kioskName, period });

        const [startYear, startMonth] = startPeriod.split('-').map(Number);
        const [endYear, endMonth] = endPeriod.split('-').map(Number);
        const start = startOfMonth(new Date(startYear, startMonth - 1, 1));
        const end = endOfMonth(new Date(endYear, endMonth - 1, 1));

        const analysisInput = {
            kioskName,
            period,
            items: baseProducts.map(bp => {
                 const histReports = kioskFilteredReports.filter(r => r.results.some(res => res.baseProductId === bp.id));
                 const totalHistConsumption = histReports.reduce((sum, r) => sum + (r.results.find(res => res.baseProductId === bp.id)?.consumedQuantity || 0), 0);
                 const histAvg = histReports.length > 0 ? totalHistConsumption / histReports.length : 0;
                 
                 const reportsInPeriod = histReports.filter(r => {
                    const reportDate = new Date(r.year, r.month - 1, 1);
                    return isWithinInterval(reportDate, { start, end });
                 });
                 const totalPeriodConsumption = reportsInPeriod.reduce((sum, r) => sum + (r.results.find(res => res.baseProductId === bp.id)?.consumedQuantity || 0), 0);
                 const periodAvg = reportsInPeriod.length > 0 ? totalPeriodConsumption / reportsInPeriod.length : 0;
                 
                 const monthlyValues = reportsInPeriod.map(r => r.results.find(res => res.baseProductId === bp.id)?.consumedQuantity || 0);

                 let volatility: 'Alta' | 'Média' | 'Baixa' | 'N/A' = 'N/A';
                 if(histAvg > 0) {
                     const dev = stdDev(monthlyValues);
                     const cv = dev / histAvg;
                     if (cv > 0.5) volatility = 'Alta';
                     else if (cv > 0.2) volatility = 'Média';
                     else volatility = 'Baixa';
                 }

                return {
                    name: bp.name,
                    unit: bp.unit,
                    series: reportsInPeriod.map(r => ({ label: `${r.month}/${r.year}`, value: r.results.find(res => res.baseProductId === bp.id)?.consumedQuantity || 0 })),
                    periodAvg,
                    histAvg,
                    volatility,
                };
            }).filter(item => item.histAvg > 0 || item.periodAvg > 0)
        };
        
        try {
            const response = await fetch('/api/ai/analyze-consumption', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(analysisInput),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            setAiAnalysisResult(result);
        } catch (error: any) {
            console.error("AI Analysis failed:", error);
            toast({
                variant: "destructive",
                title: "Erro na Análise",
                description: error.message || "Não foi possível obter a análise da IA. Tente novamente.",
            });
            setIsAiModalOpen(false);
        } finally {
            setIsAiLoading(false);
        }
    };


  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                  <CardTitle>Consumo médio</CardTitle>
                  <CardDescription>Visualize o consumo médio dos seus insumos.</CardDescription>
              </div>
              <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setIsHistoryOpen(true)}>
                      <FileClock className="mr-2 h-4 w-4" />
                      Histórico de análises
                  </Button>
                  <Button onClick={() => setIsAiSetupModalOpen(true)}>
                    <Wand2 className="mr-2 h-4 w-4"/> Analisar com IA
                  </Button>
              </div>
          </div>
        </CardHeader>
        <CardContent>
           <AverageConsumptionChart />
        </CardContent>
         {permissions.stock.analysis.consumption && (
            <CardFooter className="border-t pt-4">
                <Button onClick={() => setIsImportOpen(true)} variant="secondary">
                    <Upload className="mr-2 h-4 w-4" />
                    Importar novo relatório de vendas
                </Button>
            </CardFooter>
        )}
      </Card>
        
        <ConsumptionHistoryModal 
            open={isHistoryOpen}
            onOpenChange={setIsHistoryOpen}
            history={reports}
            loading={isLoading}
            deleteReport={deleteReport}
        />
        
        <ConsumptionImportModal 
            open={isImportOpen}
            onOpenChange={setIsImportOpen}
            kiosks={kiosks}
            addReport={addReport}
        />

        <AiAnalysisSetupModal
            open={isAiSetupModalOpen}
            onOpenChange={setIsAiSetupModalOpen}
            onConfirm={handleTriggerAiAnalysis}
            isLoading={isAiLoading}
        />
        
        <AiAnalysisModal
            open={isAiModalOpen}
            onOpenChange={setIsAiModalOpen}
            isLoading={isAiLoading}
            analysisResult={aiAnalysisResult}
            analysisParams={lastAnalysisParams}
        />
    </div>
  )
}
