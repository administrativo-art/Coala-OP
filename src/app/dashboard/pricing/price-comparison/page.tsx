"use client";

import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PriceComparisonTable } from '@/components/price-comparison-table';
import { CompetitorManagementModal } from '@/components/competitor-management-modal';
import { CompetitorProductManagementModal } from '@/components/competitor-product-management-modal';
import { ArrowLeft, LineChart, Wand2, Group, Users, History, Menu, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useCompetitors } from '@/hooks/use-competitors';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import jsPDF from 'jspdf';
import { Skeleton } from '@/components/ui/skeleton';
import { CompetitorSelectionModal } from '@/components/competitor-selection-modal';
import { Badge } from '@/components/ui/badge';
import { X } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { analyzePrices, type PriceAnalysisInput } from '@/ai/flows/price-comparison-flow';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';


interface AIAnalysis {
    id: string;
    createdAt: string;
    competitorsAnalyzed: string[];
    content: string;
}

export default function PriceComparisonPage() {
  const [isCompetitorModalOpen, setIsCompetitorModalOpen] = useState(false);
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [isSelectionModalOpen, setIsSelectionModalOpen] = useState(false);
  const { competitors, loading: loadingCompetitors } = useCompetitors();
  const [selectedCompetitorIds, setSelectedCompetitorIds] = useState<string[]>([]);
  const [aiAnalyses, setAiAnalyses] = useState<AIAnalysis[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  const handleAnalyze = async (data: any) => {
      setIsAnalyzing(true);
      
      try {
        const analysisResult = await analyzePrices(data as PriceAnalysisInput);

        const newAnalysis: AIAnalysis = {
            id: `analise-${Date.now()}`,
            createdAt: new Date().toISOString(),
            competitorsAnalyzed: selectedCompetitorIds.map(id => competitors.find(c => c.id === id)?.name || ''),
            content: analysisResult.analysis,
        };
        setAiAnalyses(prev => [newAnalysis, ...prev]);

      } catch (error) {
          console.error("Failed to analyze prices:", error);
      } finally {
        setIsAnalyzing(false);
      }
  };

  const handleDeleteAnalysis = (analysisId: string) => {
    setAiAnalyses(prev => prev.filter(a => a.id !== analysisId));
  };
  
   const handleExportAnalysisPdf = (analysis: AIAnalysis) => {
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text(`Análise de IA - ${format(parseISO(analysis.createdAt), "dd/MM/yyyy")}`, 14, 22);
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Concorrentes: ${analysis.competitorsAnalyzed.join(', ')}`, 14, 29);
    
    const splitContent = doc.splitTextToSize(analysis.content, 180);
    doc.text(splitContent, 14, 40);
    
    doc.save(`analise_ia_${analysis.id}.pdf`);
  };

  const selectedCompetitors = useMemo(() => {
    return competitors.filter(c => selectedCompetitorIds.includes(c.id));
  }, [selectedCompetitorIds, competitors]);

  const handleRemoveCompetitor = (competitorId: string) => {
      setSelectedCompetitorIds(prev => prev.filter(id => id !== competitorId));
  };

  return (
    <div className="space-y-6">
       <Link href="/dashboard/pricing" className="inline-block">
        <Button variant="outline">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar para custo e preço
        </Button>
      </Link>
      <Card>
        <CardHeader>
            <div className="flex justify-between items-start">
              <div>
                <CardTitle className="flex items-center gap-2">
                    <LineChart />
                    Estudo de preço
                </CardTitle>
                <CardDescription>
                    Compare os preços das suas mercadorias com os da concorrência para se manter competitivo.
                </CardDescription>
              </div>
               <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon">
                    <Menu className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setIsSelectionModalOpen(true)}>
                    <Wand2 className="mr-2 h-4 w-4" />
                    Realizar análise
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setIsProductModalOpen(true)}>
                    <Group className="mr-2 h-4 w-4" />
                    Mercadorias dos Concorrentes
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setIsCompetitorModalOpen(true)}>
                    <Users className="mr-2 h-4 w-4" />
                    Gerenciar Concorrentes
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
        </CardHeader>
        <CardContent className="space-y-4">
            <Tabs defaultValue="comparison">
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="comparison">Análise Comparativa</TabsTrigger>
                    <TabsTrigger value="history">Histórico de Análises</TabsTrigger>
                </TabsList>
                <TabsContent value="comparison" className="mt-4">
                    <PriceComparisonTable 
                      selectedCompetitorIds={selectedCompetitorIds} 
                      onAnalyze={handleAnalyze}
                      isAnalyzing={isAnalyzing}
                    />
                </TabsContent>
                <TabsContent value="history" className="mt-4">
                    {aiAnalyses.length > 0 ? (
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <History /> Histórico de Análises de IA
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <Accordion type="single" collapsible className="w-full">
                                    {aiAnalyses.map(analysis => (
                                        <AccordionItem key={analysis.id} value={analysis.id}>
                                            <AccordionTrigger>
                                                Análise de {format(parseISO(analysis.createdAt), "dd/MM/yyyy 'às' HH:mm")}
                                            </AccordionTrigger>
                                            <AccordionContent className="space-y-4">
                                                <pre className="p-4 bg-muted rounded-md text-sm whitespace-pre-wrap font-sans">{analysis.content}</pre>
                                                <div className="flex gap-2">
                                                    <Button variant="outline" size="sm" onClick={() => handleExportAnalysisPdf(analysis)}>
                                                      Exportar Análise em PDF
                                                    </Button>
                                                     <Button variant="destructive" size="sm" onClick={() => handleDeleteAnalysis(analysis.id)}>
                                                      <Trash2 className="mr-2 h-4 w-4" /> Excluir Análise
                                                    </Button>
                                                </div>
                                            </AccordionContent>
                                        </AccordionItem>
                                    ))}
                                </Accordion>
                            </CardContent>
                        </Card>
                    ) : (
                        <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
                           <p>Nenhuma análise de IA foi realizada ainda.</p>
                        </div>
                    )}
                </TabsContent>
            </Tabs>
        </CardContent>
      </Card>
        
        <CompetitorManagementModal
            isOpen={isCompetitorModalOpen}
            onClose={() => setIsCompetitorModalOpen(false)}
        />
         <CompetitorProductManagementModal
            isOpen={isProductModalOpen}
            onClose={() => setIsProductModalOpen(false)}
        />
        <CompetitorSelectionModal
            isOpen={isSelectionModalOpen}
            onClose={() => setIsSelectionModalOpen(false)}
            selectedCompetitorIds={selectedCompetitorIds}
            setSelectedCompetitorIds={setSelectedCompetitorIds}
        />
    </div>
  );
}
