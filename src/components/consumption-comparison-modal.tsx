
"use client"

import React, { useState, useMemo, useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { type ConsumptionReport, type Product, type Kiosk } from "@/types";
import { compareConsumption, type ComparisonInput } from '@/ai/flows/compare-consumption-flow';
import { Scale, Wand2, TrendingUp, TrendingDown, Minus, AlertCircle, Info, Download } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface ConsumptionComparisonModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    history: ConsumptionReport[];
    products: Product[];
    kiosks: Kiosk[];
}

interface ComparisonResult {
    productName: string;
    unit: string;
    consumptionA: number;
    consumptionB: number;
    variation: number;
    percentageChange: number | null;
}

const currentYear = new Date().getFullYear();
const years = Array.from({ length: 5 }, (_, i) => (currentYear - i).toString());
const months = Array.from({ length: 12 }, (_, i) => ({ value: (i + 1).toString(), label: new Date(0, i).toLocaleString('pt-BR', { month: 'long' }) }));

const AI_ERROR_MESSAGE = "A análise da IA não pôde ser gerada. Isso pode ocorrer devido a filtros de segurança ou um erro inesperado. Por favor, tente novamente.";

export const ConsumptionComparisonModal: React.FC<ConsumptionComparisonModalProps> = ({ open, onOpenChange, history, products, kiosks }) => {
    const { user } = useAuth();
    const [kioskId, setKioskId] = useState<string>('');
    const [periodA, setPeriodA] = useState({ month: '', year: '' });
    const [periodB, setPeriodB] = useState({ month: '', year: '' });
    const [comparisonResults, setComparisonResults] = useState<ComparisonResult[] | null>(null);
    const [aiAnalysisResult, setAiAnalysisResult] = useState<{type: 'success' | 'error', message: string} | null>(null);
    const [isAiLoading, setIsAiLoading] = useState(false);

    useEffect(() => {
        if(user?.username !== 'master' && user?.kioskId) {
            setKioskId(user.kioskId);
        }
    }, [user]);

    const handleCompare = () => {
        if (!kioskId || !periodA.month || !periodA.year || !periodB.month || !periodB.year) return;

        const reportA = history.find(h => h.kioskId === kioskId && h.month.toString() === periodA.month && h.year.toString() === periodA.year);
        const reportB = history.find(h => h.kioskId === kioskId && h.month.toString() === periodB.month && h.year.toString() === periodB.year);
        
        if (!reportA || !reportB) {
            setComparisonResults([]);
            return;
        }

        const allProductIds = new Set([...reportA.results.map(r => r.productId), ...reportB.results.map(r => r.productId)]);
        const results: ComparisonResult[] = [];

        allProductIds.forEach(productId => {
            const productInfo = products.find(p => p.id === productId);
            if (!productInfo) return;

            const consumptionA = reportA.results.find(r => r.productId === productId)?.consumedQuantity || 0;
            const consumptionB = reportB.results.find(r => r.productId === productId)?.consumedQuantity || 0;
            const variation = consumptionB - consumptionA;
            
            let percentageChange: number | null = null;
            if (consumptionA > 0) {
                percentageChange = (variation / consumptionA) * 100;
            } else if (consumptionB > 0) {
                percentageChange = Infinity; // Represents new consumption
            }
            
            results.push({
                productName: productInfo.baseName,
                unit: productInfo.unit,
                consumptionA,
                consumptionB,
                variation,
                percentageChange
            });
        });
        setComparisonResults(results.sort((a,b) => a.productName.localeCompare(b.productName)));
        setAiAnalysisResult(null); // Reset AI analysis on new comparison
    };

    const handleGetAIAnalysis = async () => {
        if (!comparisonResults) return;
        setIsAiLoading(true);
        setAiAnalysisResult(null);

        const aiInput: ComparisonInput = {
            periodA: `${months.find(m => m.value === periodA.month)?.label}/${periodA.year}`,
            periodB: `${months.find(m => m.value === periodB.month)?.label}/${periodB.year}`,
            items: comparisonResults.map(r => ({
                productName: r.productName,
                consumptionA: r.consumptionA,
                consumptionB: r.consumptionB,
                unit: r.unit,
            }))
        };

        try {
            const analysis = await compareConsumption(aiInput);
            if (analysis === AI_ERROR_MESSAGE) {
                setAiAnalysisResult({ type: 'error', message: analysis });
            } else {
                setAiAnalysisResult({ type: 'success', message: analysis });
            }
        } catch (error) {
            console.error("AI analysis failed:", error);
            setAiAnalysisResult({ type: 'error', message: "Ocorreu um erro ao gerar a análise. Tente novamente." });
        } finally {
            setIsAiLoading(false);
        }
    };
    
    const handleExportPdf = () => {
        if (!comparisonResults) return;

        const doc = new jsPDF();
        const kioskName = kiosks.find(k => k.id === kioskId)?.name || 'N/A';
        const periodALabel = `${months.find(m => m.value === periodA.month)?.label}/${periodA.year}`;
        const periodBLabel = `${months.find(m => m.value === periodB.month)?.label}/${periodB.year}`;

        doc.setFontSize(18);
        doc.text(`Comparativo de Consumo - ${kioskName}`, 14, 22);
        doc.setFontSize(11);
        doc.setTextColor(100);
        doc.text(`Período A: ${periodALabel}`, 14, 30);
        doc.text(`Período B: ${periodBLabel}`, 14, 36);

        const tableHead = [['Insumo', `Consumo A`, `Consumo B`, 'Variação Absoluta', 'Variação %']];
        const tableBody = comparisonResults.map(item => {
            let percentageText: string;
            if (item.percentageChange === null) {
                percentageText = '0.0%';
            } else if (item.percentageChange === Infinity) {
                percentageText = 'Novo';
            } else {
                percentageText = `${item.percentageChange.toFixed(1)}%`;
            }

            return [
                `${item.productName} (${item.unit})`,
                item.consumptionA.toLocaleString(undefined, { maximumFractionDigits: 2 }),
                item.consumptionB.toLocaleString(undefined, { maximumFractionDigits: 2 }),
                item.variation.toLocaleString(undefined, { maximumFractionDigits: 2 }),
                percentageText
            ];
        });

        autoTable(doc, {
            startY: 45,
            head: tableHead,
            body: tableBody,
            theme: 'grid',
            headStyles: { fillColor: '#3F51B5' },
        });

        let finalY = (doc as any).lastAutoTable.finalY;

        if (aiAnalysisResult?.type === 'success') {
            const margin = 15;
            if (finalY + 20 > doc.internal.pageSize.height - margin) {
                doc.addPage();
                finalY = margin;
            } else {
                finalY += 15;
            }
            
            doc.setFontSize(14);
            doc.setFont('helvetica', 'bold');
            doc.text("Análise da IA", 14, finalY);
            finalY += 7;

            doc.setFontSize(10);
            doc.setFont('helvetica', 'normal');
            const textLines = doc.splitTextToSize(aiAnalysisResult.message, 180);
            doc.text(textLines, 14, finalY);
        }
        
        doc.save(`comparativo_consumo_${kioskName.replace(/\s/g, '_')}_${periodA.month}-${periodA.year}_vs_${periodB.month}-${periodB.year}.pdf`);
    };

    const getVariationCell = (variation: number, percentage: number | null) => {
        let Icon = Minus;
        let colorClass = "text-muted-foreground";

        if (percentage !== null && percentage > 0) {
            Icon = TrendingUp;
            colorClass = "text-green-600";
        } else if (percentage !== null && percentage < 0) {
            Icon = TrendingDown;
            colorClass = "text-destructive";
        }
        
        const percentageText = percentage === null ? '' :
                               percentage === Infinity ? '(Novo)' :
                               `(${percentage.toFixed(1)}%)`;
                               
        return (
            <div className={`flex items-center gap-2 font-semibold ${colorClass}`}>
                <Icon className="h-4 w-4" />
                <span>{variation.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                <span className="text-xs font-normal">{percentageText}</span>
            </div>
        );
    };

    const sortedKiosks = useMemo(() => {
        return [...kiosks].sort((a,b) => {
            if (a.id === 'matriz') return -1;
            if (b.id === 'matriz') return 1;
            return a.name.localeCompare(b.name);
        });
    }, [kiosks]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-5xl h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2"><Scale /> Comparar Consumo Mensal</DialogTitle>
                    <DialogDescription>
                        Selecione o quiosque e os dois períodos que deseja comparar para analisar a variação no consumo de insumos.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_auto] gap-4 items-end border p-4 rounded-lg">
                    {user?.username === 'master' && (
                        <div className="space-y-1.5">
                            <label className="text-sm font-medium">Quiosque</label>
                            <Select value={kioskId} onValueChange={setKioskId}><SelectTrigger><SelectValue placeholder="Selecione..."/></SelectTrigger>
                                <SelectContent>{sortedKiosks.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                    )}
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium">Período A</label>
                        <div className="flex gap-2">
                             <Select value={periodA.month} onValueChange={(m) => setPeriodA(p => ({...p, month: m}))}><SelectTrigger><SelectValue placeholder="Mês"/></SelectTrigger>
                                <SelectContent>{months.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                            </Select>
                            <Select value={periodA.year} onValueChange={(y) => setPeriodA(p => ({...p, year: y}))}><SelectTrigger><SelectValue placeholder="Ano"/></SelectTrigger>
                                <SelectContent>{years.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                    </div>
                     <div className="space-y-1.5">
                        <label className="text-sm font-medium">Período B</label>
                         <div className="flex gap-2">
                            <Select value={periodB.month} onValueChange={(m) => setPeriodB(p => ({...p, month: m}))}><SelectTrigger><SelectValue placeholder="Mês"/></SelectTrigger>
                                <SelectContent>{months.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                            </Select>
                            <Select value={periodB.year} onValueChange={(y) => setPeriodB(p => ({...p, year: y}))}><SelectTrigger><SelectValue placeholder="Ano"/></SelectTrigger>
                                <SelectContent>{years.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                    </div>
                    <Button onClick={handleCompare} disabled={!kioskId || !periodA.month || !periodA.year || !periodB.month || !periodB.year}>Comparar</Button>
                </div>
                
                <div className="flex-1 overflow-y-auto pr-4">
                    {comparisonResults === null && (
                        <div className="flex h-full flex-col items-center justify-center text-muted-foreground text-center">
                            <Info className="h-12 w-12 mb-4" />
                            <p className="font-semibold">Aguardando seleção</p>
                            <p className="text-sm">Selecione o quiosque e os dois períodos para gerar o comparativo.</p>
                        </div>
                    )}
                    {comparisonResults?.length === 0 && (
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertTitle>Relatório não encontrado</AlertTitle>
                            <AlertDescription>
                                Não foi encontrado um relatório de consumo para um ou ambos os períodos selecionados. Verifique a seleção ou importe os relatórios faltantes.
                            </AlertDescription>
                        </Alert>
                    )}
                    {comparisonResults && comparisonResults.length > 0 && (
                        <div className="space-y-4">
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between">
                                    <CardTitle>Resultados da Comparação</CardTitle>
                                    <Button variant="outline" size="sm" onClick={handleExportPdf}>
                                        <Download className="mr-2 h-4 w-4" />
                                        Exportar PDF
                                    </Button>
                                </CardHeader>
                                <CardContent>
                                    <ScrollArea className="h-[40vh]">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Insumo</TableHead>
                                                    <TableHead className="text-right">Período A</TableHead>
                                                    <TableHead className="text-right">Período B</TableHead>
                                                    <TableHead className="text-right">Variação (Absoluta e %)</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {comparisonResults.map(item => (
                                                    <TableRow key={item.productName}>
                                                        <TableCell>{item.productName} <span className="text-muted-foreground">({item.unit})</span></TableCell>
                                                        <TableCell className="text-right">{item.consumptionA.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                                                        <TableCell className="text-right">{item.consumptionB.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                                                        <TableCell className="text-right">{getVariationCell(item.variation, item.percentageChange)}</TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </ScrollArea>
                                </CardContent>
                            </Card>

                            <div className="text-center">
                                 <Button onClick={handleGetAIAnalysis} disabled={isAiLoading}>
                                    <Wand2 className="mr-2" />
                                    {isAiLoading ? "Analisando..." : "Obter Análise da IA"}
                                 </Button>
                            </div>

                            {isAiLoading && <Skeleton className="h-24 w-full" />}
                            {aiAnalysisResult && (
                                aiAnalysisResult.type === 'success' ? (
                                    <Card className="bg-primary/5">
                                        <CardHeader>
                                            <CardTitle className="text-lg flex items-center gap-2 text-primary">
                                                <Wand2/> Análise da IA
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            <p className="whitespace-pre-wrap">{aiAnalysisResult.message}</p>
                                        </CardContent>
                                    </Card>
                                ) : (
                                    <Alert variant="destructive">
                                        <AlertCircle className="h-4 w-4" />
                                        <AlertTitle>Falha na Análise da IA</AlertTitle>
                                        <AlertDescription>
                                            {aiAnalysisResult.message}
                                        </AlertDescription>
                                    </Alert>
                                )
                            )}
                        </div>
                    )}
                </div>

                <DialogFooter className="pt-4 border-t">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );

}

    