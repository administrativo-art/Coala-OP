"use client";

import { useMemo, useState } from 'react';
import { useSalesReports } from '@/components/sales-report-provider';
import { useKiosks } from '@/hooks/use-kiosks';
import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { TrendingUp, Award, Inbox, ShoppingBag } from 'lucide-react';

const MONTHS = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'
];

const COLORS = [
  '#E91E8C', '#6366F1', '#10B981', '#F59E0B',
  '#EF4444', '#8B5CF6', '#06B6D4', '#84CC16',
];

export function SalesAnalysisDashboard() {
  const { salesReports, loading } = useSalesReports();
  const { kiosks } = useKiosks();
  const { user, permissions } = useAuth();

  const isAdmin = permissions.settings.manageUsers;

  const availableKiosks = useMemo(() => {
    if (isAdmin) return kiosks;
    return kiosks.filter(k => user?.assignedKioskIds?.includes(k.id));
  }, [kiosks, user, isAdmin]);

  const [selectedKioskId, setSelectedKioskId] = useState<string>('all');
  const [selectedYear, setSelectedYear] = useState<string>(String(new Date().getFullYear()));

  // Anos disponíveis
  const availableYears = useMemo(() => {
    const years = new Set(salesReports.map(r => String(r.year)));
    const yearsArray = Array.from(years).sort((a, b) => Number(b) - Number(a));
    if (yearsArray.length === 0) return [String(new Date().getFullYear())];
    return yearsArray;
  }, [salesReports]);

  // Relatórios filtrados
  const filteredReports = useMemo(() => {
    return salesReports.filter(r => {
      const kioskMatch = selectedKioskId === 'all' || r.kioskId === selectedKioskId;
      const yearMatch = !selectedYear || r.year === Number(selectedYear);
      const userKioskMatch = isAdmin || user?.assignedKioskIds?.includes(r.kioskId);
      return kioskMatch && yearMatch && userKioskMatch;
    });
  }, [salesReports, selectedKioskId, selectedYear, isAdmin, user]);

  // Ranking consolidado de produtos
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

  // Evolução mensal (top 5 produtos)
  const monthlyEvolution = useMemo(() => {
    const top5 = productRanking.slice(0, 5).map(p => p.simulationId);

    const byMonth: Record<number, Record<string, number>> = {};

    filteredReports.forEach(report => {
      if (!byMonth[report.month]) byMonth[report.month] = {};
      report.items.forEach(item => {
        if (!top5.includes(item.simulationId)) return;
        byMonth[report.month][item.productName] = (byMonth[report.month][item.productName] || 0) + item.quantity;
      });
    });

    return Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      return {
        month: MONTHS[i],
        ...(byMonth[month] || {}),
      };
    }).filter(m => Object.keys(m).length > 1); // só meses com dados
  }, [filteredReports, productRanking]);

  // Comparativo entre quiosques (top produto)
  const kioskComparison = useMemo(() => {
    const byKiosk: Record<string, { kioskName: string; total: number }> = {};

    salesReports
      .filter(r => r.year === Number(selectedYear) && (isAdmin || user?.assignedKioskIds?.includes(r.kioskId)))
      .forEach(report => {
        if (!byKiosk[report.kioskId]) {
          byKiosk[report.kioskId] = { kioskName: report.kioskName || report.kioskId, total: 0 };
        }
        report.items.forEach(item => {
          byKiosk[report.kioskId].total += item.quantity;
        });
      });

    return Object.entries(byKiosk)
      .map(([kioskId, data]) => ({ kioskId, ...data }))
      .sort((a, b) => b.total - a.total);
  }, [salesReports, selectedYear, isAdmin, user]);

  const top5Names = useMemo(() => productRanking.slice(0, 5).map(p => p.name), [productRanking]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
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
      <div className="flex flex-wrap gap-3">
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

        <Select value={selectedYear} onValueChange={setSelectedYear}>
          <SelectTrigger className="w-[120px]">
            <SelectValue placeholder="Ano" />
          </SelectTrigger>
          <SelectContent>
            {availableYears.map(y => (
              <SelectItem key={y} value={y}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Tabs defaultValue="ranking">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="ranking"><Award className="mr-2 h-4 w-4" /> Ranking</TabsTrigger>
          <TabsTrigger value="evolution"><TrendingUp className="mr-2 h-4 w-4" /> Evolução</TabsTrigger>
          <TabsTrigger value="kiosks"><ShoppingBag className="mr-2 h-4 w-4" /> Por quiosque</TabsTrigger>
        </TabsList>

        <TabsContent value="ranking" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Ranking de produtos mais vendidos</CardTitle>
              <CardDescription>
                Total de unidades vendidas no período selecionado.
              </CardDescription>
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

        <TabsContent value="evolution" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Evolução mensal — Top 5 produtos</CardTitle>
              <CardDescription>
                Quantidade vendida por mês dos 5 produtos mais vendidos.
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

        <TabsContent value="kiosks" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Comparativo por quiosque</CardTitle>
              <CardDescription>
                Total de itens vendidos por unidade no ano selecionado.
              </CardDescription>
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
