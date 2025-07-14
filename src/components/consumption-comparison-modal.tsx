
"use client"

import React, { useState, useMemo, useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { type ConsumptionReport, type Product, type Kiosk } from "@/types";
import { Scale, TrendingUp, TrendingDown, Minus, AlertCircle, Info, Download, Copy } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useProducts } from '@/hooks/use-products';

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

const SUGGESTED_PROMPT = `Você é um Analista de Dados Sênior com foco em varejo e gestão de estoque. Sua tarefa é realizar uma análise técnica e aprofundada dos dados de consumo de insumos para o quiosque, comparando os dois períodos.

Sua análise deve conter:

Diagnóstico Geral: Um parágrafo inicial que sintetiza a principal mudança no padrão de consumo.

Análise de Variações Críticas: Identifique os itens com as maiores variações, tanto percentuais quanto absolutas. Separe claramente os aumentos e as reduções.

Identificação de Correlações: Aponte correlações entre o consumo de diferentes insumos (ex: o aumento nas vendas de milkshake e o consumo de copos, tampas e canudos correspondentes; ou a queda de um produto e seus descartáveis associados).

Hipóteses e Implicações de Negócio: Com base nos dados, formule hipóteses para as mudanças observadas (ex: mudança de preferência do cliente, impacto de uma promoção, possível falta de estoque de um item). Descreva as implicações para a gestão de estoque e estratégia de vendas.

Recomendação Principal: Forneça uma recomendação clara e assertiva para a gerência do quiosque.`;

