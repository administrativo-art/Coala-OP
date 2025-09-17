
"use client";

import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PriceComparisonTable } from '@/components/price-comparison-table';
import { CompetitorManagementModal } from '@/components/competitor-management-modal';
import { CompetitorProductManagementModal } from '@/components/competitor-product-management-modal';
import { ArrowLeft, LineChart, PlusCircle, Users, History, Wand2 } from 'lucide-react';
import Link from 'next/link';
import { useCompetitors } from '@/hooks/use-competitors';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import jsPDF from 'jspdf';
import { Skeleton } from '@/components/ui/skeleton';

interface AIAnalysis {
    id: string;
    createdAt: string;
    competitorsAnalyzed: string[];
    content: string;
}

export default function PriceComparisonPage() {
  const [isCompetitorModalOpen, setIsCompetitorModalOpen] = useState(false);
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const { competitors, loading: loadingCompetitors } = useCompetitors();
  const [selectedCompetitorIds, setSelectedCompetitorIds] = useState<string[]>([]);
  const [aiAnalyses, setAiAnalyses] = useState<AIAnalysis[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  const handleCompetitorSelection = (competitorId: string) => {
    setSelectedCompetitorIds(prev => 
        prev.includes(competitorId) 
        ? prev.filter(id => id !== competitorId)
        : [...prev, competitorId]
    );
  };
  
  const handleAnalyze = async (data: any) => {
      // This is a placeholder for the actual AI flow call.
      setIsAnalyzing(true);
      
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const newAnalysis: AIAnalysis = {
          id: `analise-${Date.now()}`,
          createdAt: new Date().toISOString(),
          competitorsAnalyzed: selectedCompetitorIds.map(id => competitors.find(c => c.id === id)?.name || ''),
          content: `Análise simulada com base nos dados fornecidos. O competidor ${selectedCompetitorIds[0]} parece ter preços mais agressivos em milkshakes, enquanto você tem vantagem em sucos. Recomenda-se ajustar a margem do produto X em 5% para se manter competitivo.\n\nDados analisados:\n${JSON.stringify(data, null, 2)}`
      };
      
      setAiAnalyses(prev => [newAnalysis, ...prev]);
      setIsAnalyzing(false);
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
            <CardTitle className="flex items-center gap-2">
                <LineChart />
                Estudo de preço
            </CardTitle>
            <CardDescription>
                Compare os preços das suas mercadorias com os da concorrência para se manter competitivo.
            </CardDescription>
             <div className="flex justify-between items-center gap-2 pt-4">
                 <div className="flex flex-wrap gap-2">
                    {loadingCompetitors ? (
                        <Skeleton className="h-10 w-48" />
                    ) : (
                        competitors.map(c => (
                            <Button
                                key={c.id}
                                variant={selectedCompetitorIds.includes(c.id) ? "default" : "outline"}
                                onClick={() => handleCompetitorSelection(c.id)}
                            >
                                {c.name}
                            </Button>
                        ))
                    )}
                 </div>
                 <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setIsProductModalOpen(true)}>
                        <PlusCircle className="mr-2 h-4 w-4" /> Mercadorias dos concorrentes
                    </Button>
                    <Button onClick={() => setIsCompetitorModalOpen(true)}>
                        <Users className="mr-2 h-4 w-4" /> Gerenciar concorrentes
                    </Button>
                </div>
            </div>
        </CardHeader>
        <CardContent className="space-y-4">
            <PriceComparisonTable 
              selectedCompetitorIds={selectedCompetitorIds} 
              onAnalyze={handleAnalyze}
              isAnalyzing={isAnalyzing}
            />
        </CardContent>
      </Card>
      
        {aiAnalyses.length > 0 && (
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
                                    <Button variant="outline" size="sm" onClick={() => handleExportAnalysisPdf(analysis)}>
                                      Exportar Análise em PDF
                                    </Button>
                                </AccordionContent>
                            </AccordionItem>
                        ))}
                    </Accordion>
                </CardContent>
            </Card>
        )}
        
        <CompetitorManagementModal
            isOpen={isCompetitorModalOpen}
            onClose={() => setIsCompetitorModalOpen(false)}
        />
         <CompetitorProductManagementModal
            isOpen={isProductModalOpen}
            onClose={() => setIsProductModalOpen(false)}
        />
    </div>
  );
}
