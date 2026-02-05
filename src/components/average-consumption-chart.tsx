
"use client"

import { useMemo, useState, useEffect, useCallback } from "react"
import { format, startOfMonth, addMonths, isWithinInterval, parseISO, endOfMonth, subMonths, startOfYear } from "date-fns"
import { ptBR } from 'date-fns/locale'
import dynamic from 'next/dynamic'

// Hooks
import { useValidatedConsumptionData } from "@/hooks/useValidatedConsumptionData"
import { useProducts } from "@/hooks/use-products"
import { useKiosks } from "@/hooks/use-kiosks"
import { convertValue } from '@/lib/conversion';
import { useToast } from "@/hooks/use-toast";


// UI Components
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Skeleton } from "@/components/ui/skeleton"
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts'
import { TrendingUp, TrendingDown, Minus, Inbox, Check, BarChart3, ChevronsUpDown, Repeat, Info, CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from "@/lib/utils"
import { Badge } from "./ui/badge"
import { type BaseProduct, type Product } from "@/types"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "./ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs"
import { MultiSelect } from "@/components/ui/multi-select"
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from "./ui/button"
import { ConsumptionComparisonModal } from "./consumption-comparison-modal"
import { Separator } from './ui/separator';
import { Label } from "./ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover"

type YearMonth = { year: number, month: number }; // 1-based month

const stdDev = (arr: number[]): number => {
    if (arr.length === 0) return 0;
    const mean = arr.reduce((a, b) => a + b) / arr.length;
    return Math.sqrt(arr.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / arr.length);
};

const CHART_COLORS = [
    'hsl(var(--chart-1))',
    'hsl(var(--chart-2))',
    'hsl(var(--chart-3))',
    'hsl(var(--chart-4))',
    'hsl(var(--chart-5))',
];

type CardModel = {
  id: string;
  name: string;
  unit: string;
  series: { label: string; value: number }[];
  periodAvg: number;
  histAvg: number;
  periodChangePct: number;
  historicalChangePct: number;
  historicalStatus: 'normal' | 'acima' | 'abaixo' | 'sem dados';
  volatility: 'Alta' | 'Média' | 'Baixa' | 'N/A';
  abcClass: 'A' | 'B' | null;
  alertState: 'alert' | 'attention' | 'ok' | 'no_data';
  baseProduct: BaseProduct;
};


function CustomTooltip({ active, payload, label }: any) {
  if (active && payload && payload.length) {
    return (
      <div className="p-2 bg-background/80 border rounded-md shadow-lg">
        <p className="text-xs font-bold">{label}</p>
        <p className="text-sm text-primary">{`Consumo: ${payload[0].value.toFixed(1)}`}</p>
      </div>
    );
  }
  return null;
}

function MonthPicker({
    value,
    onChange,
    disabledMonths,
}: {
    value: YearMonth;
    onChange: (newValue: YearMonth) => void;
    disabledMonths?: (date: YearMonth) => boolean;
}) {
    const [viewYear, setViewYear] = useState(value.year);
    const months = Array.from({ length: 12 }, (_, i) => i + 1);

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setViewYear(y => y - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                <span className="font-semibold">{viewYear}</span>
                <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setViewYear(y => y + 1)} disabled={viewYear >= new Date().getFullYear()}><ChevronRight className="h-4 w-4" /></Button>
            </div>
            <div className="grid grid-cols-3 gap-1">
                {months.map(month => {
                    const monthDate = { year: viewYear, month };
                    const isDisabled = disabledMonths ? disabledMonths(monthDate) : false;
                    const isSelected = value.year === viewYear && value.month === month;
                    return (
                        <Button
                            key={month}
                            variant={isSelected ? 'default' : 'ghost'}
                            size="sm"
                            className="h-8"
                            disabled={isDisabled}
                            onClick={() => onChange(monthDate)}
                        >
                            {format(new Date(viewYear, month - 1), 'MMM', { locale: ptBR })}
                        </Button>
                    );
                })}
            </div>
        </div>
    );
}

const compareYearMonth = (a: YearMonth, b: YearMonth) => {
    if (a.year !== b.year) return a.year - b.year;
    return a.month - b.month;
};

const formatYearMonth = (ym: YearMonth) => {
    return format(new Date(ym.year, ym.month - 1), 'MMM/yy', { locale: ptBR });
}

