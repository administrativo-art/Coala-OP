
"use client";

import { useState, useMemo } from 'react';
import { DateRange } from 'react-day-picker';
import { format, parseISO, startOfDay, endOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// Hooks
import { usePurchase } from '@/hooks/use-purchase';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useEntities } from '@/hooks/use-entities';

// UI Components
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { AlertCircle, TrendingDown, TrendingUp, ChevronsUpDown, CalendarIcon, Search, Building, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from './ui/scroll-area';

const formatCurrency = (value: number | null | undefined) => {
    if (value === null || value === undefined || isNaN(value)) return 'N/A';
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

export function DynamicPriceQuery() {
    const { priceHistory, loading: loadingHistory } = usePurchase();
    const { baseProducts, loading: loadingBases } = useBaseProducts();
    const { entities, loading: loadingEntities } = useEntities();
    
    const [selectedBaseProductId, setSelectedBaseProductId] = useState<string | null>(null);
    const [selectedEntityIds, setSelectedEntityIds] = useState<string[]>([]);
    const [dateRange, setDateRange] = useState<DateRange | undefined>();

    const loading = loadingHistory || loadingBases || loadingEntities;

    const filteredHistory = useMemo(() => {
        if (!selectedBaseProductId) return [];
        return priceHistory.filter(entry => {
            if (entry.baseProductId !== selectedBaseProductId) return false;
            if (selectedEntityIds.length > 0 && !selectedEntityIds.includes(entry.entityId)) return false;
            
            const entryDate = parseISO(entry.confirmedAt);
            if (dateRange?.from && entryDate < startOfDay(dateRange.from)) return false;
            if (dateRange?.to && entryDate > endOfDay(dateRange.to)) return false;
            
            return true;
        }).sort((a,b) => parseISO(a.confirmedAt).getTime() - parseISO(b.confirmedAt).getTime());
    }, [priceHistory, selectedBaseProductId, selectedEntityIds, dateRange]);

    const entityMap = useMemo(() => new Map(entities.map(e => [e.id, e.name])), [entities]);

    const chartData = useMemo(() => {
        if (filteredHistory.length === 0) return [];
        
        const dataByDate: Record<string, { date: string, [entityName: string]: number | string }> = {};

        filteredHistory.forEach(entry => {
            const date = format(parseISO(entry.confirmedAt), 'dd/MM/yy');
            if (!dataByDate[date]) {
                dataByDate[date] = { date };
            }
            const entityName = entityMap.get(entry.entityId) || 'Desconhecido';
            dataByDate[date][entityName] = entry.pricePerUnit;
        });

        return Object.values(dataByDate);
    }, [filteredHistory, entityMap]);

    const kpis = useMemo(() => {
        if (filteredHistory.length === 0) return { lowest: null, highest: null, mostCompetitive: null, variation: 0 };
        
        let lowest = { price: Infinity, entityName: '' };
        let highest = { price: -1, entityName: '' };
        
        const pricesByEntity = new Map<string, number[]>();

        filteredHistory.forEach(entry => {
            const entityName = entityMap.get(entry.entityId) || 'Desconhecido';
            if (entry.pricePerUnit < lowest.price) {
                lowest = { price: entry.pricePerUnit, entityName };
            }
            if (entry.pricePerUnit > highest.price) {
                highest = { price: entry.pricePerUnit, entityName };
            }
            
            if (!pricesByEntity.has(entityName)) {
                pricesByEntity.set(entityName, []);
            }
            pricesByEntity.get(entityName)!.push(entry.pricePerUnit);
        });
        
        let mostCompetitive: { name: string, avg: number } | null = null;
        let lowestAvg = Infinity;
        pricesByEntity.forEach((prices, name) => {
            const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
            if (avg < lowestAvg) {
                lowestAvg = avg;
                mostCompetitive = { name, avg };
            }
        });

        const firstPrice = filteredHistory[0]?.pricePerUnit;
        const lastPrice = filteredHistory[filteredHistory.length - 1]?.pricePerUnit;
        const variation = (firstPrice && lastPrice) ? ((lastPrice / firstPrice) - 1) * 100 : 0;
        
        return {
            lowest: lowest.price === Infinity ? null : lowest,
            highest: highest.price === -1 ? null : highest,
            mostCompetitive,
            variation
        };
    }, [filteredHistory, entityMap]);

    if (loading) {
        return <Skeleton className="h-96 w-full" />
    }

    const uniqueEntitiesInHistory = useMemo(() => {
        if (!selectedBaseProductId) return [];
        const ids = new Set(priceHistory.filter(h => h.baseProductId === selectedBaseProductId).map(h => h.entityId));
        return entities.filter(e => ids.has(e.id));
    }, [priceHistory, entities, selectedBaseProductId]);

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader>
                    <CardTitle>Filtros da consulta</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                    <Select onValueChange={setSelectedBaseProductId} value={selectedBaseProductId || ''}>
                        <SelectTrigger className="w-full md:w-[300px]">
                            <SelectValue placeholder="Selecione um insumo base..." />
                        </SelectTrigger>
                        <SelectContent>
                            {baseProducts.map(bp => <SelectItem key={bp.id} value={bp.id}>{bp.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" className="w-full md:w-[300px]" disabled={!selectedBaseProductId}>
                                <Building className="mr-2 h-4 w-4" />
                                Fornecedores ({selectedEntityIds.length || 'Todos'})
                                <ChevronsUpDown className="ml-auto h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
                            <DropdownMenuLabel>Fornecedores disponíveis</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <ScrollArea className="h-48">
                            {uniqueEntitiesInHistory.map(entity => (
                                <DropdownMenuCheckboxItem
                                    key={entity.id}
                                    checked={selectedEntityIds.includes(entity.id)}
                                    onCheckedChange={(checked) => {
                                        setSelectedEntityIds(prev => checked ? [...prev, entity.id] : prev.filter(id => id !== entity.id));
                                    }}
                                >
                                    {entity.name}
                                </DropdownMenuCheckboxItem>
                            ))}
                            </ScrollArea>
                        </DropdownMenuContent>
                    </DropdownMenu>
                     <Popover>
                        <PopoverTrigger asChild>
                            <Button id="date" variant="outline" className={cn("w-full md:w-[300px] justify-start text-left font-normal", !dateRange && "text-muted-foreground")} disabled={!selectedBaseProductId}>
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {dateRange?.from ? (dateRange.to ? <>{format(dateRange.from, "LLL dd, y")} - {format(dateRange.to, "LLL dd, y")}</> : format(dateRange.from, "LLL dd, y")) : <span>Selecione o período</span>}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                            <Calendar initialFocus mode="range" defaultMonth={dateRange?.from} selected={dateRange} onSelect={setDateRange} numberOfMonths={2}/>
                        </PopoverContent>
                    </Popover>
                </CardContent>
            </Card>

            {!selectedBaseProductId ? (
                <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
                    <p>Selecione um insumo base para iniciar a análise.</p>
                </div>
            ) : filteredHistory.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
                    <Inbox className="h-12 w-12 mx-auto" />
                    <p className="mt-2 font-semibold">Nenhum dado encontrado para os filtros selecionados.</p>
                </div>
            ) : (
                <>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Menor Preço</CardTitle><TrendingDown className="h-4 w-4 text-green-500" /></CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{formatCurrency(kpis.lowest?.price)}</div>
                                <p className="text-xs text-muted-foreground">{kpis.lowest?.entityName}</p>
                            </CardContent>
                        </Card>
                         <Card>
                            <CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Maior Preço</CardTitle><TrendingUp className="h-4 w-4 text-red-500" /></CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{formatCurrency(kpis.highest?.price)}</div>
                                <p className="text-xs text-muted-foreground">{kpis.highest?.entityName}</p>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Fornecedor Mais Competitivo</CardTitle><AlertCircle className="h-4 w-4 text-blue-500" /></CardHeader>
                            <CardContent>
                                <div className="text-lg font-bold">{kpis.mostCompetitive?.name || 'N/A'}</div>
                                <p className="text-xs text-muted-foreground">Média de {formatCurrency(kpis.mostCompetitive?.avg)}</p>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Variação no período</CardTitle></CardHeader>
                            <CardContent>
                                <div className={`text-2xl font-bold ${kpis.variation > 0 ? 'text-red-500' : 'text-green-500'}`}>{kpis.variation.toFixed(1)}%</div>
                            </CardContent>
                        </Card>
                    </div>

                    <Card>
                        <CardHeader><CardTitle>Gráfico de Linhas da Competição</CardTitle></CardHeader>
                        <CardContent>
                            <ResponsiveContainer width="100%" height={350}>
                                <LineChart data={chartData}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis dataKey="date" />
                                    <YAxis tickFormatter={(value) => formatCurrency(value)} />
                                    <Tooltip formatter={(value: number) => formatCurrency(value)} />
                                    <Legend />
                                    {(selectedEntityIds.length > 0 ? selectedEntityIds : uniqueEntitiesInHistory.map(e=>e.id)).map((entityId, index) => {
                                        const entityName = entityMap.get(entityId) || 'Desconhecido';
                                        return <Line key={entityId} type="monotone" dataKey={entityName} stroke={CHART_COLORS[index % CHART_COLORS.length]} strokeWidth={2} />
                                    })}
                                </LineChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader><CardTitle>Dados Detalhados</CardTitle></CardHeader>
                        <CardContent>
                            <ScrollArea className="h-64">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Fornecedor</TableHead>
                                            <TableHead>Preço Pacote</TableHead>
                                            <TableHead>Preço p/ Unidade Base</TableHead>
                                            <TableHead>Data</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {filteredHistory.map(entry => (
                                            <TableRow key={entry.id}>
                                                <TableCell>{entityMap.get(entry.entityId)}</TableCell>
                                                <TableCell>{formatCurrency(entry.price)}</TableCell>
                                                <TableCell>{formatCurrency(entry.pricePerUnit)}</TableCell>
                                                <TableCell>{format(parseISO(entry.confirmedAt), 'dd/MM/yyyy')}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </ScrollArea>
                        </CardContent>
                    </Card>
                </>
            )}
        </div>
    );
}

const CHART_COLORS = [
    'hsl(var(--chart-1))',
    'hsl(var(--chart-2))',
    'hsl(var(--chart-3))',
    'hsl(var(--chart-4))',
    'hsl(var(--chart-5))',
];