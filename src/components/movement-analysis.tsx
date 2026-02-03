"use client"

import { useMemo, useState, useEffect } from "react"
import { format, startOfMonth, addMonths, isWithinInterval, parseISO, endOfMonth } from "date-fns"
import { ptBR } from 'date-fns/locale'

// Hooks
import { useMovementHistory } from "@/hooks/use-movement-history";
import { useProducts } from "@/hooks/use-products";
import { useKiosks } from "@/hooks/use-kiosks";
import { useBaseProducts } from "@/hooks/use-base-products";

// UI Components
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "./ui/select"
import { MultiSelect } from "@/components/ui/multi-select"
import { Inbox, Truck } from "lucide-react";

export function MovementAnalysis() {
    const [startPeriod, setStartPeriod] = useState<string | null>(null);
    const [endPeriod, setEndPeriod] = useState<string | null>(null);
    const [selectedBaseProducts, setSelectedBaseProducts] = useState<string[]>([]);
    const [kioskId, setKioskId] = useState<string>('all');
    
    const { history, loading: historyLoading } = useMovementHistory();
    const { products, loading: productsLoading } = useProducts();
    const { baseProducts, loading: baseProductsLoading } = useBaseProducts();
    const { kiosks, loading: kiosksLoading } = useKiosks();
    
    const loading = historyLoading || productsLoading || baseProductsLoading || kiosksLoading;

    const availablePeriods = useMemo(() => {
        if (loading) return [];
        const periods = new Set<string>();
        history.forEach(record => {
            if (record.timestamp) {
                periods.add(format(parseISO(record.timestamp), 'yyyy-MM'));
            }
        });
        return Array.from(periods).sort((a,b) => b.localeCompare(a));
    }, [history, loading]);

    useEffect(() => {
        if (!loading && availablePeriods.length > 0) {
            if (!endPeriod) setEndPeriod(availablePeriods[0]);
            if (!startPeriod) {
                const defaultStartIndex = Math.min(2, availablePeriods.length - 1);
                setStartPeriod(availablePeriods[defaultStartIndex]);
            }
        }
    }, [availablePeriods, loading, startPeriod, endPeriod]);

    const handleStartPeriodChange = (value: string) => {
        setStartPeriod(value);
        if (endPeriod && value > endPeriod) {
            setEndPeriod(value);
        }
    };

    const handleEndPeriodChange = (value: string) => {
        setEndPeriod(value);
        if (startPeriod && value < startPeriod) {
            setStartPeriod(value);
        }
    };
    
    const productOptions = useMemo(() => 
        baseProducts.map(p => ({ value: p.id, label: p.name })),
    [baseProducts]);

    if (loading) {
        return <Skeleton className="h-96 w-full" />;
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><Truck /> Análise de Transferências</CardTitle>
                <CardDescription>Visualize o fluxo de entrada de insumos nas unidades por período.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                 <div className="flex flex-col md:flex-row gap-2">
                    <Select value={kioskId} onValueChange={setKioskId}>
                        <SelectTrigger className="w-full md:w-[200px]">
                            <SelectValue placeholder="Selecione a unidade" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todas as Unidades</SelectItem>
                            {kiosks.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    
                    <div className="flex items-center gap-2">
                        <Select value={startPeriod || ""} onValueChange={handleStartPeriodChange} disabled={availablePeriods.length === 0}>
                            <SelectTrigger className="w-full md:w-[150px]">
                                <SelectValue placeholder="Início" />
                            </SelectTrigger>
                            <SelectContent>
                                {availablePeriods.map(p => (
                                    <SelectItem key={`start-${p}`} value={p}>
                                        {format(parseISO(`${p}-01`), 'MMM/yy', { locale: ptBR })}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <span className="text-muted-foreground">-</span>
                        <Select value={endPeriod || ""} onValueChange={handleEndPeriodChange} disabled={availablePeriods.length === 0}>
                            <SelectTrigger className="w-full md:w-[150px]">
                                <SelectValue placeholder="Fim" />
                            </SelectTrigger>
                            <SelectContent>
                                {availablePeriods.map(p => (
                                    <SelectItem key={`end-${p}`} value={p} disabled={!!startPeriod && p < startPeriod}>
                                        {format(parseISO(`${p}-01`), 'MMM/yy', { locale: ptBR })}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="flex-1">
                        <MultiSelect
                            options={productOptions}
                            selected={selectedBaseProducts}
                            onChange={setSelectedBaseProducts}
                            placeholder="Selecione os insumos..."
                            className="w-full"
                        />
                    </div>
                </div>

                <div className="flex h-64 flex-col items-center justify-center text-muted-foreground border-2 border-dashed rounded-lg">
                    <Inbox className="h-12 w-12 mb-2"/>
                    <p>Análise de movimentações em desenvolvimento.</p>
                </div>
            </CardContent>
        </Card>
    )
}
