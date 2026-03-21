"use client";

import { useMemo, useState } from 'react';
import { useSalesReports } from '@/components/sales-report-provider';
import { useKiosks } from '@/hooks/use-kiosks';
import { useAuth } from '@/hooks/use-auth';
import { useProductSimulation } from '@/hooks/use-product-simulation';
import { useProductSimulationCategories } from '@/hooks/use-product-simulation-categories';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell } from 'recharts';
import { TrendingUp, Award, Inbox, ShoppingBag, Calendar, CalendarRange, GitCompare, TrendingDown, PieChart as PieIcon, BarChart2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const MONTH_NUMS = [1,2,3,4,5,6,7,8,9,10,11,12];
const COLORS = ['#E91E8C','#6366F1','#10B981','#F59E0B','#EF4444','#8B5CF6','#06B6D4','#84CC16','#F97316','#EC4899'];

type FilterMode = 'single' | 'range' | 'compare';

export function SalesAnalysisDashboard() {
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

  // Map simulationId -> simulation
  const simulationMap = useMemo(() => new Map(simulations.map(s => [s.id, s])), [simulations]);
  // Map categoryId -> category
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
      return compareMonths.map(m => {
        const mn = Number(m);
        const entry: Record<string, any> = { month: MONTHS[mn - 1] };
        filteredReports.filter(r => r.month === mn).forEach(r =>
          r.items.forEach(item => {
            if (!top5.includes(item.simulationId)) return;
            entry[item.productName] = (entry[item.productName] || 0) + item.quantity;
          })
        );
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

  const top5Names = productRanking.slice(0, 5).map(p => p.name);
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

      <Tabs defaultValue="ranking">
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="ranking"><Award className="mr-1 h-3 w-3" /> Ranking</TabsTrigger>
          <TabsTrigger value="abc"><BarChart2 className="mr-1 h-3 w-3" /> Curva ABC</TabsTrigger>
          <TabsTrigger value="declining"><TrendingDown className="mr-1 h-3 w-3" /> Em queda</TabsTrigger>
          <TabsTrigger value="mix"><PieIcon className="mr-1 h-3 w-3" /> Mix por linha</TabsTrigger>
          <TabsTrigger value="evolution"><TrendingUp className="mr-1 h-3 w-3" /> Evolução</TabsTrigger>
          <TabsTrigger value="kiosks"><ShoppingBag className="mr-1 h-3 w-3" /> Por quiosque</TabsTrigger>
        </TabsList>

        <TabsContent value="ranking" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Ranking de produtos mais vendidos</CardTitle><CardDescription>Total de unidades vendidas no período.</CardDescription></CardHeader>
            <CardContent>
              {productRanking.length === 0 ? <p className="text-muted-foreground text-center py-8">Nenhum dado.</p> : (
                <Table>
                  <TableHeader><TableRow><TableHead className="w-10">#</TableHead><TableHead>Produto</TableHead><TableHead className="text-right">Qtd. vendida</TableHead><TableHead className="text-right">% do total</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {productRanking.map((item, i) => {
                      const total = productRanking.reduce((s, p) => s + p.quantity, 0);
                      return (
                        <TableRow key={item.simulationId}>
                          <TableCell>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : <span className="text-muted-foreground">{i+1}</span>}</TableCell>
                          <TableCell className="font-medium">{item.name}</TableCell>
                          <TableCell className="text-right font-bold">{item.quantity.toLocaleString('pt-BR')}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{total > 0 ? (item.quantity/total*100).toFixed(1) : 0}%</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="abc" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Curva ABC</CardTitle>
              <CardDescription>A = top 80% das vendas · B = 80–95% · C = cauda longa</CardDescription>
            </CardHeader>
            <CardContent>
              {abcCurve.length === 0 ? <p className="text-muted-foreground text-center py-8">Nenhum dado.</p> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Classe</TableHead>
                      <TableHead>Produto</TableHead>
                      <TableHead className="text-right">Qtd.</TableHead>
                      <TableHead className="text-right">% individual</TableHead>
                      <TableHead className="text-right">% acumulado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {abcCurve.map(item => (
                      <TableRow key={item.simulationId}>
                        <TableCell>
                          <Badge className={cn(
                            item.class === 'A' && 'bg-green-500 text-white',
                            item.class === 'B' && 'bg-yellow-500 text-white',
                            item.class === 'C' && 'bg-gray-400 text-white',
                          )}>{item.class}</Badge>
                        </TableCell>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell className="text-right">{item.quantity.toLocaleString('pt-BR')}</TableCell>
                        <TableCell className="text-right">{item.pct}%</TableCell>
                        <TableCell className="text-right text-muted-foreground">{item.accumulated}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="declining" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><TrendingDown className="h-5 w-5 text-destructive" /> Produtos em queda</CardTitle>
              <CardDescription>Produtos com tendência de queda nos últimos 6 meses (todos quiosques).</CardDescription>
            </CardHeader>
            <CardContent>
              {decliningProducts.length === 0 ? (
                <div className="flex flex-col items-center py-10 text-muted-foreground">
                  <TrendingUp className="h-10 w-10 text-green-500 mb-3" />
                  <p className="font-semibold">Nenhum produto em queda</p>
                  <p className="text-sm">Todos os produtos estão estáveis ou em crescimento.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produto</TableHead>
                      <TableHead className="text-right">Média mensal</TableHead>
                      <TableHead className="text-right">Variação (3m)</TableHead>
                      <TableHead>Últimos 6 meses</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {decliningProducts.map(p => (
                      <TableRow key={p.simulationId}>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell className="text-right">{p.avgY.toFixed(0)}</TableCell>
                        <TableCell className="text-right">
                          <span className="text-destructive font-semibold">
                            {p.variation > 0 ? '+' : ''}{p.variation.toFixed(1)}%
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-end gap-0.5 h-8">
                            {p.values.map((v, i) => {
                              const max = Math.max(...p.values.map(x => x.y));
                              const h = max > 0 ? (v.y / max) * 100 : 0;
                              return (
                                <div key={i} title={`${v.label}: ${v.y}`} className="flex-1 bg-destructive/70 rounded-sm transition-all" style={{ height: `${Math.max(h, 4)}%` }} />
                              );
                            })}
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
            <CardHeader><CardTitle>Mix de vendas por linha</CardTitle><CardDescription>Participação de cada linha no total de vendas do período.</CardDescription></CardHeader>
            <CardContent>
              {mixByLine.length === 0 ? <p className="text-muted-foreground text-center py-8">Nenhum dado.</p> : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <ResponsiveContainer width="100%" height={280}>
                    <PieChart>
                      <Pie data={mixByLine} dataKey="quantity" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={({ name, percent }) => `${name} ${(percent*100).toFixed(1)}%`}>
                        {mixByLine.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v: number) => v.toLocaleString('pt-BR')} />
                    </PieChart>
                  </ResponsiveContainer>
                  <Table>
                    <TableHeader><TableRow><TableHead>Linha</TableHead><TableHead className="text-right">Qtd.</TableHead><TableHead className="text-right">%</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {mixByLine.map((line, i) => {
                        const total = mixByLine.reduce((s, l) => s + l.quantity, 0);
                        return (
                          <TableRow key={line.name}>
                            <TableCell className="flex items-center gap-2">
                              <div className="h-3 w-3 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                              {line.name}
                            </TableCell>
                            <TableCell className="text-right font-bold">{line.quantity.toLocaleString('pt-BR')}</TableCell>
                            <TableCell className="text-right text-muted-foreground">{total > 0 ? (line.quantity/total*100).toFixed(1) : 0}%</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="evolution" className="mt-4">
          <Card>
            <CardHeader><CardTitle>{filterMode === 'compare' ? 'Comparativo mensal' : 'Evolução mensal'} — Top 5</CardTitle></CardHeader>
            <CardContent>
              {monthlyEvolution.length === 0 ? <p className="text-muted-foreground text-center py-8">Nenhum dado.</p> : (
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={monthlyEvolution} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip formatter={(v: number) => v.toLocaleString('pt-BR')} />
                    <Legend />
                    {top5Names.map((name, i) => <Bar key={name} dataKey={name} fill={COLORS[i % COLORS.length]} radius={[4,4,0,0]} />)}
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="kiosks" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Comparativo por quiosque</CardTitle><CardDescription>Total de itens vendidos por unidade no período.</CardDescription></CardHeader>
            <CardContent>
              {kioskComparison.length === 0 ? <p className="text-muted-foreground text-center py-8">Nenhum dado.</p> : (
                <>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={kioskComparison} layout="vertical" margin={{ top: 0, right: 20, left: 20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis dataKey="kioskName" type="category" width={140} />
                      <Tooltip formatter={(v: number) => v.toLocaleString('pt-BR')} />
                      <Bar dataKey="total" name="Total vendido" fill="#E91E8C" radius={[0,4,4,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  <Table className="mt-4">
                    <TableHeader><TableRow><TableHead>Quiosque</TableHead><TableHead className="text-right">Total vendido</TableHead><TableHead className="text-right">%</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {kioskComparison.map(k => {
                        const gt = kioskComparison.reduce((s, x) => s + x.total, 0);
                        return (
                          <TableRow key={k.kioskId}>
                            <TableCell className="font-medium">{k.kioskName}</TableCell>
                            <TableCell className="text-right font-bold">{k.total.toLocaleString('pt-BR')}</TableCell>
                            <TableCell className="text-right text-muted-foreground">{gt > 0 ? (k.total/gt*100).toFixed(1) : 0}%</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
