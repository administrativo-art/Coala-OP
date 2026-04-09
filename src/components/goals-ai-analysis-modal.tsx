'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Sparkles, TrendingUp, Users, Target, CheckCircle2, AlertCircle, Zap } from 'lucide-react';
import { z } from 'zod';
import { GoalsAnalysisOutputSchema } from '@/ai/flows/goals-schemas';
import { Separator } from './ui/separator';
import { Badge } from './ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

interface GoalsAiAnalysisModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isLoading: boolean;
  analysisResult: z.infer<typeof GoalsAnalysisOutputSchema> | null;
  analysisParams: { kioskName: string; period: string; goalType: string } | null;
}

export function GoalsAiAnalysisModal({ open, onOpenChange, isLoading, analysisResult, analysisParams }: GoalsAiAnalysisModalProps) {
  
  const fmt = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  
  const getProbabilityColor = (p: number) => {
    if (p >= 80) return 'text-green-500';
    if (p >= 50) return 'text-amber-500';
    return 'text-red-500';
  };

  const getImpactBadge = (impact: string) => {
    switch (impact) {
      case 'High': return <Badge variant="destructive">Alto Impacto</Badge>;
      case 'Medium': return <Badge variant="secondary">Médio Impacto</Badge>;
      default: return <Badge variant="outline">Baixo Impacto</Badge>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[85vh] flex flex-col p-0">
        <div className="p-6 border-b">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Sparkles className="text-primary h-6 w-6" /> Análise Inteligente de Metas
            </DialogTitle>
            <DialogDescription>
              Diagnóstico executivo baseado nos 8 pilares operacionais para {analysisParams?.kioskName} ({analysisParams?.period}).
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="flex-1 overflow-hidden">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground bg-muted/5">
              <Loader2 className="h-10 w-10 animate-spin mb-4 text-primary" />
              <p className="text-lg font-medium">Processando montanhas de dados...</p>
              <p className="text-sm opacity-70">A IA está calculando pace, projeções e rankings de equipe.</p>
            </div>
          ) : analysisResult ? (
            <ScrollArea className="h-full">
              <div className="p-6 space-y-8 pb-10">
                
                {/* ── SEÇÃO 1: RESUMO E PROBABILIDADE ── */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <Card className="md:col-span-2 border-primary/20 bg-primary/5">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-primary" /> Sumário Executivo
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm leading-relaxed text-foreground/90">
                        {analysisResult.summary}
                      </p>
                    </CardContent>
                  </Card>
                  
                  <Card className="flex flex-col items-center justify-center text-center p-6 border-primary/20">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-1">Chance de Sucesso</span>
                    <span className={`text-5xl font-black tabular-nums ${getProbabilityColor(analysisResult.probabilityOfSuccess)}`}>
                      {analysisResult.probabilityOfSuccess}%
                    </span>
                    <div className="w-full bg-muted h-2 rounded-full mt-4 overflow-hidden">
                      <div 
                        className={`h-full transition-all duration-1000 ${analysisResult.probabilityOfSuccess >= 80 ? 'bg-green-500' : analysisResult.probabilityOfSuccess >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                        style={{ width: `${analysisResult.probabilityOfSuccess}%` }}
                      />
                    </div>
                  </Card>
                </div>

                {/* ── SEÇÃO 2: PACE E PROJEÇÃO ── */}
                <div className="space-y-4">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-blue-500" /> Diagnóstico de Pace e Projeção
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="p-3 border rounded-lg bg-card">
                      <p className="text-[10px] text-muted-foreground uppercase">Média Atual</p>
                      <p className="text-lg font-bold">R$ {fmt(analysisResult.paceAnalysis.currentPace)}</p>
                    </div>
                    <div className="p-3 border rounded-lg bg-card border-blue-500/30">
                      <p className="text-[10px] text-muted-foreground uppercase">Pace Necessário (Base)</p>
                      <p className="text-lg font-bold text-blue-600">R$ {fmt(analysisResult.paceAnalysis.requiredPace)}</p>
                    </div>
                    <div className="p-3 border rounded-lg bg-card border-violet-500/30">
                      <p className="text-[10px] text-muted-foreground uppercase">Pace Necessário (UP)</p>
                      <p className="text-lg font-bold text-violet-600">R$ {fmt(analysisResult.paceAnalysis.requiredUpPace)}</p>
                    </div>
                    <div className="p-3 border rounded-lg bg-card border-emerald-500/30">
                      <p className="text-[10px] text-muted-foreground uppercase">Projeção Final</p>
                      <p className="text-lg font-bold text-emerald-600">R$ {fmt(analysisResult.paceAnalysis.projectedEndValue)}</p>
                    </div>
                  </div>
                  <div className="bg-muted/30 p-4 rounded-lg border border-dashed text-sm italic">
                    {analysisResult.paceAnalysis.diagnosis}
                  </div>
                </div>

                {/* ── SEÇÃO 3: INSIGHTS DE EQUIPE ── */}
                <div className="space-y-4">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                    <Users className="h-4 w-4 text-orange-500" /> Insights de Time e Performance
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {analysisResult.teamInsights.map((insight, idx) => (
                      <div key={idx} className="p-4 border rounded-xl space-y-2 hover:bg-muted/10 transition-colors">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-2">
                             <Target className="h-4 w-4 text-muted-foreground" />
                             <span className="text-xs font-semibold text-muted-foreground">{insight.category}</span>
                          </div>
                          {getImpactBadge(insight.impact)}
                        </div>
                        <h4 className="font-bold text-base leading-tight">{insight.title}</h4>
                        <p className="text-sm text-muted-foreground leading-snug">{insight.description}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* ── SEÇÃO 4: RECOMENDAÇÕES EXECUTIVAS ── */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t">
                   <div className="space-y-4">
                      <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 text-primary" /> Recomendações (Ação Imediata)
                      </h3>
                      <ul className="space-y-3">
                        {analysisResult.recommendations.map((rec, idx) => (
                          <li key={idx} className="flex gap-3 text-sm">
                            <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                              <Zap className="h-3 w-3 text-primary" />
                            </div>
                            <span className="leading-tight">{rec}</span>
                          </li>
                        ))}
                      </ul>
                   </div>
                   <div className="space-y-4">
                      <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-muted-foreground" /> Leitura Operacional
                      </h3>
                      <div className="p-4 rounded-lg bg-muted/40 text-sm leading-relaxed border">
                        {analysisResult.operationalInsights}
                      </div>
                   </div>
                </div>

              </div>
            </ScrollArea>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              Nenhuma análise gerada.
            </div>
          )}
        </div>

        <DialogFooter className="p-6 border-t bg-muted/5">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar diagnóstico</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
