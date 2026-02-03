'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { type AnalyzeConsumptionOutput } from '@/ai/flows/analyze-consumption-flow';
import { Lightbulb, TrendingDown, TrendingUp, Check, Bot } from 'lucide-react';

interface AiAnalysisModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: AnalyzeConsumptionOutput | null;
  isLoading: boolean;
}

function LoadingState() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-16 w-full" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
      <Skeleton className="h-24 w-full" />
    </div>
  )
}

export function AiAnalysisModal({ open, onOpenChange, result, isLoading }: AiAnalysisModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot /> Análise de Consumo por IA
          </DialogTitle>
          <DialogDescription>
            Insights e recomendações geradas com base nos dados do período selecionado.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-auto pr-4 -mr-4">
          <ScrollArea className="h-full pr-2">
            <div className="py-4">
              {isLoading ? (
                <LoadingState />
              ) : !result ? (
                <p>Nenhuma análise gerada.</p>
              ) : (
                <div className="space-y-6">
                  <Card className="bg-primary/5 border-primary/20">
                    <CardHeader>
                      <CardTitle className="text-lg">Resumo Executivo</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-foreground">{result.executiveSummary}</p>
                    </CardContent>
                  </Card>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2"><Lightbulb /> Principais Insights</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="space-y-3">
                          {result.keyInsights.map((insight, index) => (
                            <li key={index} className="flex items-start gap-3">
                              <span className="text-lg mt-0.5">{insight.emoji}</span>
                              <span>{insight.text}</span>
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2"><Check /> Recomendações</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="space-y-3">
                           {result.recommendations.map((rec, index) => (
                            <li key={index} className="flex items-start gap-3">
                              <span className="text-lg mt-0.5">{rec.emoji}</span>
                              <span>{rec.text}</span>
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  </div>
                  
                  <Card>
                      <CardHeader>
                          <CardTitle className="text-lg">Maiores Variações</CardTitle>
                      </CardHeader>
                      <CardContent className="grid grid-cols-2 gap-4">
                          <div>
                            <h4 className="font-semibold flex items-center gap-2 mb-2"><TrendingUp className="text-destructive"/> Maiores Aumentos</h4>
                            <div className="flex flex-wrap gap-2">
                              {result.topMovers.highestIncrease.map(name => <Badge key={name} variant="destructive" className="bg-red-100 text-red-800">{name}</Badge>)}
                            </div>
                          </div>
                           <div>
                            <h4 className="font-semibold flex items-center gap-2 mb-2"><TrendingDown className="text-green-600"/> Maiores Quedas</h4>
                            <div className="flex flex-wrap gap-2">
                               {result.topMovers.highestDecrease.map(name => <Badge key={name} variant="secondary" className="bg-green-100 text-green-800">{name}</Badge>)}
                            </div>
                          </div>
                      </CardContent>
                  </Card>

                </div>
              )}
            </div>
          </ScrollArea>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
