"use client";

import { useMemo, useState } from 'react';
import { useSalesReports } from '@/components/sales-report-provider';
import { useKiosks } from '@/hooks/use-kiosks';
import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { TrendingUp, Award, Inbox, ShoppingBag, Calendar, CalendarRange, GitCompare } from 'lucide-react';

const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const MONTH_NUMS = [1,2,3,4,5,6,7,8,9,10,11,12];

const COLORS = [
  '#E91E8C','#6366F1','#10B981','#F59E0B',
  '#EF4444','#8B5CF6','#06B6D4','#84CC16',
];

type FilterMode = 'single' | 'range' | 'compare';

export function SalesAnalysisDashboard() {
  const { salesReports, loading } = useSalesReports();
  const { kiosks } = useKiosks();
  const { user, permissions } = useAuth();

  const isAdmin = permissions.settings.manageUsers;

  const availableKiosks = useMemo(() => {
    if (isAdmin) return kiosks;
    return kiosks.filter(k => user?.assignedKioskIds?.includes(k.id));
  }, [kiosks, user, isAdmin]);

  // Filtros principais
  const [selectedKioskId, setSelectedKioskId] = useState<string>('all');
  const [selectedYear, setSelectedYear] = useState<string>(String(new Date().getFullYear()));

  // Modo de filtro de mês
  const [filterMode, setFilterMode] = useState<FilterMode>('single');

  // Single
  const [selectedMonth, setSelectedMonth] = useState<string>('all');

  // Range
  const [rangeStart, setRangeStart] = useState<string>('1');
  const [rangeEnd, setRangeEnd] = useState<string>('12');

  // Compare
  const [compareMonths, setCompareMonths] = useState<string[]>([
    String(new Date().getMonth() + 1),
    String(new Date().getMonth() === 0 ? 12 : new Date().getMonth()),
  ]);

  const availableYears = useMemo(() => {
    const years = new Set(salesReports.map(r => String(r.year)));
    const yearsArray = Array.from(years).sort((a, b) => Number(b) - Number(a));
    if (yearsArray.length === 0) return [String(new Date().getFullYear())];
    return yearsArray;
  }, [salesReports]);

  // Função que determina quais meses incluir baseado no modo
  const includedMonths = useMemo((): number[] => {
    if (filterMode === 'single') {
      return selectedMonth === 'all' ? MONTH_NUMS : [Number(selectedMonth)];
    }
    if (filterMode === 'range') {
      const start = Number(rangeStart);
      const end = Number(rangeEnd);
      if (start <= end) return MONTH_NUMS.filter(m => m >= start && m <= end);
      // Wrap around: ex: Nov → Mar
      return MONTH_NUMS.filter(m => m >= start || m <= end);
    }
    if (filterMode === 'compare') {
      return compareMonths.map(Number).sort((a, b) => a - b);
    }
    return MONTH_NUMS;
  }, [filterMode, selectedMonth, rangeStart, rangeEnd, compareMonths]);

  // Relatórios filtrados
  const filteredReports = useMemo(() => {
    return salesReports.filter(r => {
      const kioskMatch = selectedKioskId === 'all' || r.kioskId === selectedKioskId;
      const yearMatch = !selectedYear || r.year === Number(selectedYear);
      const monthMatch = includedMonths.includes(r.month);
      const userKioskMatch = isAdmin || user?.assignedKioskIds?.includes(r.kioskId);
      return kioskMatch && yearMatch && monthMatch && userKioskMatch;
    });
  }, [salesReports, selectedKioskId, selectedYear, includedMonths, isAdmin, user]);

  // Ranking consolidado
  const productRanking = useMemo(() => {
    const totals: Record<string, { name: string; quantity: number; simulationId: string }> = {};
    filteredReports.forEach(report => {
      report.items.forEach(item => {
        if (!totals[item.simulationId]) {
          totals[item.simulationId] = { name: item.productName, quantity: 0, simulationId: item.simulationId };
        }
        totals[item.simulationId].quantity += item.quantity;
      });
    });
    return Object.values(totals).sort((a, b) => b.quantity - a.quantity);
  }, [filteredReports]);

  // Evolução — no modo compare, mostra barras lado a lado por mês comparado
  const monthlyEvolution = useMemo(() => {
    const top5 = productRanking.slice(0, 5).map(p => p.simulationId);

    if (filterMode === 'compare') {
      // Agrupa por mês comparado
      return includedMonths.map(monthNum => {
        const reportsForMonth = filteredReports.filter(r => r.month === monthNum);
        const entry: Record<string, any> = { month: MONTHS[monthNum - 1] };
        reportsForMonth.forEach(r => {
          r.items.forEach(item => {
            if (!top5.includes(item.simulationId)) return;
            entry[item.productName] = (entry[item.productName] || 0) + item.quantity;
          });
        });
        return entry;
      });
    }

    // Range / Single — agrupa por mês incluído
    const byMonth: Record<number, Record<string, number>> = {};
    filteredReports.forEach(report => {
      if (!byMonth[report.month]) byMonth[report.month] = {};
      report.items.forEach(item => {
        if (!top5.includes(item.simulationId)) return;
        byMonth[report.month][item.productName] = (byMonth[report.month][item.productName] || 0) + item.quantity;
      });
    });

    return includedMonths.map(m => ({
      month: MONTHS[m - 1],
      ...(byMonth[m] || {}),
    })).filter(m => Object.keys(m).length > 1);
  }, [filteredReports, productRanking, filterMode, includedMonths]);

  // Comparativo por quiosque
  const kioskComparison = useMemo(() => {
    const byKiosk: Record<string, { kioskName: string; total: number }> = {};
    filteredReports
      .filter(r => isAdmin || user?.assignedKioskIds?.includes(r.kioskId))
      .forEach(report => {
        if (!byKiosk[report.kioskId]) {
          byKiosk[report.kioskId] = { kioskName: report.kioskName || report.kioskId, total: 0 };
        }
        report.items.forEach(item => { byKiosk[report.kioskId].total += item.quantity; });
      });
    return Object.entries(byKiosk)
      .map(([kioskId, data]) => ({ kioskId, ...data }))
      .sort((a, b) => b.total - a.total);
  }, [filteredReports, isAdmin, user]);

  const top5Names = useMemo(() => productRanking.slice(0, 5).map(p => p.name), [productRanking]);

  const periodLabel = useMemo(() => {
    if (filterMode === 'single') return selectedMonth === 'all' ? 'Ano todo' : MONTHS[Number(selectedMonth) - 1];
    if (filterMode === 'range') return `${MONTHS[Number(rangeStart) - 1]} → ${MONTHS[Number(rangeEnd) - 1]}`;
    if (filterMode === 'compare') return includedMonths.map(m => MONTHS[m - 1]).join(' vs ');
    return '';
  }, [filterMode, selectedMonth, rangeStart, rangeEnd, includedMonths]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (salesReports.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Inbox className="h-12 w-12 mb-4" />
        <p className="font-semibold text-lg">Nenhum dado de vendas</p>
        <p className="text-sm">Importe um relatório de vendas para começar.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* Filtros principais */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <p className="text-xs text-muted-foreground mb-1 font-medium">Quiosque</p>
          <Select value={selectedKioskId} onValueChange={setSelectedKioskId}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Quiosque" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os quiosques</SelectItem>
              {availableKiosks.map(k => (
                <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <p className="text-xs text-muted-foreground mb-1 font-medium">Ano</p>
          <Select value={selectedYear} onValueChange={setSelectedYear}>
            <SelectTrigger className="w-[110px]">
              <SelectValue placeholder="Ano" />
            </SelectTrigger>
            <SelectContent>
              {availableYears.map(y => (
                <SelectItem key={y} value={y}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Modo de filtro de mês */}
        <div>
          <p className="text-xs text-muted-foreground mb-1 font-medium">Modo de período</p>
          <ToggleGroup type="single" value={filterMode} onValueChange={v => v && setFilterMode(v as FilterMode)} className="border rounded-md">
            <ToggleGroupItem value="single" className="gap-1 text-xs px-3">
              <Calendar className="h-3 w-3" /> Mês
            </ToggleGroupItem>
            <ToggleGroupItem value="range" className="gap-1 text-xs px-3">
              <CalendarRange className="h-3 w-3" /> Período
            </ToggleGroupItem>
            <ToggleGroupItem value="compare" className="gap-1 text-xs px-3">
              <GitCompare className="h-3 w-3" /> Comparar
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        {/* Filtros de mês conforme o modo */}
        {filterMode === 'single' && (
          <div>
            <p className="text-xs text-muted-foreground mb-1 font-medium">Mês</p>
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="w-[130px]">
                <SelectValue placeholder="Mês" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {MONTH_NUMS.map(m => (
                  <SelectItem key={m} value={String(m)}>{MONTHS[m - 1]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {filterMode === 'range' && (
          <div className="flex items-end gap-2">
            <div>
              <p className="text-xs text-muted-foreground mb-1 font-medium">De</p>
              <Select value={rangeStart} onValueChange={setRangeStart}>
                <SelectTrigger className="w-[110px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTH_NUMS.map(m => (
                    <SelectItem key={m} value={String(m)}>{MONTHS[m - 1]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <span className="text-muted-foreground mb-2">→</span>
            <div>
              <p className="text-xs text-muted-foreground mb-1 font-medium">Até</p>
              <Select value={rangeEnd} onValueChange={setRangeEnd}>
                <SelectTrigger className="w-[110px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTH_NUMS.map(m => (
                    <SelectItem key={m} value={String(m)}>{MONTHS[m - 1]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {filterMode === 'compare' && (
          <div className="flex items-end gap-2 flex-wrap">
            <p className="text-xs text-muted-foreground mb-1 w-full font-medium">Meses a comparar</p>
            <div className="flex flex-wrap gap-1">
              {MONTH_NUMS.map(m => (
                <Button
                  key={m}
                  size="sm"
                  variant={compareMonths.includes(String(m)) ? 'default' : 'outline'}
                  className="h-8 w-12 text-xs"
                  onClick={() => {
                    setCompareMonths(prev =>
                      prev.includes(String(m))
                        ? prev.filter(x => x !== String(m))
                        : [...prev, String(m)]
                    );
                  }}
                >
                  {MONTHS[m - 1]}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Badge do período selecionado */}
      {periodLabel && (
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{selectedYear}</Badge>
          <Badge variant="outline">{periodLabel}</Badge>
          {filteredReports.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {filteredReports.length} relatório(s) encontrado(s)
            </span>
          )}
        </div>
      )}

      <Tabs defaultValue="ranking">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="ranking"><Award className="mr-2 h-4 w-4" /> Ranking</TabsTrigger>
          <TabsTrigger value="evolution"><TrendingUp className="mr-2 h-4 w-4" /> Evolução</TabsTrigger>
          <TabsTrigger value="kiosks"><ShoppingBag className="mr-2 h-4 w-4" /> Por quiosque</TabsTrigger>
        </TabsList>

        {/* ABA: RANKING */}
        <TabsContent value="ranking" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Ranking de produtos mais vendidos</CardTitle>
              <CardDescription>Total de unidades vendidas no período selecionado.</CardDescription>
            </CardHeader>
            <CardContent>
              {productRanking.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">Nenhum dado para o período.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>Produto</TableHead>
                      <TableHead className="text-right">Qtd. vendida</TableHead>
                      <TableHead className="text-right">% do total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {productRanking.map((item, index) => {
                      const total = productRanking.reduce((sum, p) => sum + p.quantity, 0);
                      const pct = total > 0 ? ((item.quantity / total) * 100).toFixed(1) : '0';
                      return (
                        <TableRow key={item.simulationId}>
                          <TableCell>
                            {index === 0 && <Badge className="bg-yellow-500 text-white">🥇</Badge>}
                            {index === 1 && <Badge className="bg-gray-400 text-white">🥈</Badge>}
                            {index === 2 && <Badge className="bg-amber-600 text-white">🥉</Badge>}
                            {index > 2 && <span className="text-muted-foreground">{index + 1}</span>}
                          </TableCell>
                          <TableCell className="font-medium">{item.name}</TableCell>
                          <TableCell className="text-right font-bold">{item.quantity.toLocaleString('pt-BR')}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{pct}%</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ABA: EVOLUÇÃO */}
        <TabsContent value="evolution" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>
                {filterMode === 'compare' ? 'Comparativo mensal — Top 5 produtos' : 'Evolução mensal — Top 5 produtos'}
              </CardTitle>
              <CardDescription>
                {filterMode === 'compare'
                  ? `Comparando ${periodLabel}`
                  : 'Quantidade vendida por mês dos 5 produtos mais vendidos.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {monthlyEvolution.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">Nenhum dado para o período.</p>
              ) : (
                <div className="h-[320px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthlyEvolution} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis />
                      <Tooltip formatter={(value: number) => value.toLocaleString('pt-BR')} />
                      <Legend />
                      {top5Names.map((name, i) => (
                        <Bar key={name} dataKey={name} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ABA: POR QUIOSQUE */}
        <TabsContent value="kiosks" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Comparativo por quiosque</CardTitle>
              <CardDescription>Total de itens vendidos por unidade no período selecionado.</CardDescription>
            </CardHeader>
            <CardContent>
              {kioskComparison.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">Nenhum dado para o período.</p>
              ) : (
                <>
                  <div className="h-[250px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={kioskComparison} layout="vertical" margin={{ top: 0, right: 20, left: 20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" />
                        <YAxis dataKey="kioskName" type="category" width={140} />
                        <Tooltip formatter={(value: number) => value.toLocaleString('pt-BR')} />
                        <Bar dataKey="total" name="Total vendido" fill="#E91E8C" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <Table className="mt-4">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Quiosque</TableHead>
                        <TableHead className="text-right">Total vendido</TableHead>
                        <TableHead className="text-right">% do total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {kioskComparison.map(kiosk => {
                        const grandTotal = kioskComparison.reduce((sum, k) => sum + k.total, 0);
                        const pct = grandTotal > 0 ? ((kiosk.total / grandTotal) * 100).toFixed(1) : '0';
                        return (
                          <TableRow key={kiosk.kioskId}>
                            <TableCell className="font-medium">{kiosk.kioskName}</TableCell>
                            <TableCell className="text-right font-bold">{kiosk.total.toLocaleString('pt-BR')}</TableCell>
                            <TableCell className="text-right text-muted-foreground">{pct}%</TableCell>
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
