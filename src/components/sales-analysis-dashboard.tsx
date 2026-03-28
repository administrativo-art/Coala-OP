"use client";

import { useMemo, useState } from 'react';
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
import { TrendingUp, Award, Inbox, ShoppingBag, Calendar, CalendarRange, GitCompare, TrendingDown, PieChart as PieIcon, BarChart2, Search, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const MONTH_NUMS = [1,2,3,4,5,6,7,8,9,10,11,12];
const COLORS = ['#E91E8C','#6366F1','#10B981','#F59E0B','#EF4444','#8B5CF6','#06B6D4','#84CC16','#F97316','#EC4899'];

type FilterMode = 'single' | 'range' | 'compare';

export function SalesAnalysisDashboard() {
  return <SalesReportProvider><SalesAnalysisDashboardInner /></SalesReportProvider>;
}

function SalesAnalysisDashboardInner() {
  const { salesReports, loading: reportsLoading } = useSalesReports();
  const { kiosks } = useKiosks();
  const { user, permissions } = useAuth();
  const { simulations } = useProductSimulation();
  const { categories } = useProductSimulationCategories();

  const isAdmin = permissions.settings.manageUsers;
  const loading = reportsLoading;

  const availableKiosks = useMemo(() => {
    if (isAdmin) return kiosks;
    return kiosks.filter(k => user?.assignedKioskIds?.includes(k.id));
  }, [kiosks, user, isAdmin]);

  // Filtros
  const [selectedKioskId, setSelectedKioskId] = useState<string>('all');
  const [selectedYear, setSelectedYear] = useState<string>(String(new Date().getFullYear()));
  const [filterMode, setFilterMode] = useState<FilterMode>('single');
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [rangeStart, setRangeStart] = useState<string>('1');
  const [rangeEnd, setRangeEnd] = useState<string>('12');
  
  // Sort and search states
  const [rankingSearch, setRankingSearch] = useState<string>('');
  const [rankingSortDir, setRankingSortDir] = useState<'asc' | 'desc'>('desc');
  const [abcSearch, setAbcSearch] = useState<string>('');
  const [hoveredProduct, setHoveredProduct] = useState<string | null>(null);

  const [compareMonths, setCompareMonths] = useState<string[]>([
    String(new Date().getMonth() || 12),
    String(new Date().getMonth() + 1 > 12 ? 1 : new Date().getMonth() + 1),
  ]);

  const availableYears = useMemo(() => {
    const years = new Set(salesReports.map(r => String(r.year)));
    return Array.from(years).sort((a, b) => Number(b) - Number(a));
  }, [salesReports]);

  const includedMonths = useMemo((): number[] => {
    if (filterMode === 'single') return selectedMonth === 'all' ? MONTH_NUMS : [Number(selectedMonth)];
    if (filterMode === 'range') {
      const s = Number(rangeStart), e = Number(rangeEnd);
      return s <= e ? MONTH_NUMS.filter(m => m >= s && m <= e) : MONTH_NUMS.filter(m => m >= s || m <= e);
    }
    return compareMonths.map(Number);
  }, [filterMode, selectedMonth, rangeStart, rangeEnd, compareMonths]);

  const filteredReports = useMemo(() => {
    return salesReports.filter(r => {
      const kioskMatch = selectedKioskId === 'all' || r.kioskId === selectedKioskId;
      const yearMatch = !selectedYear || r.year === Number(selectedYear);
      const monthMatch = includedMonths.includes(r.month);
      const userKioskMatch = isAdmin || user?.assignedKioskIds?.includes(r.kioskId);
      return kioskMatch && yearMatch && monthMatch && userKioskMatch;
    });
  }, [salesReports, selectedKioskId, selectedYear, includedMonths, isAdmin, user]);

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

    const prevMonths = includedMonths.map(m => m - 1 <= 0 ? 12 : m - 1);
    const prevYear = includedMonths.includes(1) ? Number(selectedYear) - 1 : Number(selectedYear);

    const prevReports = salesReports.filter(r => {
      const kioskMatch = selectedKioskId === 'all' || r.kioskId === selectedKioskId;
      const yearMatch = r.year === prevYear;
      const monthMatch = prevMonths.includes(r.month);
      const userKioskMatch = isAdmin || user?.assignedKioskIds?.includes(r.kioskId);
      return kioskMatch && yearMatch && monthMatch && userKioskMatch;
    });

    const prevTotal = prevReports.reduce((s, r) => s + r.items.reduce((ss, i) => ss + i.quantity, 0), 0);
    const variation = prevTotal > 0 ? ((totalUnits - prevTotal) / prevTotal) * 100 : null;

    return { totalUnits, topProduct, variation, uniqueProducts: productRanking.length };
  }, [productRanking, includedMonths, selectedYear, selectedKioskId, salesReports, isAdmin, user]);

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
    return includedMonths.map(m => ({ month: MONTHS[m - 1], ...(byMonth[m] || {}) })).filter(m => Object.keys(m).length > 1);
  }, [filteredReports, productRanking, filterMode, compareMonths, includedMonths]);

  // ── COMPARATIVO QUIOSQUES ──────────────────────────────────────────────────
  const kioskComparison = useMemo(() => {
    const byKiosk: Record<string, { kioskName: string; total: number }> = {};
    filteredReports.filter(r => isAdmin || user?.assignedKioskIds?.includes(r.kioskId)).forEach(r => {
      if (!byKiosk[r.kioskId]) byKiosk[r.kioskId] = { kioskName: r.kioskName || r.kioskId, total: 0 };
      r.items.forEach(item => { byKiosk[r.kioskId].total += item.quantity; });
    });
    return Object.entries(byKiosk).map(([kioskId, data]) => ({ kioskId, ...data })).sort((a, b) => b.total - a.total);
  }, [filteredReports, isAdmin, user]);

  const filteredRanking = useMemo(() => {
    let result = [...productRanking];
    if (rankingSearch) result = result.filter(p => p.name.toLowerCase().includes(rankingSearch.toLowerCase()));
    if (rankingSortDir === 'asc') result = result.reverse();
    return result;
  }, [productRanking, rankingSearch, rankingSortDir]);

  const filteredAbc = useMemo(() => {
    if (!abcSearch) return abcCurve;
    return abcCurve.filter(p => p.name.toLowerCase().includes(abcSearch.toLowerCase()));
  }, [abcCurve, abcSearch]);

  const top5Names = useMemo(() => productRanking.slice(0, 5).map(p => p.name), [productRanking]);

  const periodLabel = useMemo(() => {
    if (filterMode === 'single') return selectedMonth === 'all' ? 'Ano todo' : MONTHS[Number(selectedMonth) - 1];
    if (filterMode === 'range') return `${MONTHS[Number(rangeStart) - 1]} → ${MONTHS[Number(rangeEnd) - 1]}`;
    return compareMonths.map(m => MONTHS[Number(m) - 1]).join(' vs ');
  }, [filterMode, selectedMonth, rangeStart, rangeEnd, compareMonths]);

  if (loading) return <div className="space-y-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-64 w-full" /></div>;

  if (salesReports.length === 0) return (
    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
      <Inbox className="h-12 w-12 mb-4" />
      <p className="font-semibold text-lg">Nenhum dado de vendas</p>
      <p className="text-sm">Importe um relatório de vendas para começar.</p>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* ── FILTROS ── */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <p className="text-xs text-muted-foreground mb-1">Quiosque</p>
          <Select value={selectedKioskId} onValueChange={setSelectedKioskId}>
            <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os quiosques</SelectItem>
              {availableKiosks.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1">Ano</p>
          <Select value={selectedYear} onValueChange={setSelectedYear}>
            <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
            <SelectContent>{availableYears.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1">Modo de período</p>
          <ToggleGroup type="single" value={filterMode} onValueChange={v => v && setFilterMode(v as FilterMode)} className="border rounded-md">
            <ToggleGroupItem value="single" className="gap-1 text-xs px-3"><Calendar className="h-3 w-3" /> Mês</ToggleGroupItem>
            <ToggleGroupItem value="range" className="gap-1 text-xs px-3"><CalendarRange className="h-3 w-3" /> Período</ToggleGroupItem>
            <ToggleGroupItem value="compare" className="gap-1 text-xs px-3"><GitCompare className="h-3 w-3" /> Comparar</ToggleGroupItem>
          </ToggleGroup>
        </div>
        {filterMode === 'single' && (
          <div>
            <p className="text-xs text-muted-foreground mb-1">Mês</p>
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {MONTH_NUMS.map(m => <SelectItem key={m} value={String(m)}>{MONTHS[m-1]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        {filterMode === 'range' && (
          <div className="flex items-end gap-2">
            <div>
              <p className="text-xs text-muted-foreground mb-1">De</p>
              <Select value={rangeStart} onValueChange={setRangeStart}>
                <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
                <SelectContent>{MONTH_NUMS.map(m => <SelectItem key={m} value={String(m)}>{MONTHS[m-1]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <span className="text-muted-foreground mb-2">→</span>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Até</p>
              <Select value={rangeEnd} onValueChange={setRangeEnd}>
                <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
                <SelectContent>{MONTH_NUMS.map(m => <SelectItem key={m} value={String(m)}>{MONTHS[m-1]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
        )}
        {filterMode === 'compare' && (
          <div>
            <p className="text-xs text-muted-foreground mb-1">Meses a comparar</p>
            <div className="flex gap-1 flex-wrap">
              {MONTH_NUMS.map(m => (
                <Button key={m} size="sm" variant={compareMonths.includes(String(m)) ? 'default' : 'outline'} className="h-8 w-12 text-xs"
                  onClick={() => setCompareMonths(prev => prev.includes(String(m)) ? prev.filter(x => x !== String(m)) : [...prev, String(m)])}>
                  {MONTHS[m-1]}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Badge variant="secondary">{selectedYear}</Badge>
        <Badge variant="outline">{periodLabel}</Badge>
        {filteredReports.length > 0 && <span className="text-xs text-muted-foreground">{filteredReports.length} relatório(s)</span>}
      </div>

      {/* SUMMARY CARDS */}
      {productRanking.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Total vendido</p><p className="text-2xl font-bold">{summaryCards.totalUnits.toLocaleString('pt-BR')}</p>
            {summaryCards.variation !== null && <p className={cn("text-xs font-semibold mt-1", summaryCards.variation >= 0 ? "text-green-600" : "text-destructive")}>{summaryCards.variation >= 0 ? '▲' : '▼'} {Math.abs(summaryCards.variation).toFixed(1)}% vs anterior</p>}
          </CardContent></Card>
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Produtos únicos</p><p className="text-2xl font-bold">{summaryCards.uniqueProducts}</p></CardContent></Card>
          <Card className="col-span-2"><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Top Produto</p><p className="text-lg font-bold truncate">{summaryCards.topProduct?.name || '-'}</p><p className="text-xs text-muted-foreground mt-1">{summaryCards.topProduct?.quantity.toLocaleString('pt-BR')} un</p></CardContent></Card>
        </div>
      )}

      {/* ── ABAS ── */}
      <Tabs defaultValue="ranking">
        <TabsList className="grid w-full grid-cols-3 md:grid-cols-6">
          <TabsTrigger value="ranking"><Award className="mr-1 h-3 w-3" /> Ranking</TabsTrigger>
          <TabsTrigger value="abc"><BarChart2 className="mr-1 h-3 w-3" /> Curva ABC</TabsTrigger>
          <TabsTrigger value="declining"><TrendingDown className="mr-1 h-3 w-3" /> Em queda</TabsTrigger>
          <TabsTrigger value="mix"><PieIcon className="mr-1 h-3 w-3" /> Mix</TabsTrigger>
          <TabsTrigger value="evolution"><TrendingUp className="mr-1 h-3 w-3" /> Evolução</TabsTrigger>
          <TabsTrigger value="kiosks"><ShoppingBag className="mr-1 h-3 w-3" /> Quiosques</TabsTrigger>
        </TabsList>

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
              <Table>
                <TableHeader><TableRow><TableHead className="w-10">#</TableHead><TableHead>Produto</TableHead><TableHead className="text-right cursor-pointer" onClick={() => setRankingSortDir(d => d === 'desc' ? 'asc' : 'desc')}>Qtd {rankingSortDir === 'desc' ? '↓' : '↑'}</TableHead><TableHead className="text-right">%</TableHead></TableRow></TableHeader>
                <TableBody>
                  {filteredRanking.map((item, i) => (
                    <TableRow key={item.simulationId}>
                      <TableCell>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</TableCell>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell className="text-right font-bold">{item.quantity.toLocaleString('pt-BR')}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{(item.quantity / summaryCards.totalUnits * 100).toFixed(1)}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="abc" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <CardTitle>Análise Curva ABC</CardTitle>
                <div className="relative w-[220px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Filtrar..." value={abcSearch} onChange={e => setAbcSearch(e.target.value)} className="pl-9" />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Classe</TableHead><TableHead>Produto</TableHead><TableHead className="text-right">Qtd.</TableHead><TableHead className="text-right">Acumulado %</TableHead></TableRow></TableHeader>
                <TableBody>
                  {filteredAbc.map(item => (
                    <TableRow key={item.simulationId}>
                      <TableCell><Badge className={cn(item.class === 'A' ? 'bg-green-500' : item.class === 'B' ? 'bg-yellow-500' : 'bg-gray-400', 'text-white')}>{item.class}</Badge></TableCell>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell className="text-right">{item.quantity.toLocaleString('pt-BR')}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{item.accumulated}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="declining" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><TrendingDown className="text-destructive" /> Produtos em queda</CardTitle></CardHeader>
            <CardContent>
              {decliningProducts.length === 0 ? <p className="text-center py-10 text-muted-foreground">Nenhum produto com tendência de queda detectada.</p> : (
                <Table>
                  <TableHeader><TableRow><TableHead>Produto</TableHead><TableHead className="text-right">Variação (3m)</TableHead><TableHead>Trend</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {decliningProducts.map(p => (
                      <TableRow key={p.simulationId}>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell className="text-right text-destructive font-bold">{p.variation.toFixed(1)}%</TableCell>
                        <TableCell>
                          <div className="flex items-end gap-0.5 h-8">
                            {p.values.map((v, i) => <div key={i} className="flex-1 bg-destructive/60 rounded-sm" style={{ height: `${Math.max((v.y / Math.max(...p.values.map(x=>x.y)))*100, 5)}%` }} />)}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="mix" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Mix por Linha</CardTitle></CardHeader>
            <CardContent className="flex flex-col md:flex-row gap-6">
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={mixByLine} dataKey="quantity" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({name, percent}) => `${name} ${(percent*100).toFixed(0)}%`}>
                    {mixByLine.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <Table>
                <TableHeader><TableRow><TableHead>Linha</TableHead><TableHead className="text-right">Qtd.</TableHead></TableRow></TableHeader>
                <TableBody>{mixByLine.map((l, i) => <TableRow key={l.name}><TableCell><div className="flex items-center gap-2"><div className="h-3 w-3 rounded-full" style={{backgroundColor: COLORS[i%COLORS.length]}}/>{l.name}</div></TableCell><TableCell className="text-right font-bold">{l.quantity.toLocaleString('pt-BR')}</TableCell></TableRow>)}</TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="evolution" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Evolução Top 5</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={monthlyEvolution}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey={filterMode === 'compare' ? 'product' : 'month'} />
                  <YAxis /><Tooltip
                    content={({ active }) => {
                      if (!active || !hoveredProduct) return null;
                      const productData = monthlyEvolution
                        .map(m => ({ month: m.month, value: (m as any)[hoveredProduct] || 0 }))
                        .filter(m => m.value > 0);
                      return (
                        <div className="bg-background border rounded-lg shadow-lg p-3 text-sm">
                          <p className="font-bold mb-2">{hoveredProduct}</p>
                          {productData.map(d => (
                            <div key={d.month} className="flex justify-between gap-6">
                              <span className="text-muted-foreground">{d.month}</span>
                              <span className="font-semibold">{d.value.toLocaleString('pt-BR')}</span>
                            </div>
                          ))}
                        </div>
                      );
                    }}
                  />
                  <Legend />
                  {filterMode === 'compare' ? compareMonths.map((m, i) => <Bar key={m} dataKey={MONTHS[Number(m)-1]} fill={COLORS[i % COLORS.length]} />) : 
                    top5Names.map((name, i) => (
                      <Bar 
                        key={name} 
                        dataKey={name} 
                        fill={COLORS[i % COLORS.length]} 
                        opacity={hoveredProduct && hoveredProduct !== name ? 0.3 : 1} 
                        onMouseEnter={() => setHoveredProduct(name)} 
                        onMouseLeave={() => setHoveredProduct(null)} 
                      />
                    ))
                  }
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
                <BarChart data={kioskComparison} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" /><YAxis dataKey="kioskName" type="category" width={140} /><Tooltip /><Bar dataKey="total" fill="#E91E8C" radius={[0,4,4,0]} /></BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}