function PeriodRangePicker({
    value,
    onChange,
    availablePeriods
}: {
    value: { from: YearMonth, to: YearMonth };
    onChange: (newValue: { from: YearMonth, to: YearMonth }) => void;
    availablePeriods: YearMonth[];
}) {
    const [open, setOpen] = useState(false);
    const [activePicker, setActivePicker] = useState<'from' | 'to'>('from');

    const handleMonthSelect = (ym: YearMonth) => {
        let newPeriod = { ...value };
        if (activePicker === 'from') {
            newPeriod.from = ym;
            if (compareYearMonth(ym, newPeriod.to) > 0) {
                newPeriod.to = ym; // Auto-swap
            }
            setActivePicker('to'); // Move to next picker
        } else {
            newPeriod.to = ym;
            if (compareYearMonth(newPeriod.from, ym) > 0) {
                newPeriod.from = ym; // Auto-swap
            }
            setOpen(false); // Close on second selection
        }
        onChange(newPeriod);
    };
    
    const handlePreset = (preset: '3m' | '6m' | '12m' | 'ytd') => {
        const today = new Date();
        const lastFullMonth = subMonths(today, 1);
        let fromDate: Date;

        switch(preset) {
            case '3m': fromDate = subMonths(lastFullMonth, 2); break;
            case '6m': fromDate = subMonths(lastFullMonth, 5); break;
            case '12m': fromDate = subMonths(lastFullMonth, 11); break;
            case 'ytd': fromDate = startOfYear(today); break;
        }

        const newPeriod = {
            from: { year: fromDate.getFullYear(), month: fromDate.getMonth() + 1 },
            to: { year: lastFullMonth.getFullYear(), month: lastFullMonth.getMonth() + 1 }
        };
        onChange(newPeriod);
        setOpen(false);
    }
    
    const disabledMonthCheck = (date: YearMonth) => {
        const today = new Date();
        const currentYm = { year: today.getFullYear(), month: today.getMonth() + 1 };
        return compareYearMonth(date, currentYm) >= 0;
    }


    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button variant="outline" className="h-10 w-full md:w-[250px] justify-start text-left font-normal gap-2">
                    <CalendarDays className="h-4 w-4 text-muted-foreground" />
                    <span>{formatYearMonth(value.from)}</span>
                    <span className="text-muted-foreground">-</span>
                    <span>{formatYearMonth(value.to)}</span>
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 flex" align="start">
                 <div className="p-2 border-r">
                    <div className="flex flex-col gap-1">
                        <Button variant="ghost" className="justify-start" onClick={() => handlePreset('3m')}>Últimos 3 meses</Button>
                        <Button variant="ghost" className="justify-start" onClick={() => handlePreset('6m')}>Últimos 6 meses</Button>
                        <Button variant="ghost" className="justify-start" onClick={() => handlePreset('12m')}>Últimos 12 meses</Button>
                        <Button variant="ghost" className="justify-start" onClick={() => handlePreset('ytd')}>Este ano</Button>
                    </div>
                </div>
                <div className="p-3 grid grid-cols-2 gap-3">
                    <div>
                        <div className="text-center text-sm font-semibold mb-2 py-1.5 border-b-2" style={{ borderColor: activePicker === 'from' ? 'hsl(var(--primary))' : 'transparent' }}>De</div>
                        <MonthPicker value={value.from} onChange={handleMonthSelect} disabledMonths={disabledMonthCheck} />
                    </div>
                     <div>
                        <div className="text-center text-sm font-semibold mb-2 py-1.5 border-b-2" style={{ borderColor: activePicker === 'to' ? 'hsl(var(--primary))' : 'transparent' }}>Até</div>
                        <MonthPicker value={value.to} onChange={handleMonthSelect} disabledMonths={disabledMonthCheck} />
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}

