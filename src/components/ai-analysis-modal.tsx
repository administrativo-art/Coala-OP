'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Sparkles, Download } from 'lucide-react';
import { ConsumptionAnalysisOutputSchema } from '@/ai/flows/consumption-schemas';
import { z } from 'zod';
import { Separator } from './ui/separator';
import dynamic from 'next/dynamic';
import { AiAnalysisDocument } from './pdf/AiAnalysisDocument';

const PDFDownloadLink = dynamic(
  () => import('@react-pdf/renderer').then(mod => mod.PDFDownloadLink),
  { ssr: false, loading: () => <Button variant="outline" disabled><Loader2 className="mr-2 h-4 w-4 animate-spin"/>Gerando...</Button> }
);


interface AiAnalysisModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    isLoading: boolean;
    analysisResult: z.infer<typeof ConsumptionAnalysisOutputSchema> | null;
    analysisParams: { kioskName: string; period: string; } | null;
}

export function AiAnalysisModal({ open, onOpenChange, isLoading, analysisResult, analysisParams }: AiAnalysisModalProps) {
    const detailedAnalysis = analysisResult?.detailedAnalysis;
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Sparkles className="text-primary" /> Análise de Consumo por IA
                    </DialogTitle>
                    <DialogDescription>
                        Análise detalhada do comportamento de consumo de cada insumo no período selecionado.
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4 flex-1 overflow-auto">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                            <Loader2 className="h-8 w-8 animate-spin mb-4" />
                            <p>Analisando dados... Isso pode levar um momento.</p>
                        </div>
                    ) : (
                        <ScrollArea className="h-full pr-4">
                            <div className="space-y-6">
                                {detailedAnalysis && detailedAnalysis.length > 0 ? (
                                    detailedAnalysis.map((item, index) => (
                                        <div key={index} className="p-4 border rounded-lg space-y-3">
                                            <h3 className="font-bold text-lg">{item.product}</h3>
                                            <div className="space-y-2 text-sm">
                                                <div>
                                                    <p className="font-semibold text-muted-foreground">Comportamento do consumo médio:</p>
                                                    <p>{item.averageConsumptionBehavior}</p>
                                                </div>
                                                 <div>
                                                    <p className="font-semibold text-muted-foreground">Comparação período x histórico:</p>
                                                    <p>{item.periodVsHistoricalComparison}</p>
                                                </div>
                                                 <div>
                                                    <p className="font-semibold text-muted-foreground">Tendência na série mensal:</p>
                                                    <p>{item.monthlySeriesTrend}</p>
                                                </div>
                                                <div>
                                                    <p className="font-semibold text-muted-foreground">Volatilidade e estabilidade:</p>
                                                    <p>{item.volatilityAndStability}</p>
                                                </div>
                                                 <Separator />
                                                 <div>
                                                    <p className="font-semibold text-muted-foreground">Síntese analítica:</p>
                                                    <p className="italic">{item.analyticalSynthesis}</p>
                                                 </div>
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div className="text-center py-10">
                                        <p className="text-muted-foreground">Nenhuma análise foi gerada.</p>
                                    </div>
                                )}
                            </div>
                        </ScrollArea>
                    )}
                </div>
                <DialogFooter className="pt-4 border-t justify-between">
                    <div>
                        {!isLoading && analysisResult && (
                            <PDFDownloadLink
                                document={
                                    <AiAnalysisDocument
                                        analysisResult={analysisResult}
                                        kioskName={analysisParams?.kioskName || ''}
                                        period={analysisParams?.period || ''}
                                    />
                                }
                                fileName={`analise_consumo_${analysisParams?.kioskName.replace(/\s+/g, '_') || 'geral'}.pdf`}
                            >
                                {({ loading }) => (
                                    <Button variant="outline" disabled={loading}>
                                        <Download className="mr-2 h-4 w-4"/>
                                        {loading ? 'Gerando...' : 'Exportar análise'}
                                    </Button>
                                )}
                            </PDFDownloadLink>
                        )}
                    </div>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
