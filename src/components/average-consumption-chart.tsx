
"use client"

import { useMemo, useState, useEffect, useCallback } from "react"
import { DateRange } from "react-day-picker"
import { format, subDays, startOfWeek, addDays, eachDayOfInterval, isWithinInterval, parseISO } from "date-fns"
import { ptBR } from 'date-fns/locale'

// Hooks
import { useMovementHistory } from "@/hooks/use-movement-history"
import { useBaseProducts } from "@/hooks/use-base-products"
import { useProducts } from "@/hooks/use-products"

// UI Components
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Skeleton } from "@/components/ui/skeleton"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { CalendarIcon, TrendingUp, X as XIcon, Inbox, Check } from 'lucide-react'
import { cn } from "@/lib/utils"
import { Badge } from "./ui/badge"

// Chart Colors
const CHART_COLORS = [
    'hsl(var(--chart-1))',
    'hsl(var(--chart-2))',
    'hsl(var(--chart-3))',
    'hsl(var(--chart-4))',
    'hsl(var(--chart-5))',
];

export function AverageConsumptionChart() {
    // State
    const [dateRange, setDateRange] = useState<DateRange | undefined>({
        from: subDays(new Date(), 29),
        to: new Date(),
    });
    const [selectedBaseProducts, setSelectedBaseProducts] = useState<string[]>([]);
    const [viewMode, setViewMode] = useState<'absolute' | 'percentage'>('absolute');
    const [open, setOpen] = useState(false);

    // Data Hooks
    const { history: movementHistory, loading: historyLoading } = useMovementHistory();
    const { baseProducts, loading: baseProductsLoading } = useBaseProducts();
    const { products, loading: productsLoading } = useProducts();

    const loading = historyLoading || baseProductsLoading || productsLoading;

    // Memoized Data Processing
    const { chartData, yAxisLabel } = useMemo(() => {
        if (!dateRange?.from || selectedBaseProducts.length === 0) {
            return { chartData: [], yAxisLabel: 'Consumo' };
        }

        const filteredMovements = movementHistory.filter(m => {
            const movementDate = parseISO(m.timestamp);
            return (
                m.type === 'SAIDA_CONSUMO' &&
                isWithinInterval(movementDate, { start: dateRange.from!, end: addDays(dateRange.to || dateRange.from!, 1) })
            );
        });

        const dailyConsumption = new Map<string, Map<string, number>>(); // Map<date, Map<baseProductId, quantity>>

        filteredMovements.forEach(m => {
            const product = products.find(p => p.id === m.productId);
            if (!product || !product.baseProductId || !selectedBaseProducts.includes(product.baseProductId)) {
                return;
            }

            const dateStr = format(parseISO(m.timestamp), 'yyyy-MM-dd');
            if (!dailyConsumption.has(dateStr)) {
                dailyConsumption.set(dateStr, new Map());
            }
            const dayMap = dailyConsumption.get(dateStr)!;
            dayMap.set(product.baseProductId, (dayMap.get(product.baseProductId) || 0) + m.quantityChange);
        });
        
        const interval = eachDayOfInterval({start: dateRange.from!, end: dateRange.to || dateRange.from!});

        const finalChartData = interval.map(day => {
            const dateStr = format(day, 'yyyy-MM-dd');
            const dayData: Record<string, any> = {
                date: format(day, 'dd/MM'),
            };
            const consumptionForDay = dailyConsumption.get(dateStr);
            selectedBaseProducts.forEach(bpId => {
                const bp = baseProducts.find(p => p.id === bpId);
                if (bp) {
                    dayData[bp.name] = consumptionForDay?.get(bpId) || 0;
                }
            });
            return dayData;
        });

        const firstSelectedProduct = baseProducts.find(p => p.id === selectedBaseProducts[0]);
        const yLabel = viewMode === 'absolute' ? `Consumo (${firstSelectedProduct?.unit || ''})` : 'Variação (%)';

        return { chartData: finalChartData, yAxisLabel: yLabel };

    }, [dateRange, selectedBaseProducts, movementHistory, products, baseProducts, viewMode]);

    if (loading) {
        return <Skeleton className="h-96 w-full" />;
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><TrendingUp /> Análise de Consumo</CardTitle>
                <CardDescription>Visualize e compare o consumo de insumos ao longo do tempo.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex flex-col md:flex-row gap-2">
                    {/* Date Range Picker */}
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                id="date"
                                variant={"outline"}
                                className={cn("w-full md:w-[260px] justify-start text-left font-normal", !dateRange && "text-muted-foreground")}
                            >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {dateRange?.from ? (
                                    dateRange.to ? (
                                        <>
                                            {format(dateRange.from, "LLL dd, y", {locale: ptBR})} - {format(dateRange.to, "LLL dd, y", {locale: ptBR})}
                                        </>
                                    ) : (
                                        format(dateRange.from, "LLL dd, y", {locale: ptBR})
                                    )
                                ) : (
                                    <span>Selecione um período</span>
                                )}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                             <div className="flex p-2">
                                <Button variant="ghost" size="sm" onClick={() => setDateRange({from: subDays(new Date(), 29), to: new Date()})}>Últimos 30 dias</Button>
                                <Button variant="ghost" size="sm" onClick={() => setDateRange({from: subDays(new Date(), 89), to: new Date()})}>Últimos 3 meses</Button>
                            </div>
                            <Calendar
                                initialFocus
                                mode="range"
                                defaultMonth={dateRange?.from}
                                selected={dateRange}
                                onSelect={setDateRange}
                                numberOfMonths={2}
                                locale={ptBR}
                            />
                        </PopoverContent>
                    </Popover>

                    {/* Multi-select for base products */}
                    <Popover open={open} onOpenChange={setOpen}>
                        <PopoverTrigger asChild>
                            <Button
                                variant="outline"
                                role="combobox"
                                aria-expanded={open}
                                className="flex-1 justify-between"
                            >
                                {selectedBaseProducts.length > 0 ? `${selectedBaseProducts.length} insumo(s) selecionado(s)` : "Digite para adicionar insumos ao gráfico"}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                            <Command>
                                <CommandInput placeholder="Buscar insumo..." />
                                <CommandEmpty>Nenhum insumo encontrado.</CommandEmpty>
                                <CommandList>
                                <CommandGroup>
                                    {baseProducts.map((bp) => (
                                        <CommandItem
                                            key={bp.id}
                                            onSelect={() => {
                                                setSelectedBaseProducts(prev => 
                                                    prev.includes(bp.id) ? prev.filter(id => id !== bp.id) : [...prev, bp.id]
                                                );
                                            }}
                                        >
                                            <Check className={cn("mr-2 h-4 w-4", selectedBaseProducts.includes(bp.id) ? "opacity-100" : "opacity-0")} />
                                            {bp.name}
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                                </CommandList>
                            </Command>
                        </PopoverContent>
                    </Popover>
                    
                    <ToggleGroup type="single" value={viewMode} onValueChange={(value) => {if (value) setViewMode(value as any)}} size="sm">
                        <ToggleGroupItem value="absolute">Absoluto</ToggleGroupItem>
                        <ToggleGroupItem value="percentage" disabled>Variação %</ToggleGroupItem>
                    </ToggleGroup>
                </div>
                
                {selectedBaseProducts.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                        {selectedBaseProducts.map(bpId => {
                            const bp = baseProducts.find(p => p.id === bpId);
                            return (
                                <Badge key={bpId} variant="secondary" className="gap-1">
                                    {bp?.name}
                                    <button onClick={() => setSelectedBaseProducts(prev => prev.filter(id => id !== bpId))}>
                                        <XIcon className="h-3 w-3" />
                                    </button>
                                </Badge>
                            )
                        })}
                    </div>
                )}
                
                {/* Chart */}
                <div className="h-[400px]">
                    {selectedBaseProducts.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartData}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="date" />
                                <YAxis label={{ value: yAxisLabel, angle: -90, position: 'insideLeft' }}/>
                                <Tooltip />
                                <Legend />
                                {selectedBaseProducts.map((bpId, index) => {
                                    const bp = baseProducts.find(p => p.id === bpId);
                                    if (!bp) return null;
                                    return <Line key={bpId} type="monotone" dataKey={bp.name} stroke={CHART_COLORS[index % CHART_COLORS.length]} strokeWidth={2} dot={false} />;
                                })}
                            </LineChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
                            <Inbox className="h-12 w-12 mb-2"/>
                            <p>Selecione um ou mais insumos para visualizar o gráfico.</p>
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