function ConsumptionCard({ data, onCompareClick, formatDisplayQuantity, periodIcon: PeriodIcon, periodLabel }: { 
    data: CardModel, 
    onCompareClick: (data: CardModel) => void, 
    formatDisplayQuantity: (qty: number, bp: BaseProduct) => string,
    periodIcon: React.ElementType,
    periodLabel: string,
}) {
  const periodColorClass = data.periodChangePct > 5 ? "text-destructive" : data.periodChangePct < -5 ? "text-green-600" : "text-muted-foreground";

  const periodColorValue = useMemo(() => {
    if (data.periodChangePct > 5) return 'hsl(var(--destructive))';
    if (data.periodChangePct < -5) return 'hsl(var(--chart-2))'; // Using chart-2 for green
    return 'hsl(var(--muted-foreground))';
  }, [data.periodChangePct]);

  let historicalText, historicalColor;
  switch(data.historicalStatus) {
      case 'acima':
          historicalText = `${data.historicalChangePct.toFixed(0)}% acima do padrão histórico`;
          historicalColor = "text-destructive";
          break;
      case 'abaixo':
           historicalText = `${Math.abs(data.historicalChangePct).toFixed(0)}% abaixo do padrão histórico`;
           historicalColor = "text-green-600";
           break;
      case 'normal':
           historicalText = "Dentro do padrão histórico";
           historicalColor = "text-muted-foreground";
           break;
      default:
           historicalText = "Histórico de consumo insuficiente";
           historicalColor = "text-muted-foreground";
  }

  const volatilityText = {
      'Alta': 'Consumo imprevisível',
      'Média': 'Consumo com variações',
      'Baixa': 'Padrão de consumo estável',
      'N/A': 'Não aplicável'
  }[data.volatility];

  const stateStyles = {
    alert: 'border-destructive/40 bg-destructive/5',
    attention: 'border-orange-500/40 bg-orange-500/5',
    ok: 'border-border',
    no_data: 'border-border'
  };
  
  const formattedPeriod = formatDisplayQuantity(data.periodAvg, data.baseProduct);
  const formattedHist = formatDisplayQuantity(data.histAvg, data.baseProduct);


  return (
    <Card className={cn("flex flex-col h-full", stateStyles[data.alertState])}>
      <CardHeader className="pb-2">
        <div className="flex justify-between items-start">
             <TooltipProvider>
                <UITooltip>
                    <TooltipTrigger asChild>
                        <CardTitle className="text-base font-semibold leading-tight line-clamp-2">{data.name} ({data.unit})</CardTitle>
                    </TooltipTrigger>
                    <TooltipContent>
                        <p>Período analisado: {periodLabel}</p>
                    </TooltipContent>
                </UITooltip>
            </TooltipProvider>
            <div className="flex items-center gap-1">
                <TooltipProvider>
                    <UITooltip>
                        <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground" onClick={(e) => {e.stopPropagation(); onCompareClick(data);}}>
                                <Repeat className="h-4 w-4"/>
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>Comparar com Transferências</p>
                        </TooltipContent>
                    </UITooltip>
                </TooltipProvider>
            </div>
        </div>
      </CardHeader>
      <CardContent className="flex-grow">
        <div className={cn("text-4xl font-bold flex items-center gap-2", periodColorClass)}>
          <PeriodIcon className="h-8 w-8" />
          <span>{data.periodChangePct.toFixed(0)}%</span>
        </div>
         <p className="text-xs text-muted-foreground">Variação no período</p>
         <p className={cn("text-xs font-semibold mt-1", historicalColor)}>{historicalText}</p>

         <div className="h-[60px] mt-4 -mx-4">
           <ResponsiveContainer width="100%" height="100%">
             <AreaChart data={data.series}>
               <defs>
                 <linearGradient id={`fill-${data.id}`} x1="0" y1="0" x2="0" y2="1">
                   <stop offset="5%" stopColor={periodColorValue} stopOpacity={0.4} />
                   <stop offset="95%" stopColor={periodColorValue} stopOpacity={0} />
                 </linearGradient>
               </defs>
               <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'hsl(var(--primary))', strokeWidth: 1, strokeDasharray: '3 3' }} />
               <ReferenceLine y={data.histAvg} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 4" strokeWidth={1.5} />
               <Area
                 key={`area-${data.id}`}
                 type="monotone"
                 dataKey="value"
                 stroke={periodColorValue}
                 strokeWidth={2.5}
                 fillOpacity={1}
                 fill={`url(#fill-${data.id})`}
                 dot={((props: any) => {
                   const { cx, cy, index } = props;
                   if (index === data.series.length - 1) {
                     return <circle key={index} cx={cx} cy={cy} r={4} fill={periodColorValue} stroke={"hsl(var(--card))"} strokeWidth={2} />;
                   }
                   return null;
                 }) as any}
                 activeDot={{ r: 5, strokeWidth: 2, stroke: "hsl(var(--card))" }}
               />
             </AreaChart>
           </ResponsiveContainer>
         </div>
      </CardContent>
       <CardFooter className="flex-col items-start text-xs border-t pt-3 pb-3">
        <div className="grid grid-cols-2 gap-x-4 w-full">
            <div className="space-y-1">
                <p className="text-xs text-muted-foreground uppercase">Média Período</p>
                <div>
                    <p className="text-sm font-bold text-foreground">{formattedPeriod}/mês</p>
                </div>
            </div>
            <div className="space-y-1">
                <p className="text-xs text-muted-foreground uppercase">Média Histórica</p>
                <div>
                    <p className="text-sm font-bold text-foreground">{formattedHist}/mês</p>
                </div>
            </div>
        </div>
        <Separator className="my-2" />
        <div className="flex justify-between items-center w-full">
            <div>
                <span className="text-xs text-muted-foreground uppercase">Volatilidade: </span> 
                <span className="font-semibold text-foreground">{volatilityText}</span>
            </div>
        </div>
    </CardFooter>
    </Card>
  )
}


