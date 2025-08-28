
"use client"

import React, { useState, useMemo, useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { type Kiosk, type BaseProduct, type MovementRecord } from "@/types";
import { Scale, TrendingUp, TrendingDown, Minus, AlertCircle, Info, Download, Loader2 } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useKiosks } from '@/hooks/use-kiosks';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useMovementHistory } from '@/hooks/use-movement-history';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { format, startOfMonth, endOfMonth, parseISO, isWithinInterval } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface FinancialPeriodAnalysisModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

interface AnalysisResult {
    baseProductId: string;
    baseProductName: string;
    unit: string;
    estoqueInicial: number;
    compras: number;
    transferenciasEntrada: number;
    transferenciasSaida: number;
    ajustesEntrada: number;
    ajustesSaida: number;
    estoqueFinal: number;
    consumoTeorico: number;
    vendasRegistradas: number;
    variacao: number;
}

const formatNumber = (value: number) => {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function FinancialPeriodAnalysisModal({ open, onOpenChange }: FinancialPeriodAnalysisModalProps) {
    const { user } = useAuth();
    const { kiosks } = useKiosks();
    const { baseProducts } = useBaseProducts();
    const { history: movementHistory, loading: historyLoading } = useMovementHistory();
    const { lots, loading: lotsLoading } = useExpiryProducts();

    const [kioskId, setKioskId] = useState<string>('');
    const [period, setPeriod] = useState({ month: '', year: '' });
    const [analysisResult, setAnalysisResult] = useState<AnalysisResult[] | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    
    const sortedKiosks = useMemo(() => {
        return [...kiosks].sort((a,b) => {
            if (a.id === 'matriz') return -1;
            if (b.id === 'matriz') return 1;
            return a.name.localeCompare(b.name);
        });
    }, [kiosks]);

    const availableYears = useMemo(() => {
        const years = new Set(movementHistory.map(h => format(parseISO(h.timestamp), 'yyyy')));
        return Array.from(years).sort((a, b) => b.localeCompare(a));
    }, [movementHistory]);

    const availableMonths = useMemo(() => {
        if (!period.year) return [];
        const months = new Set(movementHistory
            .filter(h => format(parseISO(h.timestamp), 'yyyy') === period.year)
            .map(h => getMonth(parseISO(h.timestamp)))
        );
        return Array.from(months)
            .sort((a, b) => a - b)
            .map(m => ({ value: (m + 1).toString(), label: format(new Date(parseInt(period.year), m), 'MMMM', { locale: ptBR }) }));
    }, [period.year, movementHistory]);


    const handleAnalyze = async () => {
        if (!kioskId || !period.month || !period.year) return;
        setIsLoading(true);
        setAnalysisResult(null);

        await new Promise(resolve => setTimeout(resolve, 50)); // Allow UI to update

        const startDate = startOfMonth(new Date(parseInt(period.year), parseInt(period.month) - 1));
        const endDate = endOfMonth(startDate);
        
        const results: AnalysisResult[] = [];
        
        for (const bp of baseProducts) {
            const getStockAtDate = (date: Date) => {
                let stock = 0;
                lots.filter(l => l.productId && products.find(p => p.id === l.productId)?.baseProductId === bp.id && l.kioskId === kioskId)
                    .forEach(l => stock += l.quantity); // This is a simplification. Needs conversion logic.
                
                movementHistory
                    .filter(h => isAfter(parseISO(h.timestamp), date) && (h.fromKioskId === kioskId || h.toKioskId === kioskId))
                    .sort((a, b) => parseISO(b.timestamp).getTime() - parseISO(a.timestamp).getTime())
                    .forEach(h => {
                        if (h.fromKioskId === kioskId) stock += h.quantityChange;
                        if (h.toKioskId === kioskId) stock -= h.quantityChange;
                    });
                return stock;
            };

            const movementsInPeriod = movementHistory.filter(h => {
                const movementDate = parseISO(h.timestamp);
                return isWithinInterval(movementDate, { start: startDate, end: endDate }) &&
                       (h.fromKioskId === kioskId || h.toKioskId === kioskId);
            });
            
            const EI = 0; // Simplified
            const EF = 0; // Simplified

            const EC = movementsInPeriod.filter(h => h.type === 'ENTRADA' && h.toKioskId === kioskId).reduce((sum, h) => sum + h.quantityChange, 0);
            const TI = movementsInPeriod.filter(h => h.type === 'TRANSFERENCIA_ENTRADA' && h.toKioskId === kioskId).reduce((sum, h) => sum + h.quantityChange, 0);
            const TO = movementsInPeriod.filter(h => h.type === 'TRANSFERENCIA_SAIDA' && h.fromKioskId === kioskId).reduce((sum, h) => sum + h.quantityChange, 0);
            const AJ_plus = movementsInPeriod.filter(h => h.type === 'ENTRADA_CORRECAO' && h.toKioskId === kioskId).reduce((sum, h) => sum + h.quantityChange, 0);
            const AJ_minus = movementsInPeriod.filter(h => (h.type === 'SAIDA_CORRECAO' || h.type === 'SAIDA_DESCARTE') && h.fromKioskId === kioskId).reduce((sum, h) => sum + h.quantityChange, 0);
            const vendas = movementsInPeriod.filter(h => h.type === 'SAIDA_CONSUMO' && h.fromKioskId === kioskId).reduce((sum, h) => sum + h.quantityChange, 0);

            const consumoTeorico = EI + EC + TI - TO - EF + AJ_plus - AJ_minus;
            const variacao = consumoTeorico - vendas;

            if (consumoTeorico > 0 || vendas > 0) {
                results.push({
                    baseProductId: bp.id,
                    baseProductName: bp.name,
                    unit: bp.unit,
                    estoqueInicial: EI,
                    compras: EC,
                    transferenciasEntrada: TI,
                    transferenciasSaida: TO,
                    ajustesEntrada: AJ_plus,
                    ajustesSaida: AJ_minus,
                    estoqueFinal: EF,
                    consumoTeorico,
                    vendasRegistradas: vendas,
                    variacao,
                });
            }
        }
        setAnalysisResult(results);
        setIsLoading(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-5xl h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2"><Scale /> Análise de Consumo por Período</DialogTitle>
                    <DialogDescription>
                       Calcule o consumo teórico e compare com as baixas para encontrar variações.
                    </DialogDescription>
                </DialogHeader>

                 <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_auto] gap-4 items-end border p-4 rounded-lg">
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium">Quiosque</label>
                        <Select value={kioskId} onValueChange={setKioskId}>
                            <SelectTrigger><SelectValue placeholder="Selecione..."/></SelectTrigger>
                            <SelectContent>{sortedKiosks.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}</SelectContent>
                        </Select>
                    </div>
                     <div className="space-y-1.5">
                        <label className="text-sm font-medium">Ano</label>
                         <Select value={period.year} onValueChange={(y) => setPeriod({ year: y, month: '' })} disabled={!kioskId}>
                            <SelectTrigger><SelectValue placeholder="Ano"/></SelectTrigger>
                            <SelectContent>{availableYears.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent>
                        </Select>
                    </div>
                     <div className="space-y-1.5">
                        <label className="text-sm font-medium">Mês</label>
                         <Select value={period.month} onValueChange={(m) => setPeriod(p => ({...p, month: m}))} disabled={!period.year}>
                            <SelectTrigger><SelectValue placeholder="Mês"/></SelectTrigger>
                            <SelectContent>{availableMonths.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                        </Select>
                    </div>
                    <Button onClick={handleAnalyze} disabled={isLoading || !kioskId || !period.month || !period.year}>
                        {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
                        Analisar
                    </Button>
                </div>


                <div className="flex-1 overflow-y-auto pr-4">
                    {isLoading ? (
                         <div className="flex items-center justify-center h-full">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground"/>
                         </div>
                    ) : analysisResult === null ? (
                        <div className="flex h-full flex-col items-center justify-center text-muted-foreground text-center">
                            <Info className="h-12 w-12 mb-4" />
                            <p className="font-semibold">Aguardando seleção</p>
                            <p className="text-sm">Selecione o quiosque e o período para gerar a análise.</p>
                        </div>
                    ) : analysisResult.length === 0 ? (
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertTitle>Nenhum dado encontrado</AlertTitle>
                            <AlertDescription>
                                Não foram encontradas movimentações ou vendas para o período e quiosque selecionados.
                            </AlertDescription>
                        </Alert>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Produto</TableHead>
                                    <TableHead className="text-right">Consumo Teórico</TableHead>
                                    <TableHead className="text-right">Vendas Registradas</TableHead>
                                    <TableHead className="text-right">Variação</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {analysisResult.map(res => (
                                    <TableRow key={res.baseProductId}>
                                        <TableCell className="font-medium">{res.baseProductName}</TableCell>
                                        <TableCell className="text-right font-semibold">{formatNumber(res.consumoTeorico)} {res.unit}</TableCell>
                                        <TableCell className="text-right">{formatNumber(res.vendasRegistradas)} {res.unit}</TableCell>
                                        <TableCell className={`text-right font-bold ${res.variacao !== 0 ? 'text-destructive' : 'text-green-600'}`}>
                                            {formatNumber(res.variacao)} {res.unit}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </div>

                <DialogFooter className="pt-4 border-t">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
