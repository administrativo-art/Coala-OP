"use client"

import { useMemo } from "react"
import { useAuth } from "@/hooks/use-auth"
import { useExpiryProducts } from "@/hooks/use-expiry-products"
import { useProducts } from "@/hooks/use-products"
import { useConsumptionAnalysis } from "@/hooks/use-consumption-analysis"
import { useStockAnalysisProducts } from "@/hooks/use-stock-analysis-products"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Box, Package, AlertTriangle, TrendingUp } from 'lucide-react'
import { differenceInDays, parseISO } from 'date-fns'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'


export default function DashboardPage() {
  const { user } = useAuth()
  const { lots, loading: lotsLoading } = useExpiryProducts()
  const { products, loading: productsLoading } = useProducts()
  const { history: consumptionHistory, loading: consumptionLoading } = useConsumptionAnalysis()
  const { products: stockProducts, loading: stockProductsLoading } = useStockAnalysisProducts()

  const lotsInKiosk = useMemo(() => {
    if (lotsLoading || !user) return [];
    return user.username === 'master' ? lots : lots.filter(lot => lot.kioskId === user.kioskId);
  }, [lots, user, lotsLoading]);

  const expiringSoonCount = useMemo(() => {
    if (lotsLoading) return 0;
    return lotsInKiosk.filter(lot => {
        const days = differenceInDays(parseISO(lot.expiryDate), new Date());
        return days >= 0 && days <= 7;
    }).length;
  }, [lotsInKiosk, lotsLoading]);

  const expiredCount = useMemo(() => {
     if (lotsLoading) return 0;
    return lotsInKiosk.filter(lot => differenceInDays(parseISO(lot.expiryDate), new Date()) < 0).length;
  }, [lotsInKiosk, lotsLoading]);

  const chartData = useMemo(() => {
    const loading = consumptionLoading || stockProductsLoading;
    if (loading || !user || consumptionHistory.length === 0) {
      return [];
    }

    const kioskConsumption: { [kioskId: string]: { [productId: string]: { total: number, count: number, name: string } } } = {};

    consumptionHistory.forEach(report => {
      if (!kioskConsumption[report.kioskId]) {
        kioskConsumption[report.kioskId] = {};
      }
      report.results.forEach(item => {
        const product = stockProducts.find(p => p.id === item.productId);
        if (!kioskConsumption[report.kioskId][item.productId]) {
          kioskConsumption[report.kioskId][item.productId] = { total: 0, count: 0, name: product?.baseName || item.productName.split(' (')[0] };
        }
        kioskConsumption[report.kioskId][item.productId].total += item.consumedPackages;
        kioskConsumption[report.kioskId][item.productId].count += 1;
      });
    });

    let dataForChart: { name: string, "Consumo Médio (Pacotes)": number }[] = [];

    if (user.username === 'master') {
      const masterAverages: { [productId: string]: { totalAvg: number, name: string } } = {};
      Object.values(kioskConsumption).forEach(productMap => {
        Object.entries(productMap).forEach(([productId, data]) => {
          const avgForKiosk = data.total / data.count;
          if (!masterAverages[productId]) {
            masterAverages[productId] = { totalAvg: 0, name: data.name };
          }
          masterAverages[productId].totalAvg += avgForKiosk;
        });
      });
      dataForChart = Object.values(masterAverages).map(d => ({
        name: d.name,
        "Consumo Médio (Pacotes)": Math.ceil(d.totalAvg),
      }));
    } else {
      const userKioskData = kioskConsumption[user.kioskId];
      if (userKioskData) {
        dataForChart = Object.values(userKioskData).map(data => ({
          name: data.name,
          "Consumo Médio (Pacotes)": Math.ceil(data.total / data.count),
        }));
      }
    }

    return dataForChart.sort((a, b) => b["Consumo Médio (Pacotes)"] - a["Consumo Médio (Pacotes)"]).slice(0, 7);

  }, [user, consumptionHistory, stockProducts, consumptionLoading, stockProductsLoading]);

  const initialLoading = productsLoading || lotsLoading;

  if (initialLoading) {
    return (
        <div>
            <Skeleton className="h-8 w-64 mb-2" />
            <Skeleton className="h-5 w-96 mb-6" />
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-32 w-full" />
            </div>
             <div className="mt-6">
                <Skeleton className="h-[400px] w-full" />
            </div>
        </div>
    )
  }

  return (
    <div>
      <h1 className="text-3xl font-bold mb-2">Bem-vindo, {user?.username}!</h1>
      <p className="text-muted-foreground mb-6">Aqui está um resumo da sua operação.</p>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Produtos cadastrados</CardTitle>
            <Package className="h-6 w-6 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">{products.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Lotes no seu quiosque</CardTitle>
            <Box className="h-6 w-6 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">{lotsInKiosk.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Vencendo em 7 dias</CardTitle>
            <AlertTriangle className="h-6 w-6 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-yellow-500">{expiringSoonCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Produtos vencidos</CardTitle>
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-destructive">{expiredCount}</div>
          </CardContent>
        </Card>
      </div>

       <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-1">
          <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-6 w-6" /> Consumo Médio Mensal
                </CardTitle>
                <CardDescription>
                {user?.username === 'master' 
                    ? 'Soma do consumo médio mensal de todos os quiosques (Top 7 produtos).' 
                    : `Produtos mais consumidos no seu quiosque (Top 7).`}
                </CardDescription>
            </CardHeader>
            <CardContent className="pl-2">
                 { (consumptionLoading || stockProductsLoading) ? (
                    <Skeleton className="h-[350px] w-full" />
                    ) : chartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={350}>
                        <BarChart data={chartData} margin={{ top: 5, right: 30, left: 0, bottom: 70 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} interval={0} angle={-45} textAnchor="end" />
                        <YAxis fontSize={12} tickLine={false} axisLine={false} />
                        <Tooltip 
                            cursor={{fill: 'hsl(var(--muted))'}}
                            contentStyle={{ 
                                backgroundColor: "hsl(var(--background))", 
                                border: "1px solid hsl(var(--border))",
                                borderRadius: "var(--radius)"
                            }}
                        />
                        <Bar dataKey="Consumo Médio (Pacotes)" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                    ) : (
                    <div className="flex h-[350px] flex-col items-center justify-center text-muted-foreground text-center">
                            <TrendingUp className="h-12 w-12 mb-4" />
                            <p className="font-semibold">Sem dados de consumo</p>
                            <p className="text-sm">Faça o upload de relatórios de consumo para gerar o gráfico.</p>
                    </div>
                    )}
            </CardContent>
          </Card>
       </div>
    </div>
  )
}
