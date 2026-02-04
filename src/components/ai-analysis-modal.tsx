'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Sparkles, Lightbulb, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react';
import { InsightSchema } from '@/ai/flows/consumption-schemas';
import { z } from 'zod';

interface AiAnalysisModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    isLoading: boolean;
    analysisResult: z.infer<typeof InsightSchema>[] | null;
    summary: string | null;
}

const iconMap = {
    positive: <TrendingUp className="h-4 w-4 text-green-500" />,
    negative: <TrendingDown className="h-4 w-4 text-red-500" />,
    neutral: <Lightbulb className="h-4 w-4 text-blue-500" />,
    alert: <AlertTriangle className="h-4 w-4 text-yellow-500" />,
};

export function AiAnalysisModal({ open, onOpenChange, isLoading, analysisResult, summary }: AiAnalysisModalProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Sparkles className="text-primary" /> Análise de Consumo por IA
                    </DialogTitle>
                    <DialogDescription>
                        Insights gerados para otimizar seu estoque e identificar tendências.
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4 max-h-[60vh]">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                            <Loader2 className="h-8 w-8 animate-spin mb-4" />
                            <p>Analisando dados... Isso pode levar um momento.</p>
                        </div>
                    ) : (
                        <ScrollArea className="h-full pr-4">
                            <div className="space-y-6">
                                {summary && (
                                    <div>
                                        <h3 className="font-semibold mb-2">Resumo Executivo</h3>
                                        <p className="text-sm text-muted-foreground bg-muted p-3 rounded-lg">{summary}</p>
                                    </div>
                                )}

                                {analysisResult && analysisResult.length > 0 && (
                                    <div>
                                        <h3 className="font-semibold mb-3">Principais Insights</h3>
                                        <div className="space-y-4">
                                            {analysisResult.map((insight, index) => (
                                                <div key={index} className="flex items-start gap-4 p-4 border rounded-lg">
                                                    <div className="mt-1">{iconMap[insight.type]}</div>
                                                    <div>
                                                        <p className="font-semibold">{insight.title}</p>
                                                        <p className="text-sm text-muted-foreground">{insight.description}</p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </ScrollArea>
                    )}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
