
"use client"

import React, { useState, useMemo, useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { type ConsumptionReport, type Kiosk, type BaseProduct } from "@/types";
import { Scale, TrendingUp, TrendingDown, Minus, AlertCircle, Info, Download } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useKiosks } from '@/hooks/use-kiosks';
import { useConsumptionAnalysis } from '@/hooks/use-consumption-analysis';
import { useBaseProducts } from '@/hooks/use-base-products';

interface FinancialPeriodAnalysisModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

interface ComparisonResult {
    baseProductId: string;
    productName: string;
    unit: string;
    valueA: number;
    valueB: number;
    variation: number;
    percentageChange: number | null;
}

const formatCurrency = (value: number) => {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};


export function FinancialPeriodAnalysisModal({ open, onOpenChange }: FinancialPeriodAnalysisModalProps) {
    const { user } = useAuth();
    const { kiosks } = useKiosks();
    const { history } = useConsumptionAnalysis();
    const { baseProducts } = useBaseProducts();

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

        const baseProductPriceMap = new Map(baseProducts.map(bp => [bp.id, bp.lastEffectivePrice?.pricePerUnit || 0]));

        const allBaseProductIds = new Set([
            ...reportA.results.map(r => r.baseProductId), 
            ...reportB.results.map(r => r.baseProductId)
        ].filter((id): id is string => id !== null && id !== undefined));
        
        const results: ComparisonResult[] = [];

        allBaseProductIds.forEach(baseProductId => {
            const baseProductInfo = baseProducts.find(p => p.id === baseProductId);
            if (!baseProductInfo) return;

            const pricePerUnit = baseProductPriceMap.get(baseProductId) || 0;
            if (pricePerUnit === 0) return;

            const consumptionA = reportA.results.find(r => r.baseProductId === baseProductId)?.consumedQuantity || 0;
            const consumptionB = reportB.results.find(r => r.baseProductId === baseProductId)?.consumedQuantity || 0;
            
            const valueA = consumptionA * pricePerUnit;
            const valueB = consumptionB * pricePerUnit;

            const variation = valueB - valueA;
            
            let percentageChange: number | null = null;
            if (valueA > 0) {
                percentageChange = (variation / valueA) * 100;
            } else if (valueB > 0) {
                percentageChange = Infinity;
            }
            
            results.push({
                baseProductId,
                productName: baseProductInfo.name,
                unit: baseProductInfo.unit,
                valueA,
                valueB,
                variation,
                percentageChange
            });
        });
        setComparisonResults(results.sort((a,b) => a.productName.localeCompare(b.productName)));
    };
    
    const handleExportPdf = () => {
        if (!comparisonResults) return;

        const kioskName = kiosks.find(k => k.id === kioskId)?.name || 'N/A';
        const periodALabel = `${getMonthLabel(periodA.month)}/${periodA.year}`;
        const periodBLabel = `${getMonthLabel(periodB.month)}/${periodB.year}`;

        const doc = new jsPDF();
        doc.setFontSize(18);
        doc.text(`Comparativo Financeiro de Consumo - ${kioskName}`, 14, 22);
        doc.setFontSize(11);
        doc.setTextColor(100);
        doc.text(`Período A: ${periodALabel}`, 14, 30);
        doc.text(`Período B: ${periodBLabel}`, 14, 36);

        const tableHead = [['Produto Base', `Valor Consumido A`, `Valor Consumido B`, 'Variação (R$)', 'Variação %']];
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
                formatCurrency(item.valueA),
                formatCurrency(item.valueB),
                formatCurrency(item.variation),
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
        
        doc.save(`comparativo_consumo_financeiro_${kioskName.replace(/\s/g, '_')}_${periodA.month}-${periodA.year}_vs_${periodB.month}-${periodB.year}.pdf`);
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
                <span>{formatCurrency(variation)}</span>
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
                    <DialogTitle className="flex items-center gap-2"><Scale /> Análise Financeira por Período</DialogTitle>
                    <DialogDescription>
                        Compare o valor financeiro do consumo de insumos entre dois períodos.
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
                            <AlertTitle>Dados insuficientes</AlertTitle>
                            <AlertDescription>
                                Não foi encontrado um relatório de consumo para um ou ambos os períodos selecionados. Verifique se os insumos consumidos possuem preço efetivado no módulo de compras.
                            </AlertDescription>
                        </Alert>
                    )}
                    {comparisonResults && comparisonResults.length > 0 && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-end">
                                <Button variant="outline" size="sm" onClick={handleExportPdf} disabled={!comparisonResults || comparisonResults.length === 0}>
                                    <Download className="mr-2 h-4 w-4" />
                                    Exportar PDF
                                </Button>
                            </div>
                            <ScrollArea className="h-[45vh]">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Produto Base</TableHead>
                                            <TableHead className="text-right">Valor Consumido A</TableHead>
                                            <TableHead className="text-right">Valor Consumido B</TableHead>
                                            <TableHead className="text-right">Variação (R$ e %)</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {comparisonResults.map(item => (
                                            <TableRow key={item.baseProductId}>
                                                <TableCell>{item.productName}</TableCell>
                                                <TableCell className="text-right">{formatCurrency(item.valueA)}</TableCell>
                                                <TableCell className="text-right">{formatCurrency(item.valueB)}</TableCell>
                                                <TableCell className="text-right">{getVariationCell(item.variation, item.percentageChange)}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </ScrollArea>
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
