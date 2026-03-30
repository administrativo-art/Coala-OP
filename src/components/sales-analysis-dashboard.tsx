"use client";

import { useMemo, useState, useEffect } from 'react';
import { format, subDays, startOfMonth, endOfMonth, isWithinInterval, parseISO, subMonths, isSameDay, differenceInCalendarDays } from 'date-fns';
import { useSalesReports } from '@/contexts/sales-report-context';
import { SalesReportProvider } from '@/components/sales-report-provider';
import { useKiosks } from '@/hooks/use-kiosks';
import { useAuth } from '@/hooks/use-auth';
import { useProductSimulation } from '@/hooks/use-product-simulation';
import { useProductSimulationCategories } from '@/hooks/use-product-simulation-categories';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell, ComposedChart, Line } from 'recharts';
import { TrendingUp, Award, Inbox, ShoppingBag, Calendar, CalendarRange, GitCompare, TrendingDown, PieChart as PieIcon, BarChart2, Search, ArrowUpDown, ArrowUp, ArrowDown, Clock, RefreshCw, Layers, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { syncDayClient } from '@/lib/integrations/pdv-legal-client';

const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const MONTH_NUMS = [1,2,3,4,5,6,7,8,9,10,11,12];
const COLORS = ['#E91E8C','#6366F1','#10B981','#F59E0B','#EF4444','#8B5CF6','#06B6D4','#84CC16','#F97316','#EC4899'];

type FilterMode = 'overview' | 'compare';

export function SalesAnalysisDashboard() {
  return <SalesReportProvider><SalesAnalysisDashboardInner /></SalesReportProvider>;
}

function SalesAnalysisDashboardInner() {
  const { salesReports, loading: reportsLoading } = useSalesReports();
  const { kiosks } = useKiosks();
  const { user, permissions } = useAuth();
  const { simulations } = useProductSimulation();
  const { categories } = useProductSimulationCategories();
  const { toast } = useToast();

  const isAdmin = permissions.settings.manageUsers;
  const loading = reportsLoading;

  const availableKiosks = useMemo(() => {
    if (isAdmin) return kiosks;
    return kiosks.filter(k => user?.assignedKioskIds?.includes(k.id));
  }, [kiosks, user, isAdmin]);

  // Filtros
  const [selectedKioskId, setSelectedKioskId] = useState<string>('all');
  const [filterMode, setFilterMode] = useState<FilterMode>('overview');
  const [activePreset, setActivePreset] = useState<string>('yesterday');
  const [dateRange, setDateRange] = useState({
    start: format(subDays(new Date(), 1), 'yyyy-MM-dd'),
    end: format(subDays(new Date(), 1), 'yyyy-MM-dd')
  });
  
  // Sort and search states
  const [rankingSearch, setRankingSearch] = useState<string>('');
  const [rankingSortDir, setRankingSortDir] = useState<'asc' | 'desc'>('desc');
  const [abcSearch, setAbcSearch] = useState<string>('');
  const [hoveredProduct, setHoveredProduct] = useState<string | null>(null);

  const [compareMonths, setCompareMonths] = useState<string[]>([
    String(new Date().getMonth() || 12),
    String(new Date().getMonth() + 1 > 12 ? 1 : new Date().getMonth() + 1),
  ]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState('');
  const [selectedHour, setSelectedHour] = useState<string | null>(null);

  const applyPreset = (preset: string) => {
    if (preset === 'custom') {
      setActivePreset('custom');
      return;
    }

    const today = new Date();
    let start = today;
    let end = today;

    switch (preset) {
      case 'yesterday':
        start = end = subDays(today, 1);
        break;
      case 'today':
        start = end = today;
        break;
      case 'thisMonth':
        start = startOfMonth(today);
        end = today;
        break;
      case 'lastMonth':
        const lastMonth = subMonths(today, 1);
        start = startOfMonth(lastMonth);
        end = endOfMonth(lastMonth);
        break;
    }

    setDateRange({
      start: format(start, 'yyyy-MM-dd'),
      end: format(end, 'yyyy-MM-dd')
    });
    setActivePreset(preset);
  };

  const filteredReports = useMemo(() => {
    const start = parseISO(dateRange.start);
    const end = parseISO(dateRange.end);

    return salesReports.filter(r => {
      const kioskMatch = selectedKioskId === 'all' || r.kioskId === selectedKioskId;
      const userKioskMatch = isAdmin || user?.assignedKioskIds?.includes(r.kioskId);
      
      // Lógica de Data
      let dateMatch = false;
      if (r.day) {
        // Relatório diário: verifica se está no intervalo
        const reportDate = new Date(r.year, r.month - 1, r.day);
        dateMatch = isWithinInterval(reportDate, { start, end }) || isSameDay(reportDate, start) || isSameDay(reportDate, end);
      } else {
        // Relatório mensal: se o intervalo cobrir o mês inteiro ou se o preset for mensal
        // Para simplificar, se não houver 'day', consideramos o dia 1 do mês
        const reportMonthStart = new Date(r.year, r.month - 1, 1);
        const reportMonthEnd = endOfMonth(reportMonthStart);
        
        // Verifica se há sobreposição entre o intervalo do relatório (mês) e o filtro do usuário
        dateMatch = (reportMonthStart <= end && reportMonthEnd >= start);
        
        // Se estivermos em um preset diário (Ontem/Hoje), ignoramos relatórios sem 'day'
        if ((activePreset === 'yesterday' || activePreset === 'today') && !r.day) {
          dateMatch = false;
        }
      }

      return kioskMatch && userKioskMatch && dateMatch;
    });
  }, [salesReports, selectedKioskId, dateRange, activePreset, isAdmin, user]);

  const simulationMap = useMemo(() => new Map(simulations.map(s => [s.id, s])), [simulations]);
  const categoryMap = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories]);

  // ── RANKING ────────────────────────────────────────────────────────────────
  const productRanking = useMemo(() => {
    const totals: Record<string, { name: string; quantity: number; simulationId: string }> = {};
    filteredReports.forEach(r => r.items.forEach(item => {
      if (!totals[item.simulationId]) totals[item.simulationId] = { name: item.productName, quantity: 0, simulationId: item.simulationId };
      totals[item.simulationId].quantity += item.quantity;
    }));
    return Object.values(totals).sort((a, b) => b.quantity - a.quantity);
  }, [filteredReports]);

  // ── CARDS DE RESUMO ────────────────────────────────────────────────────────
  const summaryCards = useMemo(() => {
    const totalUnits = productRanking.reduce((s, p) => s + p.quantity, 0);
    const topProduct = productRanking[0] || null;

    const totalCoupons = filteredReports.reduce((sum, r) => {
      if (!r.hourlySales) return sum;
      return sum + Object.values(r.hourlySales).reduce((a: any, b: any) => Number(a) + Number(b), 0);
    }, 0);

    // Cálculo do período anterior para variação
    const start = parseISO(dateRange.start);
    const end = parseISO(dateRange.end);
    const diff = differenceInCalendarDays(end, start) + 1;
    const prevStart = subDays(start, diff);
    const prevEnd = subDays(end, diff);

    const prevReports = salesReports.filter(r => {
      const kioskMatch = selectedKioskId === 'all' || r.kioskId === selectedKioskId;
      const userKioskMatch = isAdmin || user?.assignedKioskIds?.includes(r.kioskId);
      
      if (!r.day) return false;
      const reportDate = new Date(r.year, r.month - 1, r.day);
      const inRange = isWithinInterval(reportDate, { start: prevStart, end: prevEnd }) || 
                      isSameDay(reportDate, prevStart) || isSameDay(reportDate, prevEnd);
      
      return kioskMatch && userKioskMatch && inRange;
    });

    const prevTotal = prevReports.reduce((s, r) => s + r.items.reduce((ss, i) => ss + i.quantity, 0), 0);
    const variation = prevTotal > 0 ? ((totalUnits - prevTotal) / prevTotal) * 100 : null;

    return { totalUnits, topProduct, variation, uniqueProducts: productRanking.length, totalCoupons };
  }, [productRanking, selectedKioskId, salesReports, isAdmin, user, dateRange, filteredReports]);

  // ── CURVA ABC ─────────────────────────────────────────────────────────────
  const abcCurve = useMemo(() => {
    const total = productRanking.reduce((sum, p) => sum + p.quantity, 0);
    if (total === 0) return [];
    let accumulated = 0;
    return productRanking.map(p => {
      accumulated += p.quantity;
      const pct = (accumulated / total) * 100;
      const cls = pct <= 80 ? 'A' : pct <= 95 ? 'B' : 'C';
      return { ...p, pct: (p.quantity / total * 100).toFixed(1), accumulated: pct.toFixed(1), class: cls };
    });
  }, [productRanking]);

  // ── PRODUTOS EM QUEDA (últimos 6 meses) ────────────────────────────────────
  const decliningProducts = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    const last6: { year: number; month: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      let m = currentMonth - i;
      let y = currentYear;
      if (m <= 0) { m += 12; y -= 1; }
      last6.push({ year: y, month: m });
    }

    const byProduct: Record<string, { name: string; byMonth: Record<string, number> }> = {};
    salesReports
      .filter(r => isAdmin || user?.assignedKioskIds?.includes(r.kioskId))
      .forEach(r => {
        const key = `${r.year}-${r.month}`;
        if (!last6.find(m => m.year === r.year && m.month === r.month)) return;
        r.items.forEach(item => {
          if (!byProduct[item.simulationId]) byProduct[item.simulationId] = { name: item.productName, byMonth: {} };
          byProduct[item.simulationId].byMonth[key] = (byProduct[item.simulationId].byMonth[key] || 0) + item.quantity;
        });
      });

    return Object.entries(byProduct).map(([simId, data]) => {
      const values = last6.map((m, i) => ({
        x: i,
        y: data.byMonth[`${m.year}-${m.month}`] || 0,
        label: MONTHS[m.month - 1],
      }));

      const n = values.length;
      const sumX = values.reduce((s, v) => s + v.x, 0);
      const sumY = values.reduce((s, v) => s + v.y, 0);
      const sumXY = values.reduce((s, v) => s + v.x * v.y, 0);
      const sumX2 = values.reduce((s, v) => s + v.x * v.x, 0);
      const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

      const avgY = sumY / n;
      const firstHalf = values.slice(0, 3).reduce((s, v) => s + v.y, 0) / 3;
      const secondHalf = values.slice(3).reduce((s, v) => s + v.y, 0) / 3;
      const variation = firstHalf > 0 ? ((secondHalf - firstHalf) / firstHalf * 100) : 0;

      return { simulationId: simId, name: data.name, slope, values, avgY, variation };
    })
    .filter(p => p.slope < 0 && p.avgY > 0)
    .sort((a, b) => a.slope - b.slope)
    .slice(0, 15);
  }, [salesReports, isAdmin, user]);

  // ── MIX POR LINHA ──────────────────────────────────────────────────────────
  const mixByLine = useMemo(() => {
    const lines: Record<string, { name: string; quantity: number }> = {};
    let noLine = 0;

    filteredReports.forEach(r => r.items.forEach(item => {
      const sim = simulationMap.get(item.simulationId);
      if (!sim?.lineId) { noLine += item.quantity; return; }
      const line = categoryMap.get(sim.lineId);
      if (!line) { noLine += item.quantity; return; }
      if (!lines[line.id]) lines[line.id] = { name: line.name, quantity: 0 };
      lines[line.id].quantity += item.quantity;
    }));

    const result = Object.values(lines).sort((a, b) => b.quantity - a.quantity);
    if (noLine > 0) result.push({ name: 'Sem linha', quantity: noLine });
    return result;
  }, [filteredReports, simulationMap, categoryMap]);

  // ── EVOLUÇÃO MENSAL ────────────────────────────────────────────────────────
  const monthlyEvolution = useMemo(() => {
    const top5 = productRanking.slice(0, 5).map(p => p.simulationId);
    if (filterMode === 'compare') {
      return productRanking.slice(0, 5).map(prod => {
        const entry: Record<string, any> = { product: prod.name };
        compareMonths.forEach(m => {
          const mn = Number(m);
          const monthLabel = MONTHS[mn - 1];
          filteredReports.filter(r => r.month === mn).forEach(r => {
            r.items.forEach(item => {
              if (item.simulationId !== prod.simulationId) return;
              entry[monthLabel] = (entry[monthLabel] || 0) + item.quantity;
            });
          });
        });
        return entry;
      });
    }
    const byMonth: Record<number, Record<string, number>> = {};
    filteredReports.forEach(r => {
      if (!byMonth[r.month]) byMonth[r.month] = {};
      r.items.forEach(item => {
        if (!top5.includes(item.simulationId)) return;
        byMonth[r.month][item.productName] = (byMonth[r.month][item.productName] || 0) + item.quantity;
      });
    });
    return MONTH_NUMS.map(m => ({ month: MONTHS[m - 1], ...(byMonth[m] || {}) })).filter(m => Object.keys(m).length > 1);
  }, [filteredReports, productRanking, filterMode, compareMonths]);

  // ── COMPARATIVO QUIOSQUES ──────────────────────────────────────────────────
  const kioskComparison = useMemo(() => {
    const byKiosk: Record<string, { kioskName: string; total: number }> = {};
    filteredReports.filter(r => isAdmin || user?.assignedKioskIds?.includes(r.kioskId)).forEach(r => {
      if (!byKiosk[r.kioskId]) byKiosk[r.kioskId] = { kioskName: r.kioskName || r.kioskId, total: 0 };
      r.items.forEach(item => { byKiosk[r.kioskId].total += item.quantity; });
    });
    return Object.entries(byKiosk).map(([kioskId, data]) => ({ kioskId, ...data })).sort((a, b) => b.total - a.total);
  }, [filteredReports, isAdmin, user]);

  const [hourlySelectedProduct, setHourlySelectedProduct] = useState<string>('all');
  const [comboSearch, setComboSearch] = useState('');

  // ── COMBOS (CESTA DE COMPRAS) ──────────────────────────────────────────────
  const aggregatedCombos = useMemo(() => {
    const combosMap = new Map<string, number>();
    
    filteredReports.forEach(r => {
      // Ignoramos o erro de tipagem caso combos não exista no tipo antigo
      const combos = (r as any).combos || [];
      combos.forEach((c: any) => {
        combosMap.set(c.name, (combosMap.get(c.name) || 0) + c.count);
      });
    });

    let result = Array.from(combosMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    if (comboSearch) {
      result = result.filter(c => c.name.toLowerCase().includes(comboSearch.toLowerCase()));
    }

    return result;
  }, [filteredReports, comboSearch]);

  // ── VENDAS POR HORA ────────────────────────────────────────────────────────
  const hourlySalesData = useMemo(() => {
    const hours: Record<string, { total: number; products: Record<string, { simulationId: string; name: string; quantity: number }> }> = {};
    for (let i = 0; i < 24; i++) {
      hours[i.toString().padStart(2, '0')] = { total: 0, products: {} };
    }

    filteredReports.forEach(r => {
      r.items.forEach(item => {
        const hour = item.timestamp ? item.timestamp.split(':')[0] : '00';
        if (hours[hour]) {
          hours[hour].total += (item.quantity || 0);
          if (!hours[hour].products[item.simulationId]) {
            hours[hour].products[item.simulationId] = { simulationId: item.simulationId, name: item.productName, quantity: 0 };
          }
          hours[hour].products[item.simulationId].quantity += (item.quantity || 0);
        }
      });
    });

    return Object.entries(hours).map(([hour, data]) => ({ 
      hourStr: hour,
      hour: `${hour}h`, 
      total: data.total,
      products: Object.values(data.products).sort((a, b) => b.quantity - a.quantity)
    }));
  }, [filteredReports]);

  const filteredHourlyData = useMemo(() => {
    return hourlySalesData.map(d => {
      let displayValue = 0;
      if (hourlySelectedProduct === 'all') {
        displayValue = d.total;
      } else {
        const prod = d.products.find(p => p.simulationId === hourlySelectedProduct);
        displayValue = prod ? prod.quantity : 0;
      }
      return {
        ...d,
        displayValue
      };
    });
  }, [hourlySalesData, hourlySelectedProduct]);

  const handleSyncPDVLegal = async (retroactive = false) => {
    setIsSyncing(true);
    setSyncProgress(retroactive ? 'Iniciando sincronização retroativa (Janeiro → Hoje)...' : 'Sincronizando dados de ontem...');
    
    const KIOSK_MAP: Record<string, string> = {
      'tirirical': '17343',
      'joao-paulo': '17344',
    };

    try {
      const days: string[] = [];
      if (retroactive) {
        // Gera lista de dias desde 1 de Janeiro de 2026 até hoje
        const start = new Date(2026, 0, 1);
        const end = new Date();
        const current = new Date(start);
        while (current <= end) {
          days.push(current.toISOString().split('T')[0]);
          current.setDate(current.getDate() + 1);
        }
      } else {
        days.push(new Date(Date.now() - 86400000).toISOString().split('T')[0]);
      }

      const kiosksToSync = selectedKioskId === 'all' ? Object.keys(KIOSK_MAP) : [selectedKioskId];
      let processedCount = 0;
      let totalItemsCount = 0;
      const failedDays: string[] = [];
      const totalSteps = days.length * kiosksToSync.length;

      for (const day of days) {
        for (const kId of kiosksToSync) {
          const pdvFilialId = KIOSK_MAP[kId];
          if (!pdvFilialId) continue;
          
          processedCount++;
          setSyncProgress(`[${processedCount}/${totalSteps}] ${day} - ${kId}...`);
          
          try {
            const res = await syncDayClient(day, kId, pdvFilialId);
            totalItemsCount += (res.count || 0);
          } catch (e: any) {
            console.error(`[Sync Fail] ${day} ${kId}:`, e);
            failedDays.push(`${day} (${kId})`);
          }
        }
      }
      
      const successCount = (days.length * kiosksToSync.length) - failedDays.length;
      
      toast({
        title: 'Sincronização concluída!',
        description: `Sucesso: ${successCount} relatórios. Falhas: ${failedDays.length}. Itens processados: ${totalItemsCount}.`,
        variant: failedDays.length > 0 ? 'destructive' : 'default',
      });

      if (failedDays.length > 0) {
        console.warn('Dias que falharam:', failedDays);
      }
      
      // Recarregar com delay de 3 segundos para o usuário ver o toast
      console.log(`[Sync] Sucesso total: ${totalItemsCount} itens. Recarregando página em 3s...`);
      setTimeout(() => {
        window.location.reload();
      }, 3500);
    } catch (e: any) {
      console.error('[Fatal Sync Error]', e);
      toast({
        title: 'Erro Fatal na Sincronização',
        description: e.message || 'Houve um erro crítico ao sincronizar.',
        variant: 'destructive',
      });
    } finally {
      setIsSyncing(false);
      setSyncProgress('');
    }
  };

  const filteredRanking = useMemo(() => {
    let result = [...productRanking];
    if (rankingSearch) result = result.filter(p => p.name.toLowerCase().includes(rankingSearch.toLowerCase()));
    if (rankingSortDir === 'asc') result = result.reverse();
    
    // Debug da tabela no console
    console.log(`[Dashboard] Tabela Ranking: ${result.length} produtos exibidos.`, result);
    
    return result;
  }, [productRanking, rankingSearch, rankingSortDir]);

  const unmappedData = useMemo(() => {
    const unmapped = new Map<string, string>();
    filteredReports.forEach(r => {
      if ((r as any).unmappedList) {
        (r as any).unmappedList.forEach((item: any) => unmapped.set(item.sku, item.name));
      }
    });
    return Array.from(unmapped.entries()).map(([sku, name]) => ({ sku, name }));
  }, [filteredReports]);

  const filteredAbc = useMemo(() => {
    if (!abcSearch) return abcCurve;
    return abcCurve.filter(p => p.name.toLowerCase().includes(abcSearch.toLowerCase()));
  }, [abcCurve, abcSearch]);

  const top5Names = useMemo(() => productRanking.slice(0, 5).map(p => p.name), [productRanking]);

  const periodLabel = useMemo(() => {
    if (filterMode === 'compare') return compareMonths.map(m => MONTHS[Number(m) - 1]).join(' vs ');
    if (activePreset === 'yesterday') return 'Ontem';
    if (activePreset === 'today') return 'Hoje';
    if (activePreset === 'thisMonth') return 'Este Mês';
    if (activePreset === 'lastMonth') return 'Mês Passado';
    try {
      return `${format(parseISO(dateRange.start), 'dd/MM/yy')} → ${format(parseISO(dateRange.end), 'dd/MM/yy')}`;
    } catch {
      return 'Período customizado';
    }
  }, [filterMode, activePreset, dateRange, compareMonths]);

  if (loading) return <div className="space-y-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-64 w-full" /></div>;

  if (salesReports.length === 0) return (
    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
      <Inbox className="h-12 w-12 mb-4" />
      <p className="font-semibold text-lg">Nenhum dado de vendas</p>
      <p className="text-sm">Importe um relatório de vendas ou sincronize com o PDV Legal para começar.</p>
      <Button variant="outline" className="mt-4 gap-2" onClick={() => handleSyncPDVLegal(true)} disabled={isSyncing}>
        <RefreshCw className={cn("h-4 w-4", isSyncing && "animate-spin")} />
        Sincronizar PDV Legal
      </Button>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-4 items-end bg-card p-4 rounded-xl border shadow-sm">
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground ml-1">Quiosque</p>
          <Select value={selectedKioskId} onValueChange={setSelectedKioskId}>
            <SelectTrigger className="w-[180px] h-9 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os quiosques</SelectItem>
              {availableKiosks.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground ml-1">Período Prático</p>
          <ToggleGroup type="single" value={activePreset} onValueChange={v => v && applyPreset(v)} className="bg-muted/50 p-1 rounded-lg border">
            <ToggleGroupItem value="yesterday" className="h-7 px-3 text-[11px] data-[state=on]:bg-background data-[state=on]:shadow-sm">Ontem</ToggleGroupItem>
            <ToggleGroupItem value="today" className="h-7 px-3 text-[11px] data-[state=on]:bg-background data-[state=on]:shadow-sm">Hoje</ToggleGroupItem>
            <ToggleGroupItem value="thisMonth" className="h-7 px-3 text-[11px] data-[state=on]:bg-background data-[state=on]:shadow-sm">Mês Atual</ToggleGroupItem>
            <ToggleGroupItem value="lastMonth" className="h-7 px-3 text-[11px] data-[state=on]:bg-background data-[state=on]:shadow-sm">Mês Passado</ToggleGroupItem>
            <ToggleGroupItem value="custom" className="h-7 px-3 text-[11px] data-[state=on]:bg-background data-[state=on]:shadow-sm">Intervalo</ToggleGroupItem>
          </ToggleGroup>
        </div>

        {activePreset === 'custom' && (
          <div className="flex items-end gap-2 animate-in fade-in slide-in-from-left-2 grow max-w-xs">
            <div className="space-y-1.5 grow">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground ml-1">Início</p>
              <Input type="date" value={dateRange.start} onChange={e => setDateRange(prev => ({ ...prev, start: e.target.value }))} className="h-9 text-xs" />
            </div>
            <div className="space-y-1.5 grow">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground ml-1">Fim</p>
              <Input type="date" value={dateRange.end} onChange={e => setDateRange(prev => ({ ...prev, end: e.target.value }))} className="h-9 text-xs" />
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground ml-1">Análise</p>
          <ToggleGroup type="single" value={filterMode} onValueChange={v => v && setFilterMode(v as FilterMode)} className="bg-muted/50 p-1 rounded-lg border">
            <ToggleGroupItem value="overview" className="h-7 px-3 text-[11px] data-[state=on]:bg-background data-[state=on]:shadow-sm">Individual</ToggleGroupItem>
            <ToggleGroupItem value="compare" className="h-7 px-3 text-[11px] data-[state=on]:bg-background data-[state=on]:shadow-sm">Comparativo</ToggleGroupItem>
          </ToggleGroup>
        </div>

        {filterMode === 'compare' && (
          <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground ml-1">Meses para Comparar</p>
            <div className="flex gap-1 bg-muted/30 p-1 rounded-lg border">
              {[1, 2, 3, 10, 11, 12].map(m => (
                <Button key={m} size="sm" variant={compareMonths.includes(String(m)) ? 'default' : 'ghost'} className="h-7 w-10 text-[10px] px-0"
                  onClick={() => setCompareMonths(prev => prev.includes(String(m)) ? prev.filter(x => x !== String(m)) : [...prev, String(m)])}>
                  {MONTHS[m-1]}
                </Button>
              ))}
            </div>
          </div>
        )}

        <div className="ml-auto flex gap-2">
          {isAdmin && (
            <>
              <Button variant="outline" size="sm" onClick={() => handleSyncPDVLegal(false)} disabled={isSyncing} className="h-9 gap-2 shadow-sm">
                <RefreshCw className={cn("h-4 w-4", isSyncing && "animate-spin")} />
                {isSyncing ? 'Sincronizando...' : 'Sincronizar Ontem'}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => handleSyncPDVLegal(true)} disabled={isSyncing} className="h-9 gap-2 shadow-sm border">
                <Clock className="h-4 w-4" />
                Sincronizar 2026
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Badge variant="secondary">{parseISO(dateRange.start).getFullYear()}</Badge>
        <Badge variant="outline">{periodLabel}</Badge>
      </div>

      {unmappedData.length > 0 && (
        <Card className="border-orange-200 bg-orange-50/30">
          <CardHeader className="py-3">
            <CardTitle className="text-sm text-orange-800 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Produtos do PDV não mapeados ({unmappedData.length})
            </CardTitle>
            <CardDescription className="text-xs text-orange-700">
              Estes SKUs foram encontrados no PDV Legal mas não estão vinculados a nenhuma Ficha Técnica. 
              Vincule-os para que apareçam na análise.
            </CardDescription>
          </CardHeader>
          <CardContent className="py-0 pb-3">
            <div className="flex flex-wrap gap-2">
              {unmappedData.slice(0, 15).map((item, idx) => (
                <Badge key={idx} variant="outline" className="bg-background/80 text-[10px] border-orange-200">
                  <span className="font-bold mr-1">{item.sku}:</span> {item.name}
                </Badge>
              ))}
              {unmappedData.length > 15 && <span className="text-[10px] text-muted-foreground">...e mais {unmappedData.length - 15}</span>}
            </div>
          </CardContent>
        </Card>
      )}

      {productRanking.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Total de cupons</p>
              <p className="text-2xl font-bold">{summaryCards.totalCoupons.toLocaleString('pt-BR')}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Produtos vendidos</p>
              <p className="text-2xl font-bold">{summaryCards.totalUnits.toLocaleString('pt-BR')}</p>
              {summaryCards.variation !== null && (
                <p className={cn("text-xs font-semibold mt-1", summaryCards.variation >= 0 ? "text-green-600" : "text-destructive")}>
                  {summaryCards.variation >= 0 ? '▲' : '▼'} {Math.abs(summaryCards.variation).toFixed(1)}% vs anterior
                </p>
              )}
            </CardContent>
          </Card>
          <Card className="col-span-2">
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Top Produto</p>
              <p className="text-lg font-bold truncate">{summaryCards.topProduct?.name || '-'}</p>
              <p className="text-xs text-muted-foreground mt-1">{summaryCards.topProduct?.quantity.toLocaleString('pt-BR')} un</p>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs defaultValue="ranking">
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 lg:grid-cols-8 h-auto">
          <TabsTrigger value="ranking"><Award className="mr-1 h-3 w-3" /> Ranking</TabsTrigger>
          <TabsTrigger value="combos"><Layers className="mr-1 h-3 w-3" /> Combos</TabsTrigger>
          <TabsTrigger value="abc"><BarChart2 className="mr-1 h-3 w-3" /> Curva ABC</TabsTrigger>
          <TabsTrigger value="declining"><TrendingDown className="mr-1 h-3 w-3" /> Em queda</TabsTrigger>
          <TabsTrigger value="mix"><PieIcon className="mr-1 h-3 w-3" /> Mix</TabsTrigger>
          <TabsTrigger value="evolution"><TrendingUp className="mr-1 h-3 w-3" /> Evolução</TabsTrigger>
          <TabsTrigger value="hourly"><Clock className="mr-1 h-3 w-3" /> Horários</TabsTrigger>
          <TabsTrigger value="kiosks"><ShoppingBag className="mr-1 h-3 w-3" /> Quiosques</TabsTrigger>
        </TabsList>

        <TabsContent value="combos" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <CardTitle>Cesta de Compras (Combos)</CardTitle>
                  <CardDescription>Descubra os produtos mais comprados juntos no mesmo cupom.</CardDescription>
                </div>
                <div className="relative w-full sm:w-[280px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Filtrar produtos no combo..." value={comboSearch} onChange={e => setComboSearch(e.target.value)} className="pl-9" />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {aggregatedCombos.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground">
                  Nenhum dado de combos encontrado. Tente ressincronizar os relatórios para calcular as cestas de compras.
                </div>
              ) : (
                <div className="overflow-x-auto border rounded-md">
                  <table className="w-full text-sm text-left border-collapse">
                    <thead className="bg-muted text-muted-foreground uppercase text-[10px] font-bold">
                      <tr>
                        <th className="px-4 py-3 w-16">#</th>
                        <th className="px-4 py-3">Itens no mesmo Cupom</th>
                        <th className="px-4 py-3 text-right">Qtd. de Cupons</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aggregatedCombos.map((combo, idx) => (
                        <tr key={idx} className="border-t hover:bg-muted/50 transition-colors">
                          <td className="px-4 py-3 font-semibold text-muted-foreground">{idx + 1}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-2">
                              {combo.name.split(' + ').map((item, i) => {
                                const [qtd, nome] = item.split('x ');
                                return (
                                  <Badge key={i} variant="secondary" className="font-normal border">
                                    <span className="font-bold mr-1">{qtd}x</span> {nome}
                                  </Badge>
                                );
                              })}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-bold">{combo.count.toLocaleString('pt-BR')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ranking" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <CardTitle>Ranking de Vendas</CardTitle>
                <div className="relative w-[220px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Filtrar..." value={rankingSearch} onChange={e => setRankingSearch(e.target.value)} className="pl-9" />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto border rounded-md">
                <table className="w-full text-sm text-left border-collapse">
                  <thead className="bg-muted text-muted-foreground uppercase text-[10px] font-bold">
                    <tr>
                      <th className="px-4 py-3 w-10">#</th>
                      <th className="px-4 py-3">Produto</th>
                      <th className="px-4 py-3 text-right cursor-pointer" onClick={() => setRankingSortDir(d => d === 'desc' ? 'asc' : 'desc')}>
                        Qtd {rankingSortDir === 'desc' ? '↓' : '↑'}
                      </th>
                      <th className="px-4 py-3 text-right">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRanking.map((item, i) => (
                      <tr key={`${item.simulationId}-${i}`} className="border-t hover:bg-muted/50 transition-colors">
                        <td className="px-4 py-3">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</td>
                        <td className="px-4 py-3 font-medium text-foreground">{item.name || 'Sem nome'}</td>
                        <td className="px-4 py-3 text-right font-bold text-foreground">{item.quantity?.toLocaleString('pt-BR') || '0'}</td>
                        <td className="px-4 py-3 text-right text-muted-foreground">
                          {summaryCards.totalUnits > 0 ? ((item.quantity / summaryCards.totalUnits) * 100).toFixed(1) : '0'}%
                        </td>
                      </tr>
                    ))}
                    {filteredRanking.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                          Nenhum produto exibido para este filtro. (Total de {salesReports.length} relatórios carregados)
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="abc" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <CardTitle>Curva ABC</CardTitle>
                <div className="relative w-[220px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Filtrar..." value={abcSearch} onChange={e => setAbcSearch(e.target.value)} className="pl-9" />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-right">Qtd</TableHead>
                    <TableHead className="text-right">%</TableHead>
                    <TableHead className="text-right">Acum.</TableHead>
                    <TableHead className="text-right">Classe</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAbc.map((item) => (
                    <TableRow key={item.simulationId}>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell className="text-right">{item.quantity.toLocaleString('pt-BR')}</TableCell>
                      <TableCell className="text-right">{item.pct}%</TableCell>
                      <TableCell className="text-right">{item.accumulated}%</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={item.class === 'A' ? 'default' : item.class === 'B' ? 'secondary' : 'outline'}>{item.class}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="declining" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {decliningProducts.map((p) => (
              <Card key={p.simulationId}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm truncate">{p.name}</CardTitle>
                  <CardDescription className="flex justify-between">
                    <span>Tendência de queda</span>
                    <span className="text-destructive font-bold">{p.variation.toFixed(1)}%</span>
                  </CardDescription>
                </CardHeader>
                <CardContent className="h-[120px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={p.values}>
                      <Bar dataKey="y" fill="#EF4444" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="mix" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Mix por Linha de Produto</CardTitle></CardHeader>
            <CardContent className="grid md:grid-cols-2 gap-8 items-center">
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={mixByLine} dataKey="quantity" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({name, percent}) => `${name} ${(percent * 100).toFixed(0)}%`}>
                      {mixByLine.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <Table>
                <TableHeader><TableRow><TableHead>Linha</TableHead><TableHead className="text-right">Qtd</TableHead></TableRow></TableHeader>
                <TableBody>
                  {mixByLine.map((line, i) => (
                    <TableRow key={i}><TableCell className="flex items-center gap-2"><div className="w-3 h-3 rounded-full" style={{backgroundColor: COLORS[i % COLORS.length]}} />{line.name}</TableCell><TableCell className="text-right">{line.quantity.toLocaleString('pt-BR')}</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="evolution" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Evolução de Vendas (Top 5)</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={350}>
                <ComposedChart data={monthlyEvolution}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey={filterMode === 'compare' ? 'product' : 'month'} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  {filterMode === 'compare' ? (
                    compareMonths.map((m, i) => <Bar key={m} dataKey={MONTHS[Number(m)-1]} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} />)
                  ) : (
                    top5Names.map((name, i) => <Bar key={name} dataKey={name} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} />)
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="kiosks" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Vendas por Quiosque</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={kioskComparison} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis dataKey="kioskName" type="category" width={140} />
                  <Tooltip cursor={{fill: 'transparent'}} />
                  <Bar dataKey="total" fill="#E91E8C" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="hourly" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <CardTitle>Fluxo de Vendas por Horário</CardTitle>
                  <CardDescription>
                    {hourlySelectedProduct === 'all' 
                      ? 'Clique em uma barra para ver o detalhamento dos produtos vendidos naquela hora.'
                      : `Visualizando fluxo apenas para: ${productRanking.find(p => p.simulationId === hourlySelectedProduct)?.name}`}
                  </CardDescription>
                </div>
                <Select value={hourlySelectedProduct} onValueChange={setHourlySelectedProduct}>
                  <SelectTrigger className="w-full md:w-[280px]">
                    <SelectValue placeholder="Todos os produtos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os produtos (Geral)</SelectItem>
                    {productRanking.map(p => (
                      <SelectItem key={p.simulationId} value={p.simulationId}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-[320px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart 
                    data={filteredHourlyData}
                    onClick={(data) => {
                      if (data && data.activePayload && data.activePayload.length > 0) {
                        setSelectedHour(data.activePayload[0].payload.hourStr);
                      }
                    }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="hour" axisLine={false} tickLine={false} fontSize={12} />
                    <YAxis axisLine={false} tickLine={false} fontSize={12} />
                    <Tooltip 
                      cursor={{ fill: 'hsl(var(--muted)/0.3)' }}
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          return (
                            <div className="bg-popover border p-3 rounded-lg shadow-xl">
                              <p className="font-bold text-sm mb-1">{payload[0].payload.hour}</p>
                              <p className="text-pink-600 font-bold">
                                {payload[0].value} un {hourlySelectedProduct === 'all' ? 'vendidos no total' : 'vendidas deste produto'}
                              </p>
                              <p className="text-[10px] text-muted-foreground mt-1 underline">Clique para detalhar</p>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Bar dataKey="displayValue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} className="cursor-pointer" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {selectedHour && (() => {
                const hourData = filteredHourlyData.find(d => d.hourStr === selectedHour);
                if (!hourData || hourData.products.length === 0) return (
                  <div className="mt-8 text-center py-10 text-muted-foreground border-t">
                    Nenhuma venda registrada para as {selectedHour}h no período.
                  </div>
                );
                return (
                  <div className="mt-8 space-y-4 animate-in fade-in slide-in-from-top-4 duration-500 border-t pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-bold text-lg">Produtos Vendidos: {selectedHour}h</h4>
                        <p className="text-sm text-muted-foreground">Total de {hourData.total} unidades</p>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => setSelectedHour(null)}>Fechar detalhamento</Button>
                    </div>
                    <div className="overflow-x-auto border rounded-xl">
                      <table className="w-full text-sm text-left border-collapse">
                        <thead className="bg-muted text-muted-foreground uppercase text-[10px] font-bold">
                          <tr>
                            <th className="px-4 py-3">Produto</th>
                            <th className="px-4 py-3 text-right">Qtd</th>
                          </tr>
                        </thead>
                        <tbody>
                          {hourData.products.map((p, idx) => (
                            <tr key={idx} className={cn("border-t hover:bg-muted/50 transition-colors", hourlySelectedProduct === p.simulationId ? "bg-primary/10 font-semibold" : "")}>
                              <td className="px-4 py-3 font-medium">{p.name}</td>
                              <td className="px-4 py-3 text-right text-foreground">{p.quantity} un</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}