export function ConsumptionComparisonModal({ open, onOpenChange, history, products, kiosks }: ConsumptionComparisonModalProps) {
    const { user } = useAuth();
    const { toast } = useToast();
    const { getProductFullName } = useProducts();
    const [kioskId, setKioskId] = useState<string>('');
    const [periodA, setPeriodA] = useState({ month: '', year: '' });
    const [periodB, setPeriodB] = useState({ month: '', year: '' });
    const [comparisonResults, setComparisonResults] = useState<ComparisonResult[] | null>(null);

    useEffect(() => {
        if (!open) return;
        
        if(user?.username === 'Tiago Brasil') {
            setKioskId('');
        } else if (user?.assignedKioskIds[0]) {
            setKioskId(user.assignedKioskIds[0]);
        }

        setPeriodA({ month: '', year: '' });
        setPeriodB({ month: '', year: '' });
        setComparisonResults(null);
    }, [user, open]);

    useEffect(() => {
        setPeriodA({ month: '', year: '' });
        setPeriodB({ month: '', year: '' });
        setComparisonResults(null);
    }, [kioskId]);

    useEffect(() => setPeriodA(p => ({ ...p, month: '' })), [periodA.year]);
    useEffect(() => setPeriodB(p => ({ ...p, month: '' })), [periodB.year]);

    const getMonthLabel = (monthNumber: number | string) => {
        if (!monthNumber) return '';
        const monthIndex = Number(monthNumber) - 1;
        if (isNaN(monthIndex) || monthIndex < 0 || monthIndex > 11) return '';
        return new Date(0, monthIndex).toLocaleString('pt-BR', { month: 'long' });
    };

    const availableYears = useMemo(() => {
        if (!kioskId) return [];
        const yearsForKiosk = history
            .filter(h => h.kioskId === kioskId)
            .map(h => h.year.toString());
        return [...new Set(yearsForKiosk)].sort((a, b) => b.localeCompare(a));
    }, [kioskId, history]);

    const availableMonthsA = useMemo(() => {
        if (!kioskId || !periodA.year) return [];
        const monthsForYear = history
            .filter(h => h.kioskId === kioskId && h.year.toString() === periodA.year)
            .map(h => h.month.toString());
        return [...new Set(monthsForYear)]
            .sort((a, b) => Number(a) - Number(b))
            .map(m => ({ value: m, label: getMonthLabel(m) }));
    }, [kioskId, periodA.year, history]);

    const availableMonthsB = useMemo(() => {
        if (!kioskId || !periodB.year) return [];
        const monthsForYear = history
            .filter(h => h.kioskId === kioskId && h.year.toString() === periodB.year)
            .map(h => h.month.toString());
        return [...new Set(monthsForYear)]
            .sort((a, b) => Number(a) - Number(b))
            .map(m => ({ value: m, label: getMonthLabel(m) }));
    }, [kioskId, periodB.year, history]);


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
                percentageChange = Infinity;
            }
            
            results.push({
                productName: getProductFullName(productInfo),
                unit: productInfo.unit,
                consumptionA,
                consumptionB,
                variation,
                percentageChange
            });
        });
        setComparisonResults(results.sort((a,b) => a.productName.localeCompare(b.productName)));
    };
    
    const handleCopyPrompt = () => {
        navigator.clipboard.writeText(SUGGESTED_PROMPT).then(() => {
            toast({ title: "Prompt copiado!", description: "Cole na sua ferramenta de IA favorita." });
        });
    };

    const handleExportPdf = () => {
        if (!comparisonResults) return;

        const doc = new jsPDF();
        const kioskName = kiosks.find(k => k.id === kioskId)?.name || 'N/A';
        const periodALabel = `${getMonthLabel(periodA.month)}/${periodA.year}`;
        const periodBLabel = `${getMonthLabel(periodB.month)}/${periodB.year}`;

        doc.setFontSize(18);
        doc.text(`Comparativo de consumo - ${kioskName}`, 14, 22);
        doc.setFontSize(11);
        doc.setTextColor(100);
        doc.text(`Período A: ${periodALabel}`, 14, 30);
        doc.text(`Período B: ${periodBLabel}`, 14, 36);

        const tableHead = [['Insumo', `Consumo A`, `Consumo B`, 'Variação absoluta', 'Variação %']];
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
                item.productName,
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
    
    const isCompareDisabled = !kioskId || !periodA.month || !periodA.year || !periodB.month || !periodB.year;
    
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-5xl h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2"><Scale /> Comparar consumo mensal</DialogTitle>
                    <DialogDescription>
                        Selecione o quiosque e os dois períodos que deseja comparar para analisar a variação no consumo de insumos.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_auto] gap-4 items-end border p-4 rounded-lg">
                    {user?.username === 'Tiago Brasil' && (
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
                             <Select value={periodA.year} onValueChange={(y) => setPeriodA(p => ({...p, year: y}))} disabled={!kioskId}>
                                <SelectTrigger><SelectValue placeholder="Ano"/></SelectTrigger>
                                <SelectContent>{availableYears.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent>
                            </Select>
                             <Select value={periodA.month} onValueChange={(m) => setPeriodA(p => ({...p, month: m}))} disabled={!periodA.year}>
                                <SelectTrigger><SelectValue placeholder="Mês"/></SelectTrigger>
                                <SelectContent>{availableMonthsA.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                    </div>
                     <div className="space-y-1.5">
                        <label className="text-sm font-medium">Período B</label>
                         <div className="flex gap-2">
                            <Select value={periodB.year} onValueChange={(y) => setPeriodB(p => ({...p, year: y}))} disabled={!kioskId}>
                                <SelectTrigger><SelectValue placeholder="Ano"/></SelectTrigger>
                                <SelectContent>{availableYears.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent>
                            </Select>
                            <Select value={periodB.month} onValueChange={(m) => setPeriodB(p => ({...p, month: m}))} disabled={!periodB.year}>
                                <SelectTrigger><SelectValue placeholder="Mês"/></SelectTrigger>
                                <SelectContent>{availableMonthsB.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                    </div>
                    <Button onClick={handleCompare} disabled={isCompareDisabled}>Comparar</Button>
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
                                    <CardTitle>Resultados da comparação</CardTitle>
                                    <Button variant="outline" size="sm" onClick={handleExportPdf} disabled={!comparisonResults || comparisonResults.length === 0}>
                                        <Download className="mr-2 h-4 w-4" />
                                        Exportar PDF
                                    </Button>
                                </CardHeader>
                                <CardContent>
                                    <ScrollArea className="h-[25vh]">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Insumo</TableHead>
                                                    <TableHead className="text-right">Período A</TableHead>
                                                    <TableHead className="text-right">Período B</TableHead>
                                                    <TableHead className="text-right">Variação (absoluta e %)</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {comparisonResults.map(item => (
                                                    <TableRow key={item.productName}>
                                                        <TableCell>{item.productName}</TableCell>
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

                             <Card>
                                <CardHeader>
                                    <CardTitle>Sugestão de prompt para análise externa</CardTitle>
                                    <CardDescription>
                                        Copie o prompt abaixo e cole-o em sua ferramenta de IA de preferência, junto com os dados exportados da tabela, para obter uma análise detalhada.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-2">
                                    <Textarea
                                        readOnly
                                        value={SUGGESTED_PROMPT}
                                        className="h-48 font-mono text-xs"
                                    />
                                    <Button onClick={handleCopyPrompt} className="w-full">
                                        <Copy className="mr-2 h-4 w-4" />
                                        Copiar prompt
                                    </Button>
                                </CardContent>
                            </Card>
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