export function AverageConsumptionChart() {
    // State
    const [period, setPeriod] = useState<{ from: YearMonth, to: YearMonth } | null>(null);
    const [selectedBaseProducts, setSelectedBaseProducts] = useState<string[]>([]);
    const [view, setView] = useState<'cards' | 'chart'>('cards');
    const [kioskId, setKioskId] = useState<string>('all');
    const [comparisonModalData, setComparisonModalData] = useState<{
      open: boolean;
      baseProduct: BaseProduct | null;
    }>({ open: false, baseProduct: null });

    // Data Hooks
    const { reports: consumptionReports, isLoading: consumptionLoading, baseProducts, integrityReport } = useValidatedConsumptionData();
    const { products, loading: productsLoading } = useProducts();
    const { kiosks, loading: kiosksLoading } = useKiosks();

    const loading = consumptionLoading || productsLoading || kiosksLoading;
    
    const availablePeriods = useMemo(() => {
        if (loading) return [];
        const periods = new Set<string>();
        consumptionReports.forEach(report => {
            if (report && report.year && report.month) {
             periods.add(`${report.year}-${String(report.month).padStart(2, '0')}`);
            }
        });
        return Array.from(periods)
            .map(p => {
                const [year, month] = p.split('-').map(Number);
                return { year, month };
            })
            .sort((a,b) => (b.year - a.year) || (b.month - a.month));
    }, [consumptionReports, loading]);

    useEffect(() => {
        if (!loading && availablePeriods.length > 0 && !period) {
            const to = availablePeriods[0];
            const from = availablePeriods[Math.min(2, availablePeriods.length - 1)];
            setPeriod({ from, to });
        }
    }, [availablePeriods, loading, period]);
    
    const { startPeriod, endPeriod } = useMemo(() => {
        if (!period) return { startPeriod: null, endPeriod: null };
        return {
            startPeriod: `${period.from.year}-${String(period.from.month).padStart(2, '0')}`,
            endPeriod: `${period.to.year}-${String(period.to.month).padStart(2, '0')}`
        };
    }, [period]);

  const formatDisplayQuantity = useCallback((baseQuantity: number, baseProduct: BaseProduct): string => {
      const formatNumber = (value: number) => {
        const options: Intl.NumberFormatOptions = {
          maximumFractionDigits: 1,
        };
        if (value % 1 === 0) {
            options.maximumFractionDigits = 0;
        }
        return value.toLocaleString('pt-BR', options);
      };

      return `${formatNumber(baseQuantity)} ${baseProduct.unit}`;
  
  }, []);
    
    const { monthlyConsumptions, historicalAverages, abcClasses, deviations } = useMemo(() => {
        if (loading) return { monthlyConsumptions: new Map(), historicalAverages: new Map(), abcClasses: { A: [] as string[], B: [] as string[] }, deviations: new Map() };

        const kioskFilteredReports = kioskId === 'all' 
            ? consumptionReports 
            : consumptionReports.filter(r => r.kioskId === kioskId);

        const consumptions = new Map<string, Map<string, number>>(); // Map<baseProductId, Map<monthStr, quantity>>
        const totals = new Map<string, number>();
        const monthsWithConsumption = new Map<string, Set<string>>();
        let totalNetworkConsumption = 0;
        const consumptionByProduct = new Map<string, number>();

        kioskFilteredReports.forEach(report => {
            const monthStr = `${report.year}-${String(report.month).padStart(2, '0')}`;
            report.results.forEach(item => {
                if (!item.baseProductId) return;
                
                if (!consumptions.has(item.baseProductId)) {
                    consumptions.set(item.baseProductId, new Map());
                }
                const monthMap = consumptions.get(item.baseProductId)!;
                monthMap.set(monthStr, (monthMap.get(monthStr) || 0) + item.consumedQuantity);
                
                if (!monthsWithConsumption.has(item.baseProductId)) {
                    monthsWithConsumption.set(item.baseProductId, new Set());
                }
                if (item.consumedQuantity > 0) {
                    monthsWithConsumption.get(item.baseProductId)!.add(monthStr);
                    totals.set(item.baseProductId, (totals.get(item.baseProductId) || 0) + item.consumedQuantity);
                    const currentTotal = consumptionByProduct.get(item.baseProductId) || 0;
                    consumptionByProduct.set(item.baseProductId, currentTotal + item.consumedQuantity);
                    totalNetworkConsumption += item.consumedQuantity;
                }
            });
        });

        const averages = new Map<string, number>();
        totals.forEach((total, bpId) => {
            const monthsCount = monthsWithConsumption.get(bpId)?.size || 1;
            averages.set(bpId, total / monthsCount);
        });

        const devMap = new Map<string, number>();
        consumptions.forEach((monthData, bpId) => {
            devMap.set(bpId, stdDev(Array.from(monthData.values())));
        });

        const consumptionPercentages: { id: string; total: number; percentage: number }[] = Array.from(consumptionByProduct.entries()).map(([id, total]) => ({
            id,
            total,
            percentage: totalNetworkConsumption > 0 ? (total / totalNetworkConsumption) * 100 : 0
        }));
        consumptionPercentages.sort((a,b) => b.total - a.total);
        
        const classA: string[] = consumptionPercentages.slice(0, 5).map(p => p.id);
        const classB: string[] = consumptionPercentages.slice(5).map(p => p.id);

        return { monthlyConsumptions: consumptions, historicalAverages: averages, abcClasses: { A: classA, B: classB }, deviations: devMap };

    }, [loading, consumptionReports, kioskId]);
    
     useEffect(() => {
        if (!loading && baseProducts.length > 0 && selectedBaseProducts.length === 0) {
            const topOfensores = Array.from(deviations.entries())
                .sort(([, a], [, b]) => b - a)
                .slice(0, 3)
                .map(([id]) => id);
            setSelectedBaseProducts(topOfensores);
        }
    }, [loading, baseProducts, deviations, selectedBaseProducts.length]);


    const chartData = useMemo(() => {
        if (!startPeriod || !endPeriod || selectedBaseProducts.length === 0 || loading) {
            return [];
        }
        
        const uniqueUnitsOnSelected = new Set(selectedBaseProducts.map(bpId => baseProducts.find(p => p.id === bpId)?.unit).filter(Boolean));
        const usePercentage = uniqueUnitsOnSelected.size > 1;

        const [startYear, startMonth] = startPeriod.split('-').map(Number);
        const [endYear, endMonth] = endPeriod.split('-').map(Number);
        
        const start = startOfMonth(new Date(startYear, startMonth - 1, 1));
        const end = endOfMonth(new Date(endYear, endMonth - 1, 1));
        
        const interval: Date[] = [];
        let current = start;
        while (current <= end) {
            interval.push(current);
            current = addMonths(current, 1);
        }

        return interval.map(month => {
            const monthStr = format(month, 'yyyy-MM');
            const dayData: Record<string, any> = {
                date: format(month, 'MMM/yy', {locale: ptBR}),
            };
            selectedBaseProducts.forEach(bpId => {
                const bp = baseProducts.find(p => p.id === bpId);
                if (bp) {
                    const monthlyValue = monthlyConsumptions.get(bpId)?.get(monthStr) || 0;
                    if(usePercentage) {
                        const historicalAvg = historicalAverages.get(bpId);
                        if (historicalAvg && historicalAvg > 0) {
                            dayData[bp.name] = ((monthlyValue / historicalAvg) - 1) * 100;
                        } else {
                            dayData[bp.name] = monthlyValue > 0 ? 100 : 0;
                        }
                    } else {
                         dayData[bp.name] = monthlyValue;
                    }
                }
            });
            return dayData;
        });
    }, [startPeriod, endPeriod, selectedBaseProducts, loading, baseProducts, monthlyConsumptions, historicalAverages]);
    
     const availableBaseProducts = useMemo(() => {
        return baseProducts;
    }, [baseProducts]);

    const productOptions = useMemo(() => 
        availableBaseProducts.map(p => ({ value: p.id, label: p.name })),
    [availableBaseProducts]);
    
    const cardData: CardModel[] = useMemo(() => {
        if (loading || !startPeriod || !endPeriod) return [];
        
        const baseList = selectedBaseProducts.length > 0 ? baseProducts.filter(bp => selectedBaseProducts.includes(bp.id)) : availableBaseProducts;

        const [startYear, startMonth] = startPeriod.split('-').map(Number);
        const [endYear, endMonth] = endPeriod.split('-').map(Number);
        
        const start = startOfMonth(new Date(startYear, startMonth - 1, 1));
        const end = endOfMonth(new Date(endYear, endMonth - 1, 1));

        return baseList.map(bp => {
            const histAvg = historicalAverages.get(bp.id) || 0;
            const deviation = deviations.get(bp.id) || 0;

            const consumptionsInPeriod: { label: string; value: number }[] = (Array.from((monthlyConsumptions.get(bp.id) || new Map<string, number>()).entries()) as [string, number][])
                .filter(([monthStr]: [string, number]) => {
                    const monthDate = parseISO(`${monthStr}-01`);
                    return isWithinInterval(monthDate, {start, end});
                })
                .map(([label, value]: [string, number]): { label: string; value: number } => ({ label: format(parseISO(`${label}-01`), 'MMM/yy'), value }));
            
            const periodAvg = consumptionsInPeriod.length > 0
                ? consumptionsInPeriod.reduce((a,b) => a + b.value, 0) / consumptionsInPeriod.length
                : 0;
            
            const historicalChangePct = histAvg > 0 ? ((periodAvg / histAvg) - 1) * 100 : (periodAvg > 0 ? Infinity : 0);
            
            let periodChangePct = 0;
            if (consumptionsInPeriod.length >= 2) {
                const first = consumptionsInPeriod[0].value;
                const last = consumptionsInPeriod[consumptionsInPeriod.length - 1].value;
                periodChangePct = first > 0 ? ((last / first) - 1) * 100 : (last > 0 ? Infinity : 0);
            }

            let volatility: CardModel['volatility'] = 'N/A';
            if (histAvg > 0) {
                const cv = deviation / histAvg; // Coefficient of Variation
                if (cv > 0.5) volatility = 'Alta';
                else if (cv > 0.2) volatility = 'Média';
                else volatility = 'Baixa';
            }

            let alertState: CardModel['alertState'] = 'no_data';
            let historicalStatus: CardModel['historicalStatus'] = 'sem dados';
            if(histAvg > 0) {
                if (Math.abs(historicalChangePct) <= 15) {
                    historicalStatus = 'normal';
                    alertState = 'ok';
                } else if (Math.abs(historicalChangePct) <= 30) {
                    historicalStatus = historicalChangePct > 0 ? 'acima' : 'abaixo';
                    alertState = 'attention';
                } else {
                    historicalStatus = historicalChangePct > 0 ? 'acima' : 'abaixo';
                    alertState = 'alert';
                }
            }


            return {
                id: bp.id, name: bp.name, unit: bp.unit,
                series: consumptionsInPeriod, periodAvg, histAvg,
                periodChangePct, historicalChangePct, historicalStatus,
                volatility,
                abcClass: (abcClasses.A.includes(bp.id) ? 'A' : abcClasses.B.includes(bp.id) ? 'B' : null) as ('A' | 'B' | null),
                alertState,
                baseProduct: bp,
            };
        }).sort((a,b) => {
            const statusOrder = { 'alert': 1, 'attention': 2, 'ok': 3, 'no_data': 4 };
    
            if (statusOrder[a.alertState] !== statusOrder[b.alertState]) {
                return statusOrder[a.alertState] - statusOrder[b.alertState];
            }
            
            const isA_a = a.abcClass === 'A';
            const isA_b = b.abcClass === 'B';
            if (isA_a !== isA_b) {
                return isA_a ? -1 : 1;
            }
            
            const impactA = Math.abs(a.historicalChangePct);
            const impactB = Math.abs(b.historicalChangePct);
            return impactB - impactA;
        });
    }, [loading, startPeriod, endPeriod, selectedBaseProducts, availableBaseProducts, baseProducts, historicalAverages, deviations, monthlyConsumptions, abcClasses, products]);

    const onCompareClick = (cardData: CardModel) => {
        const bp = baseProducts.find(p => p.id === cardData.id);
        if (bp) {
          setComparisonModalData({ open: true, baseProduct: bp });
        }
    };
    
    const periodLabel = useMemo(() => {
        if (!period) return '';
        const start = formatYearMonth(period.from);
        const end = formatYearMonth(period.to);
        return `${start} - ${end}`;
    }, [period]);

    if (loading) {
        return <Skeleton className="h-96 w-full" />;
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><BarChart3 /> Análise de consumo</CardTitle>
                <CardDescription>Visualize e compare o consumo de insumos ao longo do tempo.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                
                 <div className="space-y-4">
                    <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4">
                        <div className="flex items-start gap-4">
                            <div className="flex flex-col gap-1.5">
                                <Label htmlFor="kiosk-select">Unidade</Label>
                                <Select value={kioskId} onValueChange={setKioskId}>
                                    <SelectTrigger id="kiosk-select" className="h-10 w-full md:w-[200px]">
                                        <SelectValue placeholder="Selecione a unidade" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">Todas as Unidades</SelectItem>
                                        {kiosks.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <Label>Período</Label>
                                {period && (
                                <PeriodRangePicker
                                    value={period}
                                    onChange={setPeriod}
                                    availablePeriods={availablePeriods.map(p => ({ year: p.year, month: p.month }))}
                                />
                                )}
                            </div>
                        </div>
                        <div className="flex-shrink-0">
                            <ToggleGroup type="single" value={view} onValueChange={(v) => { if (v) setView(v as any)}}>
                                <ToggleGroupItem value="cards">Cards</ToggleGroupItem>
                                <ToggleGroupItem value="chart">Comparativo</ToggleGroupItem>
                            </ToggleGroup>
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <Label>Insumos analisados</Label>
                        <div className="flex gap-2 items-center">
                            <MultiSelect
                                options={productOptions}
                                selected={selectedBaseProducts}
                                onChange={setSelectedBaseProducts}
                                placeholder="Selecione os insumos ou deixe em branco para ver os mais relevantes"
                                className="w-full"
                            />
                        </div>
                    </div>
                </div>
                
                 {view === 'cards' ? (
                     cardData.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 grid-auto-rows-fr">
                            {cardData.map(data => {
                                const PeriodIcon = data.periodChangePct > 5 ? TrendingUp : data.periodChangePct < -5 ? TrendingDown : Minus;
                                return <ConsumptionCard 
                                    key={data.id} 
                                    data={data} 
                                    onCompareClick={onCompareClick} 
                                    formatDisplayQuantity={formatDisplayQuantity}
                                    periodIcon={PeriodIcon}
                                    periodLabel={periodLabel}
                                />
                            })}
                        </div>
                     ) : (
                        <div className="flex h-64 flex-col items-center justify-center text-muted-foreground">
                            <Inbox className="h-12 w-12 mb-2"/>
                            <p>Nenhum dado de consumo para os filtros selecionados.</p>
                        </div>
                     )
                ) : (
                    <div className="h-[500px]">
                        {selectedBaseProducts.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={chartData}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis dataKey="date" />
                                    <YAxis tickFormatter={(value: number) => value.toLocaleString()} />
                                    <Tooltip formatter={(value: number) => value.toLocaleString()} />
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
                                <p>Selecione um ou mais insumos para visualizar o gráfico comparativo.</p>
                            </div>
                        )}
                    </div>
                )}
            </CardContent>
            <ConsumptionComparisonModal
                open={comparisonModalData.open}
                onOpenChange={(open) => setComparisonModalData({ open, baseProduct: null })}
                baseProduct={comparisonModalData.baseProduct}
                kioskId={kioskId}
                startPeriod={startPeriod || ''}
                endPeriod={endPeriod || ''}
            />
        </Card>
    );
}
